const { Pool } = require('pg');

// A conexão usa as variáveis PGHOST, PGUSER, PGPASSWORD, PGDATABASE e PGPORT do Compose.
const pool = new Pool();

function log(entrada) {
  let level = 'INFO';
  if (entrada.level) {
    level = entrada.level;
  }

  const linha = {
    timestamp: new Date().toISOString(),
    level,
    layer: entrada.layer,
    client: entrada.client,
    operation: entrada.operation,
    status: entrada.status,
    request_id: entrada.request_id,
    message: entrada.message
  };

  console.log(JSON.stringify(linha));
}

async function executar(ctx, operation, mensagem, sql, params) {
  try {
    const resultado = await pool.query(sql, params);
    log({
      layer: 'db',
      client: ctx.client,
      operation,
      status: 'success',
      request_id: ctx.request_id,
      message: mensagem
    });
    return resultado;
  } catch (erro) {
    log({
      level: 'ERROR',
      layer: 'db',
      client: ctx.client,
      operation,
      status: 'error',
      request_id: ctx.request_id,
      message: `Falha na operação ${operation}`
    });
    throw erro;
  }
}

async function criarTabelas(ctx) {
  const sql = `
    CREATE TABLE IF NOT EXISTS tarefas (
      id SERIAL PRIMARY KEY,
      titulo VARCHAR(120) NOT NULL,
      responsavel VARCHAR(80) NOT NULL,
      prioridade VARCHAR(10) NOT NULL CHECK (prioridade IN ('baixa', 'media', 'alta')),
      status VARCHAR(10) NOT NULL CHECK (status IN ('a_fazer', 'fazendo', 'feito')),
      prazo DATE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      usuario VARCHAR(80) UNIQUE NOT NULL,
      senha_hash VARCHAR(100) NOT NULL
    );
  `;
  await executar(ctx, 'create_tables', 'Tabelas verificadas', sql, []);
}

async function salvarUsuarioInicial(usuario, senhaHash, ctx) {
  const sql = `
    INSERT INTO usuarios (usuario, senha_hash)
    VALUES ($1, $2)
    ON CONFLICT (usuario) DO UPDATE SET senha_hash = EXCLUDED.senha_hash
  `;
  await executar(ctx, 'upsert_user', 'Usuário inicial configurado', sql, [usuario, senhaHash]);
}

async function buscarUsuario(usuario, ctx) {
  const sql = 'SELECT id, usuario, senha_hash FROM usuarios WHERE usuario = $1';
  const resultado = await executar(ctx, 'select_user', 'Consulta de usuário executada', sql, [usuario]);
  return resultado.rows[0];
}

async function criarTarefa(dados, ctx) {
  const sql = `
    INSERT INTO tarefas (titulo, responsavel, prioridade, status, prazo)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, titulo, responsavel, prioridade, status, TO_CHAR(prazo, 'YYYY-MM-DD') AS prazo
  `;
  const params = [
    dados.titulo,
    dados.responsavel,
    dados.prioridade,
    dados.status,
    dados.prazo
  ];
  const resultado = await executar(ctx, 'insert_task', 'Tarefa cadastrada', sql, params);
  return resultado.rows[0];
}

async function atualizarTarefa(id, dados, ctx) {
  const sql = `
    UPDATE tarefas
    SET titulo = $1, responsavel = $2, prioridade = $3, status = $4, prazo = $5
    WHERE id = $6
    RETURNING id, titulo, responsavel, prioridade, status, TO_CHAR(prazo, 'YYYY-MM-DD') AS prazo
  `;
  const params = [
    dados.titulo,
    dados.responsavel,
    dados.prioridade,
    dados.status,
    dados.prazo,
    id
  ];
  const resultado = await executar(ctx, 'update_task', 'Tarefa atualizada', sql, params);
  return resultado.rows[0] || null;
}

// ---------- CLI (issue #8): consultas próprias de cadastro e edição ----------

async function inserirTarefaCli(dados, ctx) {
  const sql = `
    INSERT INTO tarefas (titulo, responsavel, prioridade, status, prazo)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, titulo, responsavel, prioridade, status, TO_CHAR(prazo, 'YYYY-MM-DD') AS prazo
  `;
  const params = [dados.titulo, dados.responsavel, dados.prioridade, dados.status, dados.prazo];
  const resultado = await executar(ctx, 'insert_task', 'Tarefa cadastrada pela CLI', sql, params);
  return resultado.rows[0];
}

async function editarTarefaCli(id, dados, ctx) {
  const sql = `
    UPDATE tarefas
    SET titulo = $1, responsavel = $2, prioridade = $3, status = $4, prazo = $5
    WHERE id = $6
    RETURNING id, titulo, responsavel, prioridade, status, TO_CHAR(prazo, 'YYYY-MM-DD') AS prazo
  `;
  const params = [dados.titulo, dados.responsavel, dados.prioridade, dados.status, dados.prazo, id];
  const resultado = await executar(ctx, 'update_task', 'Tarefa atualizada pela CLI', sql, params);
  return resultado.rows[0] || null;
}

module.exports = {
  pool,
  log,
  executar,
  criarTabelas,
  salvarUsuarioInicial,
  buscarUsuario,
  criarTarefa,
  atualizarTarefa,
  inserirTarefaCli,
  editarTarefaCli
};