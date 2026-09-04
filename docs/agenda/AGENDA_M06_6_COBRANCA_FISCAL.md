# Agenda — cobrança, fiscal, comissão e assinaturas (M06.6)

> Concluído/analisado em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: 3 itens do checklist M06.6. Um achado desta investigação (§2) tem implicação fiscal
> real e é sinalizado com destaque — não é só "achado documentado", é algo que vale a atenção
> direta do usuário, não só um registro em arquivo.

## 1. Entregue: status fiscal ao vivo no atendimento

`Appointment.fiscalStatus` era um campo morto pra leitura: gravado **uma única vez**, no momento
da emissão inicial (`linkFiscalDocToSource`), nunca mais atualizado depois — se a nota fosse
posteriormente rejeitada numa reconsulta, ou cancelada, o atendimento continuaria mostrando
"NFSe emitida" pra sempre, mesmo com a nota de fato morta.

Corrigido: `ViewAppointmentDialog` agora busca o status AO VIVO em `fiscalDocuments/{fiscalDocumentId}`
quando o dialog abre (mesma idempotência visual pontual das outras badges desta tela — Cobrar,
Enviar ficha). `rejeitada`/`erro`/`cancelada` são estados **terminais** no FSM fiscal
(`lib/contracts/fsm/fiscalDocument.ts`) — reemissão nesses casos cria um documento NOVO via
`/api/fiscal/emit` (não um "retry" do mesmo, que só existe pra `pendente`/`contingencia`). Por
isso, nesses três casos, o botão "Emitir NFSe" **reaparece** ao lado do status real, em vez de
ficar escondido atrás de uma badge "emitida" enganosa.

Pequeno complemento: `lib/utils/format.ts` (`getStatusColor`/`getStatusLabel`, já usado nesta
tela pra outros status) não tinha entradas pra `cancelada`/`contingencia` — adicionadas (cor
cinza neutra pra `cancelada`, distinta do vermelho de `rejeitada`/`erro`, já que uma nota
cancelada não é necessariamente um erro, pode ser um cancelamento legítimo).

## 2. ACHADO IMPORTANTE, não corrigido nesta fatia: notas "pendentes" (SEFAZ fora do ar) perdem o vínculo com a origem

Ao investigar "estado fiscal reprocessável", a busca pelo mecanismo de retry (`POST
/api/fiscal/retry`, já existe e já funciona) revelou uma lacuna mais séria: quando a emissão
falha por indisponibilidade **temporária** da SEFAZ (`persistPendingAndRespond` em
`app/api/fiscal/emit/route.ts`), o documento fiscal é criado com `status: 'pendente'`, mas
**sem `appointmentId`/`saleId`/`orderId` nenhum** — o próprio documento não sabe de onde veio.
`linkFiscalDocToSource` (a função que grava `fiscalDocumentId` de volta no atendimento/venda/
pedido) só é chamada no caminho de SUCESSO, nunca no de "pendente".

**Consequência prática, confirmada lendo o código, não hipotética:**
- O atendimento nunca aprende que existe uma nota pendente pra ele — continua mostrando
  "Emitir NFSe" disponível, como se nada tivesse sido tentado.
- Um operador que não perceba a mensagem de erro (`'SEFAZ temporariamente indisponível... use
  "Reenviar para SEFAZ" no detalhe da nota'`) pode clicar "Emitir NFSe" de novo — criando um
  **segundo** documento pendente pro mesmo atendimento. Se a SEFAZ voltar e os dois forem
  reenviados (manualmente, um de cada vez, no módulo Fiscal), o resultado seria **duas notas
  fiscais autorizadas pro mesmo atendimento** — problema fiscal real, não só de UX.
- Isso **não é específico de Appointments** — `persistPendingAndRespond` é compartilhado por
  NFe/NFCe/NFSe (Sales, DeliveryOrders e Appointments todos passam pelo mesmo caminho), então o
  mesmo risco existe pra vendas e pedidos também.

**Por que não foi corrigido nesta fatia:** a correção correta exigiria adicionar
`appointmentId`/`saleId`/`orderId` aos parâmetros de `persistPendingAndRespond` e vincular o
documento pendente à origem (decidindo também como a UI deveria distinguir "pendente,
aguardando reenvio" de "emitida" — hoje só existe o binário `fiscalDocumentId` presente/ausente,
que passaria a precisar de um terceiro estado visual). Isso é uma mudança na rota de emissão
**compartilhada por 3 tipos de documento fiscal** (não só a específica de agendamento que esta
fatia estava escopada a tocar) — mais próximo de M04 (Fiscal) do que de M06 (Agenda), e mais
arriscado de fazer sem revisão dedicada e teste ao vivo, dado que mexe diretamente em emissão
fiscal real.

