'use client';

/**
 * NotificationServerConfig — UI para configurar o notification-server externo
 * que processa broadcasts de email (e potencialmente outros canais no futuro).
 *
 * Endpoints chamados:
 *  - POST   /api/channels/notification-server  → salva
 *  - GET    /api/channels/notification-server  → testa conexão
 *  - DELETE /api/channels/notification-server  → desconecta
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

export default function NotificationServerSection({ businessId, current, onChange }: Props) {
  const [url, setUrl] = useState(current?.url || '');
  const [apiKey, setApiKey] = useState('');
  const [appId, setAppId] = useState(current?.appId || '');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [editing, setEditing] = useState(!current?.isConfigured);

  useEffect(() => {
    setUrl(current?.url || '');
    setAppId(current?.appId || '');
    setEditing(!current?.isConfigured);
  }, [current?.url, current?.appId, current?.isConfigured]);

  const isConfigured = !!current?.isConfigured;
  const lastTestStatus = current?.lastTestStatus;

  const handleSave = async () => {
    if (!url.trim() || !apiKey.trim()) {
      toast.error('URL e API key são obrigatórios');
      return;
    }
    try { new URL(url); } catch {
      toast.error('URL inválida');
      return;
    }
    setSaving(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch('/api/channels/notification-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId, url: url.trim(), apiKey: apiKey.trim(), appId: appId.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('Notification server configurado!');
      setApiKey(''); // limpa campo sensível
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
    if (!confirm('Desconectar o notification-server? Broadcasts de email serão bloqueados até reconectar.')) return;
    setDisconnecting(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/channels/notification-server?businessId=${businessId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Notification server desconectado');
      setUrl('');
      setApiKey('');
      setAppId('');
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
                <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Notification Server</h4>
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
                Servidor externo que processa broadcasts de email (SMTP/Gmail). Necessário para campanhas de email.
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
                <p className="text-[9px] font-bold text-gray-400 uppercase mb-1">URL</p>
                <p className="text-xs text-gray-700 dark:text-gray-300 font-mono truncate">{current?.url}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase mb-1">App ID</p>
                <p className="text-xs text-gray-700 dark:text-gray-300 font-mono truncate">{current?.appId || businessId}</p>
              </div>
            </div>
            {current?.lastTestedAt && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                Último teste: {new Date(current.lastTestedAt).toLocaleString('pt-BR')} —{' '}
                <span className={lastTestStatus === 'ok' ? 'text-emerald-500' : 'text-red-500'}>
                  {lastTestStatus === 'ok' ? 'OK' : 'falhou'}
                </span>
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
            <div>
              <label htmlFor="ns-url" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">URL do servidor *</label>
              <input
                id="ns-url"
                type="url"
                placeholder="https://notifications.empresa.com.br"
                value={url}
                onChange={e => setUrl(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="ns-key" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">
                API Key * <span className="font-normal text-gray-400">(não exibida depois de salva)</span>
              </label>
              <div className="relative">
                <input
                  id="ns-key"
                  type={showKey ? 'text' : 'password'}
                  placeholder={isConfigured ? 'Deixe em branco para manter a key atual' : 'sua-api-key-aqui'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  className={cn(inputCls, 'pr-10')}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label={showKey ? 'Ocultar API key' : 'Mostrar API key'}>
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="ns-appid" className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">
                App ID <span className="font-normal text-gray-400">(opcional — usa businessId por default)</span>
              </label>
              <input
                id="ns-appid"
                placeholder={businessId}
                value={appId}
                onChange={e => setAppId(e.target.value)}
                className={inputCls}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving || !url.trim() || (!apiKey.trim() && !isConfigured)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                {isConfigured ? 'Atualizar' : 'Conectar'}
              </button>
              {isConfigured && (
                <button
                  onClick={() => { setEditing(false); setApiKey(''); }}
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
