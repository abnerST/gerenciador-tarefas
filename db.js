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


// Indicadores da CLI (issue #12): consulta própria, com a mesma regra do dashboard Web.
async function obterMetricasDashboardCli(ctx) {
  const sql = `
    SELECT
      SUM(CASE WHEN status = 'a_fazer' THEN 1 ELSE 0 END)::int AS a_fazer,
      SUM(CASE WHEN status = 'fazendo' THEN 1 ELSE 0 END)::int AS fazendo,
      SUM(CASE WHEN status = 'feito' THEN 1 ELSE 0 END)::int AS feito,
      SUM(CASE WHEN prioridade = 'baixa' THEN 1 ELSE 0 END)::int AS baixa,
      SUM(CASE WHEN prioridade = 'media' THEN 1 ELSE 0 END)::int AS media,
      SUM(CASE WHEN prioridade = 'alta' THEN 1 ELSE 0 END)::int AS alta,
      SUM(CASE WHEN prazo IS NOT NULL AND prazo < CURRENT_DATE AND status <> 'feito' THEN 1 ELSE 0 END)::int AS atrasadas,
      SUM(CASE WHEN prazo IS NOT NULL AND (prazo >= CURRENT_DATE OR status = 'feito') THEN 1 ELSE 0 END)::int AS no_prazo
    FROM tarefas
  `;
  const resultado = await executar(ctx, 'cli_dashboard_metrics', 'Indicadores da CLI consultados', sql, []);
  const linha = resultado.rows[0];
  return {
    status: {
      a_fazer: Number(linha.a_fazer),
      fazendo: Number(linha.fazendo),
      feito: Number(linha.feito)
    },
    prioridade: {
      baixa: Number(linha.baixa),
      media: Number(linha.media),
      alta: Number(linha.alta)
    },
    prazos: {
      atrasadas: Number(linha.atrasadas),
      no_prazo: Number(linha.no_prazo)
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

// Busca avançada (issue #4): monta o WHERE só com os filtros informados, sempre com parâmetros ($1, $2...).
function montarFiltrosBusca(filtros) {
  const condicoes = [];
  const params = [];

  if (filtros.status) {
    params.push(filtros.status);
    condicoes.push(`status = $${params.length}`);
  }
  if (filtros.prioridade) {
    params.push(filtros.prioridade);
    condicoes.push(`prioridade = $${params.length}`);
  }
  if (filtros.responsavel) {
    params.push(`%${filtros.responsavel}%`);
    condicoes.push(`responsavel ILIKE $${params.length}`);
  }

  let where = '';
  if (condicoes.length > 0) {
    where = 'WHERE ' + condicoes.join(' AND ');
  }
  return { where, params };
}

async function buscarTarefas(filtros, opcoes, ctx) {
  let ordenacao = ORDENACOES.id;
  if (Object.hasOwn(ORDENACOES, opcoes.sort)) {
    ordenacao = ORDENACOES[opcoes.sort];
  }

  let direcao = 'ASC';
  if (opcoes.order === 'desc') {
    direcao = 'DESC';
  }

  const { where, params } = montarFiltrosBusca(filtros);
  const deslocamento = (opcoes.page - 1) * opcoes.pageSize;
  const posLimite = params.length + 1;
  const posDeslocamento = params.length + 2;

  const sql = `
    SELECT id, titulo, responsavel, prioridade, status, TO_CHAR(prazo, 'YYYY-MM-DD') AS prazo
    FROM tarefas
    ${where}
    ORDER BY ${ordenacao} ${direcao}, id ASC
    LIMIT $${posLimite} OFFSET $${posDeslocamento}
  `;
  const pagina = await executar(ctx, 'search_tasks', 'Busca de tarefas executada', sql, params.concat([opcoes.pageSize, deslocamento]));
  const contagem = await executar(ctx, 'count_search_tasks', 'Total da busca contado', `SELECT COUNT(*)::int AS total FROM tarefas ${where}`, params);

  return {
    itens: pagina.rows,
    total: contagem.rows[0].total
  };
}

// Exportação CSV (issue #5): mesmos filtros da busca, mas sem paginação — devolve todos os resultados.
async function exportarTarefas(filtros, opcoes, ctx) {
  let ordenacao = ORDENACOES.id;
  if (Object.hasOwn(ORDENACOES, opcoes.sort)) {
    ordenacao = ORDENACOES[opcoes.sort];
  }

  let direcao = 'ASC';
  if (opcoes.order === 'desc') {
    direcao = 'DESC';
  }

  const { where, params } = montarFiltrosBusca(filtros);
  const sql = `
    SELECT id, titulo, responsavel, prioridade, status, TO_CHAR(prazo, 'YYYY-MM-DD') AS prazo
    FROM tarefas
    ${where}
    ORDER BY ${ordenacao} ${direcao}, id ASC
  `;
  const resultado = await executar(ctx, 'export_tasks', 'Tarefas consultadas para exportação CSV', sql, params);
  return resultado.rows;
}

async function excluirTarefa(id, ctx) {
  const sql = 'DELETE FROM tarefas WHERE id = $1';
  const resultado = await executar(ctx, 'delete_task', 'Exclusão de tarefa executada', sql, [id]);
  return resultado.rowCount > 0;
}

// Listagem e exclusão pela CLI (issue #9): consultas próprias da CLI, com a mesma regra de ordenação da Web.
async function listarTarefasCli(opcoes, ctx) {
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
  const pagina = await executar(ctx, 'cli_select_tasks', 'Página de tarefas consultada pela CLI', sql, [opcoes.pageSize, deslocamento]);
  const contagem = await executar(ctx, 'cli_count_tasks', 'Total de tarefas contado pela CLI', 'SELECT COUNT(*)::int AS total FROM tarefas', []);

  return {
    itens: pagina.rows,
    total: contagem.rows[0].total
  };
}

async function excluirTarefaCli(id, ctx) {
  const sql = 'DELETE FROM tarefas WHERE id = $1 RETURNING id';
  const resultado = await executar(ctx, 'cli_delete_task', 'Exclusão de tarefa executada pela CLI', sql, [id]);
  return resultado.rowCount > 0;
}

async function exportarTarefasCli(filtros, ordenacao, ctx) {
  const condicoes = [];
  const params = [];

  if (filtros && filtros.status) {
    params.push(filtros.status);
    condicoes.push(`status = $${params.length}`);
  }

  if (filtros && filtros.prioridade) {
    params.push(filtros.prioridade);
    condicoes.push(`prioridade = $${params.length}`);
  }

  if (filtros && filtros.responsavel) {
    params.push(`%${filtros.responsavel}%`);
    condicoes.push(`responsavel ILIKE $${params.length}`);
  }

  let where = '';
  if (condicoes.length > 0) {
    where = `WHERE ${condicoes.join(' AND ')}`;
  }

  let coluna = ORDENACOES.id;
  if (ordenacao && Object.hasOwn(ORDENACOES, ordenacao.sort)) {
    coluna = ORDENACOES[ordenacao.sort];
  }

  let direcao = 'ASC';
  if (ordenacao && ordenacao.order === 'desc') {
    direcao = 'DESC';
  }

  const sql = `
    SELECT id, titulo, responsavel, prioridade, status, TO_CHAR(prazo, 'YYYY-MM-DD') AS prazo
    FROM tarefas
    ${where}
    ORDER BY ${coluna} ${direcao}, id ASC
  `;

  const resultado = await executar(ctx, 'cli_export_tasks', 'Tarefas exportadas pela CLI', sql, params);
  return resultado.rows;
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
  obterMetricasDashboardCli,
  listarTarefas,
  buscarTarefas,
  exportarTarefas,
  excluirTarefa,
  listarTarefasCli,
  excluirTarefaCli,
  exportarTarefasCli
};