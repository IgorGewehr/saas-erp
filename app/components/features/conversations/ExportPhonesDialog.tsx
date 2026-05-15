'use client';

/**
 * ExportPhonesDialog — exporta telefones de uma lista de Conversations,
 * pra reutilizar como lista de destinatários em campanhas (paste no
 * RecipientListInput) OU baixar como CSV.
 *
 * Critério de extração (prioridade):
 *   1. Cliente vinculado (crmContactId → lookup em clientsById): mais limpo,
 *      mais provavelmente atualizado, normalizado.
 *   2. conversation.contactPhone (denormalized no doc da conversa).
 *   3. Sem nenhum dos dois → conversa ignorada (mas conta no resumo
 *      "X ignoradas" pra transparência).
 *
 * Dedup E.164 — mesmo telefone em 2 conversas conta 1x. Usa canonicalizeBr
 * do phone-br util pra normalizar.
 *
 * 2 modos de saída:
 *  - "Copiar telefones": 1 telefone por linha — formato compatível com paste
 *    direto no RecipientListInput do NewBroadcastDialog.
 *  - "Baixar CSV": 2 colunas (nome,telefone). Operador pode usar em Excel/
 *    Google Sheets ou subir como CSV em outro contexto.
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { Download, Copy, X, Phone, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import type { Conversation, Client } from '@/lib/types';
import { canonicalizeBr } from '@/lib/contracts/_runtime/phone-br';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Conversas a exportar — caller passa filteredConversations OU subset selecionado. */
  conversations: Conversation[];
  /** Lookup de clientes pra resolver telefone via cliente vinculado quando disponível. */
  clientsById: Map<string, Client>;
  /** Label opcional pra título — ex: "filtradas" ou "selecionadas". */
  sourceLabel?: string;
}

interface ExtractedRow {
  /** Telefone normalizado (canonicalizeBr ou contactPhone bruto se BR falhar). */
  phone: string;
  /** Nome pra exibir/CSV — cliente.name > customContactName > contactName > "Sem nome". */
  name: string;
}

export default function ExportPhonesDialog({ open, onClose, conversations, clientsById, sourceLabel }: Props) {
  // Extrai + dedup. Roda sempre que a lista de conversas muda. Caso típico:
  // operador abre o modal, vê preview, clica copiar — extração roda 1x.
  const { rows, ignoredCount } = useMemo(() => {
    const seen = new Set<string>();
    const out: ExtractedRow[] = [];
    let ignored = 0;
    for (const c of conversations) {
      // 1. Cliente vinculado (preferido)
      const client = c.crmContactId ? clientsById.get(c.crmContactId) : undefined;
      const rawPhone = client?.phone || client?.whatsapp || c.contactPhone || '';
      if (!rawPhone) {
        ignored++;
        continue;
      }
      // canonicalizeBr aceita formato livre e normaliza pra "55<DDD><N>".
      // Fallback pro dígito-cru quando não-BR (operador internacional usa).
      const normalized = canonicalizeBr(rawPhone) || rawPhone.replace(/\D/g, '');
      if (!normalized || normalized.length < 8) {
        ignored++;
        continue;
      }
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const name = client?.name || c.customContactName || c.contactName || 'Sem nome';
      out.push({ phone: normalized, name });
    }
    return { rows: out, ignoredCount: ignored };
  }, [conversations, clientsById]);

  const [copied, setCopied] = useState(false);

  // Reset do flag 'Copiado!' ao reabrir o modal — sem isso, se user copia em
  // modo filtered, fecha, reabre em selected dentro de 2s (antes do setTimeout
  // resetar), o botão ainda aparece verde "Copiado!" pra uma lista diferente.
  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  const handleCopy = async () => {
    if (rows.length === 0) return;
    try {
      const text = rows.map(r => r.phone).join('\n');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${rows.length} ${rows.length === 1 ? 'telefone copiado' : 'telefones copiados'} — cole no "Lista direta" do Nova Campanha`);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[ExportPhones] clipboard failed:', err);
      toast.error('Falha ao copiar — verifique permissões do navegador');
    }
  };

  const handleDownloadCsv = () => {
    if (rows.length === 0) return;
    // CSV simples: header + linhas. Aspas em nomes pra suportar vírgula.
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = ['nome,telefone', ...rows.map(r => `${escape(r.name)},${r.phone}`)].join('\n');
    // BOM pra Excel respeitar UTF-8 (acentos em nomes não viram caracteres estranhos)
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const datestamp = new Date().toISOString().slice(0, 10);
    a.download = `conversas-${datestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`CSV baixado — ${rows.length} ${rows.length === 1 ? 'linha' : 'linhas'}`);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: { borderRadius: '16px' } }}
    >
      <DialogTitle sx={{ pt: 2.5, pb: 1, px: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
            <Phone className="w-4 h-4 text-red-500" />
          </div>
          <div>
            <h3 className="text-base font-display font-bold text-gray-900 dark:text-gray-100">Exportar telefones</h3>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              {sourceLabel ? `Conversas ${sourceLabel}` : 'Conversas selecionadas'}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors">
          <X className="w-4 h-4 text-gray-400 dark:text-gray-500" />
        </button>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pt: 1, pb: 0 }}>
        {/* Stats card — preview do que vai sair */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-white/[0.02] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500 dark:text-gray-400">Conversas analisadas</span>
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100 tabular-nums">{conversations.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">Telefones únicos extraídos</span>
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{rows.length}</span>
          </div>
          {ignoredCount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Ignoradas (sem telefone)
              </span>
              <span className="text-sm font-bold text-amber-700 dark:text-amber-400 tabular-nums">{ignoredCount}</span>
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="text-center py-6 text-[11px] text-gray-400 dark:text-gray-500">
            Nenhum telefone válido nas conversas selecionadas.
          </div>
        ) : (
          <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700">
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.slice(0, 50).map((r, i) => (
                <li key={`${r.phone}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate min-w-0 flex-1">
                    {r.name}
                  </span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono shrink-0">
                    +{r.phone}
                  </span>
                </li>
              ))}
            </ul>
            {rows.length > 50 && (
              <div className="px-3 py-1.5 text-[10px] text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-white/[0.02] border-t border-gray-100 dark:border-gray-800">
                + {rows.length - 50} mais — copie/baixe pra ver todos
              </div>
            )}
          </div>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2.5, gap: 1, justifyContent: 'flex-end' }}>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
        >
          Fechar
        </button>
        <button
          onClick={handleDownloadCsv}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] disabled:opacity-50 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Baixar CSV
        </button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleCopy}
          disabled={rows.length === 0}
          className={cn(
            'inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50',
            copied
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-500/20',
          )}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado!' : 'Copiar telefones'}
        </motion.button>
      </DialogActions>
    </Dialog>
  );
}
