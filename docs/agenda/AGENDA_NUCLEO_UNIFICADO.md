# Agenda — núcleo único de conflito + transição/conclusão reconciliável (M06.1 + M06.2)

> Concluído em código em: 03/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: `docs/paridade/M06_PLANO_IMPLEMENTACAO.md` (M06.0a) diagnosticou 6 canais gravando
> `appointments` com 3 algoritmos de conflito distintos, e um bug real de "conclusão sem
> efeito". Esta fatia fecha os dois problemas e migra os dois canais que hoje não têm nenhuma
> proteção (CRM e PDV).

## 1. Bug real corrigido: conflito ignorava `professionalIds[]`

O guard de conflito (`checkAppointmentConflict`, usado por `appointmentTxGuard.ts` no client e
`appointmentTxGuardAdmin.ts` no Admin SDK) só olhava o campo legado `professionalId`. Um
atendimento multi-profissional (ex.: dentista + assistente, ambos em `professionalIds[]`) tinha
o profissional em 2ª posição+ **invisível** ao check — a query nem buscava esses documentos, e
o algoritmo de overlap nem soubesse comparar contra eles.

**Correção**: `checkAppointmentConflict` ganhou `professionalIds?: string[]` opcional (retrocompat
total — passar só `professionalId` continua idêntico a antes). Internamente, verifica horário de
trabalho para CADA profissional do conjunto e compara overlap usando
`getAppointmentProfessionalIds()` (já existia em `lib/utils/appointment.ts`, criado pra esse
propósito mas nunca usado pelos guards transacionais até agora). A QUERY que busca os
agendamentos do dia também foi generalizada: `fetchAppointmentsForProfessionals` (nova, em
`lib/services/appointments-server.ts`) roda 2 buscas — `professionalId in [...]` (legado) e
`professionalIds array-contains-any [...]` (novo) — e mergeia por id. Os índices compostos já
existentes servem `in`/`array-contains-any` sem precisar de índice novo (Firestore trata como
equivalente a `==`/`array-contains` pra fins de índice).

**Limitação aceita, documentada nos próprios arquivos**: o day-lock (que serializa duas
transações concorrentes em <200ms) continua sendo só do profissional PRIMÁRIO do conjunto. A
correção fecha o *blind spot estático* — a query agora ENXERGA qualquer profissional do
conjunto, que é a causa real da maioria dos double-bookings (a recepção não vê o agendamento
existente porque a busca nem olhava lá). Uma corrida de cliques em <200ms envolvendo
especificamente um profissional secundário não tem a mesma garantia atômica que o primário já
tinha — lock N-way de verdade fica pra quando houver caso de uso real.

De quebra, fechado o gap P1.5: `createAppointmentSafeAdmin` pulava a transação inteira (write
direto, sem checar nada) quando `professionalId` (legado) vinha vazio, mesmo que
`professionalIds[]` tivesse conteúdo. Agora o guard deriva a lista efetiva de IDs e só pula a
transação quando NENHUM profissional foi informado.

## 2. Bug real corrigido: conclusão podia ficar sem efeito

`AgendaModule.tsx` fazia `updateDoc({status})` no navegador e, numa chamada HTTP separada
depois, disparava o evento que aplica comissão/fidelidade/baixa de insumo/métricas
(`fetch('/api/events/dispatch')`). Se o navegador morresse entre os dois passos (aba fechada,
rede caiu), o atendimento ficava `concluido` para sempre sem nenhum efeito aplicado — e nada
varria a base pra reprocessar.

**Correção**: novo `lib/services/appointment-server.ts` (`transitionAppointmentAdmin`), mirror
exato do padrão já usado em `delivery-order-transition-admin.ts` (M02.5d). Nova rota
`PATCH /api/appointments/[id]/transition` valida a FSM no servidor, aplica o patch de status e —
**na mesma chamada** — despacha `appointment.completed`/`appointment.canceled` via
`dispatchDomainEvent` (já síncrono/aguardado). Os dois passos viram uma única execução de
servidor; o navegador só precisa entregar a requisição, não sobreviver a duas chamadas
sequenciais. `AgendaModule.tsx` (`handleStatusChange`, `handleCancelAppointment`,
`handleDeleteAppointment`, `handleDeleteSeries`) migrados pra essa rota única — a validação de
FSM no cliente (`canTransitionAppointment`) continua existindo só como atalho de UX (feedback
imediato sem round-trip), o servidor é quem decide de verdade.

