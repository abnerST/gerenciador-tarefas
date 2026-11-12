# Gerenciador de Tarefas

CRUD de tarefas com duas formas de uso, **Web** (navegador) e **CLI** (terminal), usando a mesma API REST e o mesmo banco de dados. Tudo roda pelo **Docker Compose**.

## Equipe

| Nome | Matrícula |
|---|---|
| Abner Souza Tabosa | 2650854 |
| Alexandre Henrique | 2650440 |
| Italo Ramos de Oliveira | 2650151 |

## Tecnologias

| Peça | Tecnologia | Arquivo |
|---|---|---|
| Web | HTML, CSS e JavaScript puro, servido pelo nginx | `index.html` |
| CLI | Node.js | `cli.js` |
| API | Node.js + Express | `api.js` |
| Banco | PostgreSQL + driver `pg` | `db.js` |
| Testes | Jest + supertest | `tests/` |

## Pré-requisitos

Apenas **Docker** e **Docker Compose**, além de um navegador e um terminal. Nenhuma linguagem, banco ou biblioteca precisa ser instalada fora dos contêineres.

## Como iniciar

1. Clonar o repositório e entrar na pasta:

   ```bash
   git clone https://github.com/equipe-git-tarefas/gerenciador-tarefas.git
   cd gerenciador-tarefas
   ```

2. Criar o arquivo `.env` a partir do exemplo:

   ```bash
   # Linux / macOS / Git Bash
   cp .env.example .env
   ```

   ```powershell
   # Windows PowerShell
   Copy-Item .env.example .env
   ```

   O `.env.example` traz valores de demonstração. Em qualquer ambiente real, troque `ADMIN_PASSWORD`, `POSTGRES_PASSWORD` e `JWT_SECRET`.

3. Subir Web, API e banco:

   ```bash
   docker compose up --build
   ```

4. Acessar:
   - **Web**: http://localhost:8080
   - **API** (direto): http://localhost:3000

Para parar, use `Ctrl+C`. Para apagar também os dados do banco:

```bash
docker compose down -v
```

## Configuração (`.env`)

| Variável | Uso |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Credenciais e nome do banco PostgreSQL |
| `ADMIN_USER` | Nome do usuário inicial |
| `ADMIN_PASSWORD` | Senha do usuário inicial. Na subida da API ela é transformada em hash (bcrypt) e só o hash é salvo no banco |
| `JWT_SECRET` | Segredo usado para assinar os tokens de acesso |

O `.env` não é versionado (está no `.gitignore`).

## Login na Web (issue #1)

1. Abrir http://localhost:8080.
2. Informar o usuário e a senha definidos em `ADMIN_USER` e `ADMIN_PASSWORD` no `.env`.
3. Com credenciais válidas, a API devolve um token (JWT, válido por 8 horas) e a página mostra a tela inicial. Com credenciais inválidas, a API responde **HTTP 401** e a página mostra a mensagem de erro.
4. O botão **Sair** apaga o token da sessão do navegador.

O indicador no canto superior da página consulta o healthcheck e mostra se a API está online.

### Endpoints da issue #1

| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| GET | `/api/web/health` | Pública | Healthcheck da API (HTTP 200) |
| POST | `/api/web/login` | Pública | Recebe `usuario` e `senha` e devolve `token`; credenciais inválidas retornam 401 |

Os demais endpoints funcionais exigem o cabeçalho `Authorization: Bearer <token>`. Sem token ou com token inválido, a API responde **HTTP 401**.

Exemplo pela linha de comando:

```bash
curl http://localhost:3000/api/web/health

curl -X POST http://localhost:3000/api/web/login \
  -H "Content-Type: application/json" \
  -d '{"usuario":"admin","senha":"admin123"}'
```

## CLI (issue #7)

A CLI fica no arquivo único `cli.js` e roda em um contêiner próprio pelo Docker Compose. Ela **não acessa o banco**: toda operação passa pela API, nos endpoints `/api/cli/...`, separados dos endpoints da Web.

Com a aplicação no ar (`docker compose up --build`), em outro terminal:

```bash
# Ajuda com todos os subcomandos
docker compose run --rm cli ajuda

# Healthcheck da API (público)
docker compose run --rm cli health

# Obter um token com o usuário inicial do .env
docker compose run --rm cli token --usuario admin --senha admin123
```

