/**
 * Firestore-backed AuthenticationState para Baileys.
 *
 * Substitui o useMultiFileAuthState (que persiste em arquivos JSON locais) por
 * um adapter que usa o Firestore como single source of truth. Isso permite:
 *
 *   1. Multi-machine: pareie no PC A, abra a app no PC B — a sessão é
 *      carregada do Firestore (não precisa re-escanear QR Code).
 *   2. Failover: se o container/servidor cair, qualquer instância nova
 *      recupera a sessão sem perder credenciais.
 *   3. Backup automático: o Firestore é replicado/cifrado at-rest pelo Google.
 *
 * IMPORTANTE: Apesar do estado ser compartilhado, **apenas um socket Baileys
 * pode estar ativo por sessão por vez** — o WhatsApp multi-device não permite
 * dois clientes simultâneos com as mesmas credenciais. Se duas instâncias
 * abrirem o socket ao mesmo tempo, o WhatsApp desloga uma. Se isso virar um
 * problema operacional, implementar lock distribuído via Firestore (TTL doc).
 *
 * Layout no Firestore:
 *   baileysAuthStates/{connectionId}                  → doc com creds (cifrados)
 *   baileysAuthStates/{connectionId}/keys/{type}-{id} → docs com keys do Signal
 *
 * Os valores são serializados via BufferJSON do Baileys (lida com Buffer
 * binário) e cifrados com AES-256-GCM (mesma chave de lib/utils/encryption).
 */

import {
  initAuthCreds,
  BufferJSON,
  proto,
  type AuthenticationState,
  type AuthenticationCreds,
  type SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { encryptToken, decryptToken } from '@/lib/utils/encryption';

const COLLECTION = 'baileysAuthStates';

/**
 * Firestore não aceita '/' em document IDs e reserva '__' em alguns contextos.
 * Os ids dos signal keys do Baileys (ex: "session-5511...@s.whatsapp.net.0")
 * podem conter ambos. Sanitizamos com placeholders reversíveis.
 */
function sanitizeDocId(raw: string): string {
  return raw
    .replace(/\//g, '__SLASH__')
    .replace(/:/g, '__COLON__')
    // Firestore proíbe doc id começando com '__' — em tese o sanitize só insere
    // '__' no meio, mas defensivamente prefixamos um '_' se aparecer no início.
    .replace(/^__/, '_DUNDER_');
}

async function encryptAndStore(plaintext: string): Promise<string> {
  return encryptToken(plaintext);
}

async function decryptIfPresent(ciphertext: string | undefined | null): Promise<string | null> {
  if (!ciphertext) return null;
  try {
    return await decryptToken(ciphertext);
  } catch (err) {
    console.error('[FirestoreAuthState] Falha ao decifrar payload — ignorando:', err);
    return null;
  }
}

/**
 * Cria um AuthenticationState que persiste no Firestore.
 *
 * @param connectionId  ID único da conexão (mesmo usado como sessionKey no
 *                      baileys-manager). Tipicamente vindo de
 *                      ensurePrimaryBaileysBusinessConnection().
 */
export async function useFirestoreAuthState(connectionId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const stateRef = adminDb.collection(COLLECTION).doc(connectionId);
  const keysRef = stateRef.collection('keys');

  // Carrega creds existentes ou inicializa novas (primeiro pareamento).
  const credsDoc = await stateRef.get();
  const credsCipher = credsDoc.exists ? (credsDoc.data()?.creds as string | undefined) : undefined;
  const credsPlain = await decryptIfPresent(credsCipher);
  const creds: AuthenticationCreds = credsPlain
    ? JSON.parse(credsPlain, BufferJSON.reviver)
    : initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              const docId = sanitizeDocId(`${type}-${id}`);
              try {
                const snap = await keysRef.doc(docId).get();
                if (!snap.exists) {
                  // Baileys espera undefined/null pra keys ausentes — não inserir no result.
                  return;
                }
                const cipher = snap.data()?.value as string | undefined;
                const plain = await decryptIfPresent(cipher);
                if (!plain) return;
                let value = JSON.parse(plain, BufferJSON.reviver);
                if (type === 'app-state-sync-key' && value) {
                  // Mesmo hack que useMultiFileAuthState faz pra reconstruir
                  // o protobuf message a partir do objeto serializado.
                  value = proto.Message.AppStateSyncKeyData.fromObject(value);
                }
                result[id] = value;
              } catch (err) {
                console.error(`[FirestoreAuthState] Erro lendo key ${type}-${id}:`, err);
              }
            }),
          );
          return result;
        },
        set: async (data) => {
          const tasks: Promise<unknown>[] = [];
          for (const category in data) {
            const entries = (data as Record<string, Record<string, unknown>>)[category];
            for (const id in entries) {
              const value = entries[id];
              const docId = sanitizeDocId(`${category}-${id}`);
              const docRef = keysRef.doc(docId);
              if (value) {
                const serialized = JSON.stringify(value, BufferJSON.replacer);
                tasks.push(
                  encryptAndStore(serialized).then((cipher) =>
                    docRef.set({
                      value: cipher,
                      updatedAt: new Date().toISOString(),
                    }),
                  ),
                );
              } else {
                // Baileys passa null/undefined pra deletar (ex: rotação de pre-keys)
                tasks.push(docRef.delete().catch(() => { /* doc inexistente é ok */ }));
              }
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    /**
     * Persiste creds atualizadas. Baileys chama isso após cada `creds.update`.
     * As creds são mutadas em memória pelo socket; aqui serializamos o estado
     * atual pra Firestore (cifrado).
     */
    saveCreds: async () => {
      const serialized = JSON.stringify(creds, BufferJSON.replacer);
      const cipher = await encryptAndStore(serialized);
      await stateRef.set(
        {
          creds: cipher,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    },
  };
}

/**
 * Verifica se há credenciais persistidas para a conexão. Usado pelo
 * instrumentation hook pra decidir se deve restaurar a sessão no boot.
 */
export async function hasFirestoreAuthState(connectionId: string): Promise<boolean> {
  const stateRef = adminDb.collection(COLLECTION).doc(connectionId);
  const snap = await stateRef.get();
  return snap.exists && !!snap.data()?.creds;
}

/**
 * Apaga todo o estado persistido para uma conexão (creds + keys subcollection).
 * Usado quando o usuário desconecta voluntariamente ou faz logout.
 */
export async function deleteFirestoreAuthState(connectionId: string): Promise<void> {
  const stateRef = adminDb.collection(COLLECTION).doc(connectionId);
  const keysRef = stateRef.collection('keys');

  // Deleta subcoleção de keys em batches de 400 (limite do batch é 500, deixa folga).
  // Loop até esvaziar — uma sessão pode ter centenas de signal keys acumuladas.
  while (true) {
    const snap = await keysRef.limit(400).get();
    if (snap.empty) break;
    const batch = adminDb.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 400) break;
  }

  // Deleta o doc principal de creds. catch defensivo — se já não existir, ok.
  await stateRef.delete().catch(() => { /* ignore */ });
}
