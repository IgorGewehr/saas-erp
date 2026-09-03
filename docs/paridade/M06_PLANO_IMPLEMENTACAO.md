# M06 — Plano de implementação de Agenda, Serviços, Booking e Assinaturas

> Análise concluída em: 03/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Referência funcional: Gestão Raiz
>
> Lente desta rodada: **odontologia** — cliente pagante real, módulo operacional central.
>
> Estado: M06 aberto formalmente. O módulo já recebeu hardening pontual FORA da sequência do
> roadmap (efeitos server-side, NFSe manual, cobrança/parcelamento, notas no histórico,
> lembretes). Este plano consolida o que existe, o que está divergente e o que falta.

## 0. Por que este plano NÃO é uma reescrita

M01 e M02 precisaram de núcleos novos porque a regra crítica vivia dentro de componentes visuais
e não existia uma fonte de verdade. **A Agenda não está nesse estado.** Ela já tem:

- guard transacional de conflito, em duas variantes (`lib/services/appointmentTxGuard.ts` para o
  client SDK com day-lock + version bump; `appointmentTxGuardAdmin.ts` para o Admin SDK com query
  reads nativos em transação);
- FSM declarada com a regra de comissão embutida (`lib/contracts/fsm/appointment.ts`);
- efeitos de conclusão/cancelamento já server-side, relendo o documento real, com guard de tenant
  e CAS de idempotência (`lib/contracts/_runtime/handlers/appointmentCompleted.ts`,
  `appointmentCanceled.ts`);
- turmas com contagem atômica de vagas e lock por sessão;
- 71 testes unitários entre conflitos, guards, disponibilidade de turma e handlers.

O problema não é ausência de núcleo — **é que nem todo canal usa o núcleo que existe.** Por isso a
M06 é uma operação de *convergência e fechamento de lacunas*, não de reconstrução. Isso muda o
tamanho e o risco da entrega: não há migração destrutiva de coleção, não há campo novo obrigatório,
e cada etapa é reversível isoladamente.

## 1. Resultado esperado

Ao concluir a M06, todo agendamento — venha da recepção, do PDV, do CRM, das Conversas, do booking
público, do agente de IA ou da API v1 — passará pelo **mesmo algoritmo de conflito, a mesma
validação de horário de trabalho, a mesma contagem de vagas e a mesma FSM imposta no servidor**.
Concluir um atendimento será uma operação única e reconciliável: nunca mais existirá um atendimento
marcado como concluído sem comissão, fidelidade, baixa de insumo e métricas aplicadas.

Para a odontologia especificamente: a clínica poderá agendar, confirmar, lembrar, atender, registrar
a ficha do paciente, cobrar (à vista ou parcelado) e emitir a NFS-e sem que nenhuma dessas etapas
dependa de o operador manter a aba aberta ou de o Agente IA estar ligado.

## 2. Inventário dos escritores de `appointments`

Esta tabela é o diagnóstico central. Todas as linhas foram confirmadas lendo o código, não inferidas.

| Canal | Escrita | Check de conflito | Horário de trabalho | Vagas de turma | FSM |
|---|---|---|---|---|---|
| **Agenda (recepção)** | client SDK via `createAppointmentSafe`/`updateAppointmentSafe` | day-lock + version bump + `checkAppointmentConflict` | sim | sim, atômico | validada **no browser** |
| **Conversas → agendar** | `lib/services/scheduleFromConversation.ts` → mesmo guard | idem | sim | idem | — |
| **API v1** | `/api/v1/appointments` → `createAppointmentSafeAdmin` | tx nativa Admin | sim | **não conta vagas** (delegado ao caller, por design documentado) | — |
| **Agente IA / booking público** | `app/api/agent/tools/agenda/route.ts:591` — transação **própria** | algoritmo **próprio** (não-atribuído bloqueia todos) | **não** na hora de gravar | caminho próprio (`bookGroupAppointment`) | validada no servidor |
| **CRM** (`ScheduleActionDialog.tsx:52`) | `addDoc` direto | **nenhum** | não | não | — |
| **PDV** — retorno/pré-agendamento (`PDVModule.tsx:1261`) | `addDoc` direto | **nenhum** | não | não | — |

