// CLI do gerenciador de tarefas. Fala só com a API (endpoints /api/cli/...), nunca com o banco.

const API_URL_PADRAO = 'http://api:3000';

const AJUDA = `Uso: docker compose run --rm cli <comando> [opções]

Comandos:
  ajuda                                  Mostra esta ajuda
  health                                 Verifica se a API está no ar (público)
  token --usuario <u> --senha <s>        Obtém um token de acesso (Bearer)
  criar --titulo <t> --responsavel <r> --prioridade <p> --status <s> [--prazo AAAA-MM-DD]
                                         Cadastra uma tarefa (protegido)
  editar --id <n> --titulo <t> --responsavel <r> --prioridade <p> --status <s> [--prazo AAAA-MM-DD]
                                         Edita uma tarefa, enviando todos os campos (protegido)

Campos da tarefa (mesmas regras da Web):
  --titulo        obrigatório, até 120 caracteres
  --responsavel   obrigatório, até 80 caracteres
  --prioridade    obrigatório: baixa, media ou alta
  --status        obrigatório: a_fazer, fazendo ou feito
  --prazo         opcional, no formato AAAA-MM-DD

Autenticação:
  Os comandos protegidos enviam "Authorization: Bearer <token>".
  Informe o token pela opção --token <token> ou pela variável de ambiente TAREFAS_TOKEN.

Variáveis de ambiente:
  API_URL         Endereço da API (padrão: ${API_URL_PADRAO})
  TAREFAS_TOKEN   Token de acesso usado nos comandos protegidos
`;

// Transforma ["cmd", "--a", "1", "--b", "2"] em { comando: "cmd", opcoes: { a: "1", b: "2" } }.
function lerArgumentos(argv) {
  const opcoes = {};
  let comando = null;

  for (let i = 0; i < argv.length; i += 1) {
    const atual = argv[i];
    if (atual.startsWith('--')) {
      const nome = atual.slice(2);
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith('--')) {
        opcoes[nome] = true;
      } else {
        opcoes[nome] = valor;
        i += 1;
      }
    } else if (comando === null) {
      comando = atual;
    }
  }

  return { comando, opcoes };
}

function obterToken(opcoes, env) {
  if (typeof opcoes.token === 'string') {
    return opcoes.token;
  }
  if (env.TAREFAS_TOKEN) {
    return env.TAREFAS_TOKEN;
  }
  return null;
}

// Chamada genérica à API; os comandos das próximas issues reaproveitam esta função.
async function chamarApi(metodo, caminho, { corpo, token, env = process.env } = {}) {
  const base = env.API_URL || API_URL_PADRAO;
  const cabecalhos = { 'Content-Type': 'application/json' };
  if (token) {
    cabecalhos.Authorization = `Bearer ${token}`;
  }

  const opcoesFetch = { method: metodo, headers: cabecalhos };
  if (corpo !== undefined) {
    opcoesFetch.body = JSON.stringify(corpo);
  }

  const resposta = await fetch(base + caminho, opcoesFetch);
  const texto = await resposta.text();
  let dados = {};
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch (erro) {
      dados = { texto };
    }
  }
  return { status: resposta.status, dados };
}

function mensagemDeErro(resultado) {
  if (resultado.status === 401) {
    return 'Acesso negado (HTTP 401): token ausente ou inválido, ou credenciais incorretas.';
  }
  if (resultado.dados.erros) {
    const linhas = Object.entries(resultado.dados.erros).map(([campo, msg]) => `  --${campo}: ${msg}`);
    return `Dados inválidos (HTTP ${resultado.status}):\n${linhas.join('\n')}`;
  }
  const detalhe = resultado.dados.erro || 'erro inesperado';
  return `Erro HTTP ${resultado.status}: ${detalhe}`;
}

async function comandoHealth({ env, saida }) {
  const resultado = await chamarApi('GET', '/api/cli/health', { env });
  if (resultado.status !== 200) {
    saida.erro(mensagemDeErro(resultado));
    return 1;
  }
  saida.info(`API online: ${resultado.dados.status}`);
  return 0;
}

async function comandoToken({ opcoes, env, saida }) {
  if (typeof opcoes.usuario !== 'string' || typeof opcoes.senha !== 'string') {
    saida.erro('Informe --usuario e --senha. Exemplo: token --usuario admin --senha admin123');
    return 1;
  }

  const resultado = await chamarApi('POST', '/api/cli/token', {
    env,
    corpo: { usuario: opcoes.usuario, senha: opcoes.senha }
  });
  if (resultado.status !== 200) {
    saida.erro(mensagemDeErro(resultado));
    return 1;
  }

  saida.info(resultado.dados.token);
  return 0;
}

const CAMPOS_TAREFA = ['titulo', 'responsavel', 'prioridade', 'status', 'prazo'];

// Monta o corpo só com os campos informados; a validação fica na API, igual à Web.
function montarTarefa(opcoes) {
  const tarefa = {};
  for (const campo of CAMPOS_TAREFA) {
    if (typeof opcoes[campo] === 'string') {
      tarefa[campo] = opcoes[campo];
    }
  }
  return tarefa;
}

function formatarTarefa(tarefa) {
  const prazo = tarefa.prazo || 'sem prazo';
  return `#${tarefa.id} | ${tarefa.titulo} | ${tarefa.responsavel} | ${tarefa.prioridade} | ${tarefa.status} | ${prazo}`;
}

async function comandoCriar({ opcoes, env, saida, token }) {
  const resultado = await chamarApi('POST', '/api/cli/records', {
    env,
    token,
    corpo: montarTarefa(opcoes)
  });
  if (resultado.status !== 201) {
    saida.erro(mensagemDeErro(resultado));
    return 1;
  }
  saida.info(`Tarefa criada: ${formatarTarefa(resultado.dados)}`);
  return 0;
}

async function comandoEditar({ opcoes, env, saida, token }) {
  if (typeof opcoes.id !== 'string') {
    saida.erro('Informe o identificador com --id. Exemplo: editar --id 3 --titulo ... --status feito');
    return 1;
  }

  const resultado = await chamarApi('PUT', `/api/cli/records/${encodeURIComponent(opcoes.id)}`, {
    env,
    token,
    corpo: montarTarefa(opcoes)
  });
  if (resultado.status !== 200) {
    saida.erro(mensagemDeErro(resultado));
    return 1;
  }
  saida.info(`Tarefa atualizada: ${formatarTarefa(resultado.dados)}`);
  return 0;
}

const COMANDOS = {
  health: comandoHealth,
  token: comandoToken,
  criar: comandoCriar,
  editar: comandoEditar
};

async function main(argv, { env = process.env, saida = { info: console.log, erro: console.error } } = {}) {
  const { comando, opcoes } = lerArgumentos(argv);

  if (comando === null || comando === 'ajuda' || opcoes.help || opcoes.ajuda) {
    saida.info(AJUDA);
    return 0;
  }

  const executar = COMANDOS[comando];
  if (!executar) {
    saida.erro(`Comando desconhecido: ${comando}\n`);
    saida.info(AJUDA);
    return 1;
  }

  try {
    return await executar({ opcoes, env, saida, token: obterToken(opcoes, env) });
  } catch (erro) {
    saida.erro(`Não foi possível falar com a API: ${erro.message}`);
    return 1;
  }
}

// Executa só quando chamado como programa (node cli.js ...), não quando importado pelos testes.
if (require.main === module) main(process.argv.slice(2)).then((codigo) => { process.exitCode = codigo; });

module.exports = { main, lerArgumentos, obterToken, chamarApi, mensagemDeErro, montarTarefa, formatarTarefa, AJUDA };
