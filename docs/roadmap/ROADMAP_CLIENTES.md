# Roadmap — Módulo de Clientes
> Última atualização: 2026-04-28
> Referência de análise competitiva: Zendesk, Intercom, HubSpot, Salesforce

---

## Legenda
- 🟢 **Só código** — implementável sem dependência externa
- 🟡 **Dependência externa** — biblioteca, API de terceiro ou infraestrutura adicional
- 🔴 **Meta / Aprovação externa** — requer aprovação da Meta, template aprovado ou mudança no app Meta

---

## PRIORIDADE ALTA — Quick Wins

### Visão 360° do cliente

- [ ] 🟢 **Timeline unificada do cliente** — a feature mais impactante do módulo. Uma linha do tempo vertical no perfil do cliente mostrando TODOS os eventos em ordem cronológica:
  - Conversa recebida / iniciada (por canal)
  - Compra realizada (Sale)
  - Transação financeira (Transaction)
  - Broadcast recebido e lido/respondido
  - Formulário respondido (FormResponse)
  - Agendamento criado / concluído / cancelado
  - Mudança de status no CRM
  - Nota interna criada
  - Pontos de fidelidade acumulados/resgatados

  Requer: queries paralelas em múltiplas coleções filtrando por `crmContactId` / `clientId` e unificando resultados em ordem de `createdAt`. Nenhuma dependência externa.

- [ ] 🟢 **Histórico de conversas no perfil** — seção lateral no detalhe do cliente mostrando todas as conversas anteriores em qualquer canal (WhatsApp, Facebook, Instagram), com data, canal, status e última mensagem. Link para abrir a conversa diretamente. Query: `conversations` where `crmContactId == clientId`.

- [ ] 🟢 **Histórico de compras no perfil** — seção listando todas as `Sales` e `Transactions` associadas ao cliente, com data, valor, canal e status. Hoje `totalSpent` e `visitCount` são campos agregados; o histórico detalhado precisa de query em `sales` e `transactions` filtrando por `contactId`.

- [ ] 🟢 **Score de saúde visual (Customer Health)** — indicador visual no card e no detalhe do cliente. Verde (saudável) / Amarelo (atenção) / Vermelho (risco). Baseado nos campos `scores.churnRisk`, `scores.engagement` e `lastVisit` que já existem. Só lógica de renderização.

- [ ] 🟢 **Filtros por score e churn risk na lista** — hoje a lista de clientes filtra por tipo, status e tags. Adicionar filtros por:
  - Score geral (slider range 0–100)
  - Churn risk (baixo / moderado / alto / crítico)
  - Lifecycle stage
  - Sem atividade há X dias

---

### Importação e exportação

- [ ] 🟢 **Exportação seletiva (CSV / Excel)** — botão "Exportar" na lista de clientes. Usuário seleciona:
  - Quais campos incluir (checkboxes)
  - Se aplica os filtros ativos ou exporta tudo
  - Formato: CSV ou Excel
  > 🟡 Dependência: **xlsx** (npm `xlsx` / SheetJS) para geração de Excel no browser. CSV pode ser gerado sem dependência.

- [ ] 🟢 **Import CSV com mapeamento visual** — tela de importação de clientes em massa:
  1. Upload do arquivo CSV
  2. Mapeamento visual: "Coluna A do arquivo = campo Nome", "Coluna B = Telefone", etc.
  3. Preview das primeiras 5 linhas com dados mapeados
  4. Validação de duplicatas antes de importar (mostra quantas serão ignoradas/mescladas)
  5. Importação em batch com progress bar
  > 🟡 Dependência: **papaparse** (npm) para parsing de CSV no browser sem backend.

- [ ] 🟢 **Template CSV de importação** — botão "Baixar template" que gera um CSV com as colunas corretas já nomeadas, para o usuário preencher e importar.

---

### Gestão de clientes