São **três algoritmos de conflito distintos e dois canais sem nenhum**. É exatamente o padrão que a
M02 existiu para eliminar em `deliveryOrders` — com o agravante de que aqui o recurso disputado não
é estoque reponível, é a hora de uma pessoa.

### 2.1 Capacidades do AEVO que devem ser preservadas

- múltiplos profissionais por atendimento (`professionalIds[]` + campos legados sincronizados);
- turmas/sessões compartilhadas com `sessionKey`, grade semanal e capacidade;
- recorrência (séries) com cancelamento em série;
- aula experimental (`isTrial`/`trialOutcome`) e o evento de conversão para o CRM;
- BOM de serviço (`consumedComponents`) com baixa de insumo na conclusão;
- comissão por profissional/serviço, fidelidade e métricas do cliente;
- sincronização com Google Calendar e feed `/api/calendar/[slug]/[userId]`;
- lembrete in-app (60/30 min) e lembrete/confirmação/follow-up por WhatsApp;
- booking público por slug + agendamento pelo agente de IA com oferta de alternativas;
- vínculo com NFS-e e com cobrança/parcelamento no Financeiro;
- assinaturas/memberships com runner de cobrança recorrente.

### 2.2 A lente odontologia — o que a clínica realmente usa

| Necessidade da clínica | Estado hoje |
|---|---|
| Agendar consulta/procedimento | ✅ funciona, mas com 3 algoritmos divergentes (§2) |
| Não marcar dois pacientes na mesma cadeira | ⚠️ garantido só pelo canal Agenda; PDV/CRM/agente furam |
| Lembrar o paciente (WhatsApp) | ✅ corrigido nesta sessão; confirmação automática ainda exige Agente IA |
| Registrar o que foi feito na consulta | ⚠️ só `notes` livre; anamnese/ficha estruturada não existe |
| Cobrar (à vista ou parcelado) | ✅ entregue nesta sessão (`docs/agenda/AGENDA_COBRANCA.md`) |
| Emitir NFS-e do atendimento | ✅ entregue; falta homologação real do município |
| Agendar retorno do paciente | ⚠️ existe no PDV, **sem nenhuma checagem de conflito** |
| Faltas (no-show) | ⚠️ existe o status; política/cobrança é só documentação na FSM |
| Bloquear agenda (férias, feriado) | ❌ não existe |
| Cada dentista ver só seus pacientes | ❌ qualquer `operator` lê todos os agendamentos |

## 3. Diagnóstico e prioridades

### P0 — Corrigir antes de ampliar funcionalidades

1. **Múltiplos escritores com regras divergentes.** Ver §2. `ScheduleActionDialog.tsx:52` e
   `PDVModule.tsx:1261` gravam com `addDoc` puro, sem importar nenhum guard (verificado: nenhum
   dos dois importa `appointmentTxGuard` nem `checkAppointmentConflict`). O agente tem transação
   própria com regra diferente (`route.ts:600-604`: agendamento sem profissional bloqueia todo
   mundo — o oposto de `appointmentConflicts.ts:50`, que retorna "sem conflito" quando não há
   profissional).

2. **O check de conflito ignora `professionalIds[]`.** Tanto a query
   (`appointmentTxGuard.ts:224-229` e `appointmentTxGuardAdmin.ts:95-99`, ambas
   `where('professionalId','==',X)`) quanto o filtro (`appointmentConflicts.ts:81`,
   `a.professionalId === professionalId`) usam **apenas o campo legado**. O codebase tem
   `getAppointmentProfessionalIds`, `isAppointmentAssignedTo` (`lib/utils/appointment.ts`) e
   `fetchAppointmentsForProfessional` (`lib/services/appointments-server.ts`) criados exatamente
   para esse schema duplo — e o caminho de conflito não usa nenhum deles. Consequência: um
   profissional que esteja na **segunda posição ou além** de um atendimento multi-profissional é
   invisível para o check e pode ser agendado em cima.

