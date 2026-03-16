'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  signInWithPopup,
  User as FirebaseUser,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { auth, db } from '@/lib/config/firebase';
import type { User, Business } from '@/lib/types';

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  business: Business | null;
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
  const [isLoading, setIsLoading]     = useState(true);

  // ── Fetch user + business data from Firestore ──────────────────────────────
  const fetchUserData = useCallback(async (fbUser: FirebaseUser) => {
    try {
      const userSnap = await getDoc(doc(db, 'users', fbUser.uid));
      if (userSnap.exists()) {
        const userData = { ...userSnap.data(), id: userSnap.id } as User;
        setUser(userData);
        if (userData.businessId) {
          const bizSnap = await getDoc(doc(db, 'businesses', userData.businessId));
          if (bizSnap.exists()) {
            setBusiness({ ...bizSnap.data(), id: bizSnap.id } as Business);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching user data:', err);
    }
  }, []);

  // ── Auth state observer ────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        await fetchUserData(fbUser);
        // Mark online + record login time
        setDoc(doc(db, 'users', fbUser.uid), {
          isOnline: true,
          lastLoginAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
        }, { merge: true }).catch(() => {});
      } else {
        setUser(null);
        setBusiness(null);
      }
      setIsLoading(false);
    });
    return () => unsub();
  }, [fetchUserData]);

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
    setIsLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } finally {
      setIsLoading(false);
    }
  };

  // ── signUp (two modes: new business OR join via invite code) ───────────────
  const signUp = async (email: string, password: string, name: string, inviteCode?: string) => {
    setIsLoading(true);
    try {
      const now = new Date().toISOString();

      if (inviteCode) {
        // ── Validate invite code ────────────────────────────────────────────
        const code = inviteCode.trim().toUpperCase();
        const codeSnap = await getDoc(doc(db, 'inviteCodes', code));

        if (!codeSnap.exists() || !codeSnap.data().isActive) {
          throw { code: 'invite/invalid-code' };
        }
        const codeData = codeSnap.data();
        if (new Date(codeData.expiresAt) < new Date()) {
          throw { code: 'invite/code-expired' };
        }

        // ── Create auth user ────────────────────────────────────────────────
        const { user: fbUser } = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(fbUser, { displayName: name });

        // ── Create user profile linked to existing business ─────────────────
        await setDoc(doc(db, 'users', fbUser.uid), {
          uid: fbUser.uid,
          email,
          name,
          role: codeData.role,
          businessId: codeData.businessId,
          invitedBy: codeData.createdBy,
          isActive: true,
          isOnline: true,
          lastLoginAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        });

        // ── Add to business memberIds ────────────────────────────────────────
        await setDoc(doc(db, 'businesses', codeData.businessId), {
          memberIds: arrayUnion(fbUser.uid),
        }, { merge: true });

        // ── Mark code as used (one-time) ─────────────────────────────────────
        await updateDoc(doc(db, 'inviteCodes', code), {
          isActive: false,
          usedBy: fbUser.uid,
          usedByName: name,
          usedAt: now,
        });

        // Ensure state is hydrated after all writes
        await fetchUserData(fbUser);

      } else {
        // ── Create new business (default flow) ──────────────────────────────
        const { user: fbUser } = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(fbUser, { displayName: name });

        const businessRef = doc(db, 'businesses', fbUser.uid + '_biz');
        await setDoc(businessRef, {
          razaoSocial: name,
          nomeFantasia: name,
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

        await fetchUserData(fbUser);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ── signInWithGoogle ───────────────────────────────────────────────────────
  const signInWithGoogle = async () => {
    setIsLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const { user: fbUser } = await signInWithPopup(auth, provider);
      const now = new Date().toISOString();

      const userSnap = await getDoc(doc(db, 'users', fbUser.uid));
      if (!userSnap.exists()) {
        const businessRef = doc(db, 'businesses', fbUser.uid + '_biz');
        await setDoc(businessRef, {
          razaoSocial: fbUser.displayName || 'Meu Negócio',
          nomeFantasia: fbUser.displayName || 'Meu Negócio',
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

      await fetchUserData(fbUser);
    } finally {
      setIsLoading(false);
    }
  };

  // ── signOut ────────────────────────────────────────────────────────────────
  const signOut = async () => {
    if (firebaseUser) {
      await setPresence(firebaseUser.uid, false);
    }
    await firebaseSignOut(auth);
    setUser(null);
    setBusiness(null);
  };

  // ── updateUserProfile ──────────────────────────────────────────────────────
  const updateUserProfile = async (data: Partial<User>) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
    setUser({ ...user, ...data });
  };

  // ── refreshUser ────────────────────────────────────────────────────────────
  const refreshUser = async () => {
    if (firebaseUser) await fetchUserData(firebaseUser);
  };

  return (
    <AuthContext.Provider value={{
      user, firebaseUser, business, isLoading,
      isAuthenticated: !!user,
      signIn, signUp, signInWithGoogle, signOut, updateUserProfile, refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
