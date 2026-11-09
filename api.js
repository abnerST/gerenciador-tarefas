const express = require('express');
const crypto = require('crypto');
const db = require('./db');

const PORTA = 3000;

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

app.get('/api/web/health', (req, res) => {
  logApi(req.ctx, 'health', 'success', 'Healthcheck web respondido');
  res.status(200).json({ status: 'ok' });
});

async function start() {
  const ctx = { request_id: 'startup', client: 'web' };
  await db.criarTabelas(ctx);
  const servidor = app.listen(PORTA, () => {
    logApi(ctx, 'startup', 'success', `API ouvindo na porta ${PORTA}`);
  });
  return servidor;
}

module.exports = { app, start, logApi, clienteDaRota };