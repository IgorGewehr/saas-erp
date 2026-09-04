# Financeiro — contrato de domínio Transaction (M03.1)

> Concluído em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: terceira fatia de execução do M03 (`docs/paridade/M03_PLANO_IMPLEMENTACAO.md`),
> pré-requisito SDD (R2 do CLAUDE.md) pra tudo que vem depois (M03.2, o núcleo de criação/
> transição). Não depende da decisão V1 vs V2 (M03.6).

## 1. O que existia

`lib/contracts/fsm/transaction.ts` já tinha o FSM de status (`TRANSACTION_STATUSES`,
`TransactionStatusSchema`, transições), mas o próprio arquivo se auto-documentava como
provisório: "TODO(auditoria P3.6/R2): promover o status para um contrato de domínio completo em
`lib/contracts/domain/transaction.ts` (Transaction ainda vive como interface em
`lib/types/index.ts`)." O resto do `Transaction` (~45 campos) nunca teve representação Zod —
só a interface TS solta, sem validação em NENHUMA camada (nem rules, nem API, nem cliente).

## 2. Achado real durante a investigação: 3 fontes de verdade pro mesmo enum

Ao promover o status, a busca por quem já usava `TransactionStatusSchema`/`TransactionTypeSchema`
revelou uma **terceira** declaração independente, hardcoded, em
`lib/contracts/api/agent/_shared.ts` — usada pelo contrato do agente
(`lib/contracts/api/agent/financial.ts`, consumido por `app/api/agent/tools/financial/route.ts`).
Os VALORES batiam (`receita`/`despesa`, `pendente`/`pago`/`atrasado`/`cancelado`) — não é um bug
de comportamento hoje —, mas é exatamente o tipo de drift que o R2 do CLAUDE.md existe pra
evitar: 3 lugares declarando o mesmo enum, nenhum deles a fonte canônica, um deles poderia
divergir silenciosamente no futuro sem ninguém perceber.

## 3. O que foi entregue

- **Novo `lib/contracts/domain/transaction.ts`** — contrato de domínio completo (`TransactionSchema`,
  Zod + `z.infer`), espelhando fielmente `lib/types/index.ts:Transaction` (~45 campos, incluindo
  os objetos aninhados `recurrence`/`attachments`). `TRANSACTION_STATUSES`/`TransactionStatusSchema`
  **movidos pra cá** (antes viviam no FSM) — agora o domínio é a fonte e o FSM importa de volta,
  o MESMO sentido de dependência já usado em `fsm/appointment.ts → domain/appointment.ts` (nunca
  o contrário). Também declara `TransactionTypeSchema`/`TransactionPaymentMethodSchema`/
  `TransactionChannelTypeSchema`/`TransactionSourceTypeSchema`/`RecurrenceFrequencySchema`.
- **`lib/contracts/fsm/transaction.ts` atualizado**: TODO resolvido, agora só importa
  `type TransactionStatus` de `../domain/transaction` (o que sobrava, `TRANSACTION_STATUSES`/
  `TransactionStatusSchema`, não tinha nenhum consumidor externo além do próprio domínio —
  removido em vez de mantido como re-export morto).
- **`lib/contracts/api/agent/_shared.ts` corrigido**: `TransactionTypeSchema`/
  `TransactionStatusSchema` hardcoded substituídos por import de `../../domain/transaction` —
  fecha o drift de 3 fontes → 1.
- **Invariantes novas (`superRefine`)**: `installmentTotal`/`installmentNumber` exigem
  `installmentGroupId` (parcela sem grupo não faz sentido); `installmentNumber` não pode exceder
  `installmentTotal`.
- **`amount` agora é `.positive()` (regra rígida, não `.nonnegative()`)** — decisão deliberada:
  como nenhum tenant real está em produção neste sistema ainda (ver
  `docs/paridade/M03_PLANO_IMPLEMENTACAO.md`), dá pra começar com a regra certa desde o primeiro
  dia em vez de afrouxar e ter que apertar depois com dado real já violando.

## 4. O que fica de fora (deliberado)

- **Discriminated union completa por "tipo de lançamento"** (à vista/parcelado/recorrente),
  cogitada no plano original do M03.1 — decidir o shape mínimo por variante depende de observar
  os 13 write paths reais sendo migrados em M03.2/M03.3. Fazer isso agora, especulativamente,
  arriscaria um contrato que rejeita um formato que algum caminho hoje já usa legitimamente.
- **`PaymentMethodSchema` em `_shared.ts`** — achado de passagem, **não corrigido**: tem valores
  DIFERENTES do `PaymentMethod` real de `lib/types/index.ts` (`cartao_loja` vs `creditoLoja`,
  `transferencia` inexistente no tipo real, `pontos`/`gift_card`/`semPagamento` ausentes no
  schema do agente). Investigar se isso já causou rejeição real em produção é escopo próprio,
  fora desta consolidação de status/type.
- **Violação de transição do FSM** — segue não-enforced por nenhum dos 13 caminhos de escrita
  (mesmo achado do M03.0); este contrato valida SHAPE, não histórico de transição. Enforcement
  ao vivo é trabalho de M03.4.
- Nenhuma rota/UI foi migrada pra usar `TransactionSchema.parse()` ainda — essa é a definição do
  M03.2 (o núcleo de criação/transição que ainda não existe).

## 5. Verificação

Novo `tests/contracts/transactionDomain.test.ts` — 17 casos: transação mínima válida; type/
status/amount/description/businessId inválidos rejeitados; `paymentMethod` aceita os 10 valores
reais (não os do agente); as 3 invariantes de parcelamento (grupo sem total, number sem
grupo, number > total); `recurrence` aninhada (frequency válida/inválida, `dayOfMonth` fora do
intervalo 1-28); `attachments` com shape completo.

`tsc --noEmit` limpo (confirma que os 2 consumidores externos de `fsm/transaction.ts` —
`BaixaDialog.tsx` e `app/api/agent/tools/financial/route.ts` — continuam resolvendo depois da
mudança de fonte do enum). Suíte completa sem regressão (contagem exata no commit).

## 6. Próxima etapa recomendada

M03.2 — `lib/services/transactionTxGuard.ts` (client SDK) + `transactionTxGuardAdmin.ts` (Admin
SDK), mirror de `appointmentTxGuard(Admin).ts`: criação com idempotência real e FSM aplicado —
o núcleo que hoje não existe pra nenhum dos caminhos manuais (clássico, V2, API v1, agente).
