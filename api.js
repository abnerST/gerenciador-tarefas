const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const PORTA = 3000;
const VALIDADE_TOKEN = '8h';

const app = express();
app.use(express.json());

function clienteDaRota(caminho) {
  if (caminho.startsWith('/api/cli')) {
    return 'cli';
  }
  return 'web';
}

// Gera um request_id por requisição; o mesmo valor é repassado ao db.js.
app.use((req, res, next) => {
  req.ctx = {
    request_id: crypto.randomUUID(),
    client: clienteDaRota(req.path)
  };
  res.setHeader('X-Request-Id', req.ctx.request_id);
  next();
});

function logApi(ctx, operation, status, message, level) {
  db.log({
    level,
    layer: 'api',
    client: ctx.client,
    operation,
    status,
    request_id: ctx.request_id,
    message
  });
}

// Middleware de autenticação reaproveitado pelas rotas protegidas (Web e CLI).
function autenticar(req, res, next) {
  const cabecalho = req.headers.authorization;
  if (!cabecalho || !cabecalho.startsWith('Bearer ')) {
    logApi(req.ctx, 'auth', 'error', 'Requisição sem token', 'WARN');
    return res.status(401).json({ erro: 'Token não informado' });
  }

  const token = cabecalho.slice('Bearer '.length);
  try {
    const dados = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = dados.sub;
    logApi(req.ctx, 'auth', 'success', 'Token validado');
    return next();
  } catch (erro) {
    logApi(req.ctx, 'auth', 'error', 'Token inválido ou expirado', 'WARN');
    return res.status(401).json({ erro: 'Token inválido' });
  }
}

app.get('/api/web/health', (req, res) => {
  logApi(req.ctx, 'health', 'success', 'Healthcheck web respondido');
  res.status(200).json({ status: 'ok' });
});

app.post('/api/web/login', async (req, res) => {
  const ctx = req.ctx;
  const usuario = req.body.usuario;
  const senha = req.body.senha;

  if (!usuario || !senha) {
    logApi(ctx, 'login', 'error', 'Login sem usuário ou senha', 'WARN');
    return res.status(401).json({ erro: 'Usuário e senha são obrigatórios' });
  }

  try {
    const registro = await db.buscarUsuario(usuario, ctx);
    let valido = false;
    if (registro) {
      valido = await bcrypt.compare(senha, registro.senha_hash);
    }

    if (!valido) {
      logApi(ctx, 'login', 'error', 'Credenciais inválidas', 'WARN');
      return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
    }

    const token = jwt.sign({ sub: registro.usuario }, process.env.JWT_SECRET, {
      expiresIn: VALIDADE_TOKEN
    });
    logApi(ctx, 'login', 'success', 'Login realizado');
    return res.status(200).json({ token });
  } catch (erro) {
    logApi(ctx, 'login', 'error', 'Erro interno no login', 'ERROR');
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// ---------- CLI (issue #7) ----------

app.get('/api/cli/health', (req, res) => {
  logApi(req.ctx, 'health', 'success', 'Healthcheck cli respondido');
  res.status(200).json({ status: 'ok' });
});

app.post('/api/cli/token', async (req, res) => {
  const ctx = req.ctx;
  const usuario = req.body.usuario;
  const senha = req.body.senha;

  if (!usuario || !senha) {
    logApi(ctx, 'token', 'error', 'Pedido de token sem usuário ou senha', 'WARN');
    return res.status(401).json({ erro: 'Usuário e senha são obrigatórios' });
  }

  try {
    const registro = await db.buscarUsuario(usuario, ctx);
    let valido = false;
    if (registro) {
      valido = await bcrypt.compare(senha, registro.senha_hash);
    }

    if (!valido) {
      logApi(ctx, 'token', 'error', 'Credenciais inválidas na CLI', 'WARN');
      return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
    }

    const token = jwt.sign({ sub: registro.usuario }, process.env.JWT_SECRET, {
      expiresIn: VALIDADE_TOKEN
    });
    logApi(ctx, 'token', 'success', 'Token da CLI emitido');
    return res.status(200).json({ token });
  } catch (erro) {
    logApi(ctx, 'token', 'error', 'Erro interno ao emitir token', 'ERROR');
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// Todo o restante de /api/cli exige Bearer token (healthcheck e token ficam públicos acima).
app.use('/api/cli', autenticar);

async function start() {
  const ctx = { request_id: 'startup', client: 'web' };
  await db.criarTabelas(ctx);

  const senhaHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
  await db.salvarUsuarioInicial(process.env.ADMIN_USER, senhaHash, ctx);

  const servidor = app.listen(PORTA, () => {
    logApi(ctx, 'startup', 'success', `API ouvindo na porta ${PORTA}`);
  });
  return servidor;
}

module.exports = { app, start, logApi, clienteDaRota, autenticar };