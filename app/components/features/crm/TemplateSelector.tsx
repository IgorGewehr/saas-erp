'use client';

/**
 * TemplateSelector — UI para escolher template WhatsApp aprovado
 * e mapear suas variáveis ({{1}}, {{2}}, …) para valores literais ou
 * campos do recipiente.
 *
 * Output: { name, language, params: BroadcastTemplateParam[] }
 *
 * Props:
 *  - businessId
 *  - value (controlled)
 *  - onChange
 *  - sampleRecipient (opcional) — usado para preview do envio
 */

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getAuth } from 'firebase/auth';
import { Loader2, AlertTriangle, Check, Sparkles, Type as TypeIcon, User as UserIcon, Phone, Mail, Database, Upload, X, FileVideo, FileImage, FileText, CheckCircle2 } from 'lucide-react';
import { FormControl, InputLabel, Select, MenuItem, Box } from '@mui/material';
import { cn } from '@/lib/utils';
import type { BroadcastRecipient, BroadcastTemplateParam } from '@/lib/types';

/** Formato do header conforme retornado pela Meta. NONE = sem header
 *  (template só com body); LOCATION é raro e não tem mídia upload-ável. */
type WhatsAppHeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
/** Formatos que exigem upload de mídia em runtime (mediaId via Meta /media). */
type HeaderMediaFormat = 'IMAGE' | 'VIDEO' | 'DOCUMENT';

interface WhatsAppTemplate {
  name: string;
  language: string;
  category: string;
  preview: string;
  hasVariables: boolean;
  /** Novo — vem do endpoint enriquecido em /api/channels/whatsapp-templates.
   *  Quando ausente (template legado ou sem header), tratamos como TEXT/none. */
  header?: {
    format: WhatsAppHeaderFormat;
    text?: string;
  } | null;
}

export interface TemplateSelection {
  name: string;
  language: string;
  params: BroadcastTemplateParam[];
  /** Body cru com `{{N}}` placeholders — usado pra render no histórico
   *  da conversa (sem isso, broadcast aparecia como "[Template: nome]"). */
  preview?: string;
  /** Anotação do formato de header exigido pelo template (IMAGE/VIDEO/DOCUMENT).
   *  Setado em handleSelectTemplateValue e usado pelo validator pra exigir
   *  headerMedia sem precisar reconsultar o template original. Ausente quando
   *  o header é TEXT/LOCATION/none. */
  headerFormat?: HeaderMediaFormat;
  /** mediaId obtido via /api/channels/whatsapp-media/upload — a Meta usará
   *  esse id em `template.components[].parameters[].{video|image|document}.id`
   *  no momento do envio. Obrigatório quando headerFormat está setado. */
  headerMedia?: {
    mediaId: string;
    mimeType: string;
    fileName?: string;
    sizeBytes?: number;
  };
}

/** Tipos aceitos pelo input file por formato de header — alinhado com a
 *  whitelist do endpoint /api/channels/whatsapp-media/upload. */
const HEADER_MEDIA_ACCEPT: Record<HeaderMediaFormat, string> = {
  IMAGE: 'image/jpeg,image/png',
  VIDEO: 'video/mp4,video/3gpp',
  DOCUMENT: 'application/pdf,application/msword,application/vnd.ms-excel,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain',
};
/** Limite Meta por categoria (em bytes). Validamos client-side pra dar erro
 *  rápido — o backend também valida, mas evita round-trip pra arquivo grande. */
const HEADER_MEDIA_MAX_BYTES: Record<HeaderMediaFormat, number> = {
  IMAGE: 5 * 1024 * 1024,
  VIDEO: 16 * 1024 * 1024,
  DOCUMENT: 100 * 1024 * 1024,
};
const HEADER_MEDIA_LABEL: Record<HeaderMediaFormat, string> = {
  IMAGE: 'imagem',
  VIDEO: 'vídeo',
  DOCUMENT: 'documento',
};
const HEADER_MEDIA_ICON: Record<HeaderMediaFormat, React.ReactNode> = {
  IMAGE: <FileImage className="w-4 h-4" />,
  VIDEO: <FileVideo className="w-4 h-4" />,
  DOCUMENT: <FileText className="w-4 h-4" />,
};

