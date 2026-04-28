# Roadmap — Módulo de Conversas
> Última atualização: 2026-04-28
> Referência de análise competitiva: Zendesk, Intercom, Freshdesk, HubSpot Inbox

---

## Legenda
- 🟢 **Só código** — implementável sem dependência externa
- 🟡 **Dependência externa** — biblioteca, API de terceiro ou infraestrutura adicional
- 🔴 **Meta / Aprovação externa** — requer aprovação da Meta, template aprovado ou mudança no app Meta

---

## PRIORIDADE ALTA — Quick Wins

### Experiência de mensagens

- [ ] 🟢 **Reply to message (citar mensagem)** — ao clicar em "responder" em uma mensagem, exibir a mensagem original como quote no composer e enviar com referência. A Meta Cloud API já suporta o campo `context.message_id` no payload de envio; é necessário salvar `externalMessageId` em cada mensagem recebida e enviá-lo ao responder. No Baileys o suporte também existe.

- [ ] 🟢 **Agrupamento de mensagens consecutivas** — mensagens do mesmo remetente enviadas com menos de 2 minutos de diferença devem ser agrupadas visualmente (sem repetir avatar/nome), exatamente como o WhatsApp nativo faz. Só CSS + lógica de renderização.

- [ ] 🟢 **Scroll infinito / paginação de histórico** — hoje carrega as últimas N mensagens. Precisa carregar mensagens mais antigas ao fazer scroll para cima (`onSnapshot` com `startAfter` cursor).

- [ ] 🟢 **Indicador "digitando..."** — mostrar animação de três pontos quando o operador está compondo, visível para outros agentes que estejam com a mesma conversa aberta. Usar Firestore presence ou um campo temporário `isTyping` no documento da conversa.

- [ ] 🟡 **Reações a mensagens (emoji)** — exibir reações que o contato enviou via WhatsApp. A Meta Cloud API já entrega os webhooks de reação (`reaction` message type). Requer: (1) processar esse tipo de webhook em `/api/webhooks`, (2) salvar reações em subcoleção `reactions` ou array no documento da mensagem, (3) renderizar no `MessageBubble`.

- [ ] 🟢 **Forwarding de mensagem** — selecionar uma mensagem e encaminhá-la para outra conversa. Só precisaria de um modal de seleção de conversa destino + reenvio via API do canal.

- [ ] 🟢 **Seleção múltipla de mensagens** — segurar/clicar para selecionar mensagens, copiar texto de várias de uma vez ou deletar em lote (soft-delete visível só para o agente).

---

### Gestão de filas e SLA

- [ ] 🟢 **SLA — Timer de resposta visível** — configurar um tempo máximo de primeira resposta por setor (ex: 4h). Exibir um relógio regressivo no card da conversa na lista e um badge de alerta vermelho quando ultrapassar. Requer: (1) campo `slaDeadline` calculado ao criar conversa, (2) regra SLA configurável em Configurações → Setores, (3) lógica de renderização do timer.

- [ ] 🟢 **Alertas de SLA expirado** — quando o SLA expira, marcar a conversa com badge "SLA vencido" e gerar uma notificação para o responsável e/ou líder do setor. Usar o sistema de notificações já existente.

- [ ] 🟢 **Horário de atendimento + mensagem de ausência** — configurar janelas horárias por canal ou setor (ex: Seg–Sex 09h–18h). Fora do horário, responder automaticamente ao contato com uma mensagem configurável. Requer armazenar as regras em `businesses/{id}.settings.workingHours` e um worker/cron que verifique o horário antes de enviar.
  > ⚠️ Para WhatsApp oficial: a mensagem automática de ausência precisa ser um **template aprovado** pela Meta se for uma conversa iniciada pelo negócio fora de janela de 24h.

- [ ] 🟢 **Queue / Fila de distribuição automática** — ao receber uma nova conversa sem assignee, atribuir automaticamente ao agente disponível com menos conversas abertas no setor correspondente (round-robin simples). Só lógica de backend no webhook.

---

### Satisfação do cliente (CSAT)

- [ ] 🔴 **CSAT automático ao resolver** — ao marcar conversa como "resolvida", enviar automaticamente uma mensagem de pesquisa de satisfação (1–5 ou 😊😐😞). Requer:
  - **WhatsApp oficial**: template aprovado pela Meta com botões interativos de resposta rápida (lista de botões).
  - **WhatsApp Baileys**: pode ser texto simples com instruções.
  - **Facebook / Instagram**: mensagem de texto simples, sem aprovação.
  - Processar a resposta do cliente via webhook e salvar o score em `conversations/{id}.csatScore`.

- [ ] 🟢 **Dashboard de CSAT** — agregar as notas de satisfação por período, por agente, por canal e por setor. Adicionar card de CSAT médio no módulo de relatórios.

---

## PRIORIDADE MÉDIA

### Fluxo de atendimento avançado

- [ ] 🟢 **Roteamento automático por regras** — configurar regras do tipo "se canal = Instagram E horário = fora do expediente → atribuir ao setor Suporte". Interface drag-and-drop de condições (IF/AND/THEN). Similar ao que já existe nas automações do CRM, mas voltado para roteamento de entrada.

