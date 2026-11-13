const { main, lerArgumentos, obterToken, chamarApi, mensagemDeErro, montarTarefa, formatarTarefa, AJUDA, formatarIndicadores, montarConsultaListagem, formatarListagem, montarConsultaExportacao } = require('../cli');

function respostaFalsa(status, corpo) {
  let texto = '';
  if (corpo !== undefined) {
    texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  }
  return { status, text: async () => texto };
}

function saidaFalsa() {
  return { info: jest.fn(), erro: jest.fn() };
}

const ENV = { API_URL: 'http://api-teste:3000' };

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

describe('lerArgumentos', () => {
  test('separa comando e opções com valor', () => {
    expect(lerArgumentos(['token', '--usuario', 'admin', '--senha', 'x'])).toEqual({
      comando: 'token',
      opcoes: { usuario: 'admin', senha: 'x' }
    });
  });

  test('opção sem valor vira true e só o primeiro posicional é o comando', () => {
    expect(lerArgumentos(['health', 'extra', '--help', '--verbose'])).toEqual({
      comando: 'health',
      opcoes: { help: true, verbose: true }
    });
  });

  test('sem argumentos não há comando', () => {
    expect(lerArgumentos([])).toEqual({ comando: null, opcoes: {} });
  });
});

describe('obterToken', () => {
  test('prioriza a opção --token', () => {
    expect(obterToken({ token: 'da-opcao' }, { TAREFAS_TOKEN: 'do-env' })).toBe('da-opcao');
  });

  test('usa a variável de ambiente TAREFAS_TOKEN', () => {
    expect(obterToken({}, { TAREFAS_TOKEN: 'do-env' })).toBe('do-env');
  });

  test('devolve null sem token', () => {
    expect(obterToken({}, {})).toBeNull();
  });
});

describe('chamarApi', () => {
  test('envia Authorization Bearer e corpo JSON quando há token', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(200, { ok: true }));

    const resultado = await chamarApi('POST', '/api/cli/algo', { corpo: { a: 1 }, token: 'tk', env: ENV });

    expect(resultado).toEqual({ status: 200, dados: { ok: true } });
    const [url, opcoes] = global.fetch.mock.calls[0];
    expect(url).toBe('http://api-teste:3000/api/cli/algo');
    expect(opcoes.method).toBe('POST');
    expect(opcoes.headers.Authorization).toBe('Bearer tk');
    expect(opcoes.body).toBe('{"a":1}');
  });

  test('não envia Authorization nem corpo quando não informados e usa a URL padrão', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(204));

    const resultado = await chamarApi('GET', '/api/cli/health', { env: {} });

    expect(resultado).toEqual({ status: 204, dados: {} });
    const [url, opcoes] = global.fetch.mock.calls[0];
    expect(url).toBe('http://api:3000/api/cli/health');
    expect(opcoes.headers.Authorization).toBeUndefined();
    expect(opcoes.body).toBeUndefined();
  });

  test('aceita resposta que não é JSON', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(404, 'Not Found'));

    const resultado = await chamarApi('GET', '/x', { env: ENV });

    expect(resultado).toEqual({ status: 404, dados: { texto: 'Not Found' } });
  });

  test('usa process.env quando nenhum env é informado', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(200, {}));

    await chamarApi('GET', '/api/cli/health');

    expect(global.fetch).toHaveBeenCalled();
  });
});

describe('mensagemDeErro', () => {
  test('explica o 401', () => {
    expect(mensagemDeErro({ status: 401, dados: {} })).toContain('HTTP 401');
  });

  test('mostra o erro da API ou uma mensagem genérica', () => {
    expect(mensagemDeErro({ status: 500, dados: { erro: 'Erro interno' } })).toBe('Erro HTTP 500: Erro interno');
    expect(mensagemDeErro({ status: 404, dados: {} })).toBe('Erro HTTP 404: erro inesperado');
  });
});

