# Conversas — visibilidade por setor aplicada no servidor (M07.3)

> Concluído em: 05/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: achado mais sério da investigação de abertura do M07 — visibilidade por setor/
> privacidade de conversa era só de UI, não uma fronteira de acesso real. Reconsiderado 2x com o
> usuário antes de implementar (ver §2 e §3) porque a investigação foi revelando que o conserto
> era maior e mais arriscado do que o plano original supunha.

## 1. O gap original

`ConversasModule.tsx:getVisibleConversations` filtrava conversas por setor/privacidade **só no
JavaScript do cliente**, DEPOIS que o Firestore já tinha entregue o snapshot completo pro
navegador. A query real (`ConversasModule.tsx`, listener principal) filtrava só por
`businessId`+`channelOwnerType`/`channelOwnerId` — **sem nenhuma cláusula de `sectorIds`**.
`firestore.rules` (`canAccessConversationData`) espelhava essa mesma checagem estreita, sem
noção de `sectorIds`/`isPrivate`/`assignedTo`. Efeito real: o SDK do Firestore de qualquer
operador recebia TODA conversa do negócio, independente de setor ou da flag `isPrivate` — a
restrição de setor era cosmética. Pra uma clínica com múltiplos setores, isso é exposição real
de confidencialidade de paciente entre equipes.

Confirmado que o MESMO padrão (busca tudo, filtra setor só no JS do cliente) também existe em
Kanban — não é descuido específico de Conversas, é uma convenção do app inteiro (CLAUDE.md
também cita CRM/Financeiro/Snippets/Spreadsheets). Decisão do usuário: corrigir só Conversas
agora (não os outros módulos).

## 2. Por que "só editar a regra" não funciona (achado técnico central)

