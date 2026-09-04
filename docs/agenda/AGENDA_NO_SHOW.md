# Agenda — política de no-show (marcar, medir, cobrar) — M06.3b

> Concluído em código em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: o plano M06 (`docs/paridade/M06_PLANO_IMPLEMENTACAO.md`, P1.9) já apontava
> "NoShowPolicy é só documentação... marcar `nao_compareceu` não gera taxa/retém depósito".

## 1. O que foi entregue

"Marcar" já funcionava 100% antes desta fatia — a FSM já permitia
`agendado/confirmado → nao_compareceu` e o botão "Não Compareceu" já passava pela rota atômica
`PATCH /api/appointments/[id]/transition` (M06.2). O que faltava era "medir" e "cobrar":

1. Novo evento `appointment.noShow` (`lib/contracts/events/index.ts`), despachado por
   `transitionAppointmentAdmin` sempre que um atendimento transiciona PRA `nao_compareceu`
   (mesmo mecanismo de `appointment.completed`/`appointment.canceled` da M06.2).
2. Novo handler (`lib/contracts/_runtime/handlers/appointmentNoShow.ts`) incrementa
   `Client.relationshipHistory.noShowCount` — campo que já existe no tipo e já é **lido e
   exibido** por `LeadDetailPanel.tsx` (rótulo "Faltas" no CRM), mas nunca tinha sido escrito
   por nenhum código do ciclo de vida do agendamento. Idempotente via novo CAS
   `Appointment.noShowAppliedAt` (nunca revertido — `nao_compareceu` é terminal de verdade,
   sem transição de volta na FSM, diferente de `concluido → cancelado`).
3. O botão "Cobrar" (já existente para atendimentos concluídos, ver
   `docs/agenda/AGENDA_COBRANCA.md`) passou a aparecer também em `nao_compareceu`, com a
   descrição prefixada "Taxa de não comparecimento —" pra deixar claro pro operador que não é
   a cobrança normal do serviço.

## 2. Por que reaproveitar o botão "Cobrar" em vez de cobrança automática

`NoShowPolicy` (`lib/types/index.ts`, campos `requireDeposit`/`depositPercentage`/
`noShowFeePercentage`/`cancellationDeadlineHours`) já existe como tipo — mas é **outro**
mecanismo, bem mais amplo: depósito cobrado **na hora de agendar**, retido se o paciente faltar.
Confirmado por varredura: zero UI em Settings, zero leitura em booking, zero uso em qualquer
lugar do código além da própria declaração do tipo — nunca foi construído. Automatizar esse
fluxo exigiria cobrança real (PIX/boleto — hoje stubs em `lib/services/financial/`) e uma tela
de configuração nova, escopo bem maior que "política de no-show simplificada" (linguagem do
próprio plano M06, seção 4).

Em vez disso, esta fatia reaproveita o que já existe: o mesmo botão manual "Cobrar" que
atendimentos concluídos já usam, generalizado pra também aceitar `nao_compareceu`
(`buildAppointmentBillingPrefill` já era uma função pura sem nenhuma trava de status —
generalizar foi só adicionar um prefixo condicional na descrição). Mesma filosofia "manual
antes de automático" já usada nesta sessão pro envio de ficha por WhatsApp (M06.4a): o operador
decide se cobra, quanto cobra (o valor pré-preenchido é o preço do serviço; nada impede editar
pra um valor menor no Financeiro antes de salvar) e quando.

## 3. Achado: `noShowCount` era uma tela morta esperando alguém escrever

`Client.relationshipHistory` (`RelationshipHistory`, `lib/types/index.ts`) tem campos como
`totalAppointments`, `completedAppointments`, `cancelledAppointments`, `noShowCount`,
`attendanceRate` — todos pensados pra descrever o histórico do paciente. Investigação encontrou
que o **único** writer desse objeto em todo o repo é o `PUT /api/v1/crm/contacts` (API pública),
que só repassa o que um chamador externo mandar — nenhum código do ciclo de vida real do
agendamento nunca escreveu nada ali. Ao mesmo tempo, `LeadDetailPanel.tsx` (painel do CRM) já
lia e exibia `noShowCount` há algum tempo, rotulado "Faltas" — ou seja, existia uma tela
esperando um dado que nunca chegava.