O comando `token` imprime só o token (JWT, válido por 8 horas). Os comandos protegidos enviam o cabeçalho `Authorization: Bearer <token>`. O token pode ser informado de duas formas:

```bash
# 1. Pela variável de ambiente TAREFAS_TOKEN (vale para todos os comandos)
docker compose run --rm -e TAREFAS_TOKEN=<token> cli <comando>

# 2. Pela opção --token em um comando específico
docker compose run --rm cli <comando> --token <token>
```

No Linux, macOS ou Git Bash, dá para guardar o token direto na variável:

```bash
export TAREFAS_TOKEN=$(docker compose run --rm cli token --usuario admin --senha admin123)
```

No Windows PowerShell:

```powershell
$env:TAREFAS_TOKEN = docker compose run --rm cli token --usuario admin --senha admin123
```

O serviço `cli` repassa `TAREFAS_TOKEN` do terminal para o contêiner. Os comandos de cadastro, listagem, busca, exportação e indicadores entram nas issues #8 a #12.

### Endpoints da issue #7

| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| GET | `/api/cli/health` | Pública | Healthcheck da API para a CLI (HTTP 200) |
| POST | `/api/cli/token` | Pública | Recebe `usuario` e `senha` e devolve `token`; credenciais inválidas retornam 401 |

Todas as outras rotas em `/api/cli/...` exigem `Authorization: Bearer <token>`. Sem token ou com token inválido, a API responde **HTTP 401**:

```bash
curl -i http://localhost:3000/api/cli/records
# HTTP/1.1 401 Unauthorized
```

Os logs dessas operações saem com `"client":"cli"`. No pedido de token, a API e o banco registram o mesmo `request_id`.

## Cadastro e edição de tarefas na Web (issue #2)

Permite cadastrar novas tarefas e atualizar tarefas existentes diretamente pela interface Web, com validação de dados tanto no navegador quanto na API REST, persistência em PostgreSQL e registro de logs correlacionados.

### Como cadastrar e editar pela tela

1. Acesse http://localhost:8080 e faça login com as credenciais administrativas.
2. Na tela inicial, preencha o formulário **Cadastrar Tarefa** com os campos obrigatórios e opcionais.
3. Clique em **Cadastrar tarefa**. Caso haja campos obrigatórios vazios ou formatos inválidos, mensagens de erro serão apresentadas abaixo de cada campo.
4. Após o salvamento com sucesso, a interface exibe a mensagem `Tarefa #<id> salva` e disponibiliza o botão **Editar esta tarefa**.
5. Ao clicar em **Editar esta tarefa** (ou quando uma tarefa for carregada para edição):
   - Os campos do formulário são preenchidos com os dados atuais da tarefa;
   - O botão principal muda para **Salvar alterações** (enviando a requisição para `PUT /api/web/records/{id}`);
   - O botão **Cancelar edição** fica visível, permitindo limpar os campos e retornar ao modo de cadastro a qualquer momento.

### Regras de validação

| Campo | Obrigatório | Regra |
|---|---|---|
| `titulo` | sim | texto não vazio, até 120 caracteres |
| `responsavel` | sim | texto não vazio, até 80 caracteres |
| `prioridade` | sim | `baixa`, `media` ou `alta` |
| `status` | sim | `a_fazer`, `fazendo` ou `feito` |
| `prazo` | não | data válida no formato `YYYY-MM-DD`; vazio vira `null` |

### Endpoints da issue #2

| Método | Rota | Autenticação | Códigos de resposta | Descrição |
|---|---|---|---|---|
| POST | `/api/web/records` | Bearer Token | 201, 400, 401, 500 | Cadastra uma nova tarefa |
| PUT | `/api/web/records/{id}` | Bearer Token | 200, 400, 401, 404, 500 | Atualiza uma tarefa existente pelo `{id}` |

- **HTTP 201 / 200**: sucesso na criação ou atualização, retornando o objeto da tarefa persistida.
- **HTTP 400**: id inválido ou falha de validação dos campos, retornando `{ erros: { campo: "mensagem" } }`.
- **HTTP 401**: ausência de token ou token inválido/expirado.
- **HTTP 404**: tarefa com o id informado não existe no banco.
- **HTTP 500**: erro interno ou falha na camada de banco de dados.

