# Agenda — congelamento de comportamento por canal (M06.0b)

> Concluído em código em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: dois itens pendentes de M06.0 (`docs/paridade/M06_PLANO_IMPLEMENTACAO.md`):
> "congelar em teste o comportamento válido de cada canal" e "fixtures dedicadas por cenário".
> M06.0a (auditoria) foi concluída em 03/09/2026; estes dois itens ficaram para depois.

## 1. Atualização necessária antes de executar: a lista de canais mudou

O texto original de M06.0 (escrito antes de M06.1) dizia que faltava caracterizar "os dois
canais sem guard (PDV, CRM)". Isso ficou desatualizado: **M06.1 já migrou os dois** pro núcleo
compartilhado — `ScheduleActionDialog.tsx` (CRM) e `PDVModule.tsx` (PDV) hoje criam agendamento
via `POST /api/appointments` (confirmado lendo os dois arquivos: mesmo comentário `// M06.1:
criação via rota autoritativa server-side` nos dois). Não sobrou nenhum canal humano criando
`appointments` via `addDoc` direto.

O canal que **continua** com algoritmo genuinamente próprio, não caracterizado por nenhum
teste, é o **Agente IA / booking público** (`app/api/agent/tools/agenda/route.ts`) — esse é o
alvo real desta fatia, junto com as fixtures versionadas.

## 2. Fixtures versionadas (`tests/fixtures/m06/*.json`)

5 arquivos, um por cenário canônico (mesmo padrão de `tests/fixtures/m02/`): `exclusive-booking`,
`group-session`, `multi-professional`, `no-professional`, `recurring-series`. Cada um descreve
`members`, agendamentos existentes e um ou mais candidatos, com o resultado esperado documentado
no teste que os consome (`tests/contracts/m06-agenda-baseline.test.ts`).

## 3. Canais cobertos pela suíte de caracterização

Todo canal que passa por `checkAppointmentConflict` (a função pura usada pelos dois guards,
`appointmentTxGuard.ts`/`appointmentTxGuardAdmin.ts`) está coberto pelas fixtures: Agenda,
Conversas→agendar, CRM, PDV e API v1 — todos concordam entre si POR CONSTRUÇÃO, já que
delegam pra mesma função. As fixtures caracterizam a função em si, não cada canal
individualmente (testar cada canal separadamente seria redundante — eles não têm lógica
própria de conflito, só chamam o guard).

## 4. Canal do Agente IA/booking público — caracterizado em prosa, não em teste automatizado

`app/api/agent/tools/agenda/route.ts` tem um algoritmo de conflito **totalmente próprio**,
independente de `checkAppointmentConflict`. Testá-lo isoladamente exigiria mockar toda a
camada HTTP/HMAC da rota — nenhuma rota deste repo tem teste de rota hoje (confirmado
repetidamente nas fatias M06.5a/b/c desta mesma sessão), e criar essa exceção só pra esta rota
seria inconsistente. Em vez de um teste automatizado, o comportamento atual fica documentado
aqui, com citação exata — a mesma função de "rede de segurança antes de convergir" que um teste
daria, só que em prosa.

### 4.1 — Divergência real #1: "sem profissional" bloqueia TUDO (oposto do núcleo compartilhado)

```ts
// app/api/agent/tools/agenda/route.ts:735-739
// Appointments do MESMO profissional efetivo (ou não-atribuídos, que
// bloqueiam todos) candidatos a conflito/contagem.
const relevant = dayAppts.filter(a =>
  !a.professionalId || !effectiveProfessionalId || a.professionalId === effectiveProfessionalId,
);
```

Quando `effectiveProfessionalId` está ausente (candidato sem profissional escolhido) **OU**
quando um appointment existente não tem `professionalId`, ambos são considerados "relevantes"
— ou seja, **um agendamento sem profissional bloqueia QUALQUER outro agendamento no mesmo
horário**, mesmo que também não tenha profissional escolhido.

