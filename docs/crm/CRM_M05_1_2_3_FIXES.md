# CRM/Clientes — fixes de baixo risco (M05.1/2/3)

> Concluído em: 05/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: 3 correções sem decisão de produto envolvida, identificadas na investigação de
> abertura do M05 e implementadas na sequência (mesma sessão).

## M05.1 — `PUT /api/v1/crm/contacts` não apaga mais `relationshipHistory`

`docRef.update({ relationshipHistory: {...} })` substitui o mapa inteiro no Firestore — um caller
externo que reenviasse o objeto parcialmente (ex.: só `{avgTicket: 150}`) apagava silenciosamente
`noShowCount` e qualquer outro subcampo já gravado (ex.: por `bumpClientNoShowCountAdmin`,
M06.3b). Bug já auto-documentado no próprio código (`lib/services/clientMetricsAdmin.ts`) como
"pré-existente, fora do escopo desta função corrigir" — nunca endereçado.

**Corrigido**: antes de `docRef.update(updateFields)`, mescla `updateFields.relationshipHistory`
com o valor atual do documento (`existingData.relationshipHistory`), preservando qualquer
subcampo que o caller não tenha mandado explicitamente. Comentário no `clientMetricsAdmin.ts`
atualizado pra refletir a correção.

## M05.2 — Merge de clientes reassocia tarefas Kanban corretamente

`mergeClients.ts:reassociateRelatedDocs` reassociava `kanbanCards` pelo campo `contactId` — o
campo real declarado em `KanbanCard` e gravado por `CreateKanbanTaskDialog.tsx` é
`relatedContactId`. A query sempre retornava vazio, sem erro logado (`catch` genérico por
coleção) — reassociação de tarefas Kanban durante merge de cliente era um no-op silencioso.
Mesma classe de bug de nome de campo errado já encontrada e corrigida em M06.5c
(`lastContactAt`/`lastContactDate`).

**Corrigido**: `field: 'contactId'` → `field: 'relatedContactId'` na entrada de `kanbanCards`.
Achado de passagem, não corrigido (não é bug, é escopo futuro): `relatedContactId` não é lido em
nenhum outro lugar do código hoje — é write-only, porque o painel "tarefas pendentes deste
cliente" que o consumiria nunca foi construído. O fix garante que, quando esse painel existir, o
dado já estará correto pra clientes mesclados a partir de agora.

## M05.3 — `POST /api/forms/submit` aceita idempotência (R3)

Endpoint público, sem autenticação, protegido só por rate-limit de IP — usado pela ficha de
anamnese (M06.4a) enviada por link ao paciente. Sem idempotência, um retry de rede legítimo ou o
paciente clicando "Enviar" de novo após um erro transiente criava uma SEGUNDA resposta pro mesmo
formulário.

**Corrigido**: `X-Idempotency-Key` opcional — quando presente, deriva um doc ID determinístico
(`{businessId}_{chave sanitizada}`) e usa `.create()` (Firestore rejeita atomicamente se já
existe, mesmo padrão de `markWebhookSeen`/`createTransactionSafeAdmin` já usados nesta sessão);
replay retorna 200 com o documento já existente, criação nova retorna 201. Sem o header, o
comportamento é idêntico ao de antes (`.add()` com ID automático) — não quebra nenhum caller que
não mande a chave.

**Também fechado o loop na origem real do risco**: `app/forms/[formId]/page.tsx` (a página
pública que o paciente de fato usa) agora gera uma chave estável 1x por carregamento
(`useState(() => crypto.randomUUID())`) e a reenvia no header. O botão já ficava desabilitado
durante o próprio envio (`disabled={isSubmitting}`), então o risco real que isso fecha não é o
duplo-clique instantâneo (já coberto) — é o paciente clicando "Enviar" de novo manualmente depois
de ver uma mensagem de erro transiente, mantendo a mesma chave por já estar na mesma instância de
componente.

## Verificação

`tsc --noEmit` limpo, suíte completa sem regressão. Sem teste novo — nenhum dos 3 arquivos
tocados (`app/api/v1/crm/contacts/route.ts`, `mergeClients.ts`, `app/api/forms/submit/route.ts`,
`app/forms/[formId]/page.tsx`) tem cobertura prévia, mesma convenção já estabelecida nesta sessão
pra rotas de API sem teste dedicado. **Não testado manualmente em navegador** — recomendado:
preencher a ficha de anamnese de um paciente de teste, forçar um erro (ex.: desconectar rede no
meio do envio), reconectar e clicar "Enviar" de novo, confirmar que só uma resposta é criada em
`formResponses`.
