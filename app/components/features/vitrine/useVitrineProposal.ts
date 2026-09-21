'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import type { BusinessPromotion, Product, ProductVariant } from '@/lib/types';
import type { ApiRequest } from '@/lib/services/vitrine/apiClient';
import { cancelDeal, closeDeal, type CloseDealStep } from '@/lib/services/vitrine/closeDeal';
import { generateIdempotencyKey } from '@/lib/utils/idempotencyKey';
import type { InstallmentScheduleEntry } from '@/lib/utils/installments';
import { formatCurrency } from '@/lib/utils/format';
import {
  addLine,
  buildCreateOrderBody,
  centsToMoney,
  checkProductForProposal,
  computeProposalTotals,
  getStockShortfalls,
  parseMoneyToCents,
  removeLine as removeProposalLine,
  setLineQuantity,
  syncLinesWithCatalog,
  toProposalLine,
  type ProposalLine,
} from '@/lib/utils/vitrineProposal';

export interface ProposalClient {
  id: string;
  name: string;
  /** Só pra o PDF: quando o cliente vem da lista/cadastro rápido, leva o contato junto. */
  company?: string;
  phone?: string;
  email?: string;
}

/** Foto do negócio no instante em que fechou — a tela "negócio fechado" não depende mais do rascunho. */
export interface ClosedDeal {
  orderId: string;
  client: ProposalClient;
  lines: ProposalLine[];
  subtotalCents: number;
  discountCents: number;
  discountReason?: string;
  totalCents: number;
  installments: number;
  transactionIds: string[];
  schedule: InstallmentScheduleEntry[];
}

/** Opções que só existem no PDF da proposta (não vão pro pedido). */
export interface PdfOptions {
  validityDays: number;
  notes: string;
}

const DEFAULT_PDF_OPTIONS: PdfOptions = { validityDays: 7, notes: '' };

export type DealPhase =
  | { kind: 'editing' }
  | { kind: 'closing'; step: CloseDealStep }
  /** O preço do catálogo mudou no meio da negociação; nada foi criado, pode editar e fechar de novo. */
  | { kind: 'stale'; message: string }
  /** Depois de qualquer falha além de "stale" a proposta fica travada (ver closeDeal.ts). */
  | { kind: 'failed'; message: string; orderId?: string; retryable: boolean }
  | { kind: 'done'; deal: ClosedDeal };

export const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 5, 6, 10, 12] as const;

interface UseVitrineProposalParams {
  businessId: string | undefined;
  /** Catálogo ativo em tempo real. */
  products: Product[];
  /** Falso até o 1º snapshot: sincronizar contra lista vazia apagaria a proposta inteira. */
  catalogReady: boolean;
  promotions: BusinessPromotion[];
  /** manager+ — o servidor recusa desconto de quem não é (403). */
  canNegotiate: boolean;
  request: ApiRequest;
}

