# Roadmap — Módulo CRM
> Última atualização: 2026-04-28
> Referência de análise competitiva: HubSpot, Pipedrive, RD Station, Salesforce

---

## Legenda
- 🟢 **Só código** — implementável sem dependência externa
- 🟡 **Dependência externa** — biblioteca, API de terceiro ou infraestrutura adicional
- 🔴 **Meta / Aprovação externa** — requer aprovação da Meta, template aprovado ou mudança no app Meta

---

## PRIORIDADE ALTA — Quick Wins

### Pipeline e deals

- [ ] 🟢 **Pipeline customizável pelo usuário** — hoje os 7 status do pipeline e os 5 estágios de deal são fixos em código. Permitir que admin/founder crie pipelines nomeados (ex: "Vendas", "Pós-venda", "Onboarding") com seus próprios estágios, ordem e probabilidade configurados pela UI. Salvar em `crmPipelines/{id}` com `stages[]`. Complexidade: média-alta (requer refatorar o KanbanView do CRM para ser data-driven).

- [ ] 🟢 **Rotting deals — alerta de deal parado** — se um deal não tiver atividade registrada há mais de X dias (configurável por pipeline), exibir um badge de aviso no card do deal (ex: ícone de relógio laranja "5 dias sem atividade"). Basta calcular `Date.now() - lastActivityAt` no render.

- [ ] 🟢 **Forecast de receita** — tela/card mostrando a receita projetada para o mês atual e próximo, calculada como `SUM(deal.value × deal.probability / 100)` por mês de fechamento esperado. Adicionar como nova tab ou card no topo do CRM.

- [ ] 🟢 **Múltiplas atribuições em um deal** — além do `assignedTo` primário, campo `collaboratorIds[]` para outros membros que participam do deal. Todos recebem notificações de mudança de estágio.

- [ ] 🟢 **Motivo de perda obrigatório** — ao mover deal para "Perdido", abrir modal obrigando preenchimento de `lostReason` com opções predefinidas + campo livre. Gerar relatório de "principais motivos de perda".

---

### Dados e segmentação

- [ ] 🟢 **OR logic na segmentação** — hoje os filtros de segmento são todos AND. Adicionar suporte a grupos de condições com OR entre grupos (ex: `(status=qualificado AND score>70) OR (tag=quente)`). Requer refatorar o tipo `SegmentFilter` para suportar grupos aninhados e a lógica de avaliação no backend.

- [ ] 🟢 **Campos customizáveis na UI** — o tipo `Client` já tem `customFields: Record<string, string|number|boolean>` mas não há interface para gerenciá-los. Criar em Configurações → CRM uma tela de "Campos personalizados" onde admin define nome, tipo (texto, número, data, checkbox, select) e obrigatoriedade. Campos aparecem no formulário de edição do contato.

- [ ] 🟢 **Cálculo automático de scores** — os campos `scores.loyalty`, `scores.value`, `scores.churnRisk`, `scores.engagement` existem mas não são calculados pela aplicação (dependem de sistema externo). Criar em Configurações → CRM uma tela de "Regras de Score" onde admin define: "se `visitCount > 5` then `loyalty += 20`". Calcular via Cloud Function ou via job periódico no cliente ao abrir o módulo.
  > 🟡 Para cálculo em tempo real server-side: usar **Firebase Cloud Functions** (requer plano Blaze no Firebase).

- [ ] 🟢 **Merge de duplicatas** — detectar contatos com mesmo telefone, email ou CPF/CNPJ. Mostrar painel "Possíveis duplicatas" onde o usuário escolhe qual registro manter e quais dados de cada um preservar. Mesclar histórico de conversas, deals e atividades no registro final.

- [ ] 🟢 **Import CSV com mapeamento visual** — tela de importação: (1) upload do CSV, (2) mapeamento visual de colunas "qual coluna do arquivo = qual campo do sistema", (3) preview das primeiras linhas, (4) importar. Usar `papaparse` para leitura client-side.
  > 🟡 Dependência: **papaparse** (npm `papaparse`) — biblioteca leve para parsing de CSV no browser, sem backend.

