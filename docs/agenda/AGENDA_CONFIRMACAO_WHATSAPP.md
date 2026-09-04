# Agenda — confirmação leve do paciente via WhatsApp — M06.5a

> Concluído em código em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: primeiro item do checklist M06.5 (`docs/paridade/M06_PLANO_IMPLEMENTACAO.md`):
> "Confirmação do paciente ('confirmo') atualizando status sem exigir o Agente IA completo."

## 1. O que foi entregue

Hoje, quando a clínica manda a pergunta de confirmação por WhatsApp (`Responda "confirmo"
para reservar...`, `app/api/agent/scheduled/run/route.ts`), só tenants com o Agente IA pago
ligado tinham QUALQUER reação automática à resposta do paciente — o resto ficava sem nada,
mesmo a pergunta já saindo. Esta fatia fecha esse gap com um caminho leve, determinístico, que
NÃO depende do agente:

1. `lib/utils/confirmationKeywords.ts` — detector de palavra-chave (`isConfirmationKeyword`),
   mesmo formato do detector de opt-out já existente.
2. `lib/services/agenda/whatsappConfirmation.ts` — correlaciona a resposta com o agendamento
   certo por telefone e confirma via `transitionAppointmentAdmin` (núcleo atômico da M06.2) —
   só age quando há exatamente UM candidato inequívoco.
3. Ligado nos dois webhooks de WhatsApp (Meta Cloud API e Baileys) — funciona
   independentemente de qual canal a clínica usa.
4. Novo campo `Appointment.confirmedVia?: 'whatsapp-auto'` — ausente = confirmado manualmente
   por um atendente (comportamento de sempre); presente = o próprio paciente confirmou.

## 2. Por que não existe um vínculo direto "esta conversa" → "este agendamento"

Investigação (2 rounds de Explore + validação com Plan agent) confirmou que essa ligação
simplesmente não existe hoje: `Appointment.conversationId` é gravado uma única vez, na criação
(proveniência, não um ponteiro vivo); `Conversation.crmContactId` é best-effort (casado por
telefone só na criação da conversa, sem retry no lado Baileys). O próprio cron de lembrete
(`scheduled/run/route.ts`) já resolve a conversa por TELEFONE toda vez que manda uma mensagem,
não por um ID guardado — replicamos essa mesma estratégia de correlação, só que na direção
inversa (resposta → agendamento).

Como não há um ponteiro confiável, o critério de segurança escolhido foi: só agir quando há
**exatamente um** agendamento candidato (`status === 'agendado'`, `confirmationRequestedAt`
setado — perguntamos e ainda não tivemos resposta —, `date` não é passada, telefone bate via
`brPhonesMatch`). Zero ou dois-ou-mais candidatos: não faz nada, nunca adivinha qual dos dois
agendamentos o paciente quis confirmar. Reaproveita `brPhonesMatch`
(`lib/contracts/_runtime/phone-br.ts`) — a mesma função "fonte da verdade" que os dois webhooks
já usam pra linkar contato de CRM — em vez do `.replace(/\D/g,'')` mais fraco que o próprio
cron de lembrete usa.

## 3. Por que "confirmo" mas não "cancelar"

A própria pergunta de confirmação convida o paciente a responder "cancelar" também
("...ou 'cancelar' caso precise desmarcar"). Achado importante durante a investigação:
`'cancelar'`/`'cancel'` **já são palavras-chave de opt-out de marketing** (LGPD,
`lib/utils/optOutKeywords.ts`), uma feature já em produção. Tratar "cancelar" como cancelamento
de agendamento nesta mesma fatia colidiria semanticamente com esse recurso já existente —
precisaria de um texto de pergunta diferente ou de uma coordenação deliberada entre as duas
lógicas, decisão maior que não foi tomada aqui. Esta fatia trata só a confirmação.

## 4. Por que rodar sem checar `aiAgent.enabled`

O pedido do roadmap é "sem EXIGIR o agente", não "só quando o agente está desligado". Deixar
essa checagem incondicional (mesmo racional do detector de opt-out, que também roda
independente do agente) significa que tenants COM agente ligado também ganham: uma confirmação
síncrona e determinística, em vez de esperar o loop assíncrono do LLM. Os dois caminhos foram
verificados quanto a conflito: se o caminho novo ganhar a corrida (mais provável — é uma query +
write direto, o agente tem debounce + round-trip de LLM), a tentativa posterior do agente
(`agenda_update status='confirmado'`) bate no mesmo status e vira no-op pelo próprio guard de
"status igual, sem FSM" que já existe em `app/api/agent/tools/agenda/route.ts`. Se o agente
ganhar primeiro, o filtro `status==='agendado'` do caminho novo já exclui o candidato (não é
mais candidato — já está confirmado). Nenhum dos dois lança erro em nenhuma ordem.