**Recomendação:** esta é uma decisão que vale a atenção direta do usuário — não é só um item de
prioridade de engenharia, é um risco de duplicidade fiscal real (mesmo que hoje pouco provável,
já que depende de a SEFAZ cair bem no momento da emissão E o operador não notar o aviso).
Avaliar se vale abrir como prioridade própria (fatia dedicada de Fiscal) antes ou depois de
outros itens do roadmap.

## 3. Analisado, não corrigido: independência entre a cadeia de cobrança e a cadeia fiscal

`billingTransactionId`/`billingInstallmentGroupId` (cobrança) e `fiscalDocumentId` (NFS-e) são
totalmente independentes hoje — dá pra emitir NFSe sem cobrar, ou cobrar sem emitir NFSe, sem
nenhum aviso cruzado. A auditoria M06.0 (`lib/services/m06-agenda-audit.ts`) já verifica a
integridade referencial de CADA campo isoladamente (aponta pra uma `transactions`/
`fiscalDocuments` que realmente existe), mas nunca a RELAÇÃO entre os dois (ex.: "fiscal emitido
mas nunca cobrado").

**Avaliado como aceitável sem mudança nesta fatia**: cada cadeia já é manual e idempotente por
si só (badges de "já feito" evitam duplicar CADA uma individualmente) — a falta de cruzamento é
uma lacuna de conveniência/visibilidade, não um risco de corrupção de dado ou duplicidade. Não
há evidência de que isso cause problema real hoje. Fica como possível item futuro (ex.: um novo
código de issue na auditoria M06.0, "fiscal emitido sem cobrança lançada" ou vice-versa), não
como correção desta fatia.

## 4. Analisado, deliberadamente adiado: memberships/assinaturas ligadas à agenda

Investigação encontrou: o contrato (Zod + FSM), o cron de cobrança
(`membershipBillingRunner.ts`) e até a checagem de limite de uso (`usesThisCycle`/
`maxUsesPerCycle`) **já existem em código** — mas a checagem de limite só é consultada por
`bookGroupAppointment` (`app/api/agent/tools/agenda/route.ts`), o caminho de **turma** (aulas em
grupo) do agente de IA. A Agenda de recepção — o que a clínica odontológica realmente usa pra
marcar uma consulta 1:1 — não tem NENHUMA consciência de membership, nem o núcleo compartilhado
(`appointmentTxGuard*.ts`) usado por Agenda/CRM/PDV/API v1.

**Gaps adicionais confirmados**: não existe NENHUMA UI pra matricular um cliente num plano
(`ClientMembership` nunca é criado por nenhuma tela — só lido/incrementado pelo cron e pelo
booking de turma); `assertTransitionMembership`/`canTransitionMembership` (FSM) não têm nenhum
call site real apesar de um comentário no runner alegar que são usados.

**Por que adiado**: (1) é uma feature majoritariamente NÃO CONSTRUÍDA pra atendimento 1:1 — não
um bug a corrigir, uma feature nova a construir do zero (UI de matrícula + wiring no núcleo
compartilhado); (2) não está confirmado que "plano com N consultas" é uma necessidade real da
odontologia (o caso de uso existente — turma — é mais alinhado com academia); (3) o próprio
runner de cobrança já documenta que a cobrança de verdade não está plugada a nenhum gateway de
pagamento ainda (`TODO(auditoria P2.9)`), então mesmo que a UI de matrícula existisse, o ciclo
de cobrança automatizado ainda dependeria de reconciliação manual. Escopo bem maior que uma
fatia — precisa de confirmação de prioridade antes de começar.

## 5. Verificação

Item 1: verificado por `tsc --noEmit` limpo e suíte completa (976 testes em 74 arquivos — 973
da fatia anterior mais 4 novos casos em `format.test.ts`, sem regressão). **Não testado
manualmente em navegador** nesta rodada — antes de confiar: abrir um atendimento com NFSe
emitida e confirmar que a badge mostra o status real; simular uma nota rejeitada/cancelada
(ambiente de homologação) e confirmar que o botão "Emitir NFSe" reaparece corretamente ao lado
do status.

Itens 2-4: análise registrada, nenhuma mudança de código nova além do já descrito no item 1.

## 6. Evidências automatizadas

- `tests/utils/format.test.ts`: +4 casos (`cancelada`/`contingencia` em `getStatusColor` e
  `getStatusLabel`).
- Suíte completa: 976 testes em 74 arquivos aprovados. `tsc --noEmit` limpo.