- [ ] 🟢 **Exportação seletiva** — botão "Exportar" na lista de contatos com opções: (1) quais campos incluir (checkboxes), (2) aplicar filtros atuais ou exportar tudo, (3) formato CSV ou Excel. Usar `xlsx` para Excel.
  > 🟡 Dependência: **xlsx** (npm `xlsx` / SheetJS) para geração de arquivos Excel no browser.

- [ ] 🟢 **Audit trail — histórico de mudanças** — toda alteração em um contato ou deal (mudança de status, score, responsável, campos) fica registrada em subcoleção `history` com `{field, oldValue, newValue, changedBy, changedAt}`. Exibir na timeline do contato como "Gustavo mudou status de Novo → Qualificado".

---

### Automações

- [ ] 🟢 **Sequências automáticas multi-step temporais** — hoje as automações são de disparo único (trigger → ação). Criar "Sequências" onde cada passo tem um delay configurável:
  ```
  Passo 1: Enviar WhatsApp → aguardar 2 dias →
  Passo 2: SE não respondeu → enviar follow-up → aguardar 3 dias →
  Passo 3: Criar tarefa "ligar para contato"
  ```
  Requer salvar o estado da execução por contato em `crmSequenceEnrollments/{id}`.
  > 🟡 Para execução server-side com delays reais: **Firebase Cloud Functions** + **Cloud Tasks** (para agendar execuções futuras) ou **Firestore TTL + trigger**.
  > Para execução simples sem servidor: agendar próximo passo como campo `nextStepAt` e verificar periodicamente.

- [ ] 🔴 **Trigger: formulário respondido** — disparar automação quando um `FormResponse` é criado. Ex: "ao preencher formulário de interesse, enviar WhatsApp de boas-vindas". Só código, mas a mensagem de boas-vindas via WhatsApp oficial exige template aprovado se fora da janela de 24h.

- [ ] 🟢 **Trigger: deal criado / deal ganho / deal perdido** — triggers adicionais nas automações vinculados ao ciclo de vida dos deals.

- [ ] 🟢 **Histórico de execuções de automação** — para cada regra, mostrar log das últimas 50 execuções com contato, data e resultado (success/fail + motivo). Salvar em subcoleção `automationLogs/{ruleId}/logs/{id}`.

---

## PRIORIDADE MÉDIA

### Campanhas e broadcasts

- [ ] 🔴 **A/B Testing em campanhas** — criar campanha com variante A e variante B de mensagem, dividir audiência 50/50 e comparar métricas (entregues, lidas, respondidas). Requer:
  - UI para definir as duas variantes.
  - Lógica de split no processador `/api/broadcasts/send`.
  - **WhatsApp oficial**: ambas as variantes precisam ser templates aprovados individualmente pela Meta se forem mensagens template.
  - **WhatsApp Baileys / Facebook / Instagram**: sem aprovação, texto livre.

- [ ] 🔴 **Envio de campanha via WhatsApp com template interativo** — templates com botões de call-to-action (ex: "Ver proposta" com link URL) ou botões de resposta rápida. Requer:
  - Template cadastrado e aprovado no Meta Business Manager.
  - Extensão do payload de envio em `/api/broadcasts/send` para suportar `interactive` message type.
  - Aprovação da Meta por template (1–3 dias úteis).

- [ ] 🟢 **Agendamento de campanhas com fuso horário** — hoje o campo `scheduledAt` existe mas o envio deve ser processado. Implementar job periódico (cron/Cloud Function a cada 5 min) que verifica campanhas com `status=scheduled` e `scheduledAt <= now()` e inicia o envio.
  > 🟡 Para cron server-side: **Firebase Cloud Functions** (plano Blaze) ou **Vercel Cron** (se hospedado na Vercel).

- [ ] 🟢 **Pausa e retomada de campanha em andamento** — botão para pausar campanha que está enviando, salvando o índice do último contato enviado para retomar de onde parou.

- [ ] 🟢 **Preview de mensagem antes de enviar** — mostrar exatamente como a mensagem ficará para o destinatário (com variáveis substituídas por dados de exemplo) antes de confirmar o envio.