Esta fatia liga só `noShowCount` (o campo diretamente relacionado a "política de no-show").
`totalAppointments`/`completedAppointments`/`cancelledAppointments`/`attendanceRate` continuam
não-escritos — ligar todos exigiria reconciliar o histórico já existente de cada cliente
(quantos atendimentos concluídos/cancelados já aconteceram antes desta fatia), escopo de
reconciliação bem maior que "contar novos no-shows a partir de agora". A UI do CRM já trata
esses campos como independentes (`!= null` por campo), então `noShowCount` populado com os
demais em branco não aparenta estar quebrado — só incompleto, como já estava.

## 4. Por que `FieldValue.increment` com chave dot-path, não objeto aninhado

`bumpClientNoShowCountAdmin` (`lib/services/clientMetricsAdmin.ts`) grava
`{'relationshipHistory.noShowCount': FieldValue.increment(1)}` — uma chave com ponto, não
`{relationshipHistory: {noShowCount: ...}}`. A diferença importa: no Firestore real,
`.update()` com um objeto aninhado **substitui o mapa inteiro** (apagaria qualquer outro campo
que `relationshipHistory` já tivesse); a chave dot-path faz merge só naquele campo específico,
preservando os irmãos. Mesmo padrão já usado em `lib/services/birthdayCampaignRunner.ts`
(`incrementCampaignStats`) — não é técnica nova neste codebase.

**Risco pré-existente encontrado, não corrigido nesta fatia**: `PUT /api/v1/crm/contacts`
(`app/api/v1/crm/contacts/route.ts`) grava `relationshipHistory` inteiro por substituição rasa
(sem merge por campo) quando um caller externo inclui esse objeto no corpo da requisição. Até
agora isso era inofensivo porque o campo nunca tinha dado real; a partir desta fatia, um caller
da API v1 que reenvie `relationshipHistory` parcialmente pode apagar `noShowCount` sem querer.
Mesmo problema afeta outros 5 campos-objeto dessa rota (`endereco`, `channelIdentities`,
`customFields`, `scores`, `behavioralInsights`). Corrigir é fatia separada — a rota não tem
teste hoje e o problema não é específico de no-show.

## 5. O que ficou de fora (deliberado)

- **UI de Settings para `NoShowPolicy`** (depósito, percentual, prazo) — tipo continua morto;
  automatizar cobrança de depósito na hora de agendar é escopo bem maior (§2).
- **Criação automática de Transaction** — cobrança continua manual via "Cobrar" (§2).
- **`totalAppointments`/`completedAppointments`/`cancelledAppointments`/`attendanceRate`** —
  só `noShowCount` foi ligado (§3).
- **Agente de IA / booking público** — não ganha checagem/efeito de no-show; mesmo destino de
  unificação futura (M06.7) já usado pra bloqueios de agenda (M06.3a).
- **Corrigir o PUT `/api/v1/crm/contacts`** — bug pré-existente mais amplo, documentado (§4),
  não corrigido aqui.
- **NFSe para taxa de no-show** — botão de NFSe continua só `concluido`; taxa de não
  comparecimento não é nota fiscal de serviço prestado, questão fiscal separada.
- **Contagem retroativa** — agendamentos marcados `nao_compareceu` antes desta fatia não somam
  a `noShowCount`; só passa a contar a partir de agora.

## 6. Verificação

Verificado por `tsc --noEmit` limpo e suíte completa (921 testes em 69 arquivos — 912/68 da
fatia anterior mais 9 novos casos, sem regressão). **Não testado manualmente num navegador**
nesta rodada (sem sessão de dev server ativa). Antes de considerar pronto pra uso real: marcar
um agendamento `confirmado` como "Não Compareceu" → conferir que o botão "Cobrar" aparece →
clicar → conferir que o Financeiro abre com a descrição "Taxa de não comparecimento — ..." →
abrir o cliente em Clientes/CRM → conferir que "Faltas" mostra a contagem.

## 7. Evidências automatizadas

- `tests/contracts/appointmentNoShowHandler.test.ts` (novo, 6 casos): incrementa sem apagar
  campos irmãos de `relationshipHistory`, idempotente em replay, ignora status/tenant errados,
  funciona sem `clientId`, no-op em appointment inexistente.
- `tests/services/appointmentTransitionAdmin.test.ts`: +2 casos (despacha `appointment.noShow`
  com payload correto; repetir a mesma transição não despacha de novo).
- `tests/services/appointmentBilling.test.ts`: +1 caso (prefixo de descrição em no-show).
- Suíte completa: 921 testes em 69 arquivos aprovados. `tsc --noEmit` limpo.
