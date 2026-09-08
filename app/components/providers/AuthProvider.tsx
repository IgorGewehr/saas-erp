'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  deleteUser,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  signInWithPopup,
  User as FirebaseUser,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, arrayUnion, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '@/lib/config/firebase';
import type { User, Business, Sector } from '@/lib/types';
import { DEFAULT_USE_CASE } from '@/lib/types';
import i18n from '@/lib/i18n/i18n';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  business: Business | null;
  sectors: Sector[];
  userSectorIds: string[];
  isLoading: boolean;
  // true as soon as onAuthStateChanged fires (Firebase Auth cache ~100ms).
  // Use this — not isLoading — to decide when to show the app shell.
  isAuthReady: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string, inviteCode?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updateUserProfile: (data: Partial<User>) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

// ─── Presence helpers (fire-and-forget, no await needed) ──────────────────────
async function setPresence(uid: string, online: boolean) {
  try {
    await setDoc(doc(db, 'users', uid), {
      isOnline: online,
      lastSeenAt: new Date().toISOString(),
    }, { merge: true });
  } catch {
    // Silently fail — presence is best-effort
  }
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]               = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [business, setBusiness]       = useState<Business | null>(null);
  const [sectors, setSectors]         = useState<Sector[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  // Becomes true as soon as onAuthStateChanged fires (whether logged in or not).
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Derived: sector IDs the current user belongs to
  const userSectorIds = React.useMemo(() => {
    if (!user) return [];
    // Check user.sectorIds first, then fall back to scanning sectors
    if (user.sectorIds?.length) return user.sectorIds;
    return sectors.filter(s => s.memberIds.includes(user.uid)).map(s => s.id);
  }, [user, sectors]);

  // ── Real-time user + business listeners ──────────────────────────────────────
  // Uses onSnapshot so role/name/status changes made by an admin are reflected
  // immediately across all open sessions without requiring a logout/login.
  useEffect(() => {
    let unsubUser: (() => void) | null = null;
    let unsubBiz: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      // Tear down previous listeners whenever auth state changes
      unsubUser?.();
      unsubBiz?.();
      unsubUser = null;
      unsubBiz = null;

      setFirebaseUser(fbUser);
      // Auth state is now known — unblock the app shell regardless of Firestore load state.
      setIsAuthReady(true);

      if (!fbUser) {
        setUser(null);
        setBusiness(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      // Mark online on login
      setDoc(doc(db, 'users', fbUser.uid), {
        isOnline: true,
        lastLoginAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      }, { merge: true }).catch(() => {});

      // Listen to user doc — reacts to role changes, name edits, status updates
      unsubUser = onSnapshot(
        doc(db, 'users', fbUser.uid),
        (snap) => {
          if (!snap.exists()) { setIsLoading(false); return; }
          const userData = { ...snap.data(), id: snap.id } as User;
          setUser(userData);
          setIsLoading(false);
          if (userData.language && i18n.language !== userData.language) {
            i18n.changeLanguage(userData.language);
          }

          if (userData.businessId) {
            // Listen to business doc — reacts to plan/enterprise/settings changes
            unsubBiz?.();
            unsubBiz = onSnapshot(
              doc(db, 'businesses', userData.businessId),
              (bizSnap) => {
                if (bizSnap.exists()) {
                  setBusiness({ ...bizSnap.data(), id: bizSnap.id } as Business);
                }
              },
              () => { /* ignore permission errors on business doc */ },
            );

            // Sectors are less volatile — one-time fetch is fine
            const sectorsQuery = query(
              collection(db, 'sectors'),
              where('businessId', '==', userData.businessId),
              where('isActive', '==', true),
            );
            getDocs(sectorsQuery)
              .then((snap) => setSectors(snap.docs.map(d => ({ ...d.data(), id: d.id } as Sector))))
              .catch(() => {});
          }
        },
        (err) => {
          console.error('Error listening to user doc:', err);
          setIsLoading(false);
        },
      );
    });

    return () => {
      unsubAuth();
      unsubUser?.();
      unsubBiz?.();
    };
  }, []);

  // ── Online presence: heartbeat + visibility ────────────────────────────────
  useEffect(() => {
    if (!firebaseUser) return;
    const uid = firebaseUser.uid;

    // Heartbeat every 60 s
    const heartbeat = setInterval(() => setPresence(uid, true), 60_000);

    // Tab visibility changes
    const onVisibility = () => setPresence(uid, document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);

    // Before tab close (best-effort)
    const onUnload = () => setPresence(uid, false);
    window.addEventListener('beforeunload', onUnload);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [firebaseUser]);

  // ── signIn ─────────────────────────────────────────────────────────────────
  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    // isLoading is managed by onAuthStateChanged — don't reset it here
  };

  // ── signUp (two modes: new business OR join via invite code) ───────────────
  const signUp = async (email: string, password: string, name: string, inviteCode?: string) => {
    setIsLoading(true);
    try {
      const now = new Date().toISOString();

      if (inviteCode) {
        const code = inviteCode.trim().toUpperCase();

        // ── Create auth user FIRST so subsequent Firestore reads are authenticated
        const { user: fbUser } = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(fbUser, { displayName: name });

        let codeData: Record<string, unknown>;
        try {
          // ── Validate invite code (now authenticated) ────────────────────────
          const codeSnap = await getDoc(doc(db, 'inviteCodes', code));
          if (!codeSnap.exists() || !codeSnap.data().isActive) {
            await deleteUser(fbUser);
            throw { code: 'invite/invalid-code' };
          }
          codeData = codeSnap.data() as Record<string, unknown>;
          if (new Date(codeData.expiresAt as string) < new Date()) {
            await deleteUser(fbUser);
            throw { code: 'invite/code-expired' };
          }

          // M09 Gap 2: reivindica o código ATOMICAMENTE aqui, ANTES de conceder
          // qualquer acesso ao negócio — antes desta correção, a marcação
          // `isActive:false` vinha por ÚLTIMO (depois de criar o perfil e
          // adicionar aos memberIds), então dois signups concorrentes com o
          // MESMO código podiam ambos passar pela leitura acima (ambos veem
          // isActive:true) e ambos completarem o fluxo inteiro antes de
          // qualquer um marcar o código usado. A regra do Firestore
          // (`inviteCodes` allow update) já faz compare-and-swap real —
          // `resource.data.isActive == true` é avaliado contra o COMMIT mais
          // recente no momento da escrita, não contra a leitura stale acima —
          // então mover a marcação pra cá faz o segundo signup receber
          // permission-denied ANTES de ganhar qualquer acesso real, em vez de
          // depois.
          try {
            await updateDoc(doc(db, 'inviteCodes', code), {
              isActive: false,
              usedBy: fbUser.uid,
              usedByName: name,
              usedAt: now,
            });
          } catch {
            await deleteUser(fbUser);
            throw { code: 'invite/invalid-code' };
          }
        } catch (err) {
          // Re-throw validation errors; other errors also abort
          throw err;
        }

        // ── Create user profile linked to existing business ─────────────────
        const sectorId = codeData.sectorId as string | undefined;
        await setDoc(doc(db, 'users', fbUser.uid), {
          uid: fbUser.uid,
          email,
          name,
          role: codeData.role,
          businessId: codeData.businessId,
          invitedBy: codeData.createdBy,
          // M09 (achado residual fechado): prova pra firestore.rules de que
          // este create de role≠founder veio de um convite de verdade — a
          // regra faz get() neste código e confere businessId/role/usedBy
          // antes de aceitar o create. Sem isso, qualquer role≠founder era
          // aceita se o `businessId` fosse conhecido/adivinhado, sem convite
          // real (achado documentado desde M09.1, deixado aberto até agora).
          redeemedInviteCode: code,
          ...(sectorId ? { sectorIds: [sectorId] } : {}),
          isActive: true,
          isOnline: true,
          lastLoginAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        });

        // ── Add to business memberIds ────────────────────────────────────────
        await setDoc(doc(db, 'businesses', codeData.businessId as string), {
          memberIds: arrayUnion(fbUser.uid),
        }, { merge: true });

        // ── Add to sector memberIds if sectorId was set on the invite ────────
        if (sectorId) {
          await updateDoc(doc(db, 'sectors', sectorId), {
            memberIds: arrayUnion(fbUser.uid),
            updatedAt: now,
          }).catch(() => { /* sector may have been deleted — non-fatal */ });
        }

        // Código já foi marcado como usado atomicamente acima, antes de
        // qualquer acesso ser concedido — ver comentário no bloco de validação.

        // onSnapshot listener reacts to the writes above automatically

      } else {
        // ── Create new business (default flow) ──────────────────────────────
        const { user: fbUser } = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(fbUser, { displayName: name });

        const businessRef = doc(db, 'businesses', fbUser.uid + '_biz');
        await setDoc(businessRef, {
          razaoSocial: name,
          nomeFantasia: name,
          slug: generateSlug(name),
          cnpj: '',
          crt: '1',
          ownerUserId: fbUser.uid,
          memberIds: [fbUser.uid],
          endereco: { logradouro: '', numero: '', bairro: '', municipio: '', codigoMunicipio: '', uf: '', cep: '' },
          phone: '',
          email,
          isActive: true,
          // M12.4: antes, `settings.useCase` nunca era setado no signup — 4 call sites
          // (Sidebar/SettingsModule) faziam fallback independente pro mesmo default.
          // Setar aqui explicitamente centraliza o default, sem mudar comportamento
          // observável (era isso que os fallbacks já produziam).
          settings: { useCase: DEFAULT_USE_CASE },
          createdAt: now,
          updatedAt: now,
        });

        // M09.2: dono de um negócio novo agora nasce 'founder' (não 'admin')
        // — decisão do usuário após a investigação encontrar que nenhum
        // fluxo de signup jamais criava um founder real, deixando ações
        // exclusivas de founder (remover membro, apagar negócio, purgar
        // auditoria) inacessíveis pro dono de verdade sem promoção manual
        // via Console do Firebase. `firestore.rules` (users/{userId} create)
        // já foi ajustada pra permitir isso só quando o business referenciado
        // tem ownerUserId == o próprio criador (verificado via get()).
        await setDoc(doc(db, 'users', fbUser.uid), {
          uid: fbUser.uid,
          email,
          name,
          role: 'founder',
          businessId: businessRef.id,
          isActive: true,
          isOnline: true,
          lastLoginAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        });

        // onSnapshot listener reacts to the writes above automatically
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ── signInWithGoogle ───────────────────────────────────────────────────────
  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    const { user: fbUser } = await signInWithPopup(auth, provider);
    const now = new Date().toISOString();

    const userSnap = await getDoc(doc(db, 'users', fbUser.uid));
    if (!userSnap.exists()) {
      const businessRef = doc(db, 'businesses', fbUser.uid + '_biz');
      await setDoc(businessRef, {
        razaoSocial: fbUser.displayName || 'Meu Negócio',
        nomeFantasia: fbUser.displayName || 'Meu Negócio',
        slug: generateSlug(fbUser.displayName || 'meu-negocio'),
        cnpj: '',
        crt: '1',
        ownerUserId: fbUser.uid,
        memberIds: [fbUser.uid],
        endereco: { logradouro: '', numero: '', bairro: '', municipio: '', codigoMunicipio: '', uf: '', cep: '' },
        phone: '',
        email: fbUser.email || '',
        isActive: true,
        // M12.4: mesmo racional do fluxo email/senha acima.
        settings: { useCase: DEFAULT_USE_CASE },
        createdAt: now,
        updatedAt: now,
      });

      // M09.2: mesmo racional do fluxo email/senha acima — dono de negócio
      // novo nasce 'founder'.
      await setDoc(doc(db, 'users', fbUser.uid), {
        uid: fbUser.uid,
        email: fbUser.email,
        name: fbUser.displayName || 'Usuário',
        photoURL: fbUser.photoURL,
        role: 'founder',
        businessId: businessRef.id,
        isActive: true,
        isOnline: true,
        lastLoginAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    // onAuthStateChanged will fire and handle fetchUserData + isLoading
  };

  // ── signOut ────────────────────────────────────────────────────────────────
  const signOut = async () => {
    if (firebaseUser) {
      await setPresence(firebaseUser.uid, false);
    }
    await firebaseSignOut(auth);
    setUser(null);
    setBusiness(null);
    setSectors([]);
  };

  // ── updateUserProfile ──────────────────────────────────────────────────────
  const updateUserProfile = async (data: Partial<User>) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
    setUser({ ...user, ...data });
  };

  // ── refreshUser ────────────────────────────────────────────────────────────
  // onSnapshot keeps user data live — this is a no-op kept for API compatibility
  const refreshUser = async () => {};

  return (
    <AuthContext.Provider value={{
      user, firebaseUser, business, sectors, userSectorIds, isLoading, isAuthReady,
      isAuthenticated: !!user,
      signIn, signUp, signInWithGoogle, signOut, updateUserProfile, refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
