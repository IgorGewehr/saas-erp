# Financeiro — baseline/auditoria (M03.0)

> Concluído em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: segunda fatia de execução do M03 (`docs/paridade/M03_PLANO_IMPLEMENTACAO.md`), logo
> após M03.5 (testes de conciliação). Mesmo racional de M01/M02/M06: medir o estrago real nos
> dados antes de endurecer qualquer regra.

## 1. O que foi entregue

- `lib/services/m03-financial-audit.ts` — camada PURA (sem Firestore/React), mesmo formato de
  `m06-agenda-audit.ts`: recebe documentos já lidos de `transactions` + as 4 coleções de origem
  (`sales`, `purchaseNotes`, `appointments`, `deliveryOrders`) e devolve um snapshot com issues
  tipadas + resumo numérico. Também exporta `compareM03FinancialSnapshots` (antes/depois),
  reaproveitável nas fatias futuras (M03.2/M03.3) pra confirmar que uma migração não introduziu
  regressão nos dados.
- `scripts/audit-m03-financial.ts` — CLI (`npm run audit:m03 -- --businessId=... [--output=...]
  [--baseline=...]`), mesmo formato de `scripts/audit-m06-agenda.ts`. Paginado por
  `FieldPath.documentId()`, sem índice novo.
- 8 códigos de problema, cada um mapeado a uma lacuna concreta encontrada na investigação de
  abertura do M03 (`docs/paridade/M03_PLANO_IMPLEMENTACAO.md` §0):

  | Código | O que mede |
  |---|---|
  | `TENANT_MISMATCH` | Documento retornado pra este tenant mas com `businessId` de outro. |
  | `INVALID_TYPE` | `type` fora de `receita`\|`despesa` — `firestore.rules` só valida na escrita; mede se algo já escapou (Admin SDK, dado legado). |
  | `INVALID_STATUS` | `status` fora do enum do FSM (`pendente`\|`pago`\|`atrasado`\|`cancelado`). |
  | `NON_POSITIVE_AMOUNT` | `amount <= 0` — nenhuma camada (rules, FSM, os 13 caminhos de escrita) valida isso hoje. |
  | `INSTALLMENT_COUNT_MISMATCH` | Contagem real de parcelas de um `installmentGroupId` diverge do `installmentTotal` declarado. |
  | `ORPHAN_RECURRENCE` | `recurrenceId` aponta pra uma transação "cabeça" de série que não existe mais. |
  | `BROKEN_SOURCE_REFERENCE` | `saleId`/`purchaseNoteId`/`appointmentId`/`deliveryOrderId` aponta pra um documento de origem inexistente. |
  | `DUPLICATE_SOURCE_TRANSACTION` | 2+ transações ATIVAS (não-canceladas) compartilham a mesma origem+tipo — o double-click já auto-documentado em `AGENDA_COBRANCA.md`, agora medível em qualquer uma das 4 origens, não só Agenda. |

## 2. Por que só estes 8 códigos (escopo)

Os 5 primeiros bullets do checklist M03.0 original viraram 6 códigos (o item "status fora do
enum válido pra sua sequência de transições" foi desdobrado em `INVALID_TYPE`+`INVALID_STATUS`+
`NON_POSITIVE_AMOUNT`, já que os três são igualmente baratos de medir e compartilham a mesma
causa raiz: validação rasa hoje). **Violação de transição do FSM** (ex.: pular de `pendente`
direto pra `atrasado` sem nunca ter passado por uma regra que permita isso) foi deliberadamente
**não incluída** — um snapshot de UM instante não vê histórico de mudanças de status, só o
estado atual; medir isso exigiria um changelog de auditoria ou enforcement ao vivo, que é
trabalho de M03.4, não de M03.0.

## 3. Verificação

`tsc --noEmit` limpo. Suíte completa sem regressão (contagem exata no commit). 16 testes novos
em `tests/services/m03FinancialAudit.test.ts` — dataset limpo (zero issues), dataset com um
exemplo de cada issue, e comparação antes/depois. **Não executado contra um tenant real** —
mesma situação já registrada em M06.0 (cliente ainda não está em produção no sistema); o script
`scripts/audit-m03-financial.ts` está pronto pra rodar assim que houver um tenant real disponível.

## 4. Próxima etapa recomendada

M03.1 — promover `lib/contracts/fsm/transaction.ts` (já existe, só o FSM) + o `Transaction` de
`lib/types/index.ts` pra um contrato de domínio completo em `lib/contracts/domain/transaction.ts`
(pré-requisito SDD, R2, já auto-apontado como TODO no próprio arquivo do FSM).
