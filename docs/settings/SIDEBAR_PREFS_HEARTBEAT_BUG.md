# Personalização da sidebar não salvava — heartbeat de presença sobrescrevia edição em andamento

> Corrigido em código em: 03/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: cliente reportou que customizou a sidebar em Configurações →
> Modo do Sistema → "Personalizar Sidebar" (arrastar/ocultar módulos), clicou
> Salvar, e nada mudou na barra lateral real — mesmo depois de atualizar a
> página.

## 1. Causa raiz

`SidebarEditorTab.tsx` tem um efeito de "sync com servidor" que reaplica
`user.sidebarPrefs` ao estado local do editor (`sections`/`hiddenItems`)
sempre que `user.sidebarPrefs` muda — pensado originalmente pra refletir
edições feitas em outro dispositivo (multi-device).

O problema: `AuthProvider` mantém `user` vivo via `onSnapshot` em
`users/{uid}`, e o **heartbeat de presença** (`setPresence`, a cada 60s, mais
o listener de `visibilitychange` — toda troca de aba do navegador) escreve
`isOnline`/`lastSeenAt` nesse MESMO documento. Cada escrita, mesmo tocando só
esses dois campos, faz o Firestore reconstruir o documento inteiro no
snapshot seguinte — `user.sidebarPrefs` vira uma **referência nova**, mesmo
com conteúdo idêntico. Como o efeito de sync comparava só por referência (via
dependency array padrão do `useEffect`), ele disparava a cada heartbeat e
reescrevia `sections`/`hiddenItems` locais com o que já estava salvo no
servidor — **descartando qualquer edição em andamento ainda não salva**.

Sequência real do bug: cliente abre o editor → arrasta itens, oculta módulos
(tudo em estado local, nada salvo ainda) → passa mais de 60s customizando
(ou só troca de aba um instante) → heartbeat dispara → efeito de sync
reverte o estado local pro que já estava salvo → cliente clica "Salvar" →
salva exatamente o estado ANTIGO (igual ao que já existia) → sidebar real não
muda, porque nada novo foi de fato persistido. Sem erro, sem log — falha
100% silenciosa.

## 2. Correção

`lib/services/settings/sidebarPrefsSync.ts` (novo, puro, sem SDK):
`computeSidebarPrefsSyncKey(userId, prefs, isEnterprise, useCase, roleValue)`
serializa os inputs relevantes numa chave por CONTEÚDO. `SidebarEditorTab.tsx`
guarda a última chave aplicada num `useRef` e só reaplica o servidor ao
estado local quando a chave muda de verdade — ou seja, quando `sidebarPrefs`
mudou de conteúdo (edição real, própria ou de outro device), ou quando
`useCase`/role/enterprise mudou (precisa re-filtrar visibilidade mesmo sem
mudança em `sidebarPrefs`), ou quando o usuário logado muda (troca de conta
sempre força resync, mesmo que por coincidência prefs/contexto sejam iguais).
Heartbeat/troca de aba (mesmo conteúdo, referência nova) agora é ignorado —
não há mais o que resetar.

## 3. Evidências automatizadas

- `tests/services/sidebarPrefsSync.test.ts` (6 casos): mesma chave pra objeto
  reconstruído com conteúdo idêntico (simula o efeito do heartbeat); chave
  muda com conteúdo de `sections` diferente; chave muda com userId diferente;
  chave muda com useCase diferente; chave muda com role diferente; `undefined`
  tratado de forma estável.
- Suíte completa: 844 testes em 63 arquivos aprovados. `tsc --noEmit` limpo.

## 4. O que não foi tocado

`Sidebar.tsx` (a barra lateral real) não guarda nenhum rascunho local de
`sidebarPrefs` — ele deriva `effectiveSections` diretamente de
`user.sidebarPrefs` via `useMemo` a cada render, então não tem o mesmo risco
de "estado local sendo sobrescrito"; não precisou de mudança.