- [ ] 🟢 **Merge de duplicatas com UI** — painel "Possíveis duplicatas" acessível em Clientes → ⋮ → Verificar duplicatas. Lista pares de clientes com alto grau de similaridade (mesmo CPF/CNPJ, email ou telefone). Para cada par:
  - Mostrar os dois registros lado a lado
  - Usuário escolhe qual manter como principal
  - Escolhe quais campos de cada um preservar
  - Merge: o registro secundário tem `mergedInto: primaryId` e `isActive: false`; conversas, deals, transações e agendamentos são reassociados ao primário.

- [ ] 🟢 **Desativação vs exclusão de clientes** — hoje `isActive` existe mas sem fluxo claro. Implementar:
  - Arquivar cliente (isActive: false) — continua visível com filtro "Arquivados", histórico preservado
  - Exclusão permanente (LGPD) — modal de confirmação, soft-delete com `deletedAt`, dados anonimizados após 30 dias

- [ ] 🟢 **Contato de emergência / contatos adicionais** — campo para telefone secundário já existe (`phone2`). Expandir para múltiplos contatos nomeados: `additionalContacts: [{name, phone, role, relationship}]`. Ex: "Maria - esposa - (11) 9xxxx" para clínicas, ou "João - comprador" + "Ana - financeiro" para empresas.

---

## PRIORIDADE MÉDIA

### Estrutura de dados

- [ ] 🟢 **Separação Empresa / Contatos (Account-based)** — feature mais complexa, mas essencial para atender clientes B2B. Criar coleção `companies/{id}` separada de `clients/{id}`. Um contato (pessoa física) pode estar vinculado a uma empresa. O perfil da empresa agrega:
  - Todos os contatos vinculados
  - Total gasto consolidado
  - Deals da empresa (não do contato individual)
  - Conversas de qualquer contato da empresa

  Requer migração dos registros PJ existentes e novo modelo de dados. Manter compatibilidade retroativa para negócios que não usam B2B.

- [ ] 🟢 **Múltiplos endereços por cliente** — hoje `endereco` é um objeto único. Expandir para `addresses: Address[]` com tipo (residencial, comercial, entrega, cobrança) e `isPrimary` flag. Relevante para e-commerce e entregas.

- [ ] 🟢 **Hierarquia de empresas** — empresa matriz → filiais. Ex: "Grupo Acme (CNPJ matriz)" contém "Acme SP (filial)" e "Acme RJ (filial)". Relatórios consolidados por grupo. Adicionar `parentCompanyId` no futuro tipo `Company`.

---

### Programa de fidelidade

- [ ] 🟢 **Programa de fidelidade configurável** — o campo `loyaltyPoints` existe mas sem lógica de programa. Criar em Configurações → Clientes uma tela de "Programa de Fidelidade":
  - Regras de acúmulo: "a cada R$ 1 gasto = X pontos", "aniversário = Y pontos", "indicação = Z pontos"
  - Tiers: Bronze (0–499 pts), Prata (500–1999 pts), Ouro (2000+ pts) com nomes e limites configuráveis
  - Validade dos pontos: expiram após X meses se não houver movimento
  - Resgates: "500 pontos = R$ 10 de desconto"
  - Extrato: histórico de acúmulo e resgate por cliente

  Ao fechar uma venda (Sale), calcular automaticamente os pontos ganhos e atualizar `loyaltyPoints` + registrar em subcoleção `loyaltyHistory`.

- [ ] 🟢 **Notificação de pontos** — ao acumular pontos, enviar mensagem automática ao cliente informando o saldo e benefícios. Integra com automações do CRM.
  > 🔴 Via WhatsApp oficial fora da janela 24h: requer template aprovado pela Meta ("Você ganhou X pontos! Seu saldo é Y.").

- [ ] 🟢 **Tier visível no perfil e na lista** — exibir o tier do cliente (badge Bronze/Prata/Ouro) no card da lista e no cabeçalho do perfil.

---

### Campos e personalização