### Exemplo de uso via linha de comando

Substitua `<TOKEN>` pelo token JWT obtido no endpoint de login:

```bash
# 1. Cadastrar uma nova tarefa
curl -X POST http://localhost:3000/api/web/records \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "titulo": "Implementar formulário web",
    "responsavel": "Italo",
    "prioridade": "alta",
    "status": "a_fazer",
    "prazo": "2026-11-20"
  }'

# 2. Atualizar a tarefa cadastrada (exemplo com id 1)
curl -X PUT http://localhost:3000/api/web/records/1 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "titulo": "Implementar formulário web e testes",
    "responsavel": "Italo",
    "prioridade": "media",
    "status": "fazendo",
    "prazo": "2026-11-25"
  }'
```

### Operações de log geradas

Tanto na criação quanto na atualização, a requisição passa pela validação do token e gera eventos correlacionados com o mesmo `request_id`:

- **Criação (`POST`)**: gera operação `create` na camada `api` e `insert_task` na camada `db`.
- **Edição (`PUT`)**: gera operação `update` na camada `api` e `update_task` na camada `db`.

Exemplo de logs correlacionados no cadastro:

```json
{"timestamp":"2026-11-11T12:00:00.000Z","level":"INFO","layer":"api","client":"web","operation":"auth","status":"success","request_id":"c4a1...","message":"Token validado"}
{"timestamp":"2026-11-11T12:00:00.010Z","level":"INFO","layer":"db","client":"web","operation":"insert_task","status":"success","request_id":"c4a1...","message":"Tarefa cadastrada"}
{"timestamp":"2026-11-11T12:00:00.015Z","level":"INFO","layer":"api","client":"web","operation":"create","status":"success","request_id":"c4a1...","message":"Tarefa criada com sucesso"}
```

## Cadastro e edição de tarefas pela CLI (issue #8)

A CLI cadastra e edita tarefas com os **mesmos campos e as mesmas validações da Web** (a API usa a mesma função `validarTarefa`). Os comandos usam endpoints próprios da CLI, com consultas próprias no `db.js`, e exigem token. Uma tarefa criada pela CLI aparece na Web e vice-versa, porque as duas usam o mesmo banco.

Com o token na variável `TAREFAS_TOKEN` (veja a seção da CLI acima):

```bash
# Cadastrar (titulo, responsavel, prioridade e status são obrigatórios; prazo é opcional)
docker compose run --rm cli criar --titulo "Estudar Git" --responsavel "Abner" --prioridade alta --status a_fazer --prazo 2026-11-20
# Tarefa criada: #1 | Estudar Git | Abner | alta | a_fazer | 2026-11-20

# Editar a tarefa 1 (envia todos os campos, como o formulário da Web)
docker compose run --rm cli editar --id 1 --titulo "Estudar Git" --responsavel "Abner" --prioridade alta --status feito --prazo 2026-11-20
# Tarefa atualizada: #1 | Estudar Git | Abner | alta | feito | 2026-11-20
```

Os comandos são iguais no Bash e no PowerShell.

Se algum campo estiver inválido, a CLI mostra o erro de cada campo, com as mesmas mensagens da Web:

```text
Dados inválidos (HTTP 400):
  --prioridade: Prioridade deve ser baixa, media ou alta
```

| Opção | Regra |
|---|---|
| `--titulo` | Obrigatório, até 120 caracteres |
| `--responsavel` | Obrigatório, até 80 caracteres |
| `--prioridade` | Obrigatório: `baixa`, `media` ou `alta` |
| `--status` | Obrigatório: `a_fazer`, `fazendo` ou `feito` |
| `--prazo` | Opcional, no formato `AAAA-MM-DD` |
| `--id` | Obrigatório no `editar`: identificador da tarefa |

### Endpoints da issue #8

| Método | Rota | Autenticação | Respostas |
|---|---|---|---|
| POST | `/api/cli/records` | Bearer token | 201 criada, 400 dados inválidos, 401 sem token, 500 erro interno |
| PUT | `/api/cli/records/{id}` | Bearer token | 200 atualizada, 400 id ou dados inválidos, 401 sem token, 404 não encontrada, 500 erro interno |