Firestore aplica segurança em queries de LISTA (`list`, ex.: `onSnapshot`) de um jeito
fundamentalmente diferente de leitura de documento único (`get`): pra uma `list`, o Firestore só
aceita a query se conseguir **provar, olhando só os `where()` da própria query**, que nenhum
documento fora da regra poderia ser retornado — ele não reavalia depois documento por documento.
Se a regra depende de um valor que só existe fazendo `get()` de outro documento (ex.: "o setor do
usuário logado"), e a QUERY não tem como expressar isso como um `where()` literal, o Firestore não
consegue provar a segurança da query inteira e **rejeita a operação completa** — não filtra
silenciosamente, quebra a tela inteira pra quem não é admin.

Isso significa que a abordagem óbvia ("regra faz `get(users/uid).sectorIds` e cruza com
`resource.data.sectorIds.hasAny(...)`") **não é seguramente aplicável a uma query em tempo real**
— e não dava pra testar contra o motor de regras de verdade nesta sessão (emulador do Firestore
não roda no ambiente, falta Java). Arriscar isso ao vivo poderia quebrar a tela de Conversas
inteira pros não-admins de um cliente pagante em produção, ou (pior) parecer que funciona mas
nunca ser realmente aplicado pelo Firestore.

## 3. Design escolhido: denormalizar o resultado, não o critério

Em vez de pedir ao Firestore pra CRUZAR dois documentos dentro da regra, a conversa passa a
carregar, já resolvido, **quem exatamente pode vê-la**: novo campo `Conversation.visibleToUserIds:
string[] | null`.

- `null` = sem restrição (mesmo efeito de hoje quando não há `sectorIds` e `isPrivate` é falso).
- `string[]` = união de `assignedTo` (se setado) + todos os `memberIds` de cada setor em
  `sectorIds`. Setor referenciado que não existe mais é ignorado (conservador — perde membro
  morto, nunca vaza acesso a mais gente).

Com o resultado já materializado, a regra vira o padrão **canônico e comprovado** do próprio
Firebase pra "listar documentos visíveis ao usuário atual via um campo array":
`request.auth.uid in resource.data.visibleToUserIds` — SEM nenhum `get()` cruzado, porque
`request.auth.uid` já é um valor confiável (vem do token verificado, não do cliente) e a QUERY em
si filtra por `array-contains` o PRÓPRIO uid do chamador (`where('visibleToUserIds',
'array-contains', user.uid)`) — exatamente o padrão que o Firestore consegue provar.

`lib/services/conversationVisibility.ts` (`computeVisibleToUserIds`) é a lógica pura,
compartilhada por TODO write-path (client e Admin SDK) e pelo backfill — mesma função,
testada isoladamente (`tests/services/conversationVisibility.test.ts`, 8 casos). Variante Admin
SDK em `lib/services/conversationVisibilityAdmin.ts` (busca os setores via Firestore Admin antes
de delegar pro cálculo puro) — separada do arquivo puro pra não puxar `firebase-admin` em código
que também é importado por um componente client.

## 4. Onde o campo é mantido em sincronia

Todo write-path que muda `sectorIds`/`isPrivate`/`assignedTo` numa conversa agora também
recalcula e grava `visibleToUserIds`:

- **Criação** (sem sectorIds/isPrivate, `assignedTo` sozinho nunca restringe): `ConversasModule.tsx`
  (nova conversa manual), `baileys-manager.ts` (2 branches de criação — normal e race-condition),
  `app/api/webhooks/meta/route.ts`, `lib/services/conversationFromCampaign.ts` (broadcast/
  aniversário). Todos gravam `visibleToUserIds: null` explicitamente — nunca deixam o campo
  ausente, pra a query de "sem restrição" (que casa por igualdade exata contra `null`) sempre
  achar essas conversas.
- **Roteamento automático** (`ConversasModule.tsx`, `assign_sector`/`assign_user`): recalcula com
  `resolveVisibleToUserIds(conv, overrides)`, um helper memoizado que junta o estado atual da
  conversa com o campo mudando e chama `computeVisibleToUserIds` com o mapa `sectorsById` (de
  `useAuth().sectors`, já em memória).
- **Atribuição manual** (`handleAssignSector`, `handleTogglePrivate`, `handleBatchAssign`): mesmo
  helper. No batch, se a conversa não estiver no estado local carregado, o campo é **omitido** do
  update (não reescrito com um valor adivinhado) — sobrescrever com `null` às cegas arriscaria
  abrir uma conversa restrita (fail-open), então prefere deixar o valor anterior intocado.
- **`app/api/conversations/[id]/transfer-channel/route.ts`** (Admin SDK): quando transfere pra um
  canal pessoal e auto-atribui o dono, recalcula via `resolveVisibleToUserIdsAdmin` usando o
  `sectorIds`/`isPrivate` ATUAIS da conversa (não mudam nesta rota) + o novo `assignedTo`.
- **`app/api/v1/conversations/route.ts` PUT** (API pública): `assignedTo`/`isPrivate` são campos
  permitidos nesta rota — recalcula sempre que qualquer um dos dois vem no payload. Achado de
  passagem, não corrigido (limitação pré-existente do endpoint, não introduzida aqui):
  `sectorIds` em si não é um campo atualizável por esta rota (só `assignedToSectorId`, que não
  alimenta `visibleToUserIds`) — então um caller de API nunca conseguia (antes ou depois desta
  fatia) restringir por setor via este endpoint especificamente.
- **Mudança de composição de setor** (`SettingsModule.tsx`, Configurações→Setores): quando um
  setor é editado (membro entra/sai) ou apagado, `cascadeConversationVisibilityForSector` busca
  toda `Conversation` com `sectorIds array-contains` aquele setor e recalcula
  `visibleToUserIds` em lote (chunks de 400, sob o limite de 500 ops/batch do Firestore).
  Best-effort — falha aqui não desfaz a edição do setor, só loga. Assume UM sectorId por conversa
  (única forma que os write-paths atuais produzem); comentário no código sinaliza o que mudaria
  se isso deixasse de ser verdade.

## 5. Query ao vivo da tela de Conversas

Pra non-admin, o listener único virou 2 listeners mesclados client-side (admin continua com 1
listener irrestrito, sem mudança):

- **Query A**: `businessId==` + `(channelOwnerType=='business' OU channelOwnerId==uid)` +
  `visibleToUserIds==null` — bucket sem restrição de setor.
- **Query B**: mesma base ownership + `visibleToUserIds array-contains uid` — bucket "eu estou
  na lista resolvida".

Nunca se sobrepõem (o campo é OU `null` OU array), mas o merge (por `Map<id,Conversation>`,
resort por `lastMessageAt`) trata como defesa, não como caso esperado. Timeout de loading só
libera quando AMBAS as queries responderam pelo menos uma vez; erro em uma dispara retry só
daquela query (backoff exponencial, mesmo padrão de antes), sem derrubar a outra.

**5 índices compostos novos** em `firestore.indexes.json` (`conversations`:
`businessId+channelOwnerType+visibleToUserIds(==)+lastMessageAt`,
`businessId+channelOwnerId+visibleToUserIds(==)+lastMessageAt`, as 2 variantes
`arrayConfig:CONTAINS` pro campo `visibleToUserIds`, e `businessId+sectorIds(CONTAINS)` sem
orderBy — usado pela cascata de mudança de setor, não pelo listener principal) — o `or()` de
ownership já combinado com `and()` faz o Firestore expandir em sub-queries, cada uma exigindo seu
próprio índice composto (mesmo mecanismo que já explica os 2 índices existentes de
`channelOwnerType`/`channelOwnerId` sem a dimensão de visibilidade).

## 6. `firestore.rules`

Nova `canAccessConversationSector(data)`: `isAdmin()` bypassa; senão, campo ausente (conversa
pré-backfill) OU `null` (sem restrição) OU `uid in visibleToUserIds` — o padrão canônico citado
em §3, sem `get()` cruzado. Encadeada como condição ADICIONAL (AND) dentro de
`canAccessConversationData`, preservando a checagem de ownership já existente.

`!('visibleToUserIds' in data)` é permissivo de propósito (mesma filosofia já usada por
`isLegacyConversationData`) — só importa pra leitura de documento único (`get()`, ex.: abrir uma
conversa por link direto) antes do backfill rodar; as queries `list` do frontend já filtram por
igualdade/array-contains e nunca retornam um doc com o campo ausente de qualquer jeito, então essa
permissividade não enfraquece a proteção da lista em tempo real.

**Não foi possível validar a sintaxe/comportamento via emulador nesta sessão** (mesma limitação
já registrada em M03.4 — Java ausente no ambiente). Mitigação: `firebase deploy --only
firestore:rules` recusa o deploy inteiro se não compilar; a sintaxe usada (`in`, `is list`,
`get()`) já aparece em outras funções do mesmo arquivo. **Recomendado fortemente**: testar
manualmente em ambiente de homologação (ou ao menos smoke test em produção logo após deploy, com
uma conta de teste) antes de confiar 100% — este é o rules change de maior risco desta sessão.

## 7. Backfill

`scripts/backfill-conversation-visible-to.ts` (mesmo formato/CLI de `backfill-conversation-
ownership.ts`: `--dry-run`, `--business=<id>`, idempotente, streaming paginado, batch de 400).
Carrega `sectors` uma vez por negócio, aplica `computeVisibleToUserIds` a toda conversa sem o
campo. **Precisa rodar antes ou logo depois do deploy** — sem ele, conversas antigas restritas a
um setor ficam SEM `visibleToUserIds`, o que hoje é tratado como permissivo pela rule (só afeta
`get()` direto) mas continua INVISÍVEIS nas duas queries `list` (nem `==null` nem
`array-contains` casam com campo ausente) — ou seja, sem o backfill, conversas legadas restritas
por setor **desaparecem da lista pra todo non-admin** até o backfill rodar (efeito conservador,
não vaza nada, mas quebra acesso legítimo temporariamente). **Não executado contra dado real
nesta sessão** — recomendado rodar com `--dry-run` primeiro assim que houver acesso ao ambiente
de produção do cliente.

## 8. Achado de passagem, não corrigido

`SettingsModule.tsx:handleSave` (editar setor) só ADICIONA o `sectorId` ao `users.sectorIds` de
quem está em `formMemberIds` — não existe loop simétrico removendo o `sectorId` de
`users.sectorIds` de quem foi DESMARCADO nesta edição. Bug pré-existente, não introduzido aqui;
não afeta minha invariante (o cálculo de `visibleToUserIds` usa `sectors/{id}.memberIds`
diretamente, que a própria função `handleSave` sobrescreve corretamente com `formMemberIds`) —
mas deixa `users.sectorIds` como fonte secundária ligeiramente inconsistente, hoje só usada como
fallback client-side em `AuthProvider.userSectorIds`.

## 9. Verificação

`tsc --noEmit` limpo. 8 testes novos e passando pra `computeVisibleToUserIds`
(`tests/services/conversationVisibility.test.ts`) — a única peça genuinamente pura e testável
desta fatia; o resto (listener merge, cascata de setor, rules) depende de Firestore real ou do
emulador indisponível, mesma limitação já registrada. Suíte completa sem regressão (contagem
exata no commit). **Não testado manualmente em navegador nem contra o emulador** — esta é,
declaradamente, a fatia de maior risco de toda a sessão M03/M06/M07: rules change com semântica
de `list`-query não-trivial, reescrita do listener principal de uma tela full-height crítica, e
um backfill que precisa rodar em produção. Recomendação forte: revisar este documento + testar em
homologação antes de confiar cegamente, e rodar o backfill com `--dry-run` antes do write real.