describe('main', () => {
  test('sem comando, "ajuda" ou --help mostram a ajuda', async () => {
    for (const argv of [[], ['ajuda'], ['--help'], ['health', '--ajuda']]) {
      const saida = saidaFalsa();
      expect(await main(argv, { env: ENV, saida })).toBe(0);
      expect(saida.info).toHaveBeenCalledWith(AJUDA);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('comando desconhecido retorna 1 e mostra a ajuda', async () => {
    const saida = saidaFalsa();

    expect(await main(['voar'], { env: ENV, saida })).toBe(1);
    expect(saida.erro.mock.calls[0][0]).toContain('Comando desconhecido: voar');
    expect(saida.info).toHaveBeenCalledWith(AJUDA);
  });

  test('health com API no ar', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(200, { status: 'ok' }));
    const saida = saidaFalsa();

    expect(await main(['health'], { env: ENV, saida })).toBe(0);
    expect(saida.info).toHaveBeenCalledWith('API online: ok');
    expect(global.fetch.mock.calls[0][0]).toBe('http://api-teste:3000/api/cli/health');
  });

  test('health com erro da API', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(503, { erro: 'indisponível' }));
    const saida = saidaFalsa();

    expect(await main(['health'], { env: ENV, saida })).toBe(1);
    expect(saida.erro).toHaveBeenCalledWith('Erro HTTP 503: indisponível');
  });

  test('token exige --usuario e --senha', async () => {
    const saida = saidaFalsa();

    expect(await main(['token', '--usuario', 'admin'], { env: ENV, saida })).toBe(1);
    expect(await main(['token', '--senha', 'x'], { env: ENV, saida })).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('token imprime o token quando as credenciais estão certas', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(200, { token: 'jwt-gerado' }));
    const saida = saidaFalsa();

    expect(await main(['token', '--usuario', 'admin', '--senha', 'admin123'], { env: ENV, saida })).toBe(0);
    expect(saida.info).toHaveBeenCalledWith('jwt-gerado');
    const [url, opcoes] = global.fetch.mock.calls[0];
    expect(url).toBe('http://api-teste:3000/api/cli/token');
    expect(JSON.parse(opcoes.body)).toEqual({ usuario: 'admin', senha: 'admin123' });
  });

  test('token com credenciais erradas mostra o 401', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(401, { erro: 'Usuário ou senha inválidos' }));
    const saida = saidaFalsa();

    expect(await main(['token', '--usuario', 'admin', '--senha', 'errada'], { env: ENV, saida })).toBe(1);
    expect(saida.erro.mock.calls[0][0]).toContain('HTTP 401');
  });

  test('falha de rede retorna 1 com mensagem clara', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const saida = saidaFalsa();

    expect(await main(['health'], { env: ENV, saida })).toBe(1);
    expect(saida.erro).toHaveBeenCalledWith('Não foi possível falar com a API: ECONNREFUSED');
  });

  test('usa process.env e console por padrão', async () => {
    const espiaLog = jest.spyOn(console, 'log').mockImplementation(() => { });

    expect(await main(['ajuda'])).toBe(0);
    expect(espiaLog).toHaveBeenCalledWith(AJUDA);

    espiaLog.mockRestore();
  });
});

describe('indicadores (issue #12)', () => {
  const METRICAS = {
    status: { a_fazer: 2, fazendo: 1, feito: 3 },
    prioridade: { baixa: 1, media: 3, alta: 2 },
    prazos: { atrasadas: 1, no_prazo: 4 }
  };

  test('erro sem token: retorna 1 e exibe mensagem clara', async () => {
    const saida = saidaFalsa();

    expect(await main(['indicadores'], { env: ENV, saida })).toBe(1);
    expect(saida.erro.mock.calls[0][0]).toContain('Token não informado');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('sucesso com --token: exibe os 3 blocos de indicadores em texto', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(200, METRICAS));
    const saida = saidaFalsa();

    expect(await main(['indicadores', '--token', 'tk-valido'], { env: ENV, saida })).toBe(0);

    const [url, opcoes] = global.fetch.mock.calls[0];
    expect(url).toBe('http://api-teste:3000/api/cli/dashboard');
    expect(opcoes.headers.Authorization).toBe('Bearer tk-valido');

    const saida0 = saida.info.mock.calls[0][0];
    expect(saida0).toContain('Tarefas por Status:');
    expect(saida0).toContain('A Fazer: 2');
    expect(saida0).toContain('Fazendo: 1');
    expect(saida0).toContain('Feito: 3');
    expect(saida0).toContain('Tarefas por Prioridade:');
    expect(saida0).toContain('Baixa: 1');
    expect(saida0).toContain('Média: 3');
    expect(saida0).toContain('Alta: 2');
    expect(saida0).toContain('Tarefas por Prazo:');
    expect(saida0).toContain('Atrasadas: 1');
    expect(saida0).toContain('No Prazo: 4');
  });

  test('sucesso com TAREFAS_TOKEN no ambiente', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(200, METRICAS));
    const saida = saidaFalsa();

    expect(await main(['indicadores'], { env: { ...ENV, TAREFAS_TOKEN: 'tk-env' }, saida })).toBe(0);
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tk-env');
    expect(saida.info.mock.calls[0][0]).toContain('Tarefas por Status:');
  });

  test('alias "dashboard" funciona igual a "indicadores"', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(200, METRICAS));
    const saida = saidaFalsa();

    expect(await main(['dashboard', '--token', 'tk'], { env: ENV, saida })).toBe(0);
    expect(saida.info.mock.calls[0][0]).toContain('Tarefas por Status:');
  });

  test('erro 401 da API é exibido corretamente', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(401, { erro: 'Token inválido' }));
    const saida = saidaFalsa();

    expect(await main(['indicadores', '--token', 'invalido'], { env: ENV, saida })).toBe(1);
    expect(saida.erro.mock.calls[0][0]).toContain('HTTP 401');
  });

  test('"indicadores" aparece no texto de ajuda', async () => {
    const saida = saidaFalsa();

    expect(await main(['ajuda'], { env: ENV, saida })).toBe(0);
    expect(saida.info.mock.calls[0][0]).toContain('indicadores');
  });

  test('formatarIndicadores com métricas ausentes usa zeros', () => {
    const texto = formatarIndicadores(null);
    expect(texto).toContain('A Fazer: 0');
    expect(texto).toContain('Baixa: 0');
    expect(texto).toContain('Atrasadas: 0');
  });
});