### Logs gerados

Cada comando gera linhas com `"client":"cli"` e o mesmo `request_id` na API e no banco:

| Comando | Camada api | Camada db |
|---|---|---|
| `criar` | `auth` e `create` | `insert_task` |
| `editar` | `auth` e `update` | `update_task` |

## Listagem e exclusão de tarefas pela CLI (issue #9)

A CLI lista as tarefas com **paginação e ordenação** e exclui uma tarefa pelo id. Os comandos usam endpoints próprios da CLI, com consultas próprias no `db.js` (`listarTarefasCli` e `excluirTarefaCli`), e exigem token. Uma tarefa excluída pela CLI some também da tabela da Web, porque as duas usam o mesmo banco.

Com o token na variável `TAREFAS_TOKEN` (veja a seção da CLI acima):

```bash
# Primeira página, 5 tarefas, ordenadas por id
docker compose run --rm cli listar

# Página 2, 10 por página, ordenadas por prioridade da mais alta para a mais baixa
docker compose run --rm cli listar --page 2 --page-size 10 --sort prioridade --order desc

# Excluir a tarefa 3
docker compose run --rm cli excluir --id 3
# Tarefa #3 excluída.
```

Os comandos são iguais no Bash e no PowerShell.

Exemplo de saída do `listar`:

```text
ID | Título | Responsável | Prioridade | Status | Prazo
#1 | Tarefa 1 | Abner | baixa | a_fazer | sem prazo
#2 | Tarefa 2 | Abner | alta | a_fazer | 2026-11-20

Página 1 de 2 (6 tarefas no total, 5 por página)
```

| Opção | Regra |
|---|---|
| `--page` | Página desejada (padrão: 1) |
| `--page-size` | Tarefas por página, de 1 a 100 (padrão: 5) |
| `--sort` | `id`, `titulo`, `responsavel`, `prioridade`, `status` ou `prazo` (padrão: `id`) |
| `--order` | `asc` ou `desc` (padrão: `asc`) |
| `--id` | Obrigatório no `excluir`: identificador da tarefa |

Ordenação inválida é recusada pela API com a mensagem do campo:

```text
Dados inválidos (HTTP 400):
  --sort: Ordenação deve ser id, titulo, responsavel, prioridade, status, prazo
```

Excluir um id que não existe responde `Erro HTTP 404: Tarefa não encontrada`.

### Endpoints da issue #9

| Método | Rota | Autenticação | Respostas |
|---|---|---|---|
| GET | `/api/cli/records?page=&page_size=&sort=&order=` | Bearer token | 200 página de tarefas, 400 ordenação inválida, 401 sem token, 500 erro interno |
| DELETE | `/api/cli/records/{id}` | Bearer token | 204 excluída, 400 id inválido, 401 sem token, 404 não encontrada, 500 erro interno |

A resposta do `GET` traz `itens`, `total`, `page`, `page_size` e `total_pages`.

### Logs gerados

Cada comando gera linhas com `"client":"cli"` e o mesmo `request_id` na API e no banco:

| Comando | Camada api | Camada db |
|---|---|---|
| `listar` | `auth` e `list` | `cli_select_tasks` e `cli_count_tasks` |
| `excluir` | `auth` e `delete` | `cli_delete_task` |

```json
{"timestamp":"2026-11-12T15:38:22.798Z","level":"INFO","layer":"db","client":"cli","operation":"cli_delete_task","status":"success","request_id":"3980b32b...","message":"Exclusão de tarefa executada pela CLI"}
{"timestamp":"2026-11-12T15:38:22.798Z","level":"INFO","layer":"api","client":"cli","operation":"delete","status":"success","request_id":"3980b32b...","message":"Tarefa excluída pela CLI"}
```

## Dashboard na Web (issue #6)

Apresenta indicadores visuais agregados das tarefas na interface Web, atualizados de forma reativa após o login e a cada cadastro ou edição de tarefas. Os gráficos são renderizados com CSS puro em barras horizontais proporcionais, sem bibliotecas externas.

### Indicadores e regras de cálculo

O painel reúne 3 indicadores principais:

1. **Tarefas por Status**:
   - `A Fazer`: contagem de tarefas em `status = 'a_fazer'`.
   - `Fazendo`: contagem de tarefas em `status = 'fazendo'`.
   - `Feito`: contagem de tarefas em `status = 'feito'`.

2. **Tarefas por Prioridade**:
   - `Baixa`: contagem de tarefas com `prioridade = 'baixa'`.
   - `Média`: contagem de tarefas com `prioridade = 'media'`.
   - `Alta`: contagem de tarefas com `prioridade = 'alta'`.

3. **Prazos de Entrega**:
   - `Atrasadas` (destaque visual de alerta): tarefas com prazo preenchido menor que o dia atual e ainda não concluídas (`prazo IS NOT NULL AND prazo < CURRENT_DATE AND status != 'feito'`).
   - `No Prazo`: tarefas com prazo definido para a data de hoje ou futura, ou que já foram finalizadas (`prazo IS NOT NULL AND (prazo >= CURRENT_DATE OR status = 'feito')`).

### Endpoint da issue #6

| Método | Rota | Autenticação | Códigos de resposta | Descrição |
|---|---|---|---|---|
| GET | `/api/web/dashboard` | Bearer Token | 200, 401, 500 | Retorna as contagens agregadas para os 3 indicadores |

- **HTTP 200**: sucesso na consulta, retornando o objeto JSON com as contagens.
- **HTTP 401**: ausência de token ou token inválido/expirado.
- **HTTP 500**: erro interno ou falha na camada de persistência.

Exemplo de resposta (HTTP 200):

```json
{
  "status": {
    "a_fazer": 3,
    "fazendo": 2,
    "feito": 5
  },
  "prioridade": {
    "baixa": 4,
    "media": 3,
    "alta": 3
  },
  "prazos": {
    "atrasadas": 1,
    "no_prazo": 7
  }
}
```

### Exemplo via linha de comando

Substitua `<TOKEN>` pelo token JWT obtido no endpoint de login:

```bash
curl -X GET http://localhost:3000/api/web/dashboard \
  -H "Authorization: Bearer <TOKEN>"
```

### Operações de log geradas

A consulta de métricas do dashboard valida o token e gera registros correlacionados entre as camadas com o mesmo `request_id`:

| Camada | Operação | Status | Descrição |
|---|---|---|---|
| `api` | `auth` | `success` | Validação do token JWT |
| `db` | `dashboard_metrics` | `success` | Consulta SQL agregada das contagens |
| `api` | `dashboard` | `success` | Resposta das métricas entregue ao cliente Web |

Exemplo de logs correlacionados no dashboard:

```json
{"timestamp":"2026-11-11T12:00:00.000Z","level":"INFO","layer":"api","client":"web","operation":"auth","status":"success","request_id":"d5b2...","message":"Token validado"}
{"timestamp":"2026-11-11T12:00:00.010Z","level":"INFO","layer":"db","client":"web","operation":"dashboard_metrics","status":"success","request_id":"d5b2...","message":"Métricas do dashboard consultadas"}
{"timestamp":"2026-11-11T12:00:00.015Z","level":"INFO","layer":"api","client":"web","operation":"dashboard","status":"success","request_id":"d5b2...","message":"Métricas do dashboard consultadas"}
```

## Indicadores pela CLI (issue #12)

O comando `indicadores` consulta o endpoint `/api/cli/dashboard` e exibe, em texto legível, os mesmos 3 grupos de métricas do dashboard Web. Exige token de acesso.

### Como executar

Com a aplicação no ar (`docker compose up --build`), em outro terminal:

```bash
# Com a variável de ambiente TAREFAS_TOKEN já exportada (ver seção CLI acima)
docker compose run --rm cli indicadores

# Passando o token diretamente via opção
docker compose run --rm cli indicadores --token <token>

# Combinando com a exportação inline (Linux / macOS / Git Bash)
docker compose run --rm -e TAREFAS_TOKEN=<token> cli indicadores
```

No Windows PowerShell:

```powershell
docker compose run --rm -e TAREFAS_TOKEN=<token> cli indicadores
```

### Exemplo de saída

