# M09 — Plano de Equipe, Permissões e Colaboração

> Análise concluída em: 05/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Referência funcional: Gestão Raiz
>
> Lente desta rodada: **odontologia** — equipe pequena (dentista(s) + recepção).
>
> Estado: investigação de abertura concluída em 05/09/2026 (mesmo rigor de M06/M03/M07/M10/M13/
> M05). **Achado crítico já corrigido na mesma sessão** — ver §1. Isto é o achado de segurança
> mais grave de toda a sessão, mais grave até que o `wipe-financial.ts` do M13 (esse exigia
> acesso ao repo pra rodar um script; este era explorável por qualquer conta autenticada, direto
> pelo navegador, sem nenhum acesso prévio).

---

## 0. Escopo reivindicado pelo roadmap (citação literal)

> Usuários, convites, funções, setores, presença e visibilidade por departamento.
> Kanban, notas, chat de equipe, planilhas e cofre com autorização consistente.

## 1. Achado crítico — escalonamento de privilégio + fuga de tenant via `users/{userId}` ✅ CORRIGIDO

### O gap

`firestore.rules` (`match /users/{userId}`) permitia que um usuário autenticado escrevesse
**qualquer campo** no próprio documento via `allow update`/`allow create`, sem restrição
nenhuma. Como TODA a autorização do sistema — client-side (`belongsToBusiness()`, `isAdmin()`,
`hasMinRole()`, todas no topo de `firestore.rules`) e server-side (`lib/utils/verifyAuth.ts`,
usado por praticamente toda rota `app/api/*`) — lê `role`/`businessId` **diretamente deste mesmo
documento sem nenhuma outra checagem**, isso significava que qualquer conta autenticada podia
chamar o SDK client direto (ex.: console do navegador, sem precisar de nenhuma ferramenta de
ataque) e escrever:

```js
setDoc(doc(db, 'users', meuUid), { role: 'founder', businessId: '<id de QUALQUER outro tenant>' })
```

...e instantaneamente ganhar acesso `founder` a **qualquer outro negócio no sistema**, incluindo
os 2 clientes pagantes reais com dado de paciente/financeiro em produção. Sem precisar de convite,
sem precisar de acesso prévio, sem precisar comprometer nenhuma credencial — só uma conta
autenticada (inclusive um signup novo e gratuito).

Confirmado, não é hipotético: `belongsToBusiness()`/`userRoleValue()` (linhas 20-51 de
`firestore.rules`) leem `getUserDoc().businessId`/`getUserDoc().role` — exatamente o mesmo campo
sem validação. `business.memberIds` (o array que a UI usa pra listar membros) nunca é consultado
por nenhuma regra de isolamento de tenant fora de `businesses`/`teamChat` — não é uma segunda
camada de defesa. `lib/utils/verifyAuth.ts:44-46` lê `role`/`businessId` do mesmo doc sem nenhuma
validação adicional. Não há Cloud Functions no repo que pudessem reverter uma escrita inválida.
`tests/security/rules.test.ts` não é um teste de emulador real (sem `@firebase/rules-unit-
testing`) — nunca rodou contra as regras de verdade, nunca capturaria isso.

### A correção (implementada, testada via `firebase deploy --dry-run`, PENDENTE DE DEPLOY)

- **`allow update`**: auto-edição agora só pode tocar uma whitelist de campos de perfil
  (`name, phone, profileAddress, photoURL, userStatus, sidebarPrefs, isProfessional, serviceIds,
  workingHours, language, isOnline, lastSeenAt, lastLoginAt, commissionRate, updatedAt` —
  inventariado lendo todo call-site real de escrita em `users/{uid}` em `app/`). **Nunca inclui
  `role`/`businessId`.** Admin/founder do MESMO negócio continua podendo mudar `role`/`isActive`/
  `sectorIds`/`commissionRate`/etc de outro membro (inclui remoção, que zera `businessId` pra
  `null`), mas nunca pra outro negócio, e — quando `role` de fato muda — nunca concedendo rank
  maior que o próprio (fecha também "admin promove alguém a founder").
- **`allow create`**: bloqueia `role == 'founder'` (nenhum fluxo real de signup gera esse valor —
  dono de negócio novo sempre vira `admin`; convite só oferece admin/manager/operator/viewer).
- **`inviteCodes` `allow create`**: role concedido no convite nunca pode exceder o rank de quem
  cria (fecha o mesmo tipo de escalação via convite forjado).