/** Badge visual no dropdown — sinaliza tipo de header sem operador precisar
 *  clicar pra descobrir. Cores distintas por categoria pra scan rápido em
 *  lista longa de templates. Tamanho compacto pra não dominar o MenuItem. */
function HeaderFormatBadge({ format }: { format: HeaderMediaFormat }) {
  const config = {
    VIDEO:    { icon: <FileVideo className="w-2.5 h-2.5" />,  label: 'Vídeo',     cls: 'text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20' },
    IMAGE:    { icon: <FileImage className="w-2.5 h-2.5" />,  label: 'Imagem',    cls: 'text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20' },
    DOCUMENT: { icon: <FileText className="w-2.5 h-2.5" />,   label: 'Documento', cls: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20' },
  }[format];
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded border', config.cls)}>
      {config.icon}
      {config.label}
    </span>
  );
}

interface Props {
  businessId: string;
  value: TemplateSelection | null;
  onChange: (next: TemplateSelection | null) => void;
  sampleRecipient?: BroadcastRecipient;
  /** Canal da campanha — usado para filtrar opções de field (ex: oculta email em WA). */
  channel?: 'whatsapp' | 'facebook' | 'instagram' | 'email';
  /** 5.8: nomes de colunas extras do CSV — viram opções de mapeamento de variáveis. */
  csvColumns?: string[];
  className?: string;
}

const ALL_FIELD_OPTIONS: { value: 'name' | 'phoneNumber' | 'email'; label: string; icon: React.ReactNode }[] = [
  { value: 'name', label: 'Nome do contato', icon: <UserIcon className="w-3 h-3" /> },
  { value: 'phoneNumber', label: 'Telefone', icon: <Phone className="w-3 h-3" /> },
  { value: 'email', label: 'Email', icon: <Mail className="w-3 h-3" /> },
];

/** Filtra opções de field por canal — email só faz sentido em campanhas de email. */
function fieldOptionsForChannel(channel?: Props['channel']) {
  if (channel === 'email') return ALL_FIELD_OPTIONS;
  return ALL_FIELD_OPTIONS.filter(o => o.value !== 'email');
}

/**
 * Retorna o maior índice {{N}} no body — usado para dimensionar params[].
 * Ex: "{{2}} {{4}}" retorna 4 (params precisa de 4 slots, mesmo com slot 1 e 3 vazios).
 * Templates Meta convencionalmente usam índices sequenciais 1..N, mas isso garante
 * que gaps não causem mismatch entre UI e renderização.
 * Index 0 ou inválido é ignorado (Meta exige >= 1).
 */
function maxVariableIndex(body: string): number {
  const matches = body.matchAll(/\{\{(\d+)\}\}/g);
  let max = 0;
  for (const m of matches) {
    const idx = Number(m[1]);
    if (idx >= 1 && idx > max) max = idx;
  }
  return max;
}

/** Renderiza o body do template substituindo {{N}} por valores resolvidos. */
function renderPreview(body: string, params: BroadcastTemplateParam[], sample?: BroadcastRecipient): string {
  return body.replace(/\{\{(\d+)\}\}/g, (matched, idx) => {
    const n = Number(idx);
    if (n < 1) return matched; // {{0}} ou inválido — não substitui
    const p = params[n - 1];
    if (!p) return matched;
    if (p.kind === 'literal') return p.value || matched;
    if (p.kind === 'field') {
      if (!sample) return `[${p.field}]`;
      if (p.field === 'name') return sample.name || '[sem nome]';
      if (p.field === 'phoneNumber') return sample.phoneNumber || '[sem telefone]';
      if (p.field === 'email') return sample.email || '[sem email]';
    }
    if (p.kind === 'csvColumn') {
      if (!sample?.customColumns) return `[${p.column}]`;
      return sample.customColumns[p.column] || `[${p.column}]`;
    }
    return matched;
  });
}

