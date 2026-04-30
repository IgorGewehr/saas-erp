'use client';

/**
 * WhatsAppProfileSection — UI para editar o perfil WhatsApp Business via
 * Meta Cloud API. Aparece em Configurações → Canais quando o WhatsApp Cloud
 * está conectado.
 *
 * Edita:
 *   - Foto de perfil (upload JPEG/PNG ≤ 5MB)
 *   - Sobre (status — 139 chars max)
 *   - Descrição (512 chars max)
 *   - Endereço, Email, Websites (até 2)
 *   - Categoria (vertical)
 *
 * NÃO edita o "display name" (nome de exibição) — limitação Meta, requer
 * aprovação manual no Meta Business Manager.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getAuth } from 'firebase/auth';
import { toast } from 'react-toastify';
import {
  User as UserIcon, Camera, Loader2, Check, AlertTriangle, Upload, Trash2, Globe, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  businessId: string;
}

interface WhatsAppProfile {
  about?: string;
  description?: string;
  address?: string;
  email?: string;
  websites?: string[];
  vertical?: string;
  profile_picture_url?: string;
}

const VERTICAL_OPTIONS: { value: string; label: string }[] = [
  { value: 'UNDEFINED', label: 'Não definido' },
  { value: 'AUTO', label: 'Automotivo' },
  { value: 'BEAUTY', label: 'Beleza, spa e cabelo' },
  { value: 'APPAREL', label: 'Moda e vestuário' },
  { value: 'EDU', label: 'Educação' },
  { value: 'ENTERTAIN', label: 'Entretenimento' },
  { value: 'EVENT_PLAN', label: 'Eventos' },
  { value: 'FINANCE', label: 'Finanças e bancos' },
  { value: 'GROCERY', label: 'Mercado / hortifruti' },
  { value: 'GOVT', label: 'Governo' },
  { value: 'HOTEL', label: 'Hotel / hospedagem' },
  { value: 'HEALTH', label: 'Saúde' },
  { value: 'NONPROFIT', label: 'Sem fins lucrativos' },
  { value: 'PROF_SERVICES', label: 'Serviços profissionais' },
  { value: 'RETAIL', label: 'Varejo' },
  { value: 'TRAVEL', label: 'Viagens' },
  { value: 'RESTAURANT', label: 'Restaurante' },
  { value: 'NOT_A_BIZ', label: 'Pessoa física (não é negócio)' },
  { value: 'OTHER', label: 'Outro' },
];

const MAX_ABOUT = 139;
const MAX_DESCRIPTION = 512;
const MAX_ADDRESS = 256;

export default function WhatsAppProfileSection({ businessId }: Props) {
  // Estado do form
  const [about, setAbout] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [websites, setWebsites] = useState<string[]>(['']);
  const [vertical, setVertical] = useState('UNDEFINED');

  // Foto
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null); // local preview enquanto não submeteu
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Status
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const markDirty = () => setDirty(true);

  // ── Carrega perfil atual ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const token = await getAuth().currentUser?.getIdToken();
        if (!token) throw new Error('Sessão expirada');
        const res = await fetch(`/api/channels/whatsapp-profile?businessId=${encodeURIComponent(businessId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.isTokenExpired) {
            setLoadError('Token do WhatsApp expirou. Reconecte o canal.');
          } else if (res.status === 400 && /não conectado|configure/i.test(data.error || '')) {
            setLoadError('WhatsApp Cloud não conectado.');
          } else {
            setLoadError(data.error || `HTTP ${res.status}`);
          }
          return;
        }
        const { profile } = (await res.json()) as { profile: WhatsAppProfile };
        if (cancelled) return;
        setAbout(profile.about || '');
        setDescription(profile.description || '');
        setAddress(profile.address || '');
        setEmail(profile.email || '');
        setWebsites(profile.websites && profile.websites.length > 0 ? profile.websites : ['']);
        setVertical(profile.vertical || 'UNDEFINED');
        setPhotoUrl(profile.profile_picture_url || null);
        setDirty(false);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Erro ao carregar perfil');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  // ── Foto: handlers ──────────────────────────────────────────────────────
  const handlePhotoSelect = (file: File) => {
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) {
      toast.error('Use JPEG ou PNG');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Arquivo excede 5MB');
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setPhotoPreview((e.target?.result as string) || null);
    };
    reader.readAsDataURL(file);
    markDirty();
  };

  const handleClearNewPhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Websites: adicionar/remover ─────────────────────────────────────────
  const updateWebsite = (i: number, v: string) => {
    setWebsites(prev => prev.map((w, idx) => idx === i ? v : w));
    markDirty();
  };
  const addWebsite = () => {
    if (websites.length >= 2) return;
    setWebsites(prev => [...prev, '']);
    markDirty();
  };
  const removeWebsite = (i: number) => {
    setWebsites(prev => prev.filter((_, idx) => idx !== i));
    markDirty();
  };

  // ── Submit ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Sessão expirada');

      // 1) Se há foto nova, faz upload primeiro pra obter o handle
      let photoHandle: string | undefined;
      if (photoFile) {
        const fd = new FormData();
        fd.append('businessId', businessId);
        fd.append('file', photoFile);
        const uploadRes = await fetch('/api/channels/whatsapp-profile/photo', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok) {
          throw new Error(uploadData.error || `Falha no upload (HTTP ${uploadRes.status})`);
        }
        photoHandle = uploadData.handle;
      }

      // 2) Atualiza campos do perfil (incluindo photoHandle se aplicável)
      const cleanedWebsites = websites.map(w => w.trim()).filter(Boolean);
      const payload: Record<string, unknown> = {
        businessId,
        about: about.trim(),
        description: description.trim(),
        address: address.trim(),
        email: email.trim(),
        websites: cleanedWebsites,
        vertical,
      };
      if (photoHandle) payload.profile_picture_handle = photoHandle;

      const res = await fetch('/api/channels/whatsapp-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      toast.success('Perfil WhatsApp atualizado!');
      // Se houve upload, atualiza preview pra refletir foto nova
      if (photoPreview) {
        setPhotoUrl(photoPreview);
        setPhotoPreview(null);
        setPhotoFile(null);
      }
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-white dark:bg-[#111827] p-5">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Carregando perfil WhatsApp…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5 p-4 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-amber-900 dark:text-amber-200">Não foi possível carregar o perfil</p>
          <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">{loadError}</p>
        </div>
      </div>
    );
  }

  const previewSrc = photoPreview || photoUrl;
  const aboutLeft = MAX_ABOUT - about.length;
  const descLeft = MAX_DESCRIPTION - description.length;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700/50 bg-white dark:bg-[#111827] overflow-hidden">
      <div className="p-5 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
            <UserIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Perfil do WhatsApp Business</h4>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              Foto, descrição e categoria que aparecem para o cliente. O <strong>nome de exibição</strong> é alterável apenas no Meta Business Manager.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Foto */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className={cn(
              'w-20 h-20 rounded-full overflow-hidden border-2 flex items-center justify-center',
              previewSrc ? 'border-emerald-300 dark:border-emerald-500/40' : 'border-dashed border-gray-300 dark:border-gray-600',
              !previewSrc && 'bg-gray-50 dark:bg-white/[0.04]',
            )}>
              {previewSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewSrc} alt="Foto WhatsApp" className="w-full h-full object-cover" />
              ) : (
                <Camera className="w-6 h-6 text-gray-400" />
              )}
            </div>
            {photoPreview && (
              <button
                type="button"
                onClick={handleClearNewPhoto}
                className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow"
                title="Cancelar nova foto"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors"
            >
              <Upload className="w-3 h-3" />
              {previewSrc ? 'Trocar foto' : 'Selecionar foto'}
            </button>
            <p className="text-[10px] text-gray-400 mt-1">JPEG ou PNG · até 5MB · quadrada (recomendado)</p>
            {photoPreview && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                ⓘ Foto será aplicada quando você clicar Salvar.
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handlePhotoSelect(f);
              }}
            />
          </div>
        </div>

        {/* Sobre */}
        <Field label="Sobre" hint={`${aboutLeft} caracteres restantes`}>
          <input
            type="text"
            value={about}
            onChange={(e) => { setAbout(e.target.value.slice(0, MAX_ABOUT)); markDirty(); }}
            placeholder="Hey there! I am using WhatsApp."
            maxLength={MAX_ABOUT}
            className={inputCls()}
          />
        </Field>

        {/* Descrição */}
        <Field label="Descrição" hint={`${descLeft} caracteres restantes`}>
          <textarea
            value={description}
            onChange={(e) => { setDescription(e.target.value.slice(0, MAX_DESCRIPTION)); markDirty(); }}
            placeholder="Descreva sua empresa em poucas linhas"
            maxLength={MAX_DESCRIPTION}
            rows={3}
            className={cn(inputCls(), 'resize-none')}
          />
        </Field>

        {/* Endereço */}
        <Field label="Endereço">
          <input
            type="text"
            value={address}
            onChange={(e) => { setAddress(e.target.value.slice(0, MAX_ADDRESS)); markDirty(); }}
            placeholder="Rua, número, cidade — UF"
            maxLength={MAX_ADDRESS}
            className={inputCls()}
          />
        </Field>

        {/* Email */}
        <Field label="Email de contato">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); markDirty(); }}
            placeholder="contato@suaempresa.com"
            className={inputCls()}
          />
        </Field>

        {/* Websites */}
        <Field label="Websites" hint="Até 2 URLs (https:// obrigatório)">
          <div className="space-y-2">
            {websites.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <input
                  type="url"
                  value={w}
                  onChange={(e) => updateWebsite(i, e.target.value)}
                  placeholder="https://suaempresa.com"
                  className={inputCls()}
                />
                {websites.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeWebsite(i)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                    title="Remover"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            {websites.length < 2 && (
              <button
                type="button"
                onClick={addWebsite}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04]"
              >
                <Plus className="w-3 h-3" /> Adicionar website
              </button>
            )}
          </div>
        </Field>

        {/* Categoria */}
        <Field label="Categoria do negócio">
          <select
            value={vertical}
            onChange={(e) => { setVertical(e.target.value); markDirty(); }}
            className={inputCls()}
          >
            {VERTICAL_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Footer com botão Salvar */}
      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.02] flex items-center justify-end gap-2"
          >
            <span className="text-[11px] text-gray-500 dark:text-gray-400 mr-auto">
              Alterações pendentes
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Helpers de UI ──────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>
        {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function inputCls() {
  return 'w-full px-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400';
}