**Validado via `firebase deploy --only firestore:rules --dry-run` contra o projeto real
(`service-provider-1cd0d`)** — "rules file compiled successfully". Esta é a primeira vez nesta
sessão que uma mudança de `firestore.rules` foi validada contra o compilador de regras de
verdade (as mudanças anteriores — M03.4/M07.3/M07.4 — só puderam ser revisadas manualmente,
emulador indisponível por falta de Java). `--dry-run` não deploya nada — só valida.

**Deployado em produção com autorização explícita do usuário** (`firebase deploy --only
firestore:rules`, sem `--dry-run`) — saída confirmou "released rules firestore.rules to
cloud.firestore" / "Deploy complete!". A correção está ativa em produção a partir de 05/09/2026.

### ⚠️ Achado que fica deliberadamente aberto (não silenciado)

O `allow create` corrigido bloqueia `founder`, mas **não consegue distinguir, pra qualquer outra
role, "resgatei um invite de verdade pra este negócio" de "forjei um create com um `businessId`
que só conheço/adivinhei"** — `role:'admin'` especificamente é legítimo tanto no fluxo de dono de
negócio novo (verificável via `businesses/{id}.ownerUserId`) quanto no de convite pra admin de um
negócio já existente (não verificável sem o client passar o código do convite como campo, pra
cross-referenciar contra `inviteCodes` na regra). Fechar isso por completo exige uma mudança
pequena de código de app (não só de regra) — deixado como follow-up explícito. **Severidade
residual**: menor que o gap original (não permite mais virar `founder` nem mudar `businessId` de
uma conta já existente), mas ainda permite que uma conta NOVA se auto-associe a um negócio
existente com um papel não-founder, sem convite real, se souber/adivinhar o `businessId` (um ID
Firestore de ~20 caracteres aleatórios — não trivialmente adivinhável, mas não criptograficamente
garantido).

## 2. Correções ao que CLAUDE.md/roadmap presumiam

### 2.1 Visibilidade por setor NÃO se aplica a CRM, Financeiro nem Snippets

CLAUDE.md §4 afirma que setor se aplica a "Conversations, Kanban, CRM, Financeiro, Snippets,
Spreadsheets." Falso pra 3 dos 6: **CRM/Clients** (zero ocorrência de `sectorIds`/
`userSectorIds` em todo o diretório — gateado só por `isOperator()`); **Financeiro** (`sectorId`
existe mas é só filtro de relatório/categorização, não controle de acesso — qualquer `manager+`
vê tudo); **Snippets** (`sectorId` é só tag de curadoria admin, a query real do composer de
conversas filtra só por `businessId`). Confirmado por grep: `userSectorIds` (o padrão real) só é
usado em 3 arquivos — `ConversasModule.tsx`, `KanbanModule.tsx`, `SpreadsheetsModule.tsx`.

### 2.2 "Founder" é um papel que o signup normal nunca produz

Os dois fluxos de criação de negócio (email/senha e Google) atribuem `role: 'admin'` ao criador,
nunca `'founder'`. Zero escritas reais de `role: 'founder'` em todo o repo (só um mock de demo em
código morto, ver §5). Consequência: em qualquer tenant real criado pelo fluxo normal — incluindo
provavelmente os 2 clientes pagantes atuais — **ninguém tem `role: 'founder'`**, a menos que
alguém tenha promovido manualmente via console do Firebase. Ações founder-only (remover membro,
apagar negócio, purgar log de auditoria) ficam inacessíveis pro dono real da conta.

### 2.3 R1/hierarquia numérica: convenção seguida com rigor (correção positiva)

Diferente de todos os módulos anteriores auditados nesta sessão, aqui a convenção documentada É
seguida de forma consistente — >90 sites usam `ROLE_HIERARCHY[...] >= ROLE_HIERARCHY[minRole]`
corretamente; as únicas comparações de string encontradas (`SettingsModule.tsx`) são usos
legítimos do caso especial "founder é isento do teto de hierarquia", não o anti-padrão que
CLAUDE.md adverte.

## 3. Gaps reais encontrados (além do §1)

| # | Gap | Severidade |
|---|---|---|
| 2 | Resgate de invite code é check-then-act, não atômico — dois signups concorrentes com o mesmo código podem ambos completar antes de qualquer um marcar o código usado | Média-alta (mesma classe já corrigida 2x nesta sessão — Baileys, opt-out) |
| 3 | Expiração do invite code só é checada no cliente, não na regra | Média (mitigada pelo fix do §1 — sem a escalação livre, o valor de explorar isso cai bastante) |
| 4 | `notes` (Mural): regra de leitura não distingue nota pessoal de nota de equipe — filtro é só client-side | Média (expectativa de privacidade, não segmentação por setor) |
| 5 | Kanban/Spreadsheets: mesmo padrão pré-M07.3 de Conversas (aberto na regra, `sectorIds` só filtrado em JS) | Média (receita pronta pra replicar — o M07.3 já resolveu o problema idêntico) |
| 6 | `getMemberDisplayStatus()` triplicada (copy-paste) em 3 arquivos, sem util compartilhado | Baixa |
| 7 | Bug de heartbeat sobrescrevendo edição em andamento no formulário de Perfil (mesma causa raiz do `SIDEBAR_PREFS_HEARTBEAT_BUG.md`, nunca corrigido aqui) | Média (UX — perde texto não salvo) |