export default function TemplateSelector({ businessId, value, onChange, sampleRecipient, channel, csvColumns, className }: Props) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Estado do upload de mídia do header — separado do error global porque pode
  // co-existir com seleção válida (template OK, faltou só anexar o vídeo).
  const [headerUploading, setHeaderUploading] = useState(false);
  const [headerUploadError, setHeaderUploadError] = useState<string | null>(null);
  const fieldOptions = useMemo(() => fieldOptionsForChannel(channel), [channel]);

  // Fetch templates aprovados na WABA
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getAuth().currentUser?.getIdToken();
        if (!token) {
          if (!cancelled) setError('Sessão expirada');
          return;
        }
        const res = await fetch(`/api/channels/whatsapp-templates?businessId=${businessId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) {
          // Endpoint enriquecido (commit c5e8aaa+) retorna `error` + flags
          // (isTokenExpired/isPermissionError/isRateLimited) quando upstream Meta
          // falha. Mensagens curtas e direcionadas baseadas no cenário.
          const data = await res.json().catch(() => ({} as {
            error?: string;
            isTokenExpired?: boolean;
            isPermissionError?: boolean;
            isRateLimited?: boolean;
          }));
          if (!cancelled) {
            if (data.isTokenExpired) {
              setError('Token do WhatsApp expirou. Reconecte em Configurações → Canais.');
            } else if (data.isRateLimited) {
              setError('Meta API rate-limited. Tente novamente em alguns minutos.');
            } else if (res.status === 400 && /não está conectado|configure/i.test(data.error || '')) {
              // WhatsApp Cloud não conectado — não é erro do usuário, é estado de config
              setError('WhatsApp Cloud não conectado. Configure em Settings → Canais para enviar templates.');
            } else if (res.status === 502 && !data.error) {
              // Resposta antiga sem detalhes — provavelmente deploy não atualizado
              setError('Servidor do WhatsApp inacessível. Verifique a conexão do canal Cloud.');
            } else {
              setError(data.error || `HTTP ${res.status}`);
            }
          }
          return;
        }
        const data = await res.json();
        const fetched: WhatsAppTemplate[] = data.templates ?? [];
        // Garante hello_world como fallback se WABA não tem nada
        const hasHelloWorld = fetched.some(t => t.name.toLowerCase() === 'hello_world');
        if (!cancelled) {
          setTemplates(hasHelloWorld ? fetched : [
            { name: 'hello_world', language: 'en_US', category: 'UTILITY', preview: 'Hello World', hasVariables: false },
            ...fetched,
          ]);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar templates');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const selected = useMemo(() => {
    if (!value) return null;
    return templates.find(t => t.name === value.name && t.language === value.language) ?? null;
  }, [templates, value]);

  const variableCount = useMemo(() => selected ? maxVariableIndex(selected.preview) : 0, [selected]);

  // Sincroniza tamanho do params[] com a quantidade de variáveis do template
  // (sem perder valores já preenchidos quando o usuário troca de template)
  useEffect(() => {
    if (!selected || !value) return;
    if (value.params.length === variableCount) return;
    const next = [...value.params];
    while (next.length < variableCount) next.push({ kind: 'literal', value: '' });
    while (next.length > variableCount) next.pop();
    onChange({ ...value, params: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variableCount, selected]);

  const handleSelectTemplateValue = (v: string) => {
    if (!v) { onChange(null); return; }
    const tpl = templates.find(t => `${t.name}__${t.language}` === v);
    if (!tpl) return;
    const count = maxVariableIndex(tpl.preview);
    // Reseta erro de upload ao trocar de template — o anterior pode não se aplicar mais.
    setHeaderUploadError(null);
    // Anota headerFormat só quando exige mídia (IMAGE/VIDEO/DOCUMENT) —
    // TEXT/LOCATION não precisam de upload, ficam undefined.
    const fmt = tpl.header?.format;
    const headerFormat: HeaderMediaFormat | undefined =
      fmt === 'IMAGE' || fmt === 'VIDEO' || fmt === 'DOCUMENT' ? fmt : undefined;
    onChange({
      name: tpl.name,
      language: tpl.language,
      params: Array.from({ length: count }, () => ({ kind: 'literal', value: '' } as BroadcastTemplateParam)),
      preview: tpl.preview,
      ...(headerFormat ? { headerFormat } : {}),
    });
  };

  /** Calcula SHA-256 hex do conteúdo do arquivo via SubtleCrypto (disponível
   *  em todos browsers modernos). Roda em ~500ms até pra arquivos de 100MB.
   *  Usado pra consultar cache de mediaId antes do upload — evita re-mandar
   *  bytes quando o mesmo arquivo já foi enviado nos últimos 25 dias. */
  const computeFileSha256 = async (file: File): Promise<string | null> => {
    try {
      if (!crypto?.subtle?.digest) return null;
      const buf = await file.arrayBuffer();
      const hash = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (err) {
      // Browser muito antigo ou erro de memória — segue sem cache, upload normal.
      console.warn('[TemplateSelector] sha256 failed (continuing without cache):', err);
      return null;
    }
  };

  /** Faz upload do arquivo de header pra Meta via /api/channels/whatsapp-media/upload,
   *  consultando primeiro a cache via /cache-lookup. Cache hit = zero bytes na rede;
   *  miss = upload completo + cache write. Validação client-side (tamanho) antes
   *  pra não desperdiçar tempo computando hash de arquivo gigante. */
  const handleHeaderUpload = async (file: File) => {
    if (!value || !value.headerFormat) return;
    const maxBytes = HEADER_MEDIA_MAX_BYTES[value.headerFormat];
    if (file.size > maxBytes) {
      setHeaderUploadError(
        `Arquivo excede ${(maxBytes / 1024 / 1024).toFixed(0)} MB ` +
        `(recebido ${(file.size / 1024 / 1024).toFixed(1)} MB).`,
      );
      return;
    }
    setHeaderUploading(true);
    setHeaderUploadError(null);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) {
        setHeaderUploadError('Sessão expirada. Faça login novamente.');
        return;
      }

      // ── 1. Hash + cache lookup ────────────────────────────────────────
      // Calcula sha256 (best-effort — falha cai silenciosamente pro upload).
      const sha256 = await computeFileSha256(file);
      if (sha256) {
        try {
          const lookupRes = await fetch('/api/channels/whatsapp-media/cache-lookup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ businessId, sha256 }),
          });
          if (lookupRes.ok) {
            const lookupData = (await lookupRes.json()) as {
              cached: boolean;
              mediaId?: string;
              mimeType?: string;
              sizeBytes?: number;
            };
            if (lookupData.cached && lookupData.mediaId && lookupData.mimeType) {
              // Cache hit — devolvemos sem upload, ~zero bytes na rede.
              onChange({
                ...value,
                headerMedia: {
                  mediaId: lookupData.mediaId,
                  mimeType: lookupData.mimeType,
                  fileName: file.name,
                  sizeBytes: lookupData.sizeBytes ?? file.size,
                },
              });
              return;
            }
          }
        } catch (err) {
          // Lookup falhou — não bloqueia, segue pro upload normal.
          console.warn('[TemplateSelector] Cache lookup failed:', err);
        }
      }

      // ── 2. Upload completo (cache miss ou sha256 indisponível) ────────
      const form = new FormData();
      form.append('businessId', businessId);
      form.append('file', file);
      if (sha256) form.append('sha256', sha256); // permite o backend gravar na cache
      const res = await fetch('/api/channels/whatsapp-media/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        setHeaderUploadError(data.error || `Erro ${res.status} no upload`);
        return;
      }
      const data = await res.json() as {
        mediaId: string;
        mimeType: string;
        sizeBytes: number;
        category: string;
      };
      onChange({
        ...value,
        headerMedia: {
          mediaId: data.mediaId,
          mimeType: data.mimeType,
          fileName: file.name,
          sizeBytes: data.sizeBytes,
        },
      });
    } catch (err) {
      setHeaderUploadError(err instanceof Error ? err.message : 'Erro de rede no upload');
    } finally {
      setHeaderUploading(false);
    }
  };

  const handleHeaderRemove = () => {
    if (!value) return;
    onChange({ ...value, headerMedia: undefined });
    setHeaderUploadError(null);
  };

  const updateParam = (index: number, next: BroadcastTemplateParam) => {
    if (!value) return;
    const newParams = value.params.map((p, i) => i === index ? next : p);
    onChange({ ...value, params: newParams });
  };

  // Validação: tudo mapeado, literais não-vazios, header media presente se exigido
  const validationError = useMemo(() => {
    if (!value || !selected) return null;
    if (value.headerFormat && !value.headerMedia?.mediaId) {
      return `Anexe o ${HEADER_MEDIA_LABEL[value.headerFormat]} do header do template`;
    }
    if (value.params.length !== variableCount) return 'Mapeamento incompleto';
    for (let i = 0; i < value.params.length; i++) {
      const p = value.params[i];
      if (p.kind === 'literal' && !p.value.trim()) return `Variável {{${i + 1}}} sem valor`;
    }
    return null;
  }, [value, selected, variableCount]);

  const inputCls = 'w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400';

  return (
    <div className={cn('space-y-2.5', className)}>
      {/* Dropdown de template — MUI Select pra casar com os outros campos
          do form (Tipo, Vincular oferta). Native <select> ficava bizarramente
          pequeno comparado aos vizinhos. */}
      <div>
        {loading ? (
          <FormControl fullWidth size="small" disabled>
            <InputLabel shrink>Template aprovado</InputLabel>
            <Select value="" label="Template aprovado" displayEmpty
              renderValue={() => (
                <span className="inline-flex items-center gap-2 text-gray-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando templates da WABA…
                </span>
              )}
            >
              <MenuItem value="" disabled>Carregando…</MenuItem>
            </Select>
          </FormControl>
        ) : error ? (
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Template aprovado</p>
            <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
              <p className="text-[11px] text-red-600 dark:text-red-400">
                <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
                {error}
              </p>
            </div>
          </div>
        ) : (
          <FormControl fullWidth size="small">
            <InputLabel id="broadcast-template-select-label" shrink>Template aprovado</InputLabel>
            <Select
              labelId="broadcast-template-select-label"
              label="Template aprovado"
              value={value ? `${value.name}__${value.language}` : ''}
              onChange={(e) => handleSelectTemplateValue(e.target.value as string)}
              displayEmpty
              renderValue={(sel) => {
                if (!sel) return <span className="text-gray-400">Selecione um template…</span>;
                const tpl = templates.find(t => `${t.name}__${t.language}` === sel);
                if (!tpl) return sel as string;
                const fmt = tpl.header?.format;
                const isMediaFmt = fmt === 'IMAGE' || fmt === 'VIDEO' || fmt === 'DOCUMENT';
                return (
                  <span className="inline-flex items-center gap-2">
                    {isMediaFmt && <HeaderFormatBadge format={fmt} />}
                    <span className="font-medium">{tpl.name}</span>
                    <span className="text-xs text-gray-400">— {tpl.category} ({tpl.language})</span>
                  </span>
                );
              }}
            >
              <MenuItem value="" disabled>Selecione um template…</MenuItem>
              {templates.map(t => {
                const fmt = t.header?.format;
                const isMediaFmt = fmt === 'IMAGE' || fmt === 'VIDEO' || fmt === 'DOCUMENT';
                return (
                  <MenuItem key={`${t.name}__${t.language}`} value={`${t.name}__${t.language}`}>
                    <Box className="flex items-center justify-between w-full gap-3 min-w-0">
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        {isMediaFmt && <HeaderFormatBadge format={fmt} />}
                        <span className="font-medium text-sm truncate">{t.name}</span>
                      </span>
                      <span className="text-xs text-gray-400 flex-shrink-0">{t.category} • {t.language}</span>
                    </Box>
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
        )}
      </div>

      {/* Preview do body */}
      {selected && (
        <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700">
          <p className="text-[9px] font-bold text-gray-400 uppercase mb-1">Conteúdo do template</p>
          <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{selected.preview}</p>
        </div>
      )}

      {/* Upload do header de mídia — só pra templates IMAGE/VIDEO/DOCUMENT.
          Vai pra /api/channels/whatsapp-media/upload, retorna mediaId que o
          builder de envio usa em components[].parameters[].{video|image|document}.id */}
      {selected && value?.headerFormat && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            {HEADER_MEDIA_ICON[value.headerFormat]}
            Mídia do header — {HEADER_MEDIA_LABEL[value.headerFormat]}
            <span className="text-red-500 font-bold">*</span>
          </p>
          {!value.headerMedia ? (
            <div className="px-3 py-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center gap-2">
              <label className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors',
                headerUploading
                  ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-wait'
                  : 'bg-red-600 hover:bg-red-700 text-white',
              )}>
                {headerUploading ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando…</>
                ) : (
                  <><Upload className="w-3.5 h-3.5" /> Selecionar {HEADER_MEDIA_LABEL[value.headerFormat]}</>
                )}
                <input
                  type="file"
                  hidden
                  accept={HEADER_MEDIA_ACCEPT[value.headerFormat]}
                  disabled={headerUploading}
                  // Reset do value pra permitir re-selecionar o mesmo arquivo após erro.
                  onClick={(e) => { (e.currentTarget as HTMLInputElement).value = ''; }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleHeaderUpload(f);
                  }}
                />
              </label>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center">
                Limite Meta: {(HEADER_MEDIA_MAX_BYTES[value.headerFormat] / 1024 / 1024).toFixed(0)} MB.
                {value.headerFormat === 'VIDEO' && ' MP4 (H.264 + AAC) ou 3GP.'}
                {value.headerFormat === 'IMAGE' && ' JPEG ou PNG.'}
                {value.headerFormat === 'DOCUMENT' && ' PDF, Office ou TXT.'}
              </p>
            </div>
          ) : (
            <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-emerald-900 dark:text-emerald-200 truncate">
                  {value.headerMedia.fileName || 'arquivo'}
                </p>
                <p className="text-[10px] text-emerald-700 dark:text-emerald-400">
                  {value.headerMedia.sizeBytes
                    ? `${(value.headerMedia.sizeBytes / 1024 / 1024).toFixed(1)} MB · `
                    : ''}
                  carregado na Meta
                </p>
              </div>
              <button
                type="button"
                onClick={handleHeaderRemove}
                className="p-1 rounded-md hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 flex-shrink-0"
                title="Remover e enviar outro"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {headerUploadError && (
            <div className="px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
              <p className="text-[10px] text-red-700 dark:text-red-400">
                <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
                {headerUploadError}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Mapeamento de variáveis */}
      <AnimatePresence>
        {selected && variableCount > 0 && value && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="space-y-1.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Variáveis ({variableCount})</p>
            {value.params.map((p, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] font-bold text-red-500 bg-red-50 dark:bg-red-500/10 px-1.5 py-1 rounded flex-shrink-0">
                  {`{{${i + 1}}}`}
                </span>
                <select
                  value={
                    p.kind === 'literal' ? '__literal'
                    : p.kind === 'field' ? `field:${p.field}`
                    : `csv:${p.column}`
                  }
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '__literal') updateParam(i, { kind: 'literal', value: '' });
                    else if (v.startsWith('field:')) {
                      updateParam(i, { kind: 'field', field: v.slice(6) as 'name' | 'phoneNumber' | 'email' });
                    } else if (v.startsWith('csv:')) {
                      updateParam(i, { kind: 'csvColumn', column: v.slice(4) });
                    }
                  }}
                  className={cn(inputCls, 'w-auto flex-shrink-0')}
                >
                  <option value="__literal">Texto fixo</option>
                  {fieldOptions.map(o => (
                    <option key={o.value} value={`field:${o.value}`}>{o.label}</option>
                  ))}
                  {csvColumns && csvColumns.length > 0 && (
                    <optgroup label="Colunas do CSV">
                      {csvColumns.map(col => (
                        <option key={col} value={`csv:${col}`}>↳ {col}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {p.kind === 'literal' ? (
                  <input
                    placeholder="Valor"
                    value={p.value}
                    onChange={e => updateParam(i, { kind: 'literal', value: e.target.value })}
                    className={inputCls}
                  />
                ) : p.kind === 'field' ? (
                  <span className="flex-1 inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 rounded-lg">
                    {ALL_FIELD_OPTIONS.find(o => o.value === p.field)?.icon}
                    Resolvido por recipiente
                  </span>
                ) : (
                  <span className="flex-1 inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10 rounded-lg">
                    <Database className="w-3 h-3" />
                    coluna CSV: <code className="font-mono">{p.column}</code>
                  </span>
                )}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview com sample */}
      {selected && value && variableCount > 0 && !validationError && (
        <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20">
          <p className="text-[9px] font-bold text-emerald-700 dark:text-emerald-400 uppercase mb-1 flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5" />
            Como vai chegar {sampleRecipient ? '— exemplo do 1º recipiente' : ''}
          </p>
          <p className="text-xs text-emerald-900 dark:text-emerald-200 whitespace-pre-wrap leading-relaxed">
            {renderPreview(selected.preview, value.params, sampleRecipient)}
          </p>
        </div>
      )}

      {/* Validation error */}
      {validationError && (
        <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
          <p className="text-[10px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
            {validationError}
          </p>
        </div>
      )}

      {/* Hello world é template sem variáveis — confirma OK */}
      {selected && variableCount === 0 && (
        <div className="px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
          <p className="text-[10px] text-blue-700 dark:text-blue-400">
            <Check className="w-3 h-3 inline mr-1 -mt-0.5" />
            Template sem variáveis — pronto para envio
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Helper público — verifica se uma TemplateSelection está válida pra envio.
 *
 * @param sel — seleção atual
 * @param expectedVarCount — opcional: número de variáveis esperadas pelo template.
 *   Se passado, valida que sel.params.length === expectedVarCount (defesa contra
 *   sync incompleta após troca de template).
 */
export function isTemplateSelectionValid(
  sel: TemplateSelection | null,
  expectedVarCount?: number,
): boolean {
  if (!sel) return false;
  if (typeof expectedVarCount === 'number' && sel.params.length !== expectedVarCount) {
    return false;
  }
  // Header de mídia exigido (templates com format IMAGE/VIDEO/DOCUMENT). O
  // headerFormat é gravado na seleção quando o usuário escolhe o template —
  // callers externos (CRMModule, BirthdayCampaignDialog) não precisam saber
  // sobre essa regra, só passar a seleção.
  if (sel.headerFormat && !sel.headerMedia?.mediaId) return false;
  for (const p of sel.params) {
    if (p.kind === 'literal' && !p.value.trim()) return false;
    if (p.kind === 'csvColumn' && !p.column.trim()) return false;
  }
  return true;
}
