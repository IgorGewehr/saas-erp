# Production Checkup — ServicePro — 2026-05-29

> Auditoria READ-ONLY consolidada de 5 frentes. Síntese executiva priorizada.
> Nenhum código foi alterado. Os itens marcados como auto-aplicáveis estão isolados na seção "Trash removível com segurança".

---

## 1. Sumário executivo

### Scores por área

| Área | Score | Tendência |
|---|---|---|
| **Custo Firebase** | **3.5 / 10** | Prioridade do dono — maior dívida ativa |
| Indexes / Rules | 7.0 / 10 | Sólido; 3 índices ausentes quebram em runtime |
| Settings | 7.5 / 10 | Funcional; trash pequeno e mecânico |
| Saúde geral | 7.5 / 10 | Pronto p/ produção; 3 vazamentos de log/PII |
| **/agent (qualidade)** | **8.0 / 10** | **pós-fix; baseline era 7.1 (+0.9)** |

**Nota pós-fix do /agent vs baseline 7.1:** os fixes da rodada surtiram efeito e são verificáveis. Deltas por eixo: humanização 7.5→8.0, constituição-honestidade 7.0→8.0, fit-vertical 7.5→8.5, fluxo-agendamento/turma 7.5→8.0, eficiência-tokens/latência 6.0→7.5. Média sobe de **7.1 para 8.0**.

### Os 5 itens de maior impacto

1. **[P0 — Custo] ReportsModule baixa 6 coleções inteiras sem `limit` nem janela de data** (`ReportsModule.tsx:895-953`). Maior gerador de custo evitável: ~75k reads em UM open num tenant médio; 500k–1M reads/dia/tenant ativo. Fix: filtro `createdAt` server-side.
2. **[P0 — Custo] Três listeners `onSnapshot` full-collection simultâneos sobre `conversations`** (TopBar + Sidebar + ConversasModule). `lastMessageAt` muda a cada mensagem → re-entrega 3x em toda sessão, em toda página do app. Fix: contador denormalizado para badges + `limit(50)` na lista.
3. **[P1 — Custo] `staleTime` global caiu para 30s + `refetchOnWindowFocus:true`** (`QueryProvider.tsx:43-44`) amplifica refetch 2–5x a cada troca de aba. Fix: voltar para 2–5min.
4. **[P1 — Runtime] 3 queries sem índice composto quebram em produção** (`loyaltyTransactions`, `projects`, `reconciliationRules`) com `FAILED_PRECONDITION`; algumas com `.catch` silencioso. Fix: 3 entradas no `firestore.indexes.json`.
5. **[P1 — Saúde] Side-effects de comissão/loyalty na conclusão de agendamento são engolidos sem surfacing nem retry** (`AgendaModule.tsx:2732`). Inconsistência financeira silenciosa; diverge da regra R5. + **[P1 — LGPD] `console.log [AUDITORIA]` vaza PII de contato no browser** (`OmnichannelInbox.tsx:384`).

---

## 2. CUSTO FIREBASE (destaque — prioridade do dono)

Score **3.5**. A higiene de cleanup é boa (todos os `onSnapshot` inspecionados retornam unsubscribe; nenhum vazamento). O problema são **3 padrões de sangramento de leitura que escalam linearmente com o tamanho/idade do tenant e independem de paginação**, mais um default global agressivo.

> Nota de correção do recon: os polls de 3s/15s foram **superestimados**. O poll de 3s só roda com o QR modal aberto (efêmero, segundos) e bate em API route (Admin SDK), não Firestore client. **Não é P0/P1** — não gastar esforço aqui.

### Top geradores de custo