- [ ] 🟢 **Bot de atendimento com fluxo visual** — substituir o toggle binário de IA por um construtor de fluxo com nós: mensagem de boas-vindas → coleta de dado (ex: CPF) → if/else → transferir para humano. Fluxo salvo como JSON em `businesses/{id}.chatbotFlow`. A execução usa o webhook de entrada.
  > 🟡 Se o bot usar LLM (GPT/Claude) para respostas abertas, requer API key do provedor (Anthropic ou OpenAI) — já suportada via Enterprise integrations.

- [ ] 🔴 **Mensagens template (WhatsApp oficial)** — enviar mensagens template aprovadas pela Meta para iniciar conversas fora da janela de 24h (ex: confirmação de agendamento, lembrete de pagamento). Requer:
  - Cadastro dos templates no Meta Business Manager.
  - Aprovação pela Meta (geralmente 1–3 dias).
  - UI para selecionar template, preencher variáveis `{{1}}`, `{{2}}` e enviar.
  - Endpoint existente `/api/channels/meta-signup` precisaria de extensão para listar templates aprovados via Graph API.

- [ ] 🔴 **Mensagens interativas (botões e listas)** — enviar mensagens com botões de resposta rápida ou menus de lista no WhatsApp (ex: "Escolha uma opção: [1] Suporte, [2] Financeiro, [3] Vendas"). Requer suporte da Meta Cloud API (`interactive` message type) + template ou within 24h window.

- [ ] 🟢 **Múltiplos agentes em uma conversa** — além do `assignedTo` primário, permitir adicionar participantes secundários (`participantIds[]`). Todos recebem notificação das novas mensagens e podem responder.

- [ ] 🟢 **Transferência de conversa com contexto** — ao reatribuir, mostrar um campo opcional de "motivo da transferência" que fica como nota interna automática na conversa.

---

### Busca e histórico

- [ ] 🟡 **Busca full-text em mensagens** — pesquisar por palavras dentro do conteúdo histórico de todas as mensagens. Firestore não suporta full-text nativo. Requer integração com **Algolia** ou **Typesense** para indexar mensagens, ou uso de **Firebase Extensions** (Algolia Firestore extension).

- [ ] 🟢 **Histórico unificado do contato** — ao abrir uma conversa com contato vinculado, exibir sidebar lateral com todas as conversas anteriores daquele contato em todos os canais, em ordem cronológica. Só requer query `where('crmContactId', '==', id)` ordenada por `lastMessageAt`.

- [ ] 🟢 **Filtro por responsável na lista de conversas** — além de status e canal, filtrar conversas por qual agente está atribuído. Útil para supervisores verem a fila de um agente específico.

- [ ] 🟢 **Filtro por setor na lista de conversas** — filtrar por `assignedToSectorId`.

---

## PRIORIDADE BAIXA / FUTURO

### Canais adicionais

- [ ] 🟡 **E-mail como canal** — inbox unificada com suporte a e-mails recebidos e enviados. Requer integração com **Resend** (já suportado nas integrações Enterprise) para envio e um endereço de e-mail de entrada (Resend Inbound ou similar) para recebimento. Complexidade: alta.

- [ ] 🔴 **SMS como canal** — enviar e receber SMS. Requer integração com **Twilio** ou **Zenvia**. Sem aprovação da Meta, mas requer conta no provedor e conformidade com regulamentação de SMS (ANATEL no Brasil).

- [ ] 🔴 **WhatsApp Business Initiated Conversations (BIC)** — iniciar conversas com contatos que nunca interagiram. Requer:
  - Template aprovado pela Meta.
  - WABA em boa reputação (rating "High" ou "Medium").
  - O contato deve ter opt-in documentado (LGPD + Meta policy).
  - Taxa por mensagem cobrada pela Meta (varia por país).

- [ ] 🟢 **Telegram como canal** — via Telegram Bot API (sem aprovação, só criar um bot). Menor base de usuários no Brasil, mas zero burocracia.

---

### Relatórios de conversas

- [ ] 🟢 **Dashboard de métricas de atendimento:**
  - Volume de conversas por dia/semana/mês
  - Tempo médio de primeira resposta (TFPR)
  - Tempo médio de resolução (TMR)
  - Taxa de resolução no primeiro contato (FCR)
  - Conversas por agente (ranking)
  - Conversas por canal
  - Conversas abertas vs resolvidas por setor
  > Todos os dados já existem no Firestore. É só agregar e exibir.

---

## Notas sobre aprovações Meta

> Consultar sempre: [developers.facebook.com/docs/whatsapp/message-templates](https://developers.facebook.com/docs/whatsapp/message-templates)

| Feature | O que precisa de aprovação | Prazo estimado de aprovação |
|---|---|---|
| CSAT automático (WhatsApp oficial) | Template com botões de resposta rápida | 1–3 dias úteis |
| Mensagens template outbound | Cada template individual | 1–3 dias úteis |
| Mensagens interativas (botões/listas) | Dentro de janela 24h: sem aprovação. Fora da janela: template necessário | — |
| WhatsApp BIC (Business Initiated) | Template + opt-in comprovado do usuário | 1–3 dias úteis por template |
| Horário de ausência (fora janela 24h) | Template de mensagem automática | 1–3 dias úteis |

> **Regra geral Meta:** Qualquer mensagem enviada **pelo negócio** para **iniciar** ou **reabrir** uma conversa após 24h de inatividade **requer template aprovado**. Dentro da janela de 24h, texto livre é permitido.
