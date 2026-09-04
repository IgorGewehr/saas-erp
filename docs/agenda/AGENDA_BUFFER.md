# Agenda — intervalo/buffer entre atendimentos — M06.3c

> Concluído em código em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: último item pendente do checklist M06.3 (`docs/paridade/M06_PLANO_IMPLEMENTACAO.md`):
> "Intervalo/buffer configurável entre atendimentos". Bloqueios (M06.3a) e no-show (M06.3b) já
> tinham fechado os outros dois itens dessa seção — com isso, M06.3 fica completo.

## 1. O que foi entregue

Novo setting `Business.settings.appointmentBufferMinutes` (Configurações → Empresa → seção
"Agenda"), exigindo um intervalo mínimo (minutos) entre dois atendimentos consecutivos do
mesmo profissional — tempo de limpeza/preparo entre pacientes. 0/ausente (padrão) = sem
intervalo mínimo, comportamento idêntico ao de antes desta fatia.

`checkAppointmentConflict` (`lib/services/appointmentConflicts.ts`) ganhou um terceiro
parâmetro opcional retrocompatível, `bufferMinutes?`, seguindo o mesmo padrão de
`professionalIds?` (M06.1) e `blocks?` (M06.3a): omitir o parâmetro preserva o comportamento
atual byte-a-byte. Aplicado só no Check 2 (overlap entre atendimentos) — bloqueios e horário de
trabalho não são afetados.

## 2. Por que não foi um algoritmo novo

Mesmo princípio já repetido em M06.1/M06.3a/M06.3b: em vez de criar uma checagem paralela de
"tem intervalo suficiente?", o buffer entrou como mais um parâmetro da MESMA função pura que já
decide "pode agendar aqui?". Isso significa que qualquer canal que já usa o núcleo
(`appointmentTxGuard.ts`/`appointmentTxGuardAdmin.ts`) ganha a checagem automaticamente, sem
tocar nesses call-sites: Agenda, Conversas→agendar, CRM (`ScheduleActionDialog.tsx` →
`POST /api/appointments`), PDV (idem) e a API v1 — mesmo efeito "de graça" que bloqueios já
teve em M06.3a.

Um caso a mais que vale registrar explicitamente: a ferramenta de **reagendamento** do agente
de IA (`app/api/agent/tools/agenda/route.ts` → `updateAppointment` → `updateAppointmentSafeAdmin`)
também passa a respeitar o buffer — desejável (evita a IA mover um paciente pra um horário que
fura o intervalo de limpeza da clínica), não um efeito colateral indesejado. Já a **criação**
de agendamento pelo agente (`bookAppointment`) usa um algoritmo totalmente próprio, não
`checkAppointmentConflict` — continua fora, mesmo destino de unificação futura (M06.7) já usado
pra bloqueios e no-show.

## 3. Minutos em vez de string HH:mm na comparação

O resto do arquivo compara horários como string (`startTime < daySchedule.start`), o que só
funciona porque nunca cruza a virada do dia. Somar buffer a um horário perto da meia-noite
poderia produzir algo além de `23:59`, quebrando essa comparação lexicográfica — por isso o
Check 2 converte pra minutos-desde-meia-noite antes de comparar (`toMinutes`, helper local).
Essa função é uma **cópia intencional** de `timeToMinutes`
(`app/components/features/agenda/shared.ts`), não uma importação: `appointmentConflicts.ts` se
declara explicitamente "sem React, sem Firestore" e roda também no Admin SDK server-side, então
não deveria depender de um arquivo da camada de UI mesmo que hoje `shared.ts` não tenha nenhuma
dependência de React.

## 4. Onde o guard busca o valor configurado

Nenhum dos dois guards lia `businesses`/`business.settings` antes desta fatia. Sigo o mesmo
"buraco preenchido" que bloqueios já resolveu com sua própria busca interna: cada guard ganhou
uma função (`fetchBusinessBufferMinutesClient`/`...Tx`) que lê o doc do negócio uma vez por
chamada de `createAppointmentSafe(Admin)`/`updateAppointmentSafe(Admin)`, ao lado da busca de
bloqueios já existente — leitura de doc por ID (não query), custo mínimo, consistente
transacionalmente no lado Admin (`tx.get`). Os ramos "sem profissional escolhido" (que chamam
`checkAppointmentConflict` com `appointments: []`) não recebem o novo parâmetro — buffer não
pode fazer diferença ali, o filtro de overlap nem roda.

## 5. Mensagem diferenciada

Quando o conflito só existe por causa do intervalo mínimo (havia um vão real entre os dois
atendimentos, só menor que o exigido), a mensagem é `agenda.bufferConflict` ("Intervalo mínimo
de N min não respeitado — conflita com..."), diferente de `agenda.conflictWith` (sobreposição
real, que existiria mesmo com buffer=0). Isso evita confundir o operador — um horário "livre"
sendo recusado merece uma explicação diferente de um horário genuinamente ocupado.

## 6. O que ficou de fora (deliberado)

- **Buffer por serviço** — só um valor global por negócio nesta fatia; diferentes procedimentos
  não podem ter intervalos diferentes (ex.: limpeza simples vs. cirurgia).
- **Buffer assimétrico** (antes/depois diferentes) — um único valor simétrico.
- **Pré-check visual em Agenda/Conversas** (`checkConflicts` usado pro aviso ao vivo enquanto o
  operador digita) — confirmado que `professionalIds`/`blocks` também nunca foram propagados
  pra esses dois pontos nas fatias anteriores; só o guard (camada de verdade) ganha a checagem
  nova, mesmo padrão já estabelecido (comentário já existente em
  `ScheduleFromConversationDialog.tsx`: "UI já avisa visualmente mas o save handler é a última
  barreira"). `ScheduleFromConversationDialog.tsx` nem tem `business` em escopo hoje — fazer
  diferente aqui exigiria prop nova só pra este ponto.
- **Agente de IA — criação** — continua com algoritmo próprio, mesmo destino de M06.7.
- **Mudança visual no calendário** — não reserva bloco maior nem muda `endTime` armazenado; é
  só um critério a mais na hora de checar conflito.

## 7. Verificação

Verificado por `tsc --noEmit` limpo e suíte completa (935 testes em 69 arquivos — 921/69 da
fatia anterior mais 14 novos casos, sem regressão, nenhum arquivo de teste novo). **Não testado
manualmente num navegador** nesta rodada (sem sessão de dev server ativa). Antes de considerar
pronto pra uso real: configurar um intervalo (ex. 15 min) em Configurações → Empresa → Agenda →
tentar agendar um atendimento colado (sem vão) logo depois de outro do mesmo profissional →
deve recusar citando o intervalo mínimo → agendar com vão suficiente → deve aceitar → confirmar
que outro profissional sem conflito continua agendável no mesmo horário.

## 8. Evidências automatizadas

- `tests/services/appointmentConflicts.test.ts`: +8 casos (sem buffer inalterado, recusa
  encaixe exato, aceita vão suficiente, mensagem diferenciada, não afeta bloqueios, não afeta
  horário de trabalho, ignora cancelado, clamp de valor negativo).
- `tests/services/appointmentTxGuard.test.ts`: +3 casos, mais a correção do mock local de
  `firebase/firestore` (faltava `getDoc` — sem isso os testes de caminho principal quebrariam
  assim que os guards passassem a chamá-lo).
- `tests/services/appointmentTxGuardAdmin.test.ts`: +3 casos, sem mudança de infraestrutura
  (o fake já suportava doc-get genérico).
- Suíte completa: 935 testes em 69 arquivos aprovados. `tsc --noEmit` limpo.
