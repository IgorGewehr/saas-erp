'use client';

/**
 * Three composable editors for Settings → Agente IA (Wave 7 follow-up):
 *   - DeliveryZonesEditor  — CRUD for delivery coverage areas
 *   - UpsellRulesEditor    — CRUD for automated upsell rules
 *   - AgentSandbox         — test-drive the agent without affecting real conversations
 *
 * Each editor is self-contained and uncontrolled at the parent level — parent
 * just holds the array value + onChange callback. Parent is responsible for
 * persisting to Firestore via the AgenteTab save flow.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getAuth } from 'firebase/auth';
import {
  MapPin, Plus, Trash2, Edit2, Check, X, Loader2, Sparkles, Lightbulb, Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Delivery Zones ──────────────────────────────────────────────────────────

export type DeliveryZone = {
  name: string;
  type: 'radius' | 'neighborhood' | 'polygon';
  value: string;
  fee?: number;
  estimatedMinutes?: number;
};

const ZONE_TYPE_LABELS: Record<DeliveryZone['type'], string> = {
  radius: 'Raio (km)',
  neighborhood: 'Bairro',
  polygon: 'Polígono (GeoJSON)',
};

export function DeliveryZonesEditor({
  value,
  onChange,
}: {
  value: DeliveryZone[];
  onChange: (next: DeliveryZone[]) => void;
}) {
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<DeliveryZone | null>(null);

  const startAdd = () => {
    setDraft({ name: '', type: 'radius', value: '5', fee: 0, estimatedMinutes: 45 });
    setEditIdx(-1);
  };

  const startEdit = (idx: number) => {
    setDraft({ ...value[idx] });
    setEditIdx(idx);
  };

  const commit = () => {
    if (!draft || !draft.name.trim() || !draft.value.trim()) return;
    const clean: DeliveryZone = {
      name: draft.name.trim(),
      type: draft.type,
      value: draft.value.trim(),
      fee: typeof draft.fee === 'number' && draft.fee > 0 ? draft.fee : undefined,
      estimatedMinutes:
        typeof draft.estimatedMinutes === 'number' && draft.estimatedMinutes > 0
          ? draft.estimatedMinutes
          : undefined,
    };
    const next = [...value];
    if (editIdx === -1) next.push(clean);
    else if (editIdx !== null) next[editIdx] = clean;
    onChange(next);
    setDraft(null);
    setEditIdx(null);
  };

  const remove = (idx: number) => {
    const next = value.filter((_, i) => i !== idx);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Zonas onde o agente aceita entregas. Fora destas áreas, oferece retirada ou recusa educadamente.
      </p>

      {value.length === 0 && editIdx === null && (
        <div className="text-xs text-gray-400 italic py-2">
          Nenhuma zona cadastrada — o agente aceitará qualquer endereço.
        </div>
      )}

      <ul className="space-y-1.5">
        {value.map((z, idx) => (
          <li
            key={idx}
            className={cn(
              'flex items-center gap-2 p-2 rounded-lg border',
              editIdx === idx
                ? 'bg-violet-50/60 dark:bg-violet-950/30 border-violet-300 dark:border-violet-700'
                : 'bg-white dark:bg-gray-800/40 border-gray-200 dark:border-gray-700',
            )}
          >
            {editIdx === idx && draft ? (
              <ZoneForm draft={draft} setDraft={setDraft} onCommit={commit} onCancel={() => { setEditIdx(null); setDraft(null); }} />
            ) : (
              <>
                <MapPin className="w-4 h-4 text-violet-500 flex-shrink-0" />
                <div className="flex-1 text-sm min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{z.name}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {ZONE_TYPE_LABELS[z.type]}: <code className="text-[11px]">{z.value}</code>
                    {z.fee !== undefined && ` · R$ ${z.fee.toFixed(2)}`}
                    {z.estimatedMinutes !== undefined && ` · ~${z.estimatedMinutes}min`}
                  </div>
                </div>
                <button onClick={() => startEdit(idx)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => remove(idx)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-500/20 text-gray-500 hover:text-red-600">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {editIdx === -1 && draft && (
        <div className="p-2 rounded-lg bg-violet-50/60 dark:bg-violet-950/30 border border-violet-300 dark:border-violet-700">
          <ZoneForm draft={draft} setDraft={setDraft} onCommit={commit} onCancel={() => { setEditIdx(null); setDraft(null); }} />
        </div>
      )}

      {editIdx === null && (
        <button
          onClick={startAdd}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white"
        >
          <Plus className="w-3.5 h-3.5" /> Adicionar zona
        </button>
      )}
    </div>
  );
}

function ZoneForm({
  draft,
  setDraft,
  onCommit,
  onCancel,
}: {
  draft: DeliveryZone;
  setDraft: (d: DeliveryZone | null) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
      <div>
        <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Nome</label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Ex: Zona Centro"
          className="w-full px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
        />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Tipo</label>
        <select
          value={draft.type}
          onChange={(e) => setDraft({ ...draft, type: e.target.value as DeliveryZone['type'] })}
          className="w-full px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
        >
          <option value="radius">Raio (km)</option>
          <option value="neighborhood">Bairro</option>
          <option value="polygon">Polígono</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">
          Valor ({draft.type === 'radius' ? 'distância em km' : draft.type === 'neighborhood' ? 'nome do bairro' : 'GeoJSON stringificado'})
        </label>
        <input
          type="text"
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          className="w-full px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
        />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Taxa (R$, opcional)</label>
        <input
          type="number"
          min={0}
          step={0.5}
          value={draft.fee ?? ''}
          onChange={(e) => setDraft({ ...draft, fee: Number(e.target.value) || 0 })}
          className="w-full px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
        />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">ETA (min, opcional)</label>
        <input
          type="number"
          min={0}
          max={240}
          value={draft.estimatedMinutes ?? ''}
          onChange={(e) => setDraft({ ...draft, estimatedMinutes: Number(e.target.value) || 0 })}
          className="w-full px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
        />
      </div>
      <div className="sm:col-span-2 flex justify-end gap-1 mt-1">
        <button onClick={onCancel} className="px-2 py-1 text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <X className="w-3 h-3" /> Cancelar
        </button>
        <button onClick={onCommit} disabled={!draft.name.trim() || !draft.value.trim()} className="px-2 py-1 text-[11px] font-semibold bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1">
          <Check className="w-3 h-3" /> Salvar
        </button>
      </div>
    </div>
  );
}

// ─── Upsell Rules ────────────────────────────────────────────────────────────

export type UpsellRule = {
  id: string;
  trigger: string;
  suggestion: string;
  isActive: boolean;
};

export function UpsellRulesEditor({
  value,
  onChange,
}: {
  value: UpsellRule[];
  onChange: (next: UpsellRule[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UpsellRule | null>(null);

  const startAdd = () => {
    const rule: UpsellRule = {
      id: `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      trigger: '',
      suggestion: '',
      isActive: true,
    };
    setDraft(rule);
    setEditingId(rule.id);
  };

  const startEdit = (rule: UpsellRule) => {
    setDraft({ ...rule });
    setEditingId(rule.id);
  };

  const commit = () => {
    if (!draft || !draft.trigger.trim() || !draft.suggestion.trim()) return;
    const clean: UpsellRule = {
      id: draft.id,
      trigger: draft.trigger.trim().slice(0, 300),
      suggestion: draft.suggestion.trim().slice(0, 300),
      isActive: draft.isActive,
    };
    const existing = value.find((r) => r.id === clean.id);
    const next = existing ? value.map((r) => (r.id === clean.id ? clean : r)) : [...value, clean];
    onChange(next);
    setDraft(null);
    setEditingId(null);
  };

  const remove = (id: string) => {
    onChange(value.filter((r) => r.id !== id));
  };

  const toggle = (id: string) => {
    onChange(value.map((r) => (r.id === id ? { ...r, isActive: !r.isActive } : r)));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        O agente sugere o item da direita quando a condição da esquerda é satisfeita. Ex:
        <em> &ldquo;item de pizza no carrinho&rdquo; → &ldquo;oferecer refrigerante 2L&rdquo;.</em>
      </p>

      {value.length === 0 && editingId === null && (
        <div className="text-xs text-gray-400 italic py-2">
          Nenhuma regra de upsell — o agente não ofereceria nada além do pedido.
        </div>
      )}

      <ul className="space-y-1.5">
        {value.map((rule) => (
          <li
            key={rule.id}
            className={cn(
              'p-2 rounded-lg border',
              editingId === rule.id
                ? 'bg-violet-50/60 dark:bg-violet-950/30 border-violet-300 dark:border-violet-700'
                : 'bg-white dark:bg-gray-800/40 border-gray-200 dark:border-gray-700',
              !rule.isActive && 'opacity-60',
            )}
          >
            {editingId === rule.id && draft ? (
              <RuleForm draft={draft} setDraft={setDraft} onCommit={commit} onCancel={() => { setEditingId(null); setDraft(null); }} />
            ) : (
              <div className="flex items-start gap-2">
                <Lightbulb className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 text-sm min-w-0">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Quando:</div>
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{rule.trigger}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Ofereça:</div>
                  <div className="text-gray-700 dark:text-gray-300 truncate">{rule.suggestion}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <label className="inline-flex items-center gap-1 cursor-pointer text-[10px] text-gray-500">
                    <input
                      type="checkbox"
                      checked={rule.isActive}
                      onChange={() => toggle(rule.id)}
                      className="rounded"
                    />
                    Ativa
                  </label>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => startEdit(rule)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => remove(rule.id)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-500/20 text-gray-500 hover:text-red-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {editingId === null && (
        <button
          onClick={startAdd}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white"
        >
          <Plus className="w-3.5 h-3.5" /> Adicionar regra
        </button>
      )}
    </div>
  );
}

function RuleForm({
  draft,
  setDraft,
  onCommit,
  onCancel,
}: {
  draft: UpsellRule;
  setDraft: (d: UpsellRule | null) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Quando (condição em pt-BR)</label>
        <input
          type="text"
          value={draft.trigger}
          onChange={(e) => setDraft({ ...draft, trigger: e.target.value })}
          placeholder="cliente adicionou uma pizza grande"
          className="w-full px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
        />
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Ofereça</label>
        <input
          type="text"
          value={draft.suggestion}
          onChange={(e) => setDraft({ ...draft, suggestion: e.target.value })}
          placeholder="sugerir refrigerante 2L com desconto"
          className="w-full px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs"
        />
      </div>
      <div className="flex justify-between items-center">
        <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
            className="rounded"
          />
          Ativa
        </label>
        <div className="flex gap-1">
          <button onClick={onCancel} className="px-2 py-1 text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <X className="w-3 h-3" /> Cancelar
          </button>
          <button onClick={onCommit} disabled={!draft.trigger.trim() || !draft.suggestion.trim()} className="px-2 py-1 text-[11px] font-semibold bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1">
            <Check className="w-3 h-3" /> Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sandbox ─────────────────────────────────────────────────────────────────

/**
 * Test panel for the operator agent — sends a message to /api/agent/operator/chat
 * and shows the full trace (response + tool calls + cost) without affecting
 * real conversations or persistent memory.
 */
