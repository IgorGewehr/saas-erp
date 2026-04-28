# ServicePro REST API — Documentacao para Agentes de IA

> **Base URL**: `https://<seu-dominio>/api`
>
> **Versao**: v1
>
> **Formato**: JSON (exceto uploads multipart e SSE)

---

## Sumario

- [Autenticacao](#autenticacao)
- [Rate Limiting](#rate-limiting)
- [Formato de Erros](#formato-de-erros)
- [Endpoints](#endpoints)
  - [CRM — Contatos](#crm--contatos)
  - [CRM — Deals](#crm--deals)
  - [CRM — Atividades](#crm--atividades)
  - [Vendas (PDV)](#vendas-pdv)
  - [Agendamentos](#agendamentos)
  - [Servicos](#servicos)
  - [Produtos e Estoque](#produtos-e-estoque)
  - [Movimentacoes de Estoque](#movimentacoes-de-estoque)
  - [Financeiro — Transacoes](#financeiro--transacoes)
  - [Financeiro — Contas Bancarias](#financeiro--contas-bancarias)
  - [Usuarios e Equipe](#usuarios-e-equipe)
  - [Kanban — Boards](#kanban--boards)
  - [Kanban — Cards](#kanban--cards)
  - [Snippets (Respostas Rapidas)](#snippets-respostas-rapidas)
  - [Conversas (Omnichannel)](#conversas-omnichannel)
  - [Fiscal — Documentos](#fiscal--documentos)
  - [Fiscal — Emissao](#fiscal--emissao)
  - [Fiscal — Consulta](#fiscal--consulta)
  - [Fiscal — Cancelamento](#fiscal--cancelamento)
  - [Fiscal — Carta de Correcao](#fiscal--carta-de-correcao)
  - [Fiscal — Inutilizacao](#fiscal--inutilizacao)
  - [Fiscal — Status SEFAZ](#fiscal--status-sefaz)
  - [Fiscal — Certificado Digital](#fiscal--certificado-digital)
  - [Fiscal — DANFE](#fiscal--danfe)
  - [Broadcasts (Campanhas)](#broadcasts-campanhas)

---

## Autenticacao

Todas as rotas `/api/v1/*` utilizam autenticacao via **API Key**. As demais rotas internas (`/api/fiscal/*`, `/api/conversations/*`, `/api/broadcasts/*`) utilizam autenticacao por **sessao Firebase Auth**.

### API Key

As API Keys sao geradas em **Configuracoes > Enterprise > API Keys** no painel do ServicePro.

**Formato da chave**: `sp_live_...`

**Envio da chave** (escolha uma das opcoes):

```
Authorization: Bearer sp_live_xxxxxxxxxxxxxxxx
```

```
x-api-key: sp_live_xxxxxxxxxxxxxxxx
```

### Escopos (Scopes)

Cada API Key possui escopos que determinam quais recursos pode acessar:

| Escopo | Descricao |
|--------|-----------|
| `read:clients` | Ler clientes |
| `write:clients` | Criar/editar clientes |
| `read:appointments` | Ler agendamentos |
| `write:appointments` | Criar/editar agendamentos |
| `read:services` | Ler servicos |
| `write:services` | Criar/editar servicos |
| `read:financial` | Ler transacoes e contas bancarias |
| `write:financial` | Criar/editar transacoes e contas |
| `read:products` | Ler produtos e movimentacoes de estoque |
| `write:products` | Criar/editar produtos |
| `read:kanban` | Ler boards e cards |
| `write:kanban` | Criar/editar boards e cards |
| `read:crm` | Ler contatos, deals e atividades CRM |
| `write:crm` | Criar/editar contatos, deals e atividades |
| `read:sales` | Ler vendas |
| `write:sales` | Criar/editar vendas |
| `read:conversations` | Ler conversas e mensagens |
| `write:conversations` | Enviar mensagens |
| `read:fiscal` | Ler documentos fiscais |
| `write:fiscal` | Emitir/cancelar documentos fiscais |
| `read:broadcasts` | Ler campanhas |
| `write:broadcasts` | Criar/enviar campanhas |
| `read:segments` | Ler segmentos |
| `write:segments` | Criar/editar segmentos |
| `read:snippets` | Ler snippets |
| `write:snippets` | Criar/editar snippets |
| `read:sectors` | Ler setores |
| `write:sectors` | Criar/editar setores |
| `read:users` | Ler usuarios |
| `write:users` | Editar usuarios |
| `admin:all` | Acesso total (ignora verificacao de escopos) |

### Isolamento Multi-Tenant

O `businessId` e extraido automaticamente da API Key. Todas as queries sao filtradas por esse `businessId` — nao e possivel acessar dados de outro tenant.

---

## Rate Limiting

Algumas rotas possuem limites de requisicoes por janela de tempo:

| Rota | Limite | Janela |
|------|--------|--------|
| `POST /api/broadcasts/send` | 5 req | 1 min |
| `POST /api/conversations/send` | 30 req | 1 min |
| `POST /api/conversations/read-receipt` | 60 req | 1 min |
| `POST /api/conversations/typing` | 60 req | 1 min |

Quando o limite e excedido, a API retorna `429 Too Many Requests`.

---

## Formato de Erros

Todas as rotas retornam erros em formato padronizado:

```json
{
  "error": "Descricao do erro",
  "details": "Informacoes adicionais (opcional)",
  "code": "CODIGO_ERRO (opcional)"
}
```

### Codigos HTTP

| Codigo | Significado |
|--------|-------------|
| `200` | Sucesso |
| `201` | Recurso criado |
| `400` | Dados invalidos ou ausentes |
| `401` | API Key ausente, invalida ou expirada |
| `403` | Escopo insuficiente |
| `404` | Recurso nao encontrado |
| `429` | Rate limit excedido |
| `500` | Erro interno do servidor |

### Exemplos de Erro

**API Key ausente (401)**:
```json
{
  "error": "Unauthorized — missing or invalid API key. Expected format: sp_live_..."
}
```

**Escopo insuficiente (403)**:
```json
{
  "error": "Forbidden — missing scopes: read:services, write:services",
  "requiredScopes": ["read:services", "write:services"],
  "yourScopes": ["read:clients"]
}
```

**Validacao (400)**:
```json
{
  "error": "Missing required fields: name, salePrice"
}
```

---

## Endpoints

---

### CRM — Contatos

#### `GET /api/v1/crm/contacts`

Lista contatos do CRM com filtros avancados.

**Escopo**: `read:crm`

**Query Parameters**:

| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| `status` | string | Nao | Filtrar por status. Valores: `novo`, `contatado`, `qualificado`, `proposta`, `negociacao`, `ganho`, `perdido` |
| `source` | string | Nao | Filtrar por origem. Valores: `site`, `indicacao`, `whatsapp`, `instagram`, `facebook`, `google_ads`, `linkedin`, `evento`, `email`, `telefone`, `outro` |
| `profile` | string | Nao | Filtrar por perfil. Valores: `vip`, `regular`, `sporadic`, `new`, `at_risk`, `churned` |
| `tipo` | string | Nao | Tipo de pessoa: `pf` (fisica) ou `pj` (juridica) |
| `active` | string | Nao | `true` ou `false` |
| `search` | string | Nao | Busca por nome, email, telefone ou empresa |
| `tags` | string | Nao | Tags separadas por virgula (ex: `vip,premium`) |
| `assignedTo` | string | Nao | ID do usuario responsavel |
| `lifecycleStage` | string | Nao | Estagio do ciclo de vida |
| `sectorId` | string | Nao | ID do setor |
| `minChurnRisk` | number | Nao | Risco minimo de churn (0-1) |
| `sort` | string | Nao | Campo de ordenacao: `name`, `createdAt`, `totalSpent` |
| `order` | string | Nao | Direcao: `asc` ou `desc` |
| `limit` | number | Nao | Itens por pagina (1-200, padrao: 50) |
| `offset` | number | Nao | Deslocamento para paginacao |

**Resposta** `200 OK`:

```json
{
  "contacts": [
    {
      "id": "abc123",
      "businessId": "biz456",
      "name": "Maria Silva",
      "email": "maria@email.com",
      "phone": "11999887766",
      "company": "Empresa X",
      "tipo": "pf",
      "status": "qualificado",
      "source": "whatsapp",
      "profile": "vip",
      "isActive": true,
      "tags": ["premium"],
      "lifecycleStage": "customer",
      "totalSpent": 5400.00,
      "visitCount": 12,
      "assignedTo": "uid789",
      "sectorId": "sector1",
      "channelIdentities": {
        "whatsapp": "5511999887766",
        "instagram": "maria_silva"
      },
      "address": {
        "logradouro": "Rua das Flores",
        "numero": "123",
        "bairro": "Centro",
        "municipio": "Sao Paulo",
        "uf": "SP",
        "cep": "01001000"
      },
      "createdAt": "2025-01-15T10:30:00.000Z",
      "updatedAt": "2025-03-20T14:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

---

#### `POST /api/v1/crm/contacts`

Cria um novo contato no CRM.

**Escopo**: `write:crm`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `name` | string | Sim | Nome do contato |
| `email` | string | Nao | E-mail |
| `phone` | string | Nao | Telefone |
| `company` | string | Nao | Empresa |
| `tipo` | string | Nao | `pf` ou `pj` (padrao: `pf`) |
| `gender` | string | Nao | `M`, `F` ou `O` |
| `document` | string | Nao | CPF ou CNPJ |
| `status` | string | Nao | Status inicial (padrao: `novo`) |
| `source` | string | Nao | Origem do contato |
| `profile` | string | Nao | Perfil do contato |
| `isActive` | boolean | Nao | Ativo (padrao: `true`) |
| `tags` | string[] | Nao | Tags |
| `assignedTo` | string | Nao | UID do responsavel |
| `lifecycleStage` | string | Nao | Estagio do ciclo |
| `sectorId` | string | Nao | ID do setor |
| `address` | object | Nao | Endereco (logradouro, numero, complemento, bairro, municipio, uf, cep) |

**Exemplo**:

```json
{
  "name": "Joao Oliveira",
  "email": "joao@empresa.com",
  "phone": "11988776655",
  "company": "Oliveira Ltda",
  "tipo": "pj",
  "document": "12345678000190",
  "source": "linkedin",
  "tags": ["b2b", "enterprise"]
}
```

**Resposta** `201 Created`:

```json
{
  "success": true,
  "id": "novo_id_gerado",
  "name": "Joao Oliveira",
  "businessId": "biz456",
  "createdAt": "2025-03-20T14:00:00.000Z"
}
```

---

### CRM — Deals

#### `GET /api/v1/crm/deals`

Lista deals (oportunidades de negocio).

**Escopo**: `read:crm`

**Query Parameters**:

| Parametro | Tipo | Obrigatorio | Descricao |
|-----------|------|-------------|-----------|
| `contactId` | string | Nao | Filtrar deals de um contato especifico |
| `stage` | string | Nao | Estagio: `prospeccao`, `qualificacao`, `proposta`, `negociacao`, `fechamento` |
| `assignedTo` | string | Nao | UID do responsavel |
| `search` | string | Nao | Busca por titulo |
| `limit` | number | Nao | Itens por pagina (padrao: 50) |
| `offset` | number | Nao | Deslocamento |

**Resposta** `200 OK`:

```json
{
  "deals": [
    {
      "id": "deal123",
      "businessId": "biz456",
      "contactId": "contact789",
      "contactName": "Maria Silva",
      "title": "Projeto de integracao ERP",
      "stage": "proposta",
      "value": 25000.00,
      "assignedTo": "uid001",
      "expectedCloseDate": "2025-04-15",
      "notes": "Aguardando aprovacao do financeiro",
      "createdAt": "2025-03-01T09:00:00.000Z",
      "updatedAt": "2025-03-18T16:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 30,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

---

#### `POST /api/v1/crm/deals`

Cria um novo deal.

**Escopo**: `write:crm`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `contactId` | string | Sim | ID do contato associado |
| `contactName` | string | Sim | Nome do contato |
| `title` | string | Sim | Titulo do deal |
| `stage` | string | Nao | Estagio (padrao: `prospeccao`) |
| `value` | number | Nao | Valor estimado (>= 0) |
| `assignedTo` | string | Nao | UID do responsavel |
| `expectedCloseDate` | string | Nao | Data prevista de fechamento (YYYY-MM-DD) |
| `notes` | string | Nao | Observacoes |

**Resposta** `201 Created`:

```json
{
  "success": true,
  "id": "deal_novo_id",
  "title": "Projeto de integracao ERP",
  "contactId": "contact789",
  "businessId": "biz456",
  "createdAt": "2025-03-20T14:00:00.000Z"
}
```

---

### CRM — Atividades

#### `GET /api/v1/crm/activities`

Lista atividades relacionadas a contatos/deals.

**Escopo**: `read:crm`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `contactId` | string | Filtrar por contato |
| `dealId` | string | Filtrar por deal |
| `type` | string | Tipo de atividade |
| `limit` | number | Itens por pagina |
| `offset` | number | Deslocamento |

---

#### `POST /api/v1/crm/activities`

Registra uma nova atividade.

**Escopo**: `write:crm`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `contactId` | string | Sim | ID do contato |
| `type` | string | Sim | Tipo (call, email, meeting, note, task) |
| `title` | string | Sim | Titulo |
| `description` | string | Nao | Descricao |
| `dealId` | string | Nao | ID do deal relacionado |
| `scheduledAt` | string | Nao | Data agendada (ISO 8601) |

---

### Vendas (PDV)

#### `GET /api/v1/sales`

Lista vendas do ponto de venda.

**Escopo**: `read:sales`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `status` | string | `aberta`, `finalizada` ou `cancelada` |
| `startDate` | string | Data inicial (ISO 8601) |
| `endDate` | string | Data final (ISO 8601) |
| `clientId` | string | Filtrar por cliente |
| `limit` | number | Itens por pagina (padrao: 50) |
| `offset` | number | Deslocamento |

**Resposta** `200 OK`:

```json
{
  "sales": [
    {
      "id": "sale123",
      "businessId": "biz456",
      "status": "finalizada",
      "items": [
        {
          "description": "Corte masculino",
          "quantity": 1,
          "unitPrice": 50.00,
          "total": 50.00
        }
      ],
      "payments": [
        {
          "method": "pix",
          "amount": 50.00
        }
      ],
      "subtotal": 50.00,
      "discountValue": 0,
      "total": 50.00,
      "clientId": "client789",
      "clientName": "Carlos Souza",
      "operatorId": "uid001",
      "operatorName": "Ana Lima",
      "createdAt": "2025-03-20T14:30:00.000Z"
    }
  ],
  "pagination": {
    "total": 500,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

---

#### `POST /api/v1/sales`

Registra uma nova venda.

**Escopo**: `write:sales`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `items` | array | Sim | Lista de itens (minimo 1) |
| `items[].description` | string | Sim | Descricao do item |
| `items[].quantity` | number | Sim | Quantidade (> 0) |
| `items[].unitPrice` | number | Sim | Preco unitario (>= 0) |
| `items[].total` | number | Sim | Total do item |
| `payments` | array | Sim | Lista de pagamentos (minimo 1) |
| `payments[].method` | string | Sim | Metodo: `dinheiro`, `pix`, `credito`, `debito`, `boleto`, `outros` |
| `payments[].amount` | number | Sim | Valor (> 0) |
| `status` | string | Nao | `aberta`, `finalizada`, `cancelada` (padrao: `finalizada`) |
| `clientId` | string | Nao | ID do cliente |
| `clientName` | string | Nao | Nome do cliente |
| `notes` | string | Nao | Observacoes |
| `discountValue` | number | Nao | Valor de desconto |

**Exemplo**:

```json
{
  "items": [
    {
      "description": "Corte feminino",
      "quantity": 1,
      "unitPrice": 80.00,
      "total": 80.00
    },
    {
      "description": "Hidratacao",
      "quantity": 1,
      "unitPrice": 60.00,
      "total": 60.00
    }
  ],
  "payments": [
    {
      "method": "credito",
      "amount": 140.00
    }
  ],
  "clientId": "client789",
  "clientName": "Ana Beatriz"
}
```

**Resposta** `201 Created`:

```json
{
  "success": true,
  "id": "sale_novo_id",
  "total": 140.00,
  "status": "finalizada",
  "businessId": "biz456",
  "createdAt": "2025-03-20T15:00:00.000Z"
}
```

---

### Agendamentos

#### `GET /api/v1/appointments`

Lista agendamentos.

**Escopo**: `read:appointments`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `date` | string | Data especifica (YYYY-MM-DD) |
| `startDate` | string | Data inicial (YYYY-MM-DD) |
| `endDate` | string | Data final (YYYY-MM-DD) |
| `status` | string | `agendado`, `confirmado`, `em_andamento`, `concluido`, `cancelado`, `nao_compareceu` |
| `professionalId` | string | ID do profissional |
| `clientId` | string | ID do cliente |
| `limit` | number | Itens por pagina |
| `offset` | number | Deslocamento |

**Resposta** `200 OK`:

```json
{
  "appointments": [
    {
      "id": "apt123",
      "businessId": "biz456",
      "clientId": "client789",
      "clientName": "Maria Silva",
      "clientPhone": "11999887766",
      "serviceName": "Consultoria",
      "serviceId": "svc001",
      "professionalId": "uid001",
      "professionalName": "Dr. Pedro",
      "date": "2025-03-25",
      "startTime": "14:00",
      "endTime": "15:00",
      "duration": 60,
      "price": 200.00,
      "status": "confirmado",
      "notes": "Primeira consulta",
      "color": "#4F46E5",
      "createdAt": "2025-03-20T10:00:00.000Z"
    }
  ],
  "count": 15,
  "limit": 50,
  "offset": 0
}
```

---

#### `POST /api/v1/appointments`

Cria um novo agendamento.

**Escopo**: `write:appointments`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `clientId` | string | Sim | ID do cliente |
| `clientName` | string | Sim | Nome do cliente |
| `serviceName` | string | Sim | Nome do servico |
| `date` | string | Sim | Data (YYYY-MM-DD) |
| `startTime` | string | Sim | Horario de inicio (HH:mm) |
| `duration` | number | Sim | Duracao em minutos |
| `price` | number | Sim | Preco do servico |
| `clientPhone` | string | Nao | Telefone do cliente |
| `serviceId` | string | Nao | ID do servico |
| `professionalId` | string | Nao | ID do profissional |
| `professionalName` | string | Nao | Nome do profissional |
| `endTime` | string | Nao | Horario de termino (calculado automaticamente se nao fornecido) |
| `notes` | string | Nao | Observacoes |
| `color` | string | Nao | Cor hex para exibicao |
| `status` | string | Nao | Status (padrao: `agendado`) |

**Exemplo**:

```json
{
  "clientId": "client789",
  "clientName": "Maria Silva",
  "clientPhone": "11999887766",
  "serviceName": "Consultoria empresarial",
  "serviceId": "svc001",
  "date": "2025-03-25",
  "startTime": "14:00",
  "duration": 60,
  "price": 200.00,
  "professionalId": "uid001",
  "professionalName": "Dr. Pedro",
  "notes": "Cliente VIP"
}
```

**Resposta** `201 Created`:

```json
{
  "success": true,
  "id": "apt_novo_id",
  "date": "2025-03-25",
  "startTime": "14:00",
  "endTime": "15:00",
  "businessId": "biz456",
  "createdAt": "2025-03-20T15:00:00.000Z"
}
```

---

### Servicos

#### `GET /api/v1/services`

Lista servicos oferecidos.

**Escopo**: `read:services`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `active` | string | `true` ou `false` |
| `category` | string | Filtrar por categoria |
| `userId` | string | Filtrar por profissional |
| `search` | string | Busca por nome |
| `limit` | number | Itens por pagina |
| `offset` | number | Deslocamento |

**Resposta** `200 OK`:

```json
{
  "services": [
    {
      "id": "svc001",
      "businessId": "biz456",
      "name": "Consultoria empresarial",
      "description": "Sessao de consultoria de 1 hora",
      "duration": 60,
      "price": 200.00,
      "category": "Consultoria",
      "color": "#4F46E5",
      "isActive": true,
      "createdAt": "2025-01-10T08:00:00.000Z"
    }
  ],
  "total": 25,
  "limit": 50,
  "offset": 0
}
```

---

#### `POST /api/v1/services`

Cria um novo servico.

**Escopo**: `write:services`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `name` | string | Sim | Nome do servico |
| `duration` | number | Sim | Duracao em minutos |
| `price` | number | Sim | Preco (>= 0) |
| `description` | string | Nao | Descricao |
| `category` | string | Nao | Categoria |
| `color` | string | Nao | Cor hex |
| `isActive` | boolean | Nao | Ativo (padrao: `true`) |

**Resposta** `201 Created`:

```json
{
  "success": true,
  "id": "svc_novo_id",
  "name": "Consultoria empresarial",
  "businessId": "biz456",
  "createdAt": "2025-03-20T15:00:00.000Z"
}
```

---

### Produtos e Estoque

#### `GET /api/v1/products`

Lista produtos do estoque.

**Escopo**: `read:products`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `search` | string | Busca por nome, SKU ou codigo de barras |
| `category` | string | Filtrar por categoria |
| `active` | string | `true` ou `false` |
| `stockStatus` | string | `empty` (estoque zero), `low` (abaixo do minimo), `ok` |
| `limit` | number | Itens por pagina |
| `offset` | number | Deslocamento |

**Resposta** `200 OK`:

```json
{
  "products": [
    {
      "id": "prod001",
      "businessId": "biz456",
      "name": "Shampoo Profissional 500ml",
      "description": "Shampoo para uso profissional",
      "sku": "SHP-500",
      "barcode": "7891234567890",
      "category": "Cosmeticos",
      "unit": "un",
      "costPrice": 25.00,
      "salePrice": 49.90,
      "currentStock": 45,
      "minStock": 10,
      "maxStock": 100,
      "isActive": true,
      "imageUrl": "https://storage.googleapis.com/...",
      "ncm": "33051000",
      "cfop": "5102",
      "createdAt": "2025-01-05T08:00:00.000Z"
    }
  ],
  "total": 200,
  "limit": 50,
  "offset": 0
}
```

---

#### `POST /api/v1/products`

Cria um novo produto.

**Escopo**: `write:products`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `name` | string | Sim | Nome do produto |
| `salePrice` | number | Sim | Preco de venda (>= 0) |
| `description` | string | Nao | Descricao |
| `sku` | string | Nao | Codigo SKU |
| `barcode` | string | Nao | Codigo de barras |
| `category` | string | Nao | Categoria |
| `unit` | string | Nao | Unidade de medida |
| `costPrice` | number | Nao | Preco de custo |
| `currentStock` | number | Nao | Estoque atual (padrao: 0) |
| `minStock` | number | Nao | Estoque minimo |
| `maxStock` | number | Nao | Estoque maximo |
| `isActive` | boolean | Nao | Ativo (padrao: `true`) |
| `ncm` | string | Nao | NCM fiscal |
| `cfop` | string | Nao | CFOP fiscal |
| `cest` | string | Nao | CEST fiscal |
| `gtin` | string | Nao | GTIN/EAN |
| `imageUrl` | string | Nao | URL da imagem |

**Resposta** `201 Created`:

```json
{
  "success": true,
  "id": "prod_novo_id",
  "name": "Shampoo Profissional 500ml",
  "businessId": "biz456",
  "createdAt": "2025-03-20T15:00:00.000Z"
}
```

---

#### `PUT /api/v1/products`

Atualiza um produto existente.

**Escopo**: `write:products`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `id` | string | Sim | ID do produto |
| `...` | any | Nao | Qualquer campo do produto para atualizar |

---

### Movimentacoes de Estoque

#### `GET /api/v1/stock-movements`

Lista movimentacoes de estoque (entradas e saidas).

**Escopo**: `read:products`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `productId` | string | Filtrar por produto |
| `type` | string | `entrada` ou `saida` |
| `startDate` | string | Data inicial |
| `endDate` | string | Data final |
| `limit` | number | Itens por pagina |
| `offset` | number | Deslocamento |

---

### Financeiro — Transacoes

#### `GET /api/v1/transactions`

Lista transacoes financeiras (receitas e despesas).

**Escopo**: `read:financial`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `type` | string | `receita` ou `despesa` |
| `status` | string | `pendente`, `pago`, `atrasado`, `cancelado` |
| `startDate` | string | Data inicial (YYYY-MM-DD) |
| `endDate` | string | Data final (YYYY-MM-DD) |
| `category` | string | Categoria |
| `search` | string | Busca por descricao ou cliente |
| `limit` | number | Itens por pagina (1-200, padrao: 50) |
| `offset` | number | Deslocamento |

**Resposta** `200 OK`:

```json
{
  "transactions": [
    {
      "id": "txn001",
      "businessId": "biz456",
      "type": "receita",
      "category": "Servicos",
      "description": "Pagamento consultoria - Maria Silva",
      "amount": 200.00,
      "dueDate": "2025-03-20",
      "status": "pago",
      "paymentMethod": "pix",
      "clientId": "client789",
      "clientName": "Maria Silva",
      "notes": "",
      "channelType": "whatsapp",
      "sectorId": "sector1",
      "createdAt": "2025-03-20T10:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 1200,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

---

#### `POST /api/v1/transactions`

Cria uma nova transacao financeira.

**Escopo**: `write:financial`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `type` | string | Sim | `receita` ou `despesa` |
| `category` | string | Sim | Categoria |
| `description` | string | Sim | Descricao |
| `amount` | number | Sim | Valor (> 0) |
| `dueDate` | string | Sim | Data de vencimento (YYYY-MM-DD) |
| `status` | string | Nao | `pendente`, `pago`, `atrasado`, `cancelado` (padrao: `pendente`) |
| `paymentMethod` | string | Nao | `dinheiro`, `pix`, `credito`, `debito`, `boleto`, `outros` |
| `clientId` | string | Nao | ID do cliente |
| `clientName` | string | Nao | Nome do cliente |
| `notes` | string | Nao | Observacoes |

**Exemplo**:

```json
{
  "type": "receita",
  "category": "Servicos",
  "description": "Pagamento mensal - Empresa X",
  "amount": 5000.00,
  "dueDate": "2025-04-01",
  "status": "pendente",
  "paymentMethod": "boleto",
  "clientName": "Empresa X"
}
```

**Resposta** `201 Created`:

```json
{
  "success": true,
  "id": "txn_novo_id",
  "type": "receita",
  "amount": 5000.00,
  "businessId": "biz456",
  "createdAt": "2025-03-20T15:00:00.000Z"
}
```

---

### Financeiro — Contas Bancarias

#### `GET /api/v1/bank-accounts`

Lista contas bancarias.

**Escopo**: `read:financial`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `active` | string | `true` ou `false` |
| `type` | string | `corrente` ou `poupanca` |
| `limit` | number | Itens por pagina |
| `offset` | number | Deslocamento |

**Resposta** `200 OK`:

```json
{
  "bankAccounts": [
    {
      "id": "ba001",
      "businessId": "biz456",
      "name": "Conta Principal",
      "bankName": "Banco do Brasil",
      "bankCode": "001",
      "accountType": "corrente",
      "agency": "1234",
      "accountNumber": "56789-0",
      "balance": 15000.00,
      "color": "#2563EB",
      "isMain": true,
      "isActive": true,
      "createdAt": "2025-01-01T08:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 3,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

---

#### `POST /api/v1/bank-accounts`

Cria uma nova conta bancaria.

**Escopo**: `write:financial`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `name` | string | Sim | Nome da conta |
| `bankName` | string | Sim | Nome do banco |
| `bankCode` | string | Nao | Codigo do banco |
| `accountType` | string | Nao | `corrente` ou `poupanca` (padrao: `corrente`) |
| `agency` | string | Nao | Agencia |
| `accountNumber` | string | Nao | Numero da conta |
| `balance` | number | Nao | Saldo inicial |
| `color` | string | Nao | Cor hex |
| `isMain` | boolean | Nao | Conta principal |
| `isActive` | boolean | Nao | Ativa (padrao: `true`) |

---

#### `PUT /api/v1/bank-accounts`

Atualiza uma conta bancaria.

**Escopo**: `write:financial`

**Request Body**: `id` (obrigatorio) + campos a atualizar.

---

### Usuarios e Equipe

#### `GET /api/v1/users`

Lista usuarios/membros da equipe.

**Escopo**: `read:users`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `role` | string | `founder`, `admin`, `manager`, `operator`, `viewer` |
| `search` | string | Busca por nome ou email |

**Resposta** `200 OK`:

```json
{
  "users": [
    {
      "id": "uid001",
      "uid": "uid001",
      "name": "Ana Lima",
      "email": "ana@empresa.com",
      "role": "admin",
      "phone": "11999000111",
      "photoURL": "https://storage.googleapis.com/...",
      "isOnline": true,
      "userStatus": "online",
      "lastSeenAt": "2025-03-20T15:30:00.000Z",
      "lastLoginAt": "2025-03-20T08:00:00.000Z",
      "sectorIds": ["sector1", "sector2"],
      "createdAt": "2025-01-01T08:00:00.000Z"
    }
  ]
}
```

---

#### `PUT /api/v1/users`

Atualiza um usuario.

**Escopo**: `write:users`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `id` | string | Sim | UID do usuario |
| `name` | string | Nao | Nome |
| `phone` | string | Nao | Telefone |
| `role` | string | Nao | `founder`, `admin`, `manager`, `operator`, `viewer` |
| `sectorIds` | string[] | Nao | IDs dos setores |
| `userStatus` | string | Nao | `online`, `busy`, `invisible`, `offline` |

---

### Kanban — Boards

#### `GET /api/v1/kanban/boards`

Lista boards do Kanban.

**Escopo**: `read:kanban`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `archived` | string | `true` ou `false` |
| `limit` | number | Itens por pagina |
| `offset` | number | Deslocamento |

**Resposta** `200 OK`:

```json
{
  "boards": [
    {
      "id": "board001",
      "businessId": "biz456",
      "name": "Sprint Q2",
      "description": "Tarefas do segundo trimestre",
      "color": "#7C3AED",
      "visibility": "sectors",
      "sectorIds": ["sector1"],
      "memberIds": ["uid001", "uid002"],
      "columns": [
        { "id": "col1", "title": "A Fazer", "color": "#6B7280" },
        { "id": "col2", "title": "Em Andamento", "color": "#F59E0B" },
        { "id": "col3", "title": "Concluido", "color": "#10B981" }
      ],
      "createdAt": "2025-03-01T08:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 5,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

---

#### `POST /api/v1/kanban/boards`

Cria um novo board.

**Escopo**: `write:kanban`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `name` | string | Sim | Nome do board |
| `description` | string | Nao | Descricao |
| `color` | string | Nao | Cor hex |
| `visibility` | string | Nao | `all`, `members`, `sectors` (padrao: `all`) |
| `columns` | array | Nao | Colunas iniciais. Se omitido, cria 3 colunas padrao |
| `columns[].title` | string | Sim | Titulo da coluna |
| `columns[].color` | string | Nao | Cor da coluna |

---

### Kanban — Cards

#### `GET /api/v1/kanban/cards`

Lista cards de um board.

**Escopo**: `read:kanban`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `boardId` | string | ID do board (obrigatorio) |
| `columnId` | string | Filtrar por coluna |
| `assignedTo` | string | Filtrar por responsavel |
| `limit` | number | Itens por pagina |
| `offset` | number | Deslocamento |

---

#### `POST /api/v1/kanban/cards`

Cria um novo card.

**Escopo**: `write:kanban`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `boardId` | string | Sim | ID do board |
| `columnId` | string | Sim | ID da coluna |
| `title` | string | Sim | Titulo do card |
| `description` | string | Nao | Descricao |
| `assignedTo` | string | Nao | UID do responsavel |
| `priority` | string | Nao | `low`, `medium`, `high`, `urgent` |
| `dueDate` | string | Nao | Data limite (YYYY-MM-DD) |
| `labels` | string[] | Nao | Tags |
| `order` | number | Nao | Posicao na coluna |

---

### Snippets (Respostas Rapidas)

#### `GET /api/v1/snippets`

Lista snippets/respostas rapidas.

**Escopo**: `read:snippets`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `category` | string | Filtrar por categoria |
| `sectorId` | string | Filtrar por setor |
| `search` | string | Busca por shortcode ou conteudo |
| `limit` | number | Itens por pagina |
| `offset` | number | Deslocamento |

**Resposta** `200 OK`:

```json
{
  "snippets": [
    {
      "id": "snp001",
      "businessId": "biz456",
      "shortcode": "boas-vindas",
      "content": "Ola! Seja bem-vindo(a) ao nosso atendimento. Como posso ajudar?",
      "category": "Atendimento",
      "sectorId": "sector1",
      "createdBy": "uid001",
      "createdAt": "2025-02-15T10:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 30,
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

---

#### `POST /api/v1/snippets`

Cria um novo snippet.

**Escopo**: `write:snippets`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `shortcode` | string | Sim | Atalho (ex: `boas-vindas`) |
| `content` | string | Sim | Conteudo da mensagem |
| `category` | string | Nao | Categoria |
| `sectorId` | string | Nao | ID do setor |

---

#### `PUT /api/v1/snippets`

Atualiza um snippet.

**Escopo**: `write:snippets`

**Request Body**: `id` (obrigatorio) + campos a atualizar.

---

### Conversas (Omnichannel)

#### `GET /api/v1/conversations`

Lista conversas omnichannel (WhatsApp, Facebook, Instagram).

**Escopo**: `read:conversations`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `channel` | string | `whatsapp`, `facebook`, `instagram` |
| `status` | string | Status da conversa |
| `assignedTo` | string | UID do atendente |
| `sectorId` | string | ID do setor |
| `search` | string | Busca por nome do contato |
| `limit` | number | Itens por pagina |
| `offset` | number | Deslocamento |

---

#### `POST /api/v1/conversations/send`

Envia uma mensagem em uma conversa.

**Escopo**: `write:conversations`

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `conversationId` | string | Sim | ID da conversa |
| `content` | string | Sim | Conteudo da mensagem |
| `channel` | string | Sim | `whatsapp`, `facebook`, `instagram` |
| `recipientId` | string | Sim | ID do destinatario na plataforma |
| `type` | string | Nao | `text`, `template`, `media` (padrao: `text`) |
| `templateName` | string | Nao | Nome do template (para type=template) |
| `templateLanguage` | string | Nao | Idioma do template (ex: `pt_BR`) |
| `templateParams` | array | Nao | Parametros do template |
| `mediaUrl` | string | Nao | URL da midia (para type=media) |
| `mediaType` | string | Nao | `image`, `video`, `audio`, `document` |

---

#### `GET /api/v1/conversations/messages`

Lista mensagens de uma conversa.

**Escopo**: `read:conversations`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `conversationId` | string | ID da conversa (obrigatorio) |
| `limit` | number | Mensagens por pagina |
| `offset` | number | Deslocamento |

---

### Fiscal — Documentos

#### `GET /api/v1/fiscal/documents`

Lista documentos fiscais emitidos.

**Escopo**: `read:fiscal`

**Query Parameters**:

| Parametro | Tipo | Descricao |
|-----------|------|-----------|
| `type` | string | `nfse`, `nfce`, `nfe` |
| `status` | string | `rascunho`, `processando`, `autorizada`, `rejeitada`, `cancelada`, `erro` |
| `search` | string | Busca por chave de acesso, numero ou destinatario |
| `limit` | number | Itens por pagina |
| `offset` | number | Deslocamento |

**Resposta** `200 OK`:

```json
{
  "documents": [
    {
      "id": "fiscal001",
      "businessId": "biz456",
      "type": "nfe",
      "status": "autorizada",
      "numero": 1234,
      "serie": "1",
      "chaveAcesso": "35250312345678000190550010001234561123456784",
      "protocolo": "135250000123456",
      "valor": 1500.00,
      "destinatario": {
        "name": "Empresa X",
        "document": "12345678000190"
      },
      "emitidaEm": "2025-03-15T10:00:00.000Z",
      "createdAt": "2025-03-15T10:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 450,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

---

### Fiscal — Emissao

#### `POST /api/fiscal/emit`

Emite uma Nota Fiscal Eletronica (NFe ou NFCe).

**Autenticacao**: Sessao Firebase Auth

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `type` | string | Sim | `nfe` ou `nfce` |
| `businessId` | string | Sim | ID do business |
| `items` | array | Sim | Itens da nota fiscal |
| `items[].code` | string | Sim | Codigo do produto |
| `items[].description` | string | Sim | Descricao |
| `items[].ncm` | string | Sim | NCM |
| `items[].cfop` | string | Sim | CFOP |
| `items[].unit` | string | Sim | Unidade (UN, KG, etc.) |
| `items[].quantity` | number | Sim | Quantidade |
| `items[].unitPrice` | number | Sim | Preco unitario |
| `items[].discount` | number | Nao | Desconto |
| `items[].icmsAliquota` | number | Nao | Aliquota ICMS |
| `items[].icmsOrigem` | string | Nao | Origem do ICMS (0-8) |
| `items[].icmsSituacaoTributaria` | string | Nao | CST ICMS |
| `items[].pisSituacaoTributaria` | string | Nao | CST PIS |
| `items[].cofinsSituacaoTributaria` | string | Nao | CST COFINS |
| `recipient` | object | Nao | Destinatario (obrigatorio para NFe) |
| `recipient.document` | string | Sim | CPF ou CNPJ |
| `recipient.name` | string | Sim | Nome/Razao Social |
| `recipient.email` | string | Nao | E-mail |
| `recipient.address` | object | Nao | Endereco completo |
| `paymentMethod` | string | Nao | Forma de pagamento |
| `paymentValue` | number | Nao | Valor do pagamento |
| `informacoesAdicionais` | string | Nao | Informacoes complementares |
| `certificado` | object | Nao | Certificado digital (se nao salvo no business) |
| `certificado.pfxBase64` | string | Sim | Certificado PFX em Base64 |
| `certificado.password` | string | Sim | Senha do certificado |

**Resposta** `200 OK`:

```json
{
  "success": true,
  "data": {
    "chaveAcesso": "35250312345678000190550010001234561123456784",
    "protocolo": "135250000123456",
    "status": "autorizada",
    "xml": "<nfeProc>...</nfeProc>",
    "sefazResponse": { }
  }
}
```

---

### Fiscal — Consulta

#### `POST /api/fiscal/query`

Consulta uma nota fiscal na SEFAZ.

**Autenticacao**: Sessao Firebase Auth

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `type` | string | Sim | `nfse`, `nfse-dps`, `nfe`, `nfce` |
| `chaveAcesso` | string | Condicional | Chave de acesso (44 digitos para NFe/NFCe, 50 para NFSe) |
| `idDPS` | string | Condicional | ID da DPS (para NFSe) |
| `ufEmitente` | string | Nao | UF do emitente |
| `certificado` | object | Nao | Certificado digital |

---

### Fiscal — Cancelamento

#### `POST /api/fiscal/cancel`

Cancela uma nota fiscal emitida.

**Autenticacao**: Sessao Firebase Auth

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `type` | string | Sim | `nfse`, `nfe`, `nfce` |
| `chaveAcesso` | string | Sim | Chave de acesso da nota |
| `protocolo` | string | Nao | Protocolo de autorizacao (NFe/NFCe) |
| `justificativa` | string | Sim | Motivo do cancelamento (15-255 caracteres) |
| `ufEmitente` | string | Nao | UF do emitente |
| `certificado` | object | Nao | Certificado digital |

**Resposta** `200 OK`:

```json
{
  "success": true,
  "data": {
    "status": "cancelada",
    "protocolo": "135250000654321",
    "dataHora": "2025-03-20T16:00:00.000Z"
  }
}
```

---

### Fiscal — Carta de Correcao

#### `POST /api/fiscal/carta-correcao`

Emite uma Carta de Correcao Eletronica (CC-e) para NFe.

**Autenticacao**: Sessao Firebase Auth

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `chaveAcesso` | string | Sim | Chave de acesso da NFe (44 digitos) |
| `sequencia` | number | Sim | Numero sequencial da correcao |
| `textoCorrecao` | string | Sim | Texto da correcao (15-1000 caracteres) |
| `ufEmitente` | string | Nao | UF do emitente |
| `certificado` | object | Sim | Certificado digital (pfxBase64 + password) |

**Resposta** `200 OK`:

```json
{
  "success": true,
  "data": {
    "status": "registrada",
    "protocolo": "135250000789012",
    "dataHora": "2025-03-20T17:00:00.000Z"
  }
}
```

---

### Fiscal — Inutilizacao

#### `POST /api/fiscal/inutilizar`

Inutiliza uma faixa de numeracao de notas fiscais.

**Autenticacao**: Sessao Firebase Auth

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `ano` | number | Sim | Ano da numeracao |
| `serie` | string | Sim | Serie da NF |
| `numeroInicial` | number | Sim | Numero inicial da faixa |
| `numeroFinal` | number | Sim | Numero final da faixa |
| `justificativa` | string | Sim | Motivo (15-255 caracteres) |
| `ufEmitente` | string | Sim | UF do emitente (ex: `35` para SP) |
| `cnpj` | string | Sim | CNPJ do emitente |
| `modelo` | string | Sim | `55` (NFe) ou `65` (NFCe) |
| `certificado` | object | Sim | Certificado digital (pfxBase64 + password) |

**Resposta** `200 OK`:

```json
{
  "success": true,
  "data": {
    "status": "inutilizada",
    "protocolo": "135250000345678",
    "dataHora": "2025-03-20T18:00:00.000Z"
  }
}
```

---

### Fiscal — Status SEFAZ

#### `POST /api/fiscal/status`

Verifica a disponibilidade dos servicos da SEFAZ.

**Autenticacao**: Sessao Firebase Auth

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `ufEmitente` | string | Sim | UF a consultar |
| `certificado` | object | Sim | Certificado digital (pfxBase64 + password) |

**Resposta** `200 OK`:

```json
{
  "success": true,
  "data": {
    "status": "operacional",
    "tpAmb": "1",
    "verAplic": "SP_NFE_PL_008i2",
    "cStat": "107",
    "xMotivo": "Servico em Operacao",
    "dhRecbto": "2025-03-20T19:00:00.000Z"
  }
}
```

---

### Fiscal — Certificado Digital

#### `POST /api/fiscal/certificate/upload`

Faz upload de um certificado digital A1 (.pfx ou .p12).

**Autenticacao**: Sessao Firebase Auth

**Content-Type**: `multipart/form-data`

**Form Data**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `file` | File | Sim | Arquivo .pfx ou .p12 (max 256KB) |
| `password` | string | Sim | Senha do certificado |
| `businessId` | string | Sim | ID do business (ou header `x-business-id`) |

**Resposta** `200 OK`:

```json
{
  "success": true,
  "certificate": {
    "serialNumber": "123456789",
    "subject": "CN=EMPRESA LTDA:12345678000190",
    "validFrom": "2025-01-01T00:00:00.000Z",
    "expiresAt": "2026-01-01T00:00:00.000Z",
    "storagePath": "businesses/biz456/certificates/cert.pfx"
  }
}
```

---

### Fiscal — DANFE

#### `POST /api/fiscal/danfe`

Gera o DANFE (Documento Auxiliar da Nota Fiscal Eletronica) a partir do XML.

**Autenticacao**: Sessao Firebase Auth

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `xml` | string | Sim | XML completo da nota fiscal |
| `type` | string | Nao | `nfce` ou `nfe` (padrao: `nfe`) |

**Resposta**: HTML para impressao (Content-Type: `text/html`)

---

### Broadcasts (Campanhas)

#### `POST /api/broadcasts/send`

Dispara uma campanha de mensagens em massa.

**Autenticacao**: Sessao Firebase Auth

**Rate Limit**: 5 requisicoes/minuto

**Request Body**:

| Campo | Tipo | Obrigatorio | Descricao |
|-------|------|-------------|-----------|
| `businessId` | string | Sim | ID do business |
| `broadcastId` | string | Sim | ID da campanha |
| `channel` | string | Sim | `whatsapp`, `facebook`, `instagram` |
| `recipients` | array | Sim | Lista de destinatarios |
| `recipients[].contactId` | string | Sim | ID do contato CRM |
| `recipients[].contactName` | string | Sim | Nome do contato |
| `recipients[].recipientId` | string | Sim | ID na plataforma (numero WhatsApp, PSID, etc.) |
| `templateName` | string | Nao | Nome do template (WhatsApp) |
| `templateLanguage` | string | Nao | Idioma do template (ex: `pt_BR`) |
| `templateParams` | array | Nao | Parametros do template |
| `messageContent` | string | Nao | Conteudo da mensagem (Facebook/Instagram) |
| `sendRate` | number | Nao | Mensagens por segundo (padrao: 10) |
| `phoneNumberId` | string | Nao | ID do numero WhatsApp (obrigatorio para WhatsApp) |

**Resposta** `200 OK`:

```json
{
  "success": true,
  "broadcastId": "bcast001",
  "stats": {
    "total": 150,
    "sent": 148,
    "failed": 2
  },
  "results": [
    {
      "contactId": "contact001",
      "contactName": "Maria Silva",
      "recipientId": "5511999887766",
      "status": "sent",
      "externalMessageId": "wamid.xxxxx"
    }
  ]
}
```

---

## Exemplos com cURL

### Listar contatos CRM

```bash
curl -X GET "https://seu-dominio.com/api/v1/crm/contacts?status=qualificado&limit=10" \
  -H "Authorization: Bearer sp_live_xxxxxxxxxxxxx"
```

### Criar um agendamento

```bash
curl -X POST "https://seu-dominio.com/api/v1/appointments" \
  -H "Authorization: Bearer sp_live_xxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "client789",
    "clientName": "Maria Silva",
    "serviceName": "Consultoria",
    "date": "2025-04-01",
    "startTime": "14:00",
    "duration": 60,
    "price": 200.00
  }'
```

### Registrar uma venda

```bash
curl -X POST "https://seu-dominio.com/api/v1/sales" \
  -H "Authorization: Bearer sp_live_xxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "description": "Produto A", "quantity": 2, "unitPrice": 50.00, "total": 100.00 }
    ],
    "payments": [
      { "method": "pix", "amount": 100.00 }
    ],
    "clientName": "Carlos Souza"
  }'
```

### Buscar produtos com estoque baixo

```bash
curl -X GET "https://seu-dominio.com/api/v1/products?stockStatus=low&active=true" \
  -H "x-api-key: sp_live_xxxxxxxxxxxxx"
```

### Criar uma transacao financeira

```bash
curl -X POST "https://seu-dominio.com/api/v1/transactions" \
  -H "Authorization: Bearer sp_live_xxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "receita",
    "category": "Servicos",
    "description": "Pagamento mensal",
    "amount": 5000.00,
    "dueDate": "2025-04-01",
    "paymentMethod": "pix"
  }'
```

### Enviar mensagem via WhatsApp

```bash
curl -X POST "https://seu-dominio.com/api/v1/conversations/send" \
  -H "Authorization: Bearer sp_live_xxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "conv001",
    "content": "Ola! Seu agendamento foi confirmado para amanha as 14h.",
    "channel": "whatsapp",
    "recipientId": "5511999887766"
  }'
```

---

## Paginacao

Todos os endpoints de listagem suportam paginacao via `limit` e `offset`:

```
GET /api/v1/crm/contacts?limit=20&offset=0   # Pagina 1
GET /api/v1/crm/contacts?limit=20&offset=20   # Pagina 2
GET /api/v1/crm/contacts?limit=20&offset=40   # Pagina 3
```

A resposta inclui metadados de paginacao:

```json
{
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

---

## Notas para Agentes de IA

1. **Multi-tenant**: Todas as operacoes sao automaticamente filtradas pelo `businessId` da API Key. Nao e necessario (nem possivel) informar o `businessId` nas chamadas v1.

2. **Idempotencia**: POST nao e idempotente — chamadas duplicadas criam registros duplicados. Use GET para verificar antes de criar.

3. **Datas**: Use formato ISO 8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`) para timestamps e `YYYY-MM-DD` para datas. Horarios usam formato `HH:mm` (24h).

4. **Moeda**: Todos os valores monetarios sao em BRL (Real Brasileiro) com precisao de 2 casas decimais.

5. **Limites de paginacao**: Maximo de 200 itens por requisicao. Padrao: 50.

6. **Status de presenca**: O campo `userStatus` segue 3 estados visiveis: `online` (verde), `busy` (ambar), `offline` (cinza). Usuarios com `userStatus: 'invisible'` aparecem como `offline`.

7. **Webhooks**: Para receber notificacoes em tempo real (novas mensagens, mudancas de status), configure webhooks Meta em `/api/webhooks/meta`.

8. **Certificado digital**: Operacoes fiscais (emissao, cancelamento, consulta) requerem certificado A1 valido. O certificado pode ser enviado em cada requisicao ou pre-cadastrado via upload.