| # | Gerador | File:line | Impacto estimado | Fix |
|---|---|---|---|---|
| 1 | **Reports baixa 6 coleções inteiras** (transactions, appointments, clients, reviews, sales, orders) sem `limit` nem janela de data; `periodRange` só filtra client-side **depois** do download | `ReportsModule.tsx:895-953` (range em :888) | ~75k reads/open num tenant médio; **500k–1M reads/dia/tenant ativo** | `where('createdAt','>=',start)` + `where('createdAt','<=',end)` por query (índices `businessId+createdAt` baratos). Para agregados anuais, contadores denormalizados. O(histórico) → O(período) |
| 2 | **3 listeners full-collection sobre `conversations`**: TopBar (badge, sempre montado), Sidebar (badge, sempre montado), ConversasModule (lista, sem `limit`) | `TopBar.tsx:157-192`; `Sidebar.tsx:385-388`; `ConversasModule.tsx:7219-7245` | 3 listeners full-collection/sessão; re-entrega a cada mensagem (`lastMessageAt`); dezenas de milhares reads/h/sessão só de badges. TopBar+Sidebar rodam em **toda** página | Badges: contador denormalizado `unreadCounters/{businessId}` (assinar 1 doc) **ou** `where('unreadCount','>',0)`. Lista: `limit(50)` + paginação |
| 3 | **Sidebar listener full-collection em `transactions`** só p/ contar recorrências vencendo (filtro client-side) | `Sidebar.tsx:343-365` | Toda sessão, qualquer página, baixa todas as transactions + re-entrega a cada escrita (PDV/financeiro/conciliação geram muitas) | Filtrar `recurrence.isActive==true` + `nextDueDate` no range (índice composto) ou contador denormalizado. Idealmente `getDocs` com `staleTime` longo, não `onSnapshot`, para badge de baixa volatilidade |
| 4 | **`staleTime` global 30s + `refetchOnWindowFocus:true`** | `QueryProvider.tsx:43-44` | Toda troca de aba refetcha todas as queries frias montadas → 2–5x leituras numa jornada real | Voltar `staleTime` p/ 2–5min; `refetchOnWindowFocus:false` global (telas live já usam `onSnapshot`) |
| 5 | **OffersManagerModal baixa `clients` + `broadcasts` inteiros** no open | `OffersManagerModal.tsx:106-107` | 10k+ reads/open num tenant grande; modal de baixa frequência | Denormalizar `Offer.contactCount/broadcastCount`. Caminho já documentado no comentário do arquivo |
| 6 | **Heartbeat de presença**: 1 write/60s/sessão no doc `users` (6+ índices) | `AuthProvider.tsx:178` | 100 usuários = ~6k writes/h; cada write reescreve 6+ índices de `users` | Aceitável; opcional: gravar em doc dedicado `presence/{uid}` (sem índices compostos) ou intervalo 90–120s |

**Conclusão de custo:** atacar #1 e #2 sozinhos deve cortar a maior parte do custo de leitura evitável. #3 e #4 são fixes de baixo esforço com retorno alto.

---

## 3. Tabela priorizada (P0 / P1 / P2)

