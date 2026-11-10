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

Os testes unitários rodam dentro de um contêiner, com o banco simulado (mock), e medem a cobertura de linhas de `api.js`, `db.js` e `cli.js` (quando existir). O comando falha se a cobertura de linhas ficar abaixo de 100%.

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
| `README.md` | Execução e documentação |
| `docker-compose.yml` | Orquestra os serviços `db`, `api`, `web` e `tests` |
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