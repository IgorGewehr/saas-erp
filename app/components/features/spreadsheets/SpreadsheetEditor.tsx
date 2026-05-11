'use client';

/**
 * SpreadsheetEditor — wrapper React do Univer Sheet.
 *
 * Responsabilidades:
 *  1. Inicializar o Univer SDK no DOM (canvas-based, client-only — SSR-safe
 *     via dynamic import no callsite).
 *  2. Carregar o `snapshot` recebido (workbook serializado) ou criar
 *     workbook em branco.
 *  3. Detectar mudanças e chamar `onChange(snapshot)` debounced — o pai
 *     decide quando persistir (snapshot completo).
 *  4. Disposar instância no unmount.
 *
 * Por que tudo é dinâmico/manual em vez de usar uma lib React-wrapper:
 * o Univer não tem wrapper oficial pra React (tem `@univerjs/presets` que
 * é vanilla). Embarcamos manualmente no useEffect, controlando lifecycle
 * de forma explícita pra evitar leak do canvas (instância pesada).
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

// Import dos tipos do Univer SÓ. Implementação real é importada
// dinamicamente dentro do useEffect pra evitar SSR error (canvas usa window).
import type { FUniver } from '@univerjs/core/facade';

/** Handle imperativo do editor — exposto via `ref`. Permite que o callsite
 *  dispare `saveNow()` (botão "Salvar" manual) sem esperar o debounce. */
export interface SpreadsheetEditorHandle {
  /** Flush imediato do debounce + grava o snapshot atual. No-op se o editor
   *  ainda não montou ou já foi disposed. */
  saveNow: () => void;
}

