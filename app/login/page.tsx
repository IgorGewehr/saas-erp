'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { Mail, Lock, User, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type AuthMode = 'login' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signUp, signInWithGoogle, isLoading } = useAuth();

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Preencha todos os campos obrigatórios.');
      return;
    }

    if (mode === 'signup' && !name) {
      setError('Informe seu nome.');
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        await signUp(email, password, name);
      }
      router.push('/app');
    } catch (err: unknown) {
      const firebaseError = err as { code?: string; message?: string };
      const errorMessages: Record<string, string> = {
        'auth/user-not-found': 'Usuário não encontrado.',
        'auth/wrong-password': 'Senha incorreta.',
        'auth/invalid-credential': 'Credenciais inválidas.',
        'auth/email-already-in-use': 'Este e-mail já está em uso.',
        'auth/weak-password': 'A senha é muito fraca.',
        'auth/invalid-email': 'E-mail inválido.',
        'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
      };
      setError(
        errorMessages[firebaseError.code || ''] ||
          firebaseError.message ||
          'Ocorreu um erro. Tente novamente.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
      router.push('/app');
    } catch (err: unknown) {
      const firebaseError = err as { message?: string };
      setError(firebaseError.message || 'Erro ao entrar com Google.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'signup' : 'login');
    setError('');
  };

  const busy = isSubmitting || isLoading;

  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-red-50 via-white to-red-100" />
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-1/2 -left-1/2 w-full h-full rounded-full opacity-20"
          style={{
            background: 'radial-gradient(circle, #DC2626 0%, transparent 70%)',
          }}
          animate={{
            x: [0, 100, 50, 0],
            y: [0, 50, 100, 0],
            scale: [1, 1.2, 1.1, 1],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.div
          className="absolute -bottom-1/2 -right-1/2 w-full h-full rounded-full opacity-15"
          style={{
            background: 'radial-gradient(circle, #EF4444 0%, transparent 70%)',
          }}
          animate={{
            x: [0, -80, -40, 0],
            y: [0, -60, -80, 0],
            scale: [1, 1.3, 1.15, 1],
          }}
          transition={{
            duration: 25,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.div
          className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full opacity-10"
          style={{
            background: 'radial-gradient(circle, #F87171 0%, transparent 70%)',
          }}
          animate={{
            x: [0, -40, 20, 0],
            y: [0, 30, -20, 0],
            scale: [1, 1.1, 0.95, 1],
          }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </div>

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0,0,0,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Login card */}
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        <div
          className={cn(
            'rounded-2xl border border-white/40',
            'bg-white/70 backdrop-blur-xl',
            'shadow-[0_8px_60px_-12px_rgba(220,38,38,0.15)]',
            'p-8 sm:p-10'
          )}
        >
          {/* Logo and heading */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="text-center mb-8"
          >
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 shadow-lg shadow-red-500/25 mb-4">
              <span className="text-white font-bold text-2xl font-display">S</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 font-display">
              {mode === 'login' ? 'Bem-vindo de volta' : 'Crie sua conta'}
            </h1>
            <p className="text-gray-500 mt-1.5 text-sm">
              {mode === 'login'
                ? 'Entre para gerenciar seu negócio'
                : 'Comece a gerenciar seu negócio agora'}
            </p>
          </motion.div>

          {/* Google sign-in */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={busy}
              className={cn(
                'w-full flex items-center justify-center gap-3 px-4 py-3',
                'rounded-xl border border-gray-200 bg-white',
                'text-sm font-medium text-gray-700',
                'hover:bg-gray-50 hover:border-gray-300',
                'transition-all duration-200',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300'
              )}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                  fill="#4285F4"
                />
                <path
                  d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
                  fill="#34A853"
                />
                <path
                  d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                  fill="#FBBC05"
                />
                <path
                  d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
                  fill="#EA4335"
                />
              </svg>
              Continuar com Google
            </button>
          </motion.div>

          {/* Divider */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.5 }}
            className="flex items-center gap-3 my-6"
          >
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">ou</span>
            <div className="flex-1 h-px bg-gray-200" />
          </motion.div>

          {/* Form */}
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {mode === 'signup' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Seu nome completo"
                      className={cn(
                        'w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200',
                        'bg-white text-gray-900 text-sm placeholder:text-gray-400',
                        'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300',
                        'transition-all duration-200'
                      )}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">E-mail</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  autoComplete="email"
                  className={cn(
                    'w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200',
                    'bg-white text-gray-900 text-sm placeholder:text-gray-400',
                    'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300',
                    'transition-all duration-200'
                  )}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'login' ? 'Sua senha' : 'Mínimo 6 caracteres'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className={cn(
                    'w-full pl-11 pr-11 py-3 rounded-xl border border-gray-200',
                    'bg-white text-gray-900 text-sm placeholder:text-gray-400',
                    'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300',
                    'transition-all duration-200'
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                </button>
              </div>
            </div>

            {mode === 'login' && (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="text-xs text-red-600 hover:text-red-700 font-medium transition-colors"
                >
                  Esqueceu a senha?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className={cn(
                'w-full flex items-center justify-center gap-2 px-4 py-3',
                'rounded-xl bg-gradient-to-r from-red-600 to-red-500',
                'text-white text-sm font-semibold',
                'hover:from-red-700 hover:to-red-600',
                'shadow-lg shadow-red-500/25',
                'transition-all duration-200',
                'disabled:opacity-60 disabled:cursor-not-allowed',
                'focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:ring-offset-2'
              )}
            >
              {busy ? (
                <Loader2 className="w-4.5 h-4.5 animate-spin" />
              ) : (
                <>
                  {mode === 'login' ? 'Entrar' : 'Criar conta'}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </motion.form>

          {/* Toggle mode */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="mt-6 text-center"
          >
            <p className="text-sm text-gray-500">
              {mode === 'login' ? 'Não tem uma conta?' : 'Já tem uma conta?'}{' '}
              <button
                type="button"
                onClick={toggleMode}
                className="text-red-600 hover:text-red-700 font-semibold transition-colors"
              >
                {mode === 'login' ? 'Crie agora' : 'Faça login'}
              </button>
            </p>
          </motion.div>
        </div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="text-center text-xs text-gray-400 mt-6"
        >
          ServicePro &copy; {new Date().getFullYear()} &mdash; Gestão inteligente para seu negócio
        </motion.p>
      </motion.div>
    </div>
  );
}
