# Runbook — operações comerciais travadas (M02.9)

> Escopo mínimo, dado que depende diretamente da auditoria abaixo (item novo
> desta fatia). Cobre só o que existe hoje — nenhuma ferramenta aspiracional.

## Contexto

O coordenador de operação comercial (`lib/services/commercial-operation-admin.ts`,
M02.2) grava um documento em `commercialOperations/{operationId}` por checkout/
transição, com `status` (`pending`/`running`/`failed`/`completed`/
`compensation_pending`/`compensating`/`compensated`) e um `lease` (token +
`expiresAt`) que sinaliza "alguém está processando isto agora". Uma operação
fica **travada** quando está fora de estado terminal (`completed`/`compensated`)
e não tem lease ativo — ninguém está processando-a, e nada a retoma sozinha.

Não há hoje incidente documentado de operação travada em produção. Este
runbook existe porque, até esta fatia, não havia sequer um jeito de *encontrar*
uma — só de descobrir por acaso (cliente reclama que sumiu um pagamento).

## Como encontrar operações travadas

```bash
npm run audit:m02 -- --businessId=<id-do-tenant>
```

O script (`scripts/audit-m02-commercial.ts`) lê `sales`, `deliveryOrders`,
`orders`, `transactions`, `stockMovements`, `couponRedemptions`,
`giftCardRedemptions`, `loyaltyTransactions`, `fiscalDocuments` e
`commercialOperations` do tenant e imprime um JSON com `issues[]`. Procure por
`code: "STUCK_OPERATION"` — o `entityKey` é `commercialOperation:{operationId}`.

Saída não-zero (`process.exitCode = 2`) quando há qualquer issue — útil pra
rodar num pipeline de verificação periódica no futuro, se algum dia isso virar
necessário (não é hoje).

## O que fazer com uma operação travada

1. **Inspecionar manualmente** o documento no console do Firebase:
   `commercialOperations/{operationId}`. Confira `status`, `currentCheckpoint`,
   `checkpoints`, `lastError`, `attempts`, `result.documentId`
   (Sale/DeliveryOrder/Order vinculado).
2. **Ler o documento de origem** (`sales`/`deliveryOrders`/`orders` pelo
   `result.documentId`, ou pelo `documentCollection`+`documentId` do request se
   `result` ainda não existe) — confira se ele já reflete os efeitos esperados
   (estoque, transação, benefícios) apesar da operação não estar `completed`.
   Isso acontece quando um checkpoint terminou mas a operação não chegou a
   marcar `completed` (crash entre os dois writes) — nesse caso o documento de
   origem já está correto e a operação travada é só um resíduo de bookkeeping.
3. **Se o documento de origem NÃO reflete os efeitos esperados**: a operação
   realmente falhou no meio do caminho. Duas rotas, dependendo do canal:
   - **Retomar**: repetir a MESMA requisição original (mesmo
     `X-Idempotency-Key`/carrinho) pelo canal de origem (PDV, checkout público,
     API v1, agente) — o coordenador reconhece o `idempotencyKey` e retoma a
     partir do último checkpoint concluído (`lib/contracts/domain/
     commercialOperation.ts`, `requestFingerprint`). Não recriar do zero.
   - **Compensar manualmente**: se retomar não é possível (ex: estoque não
     existe mais, cliente já foi embora), usar `compensateCommercialBenefitsAdmin`
     (`lib/services/commercial-benefits-admin.ts`) e/ou `transitionTransactionSafeAdmin`
     pra reverter efeitos parciais já aplicados — mesmas funções que
     `sale-transition-admin.ts`/`order-transition-admin.ts` usam pra
     cancelamento. Exige acesso ao Admin SDK (script/console), não há rota de
     UI pra isso.
4. **Documentar o caso** (mesmo que informalmente, num commit ou ticket) — não
   existe hoje um segundo tenant real acumulando histórico disso; o primeiro
   caso real que aparecer deve virar o motivador de uma automação (cron de
   sweep, alerta), não este runbook sozinho.

## O que NÃO existe ainda (deliberado)

- **Sweep automático em background** — nada hoje escaneia `commercialOperations`
  periodicamente por conta própria; a auditoria é sempre sob demanda
  (`npm run audit:m02`). Só faz sentido construir um cron/alerta quando houver
  sinal real de operações travadas se acumulando — hoje é especulativo.
- **Painel de UI** — mesma razão (`M02_PLANO_IMPLEMENTACAO.md`, seção M02.8,
  item "estado composto da operação").
- **Reconciliação automática** — a retomada/compensação acima é sempre manual,
  guiada por um humano lendo o `commercialOperations` doc. Automatizar a
  DECISÃO (retomar vs. compensar) exigiria confiança que não existe ainda sem
  casos reais pra calibrar contra.

## Ver também

- `docs/paridade/M02_COORDENADOR_OPERACOES.md` — arquitetura do coordenador
  (checkpoints, lease, idempotência).
- `docs/paridade/M02_BENEFICIOS.md` — ledgers de cupom/gift card/fidelidade
  que `compensateCommercialBenefitsAdmin` reverte.
- `docs/paridade/M02_PLANO_IMPLEMENTACAO.md` (seção M02.7) — o mesmo padrão de
  reconstrução de `CommercialOperationHandlerContext` a partir do doc
  persistido, usado pra cancelamento de Sale.