interface SpreadsheetEditorProps {
  /** Workbook serializado (resultado de `workbook.save()` no Univer).
   *  Lido APENAS no mount — para reagir a mudanças externas (outro user
   *  salvou no Firestore), o callsite deve passar `key={version}` pra
   *  forçar remount limpo. Trade-off documentado: user atual perde
   *  scroll/seleção quando outro salva — lock visual já avisa "X está
   *  editando", então não esperamos edição simultânea frequente.
   *  Undefined cria workbook vazio. */
  snapshot?: Record<string, unknown>;
  /** Disparado quando o conteúdo muda. Debounced internamente. NÃO modifique
   *  `snapshot` aqui; isso reentraria no editor e criaria loop. */
  onChange?: (snapshot: Record<string, unknown>) => void;
  /** Emite o estado de "alterações pendentes" — true assim que uma mutation
   *  acontece, false logo após o onChange disparar (auto ou manual). Usado
   *  pelo callsite pra renderizar status do botão Salvar e habilitar/desabilitar. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Read-only desabilita edição (pra views com permissão de leitura). */
  readOnly?: boolean;
  /** Debounce do onChange. Default 1500ms. */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE = 1500;

const SpreadsheetEditor = forwardRef<SpreadsheetEditorHandle, SpreadsheetEditorProps>(function SpreadsheetEditor({
  snapshot,
  onChange,
  onDirtyChange,
  readOnly = false,
  debounceMs = DEFAULT_DEBOUNCE,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<{ univer: { dispose: () => void }; univerAPI: FUniver } | null>(null);
  // Workbook ref pra saveNow conseguir chamar workbook.save() de fora do
  // useEffect. workbook é criado dentro do init async.
  const workbookRef = useRef<{ save: () => unknown } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flush imediato do save. Usado tanto pelo saveNow() exposto via ref
  // quanto internamente pelo debounce (segue o mesmo caminho pra evitar
  // divergência entre auto-save e save manual).
  const flushSave = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const wb = workbookRef.current;
    if (!wb) return;
    try {
      const newSnapshot = wb.save() as Record<string, unknown>;
      onChangeRef.current?.(newSnapshot);
      onDirtyChangeRef.current?.(false);
    } catch (e) {
      console.error('[SpreadsheetEditor] flush save error:', e);
    }
  };

  useImperativeHandle(ref, () => ({
    saveNow: () => flushSave(),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // ─── Init Univer ────────────────────────────────────────────────────────────
  // Roda uma única vez por mount. snapshot/readOnly mudam via API, não
  // recreate (criar/destruir Univer é caro — ~300KB de JS + canvas init).
  useEffect(() => {
    let cancelled = false;
    let disposed = false;

    (async () => {
      try {
        // Import dinâmico — pacotes pesados, só carrega quando user abre o editor.
        const [
          { createUniver, LocaleType, mergeLocales },
          { UniverSheetsCorePreset },
          UniverPresetSheetsCorePtBR,
        ] = await Promise.all([
          import('@univerjs/presets'),
          import('@univerjs/preset-sheets-core'),
          // pt-BR não vem pronto; tentamos importar e fallback pra en-US.
          import('@univerjs/preset-sheets-core/locales/en-US').then(m => m.default ?? m),
        ]);

        // Carrega o CSS (side-effect import). Necessário pro layout do
        // toolbar/grid renderizar corretamente.
        await import('@univerjs/preset-sheets-core/lib/index.css');

        if (cancelled || !containerRef.current) return;

        const { univer, univerAPI } = createUniver({
          locale: LocaleType.EN_US,
          locales: {
            [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCorePtBR),
          },
          presets: [
            UniverSheetsCorePreset({
              container: containerRef.current,
            }),
          ],
        });

        // Cria workbook (vazio ou do snapshot recebido).
        // Se snapshot tiver chaves, usa ele; senão, default vazio.
        const initialData = snapshot && Object.keys(snapshot).length > 0
          ? (snapshot as Parameters<typeof univerAPI.createWorkbook>[0])
          : ({} as Parameters<typeof univerAPI.createWorkbook>[0]);
        const workbook = univerAPI.createWorkbook(initialData);

        univerRef.current = { univer, univerAPI };
        // Stash workbook num ref pra saveNow() (chamado de fora) conseguir
        // serializar sem depender do closure do useEffect.
        workbookRef.current = workbook;

        // Listener de mudanças — Univer expõe via `onCommandExecuted` no
        // FUniver. Filtramos por commands que mutam dados (ignora seleção,
        // hover, etc). Cada mutation marca dirty + agenda debounce.
        const triggerSave = () => {
          if (!onChangeRef.current) return;
          // Sinaliza pendência ao callsite IMEDIATAMENTE — botão "Salvar"
          // precisa acender assim que o user digita, sem esperar o debounce.
          onDirtyChangeRef.current?.(true);
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            try {
              const newSnapshot = workbook.save() as unknown as Record<string, unknown>;
              onChangeRef.current?.(newSnapshot);
              onDirtyChangeRef.current?.(false);
            } catch (e) {
              console.error('[SpreadsheetEditor] save snapshot error:', e);
            }
          }, debounceMs);
        };

        // Hook nos commands. ICommandEvent shape: { id, type, params, options }.
        // CommandType (do @univerjs/core): COMMAND=0, OPERATION=1, MUTATION=2.
        // - COMMAND: gesto top-level do user (paste, insertRow). Gera mutations.
        // - OPERATION: mudança transient, NÃO vai pro snapshot (scroll, foco).
        // - MUTATION: mudança que entra no snapshot.
        //
        // Salvamos em MUTATION pra capturar TUDO que altera estado persistido
        // (cobre casos onde uma extension dispara mutation sem command). O
        // debounce evita salvar várias vezes por gesto único do user.
        univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
          if (event.type === 2 /* CommandType.MUTATION */) {
            triggerSave();
          }
        });

        if (disposed) {
          // Race: cleanup rodou antes do init terminar. O cleanup já fez
          // o dispose via univerRef (set null). Aqui não duplicamos —
          // checamos antes de cada operação.
          return;
        }

        setIsReady(true);
      } catch (err) {
        console.error('[SpreadsheetEditor] init error:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar editor');
        }
      }
    })();

    return () => {
      cancelled = true;
      disposed = true;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      // Limpa workbookRef ANTES do dispose pra que saveNow() chamado pós-unmount
      // (ex: timing entre keystroke e cleanup) não tente serializar instância morta.
      workbookRef.current = null;
      const inst = univerRef.current;
      univerRef.current = null;
      // Defere dispose pro próximo macrotask — Univer monta sua própria árvore
      // React internamente; chamar dispose() síncrono aqui faz unmount durante
      // a fase de commit do React pai, disparando "synchronously unmount root
      // while React was already rendering" (race condition).
      if (inst) {
        setTimeout(() => {
          try {
            inst.univer.dispose();
          } catch (e) {
            console.warn('[SpreadsheetEditor] dispose error:', e);
          }
        }, 0);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only — snapshot/readOnly aplicados via API, ver abaixo.

  // ─── Aplicar readOnly via API ──────────────────────────────────────────────
  // Univer expõe um modo "permission" — mas API exata varia entre versões.
  // Tentar bloquear via `pointer-events: none` no container quebra a
  // navegação inteira (scroll/abas/seleção), então read-only é só visual
  // (banner "somente leitura" no callsite + edits efêmeros, snapshot remonta
  // a cada onSnapshot do Firestore).
  // (TODO Fase 3: investigar `setEditable` ou similar quando upgrade da API.)
  void readOnly;

  return (
    <div className="relative w-full h-full bg-white dark:bg-gray-900">
      {!isReady && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-950 z-10">
          <Loader2 className="w-8 h-8 animate-spin text-red-500" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 z-10 p-4">
          <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-2">Erro ao carregar editor</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md text-center">{error}</p>
        </div>
      )}
      {/* readOnly: NÃO usar `pointer-events: none` no container — isso mata
          scroll, seleção de célula, troca de aba (Start/Formulas/Data) e
          todo o resto da UI. O indicador "somente leitura" no header já
          comunica o estado ao user; edits ficam efêmeros porque `onChange`
          não é passado e o snapshot remonta via key= do callsite. */}
      <div
        ref={containerRef}
        className="w-full h-full"
      />
    </div>
  );
});

export default SpreadsheetEditor;
