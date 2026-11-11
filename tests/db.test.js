const mockQuery = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query: mockQuery }))
}));

const db = require('../db');

const CTX = { request_id: 'req-teste-db', client: 'web' };

function linhasDeLog() {
  return console.log.mock.calls.map((chamada) => JSON.parse(chamada[0]));
}

beforeEach(() => {
  mockQuery.mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => { });
});

afterEach(() => {
  console.log.mockRestore();
});

describe('log', () => {
  test('gera JSON com os 8 campos e nível INFO por padrão', () => {
    db.log({
      layer: 'db',
      client: 'web',
      operation: 'teste',
      status: 'success',
      request_id: 'req-1',
      message: 'ok'
    });

    const [linha] = linhasDeLog();
    expect(Object.keys(linha)).toEqual([
      'timestamp', 'level', 'layer', 'client', 'operation', 'status', 'request_id', 'message'
    ]);
    expect(linha.level).toBe('INFO');
    expect(linha.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  test('respeita o nível informado', () => {
    db.log({ level: 'ERROR', layer: 'db', client: 'cli', operation: 'x', status: 'error', request_id: 'r', message: 'm' });
    expect(linhasDeLog()[0].level).toBe('ERROR');
  });
});

describe('executar', () => {
  test('retorna o resultado e registra sucesso com o request_id', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1 }] });

    const resultado = await db.executar(CTX, 'select_teste', 'Consulta ok', 'SELECT 1', []);

    expect(resultado.rows).toEqual([{ id: 1 }]);
    const [linha] = linhasDeLog();
    expect(linha).toMatchObject({
      layer: 'db', client: 'web', operation: 'select_teste', status: 'success', request_id: 'req-teste-db'
    });
  });

  test('registra erro e repassa a exceção', async () => {
    mockQuery.mockRejectedValue(new Error('falha no banco'));

    await expect(db.executar(CTX, 'select_teste', 'Consulta ok', 'SELECT 1', [])).rejects.toThrow('falha no banco');

    const [linha] = linhasDeLog();
    expect(linha).toMatchObject({ level: 'ERROR', status: 'error', operation: 'select_teste' });
  });
});

describe('funções de dados', () => {
  test('criarTabelas cria as tabelas tarefas e usuarios', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await db.criarTabelas(CTX);

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS tarefas');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS usuarios');
  });

  test('salvarUsuarioInicial grava usuário e hash', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await db.salvarUsuarioInicial('admin', 'hash-fixo', CTX);

    expect(mockQuery.mock.calls[0][1]).toEqual(['admin', 'hash-fixo']);
  });

  test('buscarUsuario devolve a primeira linha', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, usuario: 'admin', senha_hash: 'h' }] });

    const usuario = await db.buscarUsuario('admin', CTX);

    expect(usuario.usuario).toBe('admin');
    expect(mockQuery.mock.calls[0][1]).toEqual(['admin']);
  });

  test('criarTarefa envia os 5 parâmetros e devolve rows[0]', async () => {
    const tarefaCriada = {
      id: 1,
      titulo: 'Tarefa 1',
      responsavel: 'Italo',
      prioridade: 'alta',
      status: 'a_fazer',
      prazo: '2026-11-20'
    };
    mockQuery.mockResolvedValue({ rows: [tarefaCriada] });

    const dados = {
      titulo: 'Tarefa 1',
      responsavel: 'Italo',
      prioridade: 'alta',
      status: 'a_fazer',
      prazo: '2026-11-20'
    };

    const resultado = await db.criarTarefa(dados, CTX);

    expect(resultado).toEqual(tarefaCriada);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('INSERT INTO tarefas');
    expect(sql).toContain("TO_CHAR(prazo, 'YYYY-MM-DD') AS prazo");
    expect(mockQuery.mock.calls[0][1]).toEqual([
      dados.titulo,
      dados.responsavel,
      dados.prioridade,
      dados.status,
      dados.prazo
    ]);
  });

  test('atualizarTarefa devolve a tarefa quando existe', async () => {
    const tarefaAtualizada = {
      id: 1,
      titulo: 'Tarefa Atualizada',
      responsavel: 'Italo',
      prioridade: 'media',
      status: 'fazendo',
      prazo: '2026-11-25'
    };
    mockQuery.mockResolvedValue({ rows: [tarefaAtualizada] });

    const dados = {
      titulo: 'Tarefa Atualizada',
      responsavel: 'Italo',
      prioridade: 'media',
      status: 'fazendo',
      prazo: '2026-11-25'
    };

    const resultado = await db.atualizarTarefa(1, dados, CTX);

    expect(resultado).toEqual(tarefaAtualizada);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('UPDATE tarefas');
    expect(sql).toContain('SET');
    expect(sql).toContain('WHERE id = $6');
    expect(mockQuery.mock.calls[0][1]).toEqual([
      dados.titulo,
      dados.responsavel,
      dados.prioridade,
      dados.status,
      dados.prazo,
      1
    ]);
  });

  test('atualizarTarefa devolve null quando não existe', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const dados = {
      titulo: 'Inexistente',
      responsavel: 'Italo',
      prioridade: 'baixa',
      status: 'feito',
      prazo: null
    };

    const resultado = await db.atualizarTarefa(999, dados, CTX);

    expect(resultado).toBeNull();
  });
});