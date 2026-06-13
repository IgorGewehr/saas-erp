/**
 * lib/contracts/fsm/fiscalDocument.ts — máquina de estados de FiscalDocument
 *
 *   pendente ────────► processando ───► autorizada ───► cancelada
 *      │  │                │  │            ▲
 *      │  └──► autorizada  │  └─► cancelada│   (cancelamento externo detectado
 *      │  └──► rejeitada   │               │    pela consulta — cStat 101/151/155)
 *      │  └──► erro        ├──► rejeitada  │
 *      │                   └──► erro       │
 *   contingencia ──► autorizada ───────────┘
 *      │  ├──► processando
 *      │  ├──► rejeitada      (expiração 24h ou rejeição na transmissão via cron)
 *      │  ├──► erro           (gateway devolve status='erro' na transmissão)
 *      │  └──► contingencia   (self-loop: retry rejeitado PRESERVA o doc elegível
 *      │                       — /api/fiscal/retry regrava 'contingencia' de propósito)
 *
 * Estados terminais: autorizada→cancelada é a única saída de autorizada;
 * rejeitada, cancelada e erro são terminais (reemissão cria um NOVO documento —
 * /api/fiscal/retry só aceita pendente|contingencia; a UI de "reemitir" para
 * rejeitada/erro dispara /api/fiscal/emit, que faz .add).
 *
 * Modelagem derivada dos write paths reais (auditoria P2 / R4):
 *   - emit/route.ts            → só CREATES (.add) — FSM não se aplica.
 *   - retry/route.ts           → pendente|contingencia → autorizada/processando/
 *                                rejeitada/erro; contingencia→contingencia (preserva).
 *   - cancel/route.ts          → autorizada → cancelada (reverseLinkedTransactions).
 *   - consultaStatusRunner.ts  → processando → autorizada/cancelada/rejeitada.
 *                                processando→cancelada existe porque a SEFAZ pode
 *                                reportar cancelamento feito por fora (portal/contador).
 *   - contingenciaRunner.ts    → contingencia → autorizada/processando/rejeitada/erro.
 *
 * 'rascunho' e 'denegada' aparecem em read paths legados (lib/types, agent tools,
 * API v1) mas NENHUM write path os grava — ficam fora do enum do FSM. Documentos
 * legados nesses status são pulados pelos guards (normalize → null).
 *
 * O gateway sefaz-api devolve status no masculino ('autorizado', 'rejeitado',
 * 'cancelado', 'denegado'). Os write paths antigos vazavam essas formas pro
 * Firestore (a UI filtra pelas femininas — docs ficavam invisíveis nas abas).
 * `normalizeFiscalDocumentStatus()` canoniza antes de gravar; 'denegado' vira
 * 'rejeitada' (denegação é recusa definitiva — mesma semântica operacional).
 *
 * TODO(R2): promover pra lib/contracts/domain/fiscalDocument.ts quando o
 * FiscalDocument migrar de lib/types/index.ts. Manter sincronizado com
 * lib/types/index.ts:FiscalDocStatus.
 */

import { z } from 'zod';

export const FISCAL_DOCUMENT_STATUSES = [
  'pendente',
  'processando',
  'contingencia',
  'autorizada',
  'rejeitada',
  'cancelada',
  'erro',
] as const;

export const FiscalDocumentStatusSchema = z.enum(FISCAL_DOCUMENT_STATUSES);
export type FiscalDocumentStatus = z.infer<typeof FiscalDocumentStatusSchema>;

export const FISCAL_DOCUMENT_TRANSITIONS: Record<FiscalDocumentStatus, ReadonlySet<FiscalDocumentStatus>> = {
  pendente:     new Set<FiscalDocumentStatus>(['processando', 'autorizada', 'rejeitada', 'erro']),
  processando:  new Set<FiscalDocumentStatus>(['autorizada', 'rejeitada', 'cancelada', 'erro']),
  contingencia: new Set<FiscalDocumentStatus>(['autorizada', 'processando', 'rejeitada', 'erro', 'contingencia']),
  autorizada:   new Set<FiscalDocumentStatus>(['cancelada']),
  rejeitada:    new Set<FiscalDocumentStatus>(), // terminal — reemissão cria novo doc
  cancelada:    new Set<FiscalDocumentStatus>(), // terminal
  erro:         new Set<FiscalDocumentStatus>(), // terminal — reemissão cria novo doc
};

export function canTransitionFiscalDocument(from: FiscalDocumentStatus, to: FiscalDocumentStatus): boolean {
  return FISCAL_DOCUMENT_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionFiscalDocument(from: FiscalDocumentStatus, to: FiscalDocumentStatus): void {
  if (!canTransitionFiscalDocument(from, to)) {
    throw new Error(`FiscalDocument FSM: transição inválida ${from} → ${to}`);
  }
}

/**
 * Canoniza um status cru (Firestore legado ou resposta do gateway sefaz-api)
 * para o enum do FSM. Retorna null para valores desconhecidos ou legados fora
 * do FSM ('rascunho') — caller decide (runners: logar e pular; rotas: 409).
 */
export function normalizeFiscalDocumentStatus(raw: unknown): FiscalDocumentStatus | null {
  const value = String(raw ?? '').trim().toLowerCase();
  switch (value) {
    case 'pendente': return 'pendente';
    case 'processando': return 'processando';
    case 'contingencia': return 'contingencia';
    case 'autorizada':
    case 'autorizado': return 'autorizada';
    case 'rejeitada':
    case 'rejeitado':
    case 'denegada':
    case 'denegado': return 'rejeitada';
    case 'cancelada':
    case 'cancelado': return 'cancelada';
    case 'erro': return 'erro';
    default: return null;
  }
}

/** Side-effects esperados por transição. Documentação para emitir eventos cross-módulo. */
export const FISCAL_DOCUMENT_TRANSITION_EFFECTS: Partial<Record<`${FiscalDocumentStatus}->${FiscalDocumentStatus}`, string[]>> = {
  'pendente->autorizada': [
    'commitInvoiceNumber (salvaguarda de migração — docs do regime antigo)',
    'Limpar originalRequest (payload de replay não é mais necessário)',
  ],
  'pendente->processando': ['commitInvoiceNumber (mesma salvaguarda)'],
  'contingencia->autorizada': ['Persistir protocolo SEFAZ; XML tpEmis=9 já era o artefato legal'],
  'contingencia->rejeitada': ['Expiração 24h (extemporaneidade) OU rejeição na transmissão — operador notificado na UI'],
  'processando->cancelada': ['Cancelamento externo detectado via consulta — espelhar estorno financeiro se houver'],
  'autorizada->cancelada': [
    'reverseLinkedTransactions: Transactions pago→cancelado (via saleId)',
    'Gravar canceledAt + cancelReason',
  ],
};

export const FISCAL_DOCUMENT_TERMINAL_STATUSES: ReadonlySet<FiscalDocumentStatus> = new Set([
  'rejeitada',
  'cancelada',
  'erro',
]);