- [ ] 🟢 **Campos customizáveis visíveis na UI** — o tipo `Client` tem `customFields: Record<string, unknown>` mas sem interface de gerenciamento. Criar em Configurações → Clientes uma tela "Campos personalizados" onde admin define:
  - Nome do campo (ex: "Tamanho da roupa", "Médico responsável")
  - Tipo: texto, número, data, boolean, lista de opções
  - Obrigatório ou opcional
  - Visível na lista de clientes (como coluna extra) ou só no detalhe

- [ ] 🟢 **Tags com categorias** — hoje tags são strings livres. Adicionar suporte a categorias de tag (ex: categoria "Preferência" com tags "café", "academia"; categoria "Comportamento" com "assiduidade alta"). Útil para segmentação mais precisa.

---

## PRIORIDADE BAIXA / FUTURO

### Portal do cliente

- [ ] 🟢 **Portal self-service do cliente** — área pública (sem login de operador) onde o cliente acessa com seu telefone + código OTP e vê:
  - Suas conversas abertas e histórico
  - Seus agendamentos
  - Seu saldo de pontos de fidelidade
  - Formulários pendentes para preencher
  - Documentos/contratos

  Requer: nova rota `/portal/[businessSlug]` sem autenticação Firebase normal; OTP enviado via WhatsApp/SMS.
  > 🔴 OTP via WhatsApp oficial: requer template de verificação aprovado pela Meta.

- [ ] 🟡 **Assinatura de documentos** — enviar contratos para o cliente assinar digitalmente. Requer integração com **Docusign**, **Clicksign** (brasileiro) ou similar. Alternativa mais simples: gerar PDF e coletar aceite por WhatsApp (registrar `signedAt` e `signedVia`).

- [ ] 🟢 **Contratos e renovações** — vincular contratos com data de início, fim e valor ao cliente. Gerar alertas 30/15/7 dias antes do vencimento. Integrar com financeiro (criar transação de renovação automaticamente).

- [ ] 🟡 **Referral tracking — rede de indicações** — rastrear quem indicou quem (`referredBy: clientId`). Calcular o valor acumulado trazido pela rede de cada cliente (indicações de indicações). Visualizar como grafo (requer biblioteca de grafo como **D3.js** ou **Recharts** para versão simples de árvore).

- [ ] 🟡 **NPS automático** — enviar pesquisa NPS (Net Promoter Score, escala 0–10) ao cliente após X dias de relacionamento. Agregar resultado em dashboard. 
  > 🔴 Via WhatsApp oficial: template com botões numéricos aprovado pela Meta. Via Baileys/Facebook/Instagram: texto simples.

---

## Dependências externas — resumo

| Dependência | npm package | Features que usa | Custo |
|---|---|---|---|
| **papaparse** | `papaparse` | Import CSV | Gratuito / open source |
| **xlsx (SheetJS)** | `xlsx` | Export Excel | Gratuito (community) |
| **Firebase Cloud Functions** | SDK já instalado | Scores automáticos, cron jobs | Requer plano Blaze (~pay-as-you-go) |
| **Algolia / Typesense** | `algoliasearch` | Busca full-text em mensagens | Algolia: gratuito até 10k req/mês |
| **Clicksign / Docusign** | API REST | Assinatura digital | Pago por uso |
| **D3.js / Recharts** | `recharts` (já usado?) | Grafo de indicações | Gratuito |

---

## Notas sobre aprovações Meta para Clientes

| Feature | O que precisa de aprovação | Prazo estimado |
|---|---|---|
| Notificação de pontos de fidelidade (WhatsApp oficial) | Template de notificação de saldo | 1–3 dias úteis |
| OTP de acesso ao portal (WhatsApp oficial) | Template de autenticação (categoria "Authentication") | 1–3 dias úteis |
| NPS via WhatsApp oficial | Template com botões numéricos interativos | 1–3 dias úteis |
| Lembrete de renovação de contrato (WhatsApp oficial) | Template de lembrete | 1–3 dias úteis |

> **Atenção:** Templates da categoria **"Authentication"** (OTP/verificação) têm processo de aprovação separado e mais rigoroso da Meta, podendo levar até 5 dias e exigir verificação do caso de uso do negócio.
