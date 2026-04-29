# Roadmap — Módulo de Conversas
**Atualizado:** 2026-04-28 | Comparativo: Zendesk · Intercom · Chatwoot

## Legenda
- `code-only` — implementável 100% no frontend/backend sem dep externa
- `external-dep` — precisa de API/serviço externo já configurado
- `meta-approval` — precisa de aprovação da Meta

---

## O que já existe

- Inbox em tempo real (onSnapshot) — WhatsApp, Facebook, Instagram
- Envio: texto, mídia (imagem/áudio/vídeo/documento), templates WhatsApp
- Read receipts + typing indicator
- Status de conversa: open / waiting / resolved
- Atribuição por usuário e por setor
- Tags / Labels + filtro
- Notas internas (`isInternal: true`) com toggle no composer
- Snippets (quick replies) com autocomplete por `/`
- Prioridade: low / medium / high / urgent
- Paginação de mensagens (load more)
- Exportar histórico em TXT
- Toggle de IA por conversa (`aiEnabled`)
- Mark as unread / soft delete

---

## Checklist de features a implementar

### 🟥 Alta prioridade (maior gap vs. mercado)

- [ ] **SLA tracking & alertas** `code-only`
  Calcular tempo de primeira resposta e resolução. Badge visual quando SLA prestes a vencer/vencido. Configurável por nível de prioridade em Settings.

- [ ] **Filtros avançados + filtros salvos** `code-only`
  Filtrar por assignedTo, data, label, prioridade, canal e SLA. Salvar filtros como views nomeadas por usuário.

- [ ] **Batch actions (ações em massa)** `code-only`
  Selecionar N conversas → atribuir em lote, mudar status em lote, adicionar tag em lote. Checkbox na lista + action bar flutuante.

- [ ] **CSAT / Satisfação** `code-only`
  Ao resolver conversa, envia mensagem automática de avaliação (1-5 estrelas). Dashboard de satisfação com NPS por período/setor/agente.

- [ ] **Analytics de Conversas** `code-only`
  Dashboard com: avg first response time, avg resolution time, volume por canal/dia, top agentes por resoluções, CSAT médio.

---

### 🟧 Média prioridade

- [ ] **Routing rules (distribuição automática)** `code-only`
  Regras configuráveis: "se canal = WhatsApp E horário comercial → atribuir ao setor Comercial". Round-robin entre membros do setor.

- [ ] **Conversa: campos customizados** `code-only`
  Custom fields por conversa (ex: "Tipo de atendimento", "Produto"). Configurável em Settings, visível no painel lateral da conversa.

- [ ] **Merge de conversas** `code-only`
  Unificar duas conversas do mesmo contato em uma só. Mantém histórico de ambas.

- [ ] **Busca full-text no histórico** `code-only`
  Pesquisar por conteúdo de mensagens dentro de uma conversa ou globalmente. Firestore full-text via índice composto ou algolia-like.

- [ ] **Histórico de reatribuições (audit)** `code-only`
  Registrar cada mudança de assignedTo/setor com timestamp e usuário. Visível no painel lateral da conversa.

- [ ] **PDF export de conversa** `code-only`
  Exportar transcrição formatada em PDF (logo da empresa, data, participantes). Substitui/complementa o TXT atual.

- [ ] **Emoji picker + reactions** `code-only`
  Picker de emojis no composer. Reactions (👍❤️😂) em mensagens individuais (onde a API suportar).

---

### 🟨 Baixa prioridade / Long-term

- [ ] **Macros (ações condicionais)** `code-only`
  Como snippets, mas podem incluir ações: atribuir, adicionar tag, mudar status — além de inserir texto.

- [ ] **Chatbot handoff com SLA** `external-dep`
  Quando IA transfere para humano, iniciar timer de SLA automaticamente. Integra com agente IA existente.

- [ ] **Rich messages (botões, carrossel)** `meta-approval`
  Botões interativos e carrossel de produtos no WhatsApp. Requer templates aprovados pela Meta.

- [ ] **WhatsApp templates novos** `meta-approval`
  Criar e submeter templates para aprovação da Meta diretamente pelo painel.

- [ ] **Facebook/Instagram 24h window UI** `external-dep`
  Indicar visualmente quando a janela de 24h está prestes a expirar. Alertar agente para usar template antes do fechamento.

---

## Ordem sugerida de implementação

1. SLA tracking & alertas
2. Filtros avançados + filtros salvos
3. Batch actions
4. CSAT / Satisfação
5. Analytics de Conversas
6. Routing rules
7. Histórico de reatribuições (audit)
8. PDF export
9. Emoji picker + reactions
10. Merge de conversas
