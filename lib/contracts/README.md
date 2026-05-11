# `lib/contracts/` — Spec-Driven Development

> **Toda feature nova começa aqui.** Antes de qualquer route, componente ou Firestore write, declare o contrato. A IA e os humanos leem este diretório como **fonte da verdade** da forma das coisas.

## Estrutura

```
lib/contracts/
├── domain/        # Entidades de domínio: Zod schema + invariantes + FSM associada
├── api/           # Schemas de request/response por route
│   ├── v1/        # Public API (Bearer SaasApiKey)
│   ├── agent/     # Tools do agente (HMAC) — input + output
│   └── webhooks/  # Payloads externos (Meta, Baileys, SEFAZ)
├── events/        # Eventos cross-módulo (discriminated union)
├── fsm/           # Máquinas de estado declarativas
└── _template/     # Modelos para copiar ao criar um novo contrato
```

## As 3 camadas

### 1. Domínio (`domain/`)
Espelha as entidades de `lib/types/index.ts` com Zod. O Zod schema é a fonte da verdade; o tipo TS é **derivado** (`z.infer<typeof SaleSchema>`). Aqui também ficam **invariantes** — regras que `superRefine` valida (ex: `total === sum(items) - discount + taxes`).

### 2. API (`api/`)
Cada route tem `RequestSchema` e `ResponseSchema`. O handler wrapper (`lib/contracts/_runtime/withContract.ts`) valida entrada e saída. Sem schema → route não passa em PR.

### 3. Eventos (`events/`)
Fecha o gap mais perigoso do sistema: side-effects implícitos entre módulos. Cada evento tem payload tipado e lista de subscribers conhecidos. Não é event bus de runtime obrigatório — começa como **registro** + `dispatchDomainEvent()` que enfileira reações conhecidas.

## Regras duras

1. **Toda entidade em `lib/types/index.ts` que é escrita no Firestore precisa de schema em `domain/`** com `businessId` validado.
2. **Toda route em `app/api/v1/*` e `app/api/agent/tools/*` precisa de Request + Response schema em `api/`.**
3. **Toda transição de status `string` precisa de FSM em `fsm/`** com transições válidas declaradas.
4. **Toda mudança de estado que dispara side-effect em outro módulo precisa de evento em `events/`** (ainda que sem subscribers).
5. **Idempotência é parte do contrato.** Endpoints POST que criam recursos aceitam header `X-Idempotency-Key` declarado no schema.
6. **Type inference em vez de duplicação.** `type Sale = z.infer<typeof SaleSchema>` — nunca redeclarar.

## Workflow (siga ao codar feature nova)

```
1. Leia contratos relacionados em lib/contracts/
2. Se a entidade/route/evento não tem schema → CRIE PRIMEIRO
3. PR de schema é review separado de PR de implementação (idealmente)
4. Implementação usa z.infer e .parse() no boundary
5. Teste do contrato vive em __tests__/contracts/
```

## Por que não OpenAPI direto?

Zod gera OpenAPI via `@asteasolutions/zod-to-openapi`. TS-first → validação runtime grátis, tipos derivados, ergonomia melhor. OpenAPI fica como **artefato derivado** (`pnpm contracts:openapi`) para consumidores externos.

## Roadmap

Ver `docs/sdd-roadmap.md` para a ordem de adoção e estado atual.

## Dependências necessárias

```bash
npm install zod @asteasolutions/zod-to-openapi
```

Adicione ao `tsconfig.json`:
```json
"paths": { "@/contracts/*": ["./lib/contracts/*"] }
```