3. **Conclusão sem efeito ("efeito órfão").** `handleStatusChange`
   (`AgendaModule.tsx:2841`) faz `updateDoc({status})` e **depois**, em uma chamada separada,
   `fetch('/api/events/dispatch')` para aplicar os efeitos. Se o navegador morrer entre as duas
   (aba fechada, rede caiu, usuário navegou), o atendimento fica `concluido` para sempre **sem
   comissão, sem fidelidade, sem baixa de insumo e sem métricas** — e nada reprocessa: verificado
   por varredura, `completionAppliedAt` só é lido/escrito pelos próprios handlers, não existe
   nenhuma rotina que procure `status==='concluido' && !completionAppliedAt`. É a mesma classe de
   problema que o coordenador recuperável da M02.2 resolve para operações comerciais.

4. **A FSM é imposta apenas no cliente.** `AgendaModule.tsx:2827` chama
   `canTransitionAppointment` no browser e em seguida grava direto. `firestore.rules:339` permite
   que qualquer membro autenticado com `isOperator()` atualize **qualquer campo** de qualquer
   agendamento do tenant. A rota do agente aplica sua própria validação no servidor — assimetria
   entre canais.

### P1 — Resolver durante a convergência

5. **`createAppointmentSafeAdmin` pula a transação inteira quando não há `professionalId`**
   (`appointmentTxGuardAdmin.ts:86-89`): grava direto, sem nenhuma checagem.
6. **O guard Admin não conta vagas de turma** — documentado no próprio cabeçalho do arquivo; a
   contagem é delegada ao caller. Só o caminho client é atômico para capacidade.
7. **Séries recorrentes não têm lock** — limitação documentada em `appointmentTxGuard.ts:31-33`; o
   `writeBatch` (`AgendaModule.tsx:2512`) é pré-validado em memória, então duas séries concorrentes
   podem se sobrepor.
8. **`Service.formTemplateId` é campo morto.** Declarado no contrato
   (`lib/contracts/domain/service.ts:55`) e no tipo legado (`lib/types/index.ts:1105`, com o
   comentário *"Intake form auto-requested when this service is booked"*), mas **nunca lido por
   nenhum código** — verificado por varredura em `lib/` e `app/`. Enquanto isso,
   `/api/forms/submit` já aceita e persiste `appointmentId`. Ou seja: a anamnese por serviço está
   meio construída e desligada.
9. **NoShowPolicy é só documentação.** Aparece em `APPOINTMENT_TRANSITION_EFFECTS`
   (`fsm/appointment.ts:53-56`) como efeito esperado, sem nenhuma implementação.
10. **Dois sistemas de lembrete independentes**: in-app por cron de 5 min
    (`appointmentReminderRunner.ts`, janelas 60/30 min, idempotente por log composto) e WhatsApp por
    cron horário (`/api/agent/scheduled/run`). Crons, janelas e premissas de fuso diferentes.
11. **Fuso fixo em BR (-03:00)** no runner de lembretes (documentado no próprio arquivo).

### P2 — Qualidade operacional, custo e segurança

12. **Listener sem janela.** `AgendaModule.tsx:2039-2044` mantém um `onSnapshot` em **todos os
    agendamentos do tenant**, sem filtro de data e sem `limit`, ordenado por data. Para uma clínica
    com anos de histórico isso cresce indefinidamente em custo de leitura, memória e tempo de
    primeira carga. A lista de clientes (`:2085`) também é carregada inteira só para montar um mapa
    de nomes.
13. **`AgendaModule.tsx` tem 3848 linhas**, concentrando UI, orquestração e escrita — mesmo
    diagnóstico que M01 fez de `InventoryModule`/`ComprasModule`.
14. **Sem segregação por profissional.** `firestore.rules:327-337` dá leitura de todos os
    agendamentos do tenant a qualquer `isOperator()`. Aceitável para uma clínica pequena de equipe
    confiável, mas é dado de saúde — deve ser decisão explícita, não default silencioso.
15. **Faltam testes de caracterização por canal.** Os 71 testes existentes cobrem lógica pura e os
    guards; nenhum teste garante que os canais *concordam entre si*.

## 4. Decisões de escopo

### Portar do Gestão Raiz

- fonte única de disponibilidade e conflito, imposta no servidor;
- FSM validada no servidor em toda transição, não só na interface;
- reconciliação de efeitos pendentes com retentativa idempotente;
- bloqueios de agenda (indisponibilidade planejada) como entidade de primeira classe.

