'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { toast } from 'react-toastify';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { VaultEntry } from '@/lib/types';
import {
  Shield,
  Search,
  Plus,
  Lock,
  Edit3,
  Trash2,
  Loader2,
  Eye,
  EyeOff,
  ExternalLink,
  Copy,
  X,
  RefreshCw,
  Save,
  ChevronRight,
  Maximize2,
} from 'lucide-react';

interface VaultListItem extends Omit<VaultEntry, 'encryptedPassword'> {
  hasPassword: boolean;
}

interface VaultFormState {
  id?: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  category: string;
  accessScope: 'admins' | 'specific';
  sharedWith: string[];
}

const EMPTY_VAULT_FORM: VaultFormState = {
  title: '', username: '', password: '', url: '', notes: '', category: '',
  accessScope: 'admins', sharedWith: [],
};

function generatePassword(length: number, opts: { upper: boolean; lower: boolean; numbers: boolean; symbols: boolean }): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const nums = '23456789';
  const syms = '!@#$%^&*()-_=+[]{};:,.<>?/';
  let pool = '';
  if (opts.upper) pool += upper;
  if (opts.lower) pool += lower;
  if (opts.numbers) pool += nums;
  if (opts.symbols) pool += syms;
  if (!pool) pool = lower;
  const out: string[] = [];
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : null;
  if (cryptoObj) {
    const arr = new Uint32Array(length);
    cryptoObj.getRandomValues(arr);
    for (let i = 0; i < length; i++) out.push(pool[arr[i] % pool.length]);
  } else {
    for (let i = 0; i < length; i++) out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out.join('');
}

