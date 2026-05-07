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

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

// Import dos tipos do Univer SÓ. Implementação real é importada
// dinamicamente dentro do useEffect pra evitar SSR error (canvas usa window).
import type { FUniver } from '@univerjs/core/facade';

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
  /** Read-only desabilita edição (pra views com permissão de leitura). */
  readOnly?: boolean;
  /** Debounce do onChange. Default 1500ms. */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE = 1500;

export default function SpreadsheetEditor({
  snapshot,
  onChange,
  readOnly = false,
  debounceMs = DEFAULT_DEBOUNCE,
}: SpreadsheetEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<{ univer: { dispose: () => void }; univerAPI: FUniver } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

        // Listener de mudanças — Univer expõe via `onCommandExecuted` no
        // FUniver. Filtramos por commands que mutam dados (ignora seleção,
        // hover, etc). Cada mutation dispara debounce.
        const triggerSave = () => {
          if (!onChangeRef.current) return;
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = setTimeout(() => {
            try {
              const newSnapshot = workbook.save() as unknown as Record<string, unknown>;
              onChangeRef.current?.(newSnapshot);
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
      // Defere dispose pro próximo macrotask — Univer monta sua própria árvore
      // React internamente; chamar dispose() síncrono aqui faz unmount durante
      // a fase de commit do React pai, disparando "synchronously unmount root
      // while React was already rendering" (race condition).
      const inst = univerRef.current;
      univerRef.current = null;
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
  // Por enquanto deixamos só o estado visual disabled via CSS.
  // (TODO Fase 3: investigar `setEditable` ou similar quando upgrade da API.)

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
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ pointerEvents: readOnly ? 'none' : 'auto', opacity: readOnly ? 0.85 : 1 }}
      />
    </div>
  );
}
