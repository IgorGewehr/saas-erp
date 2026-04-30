/**
 * Cálculo de métricas agregadas de uma campanha (broadcast) a partir dos
 * documentos `BroadcastMessage` individuais.
 *
 * Função pura — sem side effects, sem chamadas a Firestore. O caller (UI ou
 * rota de relatório) é responsável por buscar os documentos.
 *
 * Métricas:
 *  - Counts: total, sent, delivered, read, failed, pending
 *  - Taxas: delivery (delivered/sent), read (read/delivered), failure (failed/total)
 *  - Tempos médios: até entrega (delivered - sent), até leitura (read - sent)
 *
 * Tempos retornam `null` quando não há amostras para calcular (evita NaN).
 */

import type { BroadcastMessage } from '@/lib/types';

export interface BroadcastMetrics {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  /** delivered / sent — quanto chegou de fato. Null se sent === 0. */
  deliveryRate: number | null;
  /** read / delivered — quanto foi lido. Null se delivered === 0. */
  readRate: number | null;
  /**
   * failed / (failed + sent) — taxa real sobre msgs PROCESSADAS (não inclui
   * pending). Evita diluir métrica quando há pile-up de pendentes em cron.
   * Null se nada foi processado ainda.
   */
  failureRate: number | null;
  /** Tempo médio entre `sentAt` e `deliveredAt` em ms. Null se não há amostras. */
  avgTimeToDeliveryMs: number | null;
  /** Tempo médio entre `sentAt` e `readAt` em ms. Null se não há amostras. */
  avgTimeToReadMs: number | null;
}

export function calculateBroadcastMetrics(messages: BroadcastMessage[]): BroadcastMetrics {
  let sent = 0, delivered = 0, read = 0, failed = 0, pending = 0;
  let deliverySum = 0, deliverySamples = 0;
  let readSum = 0, readSamples = 0;

  for (const m of messages) {
    switch (m.status) {
      case 'sent':
        sent++;
        break;
      case 'delivered':
        sent++; // delivered implica que foi enviado
        delivered++;
        break;
      case 'read':
        sent++;
        delivered++;
        read++;
        break;
      case 'failed':
        failed++;
        break;
      case 'pending':
      default:
        pending++;
    }

    // Calcula tempo até entrega/leitura — só se ambos timestamps existem
    if (m.sentAt && m.deliveredAt) {
      const dt = new Date(m.deliveredAt).getTime() - new Date(m.sentAt).getTime();
      if (Number.isFinite(dt) && dt >= 0) {
        deliverySum += dt;
        deliverySamples++;
      }
    }
    if (m.sentAt && m.readAt) {
      const dt = new Date(m.readAt).getTime() - new Date(m.sentAt).getTime();
      if (Number.isFinite(dt) && dt >= 0) {
        readSum += dt;
        readSamples++;
      }
    }
  }

  const total = messages.length;
  // Processadas = sent (incl. delivered/read) + failed. Exclui pending,
  // pra que pile-up de cron não dilua a taxa real de falha.
  const processed = sent + failed;

  return {
    total,
    sent,
    delivered,
    read,
    failed,
    pending,
    deliveryRate: sent > 0 ? delivered / sent : null,
    readRate: delivered > 0 ? read / delivered : null,
    failureRate: processed > 0 ? failed / processed : null,
    avgTimeToDeliveryMs: deliverySamples > 0 ? deliverySum / deliverySamples : null,
    avgTimeToReadMs: readSamples > 0 ? readSum / readSamples : null,
  };
}

/**
 * Formata duração em ms para uma string curta (ex: "2.3s", "1.5min", "3h").
 * Trunca para 1 casa decimal.
 */
export function formatDurationShort(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = sec / 60;
  if (min < 60) return `${min.toFixed(1)}min`;
  const hr = min / 60;
  if (hr < 24) return `${hr.toFixed(1)}h`;
  const days = hr / 24;
  return `${days.toFixed(1)}d`;
}

/**
 * Formata taxa (0-1) como porcentagem inteira. "—" se null.
 */
export function formatRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return '—';
  return `${Math.round(rate * 100)}%`;
}