## 5. Núcleo reaproveitado, não reimplementado

`tryAutoConfirmFromWhatsAppReply` chama `transitionAppointmentAdmin`
(`lib/services/appointment-server.ts`, núcleo da M06.2) em vez de reimplementar a checagem de
FSM — mesma disciplina de "um núcleo" já aplicada a bloqueios (M06.3a), no-show (M06.3b) e
buffer (M06.3c). Avaliado e descartado: adicionar um `actorType`/`type` em
`AppointmentTransitionActor` pra marcar a transição como `'system'` no lugar de `'user'`
hardcoded — investigação confirmou que `agendado → confirmado` **não dispara nenhum domain
event** por essa função (só concluído/no-show/reversão de concluído disparam), então esse
hardcode nem é alcançado por esta transição. Mudar um arquivo compartilhado e já testado pra
zero ganho real não se justificou; fica documentado que `lib/services/delivery-order-server.ts`
já tem o padrão pronto (`type: params.context.actorType ?? 'system'`) pra quando isso importar
de verdade.

## 6. `confirmedVia` — só observabilidade

Sem esse campo, não haveria NENHUM jeito de um atendente saber depois se foi ele mesmo ou o
próprio paciente quem confirmou um atendimento — relevante se o paciente disputar. É uma
gravação separada, best-effort, DEPOIS da transição principal já ter sido aplicada com sucesso —
uma falha nela não desfaz nem impede a confirmação em si.

## 7. O que ficou de fora (deliberado)

- **"Cancelar" via WhatsApp** — colisão com opt-out, ver §3.
- **Consolidar os dois sistemas de lembrete** (in-app + WhatsApp cron) — item separado do
  checklist M06.5; mexe em cron já rodando em produção pra esta clínica, escopo próprio.
- **Fuso horário por negócio** — `todayStr` usa o mesmo cálculo ingênuo em UTC que
  `scheduled/run/route.ts` já usa pra perguntar a confirmação, por consistência entre quem
  pergunta e quem processa a resposta; item de fuso é checklist separado do M06.5.
- **Reengajamento (recall)** — item separado do checklist M06.5.
- **Desambiguação com IA quando há 2+ candidatos** — silenciosamente não age, mesmo estado de
  hoje pra tenants sem agente.
- **`actorType`/`type` em `AppointmentTransitionActor`** — avaliado, descartado por zero ganho
  nesta transição específica (§5).

## 8. Verificação

Verificado por `tsc --noEmit` limpo e suíte completa (958 testes em 71 arquivos — 935/69 da
fatia anterior mais 23 novos casos em 2 arquivos novos, sem regressão). **Não testado
manualmente contra o WhatsApp de verdade** nesta rodada (sem sessão de dev server nem webhook
ativo). Antes de considerar pronto pra uso real: com um agendamento de teste tendo
`confirmationRequestedAt` setado, mandar "confirmo" do número vinculado ao cliente → conferir
que o status virou `confirmado` e `confirmedVia` gravou `'whatsapp-auto'`; com dois
agendamentos pendentes pro mesmo telefone, confirmar que nada muda (ambíguo, sem ação).

## 9. Evidências automatizadas

- `tests/utils/confirmationKeywords.test.ts` (novo, 10 casos): match exato, case-insensitive,
  pontuação de borda, frases maiores não ativam, vazio/null/undefined, string longa demais,
  palavras não relacionadas.
- `tests/services/whatsappConfirmation.test.ts` (novo, 13 casos): 8 em
  `pickAutoConfirmCandidate` (função pura — único candidato, telefone com formato diferente,
  zero candidatos, ambíguo, já confirmado não conta, sem `confirmationRequestedAt`, data
  passada, telefone diferente, cancelado) + 5 no shell `tryAutoConfirmFromWhatsAppReply`
  (`transitionAppointmentAdmin` mockado — não é keyword, confirma e grava `confirmedVia`,
  ambíguo não chama transição, nunca lança em erro interno).
- Suíte completa: 958 testes em 71 arquivos aprovados. `tsc --noEmit` limpo.
