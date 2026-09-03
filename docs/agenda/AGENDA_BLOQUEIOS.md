# Agenda — bloqueios (férias, feriado, indisponibilidade) — M06.3a

> Concluído em código em: 03/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: a auditoria M06.0 apontava "Bloquear agenda (férias, feriado) ❌ não existe" — a
> única noção de disponibilidade era a grade semanal recorrente (`User.workingHours`), sem
> forma de dizer "Dr. Silva está de férias" ou "fechamos no feriado".

## 1. O que foi entregue

Nova entidade `ScheduleBlock` (`lib/contracts/domain/scheduleBlock.ts` + FSM em
`lib/contracts/fsm/scheduleBlock.ts`, 2 estados: `ativo`/`cancelado`). Um bloqueio cobre um
intervalo de datas (`startDate`..`endDate`, inclusive) e, opcionalmente, uma janela de horário
dentro de cada dia do intervalo (ausente = dia inteiro). Sem `professionalId` = bloqueio do
**negócio inteiro** (feriado/fechamento); com `professionalId` = só aquele profissional
(férias, conferência).

Gerenciado por um novo botão "Bloqueios" no toolbar da Agenda (`ScheduleBlocksDialog.tsx`),
visível só pra `manager+` — mesmo nível de permissão de NFSe/NFCe, porque decidir a agenda de
outra pessoa não é ação de operador raso. Criação e cancelamento sempre passam por rota
autenticada (`POST /api/schedule-blocks`, `PATCH /api/schedule-blocks/[id]/cancel`, Admin SDK)
— nunca `addDoc`/`updateDoc` direto, mesmo princípio server-authoritative do resto do M06.

## 2. Por que reaproveitar `checkAppointmentConflict` em vez de um 4º algoritmo

M06.1/M06.2 existem pra ter UM lugar decidindo "pode agendar aqui" — inventar uma função de
bloqueio separada que cada canal precisa lembrar de chamar seria repetir exatamente o erro que
motivou aquele trabalho. Em vez disso, `checkAppointmentConflict`
(`lib/services/appointmentConflicts.ts`) ganhou um parâmetro opcional `blocks?: ScheduleBlock[]`,
checado **antes** de tudo (inclusive antes do horário de trabalho): um bloqueio do negócio
inteiro vale mesmo pra um agendamento sem profissional escolhido ainda. Omitir `blocks` mantém
o comportamento idêntico a antes (retrocompat total, sem tocar os 22 testes já existentes).

Isso significa que **qualquer canal que já usa o guard automaticamente ganha proteção contra
bloqueio** sem precisar de mudança própria: Agenda, Conversas→agendar
(`scheduleFromConversation.ts`) e API v1 (`createAppointmentSafeAdmin`) — todos passam pelo
mesmo `appointmentTxGuard.ts`/`appointmentTxGuardAdmin.ts` que agora busca bloqueios ativos
(negócio inteiro + profissionais do agendamento) e repassa pro check.

## 3. Busca de bloqueios — range em um campo só, filtro em memória

Um bloqueio tem `startDate`/`endDate` (intervalo) mas o guard verifica UMA data específica.
Firestore não aceita range (`<=`/`>=`) em dois campos diferentes na mesma query — a busca
filtra `startDate <= date` no servidor e `endDate >= date` em memória depois. Blocos são raros
(uma dúzia por ano, no máximo, por negócio) — filtro em memória é apropriado, mesmo padrão
pragmático já usado nas auditorias M02/M06. Novo índice composto
`[businessId, professionalId, startDate]` — serve tanto a busca do negócio inteiro
(`professionalId == null`, valor explícito, não campo ausente) quanto a busca por profissional
(`professionalId in [...]`, mesmo índice que `==` serve `in`).

## 4. Criar um bloqueio NÃO cancela agendamentos existentes

Deliberado: se um bloqueio cobrisse automaticamente agendamentos já marcados, cancelá-los em
cascata reverteria comissão/fidelidade sem revisão humana. Em vez disso,
`createScheduleBlockAdmin` retorna `conflictingAppointments` — a lista de agendamentos que já
existem dentro do intervalo/profissional bloqueado — e a UI mostra como aviso. Quem criou o
bloqueio decide manualmente o que fazer com cada um.

## 5. O que ficou de fora (deliberado)

- **Agente de IA / booking público não checa bloqueio.** `checkAvailability`/`bookAppointment`
  (`app/api/agent/tools/agenda/route.ts`) têm algoritmo próprio, sem teste dedicado, e já
  estavam marcados pra unificação futura (M06.7 — "Booking público e agente no mesmo núcleo").
  Um paciente conversando com o agente pode, hoje, ainda conseguir marcar num horário
  bloqueado — mesma categoria de risco que esse canal já tinha (nunca validava working hours
  de verdade tampouco, ver próximo item). Fica pra quando o M06.7 acontecer.
- **Bug pré-existente descoberto, não corrigido**: `checkAvailability` tem um cast morto
  (`WorkSchedule[]`, linha 373 do arquivo acima) que nunca bate contra o schema real de
  `workingHours` — esse canal nunca respeitou o horário de trabalho individual de um
  profissional, sempre caindo pro horário do negócio ou um fallback fixo 08:00-18:30. Achado
  durante esta investigação, documentado aqui, não corrigido — está fora do escopo de
  "adicionar bloqueio" e é do mesmo arquivo/milestone (M06.7) do item acima.
- **Sombreamento visual do bloqueio no calendário** — v1 só impede a reserva (mensagem clara
  citando motivo/intervalo); marcar visualmente os dias/horários bloqueados nas visões
  dia/semana/mês fica pra um polish futuro.
- **Cancelamento/aviso automático de agendamentos existentes ao criar um bloqueio** — fica
  manual, com a lista de `conflictingAppointments` como aviso (seção 4).
- **Recorrência de bloqueio** (ex.: "toda sexta à tarde, permanentemente") — só intervalo de
  datas explícito nesta fatia.
- **Lock N-way / capacidade de turma** — gaps já documentados em `AGENDA_NUCLEO_UNIFICADO.md`,
  não afetados por esta fatia.

## 6. Verificação

Verificado por revisão de código + suíte automatizada (`tsc --noEmit` limpo, suíte completa
912 testes em 68 arquivos aprovados) — **não testado manualmente num navegador** (sem sessão
de dev server ativa nesta rodada). Antes de considerar esta UI pronta pra uso real, rodar o
smoke manual descrito no plano: criar bloqueio de negócio inteiro pra uma data → tentar
agendar nessa data na Agenda → deve recusar citando o motivo; criar bloqueio só de um
profissional → confirmar que outro profissional continua agendável na mesma janela; cancelar o
bloqueio → confirmar que o horário volta a ficar disponível.

## 7. Evidências automatizadas

- `tests/contracts/scheduleBlock.test.ts` (12 casos): invariantes do schema + FSM.
- `tests/services/appointmentConflicts.test.ts`: +7 casos de bloqueio (profissional, negócio
  inteiro, parcial por horário, cancelado ignorado, fora do intervalo, outro profissional).
- `tests/services/appointmentTxGuard.test.ts` / `appointmentTxGuardAdmin.test.ts`: +3/+4 casos
  cobrindo a busca de bloqueios integrada ao guard (client e admin).
- `tests/services/scheduleBlockAdmin.test.ts` (novo, 8 casos): criação com/sem profissional,
  `conflictingAppointments` correto (incluindo filtro por janela de horário), cancelamento com
  auditoria, FSM rejeita cancelar duas vezes, isolamento de tenant.
- Suíte completa: 912 testes em 68 arquivos aprovados. `tsc --noEmit` limpo.
