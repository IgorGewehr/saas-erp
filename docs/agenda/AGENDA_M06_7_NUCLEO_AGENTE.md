# Agenda — booking público e agente no mesmo núcleo (M06.7)

> Concluído em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: última fatia de convergência do M06 (checklist: "booking público e agente passam a
> usar o núcleo M06.1, aposentando os algoritmos próprios" + "capacidade de turma atômica também
> nesses caminhos"). Sinalizada desde M06.0b/M06.3a como a de maior risco do plano — muda o
> comportamento de agendamento usado pelo canal mais exposto (WhatsApp/Instagram/Facebook/chat
> público do site, todos processados pelo mesmo agente Python, que chama de volta esta MESMA rota
> via tool call HMAC — não existem dois sistemas de booking público, é UM arquivo).

## 1. O que existia antes desta fatia

`app/api/agent/tools/agenda/route.ts` (a única rota que processa `book`/`check_availability`
pra todo agendamento mediado por IA, seja web, WhatsApp, Facebook ou Instagram) tinha o próprio
algoritmo de conflito/disponibilidade, escrito à mão, **diferente e mais fraco** do que o núcleo
já usado por Agenda (`AgendaModule.tsx`), CRM, PDV e API v1:

- **`bookAppointment` (exclusivo/1:1)**: fazia sua própria `runTransaction` com um filtro de
  overlap manual (`intervalsOverlap`). Não conhecia bloqueios de agenda (M06.3a — férias,
  feriado, indisponibilidade), não conhecia o intervalo mínimo entre atendimentos (M06.3c —
  buffer), e não checava horário de trabalho dentro da transação (só na listagem prévia, que é
  só consultiva).
- **`checkAvailability`** (usada por `check_availability`/`get_next_available` e pra montar
  alternativas em conflitos): tinha um **cast morto confirmado nesta investigação** —
  `prof.workingHours as unknown as Record<string, WorkSchedule[]>` — mas o schema real de
  `User.workingHours` é `{[dayOfWeek]: {enabled, start, end}}` (um objeto por dia, nunca um
  array). `Array.isArray(profSchedule[dia])` era **sempre falso**, então o horário individual do
  profissional nunca era lido aqui — a função sempre caía no fallback de horário do negócio,
  mesmo com o profissional tendo horário próprio configurado (ou um dia de folga marcado). A
  tela de Configurações (`SettingsModule.tsx`) promete ao usuário "o agente usará esses horários
  para verificar disponibilidade" — promessa quebrada silenciosamente até esta fatia. Já
  documentado como achado (não corrigido) desde `AGENDA_BLOQUEIOS.md` (M06.3a).
- **`bookGroupAppointment` (turma)**: tinha sua própria checagem de colisão
  (`findBlockingAppointment`, de `groupSession.ts`) que só olha overlap — não bloqueios, não
  buffer. A contagem de vagas em si (`countSeatsTaken`) já era atômica (dentro da mesma tx) —
  isso nunca foi o problema; o problema era o que a tx considerava "conflito".

Nenhum desses três pontos é bug introduzido por esta sessão — são divergências que existiam desde
que a turma/agente foram construídos, e que M06.0b/M06.3a já haviam identificado e
deliberadamente **congelado em documentação** para esta fatia resolver de vez.

## 2. O que foi convergido

- **`bookAppointment`**: a transação manual foi substituída por
  `createAppointmentSafeAdmin` (`lib/services/appointmentTxGuardAdmin.ts`) — o MESMO guard
  atômico usado por `POST /api/appointments` (CRM/PDV, M06.1). Passa a honrar
  bloqueios/buffer/horário de trabalho automaticamente, sem lógica nova na rota — só troca de
  chamada. `AppointmentConflictError` (já importada nesta rota pro caminho de `update`) passou a
  ser capturada aqui também; a classe local `ConflictError` (agora sem uso) foi removida.
- **`checkAvailability`**: cast corrigido para o shape real de `WorkingHours`; passou a buscar
  bloqueios de agenda (`fetchActiveBlocks`, exportada de `appointmentTxGuardAdmin.ts` — mesma
  fonte usada pelo guard) e o `appointmentBufferMinutes` do negócio (lido do mesmo doc já
  buscado, sem read extra); o filtro de overlap manual foi substituído por
  `checkAppointmentConflict` por candidato — mesma função pura usada em Agenda/CRM/PDV/
  Conversas/API v1.
- **`bookGroupAppointment`**: mantém sua própria `runTransaction` (necessário — é o único
  caminho que também incrementa `usesThisCycle` de mensalidade, P2.9, atomicamente com a
  criação; delegar pra `createAppointmentSafeAdmin` perderia essa atomicidade ou exigiria
  ensinar essa função genérica sobre mensalidade, que não é problema dela). Dentro da mesma tx,
  porém, o conflito agora usa `checkAppointmentConflict` (com bloqueios + buffer + horário de
  trabalho do professor, quando a turma tem professor fixo) no lugar de
  `findBlockingAppointment`. Sessões **abertas** (`professionalId` ausente na grade — turma sem
  instrutor fixo) mantêm a checagem de overlap contra QUALQUER profissional
  (`findBlockingAppointment`, preservada) — ver §3 sobre por que essa distinção é intencional —
  mas ganharam a checagem de bloqueio do negócio inteiro (feriado/fechamento), que não existia
  antes. `fetchActiveBlocksTx`/`fetchBusinessBufferMinutesTx` (antes privadas em
  `appointmentTxGuardAdmin.ts`) foram exportadas pra serem reaproveitadas aqui, sem nenhuma
  mudança de comportamento nos callers existentes.

## 3. Decisão de design: "sem profissional" não significa a mesma coisa nos dois caminhos

`checkAppointmentConflict` trata "nenhum profissional escolhido" como "nada pra conflitar"
(decisão já tomada e em uso desde M06.1 pro agendamento exclusivo/manual — reflete o fato de que
CRM e PDV nem oferecem seleção de profissional na UI). Migrar `bookGroupAppointment` pra usar essa
MESMA função ingenuamente, mesmo na sessão "aberta" de turma, teria uma consequência real: uma
turma sem instrutor fixo passaria a não conflitar com **nada**, nem com outra turma no mesmo
horário — porque uma sessão de turma aberta ainda ocupa um horário/espaço real (a aula acontece,
com ou sem nome de professor atribuído), diferente de "sem profissional" no 1:1 (que reflete
ausência de restrição, não ausência de recurso ocupado). Por isso a sessão aberta manteve
`findBlockingAppointment` (overlap contra todo mundo, comportamento inalterado) e só ganhou,
adicionalmente, a checagem de bloqueio do negócio inteiro via `checkAppointmentConflict` chamada
separadamente só pra esse propósito.

## 4. Mudanças de comportamento reais, deliberadas — não silenciosas

- **Appointment sem profissional atribuído deixa de bloquear um profissional específico** nos
  caminhos `checkAvailability`/`bookAppointment`/`bookGroupAppointment` (turma com professor
  fixo). Antes, um agendamento não-atribuído (comum: CRM e PDV não deixam escolher profissional,
  M06.1) fazia o agente recusar/esconder horários pra QUALQUER profissional naquele slot. Depois
  desta fatia, o agente segue a MESMA regra que Agenda/CRM/PDV/API v1 já usam há duas fatias
  (M06.1): "sem profissional = sem o que conflitar". Não é uma regra nova — é a MESMA regra já
  aceita e em produção nos outros canais, agora também no agente. Risco teórico: um agendamento
  não-atribuído do CRM às 10h e uma reserva do agente pro Dr. X às 10h não se bloqueiam mais
  mutuamente — mas esse risco já existe hoje em qualquer combinação Agenda↔CRM↔PDV↔API v1, não é
  introduzido por esta fatia.
- **Profissional com dia de folga configurado (`workingHours[dia].enabled = false`) agora é
  corretamente excluído da listagem de disponibilidade** — antes (bug do cast morto), esse
  profissional sempre aparecia disponível usando o horário do negócio, mesmo tendo marcado que
  não trabalha aquele dia.
- **Slots podem agora ser recusados por bloqueio de agenda (férias/feriado) ou por violar o
  intervalo mínimo configurado entre atendimentos** — antes, nenhum dos dois nunca acontecia
  pelo agente; agora pode, com mensagem estruturada (`status:'conflict'` + `alternatives`), o
  mesmo formato que o agente já sabe interpretar pra propor outro horário.

## 5. O que fica de fora (deliberado)

- **Listagem de turma (`buildGroupSlots`, usada por `check_availability` quando o serviço tem
  `sessions[]`) ainda não filtra por bloqueios de agenda** — só a RESERVA (`bookGroupAppointment`)
  passou a checar. Mesma filosofia já existente no caminho exclusivo (listagem é consultiva/
  otimista; a transação de reserva é a autoridade final) — se um bloqueio cair bem numa sessão de
  grade, o agente pode oferecê-la e só descobrir o bloqueio ao tentar reservar, recebendo
  `status:'conflict'` e alternativas — mesmo fluxo conversacional que o agente já trata para
  qualquer outro conflito de última hora. Estender bloqueios pra dentro de `groupSession.ts`
  (função pura compartilhada com a UI manual de turma) tocaria também o caminho manual, que tem
  a MESMA lacuna hoje — escopo maior que esta fatia, registrado aqui como gap conhecido.
- **`update`/reagendamento via agente não mudou nesta fatia** — já usava `updateAppointmentSafeAdmin`
  (o núcleo real) desde antes; não fazia parte da divergência.
- **Suporte a `professionalIds[]` (multi-profissional) no contrato do agente não foi adicionado**
  — `BookParams`/o schema Zod do tool (`lib/contracts/api/agent/agenda.ts`) continuam só com
  `professionalId` singular. Não foi pedido, e mudar o contrato do agente (incluindo o prompt do
  LangGraph) é uma decisão de produto maior, fora do escopo de "convergir pro núcleo existente".
- **Capacidade de turma no guard genérico (`createAppointmentSafeAdmin`/`AdminAppointmentPayload`)
  não foi estendida** — deliberado: nenhum outro caller desse guard (CRM/PDV/API v1) hoje cria
  agendamento de turma, então adicionar `capacity`/`SessionFullError` lá seria abstração sem uso
  real. A contagem de vagas da turma permanece onde já era correta e atômica: dentro da própria
  transação de `bookGroupAppointment`.

## 6. Verificação

`tsc --noEmit` limpo. Suíte completa: 976 testes em 74 arquivos aprovados, **mesma contagem de
antes desta fatia** — nenhum teste novo foi adicionado. Escolha deliberada, não descuido: esta
rota nunca teve testes próprios (nenhuma rota deste projeto tem — confirmado em fatias
anteriores desta sessão), e a lógica nova introduzida aqui é fundamentalmente colagem — chamar
`checkAppointmentConflict`/`createAppointmentSafeAdmin`/`fetchActiveBlocksTx`/
`fetchBusinessBufferMinutesTx`, todas já cobertas por suas próprias suítes
(`appointmentConflicts.test.ts`, testes de `appointmentTxGuardAdmin.ts`/`groupSession.ts`) — com
os parâmetros corretos, não reimplementar regra. Criar um harness de mock de Firestore só pra
esta rota, pra esta fatia, seria um projeto à parte maior que o risco que resolve.

**Não testado nesta rodada**: uma conversa real com o agente (web/WhatsApp) fazendo um `book`
de verdade contra um tenant com bloqueios de agenda e buffer configurados. Antes de confiar
100%, recomenda-se ao menos um smoke manual: (1) marcar um bloqueio de férias pro profissional X,
pedir ao agente (via `/api/booking/chat` ou WhatsApp) um horário dentro do bloqueio → esperar
recusa com alternativas; (2) configurar buffer de 15min, agendar via agente um horário a menos de
15min de um atendimento existente → esperar recusa; (3) profissional com dia de folga marcado →
`check_availability` não deve mais oferecer esse profissional nesse dia.

## 7. Estado do M06 após esta fatia

Com M06.7 entregue, restam do plano: M06.9 (testes concorrentes, isolamento multi-tenant, smoke
de aceite/homologação) — o último item do checklist inteiro do M06. Ver
`docs/paridade/M06_PLANO_IMPLEMENTACAO.md` §6/§7 para o detalhamento.
