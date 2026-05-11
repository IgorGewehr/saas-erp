'use client';

/**
 * SpreadsheetsModule — módulo "Planilhas".
 *
 * Lista de planilhas do tenant + editor full-screen quando uma é aberta.
 * Padrão multi-user via onSnapshot (segue refactor de sync). Soft-delete
 * em vez de hard-delete (preserva histórico igual clients).
 *
 * Permissão por setor — replica padrão Kanban: visibility ∈ {'private',
 * 'sectors', 'all'}. Operadores só veem planilhas que têm acesso.
 *
 * Editor é lazy-loaded (Univer ~300KB). Quando user volta pra lista, o
 * editor desmonta e libera o canvas.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, FileSpreadsheet, ArrowLeft, Trash2,
  Lock, Users as UsersIcon, Globe, AlertCircle,
  Loader2, Upload, Save, Check, Pencil,
} from 'lucide-react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, doc,
} from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { formatDateTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { Spreadsheet, SpreadsheetVisibility } from '@/lib/types';
import { toast } from 'react-toastify';
import { importCsvToWorkbook, suggestSheetNameFromFile } from './csv-import';
import type { SpreadsheetEditorHandle } from './SpreadsheetEditor';

// Editor é lazy + ssr:false (Univer usa canvas/window). `next/dynamic` faz
// ref-forwarding pra componentes forwardRef — o cast pelo SpreadsheetEditorHandle
// no useRef é o que dá tipagem correta no callsite.
const SpreadsheetEditor = dynamic(() => import('./SpreadsheetEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-6 h-6 animate-spin text-red-500" />
    </div>
  ),
});

// ─── Sanitize helper ─────────────────────────────────────────────────────────
// Univer's `workbook.save()` retorna IWorkbookData com campos opcionais que
// podem ser `undefined`. Firestore rejeita `updateDoc` com undefined em
// qualquer chave (FirebaseError: Function updateDoc() called with invalid
// data. Unsupported field value: undefined).
//
// Roundtrip via JSON serializa undefined → omitido (preserva null), perde
// funções/symbols (não existem no IWorkbookData), e Date (Univer não usa).
// Custo: 1x serialização extra a cada save. Aceitável dado debounce 1.5s.
function sanitizeForFirestore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ─── Lock helpers ─────────────────────────────────────────────────────────────
// Lock visual cooperativo. Quando user abre uma planilha standalone, marca
// currentEditorId/editingExpiresAt. TTL longo (90s) — heartbeat opcional
// renova enquanto editor montado. Outro user que tenta abrir vê o badge mas
// pode editar mesmo assim (last-writer-wins). Sem race-free atomic, conflict
// raro em prática (1 editor por planilha é o caso comum).
const LOCK_TTL_MS = 90_000;
const LOCK_HEARTBEAT_MS = 30_000;

// ─── Visibility config ───────────────────────────────────────────────────────
const VISIBILITY_CFG: Record<SpreadsheetVisibility, { label: string; icon: React.ElementType; color: string }> = {
  private: { label: 'Privada',     icon: Lock,     color: 'text-gray-500 dark:text-gray-400' },
  sectors: { label: 'Por setor',   icon: UsersIcon, color: 'text-blue-500 dark:text-blue-400' },
  all:     { label: 'Toda equipe', icon: Globe,    color: 'text-emerald-500 dark:text-emerald-400' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Decide se o user tem acesso a uma planilha com base no padrão de
 *  visibilidade.
 *
 *  IMPORTANTE: 'private' é privado de verdade — NEM ADMIN/FOUNDER bypassa.
 *  Quem marcou Privada espera privacidade total; bypass de admin quebrava
 *  essa expectativa e vazava planilhas pessoais pro topo da hierarquia.
 *  Pra 'sectors' admin ainda bypassa (moderação cross-setor faz sentido). */
