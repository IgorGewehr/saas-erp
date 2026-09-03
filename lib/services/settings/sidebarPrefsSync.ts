/**
 * lib/services/settings/sidebarPrefsSync.ts
 *
 * Regra PURA (sem SDK) que decide se o efeito de "sync com servidor" de
 * SidebarEditorTab.tsx deve reaplicar `user.sidebarPrefs` ao estado local do
 * editor, ou pular a atualização.
 *
 * Bug corrigido por essa checagem: o AuthProvider reconstrói o objeto `user`
 * inteiro (onSnapshot) toda vez que QUALQUER campo de `users/{uid}` muda —
 * inclusive `isOnline`/`lastSeenAt` do heartbeat de presença (60s) e do
 * listener de `visibilitychange` (troca de aba). Isso gera uma referência
 * NOVA de `user.sidebarPrefs` mesmo quando o conteúdo não mudou. Comparar só
 * por referência (como um `useEffect` normal faria) disparava o efeito a
 * cada heartbeat e sobrescrevia edições locais AINDA NÃO SALVAS (drag/ocultar
 * em andamento) com o que já estava salvo no servidor — o usuário
 * customizava a sidebar, clicava "Salvar" e nada acontecia, porque o estado
 * local já tinha sido revertido por baixo antes do clique.
 *
 * A chave inclui userId (troca de conta sempre força resync, mesmo que por
 * coincidência o conteúdo seja igual) e o contexto de modo/role/enterprise
 * (mudar o modo do negócio deve reaplicar a filtragem mesmo que
 * `sidebarPrefs` em si não tenha mudado).
 */

import type { SidebarPrefs, UseCase } from '@/lib/types';

export function computeSidebarPrefsSyncKey(
  userId: string | undefined,
  prefs: SidebarPrefs | undefined,
  isEnterprise: boolean,
  useCase: UseCase,
  roleValue: number,
): string {
  return JSON.stringify([userId ?? null, prefs ?? null, isEnterprise, useCase, roleValue]);
}