- [ ] 🔴 **Opt-out automático (LGPD)** — quando o contato responder "SAIR", "STOP", "Cancelar inscrição" a uma campanha, marcar `optInMarketing: false` automaticamente e nunca mais enviar campanhas para ele. Requer:
  - Processamento do webhook de resposta de broadcast.
  - **WhatsApp oficial**: o opt-out via STOP é tratado pela própria Meta e bloqueia o número na WABA automaticamente.

---

### Relatórios CRM

- [ ] 🟢 **Relatório de pipeline** — por período: quantos deals entraram, quantos avançaram de estágio, quantos foram ganhos/perdidos, valor total ganho, ticket médio, taxa de conversão por estágio (funil visual).

- [ ] 🟢 **Relatório de atividades** — por agente: quantas ligações, e-mails, reuniões, WhatsApps registrados. Identificar agentes mais e menos ativos.

- [ ] 🟢 **Relatório de automações** — para cada regra: total de execuções, taxa de sucesso, contatos impactados, conversões geradas (se o contato mudou de estágio após a automação).

- [ ] 🟢 **Relatório de campanhas** — comparativo entre campanhas: taxa de entrega, taxa de leitura, taxa de resposta, conversões rastreadas (contatos que mudaram de estágio após a campanha).

---

## PRIORIDADE BAIXA / FUTURO

### Integrações avançadas

- [ ] 🟡 **Email marketing integrado** — enviar campanhas por e-mail além de WhatsApp. Usar **Resend** (já suportado nas integrações Enterprise). Requer: template HTML de e-mail, campo `email` preenchido no contato, controle de opt-in específico para e-mail.

- [ ] 🟡 **Web tracking (pixel)** — snippet JavaScript embeddable no site do cliente que registra visitas de páginas e as associa ao contato quando o e-mail é conhecido (ex: via form submit). Salvar eventos em `webTrackingEvents`. Requer: (1) script de tracking servido pelo ServicePro, (2) endpoint para receber eventos, (3) exibição na timeline do contato.

- [ ] 🟢 **Link de agendamento integrado** — gerar um link público `servicepro.app/agendar/{businessId}/{memberId}` onde o contato escolhe o horário disponível. Integrado com o módulo de Agenda existente. Ao agendar, criar o `Appointment` e o `CRMContact` se não existir.

- [ ] 🟡 **Integração com LinkedIn Sales Navigator** — buscar informações de perfil de contatos B2B via LinkedIn API. Requer conta LinkedIn premium + aprovação de acesso à API de Sales Navigator (processo demorado, aprovação restrita).

- [ ] 🟢 **Approval process em deals** — deals acima de valor configurável (ex: R$ 10.000) exigem aprovação de um gerente antes de avançar para "Proposta". Notificação gerada, gerente aprova/rejeita com comentário.

- [ ] 🟢 **Múltiplos produtos em um deal** — cada deal pode ter N itens com nome, quantidade, preço unitário e desconto. Valor total calculado automaticamente. Gerar uma proposta PDF básica a partir dos itens.
  > 🟡 Para geração de PDF: **jsPDF** ou **@react-pdf/renderer**.

---

## Notas sobre aprovações Meta para CRM

| Feature | O que precisa de aprovação | Prazo estimado |
|---|---|---|
| Campanha WhatsApp com template | Cada template de mensagem de campanha | 1–3 dias úteis |
| Botões interativos em campanha | Template com componente `buttons` | 1–3 dias úteis |
| A/B test com template | Cada variante como template separado | 1–3 dias úteis cada |
| Sequência automática com WhatsApp fora de 24h | Template para cada mensagem da sequência | 1–3 dias úteis cada |
| Opt-out STOP (WhatsApp oficial) | Gerenciado automaticamente pela Meta | Sem aprovação necessária |

> **Atenção LGPD:** Para envio de campanhas, é obrigatório ter opt-in documentado do contato (`optInMarketing: true` + `optInAt`). A Meta também exige opt-in para campanhas via WhatsApp Business API.