Isso é o **oposto exato** da regra do núcleo compartilhado
(`lib/services/appointmentConflicts.ts`): *"Sem profissional escolhido: não há contra o que
conflitar... operador pode estar agendando 'qualquer um disponível'"* — que retorna
`hasConflict: false` de propósito. Confirmado, não é bug de digitação — é uma escolha de design
diferente e não documentada como tal até agora. Quando M06.7 unificar esse canal no núcleo
compartilhado, essa é a mudança de comportamento mais visível a esperar (pra melhor: hoje o
booking público/agente pode recusar um horário que na verdade estaria livre, só porque outro
"qualquer profissional" foi marcado no mesmo slot).

### 4.2 — Divergência real #2: cast morto nunca respeita `workingHours` individual

```ts
// app/api/agent/tools/agenda/route.ts:373
const profSchedule = (prof.workingHours as unknown as Record<string, WorkSchedule[]> | undefined);
...
if (profSchedule && Array.isArray(profSchedule[String(dayOfWeek)])) {
  const entries = profSchedule[String(dayOfWeek)].filter(w => w.isActive !== false);
  ...
```

O schema real de `User.workingHours` é `Record<number, {enabled, start, end}>` — **um objeto
por dia**, não um array (`WorkSchedule[]`). `Array.isArray(profSchedule[String(dayOfWeek)])`
é **sempre `false`** contra dado real, então este branch nunca executa — cai sempre pro horário
do negócio (`bizHours`) ou pro fallback fixo `08:00`-`18:30` (`route.ts:374-375`). Confirmado
lendo o código atual (não mudou desde a investigação da M06.3a). Efeito prático: o booking
público/agente **nunca respeitou** o horário de trabalho individual de um profissional — só o
do negócio como um todo, ou o fallback.

## 5. O que ficou de fora (deliberado)

- **Corrigir qualquer uma das duas divergências acima** — objetivo desta fatia é CONGELAR
  (documentar) o comportamento atual antes de convergir, não convergir agora. Ambas seguem
  marcadas pro M06.7 ("Booking público e agente no mesmo núcleo").
- **Teste de rota pro Agente IA/booking público** — ver §4, mesma decisão de consistência já
  tomada nas fatias anteriores desta sessão pra outras rotas.
- **Cenário de bloqueio de agenda (M06.3a) como fixture separada** — as fixtures cobrem os 5
  cenários nomeados no checklist original (exclusivo, turma, multi-profissional, série
  recorrente, sem profissional); bloqueio já tem cobertura extensa dedicada em
  `tests/services/appointmentConflicts.test.ts`/`scheduleBlockAdmin.test.ts` desde a M06.3a,
  não precisava de fixture nova — só reaproveitado como caso extra dentro da fixture
  `no-professional` (bloqueio de negócio inteiro vale mesmo sem profissional escolhido).
- **Rodar `npm run audit:m06 -- --businessId=<tenant real>` em homologação** — terceiro item do
  checklist M06.0, ainda bloqueado: não há tenant de homologação disponível pra rodar contra
  neste momento (status exato do onboarding da clínica real ficou ambíguo entre documentos
  desta sessão — vale confirmar com o usuário antes de assumir uma resposta).

## 6. Verificação

Verificado por `tsc --noEmit` limpo e suíte completa (973 testes em 74 arquivos — 968/73 da
fatia anterior mais 5 novos casos em 1 arquivo novo, sem regressão).

## 7. Evidências automatizadas

- `tests/fixtures/m06/*.json` (5 arquivos novos): exclusive-booking, group-session,
  multi-professional, no-professional, recurring-series.
- `tests/contracts/m06-agenda-baseline.test.ts` (novo, 5 casos): um por fixture, caracterizando
  o comportamento atual de `checkAppointmentConflict` pra cada cenário canônico — incluindo a
  observação de que a função pura não sabe de `sessionKey` (responsabilidade do caller) e que
  série recorrente não tem nenhum tratamento especial (cada ocorrência é independente).
