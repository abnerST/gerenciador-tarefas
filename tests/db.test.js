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

describe('consultas da CLI (issue #8)', () => {
  const DADOS = { titulo: 'T', responsavel: 'R', prioridade: 'baixa', status: 'feito', prazo: null };
  const CTX_CLI = { request_id: 'req-cli', client: 'cli' };

  test('inserirTarefaCli insere e registra log db com client cli', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, ...DADOS }] });

    const tarefa = await db.inserirTarefaCli(DADOS, CTX_CLI);

    expect(tarefa.id).toBe(1);
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO tarefas');
    expect(mockQuery.mock.calls[0][1]).toEqual(['T', 'R', 'baixa', 'feito', null]);
    expect(linhasDeLog()[0]).toMatchObject({ layer: 'db', client: 'cli', operation: 'insert_task', request_id: 'req-cli' });
  });

  test('editarTarefaCli atualiza e devolve a tarefa', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 5, ...DADOS }] });

    const tarefa = await db.editarTarefaCli(5, DADOS, CTX_CLI);

    expect(tarefa.id).toBe(5);
    expect(mockQuery.mock.calls[0][0]).toContain('UPDATE tarefas');
    expect(mockQuery.mock.calls[0][1]).toEqual(['T', 'R', 'baixa', 'feito', null, 5]);
    expect(linhasDeLog()[0]).toMatchObject({ client: 'cli', operation: 'update_task' });
  });

  test('editarTarefaCli devolve null quando a tarefa não existe', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    expect(await db.editarTarefaCli(99, DADOS, CTX_CLI)).toBeNull();
  });
});

describe('obterMetricasDashboard (issue #6)', () => {
  test('retorna métricas agregadas e repassa request_id no log', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          status_a_fazer: '3',
          status_fazendo: '2',
          status_feito: '5',
          prioridade_baixa: '4',
          prioridade_media: '3',
          prioridade_alta: '3',
          prazos_atrasadas: '1',
          prazos_no_prazo: '7'
        }
      ]
    });

    const metricas = await db.obterMetricasDashboard(CTX);

    expect(metricas).toEqual({
      status: { a_fazer: 3, fazendo: 2, feito: 5 },
      prioridade: { baixa: 4, media: 3, alta: 3 },
      prazos: { atrasadas: 1, no_prazo: 7 }
    });

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain("COUNT(*) FILTER (WHERE status = 'a_fazer')");
    expect(sql).toContain("COUNT(*) FILTER (WHERE prioridade = 'baixa')");
    expect(sql).toContain("prazo < CURRENT_DATE AND status != 'feito'");
    expect(sql).toContain("prazo >= CURRENT_DATE OR status = 'feito'");

    const [linha] = linhasDeLog();
    expect(linha).toMatchObject({
      layer: 'db',
      client: 'web',
      operation: 'dashboard_metrics',
      status: 'success',
      request_id: 'req-teste-db'
    });
  });

  test('retorna zeros caso a consulta retorne linha vazia', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const metricas = await db.obterMetricasDashboard(CTX);

    expect(metricas).toEqual({
      status: { a_fazer: 0, fazendo: 0, feito: 0 },
      prioridade: { baixa: 0, media: 0, alta: 0 },
      prazos: { atrasadas: 0, no_prazo: 0 }
    });
  });
});

describe('listarTarefas', () => {
  test('usa ordenação padrão por id ascendente e devolve itens e total', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, titulo: 'Tarefa 1' }] })
      .mockResolvedValueOnce({ rows: [{ total: 7 }] });

    const resultado = await db.listarTarefas({ page: 1, pageSize: 5 }, CTX);

    expect(resultado).toEqual({ itens: [{ id: 1, titulo: 'Tarefa 1' }], total: 7 });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('ORDER BY id ASC');
    expect(params).toEqual([5, 0]);
    expect(mockQuery.mock.calls[1][0]).toContain('COUNT(*)');
  });

  test('aplica ordenação permitida, direção decrescente e deslocamento da página', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await db.listarTarefas({ page: 2, pageSize: 5, sort: 'prioridade', order: 'desc' }, CTX);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('CASE prioridade');
    expect(sql).toContain('DESC');
    expect(params).toEqual([5, 5]);
  });

  test('ignora coluna de ordenação não permitida', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await db.listarTarefas({ page: 1, pageSize: 5, sort: 'senha; DROP TABLE tarefas' }, CTX);

    expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY id ASC');
  });

  test('registra as duas consultas com o mesmo request_id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await db.listarTarefas({ page: 1, pageSize: 5 }, CTX);

    const operacoes = linhasDeLog().map((linha) => linha.operation);
    expect(operacoes).toEqual(['select_tasks', 'count_tasks']);
    linhasDeLog().forEach((linha) => {
      expect(linha.request_id).toBe('req-teste-db');
    });
  });
});

describe('excluirTarefa', () => {
  test('devolve true quando a tarefa existia', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const excluida = await db.excluirTarefa(3, CTX);

    expect(excluida).toBe(true);
    expect(mockQuery.mock.calls[0][1]).toEqual([3]);
  });

  test('devolve false quando a tarefa não existe', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0 });

    const excluida = await db.excluirTarefa(99, CTX);

    expect(excluida).toBe(false);
  });
});

describe('obterMetricasDashboardCli (issue #12)', () => {
  test('consulta própria da CLI com a mesma regra de prazos e os 3 indicadores', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ a_fazer: 2, fazendo: 1, feito: 3, baixa: 1, media: 3, alta: 2, atrasadas: 1, no_prazo: 4 }]
    });

    const metricas = await db.obterMetricasDashboardCli({ request_id: 'req-cli-dash', client: 'cli' });

    expect(metricas).toEqual({
      status: { a_fazer: 2, fazendo: 1, feito: 3 },
      prioridade: { baixa: 1, media: 3, alta: 2 },
      prazos: { atrasadas: 1, no_prazo: 4 }
    });
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain("prazo < CURRENT_DATE AND status <> 'feito'");
    expect(sql).toContain("prazo >= CURRENT_DATE OR status = 'feito'");
    const [linha] = linhasDeLog();
    expect(linha).toMatchObject({ layer: 'db', client: 'cli', operation: 'cli_dashboard_metrics', request_id: 'req-cli-dash' });
  });
});