**Achado durante a implementação**: a FSM declarava `concluido` como estado totalmente
terminal — mas `handleCancelAppointment`/`handleDeleteAppointment` já dependiam, na prática, de
poder reverter um atendimento concluído por engano (cancelar desfaz comissão/fidelidade via
`appointment.canceled`). Sem corrigir a FSM primeiro, migrar esses handlers pra rota nova teria
**bloqueado silenciosamente** uma capacidade que a Agenda já oferece hoje — o teste que capturou
isso falhou com `Appointment FSM: transição inválida concluido → cancelado` antes da correção.
`concluido → cancelado` agora é uma transição declarada explicitamente em
`lib/contracts/fsm/appointment.ts` (reversão, não avanço — `concluido` continua sem ir a
`nao_compareceu` ou qualquer outro estado).

**Reconciliação**: `npm run reconcile:m06 -- --businessId=<id> [--apply]` varre appointments
`concluido` sem `completionAppliedAt` e redispara o efeito — idempotente pelo próprio CAS do
handler (rodar em cima de um já corrigido é no-op). Script manual, não cron — sem tenant real em
produção ainda; virar cron fica pra quando houver demanda.

## 3. CRM e PDV migrados — mas sem fechar risco de colisão ainda

Novo `POST /api/appointments` (contrato em `lib/contracts/api/agenda/create.ts`) — criação
autoritativa via `createAppointmentAdmin`, `businessId` sempre resolvido no servidor (nunca do
body). `ScheduleActionDialog.tsx` (CRM, "Agendar consulta") e `PDVModule.tsx`
(`handlePreBooking`, retorno) trocaram `addDoc` direto por essa rota.

**Achado importante desta investigação**: nem o CRM nem o PDV deixam escolher profissional na
UI — nenhum dos dois tem seletor, nenhum envia `professionalId`. Como o guard trata "sem
profissional" como "sem o que conflitar" (regra intencional do sistema, não bug), migrar esses
dois canais pro núcleo **não fecha nenhum risco de colisão hoje**. O ganho real é consistência
de contrato/validação/auditoria e infraestrutura pronta pro futuro — decisão consciente do
usuário, confirmada antes de implementar. Adicionar o seletor de profissional a essas duas telas
fica pra quando houver demanda real.

`Appointment.color` foi confirmado como campo não-usado em nenhuma renderização (o calendário
colore por status via `STATUS_COLORS[appointment.status]`, não por `appointment.color`) —
removido do payload do PDV sem substituto, não é regressão.

## 4. O que ficou de fora (deliberado)

- Seletor de profissional em CRM/PDV (ver seção 3).
- Lock transacional N-way completo pra múltiplos profissionais (seção 1).
- Capacidade de turma no guard Admin (`createAppointmentSafeAdmin` continua sem contar vagas —
  só o guard client conta hoje; gap pré-existente, não piorado).
- Cron de reconciliação automática (fica script manual até haver tenant real).
- Restringir `firestore.rules` pra bloquear escrita direta de `status` pelo cliente — exigiria
  auditar todos os outros campos que a Agenda ainda escreve direto antes de travar.
- Migrar booking público/agente de IA pro núcleo novo (M06.7) — cada um mantém seu próprio
  algoritmo por enquanto.
- Bloqueios de agenda, no-show, anamnese — M06.3+.

## 5. Evidências automatizadas

- `tests/services/appointmentConflicts.test.ts`: 15 casos (11 originais + 4 novos de
  multi-profissional).
- `tests/services/appointmentTxGuard.test.ts`: 19 casos (17 originais + 2 novos).
- `tests/services/appointmentTxGuardAdmin.test.ts`: 16 casos (14 originais + 2 novos,
  incluindo o fechamento do gap P1.5).
- `tests/services/appointmentsServer.test.ts` (novo): 5 casos pra
  `fetchAppointmentsForProfessionals` (merge/dedupe multi-id).
- `tests/services/appointmentTransitionAdmin.test.ts` (novo): 8 casos — transição sem efeito,
  conclusão despacha `appointment.completed`, reversão despacha `appointment.canceled`,
  `cancelledAt/cancelledBy/cancelledByName` gravados, transição inválida rejeitada sem
  escrever, no-op quando já está no status, tenant mismatch, not found.
- Suíte completa: 878 testes em 66 arquivos aprovados. `tsc --noEmit` limpo.