function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string; color: string } {
  if (!pw) return { score: 0, label: '—', color: 'bg-gray-300' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const capped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  const labels = ['Muito fraca', 'Fraca', 'Ok', 'Boa', 'Excelente'];
  const colors = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-violet-500'];
  return { score: capped, label: labels[capped], color: colors[capped] };
}

export function VaultTab() {
  const { user, business } = useAuth();
  const [entries, setEntries] = useState<VaultListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<VaultFormState>(EMPTY_VAULT_FORM);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [revealTimer, setRevealTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [revealing, setRevealing] = useState<string | null>(null);
  const [previewEntry, setPreviewEntry] = useState<VaultListItem | null>(null);

  const REVEAL_TIMEOUT_MS = 15_000;
  const canEdit = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];

  // Lock-scroll do wrapper de tab ativo enquanto qualquer modal (form ou preview)
  // está aberto. Síncrono com state change — não depende do exit animation do
  // modal, então nunca fica preso. Sem isso, o backdrop é portalado pra
  // document.body mas o conteúdo da página continua scrollável atrás (tab wrapper
  // tem overflow-y-auto).
  useEffect(() => {
    if (!formOpen && !previewEntry) return;
    const el = document.querySelector<HTMLElement>(
      '.will-change-transform.pointer-events-auto.overflow-y-auto',
    );
    if (!el) return;
    const prevOverflow = el.style.overflowY;
    el.style.overflowY = 'hidden';
    return () => { el.style.overflowY = prevOverflow; };
  }, [formOpen, previewEntry]);

  // Real-time listener (refactor de sincronização multi-user):
  //
  // ANTES: fetch POST /api/vault { action: 'list' } no mount + após mutações
  // próprias. Outro admin editava uma senha → invisível pra mim até reiniciar.
  //
  // AGORA: onSnapshot direto no Firestore. Rules de passwordVaultEntries já
  // filtram por accessScope/sharedWith/createdBy server-side (defense in depth
  // mantida — admin SDK das mutações continua aplicando mesma lógica). Web SDK
  // recebe só docs que o user pode ler.
  //
  // O reveal continua via API (decripta + audit log). save/delete continuam
  // via API (encripta + valida payload). Listener cobre só o LIST view.
  //
  // Mapeamento doc → VaultListItem: omit encryptedPassword + add hasPassword.
  // Compat com a UI antiga que esperava esse shape.
  useEffect(() => {
    if (!business?.id) { setLoading(false); return; }
    setLoading(true);
    const q = query(
      collection(db, 'passwordVaultEntries'),
      where('businessId', '==', business.id),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map(d => {
          const data = d.data();
          // Destructure pra omitir `encryptedPassword` do shape retornado
          // (Web SDK recebe o blob mas a UI não deve ter acesso direto —
          // reveal continua via API com audit log). Prefix _ sinaliza unused.
          const { encryptedPassword: _encryptedPassword, ...rest } = data;
          return {
            ...rest,
            id: d.id,
            // Guard: title é required em VaultEntry mas docs migrados/legacy
            // podem não ter. Fallback evita crash em sort/render.
            title: (rest.title as string | undefined) ?? '(sem título)',
            hasPassword: !!_encryptedPassword,
          } as VaultListItem;
        });
        list.sort((a, b) => a.title.localeCompare(b.title));
        setEntries(list);
        setLoading(false);
      },
      (err) => {
        console.error('[Vault] snapshot error:', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [business?.id]);

  useEffect(() => {
    return () => { if (revealTimer) clearTimeout(revealTimer); };
  }, [revealTimer]);

  // Keep previewEntry hydrated against the latest list (rename/edit/delete)
  useEffect(() => {
    if (!previewEntry) return;
    const fresh = entries.find(e => e.id === previewEntry.id);
    if (!fresh) { setPreviewEntry(null); return; }
    if (fresh !== previewEntry) setPreviewEntry(fresh);
  }, [entries, previewEntry]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.category) s.add(e.category);
    return Array.from(s).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(e => {
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.username?.toLowerCase().includes(q) ||
        e.category?.toLowerCase().includes(q) ||
        e.url?.toLowerCase().includes(q)
      );
    });
  }, [entries, search, categoryFilter]);

  const callApi = async (action: 'list' | 'save' | 'reveal' | 'delete', params: Record<string, unknown>) => {
    if (!business?.id) throw new Error('Sem business');
    const { getAuth } = await import('firebase/auth');
    const token = await getAuth().currentUser?.getIdToken();
    if (!token) throw new Error('Não autenticado');
    const resp = await fetch('/api/vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, businessId: business.id, params }),
    });
    const json = await resp.json();
    if (!resp.ok || !json.ok) throw new Error(json.error || 'Erro na API');
    return json.data;
  };

  const openCreate = () => {
    if (!canEdit) return;
    setForm(EMPTY_VAULT_FORM);
    setEditing(false);
    setFormOpen(true);
  };

  const openEdit = (e: VaultListItem) => {
    if (!canEdit) return;
    setForm({
      id: e.id,
      title: e.title,
      username: e.username || '',
      password: '',
      url: e.url || '',
      notes: e.notes || '',
      category: e.category || '',
      accessScope: e.accessScope || 'admins',
      sharedWith: e.sharedWith || [],
    });
    setEditing(true);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await callApi('save', {
        id: form.id,
        title: form.title.trim(),
        username: form.username.trim() || undefined,
        password: form.password || undefined,
        url: form.url.trim() || undefined,
        notes: form.notes.trim() || undefined,
        category: form.category.trim() || undefined,
        accessScope: form.accessScope,
        sharedWith: form.accessScope === 'specific' ? form.sharedWith : undefined,
      });
      toast.success(editing ? 'Entrada atualizada' : 'Senha salva');
      setFormOpen(false);
      // onSnapshot reflete a mudança automaticamente — sem refreshKey.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!canEdit) return;
    if (!confirm('Excluir esta senha? Esta ação não pode ser desfeita.')) return;
    setDeleting(id);
    try {
      await callApi('delete', { id });
      toast.info('Entrada removida');
      // onSnapshot reflete a remoção automaticamente — sem refreshKey.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir');
    } finally {
      setDeleting(null);
    }
  };

  const handleReveal = async (id: string) => {
    if (revealedId === id) {
      setRevealedId(null);
      setRevealedValue(null);
      if (revealTimer) { clearTimeout(revealTimer); setRevealTimer(null); }
      return;
    }
    setRevealing(id);
    try {
      const data = await callApi('reveal', { id });
      setRevealedId(id);
      setRevealedValue(data.password);
      if (revealTimer) clearTimeout(revealTimer);
      const t = setTimeout(() => {
        setRevealedId(null);
        setRevealedValue(null);
        setRevealTimer(null);
      }, REVEAL_TIMEOUT_MS);
      setRevealTimer(t);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao revelar');
    } finally {
      setRevealing(null);
    }
  };

  const copyRevealed = async () => {
    if (!revealedValue) return;
    try {
      await navigator.clipboard.writeText(revealedValue);
      toast.success('Senha copiada (limpa em 20s)');
      setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 20_000);
    } catch {
      toast.error('Falha ao copiar');
    }
  };

  const copyUsername = async (u: string) => {
    try { await navigator.clipboard.writeText(u); toast.success('Usuário copiado'); }
    catch { toast.error('Falha ao copiar'); }
  };

  return (
    <motion.div
      key="senhas"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="space-y-5"
    >
      {/* Header */}
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-500/10 dark:to-teal-500/5 border border-emerald-200/60 dark:border-emerald-500/20 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white dark:bg-gray-900 flex items-center justify-center shadow-sm">
            <Shield className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-0.5">Senhas da Empresa</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              Armazene credenciais compartilhadas (contas bancárias, emails, serviços) de forma segura.
              Senhas são criptografadas no servidor com AES-256-GCM. Acesso restrito a administradores.
            </p>
          </div>
        </div>
      </div>

      {/* Search + filters + new */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por título, usuário ou URL..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
          />
        </div>
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none"
          >
            <option value="all">Todas categorias</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {canEdit && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nova Senha
          </button>
        )}
      </div>

      {/* Entries */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-xl shimmer" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center mb-4">
            <Lock className="w-7 h-7 text-emerald-500" />
          </div>
          <p className="text-gray-700 dark:text-gray-200 font-semibold">
            {entries.length === 0 ? 'Nenhuma senha salva ainda' : 'Nenhuma entrada corresponde à busca'}
          </p>
          {entries.length === 0 && canEdit && (
            <p className="text-sm text-gray-500 mt-1">Clique em &quot;Nova Senha&quot; para criar a primeira</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map(e => {
            const isRevealed = revealedId === e.id;
            const canDelete = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];
            return (
              <motion.div
                key={e.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onDoubleClick={(ev) => {
                  // Skip dblclick that lands on interactive children (buttons/links/inputs)
                  if ((ev.target as HTMLElement).closest('button, a, input')) return;
                  setPreviewEntry(e);
                }}
                title="Duplo clique para destacar"
                className="group relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:shadow-md transition-shadow cursor-default select-none"
              >
                {/* Hint de expandir — aparece no hover */}
                <div className="absolute bottom-2.5 right-2.5 opacity-0 group-hover:opacity-40 transition-opacity duration-150 pointer-events-none">
                  <Maximize2 className="w-3 h-3 text-gray-500 dark:text-gray-400" />
                </div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{e.title}</h4>
                      {e.category && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                          {e.category}
                        </span>
                      )}
                      {e.accessScope === 'specific' && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 inline-flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" /> Restrita
                        </span>
                      )}
                    </div>
                    {e.username && (
                      <button
                        type="button"
                        onClick={() => copyUsername(e.username!)}
                        className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 truncate max-w-full"
                        title="Clique para copiar"
                      >
                        <span className="truncate">{e.username}</span>
                        <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 flex-shrink-0" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => openEdit(e)}
                        className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                        title="Editar"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(e.id)}
                        disabled={deleting === e.id}
                        className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-30"
                        title="Excluir"
                      >
                        {deleting === e.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>

                {e.url && (
                  <a
                    href={e.url.startsWith('http') ? e.url : `https://${e.url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-blue-500 hover:underline truncate max-w-full mb-2"
                  >
                    <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                    <span className="truncate">{e.url}</span>
                  </a>
                )}

                <div className="flex items-center gap-2 mt-2">
                  {!e.hasPassword ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-white/[0.04] text-xs text-gray-400 dark:text-gray-500 select-none">
                      <EyeOff className="w-3 h-3" />
                      Sem credencial
                    </span>
                  ) : isRevealed && revealedValue ? (
                    <>
                      <div className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 font-mono text-xs text-gray-900 dark:text-gray-100 truncate">
                        {revealedValue}
                      </div>
                      <button
                        onClick={copyRevealed}
                        className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                        title="Copiar"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleReveal(e.id)}
                        className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
                        title="Ocultar"
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleReveal(e.id)}
                      disabled={revealing === e.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/[0.04] hover:bg-gray-200 dark:hover:bg-white/[0.08] text-xs font-semibold text-gray-700 dark:text-gray-300 disabled:opacity-50"
                    >
                      {revealing === e.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                      Revelar senha
                    </button>
                  )}
                </div>

                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500">
                  <span>Criado por {e.createdByName}</span>
                  {e.accessCount ? <span>{e.accessCount} {e.accessCount === 1 ? 'consulta' : 'consultas'}</span> : <span>Nunca acessada</span>}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Form modal — portal pra escapar containing block do wrapper de tabs
          (will-change-transform em app/page.tsx quebra position:fixed). */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {formOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={e => { if (e.target === e.currentTarget && !saving) setFormOpen(false); }}
            >
              <VaultForm
                form={form}
                setForm={setForm}
                editing={editing}
                saving={saving}
                onSave={handleSave}
                onClose={() => setFormOpen(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* Preview modal (double-click no card) — destaca título, senha e descrição.
          AnimatePresence fica fora do portal (mesmo padrão de NotePreviewModal),
          o portal pra document.body é feito DENTRO de VaultPreviewModal. */}
      <AnimatePresence>
        {previewEntry && (
          <VaultPreviewModal
            key={previewEntry.id}
            entry={previewEntry}
            revealedValue={revealedId === previewEntry.id ? revealedValue : null}
            revealing={revealing === previewEntry.id}
            canEdit={canEdit}
            onClose={() => setPreviewEntry(null)}
            onReveal={() => handleReveal(previewEntry.id)}
            onCopyPassword={copyRevealed}
            onCopyUsername={() => previewEntry.username && copyUsername(previewEntry.username)}
            onEdit={() => { const e = previewEntry; setPreviewEntry(null); openEdit(e); }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function VaultPreviewModal({
  entry,
  revealedValue,
  revealing,
  canEdit,
  onClose,
  onReveal,
  onCopyPassword,
  onCopyUsername,
  onEdit,
}: {
  entry: VaultListItem;
  revealedValue: string | null;
  revealing: boolean;
  canEdit: boolean;
  onClose: () => void;
  onReveal: () => void;
  onCopyPassword: () => void;
  onCopyUsername: () => void;
  onEdit: () => void;
}) {
  // Esc fecha. Scroll-lock vive no parent (gateado em previewEntry) — síncrono
  // com state change, não depende do exit animation, então nunca fica preso.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Portal pra escapar o containing block do wrapper com `will-change-transform`
  // — sem isso, `position: fixed` é resolvido contra o wrapper scrollable.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.93, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-2xl rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl flex flex-col"
        style={{ maxHeight: 'calc(100vh - 64px)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 shrink-0 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-emerald-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-xl leading-snug break-words text-gray-900 dark:text-gray-100 select-text">
                {entry.title}
              </h2>
              {(entry.category || entry.accessScope === 'specific') && (
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                  {entry.category && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                      {entry.category}
                    </span>
                  )}
                  {entry.accessScope === 'specific' && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
                      <Lock className="w-2.5 h-2.5" /> Restrita
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 select-none">
            {canEdit && (
              <button
                onClick={onEdit}
                title="Editar entrada"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors text-xs font-semibold text-gray-700 dark:text-gray-200"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Editar
              </button>
            )}
            <button
              onClick={onClose}
              title="Fechar (Esc)"
              className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {entry.username && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                Usuário / Email
              </label>
              <button
                type="button"
                onClick={onCopyUsername}
                className="group/u w-full inline-flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
                title="Clique para copiar"
              >
                <span className="truncate select-text">{entry.username}</span>
                <Copy className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover/u:opacity-100 transition-opacity flex-shrink-0" />
              </button>
            </div>
          )}

          {entry.url && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                URL
              </label>
              <a
                href={entry.url.startsWith('http') ? entry.url : `https://${entry.url}`}
                target="_blank"
                rel="noreferrer"
                className="w-full inline-flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-sm text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="truncate">{entry.url}</span>
                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
              </a>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              Senha
            </label>
            {!entry.hasPassword ? (
              <div className="px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-sm text-gray-400 dark:text-gray-500 inline-flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5" />
                Nenhuma credencial salva
              </div>
            ) : revealedValue ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 font-mono text-sm text-gray-900 dark:text-gray-100 break-all select-text">
                  {revealedValue}
                </div>
                <button
                  onClick={onCopyPassword}
                  className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                  title="Copiar"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  onClick={onReveal}
                  className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
                  title="Ocultar"
                >
                  <EyeOff className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={onReveal}
                disabled={revealing}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-white/[0.04] hover:bg-gray-200 dark:hover:bg-white/[0.08] text-sm font-semibold text-gray-700 dark:text-gray-300 disabled:opacity-50 transition-colors"
              >
                {revealing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                Revelar senha
              </button>
            )}
            <p className="mt-1.5 text-[10px] text-gray-400 dark:text-gray-500">
              A senha some automaticamente após 15 segundos.
            </p>
          </div>

          {entry.notes && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                Descrição
              </label>
              <p className="px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words leading-relaxed select-text">
                {entry.notes}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-gray-100 dark:border-gray-800 flex items-center gap-3 shrink-0 select-none text-[11px] text-gray-500 dark:text-gray-400">
          <span>Criado por {entry.createdByName}</span>
          <span className="ml-auto">
            {entry.accessCount ? `${entry.accessCount} ${entry.accessCount === 1 ? 'consulta' : 'consultas'}` : 'Nunca acessada'}
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 italic">
            Esc para fechar
          </span>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function VaultForm({
  form, setForm, editing, saving, onSave, onClose,
}: {
  form: VaultFormState;
  setForm: (v: VaultFormState | ((prev: VaultFormState) => VaultFormState)) => void;
  editing: boolean;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const [showPw, setShowPw] = useState(false);
  const [genLength, setGenLength] = useState(20);
  const [genOpts, setGenOpts] = useState({ upper: true, lower: true, numbers: true, symbols: true });

  const strength = passwordStrength(form.password);
  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400';
  const labelCls = 'block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.22 }}
      className="w-full max-w-2xl max-h-[90vh] overflow-hidden bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col"
    >
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Shield className="w-5 h-5 text-emerald-500" />
          {editing ? 'Editar senha' : 'Nova senha'}
        </h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div>
          <label className={labelCls}>Título *</label>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="AWS Console, Stripe, Gmail..." className={inputCls} autoFocus />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Usuário / Email</label>
            <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              placeholder="admin@empresa.com" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Categoria</label>
            <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              placeholder="Financeiro, Dev, Social..." className={inputCls} list="vault-categories" />
          </div>
        </div>

        {/* Password with generator */}
        <div>
          <label className={labelCls}>{editing ? 'Senha — vazio mantém a atual' : 'Senha — opcional'}</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder={editing ? 'Deixe em branco para manter' : 'Use o gerador ou digite'}
                className={cn(inputCls, 'pr-10 font-mono')}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, password: generatePassword(genLength, genOpts) }))}
              className="px-3 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 text-xs font-bold hover:bg-emerald-100 dark:hover:bg-emerald-500/20 inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Gerar
            </button>
          </div>
          {form.password && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <motion.div
                  className={cn('h-full rounded-full', strength.color)}
                  animate={{ width: `${(strength.score / 4) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">{strength.label}</span>
            </div>
          )}

          <details className="mt-2 group">
            <summary className="cursor-pointer text-[11px] text-gray-500 dark:text-gray-400 hover:text-emerald-600 inline-flex items-center gap-1">
              <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" />
              Opções do gerador
            </summary>
            <div className="mt-2 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 space-y-2">
              <div className="flex items-center gap-3">
                <label className="text-[11px] text-gray-600 dark:text-gray-400 flex-shrink-0 w-24">Tamanho: {genLength}</label>
                <input type="range" min={8} max={64} value={genLength} onChange={e => setGenLength(Number(e.target.value))}
                  className="flex-1 accent-emerald-500" />
              </div>
              <div className="flex flex-wrap gap-3 text-[11px]">
                {([
                  ['upper', 'Maiúsculas'],
                  ['lower', 'Minúsculas'],
                  ['numbers', 'Números'],
                  ['symbols', 'Símbolos'],
                ] as [keyof typeof genOpts, string][]).map(([k, label]) => (
                  <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={genOpts[k]} onChange={e => setGenOpts(o => ({ ...o, [k]: e.target.checked }))}
                      className="accent-emerald-500" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </details>
        </div>

        <div>
          <label className={labelCls}>URL</label>
          <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            placeholder="https://console.aws.amazon.com" className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>Notas</label>
          <textarea rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="MFA ativo, usar código do app, etc."
            className={cn(inputCls, 'resize-none')} />
        </div>

        {/* Access scope */}
        <div>
          <label className={labelCls}>Acesso</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, accessScope: 'admins' }))}
              className={cn(
                'text-left p-3 rounded-xl border-2 text-xs transition-all',
                form.accessScope === 'admins'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                  : 'border-gray-200 dark:border-gray-700',
              )}
            >
              <p className="font-bold text-gray-900 dark:text-gray-100">Todos admins</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Visível para administradores e founder</p>
            </button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, accessScope: 'specific' }))}
              className={cn(
                'text-left p-3 rounded-xl border-2 text-xs transition-all',
                form.accessScope === 'specific'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                  : 'border-gray-200 dark:border-gray-700',
              )}
            >
              <p className="font-bold text-gray-900 dark:text-gray-100">Apenas criador</p>
              <p className="text-[10px] text-gray-500 mt-0.5">Restrita — só você (e founder)</p>
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60 flex justify-end gap-2">
        <button onClick={onClose} disabled={saving}
          className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
          Cancelar
        </button>
        <button onClick={onSave} disabled={saving || !form.title.trim()}
          className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </motion.div>
  );
}

export default function SenhasModule() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="max-w-5xl mx-auto"
    >
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-500/20 dark:to-teal-500/10 flex items-center justify-center border border-emerald-200/50 dark:border-emerald-500/20">
            <Shield className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 font-display">Senhas</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Gerencie credenciais compartilhadas da empresa com criptografia AES-256-GCM
            </p>
          </div>
        </div>
      </div>
      <VaultTab />
    </motion.div>
  );
}
