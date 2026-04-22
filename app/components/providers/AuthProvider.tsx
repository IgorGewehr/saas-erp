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

        // ── Mark code as used (one-time) ─────────────────────────────────────
        await updateDoc(doc(db, 'inviteCodes', code), {
          isActive: false,
          usedBy: fbUser.uid,
          usedByName: name,
          usedAt: now,
        });

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
          createdAt: now,
          updatedAt: now,
        });

        await setDoc(doc(db, 'users', fbUser.uid), {
          uid: fbUser.uid,
          email,
          name,
          role: 'admin',
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
        createdAt: now,
        updatedAt: now,
      });

      await setDoc(doc(db, 'users', fbUser.uid), {
        uid: fbUser.uid,
        email: fbUser.email,
        name: fbUser.displayName || 'Usuário',
        photoURL: fbUser.photoURL,
        role: 'admin',
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
      user, firebaseUser, business, sectors, userSectorIds, isLoading,
      isAuthenticated: !!user,
      signIn, signUp, signInWithGoogle, signOut, updateUserProfile, refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
