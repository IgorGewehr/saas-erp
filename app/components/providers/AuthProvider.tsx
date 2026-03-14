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
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/config/firebase';
import type { User, Business } from '@/lib/types';

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  business: Business | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updateUserProfile: (data: Partial<User>) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export default function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUserData = useCallback(async (fbUser: FirebaseUser) => {
    try {
      const userDoc = await getDoc(doc(db, 'users', fbUser.uid));
      if (userDoc.exists()) {
        const userData = { ...userDoc.data(), id: userDoc.id } as User;
        setUser(userData);

        // Fetch business data
        if (userData.businessId) {
          const businessDoc = await getDoc(doc(db, 'businesses', userData.businessId));
          if (businessDoc.exists()) {
            setBusiness({ ...businessDoc.data(), id: businessDoc.id } as Business);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        await fetchUserData(fbUser);
      } else {
        setUser(null);
        setBusiness(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [fetchUserData]);

  const signIn = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (email: string, password: string, name: string) => {
    setIsLoading(true);
    try {
      const { user: fbUser } = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(fbUser, { displayName: name });

      // Create business
      const businessRef = doc(db, 'businesses', fbUser.uid + '_biz');
      await setDoc(businessRef, {
        razaoSocial: name,
        nomeFantasia: name,
        cnpj: '',
        crt: '1',
        endereco: {
          logradouro: '', numero: '', bairro: '', municipio: '',
          codigoMunicipio: '', uf: '', cep: '',
        },
        phone: '',
        email: email,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Create user profile
      await setDoc(doc(db, 'users', fbUser.uid), {
        uid: fbUser.uid,
        email,
        name,
        role: 'admin',
        businessId: businessRef.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setIsLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const { user: fbUser } = await signInWithPopup(auth, provider);

      // Check if user profile exists
      const userDoc = await getDoc(doc(db, 'users', fbUser.uid));
      if (!userDoc.exists()) {
        const businessRef = doc(db, 'businesses', fbUser.uid + '_biz');
        await setDoc(businessRef, {
          razaoSocial: fbUser.displayName || 'Meu Negócio',
          nomeFantasia: fbUser.displayName || 'Meu Negócio',
          cnpj: '',
          crt: '1',
          endereco: {
            logradouro: '', numero: '', bairro: '', municipio: '',
            codigoMunicipio: '', uf: '', cep: '',
          },
          phone: '',
          email: fbUser.email || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        await setDoc(doc(db, 'users', fbUser.uid), {
          uid: fbUser.uid,
          email: fbUser.email,
          name: fbUser.displayName || 'Usuário',
          photoURL: fbUser.photoURL,
          role: 'admin',
          businessId: businessRef.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setBusiness(null);
  };

  const updateUserProfile = async (data: Partial<User>) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
    setUser({ ...user, ...data });
  };

  const refreshUser = async () => {
    if (firebaseUser) {
      await fetchUserData(firebaseUser);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        firebaseUser,
        business,
        isLoading,
        isAuthenticated: !!user,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        updateUserProfile,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