| Pri | Área | Título | File:line | Impacto | Recomendação | Auto-aplicável seguro |
|---|---|---|---|---|---|---|
| **P0** | Custo | Reports baixa 6 coleções inteiras sem `limit`/data | `ReportsModule.tsx:895-953` | 500k–1M reads/dia/tenant | Filtro `createdAt` server-side por query | Não |
| **P0** | Custo | 3 listeners full-collection sobre `conversations` | `TopBar.tsx:157-192`; `Sidebar.tsx:385-388`; `ConversasModule.tsx:7219-7245` | Re-entrega 3x por mensagem, em toda página | Contador denormalizado + `limit(50)` | Não |
| **P1** | Custo | Sidebar listener full-collection em `transactions` | `Sidebar.tsx:343-365` | Leitura contínua de fundo em toda sessão | Filtro server-side ou contador denormalizado | Não |
| **P1** | Custo | `staleTime` 30s + `refetchOnWindowFocus:true` | `QueryProvider.tsx:43-44` | 2–5x refetch por troca de aba | Voltar p/ 2–5min; focus false | Não |
| **P1** | Indexes | `loyaltyTransactions` sem índice composto (where+where+orderBy) | `lib/services/loyalty.ts:174-179` | `FAILED_PRECONDITION` em runtime; histórico não carrega | Índice `[businessId, clientId, createdAt desc]` | Não (config) |
| **P1** | Indexes | `projects` sem índice composto (businessId+orderBy createdAt) | `FinancialModule.tsx:531-535` | `onSnapshot` quebra; lista vazia, sem fallback | Índice `[businessId, createdAt desc]` | Não (config) |
| **P1** | Indexes | `reconciliationRules` sem índice composto | `ConciliacaoTab.tsx:92-96` | `.catch(()=>{})` engole erro; auto-conciliação para sem aviso | Índice `[businessId, createdAt desc]` | Não (config) |
| **P1** | Saúde | Side-effects comissão/loyalty engolidos sem surfacing/retry | `AgendaModule.tsx:2732` (e :2741, :2280, :2413) | Inconsistência financeira silenciosa; diverge de R5 | Surface via toast + pipeline-failure; migrar handler de no-op p/ real c/ idempotência | Não |
| **P1** | Saúde | `console.log [AUDITORIA]` vaza PII de contato no browser | `OmnichannelInbox.tsx:384` | Vazamento LGPD (nome/telefone) no console de cada operador | Remover (único console.log do client) ou gate NODE_ENV | **Sim** |
| **P1** | Settings | `testConnection()` é stub que sempre reporta sucesso | `SettingsModule.tsx:5532` (botão :5735) | UX enganosa: integração quebrada parece OK | Ligar a rota real OU desabilitar com "em breve" — decisão de produto | Não |
| **P1** | /agent | `conversation_send_interactive`: exemplo camelCase + omite `title`, params exigem snake_case | `agent/app/tools/registry.py:562-571,619` | LLM copia exemplo → args malformados → rejeição no executor; gasta iteração + round-trip | Reescrever exemplo p/ snake_case e incluir `title`, 1:1 com params | **Sim** |
| **P2** | Custo | OffersManagerModal baixa clients+broadcasts inteiros | `OffersManagerModal.tsx:106-107` | 10k+ reads/open | Denormalizar contagens na Offer | Não |
| **P2** | Indexes | conversationMessages paga ~2 reads extras/leitura via `get()` nas rules | `firestore.rules:725-742` (helper :685-689) | Multiplicador de custo na coleção mais quente | Denormalizar `channelOwnerType/Id` na mensagem p/ eliminar `get(conversation)` | Não |
| **P2** | Indexes | Índices órfãos `crmContacts` (status/stage+createdAt) | `firestore.indexes.json:556-562, 565-571, 599-604` | Write amplification em coleção legada migrada p/ `clients` | Confirmar 0 hits >30d no Console e remover | Não (verificar antes) |
| **P2** | Rules | LIST afrouxada (teamChats, teamChatMessages, notes) permite leitura cross-DM/cross-autor no tenant | `firestore.rules:1232, 1284, 1188` | Sem vazamento cross-tenant; DM/notas internas não confidenciais server-side | Aceitar se "team confiável" for premissa (documentado) ou mover p/ subcollection | Não |
| **P2** | Saúde | Log de prefixo de token Meta descriptografado | `app/api/webhooks/meta/route.ts:1384` (e :1309) | Secret material parcial em logs persistentes | Reduzir p/ `hasToken: !!token` | **Sim** |
| **P2** | Saúde | Logs verbosos em webhooks/baileys (PII parcial) | `webhooks/meta/route.ts:22`; `whatsapp/baileys-manager.ts` | Custo de logging + telefone/payloads em log | Logger com nível + gate NODE_ENV | Não |
| **P2** | Settings | 5 ícones lucide importados e nunca usados | `SettingsModule.tsx:54-85` | Trash de imports | Remover ToggleLeft, ToggleRight, XCircle, Package, Search | **Sim** |
| **P2** | Settings | `USER_STATUS_LABELS` importado e nunca usado | `SettingsModule.tsx:109` | Import morto | Remover do import | **Sim** |
| **P2** | Settings | `WeeklySession` (type) importado e nunca usado | `SettingsModule.tsx:90` | Import de tipo morto | Remover do `import type` | **Sim** |
| **P2** | Settings | Estado `waStatus` write-only (setado 4x, nunca lido) | `SettingsModule.tsx:6389` (+ :7061, :7086, :7286, :7295) | Re-renders inúteis; estado morto | Remover decl + 4 setWaStatus (statements isolados, seguro) | **Sim** |
| **P2** | Settings | EnterpriseTab sem guard de escrita no componente | `SettingsModule.tsx:5396` | Proteção só de navegação; depende de rules/rotas server-side | Confirmar `/api/saas/api-key/*` + rules validam admin; opcional `canEdit` por consistência | Não |
| **P2** | /agent | Contradição limite de rows: schema "Max 10" vs prompt "2-3" | `registry.py:597` vs `prompts.py:849-850` | Sinais conflitantes; LLM pode despejar 10 rows | Alinhar schema p/ "2-3 recomendado (máx 10 técnico)" ou validação | **Sim** |
| **P2** | /agent | Pré-seleção de tools volta a 109 em consultas comuns de operador | `registry.py:1214,1228-1241` + `nodes.py:290-301` | Ganho de tokens some em CRM/agenda frequentes (~11.3k tok/iter) | Adicionar lemas plurais/variações; fallback top-1 por heurística | Não |
| **P2** | /agent | Cobertura de testes do agente quase inexistente | `agent/tests/test_auth.py` (único) | Fixes desta rodada sem rede de regressão | Testes-tabela: anti-leak por segmento, turma, select_dashboard_groups, paridade exemplo↔schema | Não |

---

## 4. TRASH removível com segurança (pronto p/ PR de limpeza)

Apenas itens com `safeToRemoveOrAutoApply = true`. Cada um é mecânico e não altera comportamento observável.

**Settings — imports/estado mortos** (`app/components/features/settings/SettingsModule.tsx`):
- [ ] L54-85: remover ícones lucide não usados — `ToggleLeft`, `ToggleRight`, `XCircle`, `Package`, `Search`.
- [ ] L109: remover import de valor `USER_STATUS_LABELS`.
- [ ] L90: remover `import type` de `WeeklySession`.
- [ ] L6389: remover declaração de estado `waStatus`; + remover as 4 chamadas `setWaStatus` (L7061, L7086, L7286, L7295) — são statements isolados, seguro.

