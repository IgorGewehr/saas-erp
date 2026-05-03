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

    // Busca todos os businesses com Baileys conectado no Firestore
    const bizSnap = await adminDb.collection('businesses')
      .where('channels.whatsappBaileys.isConnected', '==', true)
      .get();

    if (bizSnap.empty) {
      console.log('[Instrumentation] Nenhum business com Baileys conectado.');
      return;
    }

    console.log(`[Instrumentation] ${bizSnap.size} business(es) com Baileys — verificando auth state no Firestore...`);

    const restorePromises: Promise<void>[] = [];

    for (const doc of bizSnap.docs) {
      const businessId = doc.id;

      const restoreOne = async () => {
        try {
          const { ensurePrimaryBaileysBusinessConnection } = await import('@/lib/services/channels/channelConnections');
          const conn = await ensurePrimaryBaileysBusinessConnection(businessId);
          const sessionKey = conn.id;

          // Pula se já está em memória
          if (sessions.has(sessionKey)) {
            console.log(`[Instrumentation] Sessão ${sessionKey.slice(-12)} já ativa, pulando.`);
            return;
          }

          // Verifica se há auth state persistido no Firestore
          const hasAuthState = await hasFirestoreAuthState(sessionKey);

          if (!hasAuthState) {
            // Estado dessincronizado: Firestore (channels.whatsappBaileys.isConnected=true)
            // diz conectado mas o auth state não existe (nunca pareou, ou foi apagado).
            // Marca como desconectado pra UI parar de mentir "conectado".
            console.warn(
              `[Instrumentation] Estado dessincronizado para ${sessionKey.slice(-12)}: ` +
              `isConnected=true mas sem auth state persistido. ` +
              `Marcando como desconectado — re-pareamento via QR necessário.`
            );

            const now = new Date().toISOString();

            // Atualiza connection doc (modelo novo)
            try {
              const { updateConnection } = await import('@/lib/services/channels/channelConnections');
              await updateConnection(sessionKey, {
                isConnected: false,
                disconnectedAt: now,
              });
            } catch (connErr) {
              console.warn('[Instrumentation] Falha ao atualizar channelConnection:', connErr);
            }

            // Atualiza businesses.channels.whatsappBaileys (legado) só se for business connection
            try {
              const connSnap = await adminDb.collection('channelConnections').doc(sessionKey).get();
              const isBusinessConn = !connSnap.exists || connSnap.data()?.ownerType !== 'user';
              if (isBusinessConn) {
                await adminDb.collection('businesses').doc(businessId).update({
                  'channels.whatsappBaileys.isConnected': false,
                  'channels.whatsappBaileys.disconnectedAt': now,
                  updatedAt: now,
                });
              }
            } catch (legacyErr) {
              console.warn('[Instrumentation] Falha ao atualizar businesses.channels:', legacyErr);
            }
            return;
          }

          console.log(`[Instrumentation] Restaurando sessão para business ${businessId.slice(-8)}...`);
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
