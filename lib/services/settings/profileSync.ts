/**
 * lib/services/settings/profileSync.ts
 *
 * Regra PURA (sem SDK) que decide se o efeito de "sync com servidor" de
 * `ProfileTab` (SettingsModule.tsx) deve reaplicar os campos de `user` ao
 * formulário local, ou pular a atualização.
 *
 * M09 Gap 7 / mesma causa raiz do `SIDEBAR_PREFS_HEARTBEAT_BUG.md`: o
 * AuthProvider reconstrói o objeto `user` inteiro (onSnapshot) toda vez que
 * QUALQUER campo de `users/{uid}` muda — inclusive `isOnline`/`lastSeenAt` do
 * heartbeat de presença (60s) e do listener de `visibilitychange` (troca de
 * aba). Isso gera uma referência NOVA de `user` mesmo quando nome/telefone/
 * endereço/agenda não mudaram. Um `useEffect(() => {...}, [user])` normal
 * disparava a cada heartbeat e sobrescrevia o formulário com o que já estava
 * salvo no servidor — se o cliente estivesse digitando (ou só tivesse
 * trocado de aba um instante) há mais de 60s, a edição em andamento era
 * descartada silenciosamente antes de "Salvar" ser clicado.
 *
 * A chave inclui `uid` (troca de conta sempre força resync).
 */

import type { User, WorkingHours } from '@/lib/types';

export function computeProfileSyncKey(user: User | null | undefined): string {
  if (!user) return JSON.stringify(null);
  const relevant: {
    uid: string;
    name: string;
    phone: string | undefined;
    photoURL: string | undefined;
    profileAddress: User['profileAddress'];
    isProfessional: boolean | undefined;
    serviceIds: string[] | undefined;
    workingHours: WorkingHours | undefined;
  } = {
    uid: user.uid,
    name: user.name,
    phone: user.phone,
    photoURL: user.photoURL,
    profileAddress: user.profileAddress,
    isProfessional: user.isProfessional,
    serviceIds: user.serviceIds,
    workingHours: user.workingHours,
  };
  return JSON.stringify(relevant);
}
