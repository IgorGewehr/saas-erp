'use client';

/**
 * lib/services/printing/printOrder.ts
 *
 * Orquestrador de impressão da comanda. Estratégia:
 *   1. Se há impressora WebUSB configurada como padrão da estação E o navegador
 *      suporta WebUSB → imprime DIRETO (silencioso) via ESC/POS.
 *   2. Se não há config, a concessão sumiu, ou o envio WebUSB falha (ex.: driver
 *      do SO reivindicou o dispositivo) → cai no FALLBACK: diálogo do navegador
 *      (printComanda, o caminho atual com <iframe> + @page).
 *
 * Assim o botão "Imprimir" sempre funciona: silencioso quando dá, diálogo quando
 * não dá — sem nunca travar o operador.
 */

import type { DeliveryOrder } from '@/lib/types';
import { printComanda } from '@/app/components/features/orders/ComandaTermica';
import { buildComandaEscPos } from './comandaEscpos';
import {
  isWebUsbSupported,
  getPrinterConfig,
  printBytesToDefault,
} from './webusbPrinter';

export interface PrintResult {
  method: 'webusb' | 'browser';
  /** Preenchido quando o WebUSB falhou e caímos no diálogo do navegador. */
  fallbackReason?: string;
}

/**
 * Imprime a comanda do pedido pela melhor via disponível. Nunca lança: em
 * qualquer falha do WebUSB, imprime pelo diálogo do navegador.
 */
export async function printOrder(
  order: DeliveryOrder,
  businessName: string,
  businessId: string,
): Promise<PrintResult> {
  // Largura conhecida da estação (mesmo no fallback: 58mm não deve imprimir em
  // layout 80mm). Sem config, usa 80mm (padrão).
  const paperWidth = getPrinterConfig(businessId)?.paperWidth ?? 80;
  const cfg = isWebUsbSupported() ? getPrinterConfig(businessId) : null;

  if (cfg) {
    try {
      const bytes = buildComandaEscPos(order, businessName, cfg.paperWidth);
      const sent = await printBytesToDefault(businessId, bytes);
      if (sent) return { method: 'webusb' };
      // Sem dispositivo autorizado disponível → fallback.
      printComanda(order, businessName, cfg.paperWidth);
      return { method: 'browser', fallbackReason: 'device-unavailable' };
    } catch (err) {
      // WebUSB configurado mas falhou (SO reivindicou, sem endpoint, etc.).
      console.warn('[print] WebUSB falhou, usando diálogo do navegador:', err);
      printComanda(order, businessName, cfg.paperWidth);
      return { method: 'browser', fallbackReason: err instanceof Error ? err.message : 'webusb-error' };
    }
  }

  // Sem impressora WebUSB configurada (ou navegador sem suporte) → diálogo.
  printComanda(order, businessName, paperWidth);
  return { method: 'browser' };
}