**Saúde — logs / vazamentos** (auto-aplicáveis):
- [ ] `OmnichannelInbox.tsx:384` — **remover `console.log('%c[AUDITORIA]...')`** que vaza PII de contato (P1 LGPD). Único console.log em 119 client components — leftover de debug.
- [ ] `app/api/webhooks/meta/route.ts:1384` — substituir log de prefixo de token Meta por `hasToken: !!token`.

**/agent — paridade e heurística de prompt** (`agent/app/`):
- [ ] `tools/registry.py:562-571,619` — reescrever exemplo de `conversation_send_interactive` p/ snake_case + incluir `title` (P1; bate 1:1 com params).
- [ ] `registry.py:597` — alinhar `sections.description` ao prompt ("2-3 recomendado, máx 10 técnico").
- [ ] `graph/nodes.py:581` — restringir heurística de markdown em `_draft_is_clean` a `*` (e pares `_palavra_` via regex), não a qualquer `_` isolado (underscore solto força 2ª LLM à toa).
- [ ] `registry.py:925,1259-1270` + `_is_read_only_tool` — adicionar `_segment_query`/`_query` aos `_READ_ONLY_PREFIXES` para que `crm_segment_query` (leitura) volte ao modo analyst.

> Itens NÃO auto-aplicáveis (decisão/verificação antes): índices órfãos `crmContacts`/`conversationViews` (verificar Index Stats), `testConnection()` (decisão de produto), guard EnterpriseTab (endurecimento server-side).

---

## 5. Quick wins vs trabalho maior

### Quick wins (baixo esforço, alto impacto)
- **`staleTime` global 30s → 2–5min + `refetchOnWindowFocus:false`** (`QueryProvider.tsx:43-44`). Uma linha, corta 2–5x refetch em toda a app. **Maior ROI/esforço do checkup.**
- **3 índices ausentes** (`loyaltyTransactions`, `projects`, `reconciliationRules`) — 3 blocos no `firestore.indexes.json` + deploy. Evita quebra em runtime/produção.
- **Remover `console.log [AUDITORIA]`** (`OmnichannelInbox.tsx:384`) — fecha vazamento de PII (LGPD) imediatamente.
- **Token Meta log → booleano** (`webhooks/meta/route.ts:1384`).
- **Trash de imports/estado em Settings** — limpeza mecânica, typecheck continua passando.
- **Fixes de prompt do /agent** (exemplo interactive snake_case, contradição rows, heurística `_`, `crm_segment_query` read-only) — pequenos, melhoram custo de tokens e correção do agente.

### Trabalho maior (planejar)
- **Reports com janela de data server-side + contadores denormalizados p/ agregados longos** (`ReportsModule.tsx`) — o maior gerador de custo; exige reescrever as 6 queries e possivelmente camada de agregação.
- **Badges de conversas via contador denormalizado** (`unreadCounters/{businessId}`) + `limit(50)` na lista — mexe em TopBar, Sidebar, ConversasModule e nas escritas de mensagem.
- **Sidebar transactions → contador de recorrências** (`Sidebar.tsx:343-365`).
- **Migração R5: side-effects de `appointment.completed` (commission/loyalty/gcal) inline → handlers server-side via `dispatchDomainEvent` com idempotência** (`AgendaModule.tsx` + `lib/contracts/_runtime/handlers/appointmentCompleted.ts:37` que é no-op). Resolve o P1 de inconsistência financeira na raiz; já no roadmap SDD.
- **Suite de testes do /agent** (anti-leak por segmento, select_dashboard_groups, paridade exemplo↔schema).
- **Denormalizar `channelOwnerType/Id` em `conversationMessages`** p/ remover `get(conversation)` da rule de read (coleção mais quente).
- **Quebrar o monolito `SettingsModule.tsx` (7771 linhas)** — extrair UsersTab, FiscalTab, EnterpriseTab, CanaisTab. Débito de manutenção, não bug.

---

## Apêndice — itens descartados/corrigidos pelos auditores
- Polls 3s/15s de canais: **superestimados** no recon; efêmeros e via API route. Sem ação urgente (`BusinessChannelsSection.tsx:81-93`).
- Seção RAG do Settings: **não está vazia**, renderiza `<KnowledgeReindexPanel />`. `advancedOpen` **é** usado.
- Stubs financeiros (PIX/boleto/OCR/open-banking): retornam 501 estruturado, **não fingem sucesso** — comportamento correto, manter.
- Índices `channelConnections` sem `businessId`: **legítimos** (lookup de webhook pré-resolução de tenant). Documentar para não confundir com violação de R1.
