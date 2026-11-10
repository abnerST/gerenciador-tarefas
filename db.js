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

// ---------- Dashboard (issue #6): consultas agregadas de métricas ----------

async function obterMetricasDashboard(ctx) {
  const sql = `
    SELECT
      COUNT(*) FILTER (WHERE status = 'a_fazer') AS status_a_fazer,
      COUNT(*) FILTER (WHERE status = 'fazendo') AS status_fazendo,
      COUNT(*) FILTER (WHERE status = 'feito') AS status_feito,
      COUNT(*) FILTER (WHERE prioridade = 'baixa') AS prioridade_baixa,
      COUNT(*) FILTER (WHERE prioridade = 'media') AS prioridade_media,
      COUNT(*) FILTER (WHERE prioridade = 'alta') AS prioridade_alta,
      COUNT(*) FILTER (WHERE prazo IS NOT NULL AND prazo < CURRENT_DATE AND status != 'feito') AS prazos_atrasadas,
      COUNT(*) FILTER (WHERE prazo IS NOT NULL AND (prazo >= CURRENT_DATE OR status = 'feito')) AS prazos_no_prazo
    FROM tarefas
  `;
  const resultado = await executar(ctx, 'dashboard_metrics', 'Métricas do dashboard consultadas', sql, []);
  const linha = resultado.rows[0] || {};
  return {
    status: {
      a_fazer: Number(linha.status_a_fazer) || 0,
      fazendo: Number(linha.status_fazendo) || 0,
      feito: Number(linha.status_feito) || 0
    },
    prioridade: {
      baixa: Number(linha.prioridade_baixa) || 0,
      media: Number(linha.prioridade_media) || 0,
      alta: Number(linha.prioridade_alta) || 0
    },
    prazos: {
      atrasadas: Number(linha.prazos_atrasadas) || 0,
      no_prazo: Number(linha.prazos_no_prazo) || 0
    }
  };
}


// Expressões de ordenação permitidas; qualquer outro valor cai no padrão (id).
const ORDENACOES = {
  id: 'id',
  titulo: 'titulo',
  responsavel: 'responsavel',
  prioridade: "CASE prioridade WHEN 'baixa' THEN 1 WHEN 'media' THEN 2 ELSE 3 END",
  status: "CASE status WHEN 'a_fazer' THEN 1 WHEN 'fazendo' THEN 2 ELSE 3 END",
  prazo: 'prazo'
};

async function listarTarefas(opcoes, ctx) {
  let ordenacao = ORDENACOES.id;
  if (Object.hasOwn(ORDENACOES, opcoes.sort)) {
    ordenacao = ORDENACOES[opcoes.sort];
  }

  let direcao = 'ASC';
  if (opcoes.order === 'desc') {
    direcao = 'DESC';
  }

  const deslocamento = (opcoes.page - 1) * opcoes.pageSize;

  const sql = `
    SELECT id, titulo, responsavel, prioridade, status, TO_CHAR(prazo, 'YYYY-MM-DD') AS prazo
    FROM tarefas
    ORDER BY ${ordenacao} ${direcao}, id ASC
    LIMIT $1 OFFSET $2
  `;
  const pagina = await executar(ctx, 'select_tasks', 'Página de tarefas consultada', sql, [opcoes.pageSize, deslocamento]);
  const contagem = await executar(ctx, 'count_tasks', 'Total de tarefas contado', 'SELECT COUNT(*)::int AS total FROM tarefas', []);

  return {
    itens: pagina.rows,
    total: contagem.rows[0].total
  };
}

async function excluirTarefa(id, ctx) {
  const sql = 'DELETE FROM tarefas WHERE id = $1';
  const resultado = await executar(ctx, 'delete_task', 'Exclusão de tarefa executada', sql, [id]);
  return resultado.rowCount > 0;
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
  editarTarefaCli,
  obterMetricasDashboard,
  listarTarefas,
  excluirTarefa
};