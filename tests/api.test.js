jest.mock('../db', () => ({
  log: jest.fn(),
  criarTabelas: jest.fn(),
  salvarUsuarioInicial: jest.fn(),
  buscarUsuario: jest.fn(),
  criarTarefa: jest.fn(),
  atualizarTarefa: jest.fn(),
  inserirTarefaCli: jest.fn(),
  editarTarefaCli: jest.fn(),
  obterMetricasDashboard: jest.fn()
}));

process.env.JWT_SECRET = 'segredo-de-teste';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'senha-de-teste';

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { app, start, clienteDaRota, autenticar, validarTarefa, lerId } = require('../api');

let hashSenha;

beforeAll(async () => {
  hashSenha = await bcrypt.hash('senha-de-teste', 4);
});

beforeEach(() => {
  jest.clearAllMocks();
});

function logsDaApi() {
  return db.log.mock.calls.map((chamada) => chamada[0]);
}

describe('clienteDaRota', () => {
  test('identifica rotas da CLI e da Web', () => {
    expect(clienteDaRota('/api/cli/health')).toBe('cli');
    expect(clienteDaRota('/api/web/health')).toBe('web');
  });
});

describe('GET /api/web/health', () => {
  test('responde 200 sem autenticação, com request_id e log', async () => {
    const resposta = await request(app).get('/api/web/health');

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ status: 'ok' });
    expect(resposta.headers['x-request-id']).toBeDefined();
    expect(logsDaApi()[0]).toMatchObject({ layer: 'api', client: 'web', operation: 'health', status: 'success' });
  });
});

describe('POST /api/web/login', () => {
  test('401 sem usuário ou senha', async () => {
    const resposta = await request(app).post('/api/web/login').send({});

    expect(resposta.status).toBe(401);
    expect(logsDaApi()[0]).toMatchObject({ operation: 'login', status: 'error', level: 'WARN' });
  });

  test('401 quando o usuário não existe', async () => {
    db.buscarUsuario.mockResolvedValue(undefined);

    const resposta = await request(app).post('/api/web/login').send({ usuario: 'outro', senha: 'x' });

    expect(resposta.status).toBe(401);
  });

  test('401 com senha errada', async () => {
    db.buscarUsuario.mockResolvedValue({ id: 1, usuario: 'admin', senha_hash: hashSenha });

    const resposta = await request(app).post('/api/web/login').send({ usuario: 'admin', senha: 'errada' });

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro).toBe('Usuário ou senha inválidos');
  });

  test('200 com token válido e o mesmo request_id repassado ao banco', async () => {
    db.buscarUsuario.mockResolvedValue({ id: 1, usuario: 'admin', senha_hash: hashSenha });

    const resposta = await request(app).post('/api/web/login').send({ usuario: 'admin', senha: 'senha-de-teste' });

    expect(resposta.status).toBe(200);
    const dados = jwt.verify(resposta.body.token, 'segredo-de-teste');
    expect(dados.sub).toBe('admin');

    const ctxBanco = db.buscarUsuario.mock.calls[0][1];
    expect(ctxBanco.request_id).toBe(resposta.headers['x-request-id']);

    const textoDosLogs = JSON.stringify(logsDaApi());
    expect(textoDosLogs).not.toContain('senha-de-teste');
    expect(textoDosLogs).not.toContain(resposta.body.token);
  });

  test('500 quando o banco falha', async () => {
    db.buscarUsuario.mockRejectedValue(new Error('banco fora'));

    const resposta = await request(app).post('/api/web/login').send({ usuario: 'admin', senha: 'x' });

    expect(resposta.status).toBe(500);
    expect(logsDaApi()[0]).toMatchObject({ level: 'ERROR', status: 'error' });
  });
});