## 4. O que já existe e funciona

- Convenção `ROLE_HIERARCHY` consistente em toda a aplicação (§2.3).
- Presença: heartbeat 60s + `visibilitychange`+`beforeunload`, 4 estados corretos onde a lógica
  de `getMemberDisplayStatus` existe (só duplicada, não errada).
- Team Chat: ACL real por documento (`memberIds` imutável após criação) — melhor exemplo de
  autorização granular do módulo.
- Convites: fluxo completo (gerar/validar/resgatar/marcar usado/revogar) funciona pro caso comum.
- Cofre: 100% mediado por Admin SDK, zero superfície de ataque cliente-direto (herda o risco de
  fundo do §1, já corrigido).
- Granularidade: 5 tiers cobre o caso de uso real de uma clínica pequena — sem sinal de demanda
  represada por permissão mais fina.

## 5. Código morto confirmado

`app/components/features/integrations/` — módulo inteiro sem nenhum importador real: 13
arquivos, 4.342 linhas. Maior que o achado análogo do M07 (`OmnichannelInbox.tsx`, 939 linhas).
Contém dado de demo hardcoded (`TeamTab.tsx`, mock com `role:'founder'`).

## 6. O que é decisão de produto, não de engenharia

1. **Existe algum usuário `founder` real hoje?** Se não, ações founder-only ficam bloqueadas pros
   2 clientes pagantes. Decidir: promover manualmente via console, ou mudar a regra de negócio
   pra "dono original = founder automaticamente" no signup.
2. **Notas pessoais devem ser protegidas no servidor?** (Gap 4).
3. **Sector-visibility em CRM/Financeiro**: CLAUDE.md promete, código não entrega — importa
   agora pra equipe pequena, ou só se a intenção for vender pra clínicas maiores depois?
4. **Fechar o gap residual do `create` (role≠founder ainda sem cross-referência de invite)?**
   Exige mudança de app code, não só de regra.

## 7. Fora de escopo deliberado

- Sector-enforcement server-side em Kanban/Spreadsheets (Gap 5) — equipe pequena não tem múltiplos
  setores concorrendo por confidencialidade ainda. **Ainda em aberto** (maior escopo que os
  outros — mesmo padrão de risco do M07.3, "a fatia de maior risco da sessão"; não retomado
  nesta rodada de fixes por conta própria, ver nota abaixo).
- ~~Consolidar `getMemberDisplayStatus` num util compartilhado (Gap 6) — cosmético.~~ ✅
  Corrigido em 08/09/2026 (`lib/utils/presence.ts`, ver M09.3).
- Apagar `IntegrationsModule` morto (§5) — ✅ apagado em M11 (`ae72a69`).
- ~~Corrigir bug de heartbeat no Perfil (Gap 7) — real mas UX-only.~~ ✅ Corrigido em 08/09/2026
  (`lib/services/settings/profileSync.ts`, mesmo padrão do `SIDEBAR_PREFS_HEARTBEAT_BUG.md`).
- ~~Race condition de invite code (Gap 2) — baixo risco prático pra equipe de 2-3 pessoas.~~ ✅
  Corrigido em 08/09/2026 — reordenado pra reivindicar o código atomicamente ANTES de conceder
  acesso, aproveitando compare-and-swap real já existente na regra `inviteCodes` allow update.
- ~~Achado residual do `create` (role≠founder sem cross-referência de invite).~~ ✅ Fechado em
  08/09/2026 — confirmado por leitura de código que só existe 1 caminho de create com
  role≠founder em todo o app (resgate de invite); `redeemedInviteCode` gravado no create,
  cross-referenciado na regra.

## 8. Fases

### M09.0 — Baseline (investigação de abertura) ✅ Concluído (05/09/2026)

### M09.1 — Fechar escalação de privilégio via `users/{userId}` ✅ Corrigido E deployado (05/09/2026)

