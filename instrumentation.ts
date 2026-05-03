/**
 * Next.js Instrumentation Hook
 *
 * Chamado uma vez quando o servidor Node.js inicia. Restaura automaticamente
 * todas as sessões Baileys que estavam conectadas antes de um restart do servidor.
 *
 * Sem isso, um restart (deploy, crash, OOM) mata todas as sessões em memória e
 * o operador precisa abrir o app no browser para restaurar — o que pode levar
 * minutos ou horas dependendo do horário.
 */
export async function register() {
  // Só roda no runtime Node.js (não no Edge runtime ou durante build)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Aguarda 3s para o servidor estar completamente inicializado antes de
  // tentar restaurar sessões (evita race com module initialization)
  await new Promise(r => setTimeout(r, 3000));

  try {
    const { adminDb } = await import('@/lib/config/firebaseAdmin');
    const { SESSIONS_DIR, sessions, createBaileysSession } = await import('@/app/api/whatsapp/baileys-manager');
    const fs = await import('fs');
    const path = await import('path');

    console.log('[Instrumentation] Verificando sessões Baileys para restaurar...');

    // Busca todos os businesses com Baileys conectado no Firestore
    const bizSnap = await adminDb.collection('businesses')
      .where('channels.whatsappBaileys.isConnected', '==', true)
      .get();

    if (bizSnap.empty) {
      console.log('[Instrumentation] Nenhum business com Baileys conectado.');
      return;
    }

    console.log(`[Instrumentation] ${bizSnap.size} business(es) com Baileys — verificando arquivos de sessão...`);

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

          // Verifica se há arquivos de sessão no disco
          const sessionDir = path.join(SESSIONS_DIR, sessionKey);
          const legacyDir = path.join(SESSIONS_DIR, businessId);
          const hasFiles = (dir: string) =>
            fs.existsSync(dir) && fs.readdirSync(dir).some((f: string) => f.endsWith('.json'));

          if (!hasFiles(sessionDir) && !hasFiles(legacyDir)) {
            console.log(`[Instrumentation] Sem arquivos de sessão para ${sessionKey.slice(-12)} — pulando.`);
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
