'use client';

/**
 * NotificationServerConfig — UI para configurar o SMTP do business para
 * envio de email via notification-server externo.
 *
 * Arquitetura: URL e API key do notification-server vivem em env vars
 * globais (NOTIFICATION_SERVER_URL + NOTIFICATION_SERVER_API_KEY) — esta UI
 * só gerencia as credenciais SMTP do business (cada cliente usa seu próprio
 * remetente: Gmail, Outlook, SendGrid, provedor próprio etc.).
 *
 * `pass` é criptografada server-side antes de gravar no Firestore.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getAuth } from 'firebase/auth';
import { toast } from 'react-toastify';
import { Mail, Check, X, Loader2, AlertTriangle, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NotificationServerConfig } from '@/lib/types';

interface Props {
  businessId: string;
  /** Config atual lida do business — pode ser undefined. */
  current?: NotificationServerConfig;
  onChange: () => void;
}

const PORT_OPTIONS = [
  { value: 587, label: '587 — STARTTLS (recomendado)' },
  { value: 465, label: '465 — SSL/TLS' },
  { value: 25,  label: '25 — sem TLS (não use em produção)' },
  { value: 2525, label: '2525 — alternativa (alguns providers)' },
];

export default function NotificationServerSection({ businessId, current, onChange }: Props) {
  const [host, setHost] = useState(current?.smtp?.host || '');
  const [port, setPort] = useState<number>(current?.smtp?.port || 587);
  const [secure, setSecure] = useState<boolean>(current?.smtp?.secure ?? false);
  const [user, setUser] = useState(current?.smtp?.user || '');
  const [pass, setPass] = useState('');
  const [from, setFrom] = useState(current?.smtp?.from || '');
  const [showPass, setShowPass] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [editing, setEditing] = useState(!current?.isConfigured);

  useEffect(() => {
    setHost(current?.smtp?.host || '');
    setPort(current?.smtp?.port || 587);
    setSecure(current?.smtp?.secure ?? false);
    setUser(current?.smtp?.user || '');
    setFrom(current?.smtp?.from || '');
    setEditing(!current?.isConfigured);
  }, [current?.smtp?.host, current?.smtp?.port, current?.smtp?.secure, current?.smtp?.user, current?.smtp?.from, current?.isConfigured]);

  const isConfigured = !!current?.isConfigured;
  const lastTestStatus = current?.lastTestStatus;

  const handleSave = async () => {
    if (!host.trim() || !user.trim() || !from.trim()) {
      toast.error('Host, usuário e remetente são obrigatórios');
      return;
    }
    if (!pass.trim() && !isConfigured) {
      toast.error('Senha SMTP é obrigatória na primeira configuração');
      return;
    }
    setSaving(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch('/api/channels/notification-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          businessId,
          smtp: {
            host: host.trim(),
            port,
            secure,
            user: user.trim(),
            // pass: vazia = mantém a anterior (UX comum em telas de credenciais)
            pass: pass.trim(),
            from: from.trim(),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('Configuração SMTP salva!');
      setPass(''); // limpa campo sensível
      setEditing(false);
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/channels/notification-server?businessId=${businessId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        toast.success(`Conexão OK (${data.detail || 'reachable'})`);
      } else {
        toast.error(`Falha: ${data.detail || data.error || 'Server não respondeu'}`);
      }
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao testar');
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Remover SMTP do business? Broadcasts de email serão bloqueados até reconfigurar.')) return;
    setDisconnecting(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/channels/notification-server?businessId=${businessId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('SMTP desconectado');
      setHost('');
      setUser('');
      setPass('');
      setFrom('');
      setEditing(true);
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao desconectar');
    } finally {
      setDisconnecting(false);
    }
  };

  const inputCls = 'w-full px-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400';

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-white dark:bg-[#111827] overflow-hidden">
      <div className="p-5 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center',
              isConfigured ? 'bg-gradient-to-br from-amber-500 to-orange-600' : 'bg-amber-500/10',
            )}>
              <Mail className={cn('w-5 h-5', isConfigured ? 'text-white' : 'text-amber-500')} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">SMTP de Email</h4>
                {isConfigured && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Check className="w-2.5 h-2.5" /> Configurado
                  </span>
                )}
                {lastTestStatus === 'failed' && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400">
                    <AlertTriangle className="w-2.5 h-2.5" /> Último teste falhou
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Credenciais SMTP usadas para enviar emails de campanhas e notificações.
                Cada empresa configura seu próprio remetente.
              </p>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {!editing && isConfigured ? (
          <motion.div key="status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase mb-1">Host</p>
                <p className="text-xs text-gray-700 dark:text-gray-300 font-mono truncate">{current?.smtp?.host}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase mb-1">Porta</p>
                <p className="text-xs text-gray-700 dark:text-gray-300 font-mono">
                  {current?.smtp?.port}{current?.smtp?.secure ? ' (SSL/TLS)' : ' (STARTTLS)'}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase mb-1">Usuário</p>
                <p className="text-xs text-gray-700 dark:text-gray-300 font-mono truncate">{current?.smtp?.user}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase mb-1">Remetente</p>
                <p className="text-xs text-gray-700 dark:text-gray-300 truncate">{current?.smtp?.from}</p>
              </div>
            </div>
            {current?.lastTestedAt && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                Último teste: {new Date(current.lastTestedAt).toLocaleString('pt-BR')} —{' '}
                <span className={lastTestStatus === 'ok' ? 'text-emerald-500' : 'text-red-500'}>
                  {lastTestStatus === 'ok' ? 'OK' : 'falhou'}
                </span>
                {current.lastTestDetail && <span className="text-gray-400"> ({current.lastTestDetail})</span>}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleTest}
                disabled={testing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors disabled:opacity-50">
                {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Testar conexão
              </button>
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors">
                Editar
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50 ml-auto">
                {disconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                Desconectar
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ns-host" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Servidor SMTP *</label>
                <input
                  id="ns-host"
                  type="text"
                  placeholder="smtp.gmail.com"
                  value={host}
                  onChange={e => setHost(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="ns-port" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Porta *</label>
                <select
                  id="ns-port"
                  value={port}
                  onChange={e => {
                    const newPort = Number(e.target.value);
                    setPort(newPort);
                    // Auto-toggle SSL/TLS based on port (UX hint, user pode override)
                    setSecure(newPort === 465);
                  }}
                  className={inputCls}>
                  {PORT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="ns-user" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Usuário (login SMTP) *</label>
              <input
                id="ns-user"
                type="email"
                placeholder="contato@suaempresa.com"
                value={user}
                onChange={e => setUser(e.target.value)}
                className={inputCls}
                autoComplete="username"
              />
            </div>
            <div>
              <label htmlFor="ns-pass" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">
                Senha SMTP * <span className="font-normal text-gray-400">(App Password no Gmail)</span>
              </label>
              <div className="relative">
                <input
                  id="ns-pass"
                  type={showPass ? 'text' : 'password'}
                  placeholder={isConfigured ? 'Deixe em branco para manter a senha atual' : 'Sua senha SMTP'}
                  value={pass}
                  onChange={e => setPass(e.target.value)}
                  className={cn(inputCls, 'pr-10')}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}>
                  {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Gmail: gere App Password em myaccount.google.com/apppasswords (precisa de 2FA ativado).
              </p>
            </div>
            <div>
              <label htmlFor="ns-from" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">
                Remetente (From) * <span className="font-normal text-gray-400">— como aparece pro destinatário</span>
              </label>
              <input
                id="ns-from"
                type="text"
                placeholder='Sua Empresa <contato@suaempresa.com>'
                value={from}
                onChange={e => setFrom(e.target.value)}
                className={inputCls}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving || !host.trim() || !user.trim() || !from.trim() || (!pass.trim() && !isConfigured)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                {isConfigured ? 'Atualizar' : 'Salvar'}
              </button>
              {isConfigured && (
                <button
                  onClick={() => { setEditing(false); setPass(''); }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors">
                  Cancelar
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