- [x] `firestore.rules`: `allow update`/`allow create` de `users/{userId}` restritos (whitelist
      de campos + bloqueio de `role:'founder'`); `inviteCodes` `allow create` com teto de rank.
      Validado via `firebase deploy --dry-run` (compilou). **Deployado em produção com
      autorização explícita do usuário — `firebase deploy --only firestore:rules` rodou com
      sucesso (`Deploy complete!`, "released rules firestore.rules to cloud.firestore") contra o
      projeto real `service-provider-1cd0d`.** A correção está ativa em produção a partir de
      05/09/2026.
- [x] Achado residual documentado (create de role≠founder ainda sem cross-referência de invite)
      — follow-up explícito, não bloqueia o deploy da correção principal (já feito). **Fechado em
      M09.3 (08/09/2026).**

### M09.3 — Fixes de baixo risco por conta própria (08/09/2026)

- [x] Gap 2 (race condition de invite code): `AuthProvider.tsx` reordenado — reivindica o código
      (`isActive:false`) atomicamente ANTES de criar perfil/memberIds, aproveitando o
      compare-and-swap real já existente na regra `inviteCodes` `allow update`
      (`resource.data.isActive == true` avaliado contra o commit mais recente, não a leitura
      stale). Segundo signup concorrente agora recebe permission-denied ANTES de ganhar acesso.
- [x] Achado residual do `create` (role≠founder sem cross-referência de invite): fechado no mesmo
      commit — `redeemedInviteCode` gravado no create (mesmo write que já reivindica o código
      acima), `firestore.rules` cross-referencia `inviteCodes/{code}.usedBy/businessId/role`.
      Confirmado por leitura de código (não só documentação) que o único caminho de create com
      role≠founder em todo o app é o resgate de invite — `signInWithGoogle` só cria founder.
- [x] Gap 6 (`getMemberDisplayStatus` triplicada): consolidado em `lib/utils/presence.ts`
      (`getMemberDisplayStatus`/`isMemberOnline`), `SettingsModule.tsx`/`TeamChatPanel.tsx`
      importam em vez de redefinir. Testes novos em `tests/utils/presence.test.ts`.
- [x] Gap 7 (heartbeat sobrescrevendo Perfil): `lib/services/settings/profileSync.ts`
      (`computeProfileSyncKey`), mesmo padrão de `sidebarPrefsSync.ts` — sync guardado por
      conteúdo via `useRef`, não por referência. Testes novos em
      `tests/services/profileSync.test.ts`.
- [ ] Validado via `firebase deploy --only firestore:rules --dry-run` (compilou) — **NÃO
      deployado ainda**, aguardando autorização explícita do usuário (mesmo protocolo de
      M09.1/M09.2).
- Gap 5 (sector-enforcement em Kanban/Spreadsheets) permanece deliberadamente fora desta rodada
  — escopo comparável ao M07.3 ("fatia de maior risco da sessão"), não cabe numa fatia de
  "fixes de baixo risco por conta própria".

### M09.2 — Existe founder real? ✅ Decidido e implementado (05/09/2026)

- [x] **Decisão do usuário: mudar a regra de negócio — dono do signup vira `founder`
      automaticamente**, em vez de decidir caso a caso quem promover manualmente.
      `AuthProvider.tsx` (`signUp` fluxo de negócio novo + `signInWithGoogle`): `role: 'admin'`
      → `role: 'founder'` nos dois pontos de criação. `firestore.rules` (`users/{userId}`
      `allow create`) ajustada em conjunto: `role:'founder'` só é aceito quando o negócio
      referenciado já existe com `ownerUserId == request.auth.uid` (verificado via `get()`) —
      único jeito legítimo de criar founder, já que convite nunca oferece essa role. Sem essa
      mudança na regra, o próprio bloqueio de `founder` do M09.1 teria rejeitado todo signup de
      negócio novo a partir de agora. Validado via `firebase deploy --dry-run` (compilou) e
      **deployado em produção com autorização explícita do usuário** (`firebase deploy --only
      firestore:rules`, "Deploy complete!") — regra atualizada ativa antes do código do app
      (`AuthProvider.tsx`) ir ao ar, evitando janela de dessincronia.

### M09.3+ — demais gaps (§3), fora de escopo por padrão (§7)

## 9. Riscos e controles

| Risco | Controle planejado |
|---|---|
| Corrigir a regra e quebrar um fluxo legítimo de signup/edição de perfil sem poder testar via emulador | Inventário exaustivo de todo call-site real de escrita em `users/{uid}` antes de escrever a regra; validado via `firebase deploy --dry-run` contra o projeto real (compilação confirmada) |
| Deixar a correção só commitada sem deployar, achando que já protege produção | **Resolvido**: usuário autorizou explicitamente, deploy real rodou com sucesso (05/09/2026) |