```text
Tarefas por Status:
  A Fazer: 3
  Fazendo: 2
  Feito: 5

Tarefas por Prioridade:
  Baixa: 4
  Média: 3
  Alta: 3

Tarefas por Prazo:
  Atrasadas: 1
  No Prazo: 7
```

Sem token (ou com token inválido), a CLI exibe uma mensagem de erro e encerra com código de saída 1:

```text
Token não informado. Use --token <token> ou defina TAREFAS_TOKEN.
```

### Endpoint da issue #12

| Método | Rota | Autenticação | Códigos de resposta | Descrição |
|---|---|---|---|---|
| GET | `/api/cli/dashboard` | Bearer Token | 200, 401, 500 | Retorna as contagens agregadas para os 3 indicadores (mesma estrutura de `/api/web/dashboard`) |

- **HTTP 200**: sucesso na consulta, retornando o objeto JSON com as contagens.
- **HTTP 401**: ausência de token ou token inválido/expirado.
- **HTTP 500**: erro interno ou falha na camada de persistência.

### Logs gerados

Cada execução de `indicadores` gera linhas com `"client":"cli"` e o mesmo `request_id` na API e no banco:

| Camada | Operação | Status | Descrição |
|---|---|---|---|
| `api` | `auth` | `success` | Validação do token JWT |
| `db` | `cli_dashboard_metrics` | `success` | Consulta SQL própria da CLI com as mesmas regras de prazos do dashboard Web |
| `api` | `dashboard` | `success` | Métricas entregues à CLI |

> A rota `/api/cli/dashboard` usa uma consulta própria da CLI (`obterMetricasDashboardCli`, no `db.js`), com a mesma regra do dashboard Web, por isso os valores são idênticos. Os logs saem com `client: cli`: `cli_dashboard_metrics` (db) e `dashboard` (api), com o mesmo `request_id`.

Exemplo de logs correlacionados:

```json
{"timestamp":"2026-11-11T12:00:00.000Z","level":"INFO","layer":"api","client":"cli","operation":"auth","status":"success","request_id":"e7c3...","message":"Token validado"}
{"timestamp":"2026-11-11T12:00:00.010Z","level":"INFO","layer":"db","client":"cli","operation":"cli_dashboard_metrics","status":"success","request_id":"e7c3...","message":"Indicadores da CLI consultados"}
{"timestamp":"2026-11-11T12:00:00.015Z","level":"INFO","layer":"api","client":"cli","operation":"dashboard","status":"success","request_id":"e7c3...","message":"Métricas do dashboard consultadas pela CLI"}
```

## Listagem e exclusão de tarefas na Web (issue #3)

Depois do login, a tela inicial mostra a tabela de tarefas, carregada do banco sempre que a página é aberta.