describe('cadastro e edição pela CLI (issue #8)', () => {
  const ARGS = ['--titulo', 'Estudar Git', '--responsavel', 'Abner', '--prioridade', 'alta', '--status', 'a_fazer'];
  const TAREFA = { id: 7, titulo: 'Estudar Git', responsavel: 'Abner', prioridade: 'alta', status: 'a_fazer', prazo: null };

  test('montarTarefa envia só os campos informados', () => {
    expect(montarTarefa({ titulo: 'T', status: 'feito', token: 'x', verbose: true })).toEqual({ titulo: 'T', status: 'feito' });
  });

  test('formatarTarefa mostra todos os campos e trata prazo vazio', () => {
    expect(formatarTarefa(TAREFA)).toBe('#7 | Estudar Git | Abner | alta | a_fazer | sem prazo');
    expect(formatarTarefa({ ...TAREFA, prazo: '2026-11-20' })).toContain('| 2026-11-20');
  });

  test('mensagemDeErro lista os erros de validação por campo', () => {
    const texto = mensagemDeErro({ status: 400, dados: { erros: { titulo: 'Título é obrigatório' } } });
    expect(texto).toContain('HTTP 400');
    expect(texto).toContain('--titulo: Título é obrigatório');
  });

  test('criar envia POST /api/cli/records com Bearer do TAREFAS_TOKEN', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(201, TAREFA));
    const saida = saidaFalsa();

    expect(await main(['criar', ...ARGS, '--prazo', '2026-11-20'], { env: { ...ENV, TAREFAS_TOKEN: 'tk-env' }, saida })).toBe(0);

    const [url, opcoes] = global.fetch.mock.calls[0];
    expect(url).toBe('http://api-teste:3000/api/cli/records');
    expect(opcoes.method).toBe('POST');
    expect(opcoes.headers.Authorization).toBe('Bearer tk-env');
    expect(JSON.parse(opcoes.body)).toEqual({
      titulo: 'Estudar Git', responsavel: 'Abner', prioridade: 'alta', status: 'a_fazer', prazo: '2026-11-20'
    });
    expect(saida.info.mock.calls[0][0]).toContain('Tarefa criada: #7');
  });

  test('criar mostra os erros de validação da API', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(400, { erros: { prioridade: 'Prioridade deve ser baixa, media ou alta' } }));
    const saida = saidaFalsa();

    expect(await main(['criar', '--titulo', 'x', '--token', 'tk'], { env: ENV, saida })).toBe(1);
    expect(saida.erro.mock.calls[0][0]).toContain('--prioridade: Prioridade deve ser baixa, media ou alta');
  });

  test('criar sem token mostra o 401', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(401, { erro: 'Token não informado' }));
    const saida = saidaFalsa();

    expect(await main(['criar', ...ARGS], { env: ENV, saida })).toBe(1);
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(saida.erro.mock.calls[0][0]).toContain('HTTP 401');
  });

  test('editar exige --id', async () => {
    const saida = saidaFalsa();

    expect(await main(['editar', ...ARGS], { env: ENV, saida })).toBe(1);
    expect(saida.erro.mock.calls[0][0]).toContain('--id');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('editar envia PUT /api/cli/records/{id} com --token', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(200, { ...TAREFA, status: 'feito' }));
    const saida = saidaFalsa();

    expect(await main(['editar', '--id', '7', ...ARGS, '--token', 'tk-opcao'], { env: ENV, saida })).toBe(0);

    const [url, opcoes] = global.fetch.mock.calls[0];
    expect(url).toBe('http://api-teste:3000/api/cli/records/7');
    expect(opcoes.method).toBe('PUT');
    expect(opcoes.headers.Authorization).toBe('Bearer tk-opcao');
    expect(saida.info.mock.calls[0][0]).toContain('Tarefa atualizada: #7');
  });

  test('editar tarefa inexistente mostra o 404', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(404, { erro: 'Tarefa não encontrada' }));
    const saida = saidaFalsa();

    expect(await main(['editar', '--id', '99', ...ARGS, '--token', 'tk'], { env: ENV, saida })).toBe(1);
    expect(saida.erro).toHaveBeenCalledWith('Erro HTTP 404: Tarefa não encontrada');
  });
});

