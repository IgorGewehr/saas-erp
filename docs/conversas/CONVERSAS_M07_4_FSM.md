# Conversas — FSM de status aplicada nos write-paths (M07.4)

> Concluído em: 05/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: achado da investigação de abertura do M07 — `assertTransitionConversation`/
> `canTransitionConversation` (`lib/contracts/fsm/conversation.ts`) existiam desde antes, mas
> nenhum write-path os chamava (mesmo padrão do FSM de `Transaction` antes do M03.2).

## 1. O gap

`CONVERSATION_TRANSITIONS` declara `open ↔ waiting`, `open|waiting → resolved`,
`resolved → open` (reabertura). Três write-paths reais mudavam `Conversation.status` sem checar
nada, permitindo pular estado (ex.: `resolved → waiting` direto, que a FSM não permite):

1. `ConversasModule.tsx:updateConversationStatus` — troca manual de status na UI (dropdown).
2. `ConversasModule.tsx:handleBatchStatus` — troca em lote (multi-seleção).
3. `app/api/agent/tools/conversations/route.ts:setStatus` — tool do agente de IA.
4. `app/api/v1/conversations/route.ts` PUT — API pública externa.

## 2. Correção

Todos os 4 passaram a chamar `canTransitionConversation(from, to)` antes de escrever:

- **`updateConversationStatus`**: busca o status **fresco** via `getDoc` (não confia no estado
  local, que pode estar obsoleto) antes de validar — ação manual, pouco frequente, o custo de 1
  read extra é aceitável pela correção ganha. Transição inválida → `toast.error`, não escreve.
- **`handleBatchStatus`**: usa o estado local (`conversations`, já mantido fresco por
  `onSnapshot`) — buscar fresco por item numa ação em lote seria N reads síncronos. Conversas com
  transição inválida são **puladas** (não abortam o lote inteiro) e contabilizadas num toast de
  aviso separado.
- **`setStatus`** (agente): lança `Error` descritiva — mesmo padrão de erro já usado pelos outros
  guards deste arquivo (`Cross-tenant access denied`, etc.), capturado pelo try/catch genérico do
  handler (500).
- **API v1 PUT**: retorna `409` (mesma convenção de `TransactionInvalidTransitionError` no M03.3
  — conflito de estado, não erro de validação de campo).

**`firestore.rules`**: nova `isValidConversationTransition(from, to)` (espelha
`CONVERSATION_TRANSITIONS` manualmente, rules não importa TS — mesmo padrão de
`isValidTransactionTransition` do M03.4), encadeada em `allow update` de `/conversations/{id}`.
Última linha de defesa pra qualquer write-path client SDK que não passe pela validação de
`ConversasModule.tsx` (hoje não existe nenhum, mas fecha o mesmo tipo de bypass que M03.4 fechou
pra `transactions`). `from == to` sempre válido (não-mudança não é uma transição) — confirmado
que nenhum dos write-paths de M07.3 (sectorIds/isPrivate/assignedTo/visibleToUserIds) toca
`status`, então esta regra nova é transparente pra eles.

## 3. Deliberadamente NÃO feito nesta fatia

O item do plano "aplicar `ConversationSchema.parse()` numa fronteira real de write-path" foi
analisado e adiado — risco real, não hipotético: `ConversationSchema` tem campos com constraint
mais estrito que o dado de produção pode ter (ex.: `contactAvatarUrl: z.string().url().optional()`
— uma URL de avatar vinda do Meta que não passe na validação de URL do Zod faria `.parse()`
lançar e derrubar a ingestão de mensagem no webhook). Sem acesso a dado real de produção pra
confirmar que TODO valor histórico realmente conforma ao schema, aplicar `.parse()` numa
fronteira como `meta/route.ts` é um risco desproporcional ao ganho desta fatia — mesma categoria
de deferimento já usada pra itens maiores/arriscados nesta sessão (DRE/Orçamento em M03,
Sequências em M07). Revisitar quando houver ambiente de homologação com dado real pra validar
contra o schema antes de aplicar `.parse()` de verdade.

## 4. Verificação

`tsc --noEmit` limpo, suíte completa sem regressão. Sem teste novo — a lógica adicionada é uma
chamada direta a uma função já testável (`canTransitionConversation`, que o FSM em si não ganhou
teste dedicado nesta fatia por já ser lógica trivial de tabela, mesma categoria de "correção
mecânica de baixo risco" já usada nesta sessão). **Não testado manualmente em navegador** —
recomendado: tentar uma transição inválida (ex.: `resolved` → `waiting` direto, se a UI permitir
selecionar) e confirmar que a UI mostra o erro e não escreve.