### Adaptar

- convergir para um núcleo único **sem** reescrever a Agenda: o guard existente vira a base do
  núcleo server-side, em vez de um núcleo novo paralelo;
- manter as duas variantes (client/Admin) apenas enquanto a migração por canal não terminar;
- no-show simplificado (marcar, medir e opcionalmente cobrar), sem política industrial de penalidade;
- anamnese usando o motor de formulários que já existe, sem criar um subsistema clínico novo.

### Manter do AEVO

- turmas, grade semanal, recorrência, aula experimental e BOM de serviço;
- Google Calendar, booking público, agente de IA e feed de calendário;
- lembretes por WhatsApp e in-app;
- vínculos já entregues com NFS-e, Financeiro/parcelamento e fidelidade.

### Não aplicar

- prontuário clínico estruturado (odontograma, evolução por dente, imagens radiológicas) — é
  domínio de um EHR odontológico, não de um ERP genérico; a decisão consciente é continuar com
  `notes` + formulários e **não** prometer registro clínico;
- gestão de recursos industriais (salas/equipamentos com manutenção programada) além de um bloqueio
  simples de agenda;
- overbooking/lista de espera com regra de sobrevenda.

## 5. Arquitetura-alvo

```text
Agenda | PDV | CRM | Conversas | Booking público | Agente IA | API v1
                              │
                              ▼
                  Fronteiras autenticadas/Zod
                              │
                              ▼
                    Núcleo de Agendamento M06
                    ├── disponibilidade (horário, bloqueios, grade)
                    ├── conflito único (honra professionalIds[])
                    ├── capacidade de turma (atômica)
                    ├── FSM + transição server-side
                    ├── efeitos de conclusão/cancelamento (handlers atuais)
                    └── reconciliação de efeitos pendentes
                              │
                              ▼
              appointments | appointmentDayLocks | appointmentSessionLocks
                              │
                              ├── transactions (comissão, cobrança)
                              ├── stockMovements (BOM de serviço)
                              ├── clients (métricas) / loyaltyLedger
                              └── fiscalDocuments (NFS-e)
```

O núcleo é **um serviço Admin SDK** (`lib/services/appointment-server.ts`) consumido por rotas
autenticadas. A interface continua com `onSnapshot` para leitura em tempo real, mas deixa de ser
autoridade sobre "esse horário pode".

## 6. Etapas de implementação

### M06.0 — Baseline e caracterização

- [ ] Registrar todos os escritores de `appointments` e a regra de cada um (a tabela §2 é o início).
- [ ] Congelar em teste o comportamento **válido** de cada canal antes de convergir.
- [ ] Fixtures: exclusivo, turma, multi-profissional, série recorrente, sem profissional atribuído.
- [ ] Auditoria read-only por tenant: concluídos sem `completionAppliedAt`; sobreposições já
      existentes na base; agendamentos sem `professionalIds`; agendamentos fora do horário de
      trabalho do profissional.

**Saída:** evidência de quanto do problema já existe nos dados reais antes de mudar qualquer regra.

### M06.1 — Núcleo único de agendamento

- [ ] Criar `lib/services/appointment-server.ts` com criação/edição autoritativa (Admin SDK).
- [ ] **Um** algoritmo de conflito, honrando `professionalIds[]` via os helpers já existentes.
- [ ] Validar horário de trabalho, grade de turma e capacidade dentro da mesma transação.
- [ ] Expor `/api/appointments` (create/update) autenticada, `operator+`.
- [ ] Migrar por canal, do menor risco para o maior: **CRM e PDV primeiro** (hoje sem nenhuma
      checagem, superfície mínima), depois agente/booking, depois `AgendaModule`.
- [ ] Fechar o caso "sem `professionalId`" do guard Admin (P1.5).

**Saída:** impossível criar dois atendimentos sobrepostos por qualquer caminho.

### M06.2 — Transição e conclusão reconciliáveis

- [ ] `PATCH /api/appointments/[id]/transition` como única forma de mudar status — mesmo padrão que
      a M02.5d aplicou a `deliveryOrders`.