describe('listagem e exclusão pela CLI (issue #9)', () => {
  const PAGINA = {
    itens: [{ id: 1, titulo: 'Estudar Git', responsavel: 'Abner', prioridade: 'alta', status: 'a_fazer', prazo: null }],
    total: 6,
    page: 1,
    page_size: 5,
    total_pages: 2
  };

  test('montarConsultaListagem envia só as opções informadas', () => {
    expect(montarConsultaListagem({})).toBe('');
    expect(montarConsultaListagem({ page: '2', 'page-size': '10', sort: 'prazo', order: 'desc', token: 'x' }))
      .toBe('?page=2&page_size=10&sort=prazo&order=desc');
  });

  test('formatarListagem mostra cabeçalho, tarefas e resumo da paginação', () => {
    const texto = formatarListagem(PAGINA);
    expect(texto).toContain('ID | Título | Responsável | Prioridade | Status | Prazo');
    expect(texto).toContain('#1 | Estudar Git | Abner | alta | a_fazer | sem prazo');
    expect(texto).toContain('Página 1 de 2 (6 tarefas no total, 5 por página)');
  });

  test('formatarListagem avisa quando a página está vazia', () => {
    expect(formatarListagem({ ...PAGINA, itens: [], total: 0, total_pages: 1 })).toContain('Nenhuma tarefa nesta página.');
  });

  test('listar envia GET /api/cli/records com as opções e o Bearer', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(200, PAGINA));
    const saida = saidaFalsa();

    const codigo = await main(['listar', '--page', '1', '--page-size', '5', '--sort', 'titulo', '--order', 'asc', '--token', 'tk'], { env: ENV, saida });

    expect(codigo).toBe(0);
    const [url, opcoes] = global.fetch.mock.calls[0];
    expect(url).toBe('http://api-teste:3000/api/cli/records?page=1&page_size=5&sort=titulo&order=asc');
    expect(opcoes.method).toBe('GET');
    expect(opcoes.headers.Authorization).toBe('Bearer tk');
    expect(saida.info.mock.calls[0][0]).toContain('Página 1 de 2');
  });

  test('listar mostra o erro da API (401 sem token, 400 ordenação inválida)', async () => {
    global.fetch.mockResolvedValueOnce(respostaFalsa(401, { erro: 'Token não informado' }));
    const saida = saidaFalsa();
    expect(await main(['listar'], { env: ENV, saida })).toBe(1);
    expect(saida.erro.mock.calls[0][0]).toContain('HTTP 401');

    global.fetch.mockResolvedValueOnce(respostaFalsa(400, { erros: { sort: 'Ordenação deve ser id, titulo, responsavel, prioridade, status, prazo' } }));
    expect(await main(['listar', '--sort', 'senha', '--token', 'tk'], { env: ENV, saida })).toBe(1);
    expect(saida.erro.mock.calls[1][0]).toContain('--sort: Ordenação deve ser');
  });

  test('excluir exige --id', async () => {
    const saida = saidaFalsa();
    expect(await main(['excluir'], { env: ENV, saida })).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('excluir envia DELETE /api/cli/records/{id} e confirma com 204', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(204));
    const saida = saidaFalsa();

    expect(await main(['excluir', '--id', '3', '--token', 'tk'], { env: ENV, saida })).toBe(0);
    const [url, opcoes] = global.fetch.mock.calls[0];
    expect(url).toBe('http://api-teste:3000/api/cli/records/3');
    expect(opcoes.method).toBe('DELETE');
    expect(opcoes.headers.Authorization).toBe('Bearer tk');
    expect(saida.info).toHaveBeenCalledWith('Tarefa #3 excluída.');
  });

  test('excluir mostra 404 quando a tarefa não existe', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(404, { erro: 'Tarefa não encontrada' }));
    const saida = saidaFalsa();

    expect(await main(['excluir', '--id', '99', '--token', 'tk'], { env: ENV, saida })).toBe(1);
    expect(saida.erro.mock.calls[0][0]).toBe('Erro HTTP 404: Tarefa não encontrada');
  });

  test('a ajuda lista os comandos listar e excluir', () => {
    expect(AJUDA).toContain('listar [--page <n>] [--page-size <n>]');
    expect(AJUDA).toContain('excluir --id <n>');
  });
});