function canUserAccess(s: Spreadsheet, userId: string, userRole: string, userSectorIds: string[]): boolean {
  // Owner sempre vê o que criou (independente de role).
  if (s.ownerId === userId) return true;
  if (s.visibility === 'all') return true;
  if (s.visibility === 'private') return false;
  if (s.visibility === 'sectors') {
    if (ROLE_HIERARCHY[userRole as keyof typeof ROLE_HIERARCHY] >= ROLE_HIERARCHY['admin']) return true;
    return (s.sectorIds || []).some(sid => userSectorIds.includes(sid));
  }
  return false;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function SpreadsheetsModule() {
  const { user, business, userSectorIds } = useAuth();
  const [spreadsheets, setSpreadsheets] = useState<Spreadsheet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [openId, setOpenId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Spreadsheet | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  // Estado intermediário do import — depois do parse, antes da gravação.
  // Guarda o workbook parsado pra reusar quando o user confirma no modal.
  const [pendingImport, setPendingImport] = useState<{
    workbook: Record<string, unknown>;
    rowCount: number;
    colCount: number;
    truncated: boolean;
    suggestedName: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = !!user && ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY['admin'];

  // ─── Listener de planilhas (real-time, multi-user) ──────────────────────────
  useEffect(() => {
    if (!business?.id) { setIsLoading(false); return; }
    setIsLoading(true);
    const q = query(
      collection(db, 'spreadsheets'),
      where('businessId', '==', business.id),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map(d => ({ ...d.data(), id: d.id } as Spreadsheet));
        setSpreadsheets(list);
        setIsLoading(false);
      },
      (err) => {
        console.error('[Spreadsheets] snapshot error:', err);
        setIsLoading(false);
      },
    );
    return () => unsub();
  }, [business?.id]);

  // Lista visível pro user (filtra deletadas + permissão).
  const visible = useMemo(() => {
    if (!user) return [];
    return spreadsheets
      .filter(s => !s.isDeleted)
      .filter(s => canUserAccess(s, user.uid, user.role, userSectorIds))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }, [spreadsheets, user, userSectorIds]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return visible;
    return visible.filter(s =>
      s.name.toLowerCase().includes(term) ||
      s.description?.toLowerCase().includes(term)
    );
  }, [visible, search]);

  // Planilha aberta no editor. Filtra deletadas + revalida acesso — se
  // outro user soft-deletou OU mudou a visibilidade pra 'private'/'sectors'
  // de modo a tirar acesso, retorna null e o render volta pra lista (defesa
  // em profundidade contra leak quando a visibility muda mid-sessão).
  const openSheet = useMemo(() => {
    if (!openId || !user) return null;
    const found = spreadsheets.find(s => s.id === openId);
    if (!found || found.isDeleted) return null;
    if (!canUserAccess(found, user.uid, user.role, userSectorIds)) return null;
    return found;
  }, [openId, spreadsheets, user, userSectorIds]);

  // Sync: se openId aponta pra planilha que sumiu (deletada/sem acesso),
  // limpa o state pra UI voltar pra lista limpa.
  useEffect(() => {
    if (openId && !openSheet) setOpenId(null);
  }, [openId, openSheet]);

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const handleCreate = useCallback(async (name: string, visibility: SpreadsheetVisibility) => {
    if (!user || !business?.id) return;
    try {
      const now = new Date().toISOString();
      const ref = await addDoc(collection(db, 'spreadsheets'), {
        businessId: business.id,
        source: 'standalone',
        name: name.trim() || 'Sem título',
        ownerId: user.uid,
        ownerName: user.name,
        visibility,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      setShowCreate(false);
      setOpenId(ref.id); // abre editor direto
    } catch (err) {
      console.error('[Spreadsheets] create error:', err);
      toast.error('Erro ao criar planilha');
    }
  }, [user, business?.id]);

  // ─── Importar CSV ───────────────────────────────────────────────────────────
  // Pipeline em 2 passos:
  //   1. parse (handleImportCsv) → faz o parse local e abre o modal de
  //      confirmação com summary + escolha de nome/visibilidade
  //   2. confirm (confirmImportCsv) → grava no Firestore com a visibilidade
  //      escolhida e abre o editor
  // Sem o modal, importação caía direto em 'private' silencioso (bug
  // reportado: user importava CSV e ficava só visível pra ele).
  const handleImportCsv = useCallback(async (file: File) => {
    if (!user || !business?.id) return;
    setIsImporting(true);
    try {
      const sheetName = suggestSheetNameFromFile(file.name);
      const result = await importCsvToWorkbook(file, sheetName);
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      const { workbook, rowCount, colCount, truncated } = result.data;
      // Não grava ainda — abre modal pra user confirmar nome + visibilidade.
      setPendingImport({
        workbook: workbook as unknown as Record<string, unknown>,
        rowCount,
        colCount,
        truncated,
        suggestedName: sheetName,
      });
    } catch (err) {
      console.error('[Spreadsheets] import csv parse error:', err);
      toast.error('Erro ao ler planilha');
    } finally {
      setIsImporting(false);
    }
  }, [user, business?.id]);

  const confirmImportCsv = useCallback(async (name: string, visibility: SpreadsheetVisibility) => {
    if (!user || !business?.id || !pendingImport) return;
    setIsImporting(true);
    try {
      const now = new Date().toISOString();
      const ref = await addDoc(collection(db, 'spreadsheets'), {
        businessId: business.id,
        source: 'standalone',
        name: name.trim() || pendingImport.suggestedName,
        ownerId: user.uid,
        ownerName: user.name,
        visibility,
        version: 1,
        // sanitize defensivo — buildWorkbookFromRows não emite undefined, mas
        // alinha com handleSaveSnapshot pra evitar regressão se o shape mudar.
        snapshot: sanitizeForFirestore(pendingImport.workbook),
        createdAt: now,
        updatedAt: now,
      });
      const { rowCount, colCount, truncated } = pendingImport;
      const summary = `${rowCount} linha${rowCount === 1 ? '' : 's'} × ${colCount} coluna${colCount === 1 ? '' : 's'}`;
      if (truncated) {
        toast.info(`Planilha importada (truncada em 5000 linhas) — ${summary}`);
      } else {
        toast.success(`Planilha importada — ${summary}`);
      }
      setPendingImport(null);
      setOpenId(ref.id);
    } catch (err) {
      console.error('[Spreadsheets] import csv save error:', err);
      toast.error('Erro ao importar planilha');
    } finally {
      setIsImporting(false);
    }
  }, [user, business?.id, pendingImport]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset value pra permitir reimportar o mesmo arquivo (browser não dispara
    // change de novo se o path é igual).
    e.target.value = '';
    if (file) void handleImportCsv(file);
  }, [handleImportCsv]);

  const handleSaveSnapshot = useCallback(async (id: string, snapshot: Record<string, unknown>) => {
    try {
      // Optimistic concurrency: incrementa version. Em race, last-writer-wins.
      const target = spreadsheets.find(s => s.id === id);
      const nextVersion = (target?.version ?? 0) + 1;
      await updateDoc(doc(db, 'spreadsheets', id), {
        snapshot: sanitizeForFirestore(snapshot),
        version: nextVersion,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[Spreadsheets] save snapshot error:', err);
      toast.error('Erro ao salvar planilha');
    }
  }, [spreadsheets]);

  // Atualiza metadados (nome + visibilidade) de planilha existente. Owner ou
  // admin podem editar — viewer/operator não-owner não tem o botão habilitado
  // (gating na UI), mas o check duplo aqui é defensivo. Mantém ownerId/businessId.
  //
  // Re-throw em erro (após o toast) pra que o modal callsite saiba que falhou
  // e mantenha o input do user pra retentativa — sem isso, o `await` no modal
  // resolvia sempre e o setShowMetadata(false) fechava mesmo em falha.
  const handleUpdateMetadata = useCallback(async (id: string, name: string, visibility: SpreadsheetVisibility) => {
    if (!user) throw new Error('user-not-loaded');
    const target = spreadsheets.find(s => s.id === id);
    if (!target) throw new Error('spreadsheet-not-found');
    const canEdit = target.ownerId === user.uid ||
      ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY['admin'];
    if (!canEdit) {
      toast.error('Sem permissão pra editar esta planilha');
      throw new Error('forbidden');
    }
    try {
      await updateDoc(doc(db, 'spreadsheets', id), {
        name: name.trim() || target.name,
        visibility,
        updatedAt: new Date().toISOString(),
      });
      toast.success('Planilha atualizada');
    } catch (err) {
      console.error('[Spreadsheets] update metadata error:', err);
      toast.error('Erro ao atualizar planilha');
      throw err;
    }
  }, [user, spreadsheets]);

  const handleSoftDelete = useCallback(async (s: Spreadsheet) => {
    if (!user) return;
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'spreadsheets', s.id), {
        isDeleted: true,
        deletedAt: now,
        deletedBy: user.uid,
        deletedByName: user.name,
        updatedAt: now,
      });
      toast.success('Planilha excluída');
      setDeleteConfirm(null);
      if (openId === s.id) setOpenId(null);
    } catch (err) {
      console.error('[Spreadsheets] delete error:', err);
      toast.error('Erro ao excluir');
    }
  }, [user, openId]);

  // ─── Render: editor full-screen quando uma planilha está aberta ────────────
  if (openSheet) {
    return (
      <SpreadsheetEditorScreen
        sheet={openSheet}
        currentUserId={user?.uid}
        currentUserName={user?.name}
        currentUserRole={user?.role}
        onClose={() => setOpenId(null)}
        onSave={(snap) => handleSaveSnapshot(openSheet.id, snap)}
        onUpdateMetadata={(name, visibility) => handleUpdateMetadata(openSheet.id, name, visibility)}
      />
    );
  }

  // ─── Render: lista ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6"
      >
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white font-display flex items-center gap-2.5">
            <FileSpreadsheet className="w-6 h-6 text-red-500" />
            Planilhas
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {visible.length} planilhas {business?.razaoSocial ? `em ${business.razaoSocial}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isImporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {isImporting ? 'Importando...' : 'Importar CSV'}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nova planilha
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="hidden"
        />
      </motion.div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar planilha por nome ou descrição..."
          className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400"
        />
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-red-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
            <FileSpreadsheet className="w-7 h-7 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
            {search.trim() ? 'Nenhuma planilha encontrada' : 'Nenhuma planilha ainda'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 max-w-sm">
            {search.trim()
              ? 'Tente outro termo de busca.'
              : 'Crie sua primeira planilha pra anotações, cálculos ou relatórios manuais.'}
          </p>
          {!search.trim() && (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <Plus className="w-4 h-4" />
              Criar planilha
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(s => (
            <SpreadsheetCard
              key={s.id}
              spreadsheet={s}
              onOpen={() => setOpenId(s.id)}
              onDelete={() => setDeleteConfirm(s)}
              canDelete={isAdmin || s.ownerId === user?.uid}
            />
          ))}
        </div>
      )}

      {/* Modal: criar */}
      <AnimatePresence>
        {showCreate && (
          <CreateModal
            onCancel={() => setShowCreate(false)}
            onCreate={handleCreate}
          />
        )}
      </AnimatePresence>

      {/* Modal: confirmar import de CSV (pede nome + visibilidade ANTES de gravar) */}
      <AnimatePresence>
        {pendingImport && (
          <ImportCsvModal
            pending={pendingImport}
            onCancel={() => setPendingImport(null)}
            onConfirm={confirmImportCsv}
            saving={isImporting}
          />
        )}
      </AnimatePresence>

      {/* Modal: confirmar exclusão */}
      <AnimatePresence>
        {deleteConfirm && (
          <DeleteConfirmModal
            spreadsheet={deleteConfirm}
            onCancel={() => setDeleteConfirm(null)}
            onConfirm={() => handleSoftDelete(deleteConfirm)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

/** Tela full-screen do editor com lock cooperativo. Sub-componente próprio
 *  pra ter ciclo de vida independente — useEffect de lock só dispara quando
 *  user abre uma planilha (vs a lista do módulo). */
function SpreadsheetEditorScreen({ sheet, currentUserId, currentUserName, currentUserRole, onClose, onSave, onUpdateMetadata }: {
  sheet: Spreadsheet;
  currentUserId?: string;
  currentUserName?: string;
  currentUserRole?: string;
  onClose: () => void;
  onSave: (snapshot: Record<string, unknown>) => Promise<void> | void;
  onUpdateMetadata: (name: string, visibility: SpreadsheetVisibility) => Promise<void> | void;
}) {
  const editorRef = useRef<SpreadsheetEditorHandle>(null);
  // Estado de "alterações pendentes" emitido pelo editor (true assim que o
  // user digita, false quando o save dispara). Drive do estado do botão.
  const [isDirty, setIsDirty] = useState(false);
  // True enquanto o updateDoc do save está em curso. Mostra spinner no
  // botão e impede saves concorrentes.
  const [isSaving, setIsSaving] = useState(false);
  // Quando o save manual termina com sucesso, marca true por alguns
  // segundos pra mostrar "Salvo agora" no botão (feedback de confirmação).
  const [savedFlashUntil, setSavedFlashUntil] = useState<number>(0);
  const [showMetadata, setShowMetadata] = useState(false);

  // Marca/limpa lock ao montar/desmontar. Heartbeat renova TTL enquanto
  // editor montado. Se outro user já tem lock vivo, render mostra warning
  // mas não bloqueia edição (last-writer-wins resolve via campo `version`).
  useEffect(() => {
    if (!currentUserId || !currentUserName) return;
    const ref = doc(db, 'spreadsheets', sheet.id);
    const setLock = () => {
      const now = Date.now();
      void updateDoc(ref, {
        currentEditorId: currentUserId,
        currentEditorName: currentUserName,
        editingExpiresAt: new Date(now + LOCK_TTL_MS).toISOString(),
      }).catch(err => console.error('[Spreadsheets] lock set error:', err));
    };
    setLock();
    const heartbeat = setInterval(setLock, LOCK_HEARTBEAT_MS);
    return () => {
      clearInterval(heartbeat);
      // Best-effort clear. Se a aba fechou abrupto (browser kill), TTL
      // expira sozinho em 90s e o lock some — sem orphan permanente.
      void updateDoc(ref, {
        currentEditorId: null,
        currentEditorName: null,
        editingExpiresAt: null,
      }).catch(() => { /* ok */ });
    };
  }, [sheet.id, currentUserId, currentUserName]);

  const canEdit = !!currentUserRole && (
    ROLE_HIERARCHY[currentUserRole as keyof typeof ROLE_HIERARCHY] >= ROLE_HIERARCHY['operator'] ||
    sheet.ownerId === currentUserId
  );

  // Permissão pra editar metadados — owner OU admin/founder. Operator que
  // só edita CONTEÚDO da planilha não pode mudar tag/nome.
  const canEditMetadata = !!currentUserRole && (
    sheet.ownerId === currentUserId ||
    ROLE_HIERARCHY[currentUserRole as keyof typeof ROLE_HIERARCHY] >= ROLE_HIERARCHY['admin']
  );

  // Detecta lock de OUTRO user (vivo: TTL não expirou).
  const otherEditor = useMemo(() => {
    if (!sheet.currentEditorId || sheet.currentEditorId === currentUserId) return null;
    if (!sheet.editingExpiresAt) return null;
    if (new Date(sheet.editingExpiresAt).getTime() < Date.now()) return null;
    return sheet.currentEditorName || 'Outro usuário';
  }, [sheet.currentEditorId, sheet.editingExpiresAt, sheet.currentEditorName, currentUserId]);

  // Wrapper que rastreia o ciclo de save (sync ou async). Recebe o snapshot
  // do editor (auto-save debounced OU save manual via saveNow) e roteia pro
  // onSave do pai, atualizando isSaving pra UI dar feedback visual.
  const handleSave = useCallback(async (snapshot: Record<string, unknown>) => {
    setIsSaving(true);
    try {
      await Promise.resolve(onSave(snapshot));
      // Flash "Salvo agora" por 2s — só pro user perceber a confirmação
      // depois de clicar manualmente. Em auto-save o flash também acontece
      // mas é menos perceptível porque o botão já estava enabled.
      setSavedFlashUntil(Date.now() + 2000);
    } finally {
      setIsSaving(false);
    }
  }, [onSave]);

  // Save manual: chama o handle exposto pelo editor (flush imediato do
  // debounce). Se já está salvando, ignora pra evitar disparo concorrente.
  const handleManualSave = useCallback(() => {
    if (isSaving) return;
    editorRef.current?.saveNow();
  }, [isSaving]);

  // Atalho Ctrl/Cmd+S — preempta o "Salvar página HTML" do browser e dispara
  // save manual. Comum em editores; user já espera esse keystroke aqui.
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleManualSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, handleManualSave]);

  // Reset do flash "Salvo agora" após o tempo. Sem isso, o cálculo
  // `Date.now() < savedFlashUntil` no render fica sticky — depois dos 2s
  // ninguém provoca re-render naturalmente, então o "Salvo" verde ficaria
  // permanente. Aqui agendamos um state-reset que força o re-render.
  useEffect(() => {
    if (!savedFlashUntil) return;
    const remaining = savedFlashUntil - Date.now();
    if (remaining <= 0) {
      setSavedFlashUntil(0);
      return;
    }
    const t = setTimeout(() => setSavedFlashUntil(0), remaining);
    return () => clearTimeout(t);
  }, [savedFlashUntil]);

  // Computa o estado visual do botão. Ordem de prioridade: saving > dirty
  // > flash > idle. "Salvo agora" só aparece por 2s logo após save success
  // pra não ficar permanente — depois disso volta pro estado "idle" (label
  // genérico "Salvo", desabilitado).
  const saveButtonState: 'saving' | 'dirty' | 'savedFlash' | 'idle' = isSaving
    ? 'saving'
    : isDirty
      ? 'dirty'
      : Date.now() < savedFlashUntil
        ? 'savedFlash'
        : 'idle';

  return (
    <div className="flex flex-col h-full">
      {/* Header do editor */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{sheet.name}</h2>
          {sheet.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{sheet.description}</p>
          )}
        </div>
        {otherEditor && (
          <div
            title="Conflito de edição — última escrita ganha"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 text-xs font-medium"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="truncate max-w-[180px]">{otherEditor} está editando</span>
          </div>
        )}
        {/* Botão Salvar — só renderiza se user pode editar conteúdo. Estado:
            'saving' (spinner) | 'dirty' (vermelho, ativo) | 'savedFlash'
            (verde por 2s após save) | 'idle' (cinza desabilitado). Ctrl/Cmd+S
            atalho também. */}
        {canEdit && (
          <button
            type="button"
            onClick={handleManualSave}
            disabled={saveButtonState === 'idle' || saveButtonState === 'saving'}
            title="Salvar agora (Ctrl+S)"
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
              saveButtonState === 'saving' && 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-wait',
              saveButtonState === 'dirty' && 'bg-red-600 hover:bg-red-700 text-white shadow-sm',
              saveButtonState === 'savedFlash' && 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 cursor-default',
              saveButtonState === 'idle' && 'bg-gray-50 dark:bg-gray-800/60 text-gray-400 dark:text-gray-500 cursor-default',
            )}
          >
            {saveButtonState === 'saving' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saveButtonState === 'dirty' && <Save className="w-3.5 h-3.5" />}
            {(saveButtonState === 'savedFlash' || saveButtonState === 'idle') && <Check className="w-3.5 h-3.5" />}
            {saveButtonState === 'saving' && 'Salvando...'}
            {saveButtonState === 'dirty' && 'Salvar'}
            {saveButtonState === 'savedFlash' && 'Salvo'}
            {saveButtonState === 'idle' && 'Salvo'}
          </button>
        )}
        {/* Badge de visibilidade — clicável se user pode editar metadados.
            Visualmente sinaliza com ícone de pencil e hover; pra demais users
            (operator/viewer não-owner) fica como badge informativo apenas. */}
        {canEditMetadata ? (
          <button
            type="button"
            onClick={() => setShowMetadata(true)}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
            title="Editar nome e visibilidade"
          >
            <SpreadsheetVisibilityBadge spreadsheet={sheet} />
            <Pencil className="w-3 h-3 text-gray-400" />
          </button>
        ) : (
          <SpreadsheetVisibilityBadge spreadsheet={sheet} />
        )}
      </div>
      <div className="flex-1 min-h-0">
        <SpreadsheetEditor
          ref={editorRef}
          snapshot={sheet.snapshot}
          onChange={handleSave}
          onDirtyChange={setIsDirty}
          readOnly={!canEdit}
        />
      </div>

      {/* Modal de edição de metadados — só monta quando aberto. Só fecha se
          o update resolver com sucesso (handleUpdateMetadata throws em erro);
          em falha o modal continua aberto pra user retentar sem perder input. */}
      <AnimatePresence>
        {showMetadata && (
          <EditMetadataModal
            sheet={sheet}
            onCancel={() => setShowMetadata(false)}
            onSave={async (name, visibility) => {
              await Promise.resolve(onUpdateMetadata(name, visibility));
              setShowMetadata(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SpreadsheetVisibilityBadge({ spreadsheet }: { spreadsheet: Spreadsheet }) {
  const cfg = VISIBILITY_CFG[spreadsheet.visibility];
  return (
    <div className={cn('inline-flex items-center gap-1.5 text-xs', cfg.color)}>
      <cfg.icon className="w-3.5 h-3.5" />
      <span>{cfg.label}</span>
    </div>
  );
}

function SpreadsheetCard({ spreadsheet, onOpen, onDelete, canDelete }: {
  spreadsheet: Spreadsheet;
  onOpen: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const cfg = VISIBILITY_CFG[spreadsheet.visibility];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className="group relative surface rounded-2xl p-4 cursor-pointer hover:shadow-md transition-shadow"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 flex items-center justify-center">
          <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        {canDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
            title="Excluir planilha"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1 truncate">
        {spreadsheet.name}
      </h3>
      {spreadsheet.description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-3">
          {spreadsheet.description}
        </p>
      )}
      <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
        <div className={cn('inline-flex items-center gap-1', cfg.color)}>
          <cfg.icon className="w-3 h-3" />
          <span>{cfg.label}</span>
        </div>
        <span>{formatDateTime(spreadsheet.updatedAt)}</span>
      </div>
    </motion.div>
  );
}

/** Picker de 3 botões (Privada / Por setor / Toda equipe). Usado tanto no
 *  CreateModal quanto no ImportCsvModal — extraído pra evitar duplicação. */
function VisibilityPicker({ value, onChange }: {
  value: SpreadsheetVisibility;
  onChange: (v: SpreadsheetVisibility) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {(Object.keys(VISIBILITY_CFG) as SpreadsheetVisibility[]).map(v => {
        const cfg = VISIBILITY_CFG[v];
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              'flex flex-col items-center gap-1 px-2 py-3 rounded-xl border text-xs transition-colors',
              value === v
                ? 'border-red-400 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04]',
            )}
          >
            <cfg.icon className="w-4 h-4" />
            {cfg.label}
          </button>
        );
      })}
    </div>
  );
}

function CreateModal({ onCancel, onCreate }: {
  onCancel: () => void;
  onCreate: (name: string, visibility: SpreadsheetVisibility) => void;
}) {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<SpreadsheetVisibility>('private');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Nova planilha</h2>
        <label className="block mb-4">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Nome</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Fluxo de caixa Janeiro"
            autoFocus
            className="mt-1 w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400"
          />
        </label>
        <label className="block mb-6">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Visibilidade</span>
          <VisibilityPicker value={visibility} onChange={setVisibility} />
        </label>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]"
          >
            Cancelar
          </button>
          <button
            onClick={() => onCreate(name, visibility)}
            disabled={!name.trim()}
            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Criar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Modal pra editar nome e visibilidade de planilha existente. Aberto via
 *  click no badge do editor (só pra owner/admin). Default pré-preenchido
 *  com valores atuais; user altera e confirma. Conteúdo da planilha NÃO é
 *  tocado aqui (workbook segue intacto). */
function EditMetadataModal({ sheet, onCancel, onSave }: {
  sheet: Spreadsheet;
  onCancel: () => void;
  onSave: (name: string, visibility: SpreadsheetVisibility) => Promise<void> | void;
}) {
  const [name, setName] = useState(sheet.name);
  const [visibility, setVisibility] = useState<SpreadsheetVisibility>(sheet.visibility);
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== sheet.name || visibility !== sheet.visibility;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={saving ? undefined : onCancel}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Editar planilha</h2>
        <label className="block mb-4">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Nome</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            className="mt-1 w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400"
          />
        </label>
        <label className="block mb-6">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Visibilidade</span>
          <VisibilityPicker value={visibility} onChange={setVisibility} />
        </label>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={async () => {
              if (!dirty || !name.trim()) return;
              setSaving(true);
              // catch silencioso: parent já mostra toast de erro. O re-throw
              // do handleUpdateMetadata mantém o modal aberto (sucesso fecha
              // via setShowMetadata(false) DEPOIS deste await), e o catch
              // aqui evita unhandled promise rejection.
              try { await onSave(name, visibility); }
              catch { /* mantém modal aberto pra retentativa */ }
              finally { setSaving(false); }
            }}
            disabled={!dirty || !name.trim() || saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Modal pra confirmar import de CSV. Renderiza DEPOIS do parse — assim
 *  exibe summary (linhas × colunas) e o user já marca a visibilidade antes
 *  da gravação. Nome vem pré-preenchido com sugestão do filename, editável. */
function ImportCsvModal({ pending, onCancel, onConfirm, saving }: {
  pending: { suggestedName: string; rowCount: number; colCount: number; truncated: boolean };
  onCancel: () => void;
  onConfirm: (name: string, visibility: SpreadsheetVisibility) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(pending.suggestedName);
  const [visibility, setVisibility] = useState<SpreadsheetVisibility>('private');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={saving ? undefined : onCancel}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Importar planilha</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          {pending.rowCount.toLocaleString('pt-BR')} linha{pending.rowCount === 1 ? '' : 's'} × {pending.colCount} coluna{pending.colCount === 1 ? '' : 's'}
          {pending.truncated && ' (truncada em 5000 linhas)'}
        </p>
        <label className="block mb-4">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Nome</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nome da planilha"
            autoFocus
            className="mt-1 w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400"
          />
        </label>
        <label className="block mb-6">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Visibilidade</span>
          <VisibilityPicker value={visibility} onChange={setVisibility} />
        </label>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(name, visibility)}
            disabled={!name.trim() || saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? 'Importando...' : 'Importar'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function DeleteConfirmModal({ spreadsheet, onCancel, onConfirm }: {
  spreadsheet: Spreadsheet;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Excluir planilha?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              "{spreadsheet.name}" será movida pra lixeira (soft-delete). Pode ser restaurada por um admin.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]">
            Cancelar
          </button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold">
            Excluir
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
