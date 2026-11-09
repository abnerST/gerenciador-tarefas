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

Os demais endpoints funcionais exigem o cabeçalho `Authorization: Bearer <token>`. Sem