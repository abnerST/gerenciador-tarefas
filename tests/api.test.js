jest.mock('../db', () => ({
  log: jest.fn(),
  criarTabelas: jest.fn(),
  salvarUsuarioInicial: jest.fn(),
  buscarUsuario: jest.fn()
}));

process.env.JWT_SECRET = 'segredo-de-teste';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'senha-de-teste';

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { app, start, clienteDaRota, autenticar } = require('../api');

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