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

// Converte um valor da query string em inteiro positivo, usando o padrão quando inválido.
function inteiroPositivo(valor, padrao, maximo) {
  const numero = Number.parseInt(valor, 10);
  if (Number.isNaN(numero) || numero < 1) {
    return padrao;
  }
  if (numero > maximo) {
    return maximo;
  }
  return numero;
}

// Lê o {id} da rota; devolve null quando não for um inteiro positivo.
function lerId(texto) {
  if (!/^\d+$/.test(texto)) {
    return null;
  }
  const id = Number.parseInt(texto, 10);
  if (id < 1) {
    return null;
  }
  return id;
}

function validarTarefa(corpo) {
  const dadosEntrada = corpo || {};
  const erros = {};
  const dados = {};

  if (typeof dadosEntrada.titulo !== 'string' || dadosEntrada.titulo.trim() === '') {
    erros.titulo = 'Título é obrigatório';
  } else if (dadosEntrada.titulo.trim().length > 120) {
    erros.titulo = 'Título deve ter no máximo 120 caracteres';
  } else {
    dados.titulo = dadosEntrada.titulo.trim();
  }

  if (typeof dadosEntrada.responsavel !== 'string' || dadosEntrada.responsavel.trim() === '') {
    erros.responsavel = 'Responsável é obrigatório';
  } else if (dadosEntrada.responsavel.trim().length > 80) {
    erros.responsavel = 'Responsável deve ter no máximo 80 caracteres';
  } else {
    dados.responsavel = dadosEntrada.responsavel.trim();
  }

  const prioridadesValidas = ['baixa', 'media', 'alta'];
  if (!dadosEntrada.prioridade || !prioridadesValidas.includes(dadosEntrada.prioridade)) {
    erros.prioridade = 'Prioridade deve ser baixa, media ou alta';
  } else {
    dados.prioridade = dadosEntrada.prioridade;
  }

  const statusValidos = ['a_fazer', 'fazendo', 'feito'];
  if (!dadosEntrada.status || !statusValidos.includes(dadosEntrada.status)) {
    erros.status = 'Status deve ser a_fazer, fazendo ou feito';
  } else {
    dados.status = dadosEntrada.status;
  }

  if (dadosEntrada.prazo === undefined || dadosEntrada.prazo === null || dadosEntrada.prazo === '') {
    dados.prazo = null;
  } else if (typeof dadosEntrada.prazo === 'string') {
    const prazoStr = dadosEntrada.prazo.trim();
    if (prazoStr === '') {
      dados.prazo = null;
    } else {
      const formatoValido = /^\d{4}-\d{2}-\d{2}$/.test(prazoStr);
      if (!formatoValido) {
        erros.prazo = 'Prazo deve estar no formato YYYY-MM-DD';
      } else {
        const [ano, mes, dia] = prazoStr.split('-').map(Number);
        const data = new Date(ano, mes - 1, dia);
        if (
          data.getFullYear() !== ano ||
          data.getMonth() !== mes - 1 ||
          data.getDate() !== dia
        ) {
          erros.prazo = 'Prazo deve ser uma data válida';
        } else {
          dados.prazo = prazoStr;
        }
      }
    }
  } else {
    erros.prazo = 'Prazo deve estar no formato YYYY-MM-DD';
  }

  return { dados, erros };
}