describe('comando exportar (issue #11)', () => {
  const CSV_EXEMPLO = 'id,titulo,responsavel,prioridade,status,prazo\r\n1,Tarefa 1,Italo,alta,a_fazer,2026-11-20\r\n';

  test('montarConsultaExportacao gera a query string com os filtros informados', () => {
    expect(montarConsultaExportacao({ status: 'a_fazer', prioridade: 'alta', responsavel: 'italo', extra: 'ignorar' }))
      .toBe('?status=a_fazer&prioridade=alta&responsavel=italo');
    expect(montarConsultaExportacao({}))
      .toBe('');
  });

  test('erro sem token: encerra com 1 e exibe mensagem em stderr', async () => {
    const saida = saidaFalsa();
    expect(await main(['exportar'], { env: {}, saida })).toBe(1);
    expect(saida.erro).toHaveBeenCalledWith('Token não informado. Use --token <token> ou defina TAREFAS_TOKEN.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('sucesso com --token e filtros: faz requisição GET e imprime CSV', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(200, CSV_EXEMPLO));
    const saida = saidaFalsa();

    const codigo = await main(
      ['exportar', '--status', 'a_fazer', '--prioridade', 'alta', '--responsavel', 'italo', '--token', 'tk-valido'],
      { env: ENV, saida }
    );

    expect(codigo).toBe(0);
    const [url, opcoes] = global.fetch.mock.calls[0];
    expect(url).toBe('http://api-teste:3000/api/cli/records/export?status=a_fazer&prioridade=alta&responsavel=italo');
    expect(opcoes.method).toBe('GET');
    expect(opcoes.headers.Authorization).toBe('Bearer tk-valido');
    expect(saida.info).toHaveBeenCalledWith(CSV_EXEMPLO);
  });

  test('sucesso usando TAREFAS_TOKEN do ambiente', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(200, CSV_EXEMPLO));
    const saida = saidaFalsa();

    const codigo = await main(['exportar'], { env: { ...ENV, TAREFAS_TOKEN: 'tk-env' }, saida });

    expect(codigo).toBe(0);
    const [url, opcoes] = global.fetch.mock.calls[0];
    expect(url).toBe('http://api-teste:3000/api/cli/records/export');
    expect(opcoes.headers.Authorization).toBe('Bearer tk-env');
    expect(saida.info).toHaveBeenCalledWith(CSV_EXEMPLO);
  });

  test('sucesso quando a API devolve corpo vazio', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(200, ''));
    const saida = saidaFalsa();

    const codigo = await main(['exportar', '--token', 'tk'], { env: ENV, saida });

    expect(codigo).toBe(0);
    expect(saida.info).toHaveBeenCalledWith('');
  });

  test('trata erro 401 da API', async () => {
    global.fetch.mockResolvedValue(respostaFalsa(401, { erro: 'Token inválido' }));
    const saida = saidaFalsa();

    expect(await main(['exportar', '--token', 'invalido'], { env: ENV, saida })).toBe(1);
    expect(saida.erro.mock.calls[0][0]).toContain('HTTP 401');
  });

  test('trata erro 400 da API com filtros inválidos', async () => {
    global.fetch.mockResolvedValue(
      respostaFalsa(400, { erros: { status: 'Status deve ser a_fazer, fazendo ou feito' } })
    );
    const saida = saidaFalsa();

    expect(await main(['exportar', '--status', 'invalido', '--token', 'tk'], { env: ENV, saida })).toBe(1);
    expect(saida.erro.mock.calls[0][0]).toContain('--status: Status deve ser a_fazer, fazendo ou feito');
  });

  test('a ajuda lista o comando exportar e seus filtros', () => {
    expect(AJUDA).toContain('exportar [--status <s>] [--prioridade <p>] [--responsavel <r>]');
    expect(AJUDA).toContain('Filtros da exportação:');
  });
});