export function useVitrineProposal(params: UseVitrineProposalParams) {
  const { businessId, products, catalogReady, promotions, canNegotiate, request } = params;

  const [lines, setLines] = useState<ProposalLine[]>([]);
  const [client, setClient] = useState<ProposalClient | null>(null);
  const [promotionId, setPromotionId] = useState<string | null>(null);
  const [negotiatedText, setNegotiatedTextState] = useState('');
  const [installments, setInstallments] = useState(1);
  const [phase, setPhase] = useState<DealPhase>({ kind: 'editing' });
  const [pdfOptions, setPdfOptions] = useState<PdfOptions>(DEFAULT_PDF_OPTIONS);

  // UMA chave por proposta (nunca por clique). É ela que faz o servidor devolver o mesmo pedido
  // em vez de criar outro; só é trocada ao começar/descartar uma proposta.
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const currentKey = () => (keyRef.current ??= generateIdempotencyKey());

  /** Recomeça do zero, com chave nova. */
  const reset = useCallback(() => {
    keyRef.current = null;
    setLines([]);
    setClient(null);
    setPromotionId(null);
    setNegotiatedTextState('');
    setInstallments(1);
    setPdfOptions(DEFAULT_PDF_OPTIONS);
    setPhase({ kind: 'editing' });
  }, []);

  const editable = phase.kind === 'editing' || phase.kind === 'stale';

  // Proposta acompanha o catálogo ao vivo enquanto ainda dá pra editar.
  useEffect(() => {
    if (!editable || !catalogReady) return;
    const synced = syncLinesWithCatalog(lines, products);
    if (synced.lines === lines) return;
    setLines(synced.lines);
    if (synced.removed.length > 0) toast.warning(`Saiu do catálogo e foi tirado da proposta: ${synced.removed.join(', ')}`);
    if (synced.repriced.length > 0) toast.info(`Preço atualizado: ${synced.repriced.join(', ')}`);
  }, [products, catalogReady, lines, editable]);

  const activePromotion = useMemo(
    () => (canNegotiate && promotionId ? promotions.find((promotion) => promotion.id === promotionId) ?? null : null),
    [canNegotiate, promotionId, promotions],
  );

  const negotiatedTotalCents = useMemo(
    () => (canNegotiate && negotiatedText.trim() !== '' ? parseMoneyToCents(negotiatedText) : null),
    [canNegotiate, negotiatedText],
  );
  const negotiatedInvalid = canNegotiate && negotiatedText.trim() !== '' && negotiatedTotalCents === null;

  const totals = useMemo(
    () => computeProposalTotals({ lines, promotion: activePromotion, negotiatedTotalCents, installments, now: new Date() }),
    [lines, activePromotion, negotiatedTotalCents, installments],
  );

  const shortfalls = useMemo(() => getStockShortfalls(lines, products), [lines, products]);

  const blockers = useMemo(() => {
    const reasons: string[] = [];
    if (lines.length === 0) reasons.push('Adicione ao menos um item.');
    if (!client) reasons.push('Escolha o cliente.');
    if (negotiatedInvalid) reasons.push('O valor negociado não é um número válido.');
    if (activePromotion && !totals.promotionApplies) {
      const minimum = activePromotion.minOrderValue ? ` (pedido mínimo de ${formatCurrency(activePromotion.minOrderValue)})` : '';
      reasons.push(`A promoção "${activePromotion.name}" não vale para este pedido${minimum}.`);
    }
    for (const shortfall of shortfalls) {
      reasons.push(`Sem saldo de ${shortfall.name}: pedido ${shortfall.requested}, disponível ${shortfall.available}.`);
    }
    if (lines.length > 0 && totals.totalCents <= 0) reasons.push('O total precisa ser maior que zero.');
    return reasons;
  }, [lines.length, client, negotiatedInvalid, activePromotion, totals, shortfalls]);

  const canClose = editable && blockers.length === 0;

  // Só edita enquanto o servidor não sabe de nada; depois de tentar fechar, vale o que foi enviado.
  const guardEdit = useCallback((change: () => void): boolean => {
    if (!editable) return false;
    if (phase.kind === 'stale') setPhase({ kind: 'editing' });
    change();
    return true;
  }, [editable, phase.kind]);

  const addProduct = useCallback((product: Product, variant?: ProductVariant): { ok: true } | { ok: false; reason: string } => {
    // Negócio já fechado: adicionar um item começa a próxima proposta (o fechado segue em Vendas/Financeiro).
    if (phase.kind !== 'done' && !editable) {
      return { ok: false, reason: 'A proposta está em fechamento — conclua ou descarte antes de adicionar itens.' };
    }
    const check = checkProductForProposal(product, variant);
    if (!check.ok) return check;

    if (phase.kind === 'done') {
      reset();
      setLines([toProposalLine(product, variant)]);
      return { ok: true };
    }
    guardEdit(() => setLines((current) => addLine(current, toProposalLine(product, variant))));
    return { ok: true };
  }, [phase.kind, editable, guardEdit, reset]);

  const setQuantity = useCallback((key: string, quantity: number) => {
    guardEdit(() => setLines((current) => setLineQuantity(current, key, quantity)));
  }, [guardEdit]);

  const removeItem = useCallback((key: string) => {
    guardEdit(() => setLines((current) => removeProposalLine(current, key)));
  }, [guardEdit]);

  const chooseClient = useCallback((next: ProposalClient | null) => {
    guardEdit(() => setClient(next));
  }, [guardEdit]);

  const choosePromotion = useCallback((id: string | null) => {
    guardEdit(() => {
      setPromotionId(id);
      if (id) setNegotiatedTextState('');
    });
  }, [guardEdit]);

  const setNegotiatedText = useCallback((text: string) => {
    guardEdit(() => {
      setNegotiatedTextState(text);
      if (text.trim() !== '') setPromotionId(null);
    });
  }, [guardEdit]);

  const chooseInstallments = useCallback((count: number) => {
    guardEdit(() => setInstallments(count));
  }, [guardEdit]);

  const execute = useCallback(async () => {
    if (inFlight.current || !businessId || !client) return;
    inFlight.current = true;
    setPhase({ kind: 'closing', step: 'create' });

    try {
      const body = buildCreateOrderBody({
        businessId,
        lines,
        clientId: client.id,
        clientName: client.name,
        discountCents: totals.discountCents,
        discountReason: totals.discountReason,
        installments,
        idempotencyKey: currentKey(),
      });

      const result = await closeDeal({
        businessId,
        body,
        request,
        onStep: (step) => setPhase({ kind: 'closing', step }),
      });

      if (result.status === 'done') {
        result.stockAlerts.forEach((alert) => {
          toast.warning(
            alert.severity === 'zeroed'
              ? `${alert.productName} esgotou`
              : `${alert.productName} no estoque mínimo (${alert.newStock}/${alert.minStock})`,
            { autoClose: 6000 },
          );
        });
        setPhase({
          kind: 'done',
          deal: {
            orderId: result.orderId,
            client,
            lines,
            subtotalCents: totals.subtotalCents,
            discountCents: totals.discountCents,
            ...(totals.discountReason ? { discountReason: totals.discountReason } : {}),
            totalCents: Math.round(result.total * 100),
            installments,
            transactionIds: result.transactionIds,
            schedule: totals.schedule,
          },
        });
      } else if (result.status === 'stale') {
        setPhase({ kind: 'stale', message: result.message });
      } else {
        setPhase({ kind: 'failed', message: result.message, orderId: result.orderId, retryable: result.retryable });
      }
    } finally {
      inFlight.current = false;
    }
  }, [businessId, client, lines, totals, installments, request]);

  const close = useCallback(async () => {
    if (canClose) await execute();
  }, [canClose, execute]);

  /** Retoma um fechamento que falhou por motivo passageiro (rede, servidor, falta de saldo). */
  const retry = useCallback(async () => {
    if (phase.kind === 'failed' && phase.retryable) await execute();
  }, [phase, execute]);

  /** Sai do estado "falhou" pra voltar a editar. Se já existe pedido, cancela antes. */
  const discard = useCallback(async () => {
    if (phase.kind !== 'failed' || inFlight.current) return;
    if (phase.orderId && businessId) {
      inFlight.current = true;
      try {
        const cancelled = await cancelDeal({ businessId, orderId: phase.orderId, request });
        if (!cancelled.ok) {
          setPhase({ ...phase, message: `Não foi possível cancelar o pedido: ${cancelled.message}` });
          return;
        }
      } finally {
        inFlight.current = false;
      }
    }
    keyRef.current = null;
    setPhase({ kind: 'editing' });
  }, [phase, businessId, request]);

  return {
    lines,
    client,
    promotionId: activePromotion?.id ?? null,
    negotiatedText,
    negotiatedInvalid,
    installments,
    phase,
    totals,
    shortfalls,
    blockers,
    canClose,
    editable,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    addProduct,
    setQuantity,
    removeItem,
    chooseClient,
    choosePromotion,
    setNegotiatedText,
    chooseInstallments,
    pdfOptions,
    setPdfValidityDays: (validityDays: number) => setPdfOptions((current) => ({ ...current, validityDays })),
    setPdfNotes: (notes: string) => setPdfOptions((current) => ({ ...current, notes })),
    close,
    retry,
    discard,
    reset,
    /** Total exibido no botão flutuante (reais). */
    totalMoney: centsToMoney(totals.totalCents),
  };
}

export type VitrineProposal = ReturnType<typeof useVitrineProposal>;
