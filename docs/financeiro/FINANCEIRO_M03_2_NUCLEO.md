# Financeiro — núcleo de criação/transição (M03.2)

> Concluído em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: quarta fatia de execução do M03 (`docs/paridade/M03_PLANO_IMPLEMENTACAO.md`),
> logo após o contrato de domínio (M03.1). Não depende da decisão V1 vs V2 (M03.6).

## 1. O que existia

Nenhum núcleo genérico de criação/transição de `Transaction` — os 5 caminhos já hardenizados
(venda PDV, contas a pagar de compra, delivery, estorno, liquidação Mercado Pago) são efeitos
colaterais de OUTROS módulos, cada um com sua própria lógica específica. O formulário manual
(clássico, V2) e as integrações (API v1, agente) sempre escreveram direto (client SDK ou
`adminDb.collection('transactions').add()`), sem idempotência real nem FSM aplicado.

## 2. O que foi entregue

Novo `lib/services/transactionTxGuardAdmin.ts` (Admin SDK — ver §3 sobre a ausência deliberada
de um guard client SDK), duas funções:

- **`createTransactionSafeAdmin`** — idempotência real via **ID determinístico + `tx.create()`**,
  mesmo padrão já usado pelo caminho mais robusto existente
  (`lib/services/purchase-financial-admin.ts`): o Firestore rejeita atomicamente `tx.create()`
  se o documento já existe — não precisa de lock separado nem claim-doc. A chave de
  idempotência é derivada de `saleId`/`purchaseNoteId`/`appointmentId`/`deliveryOrderId` + `type`
  (+ `installmentNumber` quando presente, pra não colapsar parcelas distintas da mesma origem na
  mesma chave) — **a MESMA combinação que `m03-financial-audit.ts` usa como chave de
  duplicidade** (`DUPLICATE_SOURCE_TRANSACTION`), de propósito: o guard previne exatamente o que
  a auditoria mede. Um `idempotencyKey` explícito do caller (R3) tem prioridade sobre a chave
  derivada. Sem nenhuma das duas (lançamento manual puro, sem origem), cria direto — mesmo
  comportamento de hoje pra esse caso específico, sem identidade estável pra checar contra.
- **`transitionTransactionSafeAdmin`** — aplica `assertTransitionTransaction` (o FSM que já
  existia em `lib/contracts/fsm/transaction.ts` desde antes, mas nunca era invocado por nenhum
  dos 13 caminhos de escrita) antes de qualquer mudança de status. Re-lê o documento fresco
  dentro da transação (nunca confia no status que o caller acha que é o atual) e valida
  isolamento de tenant.

## 3. Decisão deliberada: sem guard client SDK nesta fatia

O plano original do M03.2 cogitava um par client+admin, mirror de
`appointmentTxGuard(Admin).ts`. Decidido não construir a versão client SDK agora: diferente da
Agenda (calendário em tempo real, UI otimista com `onSnapshot`, múltiplos operadores editando o
mesmo dia simultaneamente), não há hoje um caso de uso comprovado de escrita direta
browser→Firestore com pré-check local pra `Transaction` — os caminhos já hardenizados do
Financeiro (Sales/Purchases/Delivery) são todos Admin SDK via rota server-side, não client SDK.
Se a migração do clássico/V2 (M03.3) revelar necessidade real de um guard client-side, ele é
construído então, informado pela experiência real da migração — não especulativamente aqui.

## 4. O que fica de fora (deliberado)

- Nenhuma rota (`POST /api/transactions`) ou UI foi migrada pra usar este guard ainda — essa é a
  definição de M03.3. Este núcleo existe, mas ainda não está "ligado" em nenhum caminho real.
- Validação de shape completo (Zod, `TransactionSchema`) **não** acontece dentro do guard —
  por design (R6): o guard confia no tipo (`AdminTransactionPayload`, shape mínimo pra
  idempotência/tenant), a validação completa é responsabilidade do BOUNDARY (a rota que vai
  chamar o guard em M03.3), mesmo padrão de `createAppointmentSafeAdmin`/`AdminAppointmentPayload`.

## 5. Verificação

Novo `tests/services/transactionTxGuardAdmin.test.ts` — 12 casos: criação sem chave possível
(cria direto); `businessId` vazio rejeitado; mesma origem+tipo chamada 2x → segunda é replay
idempotente sem duplicar (fecha o double-click da `AGENDA_COBRANCA.md`); parcelas distintas da
mesma origem (installmentNumber diferente) não colidem; origens diferentes nunca colidem;
`idempotencyKey` explícito tem prioridade sobre a chave derivada; chave gravada no documento
pra rastreabilidade; transição válida aplica patch adicional; transição inválida (FSM, terminal)
lança; transição pro mesmo status é no-op permitido; id inexistente e tenant cruzado lançam os
erros tipados corretos.

`tsc --noEmit` limpo. Suíte completa sem regressão (contagem exata no commit).

## 6. Próxima etapa recomendada

M03.3 — migrar os caminhos de maior risco pro núcleo, na ordem: API v1 (`app/api/v1/
transactions/route.ts`, maior exposição externa, validação ad-hoc hoje) e o tool do agente
(`app/api/agent/tools/financial/route.ts`, já tem Zod no boundary, falta idempotência)
primeiro; depois o formulário manual do clássico/V2 e a reversão de venda do PDV
(`PDVModule.tsx`, hoje um `updateDoc` cru ignorando o FSM que a criação da mesma venda já
respeita).