describe('autenticar', () => {
  function appProtegido() {
    const teste = express();
    teste.use((req, res, next) => {
      req.ctx = { request_id: 'req-teste-auth', client: 'web' };
      next();
    });
    teste.get('/protegido', autenticar, (req, res) => {
      res.json({ usuario: req.usuario });
    });
    return teste;
  }

  test('401 sem cabeçalho Authorization', async () => {
    const resposta = await request(appProtegido()).get('/protegido');
    expect(resposta.status).toBe(401);
  });

  test('401 com cabeçalho sem Bearer', async () => {
    const resposta = await request(appProtegido()).get('/protegido').set('Authorization', 'Basic abc');
    expect(resposta.status).toBe(401);
  });

  test('401 com token inválido', async () => {
    const resposta = await request(appProtegido()).get('/protegido').set('Authorization', 'Bearer token-invalido');
    expect(resposta.status).toBe(401);
  });

  test('libera a rota com token válido', async () => {
    const token = jwt.sign({ sub: 'admin' }, 'segredo-de-teste');

    const resposta = await request(appProtegido()).get('/protegido').set('Authorization', `Bearer ${token}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.usuario).toBe('admin');
  });
});

describe('GET /api/cli/health', () => {
  test('responde 200 sem autenticação, com log de client cli', async () => {
    const resposta = await request(app).get('/api/cli/health');

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ status: 'ok' });
    expect(logsDaApi()[0]).toMatchObject({ layer: 'api', client: 'cli', operation: 'health', status: 'success' });
  });
});

describe('POST /api/cli/token', () => {
  test('401 sem usuário ou senha', async () => {
    const resposta = await request(app).post('/api/cli/token').send({ usuario: 'admin' });

    expect(resposta.status).toBe(401);
    expect(logsDaApi()[0]).toMatchObject({ client: 'cli', operation: 'token', status: 'error', level: 'WARN' });
  });

  test('401 quando o usuário não existe', async () => {
    db.buscarUsuario.mockResolvedValue(undefined);

    const resposta = await request(app).post('/api/cli/token').send({ usuario: 'outro', senha: 'x' });

    expect(resposta.status).toBe(401);
  });

  test('401 com senha errada', async () => {
    db.buscarUsuario.mockResolvedValue({ id: 1, usuario: 'admin', senha_hash: hashSenha });

    const resposta = await request(app).post('/api/cli/token').send({ usuario: 'admin', senha: 'errada' });

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro).toBe('Usuário ou senha inválidos');
  });

  test('200 com token válido, client cli e o mesmo request_id repassado ao banco', async () => {
    db.buscarUsuario.mockResolvedValue({ id: 1, usuario: 'admin', senha_hash: hashSenha });

    const resposta = await request(app).post('/api/cli/token').send({ usuario: 'admin', senha: 'senha-de-teste' });

    expect(resposta.status).toBe(200);
    expect(jwt.verify(resposta.body.token, 'segredo-de-teste').sub).toBe('admin');

    const ctxBanco = db.buscarUsuario.mock.calls[0][1];
    expect(ctxBanco).toEqual({ request_id: resposta.headers['x-request-id'], client: 'cli' });
    expect(logsDaApi().pop()).toMatchObject({ client: 'cli', operation: 'token', status: 'success' });

    const textoDosLogs = JSON.stringify(logsDaApi());
    expect(textoDosLogs).not.toContain('senha-de-teste');
    expect(textoDosLogs).not.toContain(resposta.body.token);
  });

  test('500 quando o banco falha', async () => {
    db.buscarUsuario.mockRejectedValue(new Error('banco fora'));

    const resposta = await request(app).post('/api/cli/token').send({ usuario: 'admin', senha: 'x' });

    expect(resposta.status).toBe(500);
    expect(logsDaApi()[0]).toMatchObject({ level: 'ERROR', status: 'error', operation: 'token' });
  });
});

describe('rotas protegidas da CLI', () => {
  test('401 sem token em qualquer rota /api/cli que não seja health ou token', async () => {
    const resposta = await request(app).get('/api/cli/records');

    expect(resposta.status).toBe(401);
    expect(logsDaApi()[0]).toMatchObject({ client: 'cli', operation: 'auth', status: 'error' });
  });

  test('401 com token inválido', async () => {
    const resposta = await request(app).get('/api/cli/records').set('Authorization', 'Bearer invalido');

    expect(resposta.status).toBe(401);
  });

  test('com token válido passa pela autenticação', async () => {
    const token = jwt.sign({ sub: 'admin' }, 'segredo-de-teste');

    const resposta = await request(app).get('/api/cli/rota-inexistente').set('Authorization', `Bearer ${token}`);

    expect(resposta.status).toBe(404);
    expect(logsDaApi()[0]).toMatchObject({ client: 'cli', operation: 'auth', status: 'success' });
  });
});

describe('CLI — POST /api/cli/records e PUT /api/cli/records/:id (issue #8)', () => {
  const TAREFA = { titulo: 'Estudar Git', responsavel: 'Abner', prioridade: 'alta', status: 'a_fazer', prazo: '2026-11-20' };

  function tokenValido() {
    return `Bearer ${jwt.sign({ sub: 'admin' }, 'segredo-de-teste')}`;
  }

  test('401 sem token no cadastro e na edição', async () => {
    expect((await request(app).post('/api/cli/records').send(TAREFA)).status).toBe(401);
    expect((await request(app).put('/api/cli/records/1').send(TAREFA)).status).toBe(401);
    expect(db.inserirTarefaCli).not.toHaveBeenCalled();
    expect(db.editarTarefaCli).not.toHaveBeenCalled();
  });

  test('201 ao criar, com consulta própria da CLI e o mesmo request_id no banco', async () => {
    db.inserirTarefaCli.mockResolvedValue({ id: 7, ...TAREFA });

    const resposta = await request(app).post('/api/cli/records').set('Authorization', tokenValido()).send(TAREFA);

    expect(resposta.status).toBe(201);
    expect(resposta.body.id).toBe(7);
    expect(db.criarTarefa).not.toHaveBeenCalled();
    const [dados, ctx] = db.inserirTarefaCli.mock.calls[0];
    expect(dados).toEqual(TAREFA);
    expect(ctx).toEqual({ request_id: resposta.headers['x-request-id'], client: 'cli' });
    expect(logsDaApi().pop()).toMatchObject({ client: 'cli', operation: 'create', status: 'success' });
  });

  test('400 ao criar com dados inválidos, com as mesmas mensagens da Web', async () => {
    const resposta = await request(app).post('/api/cli/records').set('Authorization', tokenValido()).send({ prioridade: 'urgente' });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erros).toEqual(validarTarefa({ prioridade: 'urgente' }).erros);
    expect(db.inserirTarefaCli).not.toHaveBeenCalled();
    expect(logsDaApi().pop()).toMatchObject({ client: 'cli', operation: 'create', status: 'error', level: 'WARN' });
  });

  test('500 ao criar quando o banco falha', async () => {
    db.inserirTarefaCli.mockRejectedValue(new Error('banco fora'));

    const resposta = await request(app).post('/api/cli/records').set('Authorization', tokenValido()).send(TAREFA);

    expect(resposta.status).toBe(500);
    expect(logsDaApi().pop()).toMatchObject({ client: 'cli', operation: 'create', level: 'ERROR' });
  });

  test('200 ao editar, com consulta própria da CLI', async () => {
    db.editarTarefaCli.mockResolvedValue({ id: 3, ...TAREFA, status: 'feito' });

    const resposta = await request(app).put('/api/cli/records/3').set('Authorization', tokenValido()).send({ ...TAREFA, status: 'feito' });

    expect(resposta.status).toBe(200);
    expect(resposta.body.status).toBe('feito');
    expect(db.atualizarTarefa).not.toHaveBeenCalled();
    const [id, dados, ctx] = db.editarTarefaCli.mock.calls[0];
    expect(id).toBe(3);
    expect(dados.status).toBe('feito');
    expect(ctx.client).toBe('cli');
    expect(logsDaApi().pop()).toMatchObject({ client: 'cli', operation: 'update', status: 'success' });
  });

  test('400 ao editar com id inválido', async () => {
    const resposta = await request(app).put('/api/cli/records/abc').set('Authorization', tokenValido()).send(TAREFA);

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro).toBe('ID inválido');
  });

  test('400 ao editar com dados inválidos', async () => {
    const resposta = await request(app).put('/api/cli/records/3').set('Authorization', tokenValido()).send({ ...TAREFA, status: 'pronto' });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erros.status).toBeDefined();
    expect(db.editarTarefaCli).not.toHaveBeenCalled();
  });

  test('404 ao editar tarefa inexistente', async () => {
    db.editarTarefaCli.mockResolvedValue(null);

    const resposta = await request(app).put('/api/cli/records/99').set('Authorization', tokenValido()).send(TAREFA);

    expect(resposta.status).toBe(404);
    expect(logsDaApi().pop()).toMatchObject({ client: 'cli', operation: 'update', status: 'error' });
  });

  test('500 ao editar quando o banco falha', async () => {
    db.editarTarefaCli.mockRejectedValue(new Error('banco fora'));

    const resposta = await request(app).put('/api/cli/records/3').set('Authorization', tokenValido()).send(TAREFA);

    expect(resposta.status).toBe(500);
    expect(logsDaApi().pop()).toMatchObject({ client: 'cli', operation: 'update', level: 'ERROR' });
  });
});

describe('start', () => {
  test('cria tabelas, salva o usuário inicial com hash e sobe o servidor', async () => {
    const servidor = await start();
    await new Promise((resolve) => {
      if (servidor.listening) {
        resolve();
      } else {
        servidor.on('listening', resolve);
      }
    });

    expect(db.criarTabelas).toHaveBeenCalled();
    const [usuario, hash] = db.salvarUsuarioInicial.mock.calls[0];
    expect(usuario).toBe('admin');
    expect(hash).not.toBe('senha-de-teste');
    expect(await bcrypt.compare('senha-de-teste', hash)).toBe(true);
    expect(logsDaApi().some((linha) => linha.operation === 'startup')).toBe(true);

    await new Promise((resolve) => servidor.close(resolve));
  });
});

const TOKEN = jwt.sign({ sub: 'admin' }, 'segredo-de-teste');

describe('lerId', () => {
  test('converte string de inteiro positivo em número', () => {
    expect(lerId('1')).toBe(1);
    expect(lerId('42')).toBe(42);
  });

  test('retorna null para valores não numéricos ou não inteiros positivos', () => {
    expect(lerId('abc')).toBeNull();
    expect(lerId('0')).toBeNull();
    expect(lerId('-1')).toBeNull();
    expect(lerId('1.5')).toBeNull();
    expect(lerId('')).toBeNull();
  });
});

describe('validarTarefa', () => {
  test('dados válidos com prazo preenchido', () => {
    const { dados, erros } = validarTarefa({
      titulo: ' Minha Tarefa ',
      responsavel: ' Responsavel ',
      prioridade: 'alta',
      status: 'a_fazer',
      prazo: '2026-11-20'
    });
    expect(erros).toEqual({});
    expect(dados).toEqual({
      titulo: 'Minha Tarefa',
      responsavel: 'Responsavel',
      prioridade: 'alta',
      status: 'a_fazer',
      prazo: '2026-11-20'
    });
  });

  test('prazo vazio ou ausente vira null', () => {
    const r1 = validarTarefa({
      titulo: 'T',
      responsavel: 'R',
      prioridade: 'baixa',
      status: 'feito',
      prazo: ''
    });
    expect(r1.erros).toEqual({});
    expect(r1.dados.prazo).toBeNull();

    const r2 = validarTarefa({
      titulo: 'T',
      responsavel: 'R',
      prioridade: 'baixa',
      status: 'feito',
      prazo: '   '
    });
    expect(r2.erros).toEqual({});
    expect(r2.dados.prazo).toBeNull();

    const r3 = validarTarefa({
      titulo: 'T',
      responsavel: 'R',
      prioridade: 'baixa',
      status: 'feito'
    });
    expect(r3.erros).toEqual({});
    expect(r3.dados.prazo).toBeNull();
  });

  test('cada campo obrigatório ausente gera erro', () => {
    const { erros } = validarTarefa({});
    expect(erros.titulo).toBe('Título é obrigatório');
    expect(erros.responsavel).toBe('Responsável é obrigatório');
    expect(erros.prioridade).toBe('Prioridade deve ser baixa, media ou alta');
    expect(erros.status).toBe('Status deve ser a_fazer, fazendo ou feito');

    const resNulo = validarTarefa(null);
    expect(resNulo.erros.titulo).toBe('Título é obrigatório');
  });

  test('título vazio ou acima de 120 caracteres', () => {
    const rVazio = validarTarefa({ titulo: '   ' });
    expect(rVazio.erros.titulo).toBe('Título é obrigatório');

    const rLongo = validarTarefa({ titulo: 'a'.repeat(121) });
    expect(rLongo.erros.titulo).toBe('Título deve ter no máximo 120 caracteres');
  });

  test('responsável vazio ou acima de 80 caracteres', () => {
    const rVazio = validarTarefa({ responsavel: '   ' });
    expect(rVazio.erros.responsavel).toBe('Responsável é obrigatório');

    const rLongo = validarTarefa({ responsavel: 'b'.repeat(81) });
    expect(rLongo.erros.responsavel).toBe('Responsável deve ter no máximo 80 caracteres');
  });

  test('prioridade inválida', () => {
    const { erros } = validarTarefa({ prioridade: 'urgente' });
    expect(erros.prioridade).toBe('Prioridade deve ser baixa, media ou alta');
  });

  test('status inválido', () => {
    const { erros } = validarTarefa({ status: 'cancelado' });
    expect(erros.status).toBe('Status deve ser a_fazer, fazendo ou feito');
  });

  test('prazo com formato inválido, data inválida ou tipo não string', () => {
    const rFormato = validarTarefa({ prazo: '20-11-2026' });
    expect(rFormato.erros.prazo).toBe('Prazo deve estar no formato YYYY-MM-DD');

    const rDataInvalida = validarTarefa({ prazo: '2026-02-31' });
    expect(rDataInvalida.erros.prazo).toBe('Prazo deve ser uma data válida');

    const rTipo = validarTarefa({ prazo: 12345 });
    expect(rTipo.erros.prazo).toBe('Prazo deve estar no formato YYYY-MM-DD');
  });
});

describe('POST /api/web/records', () => {
  const dadosValidos = {
    titulo: 'Nova Tarefa',
    responsavel: 'Italo',
    prioridade: 'alta',
    status: 'a_fazer',
    prazo: '2026-11-20'
  };

  test('401 sem token', async () => {
    const resposta = await request(app)
      .post('/api/web/records')
      .send(dadosValidos);

    expect(resposta.status).toBe(401);
  });

  test('400 com dados inválidos', async () => {
    const resposta = await request(app)
      .post('/api/web/records')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(resposta.status).toBe(400);
    expect(resposta.body.erros).toBeDefined();
    expect(resposta.body.erros.titulo).toBeDefined();
    expect(logsDaApi().some((l) => l.operation === 'create' && l.status === 'error' && l.level === 'WARN')).toBe(true);
  });

  test('201 com dados válidos e mesmo request_id repassado ao banco', async () => {
    const tarefaCriada = { id: 1, ...dadosValidos };
    db.criarTarefa.mockResolvedValue(tarefaCriada);

    const resposta = await request(app)
      .post('/api/web/records')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(dadosValidos);

    expect(resposta.status).toBe(201);
    expect(resposta.body).toEqual(tarefaCriada);

    const ctxBanco = db.criarTarefa.mock.calls[0][1];
    expect(ctxBanco.request_id).toBe(resposta.headers['x-request-id']);
    expect(logsDaApi().some((l) => l.operation === 'create' && l.status === 'success')).toBe(true);
  });

  test('500 com falha do banco', async () => {
    db.criarTarefa.mockRejectedValue(new Error('erro no banco'));

    const resposta = await request(app)
      .post('/api/web/records')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(dadosValidos);

    expect(resposta.status).toBe(500);
    expect(resposta.body.erro).toBe('Erro interno');
    expect(logsDaApi().some((l) => l.operation === 'create' && l.status === 'error' && l.level === 'ERROR')).toBe(true);
  });
});

describe('PUT /api/web/records/:id', () => {
  const dadosValidos = {
    titulo: 'Tarefa Alterada',
    responsavel: 'Italo',
    prioridade: 'media',
    status: 'fazendo',
    prazo: '2026-11-25'
  };

  test('401 sem token', async () => {
    const resposta = await request(app)
      .put('/api/web/records/1')
      .send(dadosValidos);

    expect(resposta.status).toBe(401);
  });

  test('400 com id inválido', async () => {
    const resposta = await request(app)
      .put('/api/web/records/invalido')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(dadosValidos);

    expect(resposta.status).toBe(400);
    expect(resposta.body.erro).toBe('ID inválido');
    expect(logsDaApi().some((l) => l.operation === 'update' && l.status === 'error' && l.level === 'WARN')).toBe(true);
  });

  test('400 com dados inválidos', async () => {
    const resposta = await request(app)
      .put('/api/web/records/1')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ titulo: '' });

    expect(resposta.status).toBe(400);
    expect(resposta.body.erros).toBeDefined();
    expect(logsDaApi().some((l) => l.operation === 'update' && l.status === 'error' && l.level === 'WARN')).toBe(true);
  });

  test('404 com tarefa inexistente', async () => {
    db.atualizarTarefa.mockResolvedValue(null);

    const resposta = await request(app)
      .put('/api/web/records/999')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(dadosValidos);

    expect(resposta.status).toBe(404);
    expect(resposta.body.erro).toBe('Tarefa não encontrada');
    expect(logsDaApi().some((l) => l.operation === 'update' && l.status === 'error' && l.level === 'WARN')).toBe(true);
  });

  test('200 com sucesso e mesmo request_id repassado ao banco', async () => {
    const tarefaAtualizada = { id: 1, ...dadosValidos };
    db.atualizarTarefa.mockResolvedValue(tarefaAtualizada);

    const resposta = await request(app)
      .put('/api/web/records/1')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(dadosValidos);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual(tarefaAtualizada);

    const ctxBanco = db.atualizarTarefa.mock.calls[0][2];
    expect(ctxBanco.request_id).toBe(resposta.headers['x-request-id']);
    expect(logsDaApi().some((l) => l.operation === 'update' && l.status === 'success')).toBe(true);
  });

  test('500 com falha do banco', async () => {
    db.atualizarTarefa.mockRejectedValue(new Error('falha db'));

    const resposta = await request(app)
      .put('/api/web/records/1')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(dadosValidos);

    expect(resposta.status).toBe(500);
    expect(resposta.body.erro).toBe('Erro interno');
    expect(logsDaApi().some((l) => l.operation === 'update' && l.status === 'error' && l.level === 'ERROR')).toBe(true);
  });
});

describe('GET /api/web/dashboard (issue #6)', () => {
  const metricasExemplo = {
    status: { a_fazer: 2, fazendo: 1, feito: 3 },
    prioridade: { baixa: 1, media: 3, alta: 2 },
    prazos: { atrasadas: 1, no_prazo: 4 }
  };

  test('401 sem token', async () => {
    const resposta = await request(app).get('/api/web/dashboard');

    expect(resposta.status).toBe(401);
    expect(resposta.body.erro).toBe('Token não informado');
    expect(logsDaApi().some((l) => l.operation === 'auth' && l.status === 'error' && l.level === 'WARN')).toBe(true);
  });

  test('200 com métricas e correlação de request_id', async () => {
    db.obterMetricasDashboard.mockResolvedValue(metricasExemplo);

    const resposta = await request(app)
      .get('/api/web/dashboard')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual(metricasExemplo);

    const ctxBanco = db.obterMetricasDashboard.mock.calls[0][0];
    expect(ctxBanco.request_id).toBe(resposta.headers['x-request-id']);
    expect(ctxBanco.client).toBe('web');

    expect(logsDaApi().some((l) => l.operation === 'dashboard' && l.status === 'success' && l.request_id === resposta.headers['x-request-id'])).toBe(true);
  });

  test('500 em falha do banco', async () => {
    db.obterMetricasDashboard.mockRejectedValue(new Error('falha de conexão ao banco'));

    const resposta = await request(app)
      .get('/api/web/dashboard')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(resposta.status).toBe(500);
    expect(resposta.body.erro).toBe('Erro interno');
    expect(logsDaApi().some((l) => l.operation === 'dashboard' && l.status === 'error' && l.level === 'ERROR')).toBe(true);
  });
});