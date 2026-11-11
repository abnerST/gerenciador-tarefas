const { main, lerArgumentos, obterToken, chamarApi, mensagemDeErro, AJUDA } = require('../cli');

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
