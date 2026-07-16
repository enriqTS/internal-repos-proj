# Guia de Contribuição — Templates

Este documento descreve como criar e submeter novos templates para o repositório interno de projetos da upd8. Siga rigorosamente as convenções aqui descritas para que seu template seja aceito, indexado corretamente e exibido na plataforma.

## Visão Geral do Fluxo

1. Crie uma branch a partir de `main`
2. Adicione seu template em `templates/<nome-do-template>/`
3. Garanta que todos os artefatos obrigatórios estão presentes
4. Abra um Pull Request para revisão
5. Após merge na `main`, o CI faz o deploy diferencial automaticamente

---

## Nomenclatura do Template

O nome do diretório do template deve seguir o padrão:

```
^[a-zA-Z0-9_-]+$
```

- Apenas letras, números, hífens e underscores
- Máximo de **64 caracteres**
- Use nomes descritivos e lowercase com hífens: `chatbot-rag-mantle`, `api-crud-dynamodb`, `etl-step-functions`
- O nome do diretório será o identificador único do template em toda a plataforma

---

## Estrutura Obrigatória de Arquivos

Cada template **deve** conter no mínimo:

```
templates/<nome-do-template>/
├── metadata.json                       # Metadados do template (obrigatório)
├── README.md                           # Documentação completa (obrigatório)
├── pyproject.toml                      # Dependências e configuração Python (obrigatório*)
├── uv.lock                             # Lock file commitado (obrigatório*)
├── Makefile                            # Automação de empacotamento Lambda (obrigatório*)
├── .gitignore                          # Exclusões padrão (obrigatório)
├── docs/
│   └── arquitetura/
│       └── <diagrama>.drawio.svg       # Diagrama de arquitetura (obrigatório)
├── src/                                # Código-fonte das Lambdas (obrigatório)
│   └── <função>/
│       └── handler.py
├── tests/                              # Testes automatizados (obrigatório)
│   ├── conftest.py
│   └── test_<função>.py
└── infra/                              # Terraform IaC (obrigatório)
    ├── openapi/                        # Spec OpenAPI se houver API
    ├── modules/                        # Módulos Terraform reutilizáveis
    └── environment/
        ├── dev/
        │   ├── backend.tf
        │   ├── providers.tf
        │   ├── main.tf
        │   ├── variables.tf
        │   ├── outputs.tf
        │   └── terraform.tfvars.example
        ├── staging/
        └── prod/
```

> \* Se o template não usa Python (ex: Node.js), substitua `pyproject.toml`/`uv.lock` pela configuração equivalente do ecossistema. O padrão da empresa é **Python 3.12 com uv**.

---

## metadata.json

O arquivo `metadata.json` na raiz do template é **obrigatório** e alimenta o índice de busca e a página de detalhes. Formato:

```json
{
  "name": "nome-do-template",
  "description": "Descrição concisa do que o template faz (máx. 200 caracteres)",
  "tags": ["tag1", "tag2", "tag3"],
  "date": "2026-07-16",
  "language": "python"
}
```

### Regras dos campos

| Campo | Tipo | Obrigatório | Regras |
|-------|------|-------------|--------|
| `name` | string | Sim | 1–64 chars, padrão `^[a-zA-Z0-9_-]+$`. Deve coincidir com o nome do diretório. |
| `description` | string | Sim | 0–200 chars. Seja conciso e descritivo. |
| `tags` | string[] | Sim | 0–50 itens. Cada tag: 1–32 chars, padrão `^[a-z0-9_-]+$` (lowercase). |
| `date` | string | Sim | ISO 8601: `"YYYY-MM-DD"`. Use a data de criação/última atualização significativa. |
| `language` | string | Não | 0–64 chars. Linguagem ou framework principal (ex: `"python"`, `"typescript"`). |
| `architectureImage` | string | Não | `"architecture.png"` ou `"architecture.svg"`. Preenchido automaticamente pelo CI se existir o arquivo em `docs/arquitetura/`. |

### Tags recomendadas

Use tags que descrevam: tecnologia (`python`, `terraform`, `bedrock-mantle`), padrão arquitetural (`rag`, `chatbot`, `etl`, `api-rest`), serviços AWS (`dynamodb`, `step-functions`, `sqs`), e variante (`websocket`, `streaming`, `ecs`).

---

## README.md do Template

O README é renderizado na página de detalhes do template e deve conter **no mínimo**:

1. **Título e Overview** — O que o template faz, em 2–3 parágrafos
2. **Arquitetura** — Diagrama ASCII ou referência à imagem + descrição dos componentes
3. **Pré-requisitos** — Ferramentas necessárias (uv, Terraform, AWS CLI, etc.)
4. **Estrutura do Projeto** — Árvore de diretórios explicada
5. **Setup de Desenvolvimento** — Como instalar deps, rodar testes, formatar
6. **Configuração** — Variáveis Terraform, backend S3, segredos
7. **Deploy** — Passo a passo completo (make, terraform init/plan/apply)
8. **Customização** — Como estender (adicionar ferramentas, endpoints, etc.)

---

## Diagrama de Arquitetura

- **Localização:** `docs/arquitetura/`
- **Formatos aceitos:** `.drawio.svg` (preferido), `.drawio.png`, `.svg`, `.png`
- O CI detecta automaticamente arquivos `architecture.svg` ou `architecture.png` na raiz do diretório do template no S3 para exibição na plataforma
- Recomendação: use **draw.io** e exporte tanto o `.drawio` (editável) quanto o `.svg` (renderizável)
- O diagrama será exibido na página de detalhes do template com suporte a lightbox

---

## Convenções de Código Python

Todos os templates Python devem seguir as convenções da empresa:

### Gerenciamento de Dependências

- Use **`uv`** (Astral) como gerenciador: `uv venv`, `uv add`, `uv sync`, `uv run`
- Dependências em `pyproject.toml`; **`uv.lock` commitado** no repositório
- Empacotamento de Lambdas via `Makefile` que usa `uv export --format requirements-txt`
- Python **3.12** como versão padrão

### Qualidade de Código

- **Formatter e linter:** `ruff` (Astral). Nunca use black.
  ```bash
  uv run ruff format .
  uv run ruff check .
  ```
- Type hints em todas as funções
- Funções pequenas, nomes claros, sem código morto
- Valide entradas, especialmente em endpoints públicos

### Estrutura de Lambda

- Clientes `boto3` criados **fora** do handler (reuso entre invocações quentes)
- Tratamento de erro explícito; nunca vazar stack trace ao cliente final
- Respostas previsíveis (`statusCode` + `body` JSON)
- Use `logging` (nunca `print()`). Prefira logs estruturados com `aws-lambda-powertools`
- Nunca logue PII ou segredos

### Configuração

- **Nunca hardcode** nomes de tabela, regiões, model IDs, endpoints
- Configuração via **variáveis de ambiente** (`os.environ`), injetadas pelo Terraform
- Segredos via **Secrets Manager** ou **SSM Parameter Store**, lidos em runtime

### Testes

- Framework: **`pytest`**
- Diretório: `tests/`, arquivos `test_*.py`
- Execução: `uv run pytest`
- Mock de serviços AWS — sem necessidade de credenciais reais
- Shared fixtures em `tests/conftest.py`
- Mínimo esperado: teste do caminho feliz de cada Lambda

---

## Convenções de Terraform / IaC

### Organização

- Estrutura de arquivos por ambiente: `infra/environment/dev|staging|prod/`
- Cada ambiente contém: `backend.tf`, `providers.tf`, `main.tf`, `variables.tf`, `outputs.tf`
- Módulos reutilizáveis em: `infra/modules/<recurso>/`
- Prefixe recursos com `${var.project_name}-${var.environment}-...`

### Backend Remoto (obrigatório)

O state Terraform **sempre** usa backend S3 remoto com lock no DynamoDB:

```hcl
terraform {
  backend "s3" {
    bucket         = "upd8-tfstate-<cliente>"
    key            = "<template-name>/<env>/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "upd8-tfstate-lock"
  }
}
```

> No template, deixe `<cliente>` como placeholder — o usuário preenche ao usar.

### Variáveis

- Nada de valores hardcoded nos recursos. O que muda entre ambientes/clientes vira variável.
- Declare variáveis com `type`, `description` e `default` quando fizer sentido.
- Inclua um `terraform.tfvars.example` sem segredos (este vai ao Git).
- Segredos reais no Secrets Manager/SSM; Terraform referencia o ARN, não o valor.

### Tags obrigatórias

Todos os recursos AWS devem ter as seguintes tags:

```hcl
tags = {
  Project     = var.project_name
  Environment = var.environment
  ManagedBy   = "terraform"
  Client      = var.client
}
```

### Segurança

- IAM com **least privilege** — nunca `*:*`
- Encryption at rest e in transit habilitados
- APIs públicas exigem autenticação; se houver endpoint sem auth, sinalize explicitamente no README
- Nunca commite `terraform.tfstate`, `*.tfvars` com segredos, ou `.terraform/`

---

## Arquitetura Serverless-First

A stack preferida da empresa é **serverless-first na AWS**. Ao criar um template, prefira:

| Camada | Serviço Preferido |
|--------|-------------------|
| Computação | AWS Lambda (Python 3.12) |
| API HTTP | API Gateway (REST ou HTTP API) |
| Persistência NoSQL | DynamoDB (on-demand) |
| Agentes de IA | Bedrock AgentCore |
| Modelos / Inferência | Amazon Bedrock (endpoint `bedrock-mantle` preferido) |
| Mensageria | SQS, SNS, EventBridge |
| Armazenamento | S3 |
| Orquestração | Step Functions |

### Princípios

- Lambdas stateless; estado em DynamoDB/S3
- Prefira eventos e filas a chamadas síncronas encadeadas
- Cada Lambda com responsabilidade única
- Handlers idempotentes (importante com SQS/retries); configure DLQs
- Se precisar fugir do serverless (container/ECS, RDS, etc.), documente a decisão no README explicando o porquê

### Acesso a Modelos (Bedrock)

- Prefira o endpoint **`bedrock-mantle`** (compatível com API OpenAI/Anthropic Messages)
- API key do Bedrock (`AWS_BEARER_TOKEN_BEDROCK`) é segredo → Secrets Manager/SSM, nunca no código

---

## .gitignore

Seu template deve incluir um `.gitignore` que exclua no mínimo:

```gitignore
# Terraform
.terraform/
*.tfstate
*.tfstate.backup
.terraform.lock.hcl

# Build
build/*
!build/.gitkeep
*.zip

# Python
__pycache__/
*.pyc
.pytest_cache/
.venv/
.ruff_cache/

# Secrets
.env
.env.*

# OS
.DS_Store

# Packaging artifacts
requirements.txt
```

---

## O que o CI Faz com Seu Template

Ao fazer merge na `main`, o pipeline de deploy:

1. **Detecta** diretórios em `templates/` que contenham alterações
2. **Faz upload diferencial** — apenas arquivos modificados são enviados ao S3
3. **Gera e publica** os seguintes artefatos automaticamente:
   - `templates/<nome>/files/` — todos os arquivos do template navegáveis no browser
   - `templates/<nome>/metadata.json` — metadados para o índice
   - `templates/<nome>/README.md` — documentação renderizada na página de detalhe
   - `templates/<nome>/artifact.zip` — pacote zip para download (exclui `docs/`, `.git*`, `build/`, `.kiro/`)
   - `templates/<nome>/file-tree.json` — manifesto para o file browser da plataforma
   - `templates/<nome>/architecture.svg` ou `.png` — diagrama (se existir em `docs/arquitetura/`)
4. **Regenera** o `templates-index.json` global escaneando todos os `metadata.json`

### Diretórios excluídos do upload

Os seguintes diretórios são **ignorados** pelo CI e não são publicados:

- `.git`, `node_modules`, `__pycache__`, `.pytest_cache`, `.hypothesis`
- `.ruff_cache`, `.kiro`, `.venv`, `venv`, `dist`, `build`, `.terraform`

---

## Checklist de Submissão

Antes de abrir o PR, verifique:

- [ ] Nome do diretório segue padrão `^[a-zA-Z0-9_-]+$` (max 64 chars)
- [ ] `metadata.json` presente com todos os campos obrigatórios e validação passando
- [ ] `README.md` completo com todas as seções obrigatórias
- [ ] Diagrama de arquitetura em `docs/arquitetura/` (SVG preferido)
- [ ] Código Python formatado (`uv run ruff format .`) e sem erros de lint (`uv run ruff check .`)
- [ ] Type hints em todas as funções
- [ ] Testes presentes em `tests/` e passando (`uv run pytest`)
- [ ] Terraform validado (`terraform fmt` + `terraform validate`)
- [ ] Backend S3 configurado com placeholders corretos
- [ ] Tags obrigatórias em todos os recursos Terraform
- [ ] IAM com least privilege (sem `*:*`)
- [ ] Nenhum segredo commitado (check `.env`, `*.tfvars` reais, API keys)
- [ ] `uv.lock` commitado e atualizado
- [ ] `.gitignore` incluído com padrões necessários
- [ ] `terraform.tfvars.example` presente (sem valores reais)

---

## Processo de Revisão

O Pull Request será revisado considerando:

1. **Aderência às convenções** — este documento e os padrões da empresa
2. **Qualidade do código** — legibilidade, testes, segurança
3. **Documentação** — README claro e completo para quem for usar o template
4. **Segurança** — IAM, secrets management, encryption
5. **Completude** — template funcional de ponta a ponta (deploy → uso → destroy)

---

## Dúvidas?

- Consulte templates existentes em `templates/` como referência
- Em particular, `chatbot-rag-mantle` é o template de referência com a estrutura completa
- Para decisões arquiteturais fora do padrão serverless, converse com o time antes de implementar