- [ ] FSM validada no servidor; interface passa a exibir o erro, não a decidir.
- [ ] Aplicar os efeitos na **mesma** chamada da transição, eliminando a janela do P0.3.
- [ ] Varredura de reconciliação (cron): `concluido && !completionAppliedAt` → reemite o efeito,
      idempotente pelo CAS já existente.
- [ ] Restringir nas rules a escrita direta de `status` pelo cliente depois da migração.

**Saída:** nenhum atendimento concluído fica sem comissão, fidelidade, insumo e métricas.

### M06.3 — Disponibilidade, bloqueios e no-show

- [ ] Bloqueios de agenda (férias, feriado, almoço, sala/equipamento indisponível) como entidade.
- [ ] Intervalo/buffer configurável entre atendimentos.
- [ ] Horário de trabalho respeitado em **todos** os canais (hoje o agente não revalida ao gravar).
- [ ] Política de no-show: marcar, medir e opcionalmente gerar cobrança — hoje só existe o status.

**Saída:** a agenda reflete a disponibilidade real da clínica, não só a ausência de conflito.

### M06.4 — Ficha do paciente e anamnese

- [ ] Implementar `Service.formTemplateId` (campo morto hoje): ao agendar um serviço que declare um
      template, solicitar o formulário ao paciente.
- [ ] Vincular a submissão ao atendimento — `/api/forms/submit` já aceita `appointmentId`.
- [ ] Exibir formulários respondidos no histórico do paciente, ao lado das notas já entregues.
- [ ] Deixar explícito na documentação que isto **não** é prontuário clínico estruturado.

**Saída:** a clínica registra anamnese/ficha de saúde sem sair do AEVO.

### M06.5 — Lembretes, confirmação e reengajamento

- [ ] Consolidar os dois sistemas de lembrete numa única definição de janela e idempotência.
- [ ] Confirmação do paciente ("confirmo") atualizando status **sem** exigir o Agente IA completo.
- [ ] Fuso horário por negócio, substituindo o `-03:00` fixo.
- [ ] Reengajamento de paciente sem retorno há N meses (recall), reaproveitando CRM/campanhas.

**Saída:** menos cadeira vazia, sem depender de configuração escondida.

### M06.6 — Cobrança, fiscal, comissão e assinaturas

- [ ] Consolidar a cadeia atendimento → cobrança → NFS-e (parcialmente entregue).
- [ ] Ligar memberships/assinaturas à agenda (plano com N consultas, retorno incluso).
- [ ] Estado fiscal consultável e reprocessável a partir do atendimento.

### M06.7 — Booking público e agente no mesmo núcleo

- [ ] Booking público e agente passam a usar o núcleo M06.1, aposentando os algoritmos próprios.
- [ ] Capacidade de turma atômica também nesses caminhos.

### M06.8 — Desempenho, custo e segurança

- [ ] Janela de datas no listener da Agenda (hoje carrega o histórico inteiro do tenant).
- [ ] Paginação/lookup sob demanda da lista de clientes.
- [ ] Decidir explicitamente a visibilidade por profissional (rules + interface).
- [ ] Extrair persistência e orquestração de `AgendaModule.tsx` (3848 linhas).

### M06.9 — Testes, homologação e aceite

- [ ] Testes concorrentes: dois canais diferentes disputando o mesmo horário.
- [ ] Teste de multi-profissional (profissional em 2ª posição não pode ser duplo-agendado).
- [ ] Teste de falha após a transição, antes do efeito → reconciliação recupera.
- [ ] Testes de isolamento entre dois `businessId` em todos os efeitos.
- [ ] Smoke manual do fluxo completo da clínica: agendar → lembrar → confirmar → atender → registrar
      → cobrar → emitir NFS-e.

## 7. Ordem de entrega recomendada

1. **M06.0** — baseline (mede o estrago real antes de mexer).
2. **M06.1** — núcleo único (elimina duplo agendamento).
3. **M06.2** — transição/conclusão reconciliável (elimina perda silenciosa de dinheiro).
4. **M06.4** — anamnese (maior valor clínico novo, escopo pequeno, campo já existe).
5. **M06.3** — bloqueios e no-show.
6. **M06.5** — lembretes consolidados.
7. **M06.8** — custo e segurança.
8. **M06.6** e **M06.7** — cobrança/assinaturas e canais externos.
9. **M06.9** — aceite.

