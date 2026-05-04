/**
 * Next.js Instrumentation Hook
 *
 * Chamado uma vez quando o servidor Node.js inicia. Restaura automaticamente
 * todas as sessões Baileys que estavam conectadas antes de um restart do servidor.
 *
 * Sem isso, um restart (deploy, crash, OOM) mata todas as sessões em memória e
 * o operador precisa abrir o app no browser para restaurar — o que pode levar
 * minutos ou horas dependendo do horário.
 *
 * O auth state é persistido em Firestore (lib/services/baileys/firestore-auth-state.ts),
 * portanto este hook funciona em qualquer máquina/container — basta haver um
 * doc em baileysAuthStates/{connectionId} pra restaurar.
 */
export async function register() {
  // Só roda no runtime Node.js (não no Edge runtime ou durante build)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Aguarda 3s para o servidor estar completamente inicializado antes de
  // tentar restaurar sessões (evita race com module initialization)
  await new Promise(r => setTimeout(r, 3000));

  try {
    const { adminDb } = await import('@/lib/config/firebaseAdmin');
    const { sessions, createBaileysSession } = await import('@/app/api/whatsapp/baileys-manager');
    const { hasFirestoreAuthState } = await import('@/lib/services/baileys/firestore-auth-state');

    console.log('[Instrumentation] Verificando sessões Baileys para restaurar...');

    // Busca todas as channelConnections Baileys ativas (modelo autoritativo).
    // Não filtra por isConnected — o campo fica false após shutdown do container,
    // mas o auth state persistido no Firestore permite restaurar a sessão.
    const connSnap = await adminDb.collection('channelConnections')
      .where('type', '==', 'whatsapp_baileys')
      .where('isActive', '==', true)
      .get();

    if (connSnap.empty) {
      console.log('[Instrumentation] Nenhuma channelConnection Baileys ativa.');
      return;
    }

    console.log(`[Instrumentation] ${connSnap.size} connection(s) Baileys — verificando auth state no Firestore...`);

    const restorePromises: Promise<void>[] = [];

    for (const doc of connSnap.docs) {
      const conn = doc.data();
      const sessionKey = doc.id;
      const businessId = conn.businessId as string;

      if (!businessId) {
        console.warn(`[Instrumentation] Connection ${sessionKey} sem businessId, pulando.`);
        continue;
      }

      const restoreOne = async () => {
        try {
          // Pula se já está em memória
          if (sessions.has(sessionKey)) {
            console.log(`[Instrumentation] Sessão ${sessionKey.slice(-12)} já ativa, pulando.`);
            return;
          }

          // Verifica se há auth state persistido no Firestore
          const hasAuthState = await hasFirestoreAuthState(sessionKey);

          if (!hasAuthState) {
            console.warn(
              `[Instrumentation] Connection ${sessionKey.slice(-12)} sem auth state persistido. ` +
              `Re-pareamento via QR necessário.`
            );
            return;
          }

          console.log(`[Instrumentation] Restaurando sessão para business ${businessId.slice(-8)} (conn ${sessionKey.slice(-12)})...`);
          await createBaileysSession(businessId, 'restore', sessionKey);
          console.log(`[Instrumentation] ✓ Sessão ${sessionKey.slice(-12)} restaurada.`);
        } catch (err) {
          console.error(`[Instrumentation] Falha ao restaurar sessão para ${businessId}:`, err);
        }
      };

      restorePromises.push(restoreOne());
    }

    // Restaura em paralelo mas não deixa falhas individuais derrubar as outras
    await Promise.allSettled(restorePromises);
    console.log('[Instrumentation] Restore de sessões Baileys concluído.');
  } catch (err) {
    // Não deve travar o boot do servidor
    console.error('[Instrumentation] Erro no restore automático de sessões Baileys:', err);
  }
}
