# Agenda → Cobrança/Parcelamento

> Concluída em código em: 03/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: levantamento de gaps pra deixar a odontologia pronta (Agenda +
> Fiscal + "tudo que uma clínica precisa"), item de ligar Agenda ao Financeiro.

## 1. O que foi entregue

Atendimento concluído ganha um botão **"Cobrar"** ao lado do "Emitir NFSe".
Ele:

1. Monta um prefill puro (`lib/services/agenda/appointmentBilling.ts` →
   `buildAppointmentBillingPrefill`) com descrição (`serviceName — clientName`),
   valor (`appointment.price`), nome do cliente e vencimento (hoje).
2. Grava esse prefill em `sessionStorage['pendingTransactionPrefill']` e chama
   `setActivePage('Financeiro')`.
3. `FinancialModule` detecta a chave no mount, abre o formulário de nova
   transação já preenchido (`openNewForm()` + overrides) e guarda
   `prefillAppointmentId` em state.
4. Ao salvar — à vista ou parcelado —, a(s) transação(ões) criada(s) ganham
   `appointmentId` (campo que já existia no schema, só nunca era escrito pela
   UI clássica) e o atendimento recebe de volta `billingTransactionId` (à
   vista) ou `billingInstallmentGroupId` (parcelado).
5. Com qualquer um dos dois setado, o botão "Cobrar" vira badge "Cobrança
   lançada" — idempotência visual, mesmo padrão do badge "NFSe emitida".

## 2. Por que não é o mesmo mecanismo do botão de NFSe

O botão de NFSe reusa um dialog compartilhado (`EmitirNotaDialog`) com uma
prop de prefill (`prefillNFSe`) — possível porque esse dialog já existia como
componente independente antes desta fatia. O formulário de transação do
Financeiro **não é um componente separado**: vive inline dentro de
`FinancialModule.tsx`. Extrair um dialog compartilhado seria uma mudança bem
maior que o pedido.

Em vez disso, reusamos o mecanismo que o próprio codebase já usa pra esse
exato problema (módulos diferentes = abas diferentes): `sessionStorage` +
`setActivePage`, o mesmo de `ConversasModule.handleCreateOrderFromConversation`
→ `pendingOrderPrefill` → `OrdersModule`.

**Divergência necessária desse precedente**: `app/app/page.tsx` mantém cada
módulo montado depois da primeira visita à aba (`mountedTabs`, troca de aba
só alterna opacidade/z-index, não desmonta). Um efeito só-no-mount (como o
`useEffect(() => {...}, [])` que o `OrdersModule` usa pro
`pendingOrderPrefill`) só dispararia na primeira vez que o Financeiro fosse
aberto na sessão — a partir da segunda vez, o componente já estaria montado e
o efeito nunca rodaria de novo. `FinancialModule` usa `activePage` (de
`useAppContext()`) como dependência do efeito em vez de `[]`, disparando toda
vez que a aba VIRA `'Financeiro'`, independente de já estar montada.

## 3. Limitação aceita (não corrigida nesta fatia)

O Financeiro clássico grava transações **direto pelo client SDK**, sem
validação de servidor (só `firestore.rules` — tenant/role/enum, sem Zod, sem
Cloud Function). Essa fatia não muda esse perfil de risco; só conecta a
Agenda ao Financeiro do jeito que ele já funciona hoje. Concretamente: um
clique duplo em "Cobrar" antes do badge atualizar pode gerar duas transações
pro mesmo atendimento — o mesmo risco que já existe hoje pra qualquer criação
manual duplicada no Financeiro. Corrigir isso de verdade exigiria endurecer
todo o Financeiro clássico com contrato Zod + rota de servidor, fora do
escopo desta fatia.

## 4. O que ficou de fora (deliberado)

- Cobrança automática ao concluir o atendimento (sem clique manual) —
  decidido manter manual, pra permitir ajustar valor/parcelas antes de
  lançar.
- Extrair o formulário de transação do Financeiro pra componente
  compartilhado + contrato Zod (`lib/contracts/domain/transaction.ts` não
  existe ainda) — mudança estrutural maior, fora do pedido desta fatia.
- Seletor de cliente no Financeiro (`clientId`) — o form clássico só tem nome
  livre; a cobrança usa `clientName`, mesmo fallback que a NFSe já usa quando
  o atendimento não tem cliente do CRM vinculado.
- **Financial V2** (`business.settings.financialV2Enabled === true`): quando
  ligado, a aba "Financeiro" renderiza `FinancialV2Module` em vez do
  `FinancialModule` clássico. O botão "Cobrar" ainda navega pra lá, mas nada
  é pré-preenchido — `FinancialV2Module` não lê `pendingTransactionPrefill`.
  Financial V2 é aditivo/opt-in (default off) e hoje não tem nenhum ponto de
  integração com módulos externos; estender o prefill pra lá fica pra quando
  houver demanda real de tenant com V2 ligado usando Agenda.

## 5. Evidências automatizadas

- `tests/services/appointmentBilling.test.ts` (5 casos): descrição com/sem
  serviceName, valor repassado sem transformação, vencimento = hoje, id do
  atendimento repassado.
- Suíte completa: 838 testes em 62 arquivos aprovados. `tsc --noEmit` limpo.