- **Colunas visíveis**: título, responsável, prioridade, status e prazo.
- **Paginação**: 5 tarefas por página, com os botões **Anterior** e **Próxima** e o total de tarefas.
- **Ordenação**: clique no nome de uma coluna para ordenar; clique de novo para inverter. A seta (▲ ou ▼) mostra a direção. Prioridade segue a ordem baixa → média → alta, e status, a fazer → fazendo → feito.
- **Seleção, edição e exclusão**: clique numa linha para selecioná-la. **Editar selecionada** leva a tarefa para o formulário de edição (issue #2); **Excluir selecionada** pede confirmação, exclui a tarefa do banco e atualiza a tabela.
- Depois de cadastrar ou editar pelo formulário, a tabela é atualizada automaticamente.

### Endpoints da issue #3

| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| GET | `/api/web/records` | Bearer token | Lista as tarefas com paginação e ordenação |
| DELETE | `/api/web/records/{id}` | Bearer token | Exclui a tarefa pelo identificador |

Parâmetros de `GET /api/web/records` (query string, todos opcionais):

| Parâmetro | Padrão | Valores |
|---|---|---|
| `page` | `1` | inteiro a partir de 1 |
| `page_size` | `5` | inteiro de 1 a 100 |
| `sort` | `id` | `id`, `titulo`, `responsavel`, `prioridade`, `status`, `prazo` |
| `order` | `asc` | `asc` ou `desc` |

Valores inválidos são substituídos pelo padrão. A resposta traz `itens`, `total`, `page`, `page_size` e `total_pages`.

Respostas de `DELETE /api/web/records/{id}`: **204** quando exclui, **404** quando a tarefa não existe, **400** quando o identificador não é um inteiro positivo e **401** sem token válido.

### Preparar dados de exemplo (opcional)

As tarefas podem ser cadastradas pelo formulário da Web. Para popular a tabela de uma vez, com o Compose rodando:

```bash
docker compose exec db psql -U tarefas -d tarefas -c "INSERT INTO tarefas (titulo, responsavel, prioridade, status, prazo) VALUES ('Configurar Docker','Alexandre','alta','feito','2026-11-09'), ('Criar tela de login','Alexandre','media','feito','2026-11-10'), ('Cadastro de tarefas','Italo','alta','fazendo','2026-11-10'), ('Estrutura da CLI','Abner','alta','fazendo','2026-11-10'), ('Listagem web','Alexandre','media','a_fazer','2026-11-11'), ('Dashboard','Italo','baixa','a_fazer','2026-11-11'), ('Gravar video','Abner','baixa','a_fazer',NULL);"
```

O usuário e o nome do banco (`-U tarefas -d tarefas`) seguem `POSTGRES_USER` e `POSTGRES_DB` do `.env`.

### Exemplos pela linha de comando

```bash
# Obter o token
TOKEN=$(curl -s -X POST http://localhost:3000/api/web/login \
  -H "Content-Type: application/json" \
  -d '{"usuario":"admin","senha":"admin123"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')

# Página 1, ordenada por prioridade decrescente
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/web/records?page=1&page_size=5&sort=prioridade&order=desc"

# Excluir a tarefa 7
curl -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/web/records/7
```

```powershell
# Windows PowerShell
$token = (Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/web/login -ContentType "application/json" -Body '{"usuario":"admin","senha":"admin123"}').token
Invoke-RestMethod -Uri "http://localhost:3000/api/web/records?page=1&sort=prioridade&order=desc" -Headers @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Delete -Uri http://localhost:3000/api/web/records/7 -Headers @{ Authorization = "Bearer $token" }
```

### Logs da issue #3

Cada listagem gera, com o mesmo `request_id`: `auth` (api), `select_tasks` e `count_tasks` (db) e `list` (api). Cada exclusão gera `auth` (api), `delete_task` (db) e `delete` (api). Falhas, como tarefa inexistente ou identificador inválido, aparecem com `level` `WARN` e `status` `error`.

## Busca avançada na Web (issue #4)

Acima da tabela de tarefas ficam três filtros, que podem ser usados sozinhos ou combinados:

| Filtro | Como funciona |
|---|---|
| **Status** | `a_fazer`, `fazendo` ou `feito` (valor exato) |
| **Prioridade** | `baixa`, `media` ou `alta` (valor exato) |
| **Responsável** | busca parcial, sem diferenciar maiúsculas e minúsculas (ex.: `alex` encontra `Alexandre`) |

- A consulta é **assíncrona**: a tabela é atualizada sem recarregar a página. Status e prioridade aplicam ao serem escolhidos; o responsável aplica com **Buscar** (ou Enter).
- Os filtros são combinados com **E**: só aparecem as tarefas que atendem a todos os filtros preenchidos.
- Paginação (5 por página) e ordenação por coluna continuam funcionando sobre o resultado filtrado.
- **Limpar filtros** apaga os campos e volta a mostrar todas as tarefas.
- Sem resultados, a tabela mostra "Nenhuma tarefa encontrada com esses filtros."

### Endpoint da issue #4

| Método | Rota | Autenticação | Descrição |
|---|---|---|---|
| GET | `/api/web/records/search` | Bearer token | Busca tarefas com filtros combináveis, paginação e ordenação |

Parâmetros (query string, todos opcionais): `status`, `prioridade`, `responsavel`, além de `page`, `page_size`, `sort` e `order` (mesmos valores da listagem da issue #3). Filtros vazios são ignorados.

A resposta traz `itens`, `total`, `page`, `page_size`, `total_pages` e `filtros` (os filtros aplicados). Respostas: **200** com o resultado, **400** com `{ "erros": { campo: mensagem } }` quando um filtro é inválido (ex.: `status=pronto`), **401** sem token válido.

A consulta no banco (`buscarTarefas`, no `db.js`) é própria da busca: o `WHERE` é montado só com os filtros informados, sempre com parâmetros (`$1`, `$2`...), e o total é contado com os mesmos filtros.

### Exemplos pela linha de comando

```bash
# Tarefas "a fazer" de responsáveis com "alex" no nome
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/web/records/search?status=a_fazer&responsavel=alex"

# Os três filtros combinados, ordenados por prazo decrescente
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/web/records/search?status=fazendo&prioridade=alta&responsavel=italo&sort=prazo&order=desc"
```

```powershell
# Windows PowerShell
Invoke-RestMethod -Uri "http://localhost:3000/api/web/records/search?status=a_fazer&responsavel=alex" -Headers @{ Authorization = "Bearer $token" }
```

(Como obter o `$TOKEN`/`$token`: veja os exemplos da issue #3.)

### Logs da issue #4

Cada busca gera, com o mesmo `request_id`: `auth` (api), `search_tasks` e `count_search_tasks` (db) e `search` (api). Filtro inválido gera `search` com `level` `WARN` e `status` `error`, sem consultar o banco.

## Logs

Cada operação registra uma linha JSON no stdout da API, com os campos `timestamp`, `level`, `layer`, `client`, `operation`, `status`, `request_id` e `message`. Quando a operação acessa o banco, o `db.js` registra outra linha com o **mesmo `request_id`**, o que permite correlacionar as duas camadas. Senhas e tokens nunca são registrados.

```bash
# Todos os logs da API (camadas api e db)
docker compose logs api

# Acompanhar em tempo real
docker compose logs -f api
```

Para ver só as linhas de uma requisição, copie o `request_id` (também devolvido no cabeçalho `X-Request-Id` da resposta) e filtre:

```bash
# Linux / macOS / Git Bash
docker compose logs api | grep "COLE-O-REQUEST-ID"
```

```powershell
# Windows PowerShell
docker compose logs api | Select-String "COLE-O-REQUEST-ID"
```

Exemplo de um login com sucesso:

```json
{"timestamp":"2026-11-09T18:00:00.000Z","level":"INFO","layer":"db","client":"web","operation":"select_user","status":"success","request_id":"3f2a...","message":"Consulta de usuário executada"}
{"timestamp":"2026-11-09T18:00:00.050Z","level":"INFO","layer":"api","client":"web","operation":"login","status":"success","request_id":"3f2a...","message":"Login realizado"}
```

## Testes e cobertura

Os testes unitários rodam dentro de um contêiner, com o banco simulado (mock), e medem a cobertura de linhas de `api.js`, `db.js` e `cli.js`. O comando falha se a cobertura de linhas ficar abaixo de 100%.

```bash
docker compose run --rm --build tests
```

A tabela no fim da saída mostra a coluna **% Lines** de cada arquivo.

## Estrutura de arquivos

| Arquivo | Finalidade |
|---|---|
| `index.html` | Toda a interface Web |
| `api.js` | Endpoints, autenticação e logs da camada api |
| `db.js` | Acesso ao banco e logs da camada db |
| `cli.js` | Toda a CLI (subcomandos e chamadas à API) |
| `README.md` | Execução e documentação |
| `docker-compose.yml` | Orquestra os serviços `db`, `api`, `web`, `cli` e `tests` |
| `Dockerfile` | Imagem Node.js da API e dos testes |
| `nginx.conf` | Serve o `index.html` e repassa `/api` para a API |
| `package.json`, `package-lock.json` | Dependências do Node.js |
| `jest.config.js` | Configuração dos testes e da cobertura mínima de 100% |
| `tests/` | Testes unitários |
| `.env.example` | Modelo das variáveis de ambiente |
| `.gitignore`, `.dockerignore` | Arquivos ignorados pelo Git e pelo Docker |
| `.github/PULL_REQUEST_TEMPLATE.md` | Template obrigatório das pull requests |

## Histórico do repositório

O primeiro commit da `main` (README vazio) foi gerado automaticamente na criação do repositório. Todas as alterações seguintes entraram por pull request, com aprovação dos outros dois integrantes e **Rebase and merge**, mantendo o histórico linear. Cada PR principal gerou uma tag SemVer e uma release.