export function AgentSandbox() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<{
    response?: string;
    toolCalls?: Array<{ name: string; error?: string }>;
    durationMs?: number;
    costUsd?: number;
    error?: string;
  } | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    const message = input.trim();
    if (!message) return;
    setRunning(true);
    setResult(null);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error('Sem autenticação');
      const res = await fetch('/api/agent/operator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, history: [], sessionId: `sandbox_${Date.now()}` }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult({
        response: data.response,
        toolCalls: data.toolCalls,
        durationMs: data.durationMs,
        costUsd: data.costUsd,
      });
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Envie uma mensagem de teste ao agente. Retorna resposta + tools executadas + latência +
        custo. Usa sessionId isolado (não afeta conversas reais). Custo cobra no budget do tenant.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !running && run()}
          placeholder='Ex: "quais produtos estão com estoque baixo?"'
          className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30"
          disabled={running}
        />
        <button
          onClick={run}
          disabled={running || !input.trim()}
          className="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-1.5"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Testar
        </button>
      </div>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              'rounded-xl p-3 border',
              result.error
                ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
                : 'bg-violet-50/60 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800',
            )}
          >
            {result.error ? (
              <div className="text-xs">
                <strong>Erro:</strong> {result.error}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                  <span className="flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-violet-500" /> Resposta do agente
                  </span>
                  <span>
                    {result.durationMs && `${(result.durationMs / 1000).toFixed(1)}s`}
                    {result.costUsd !== undefined && result.costUsd > 0 && ` · $${result.costUsd.toFixed(4)}`}
                  </span>
                </div>
                <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                  {result.response || '(sem resposta)'}
                </div>
                {result.toolCalls && result.toolCalls.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-[11px] text-violet-600 dark:text-violet-400 cursor-pointer">
                      {result.toolCalls.length} tool call{result.toolCalls.length > 1 ? 's' : ''}
                    </summary>
                    <ul className="mt-1.5 space-y-1">
                      {result.toolCalls.map((t, i) => (
                        <li
                          key={i}
                          className={cn(
                            'text-[11px] font-mono px-2 py-1 rounded',
                            t.error
                              ? 'bg-red-100 dark:bg-red-500/10 text-red-800 dark:text-red-300'
                              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300',
                          )}
                        >
                          {t.name}
                          {t.error && ` — ⚠ ${t.error}`}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