// Valida os filtros da busca (issue #4); filtros vazios são ignorados.
function validarFiltrosBusca(query) {
  const erros = {};
  const filtros = {};

  if (typeof query.status === 'string' && query.status.trim() !== '') {
    const status = query.status.trim();
    if (['a_fazer', 'fazendo', 'feito'].includes(status)) {
      filtros.status = status;
    } else {
      erros.status = 'Status deve ser a_fazer, fazendo ou feito';
    }
  }

  if (typeof query.prioridade === 'string' && query.prioridade.trim() !== '') {
    const prioridade = query.prioridade.trim();
    if (['baixa', 'media', 'alta'].includes(prioridade)) {
      filtros.prioridade = prioridade;
    } else {
      erros.prioridade = 'Prioridade deve ser baixa, media ou alta';
    }
  }

  if (typeof query.responsavel === 'string' && query.responsavel.trim() !== '') {
    const responsavel = query.responsavel.trim();
    if (responsavel.length > 80) {
      erros.responsavel = 'Responsável deve ter no máximo 80 caracteres';
    } else {
      filtros.responsavel = responsavel;
    }
  }

  return { filtros, erros };
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

app.post('/api/web/records', autenticar, async (req, res) => {
  const ctx = req.ctx;
  const { dados, erros } = validarTarefa(req.body);

  if (Object.keys(erros).length > 0) {
    logApi(ctx, 'create', 'error', 'Dados inválidos para cadastro de tarefa', 'WARN');
    return res.status(400).json({ erros });
  }

  try {
    const tarefa = await db.criarTarefa(dados, ctx);
    logApi(ctx, 'create', 'success', 'Tarefa criada com sucesso');
    return res.status(201).json(tarefa);
  } catch (erro) {
    logApi(ctx, 'create', 'error', 'Erro interno ao criar tarefa', 'ERROR');
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// Busca avançada (issue #4): filtros combináveis por status, prioridade e responsável.
app.get('/api/web/records/search', autenticar, async (req, res) => {
  const ctx = req.ctx;
  const { filtros, erros } = validarFiltrosBusca(req.query);

  if (Object.keys(erros).length > 0) {
    logApi(ctx, 'search', 'error', 'Filtros de busca inválidos', 'WARN');
    return res.status(400).json({ erros });
  }

  const opcoes = {
    page: inteiroPositivo(req.query.page, 1, Number.MAX_SAFE_INTEGER),
    pageSize: inteiroPositivo(req.query.page_size, 5, 100),
    sort: req.query.sort,
    order: req.query.order
  };

  try {
    const resultado = await db.buscarTarefas(filtros, opcoes, ctx);
    let totalPaginas = Math.ceil(resultado.total / opcoes.pageSize);
    if (totalPaginas < 1) {
      totalPaginas = 1;
    }

    logApi(ctx, 'search', 'success', 'Busca de tarefas realizada');
    return res.status(200).json({
      itens: resultado.itens,
      total: resultado.total,
      page: opcoes.page,
      page_size: opcoes.pageSize,
      total_pages: totalPaginas,
      filtros
    });
  } catch (erro) {
    logApi(ctx, 'search', 'error', 'Erro ao buscar tarefas', 'ERROR');
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

app.get('/api/web/records', autenticar, async (req, res) => {
  const ctx = req.ctx;
  const opcoes = {
    page: inteiroPositivo(req.query.page, 1, Number.MAX_SAFE_INTEGER),
    pageSize: inteiroPositivo(req.query.page_size, 5, 100),
    sort: req.query.sort,
    order: req.query.order
  };

  try {
    const resultado = await db.listarTarefas(opcoes, ctx);
    let totalPaginas = Math.ceil(resultado.total / opcoes.pageSize);
    if (totalPaginas < 1) {
      totalPaginas = 1;
    }

    logApi(ctx, 'list', 'success', 'Tarefas listadas');
    return res.status(200).json({
      itens: resultado.itens,
      total: resultado.total,
      page: opcoes.page,
      page_size: opcoes.pageSize,
      total_pages: totalPaginas
    });
  } catch (erro) {
    logApi(ctx, 'list', 'error', 'Erro ao listar tarefas', 'ERROR');
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

app.put('/api/web/records/:id', autenticar, async (req, res) => {
  const ctx = req.ctx;
  const id = lerId(req.params.id);
  if (!id) {
    logApi(ctx, 'update', 'error', 'ID inválido para atualização', 'WARN');
    return res.status(400).json({ erro: 'ID inválido' });
  }

  const { dados, erros } = validarTarefa(req.body);
  if (Object.keys(erros).length > 0) {
    logApi(ctx, 'update', 'error', 'Dados inválidos para atualização de tarefa', 'WARN');
    return res.status(400).json({ erros });
  }

  try {
    const tarefa = await db.atualizarTarefa(id, dados, ctx);
    if (!tarefa) {
      logApi(ctx, 'update', 'error', 'Tarefa não encontrada para atualização', 'WARN');
      return res.status(404).json({ erro: 'Tarefa não encontrada' });
    }

    logApi(ctx, 'update', 'success', 'Tarefa atualizada com sucesso');
    return res.status(200).json(tarefa);
  } catch (erro) {
    logApi(ctx, 'update', 'error', 'Erro interno ao atualizar tarefa', 'ERROR');
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// ---------- Dashboard (issue #6) ----------

app.get('/api/web/dashboard', autenticar, async (req, res) => {
  const ctx = req.ctx;
  try {
    const metricas = await db.obterMetricasDashboard(ctx);
    logApi(ctx, 'dashboard', 'success', 'Métricas do dashboard consultadas');
    return res.status(200).json(metricas);
  } catch (erro) {
    logApi(ctx, 'dashboard', 'error', 'Erro interno ao consultar dashboard', 'ERROR');
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

app.delete('/api/web/records/:id', autenticar, async (req, res) => {
  const ctx = req.ctx;
  const id = lerId(req.params.id);

  if (id === null) {
    logApi(ctx, 'delete', 'error', 'Identificador inválido', 'WARN');
    return res.status(400).json({ erro: 'Identificador inválido' });
  }

  try {
    const excluida = await db.excluirTarefa(id, ctx);
    if (!excluida) {
      logApi(ctx, 'delete', 'error', 'Tarefa não encontrada', 'WARN');
      return res.status(404).json({ erro: 'Tarefa não encontrada' });
    }

    logApi(ctx, 'delete', 'success', 'Tarefa excluída');
    return res.status(204).end();
  } catch (erro) {
    logApi(ctx, 'delete', 'error', 'Erro ao excluir tarefa', 'ERROR');
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

// Cadastro e edição pela CLI (issue #8): mesmas validações da Web, endpoints e consultas próprios.
app.post('/api/cli/records', async (req, res) => {
  const ctx = req.ctx;
  const { dados, erros } = validarTarefa(req.body);

  if (Object.keys(erros).length > 0) {
    logApi(ctx, 'create', 'error', 'Dados inválidos para cadastro de tarefa pela CLI', 'WARN');
    return res.status(400).json({ erros });
  }

  try {
    const tarefa = await db.inserirTarefaCli(dados, ctx);
    logApi(ctx, 'create', 'success', 'Tarefa criada pela CLI');
    return res.status(201).json(tarefa);
  } catch (erro) {
    logApi(ctx, 'create', 'error', 'Erro interno ao criar tarefa pela CLI', 'ERROR');
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

app.put('/api/cli/records/:id', async (req, res) => {
  const ctx = req.ctx;
  const id = lerId(req.params.id);
  if (!id) {
    logApi(ctx, 'update', 'error', 'ID inválido para atualização pela CLI', 'WARN');
    return res.status(400).json({ erro: 'ID inválido' });
  }

  const { dados, erros } = validarTarefa(req.body);
  if (Object.keys(erros).length > 0) {
    logApi(ctx, 'update', 'error', 'Dados inválidos para atualização de tarefa pela CLI', 'WARN');
    return res.status(400).json({ erros });
  }

  try {
    const tarefa = await db.editarTarefaCli(id, dados, ctx);
    if (!tarefa) {
      logApi(ctx, 'update', 'error', 'Tarefa não encontrada para atualização pela CLI', 'WARN');
      return res.status(404).json({ erro: 'Tarefa não encontrada' });
    }

    logApi(ctx, 'update', 'success', 'Tarefa atualizada pela CLI');
    return res.status(200).json(tarefa);
  } catch (erro) {
    logApi(ctx, 'update', 'error', 'Erro interno ao atualizar tarefa pela CLI', 'ERROR');
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

// Indicadores pela CLI (issue #12): consulta própria da CLI, com logs de client cli
app.get('/api/cli/dashboard', async (req, res) => {
  const ctx = req.ctx;
  try {
    const metricas = await db.obterMetricasDashboardCli(ctx);
    logApi(ctx, 'dashboard', 'success', 'Métricas do dashboard consultadas pela CLI');
    return res.status(200).json(metricas);
  } catch (erro) {
    logApi(ctx, 'dashboard', 'error', 'Erro interno ao consultar dashboard pela CLI', 'ERROR');
    return res.status(500).json({ erro: 'Erro interno' });
  }
});

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

module.exports = {
  app,
  start,
  logApi,
  clienteDaRota,
  autenticar,
  validarTarefa,
  validarFiltrosBusca,
  lerId,
  inteiroPositivo
};