**Mínimo para a odontologia operar com segurança: M06.0 → M06.1 → M06.2**, mais o bloqueio de
agenda da M06.3. O resto é ganho incremental, não pré-requisito.

## 8. Critérios para marcar M06 como concluído

- [ ] Existe um único algoritmo de conflito e todos os canais o usam.
- [ ] O check de conflito honra `professionalIds[]`, não só o campo legado.
- [ ] Nenhum canal grava `appointments` sem passar pelo núcleo.
- [ ] A FSM é imposta no servidor em toda transição.
- [ ] Não existe atendimento concluído sem efeitos aplicados ou pendência recuperável.
- [ ] Repetir a mesma operação não duplica comissão, fidelidade, insumo ou métrica.
- [ ] Horário de trabalho e bloqueios são respeitados em todos os canais.
- [ ] Turma nunca excede a capacidade, em nenhum caminho.
- [ ] Listeners da Agenda têm janela/limite.
- [ ] Testes concorrentes e de isolamento multi-tenant aprovados.
- [ ] Smoke manual do fluxo completo da clínica aprovado em homologação.

## 9. Riscos e controles

| Risco | Controle planejado |
|---|---|
| Quebrar a agenda da clínica ao convergir canais | testes de caracterização por canal (M06.0) + migração canal a canal, do menor para o maior |
| Recusar agendamento hoje aceito (regra mais estrita) | auditoria prévia mostra quantos registros atuais violariam a regra nova; divergência vira decisão explícita, como foi feito na M02.5b |
| Duplo agendamento durante a migração | canal migrado passa a usar o núcleo de uma vez; sem dual-write |
| Perder efeito de conclusão | efeito na mesma transação + varredura de reconciliação idempotente |
| Regressão em turmas ao unificar o conflito | fixtures de turma no baseline + capacidade atômica preservada |
| Custo do Firestore ao crescer o histórico | janela de datas e paginação (M06.8) |
| Expor dado de paciente entre profissionais | decisão explícita de visibilidade (M06.8), não default silencioso |
| Prometer prontuário clínico sem ser um EHR | escopo negativo declarado (§4) e repetido na documentação da M06.4 |

## 10. Dependências e relação com outros módulos

- **M03 (Financeiro):** a cobrança do atendimento já existe como ligação pontual
  (`docs/agenda/AGENDA_COBRANCA.md`), mas o módulo Financeiro clássico ainda escreve pelo SDK
  cliente sem validação de servidor. A M06.6 não deve endurecer o Financeiro — isso é M03.
- **M04 (Fiscal):** a emissão de NFS-e a partir do atendimento já está entregue; falta a
  homologação real do município da clínica (bloqueada no cliente, ver `ROADMAP_FISCAL_BACKLOG.md`).
- **M07 (Conversas):** os lembretes/confirmação por WhatsApp dependem de canal conectado. A M06.5
  consolida a regra de agendamento; a robustez do canal em si é M07.
- **M10 (Automações):** a varredura de reconciliação da M06.2 e os crons de lembrete são casos de
  uso concretos do que a M10 deve padronizar (idempotência, retentativa, dead-letter).
- **M01 (Estoque):** a baixa de insumo do BOM de serviço já usa o núcleo M01 — sem dependência nova.

## 11. Entregas já realizadas fora da sequência

Registrado aqui para que a M06.0 não recomece do zero:

| Entrega | Documento |
|---|---|
| Efeitos de conclusão/cancelamento migrados para handlers server-side | `docs/agenda/AGENDA_HARDENING_EFEITOS_SERVIDOR.md` |
| Emissão manual de NFS-e a partir do atendimento concluído | `docs/agenda/AGENDA_NFSE_MANUAL.md` |
| Lembretes de WhatsApp (bug de elegibilidade) + notas no histórico do paciente | `docs/agenda/AGENDA_LEMBRETES_E_HISTORICO.md` |
| Cobrança/parcelamento ligando atendimento ao Financeiro | `docs/agenda/AGENDA_COBRANCA.md` |
