'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/config/firebase';
import { Mail, Lock, User, Eye, EyeOff, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

type AuthMode = 'login' | 'signup';

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { signIn, signUp, signInWithGoogle, isAuthenticated, isLoading } = useAuth();

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState('');
  // Invite code
  const [useInviteCode, setUseInviteCode] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/app');
    }
  }, [isAuthenticated, isLoading, router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError(t('login.fillAllFields')); return; }
    if (mode === 'signup' && !name) { setError(t('login.enterName')); return; }
    if (password.length < 6) { setError(t('login.passwordMinLength')); return; }

    if (mode === 'signup' && useInviteCode && inviteCode.trim().length !== 6) {
      setError(t('login.inviteCodeLength'));
      return;
    }
    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        await signUp(email, password, name, useInviteCode ? inviteCode.trim().toUpperCase() : undefined);
      }
      // redirect is handled by the useEffect watching isAuthenticated
    } catch (err: unknown) {
      const fe = err as { code?: string; message?: string };
      const msgs: Record<string, string> = {
        'auth/user-not-found': t('login.errors.userNotFound'),
        'auth/wrong-password': t('login.errors.wrongPassword'),
        'auth/invalid-credential': t('login.errors.invalidCredential'),
        'auth/invalid-login-credentials': t('login.errors.invalidCredential'),
        'auth/email-already-in-use': t('login.errors.emailInUse'),
        'auth/weak-password': t('login.errors.weakPassword'),
        'auth/invalid-email': t('login.errors.invalidEmail'),
        'auth/too-many-requests': t('login.errors.tooManyRequests'),
        'auth/network-request-failed': t('login.errors.networkFailed'),
        'auth/operation-not-allowed': t('login.errors.operationNotAllowed'),
        'permission-denied': t('login.errors.permissionDenied'),
        'invite/invalid-code': t('login.errors.invalidInviteCode'),
        'invite/code-expired': t('login.errors.inviteCodeExpired'),
      };
      setError(msgs[fe.code || ''] || fe.message || t('login.errors.generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
      // redirect is handled by the useEffect watching isAuthenticated
    } catch (err: unknown) {
      const fe = err as { message?: string };
      setError(fe.message || t('login.errors.generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const busy = isSubmitting || isLoading;

  if (isLoading || isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-[#0B0F19]">
        <Loader2 className="w-8 h-8 animate-spin text-red-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">

      {/* ── LEFT PANEL (hidden on mobile) ── */}
      <div className="hidden lg:flex lg:w-[46%] xl:w-[52%] relative flex-col justify-between p-12 overflow-hidden bg-gradient-to-br from-red-700 via-red-600 to-rose-500">

        {/* Deep background orb */}
        <div className="absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute top-[-20%] left-[-10%] w-[700px] h-[700px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%)' }}
            animate={{ x: [0,40,20,0], y: [0,30,50,0], scale: [1,1.1,1.05,1] }}
            transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute bottom-[-30%] right-[-20%] w-[600px] h-[600px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.15) 0%, transparent 70%)' }}
            animate={{ x: [0,-40,-20,0], y: [0,-30,-60,0] }}
            transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.2) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
            }}
          />
        </div>

        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="relative z-10 flex items-center gap-3"
        >
          <img src="/logo-completa.png" alt="Aevo" className="h-12 object-contain" />
        </motion.div>

        {/* Hero text */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25 }}
          className="relative z-10"
        >
          <h2 className="text-4xl xl:text-5xl font-bold text-white font-display leading-[1.15] tracking-tight mb-5">
            {t('login.tagline')}<br />
            <span className="text-white/75">{t('login.taglineSub')}</span>
          </h2>
          <p className="text-white/65 text-base leading-relaxed max-w-sm mb-8">
            {t('login.taglineDesc')}
          </p>

          <div className="space-y-3">
            {(t('login.features', { returnObjects: true }) as string[]).map((feature, i) => (
              <motion.div
                key={feature}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.45 + i * 0.08, duration: 0.4 }}
                className="flex items-center gap-3"
              >
                <div className="w-5 h-5 rounded-full bg-white/15 border border-white/20 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-3 h-3 text-white" />
                </div>
                <span className="text-white/80 text-sm">{feature}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Bottom testimonial card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="relative z-10 bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/15"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-white/20 border border-white/20 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              M
            </div>
            <div>
              <p className="text-white/90 text-sm leading-relaxed italic">
                &quot;{t('login.testimonialText')}&quot;
              </p>
              <p className="text-white/50 text-xs mt-1.5 font-medium">{t('login.testimonialAuthor')}</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── RIGHT PANEL — Auth form ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 relative overflow-hidden bg-white dark:bg-[#0B0F19]">

        {/* Subtle background tint */}
        <div className="absolute inset-0 bg-gradient-to-br from-red-50/30 via-white to-gray-50/50 dark:from-red-950/10 dark:via-[#0B0F19] dark:to-gray-950/30" />
        <motion.div
          className="absolute top-0 right-0 w-96 h-96 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(220,38,38,0.04) 0%, transparent 70%)' }}
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 w-full max-w-[400px]"
        >
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center mb-8">
            <img src="/logo-completa.png" alt="Aevo" className="h-14 object-contain" />
          </div>

          {/* Heading */}
          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              className="mb-7"
            >
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 font-display tracking-tight">
                {mode === 'login' ? t('login.welcomeBack') : t('login.createFreeAccount')}
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mt-1.5 text-[14px]">
                {mode === 'login' ? t('login.loginSubtitle') : t('login.signupSubtitle')}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Google button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={busy}
            className={cn(
              'w-full flex items-center justify-center gap-3 px-4 py-[11px]',
              'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-white/[0.04]',
              'text-[14px] font-medium text-gray-700 dark:text-gray-300',
              'hover:bg-gray-50/80 dark:hover:bg-white/[0.06] hover:border-gray-300 dark:hover:border-gray-600',
              'active:scale-[0.99] transition-all duration-150',
              'shadow-sm shadow-gray-100 dark:shadow-none',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/30'
            )}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            {t('login.continueWithGoogle')}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
            <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 tracking-wider uppercase">{t('login.or')}</span>
            <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginBottom: 4 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-start gap-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 px-3.5 py-3 text-[13px] text-red-600 dark:text-red-400">
                    <span className="mt-0.5 flex-shrink-0">⚠️</span>
                    <span>{error}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Name field (signup only) */}
            <AnimatePresence>
              {mode === 'signup' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3.5">
                    <FormField
                      label={t('login.fullName')}
                      icon={User}
                      type="text"
                      value={name}
                      onChange={setName}
                      placeholder={t('login.fullNamePlaceholder')}
                      autoComplete="name"
                    />

                    {/* Invite code toggle */}
                    <div>
                      <button
                        type="button"
                        onClick={() => { setUseInviteCode(v => !v); setInviteCode(''); }}
                        className={cn(
                          'flex items-center gap-2 text-[13px] font-medium transition-colors duration-150',
                          useInviteCode
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                        )}
                      >
                        <div className={cn(
                          'w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-150',
                          useInviteCode
                            ? 'border-red-500 bg-red-500'
                            : 'border-gray-300 dark:border-gray-600'
                        )}>
                          {useInviteCode && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        {t('login.hasInviteCode')}
                      </button>

                      <AnimatePresence>
                        {useInviteCode && (
                          <motion.div
                            initial={{ opacity: 0, height: 0, marginTop: 0 }}
                            animate={{ opacity: 1, height: 'auto', marginTop: 10 }}
                            exit={{ opacity: 0, height: 0, marginTop: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div>
                              <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                {t('login.inviteCode')}
                              </label>
                              <input
                                type="text"
                                value={inviteCode}
                                onChange={(e) => setInviteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                                placeholder="AB3K9M"
                                maxLength={6}
                                className={cn(
                                  'w-full px-4 py-[10px] rounded-xl border border-gray-200 dark:border-gray-700',
                                  'bg-gray-50/50 dark:bg-white/[0.04] text-[18px] font-mono font-bold tracking-[0.3em] text-center',
                                  'text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600',
                                  'placeholder:tracking-[0.3em] placeholder:text-[18px]',
                                  'focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:bg-white dark:focus:bg-white/[0.06]',
                                  'focus:shadow-[0_0_0_3px_rgba(220,38,38,0.08)] transition-all duration-150',
                                  inviteCode.length === 6 && 'border-green-300 dark:border-green-600/50 bg-green-50/30 dark:bg-green-500/5'
                                )}
                              />
                              {inviteCode.length === 6 && (
                                <p className="text-[11px] text-green-600 dark:text-green-400 mt-1 flex items-center gap-1">
                                  <span className="w-3 h-3 rounded-full bg-green-500 inline-flex items-center justify-center">
                                    <svg width="7" height="5" viewBox="0 0 7 5" fill="none"><path d="M1 2.5L2.8 4L6 1" stroke="white" strokeWidth="1.2" strokeLinecap="round"/></svg>
                                  </span>
                                  {t('login.inviteCodeComplete')}
                                </p>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <FormField
              label={t('login.email')}
              icon={Mail}
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="seu@email.com"
              autoComplete="email"
            />

            {/* Password with show/hide */}
            <div>
              <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('login.password')}</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-gray-400 dark:text-gray-500 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'login' ? t('login.passwordPlaceholder') : t('login.passwordMinPlaceholder')}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className={cn(
                    'w-full pl-10 pr-11 py-[10px] rounded-xl border border-gray-200 dark:border-gray-700',
                    'bg-gray-50/50 dark:bg-white/[0.04] text-[14px] text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                    'focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:bg-white dark:focus:bg-white/[0.06] focus:shadow-[0_0_0_3px_rgba(220,38,38,0.08)] dark:focus:shadow-[0_0_0_3px_rgba(239,68,68,0.12)]',
                    'transition-all duration-150'
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded"
                >
                  {showPassword
                    ? <EyeOff className="w-[15px] h-[15px]" />
                    : <Eye className="w-[15px] h-[15px]" />}
                </button>
              </div>
            </div>

            {mode === 'login' && (
              <div className="flex justify-end">
                <button type="button" onClick={() => { setShowResetPassword(true); setResetEmail(email); setResetError(''); setResetSent(false); }} className="text-[12px] text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium transition-colors">
                  {t('login.forgotPassword')}
                </button>
              </div>
            )}

            {/* Submit */}
            <motion.button
              type="submit"
              disabled={busy}
              whileTap={{ scale: 0.99 }}
              className={cn(
                'relative w-full flex items-center justify-center gap-2 px-4 py-[11px] mt-1',
                'rounded-xl font-semibold text-[14px] text-white',
                'bg-gradient-to-r from-red-600 to-red-500',
                'hover:from-red-700 hover:to-red-600',
                'shadow-lg shadow-red-500/25',
                'transition-all duration-200 active:scale-[0.99]',
                'disabled:opacity-60 disabled:cursor-not-allowed',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0B0F19]',
                'overflow-hidden'
              )}
            >
              <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  {mode === 'login' ? t('login.signIn') : t('login.createFree')}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </motion.button>
          </form>

          {/* Toggle mode */}
          <p className="text-center text-[13px] text-gray-500 dark:text-gray-400 mt-5">
            {mode === 'login' ? t('login.noAccount') : t('login.haveAccount')}{' '}
            <button
              type="button"
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}
              className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-semibold transition-colors"
            >
              {mode === 'login' ? t('login.createNow') : t('login.signInNow')}
            </button>
          </p>

          {/* Footer */}
          <p className="text-center text-[11px] text-gray-400 dark:text-gray-500 mt-8">
            {t('login.terms')}{' '}
            <span className="text-gray-500 dark:text-gray-400 cursor-pointer hover:text-red-600 dark:hover:text-red-400 transition-colors">{t('login.termsLink')}</span>
            {' '}{t('login.and')}{' '}
            <span className="text-gray-500 dark:text-gray-400 cursor-pointer hover:text-red-600 dark:hover:text-red-400 transition-colors">{t('login.privacyLink')}</span>
          </p>
        </motion.div>
      </div>

      {/* Reset Password Modal */}
      <AnimatePresence>
        {showResetPassword && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
            onClick={() => setShowResetPassword(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-white dark:bg-[#111827] rounded-2xl shadow-2xl p-6 border border-transparent dark:border-gray-800/60"
            >
              {resetSent ? (
                <div className="text-center py-4">
                  <div className="w-12 h-12 rounded-full bg-green-50 dark:bg-green-500/10 flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 className="w-6 h-6 text-green-500 dark:text-green-400" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">{t('login.reset.emailSent')}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    {t('login.reset.emailSentDesc')}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(false)}
                    className="mt-5 w-full py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >
                    {t('login.reset.backToLogin')}
                  </button>
                </div>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">{t('login.reset.title')}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">
                    {t('login.reset.subtitle')}
                  </p>
                  {resetError && (
                    <div className="flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 px-3 py-2.5 text-[13px] text-red-600 dark:text-red-400 mb-3">
                      <span className="mt-0.5 flex-shrink-0">⚠️</span>
                      <span>{resetError}</span>
                    </div>
                  )}
                  <div className="relative mb-4">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-gray-400 dark:text-gray-500 pointer-events-none" />
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="seu@email.com"
                      autoComplete="email"
                      className={cn(
                        'w-full pl-10 pr-4 py-[10px] rounded-xl border border-gray-200 dark:border-gray-700',
                        'bg-gray-50/50 dark:bg-white/[0.04] text-[14px] text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                        'focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:bg-white dark:focus:bg-white/[0.06] focus:shadow-[0_0_0_3px_rgba(220,38,38,0.08)] dark:focus:shadow-[0_0_0_3px_rgba(239,68,68,0.12)]',
                        'transition-all duration-150'
                      )}
                    />
                  </div>
                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => setShowResetPassword(false)}
                      className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors"
                    >
                      {t('login.reset.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!resetEmail) { setResetError(t('login.reset.enterEmail')); return; }
                        try {
                          await sendPasswordResetEmail(auth, resetEmail);
                          setResetSent(true);
                        } catch (err: unknown) {
                          const fe = err as { code?: string };
                          const msgs: Record<string, string> = {
                            'auth/user-not-found': t('login.reset.errors.userNotFound'),
                            'auth/invalid-email': t('login.reset.errors.invalidEmail'),
                            'auth/too-many-requests': t('login.reset.errors.tooManyRequests'),
                          };
                          setResetError(msgs[fe.code || ''] || t('login.reset.errors.generic'));
                        }
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-sm font-semibold text-white hover:from-red-700 hover:to-red-600 shadow-lg shadow-red-500/25 transition-all duration-200"
                    >
                      {t('login.reset.sendLink')}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Reusable form field component
function FormField({
  label, icon: Icon, type, value, onChange, placeholder, autoComplete,
}: {
  label: string;
  icon: React.ElementType;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-gray-400 dark:text-gray-500 pointer-events-none" />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={cn(
            'w-full pl-10 pr-4 py-[10px] rounded-xl border border-gray-200 dark:border-gray-700',
            'bg-gray-50/50 dark:bg-white/[0.04] text-[14px] text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
            'focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:bg-white dark:focus:bg-white/[0.06] focus:shadow-[0_0_0_3px_rgba(220,38,38,0.08)] dark:focus:shadow-[0_0_0_3px_rgba(239,68,68,0.12)]',
            'transition-all duration-150'
          )}
        />
      </div>
    </div>
  );
}
