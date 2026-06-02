/**
 * Agent tool: Reports (read-only / BI).
 *
 * P2.11 — expõe a agregação cross-coleção do ReportsModule ao agent (modo analyst).
 * Todas as actions são read-only: leem transactions/sales/orders/appointments/
 * clients filtrados por businessId (R1) e devolvem agregados via lib/services/reports.
 *
 * Actions:
 *   - revenue_by_period            receita/despesa/lucro/margem + por categoria
 *   - sales_by_product             ranking de produtos e serviços vendidos
 *   - appointments_by_professional total/conclusão/no-show/receita por profissional
 *   - top_clients                  ranking de clientes por CLV + visitas no período
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import { parseToolRequest, validateToolResponse, isContractError } from '@/contracts/_runtime/agentToolValidation';
import type { ReportsToolAction } from '@/contracts/api/agent/reports';
import {
  getPeriodRange,
  rangeFromDates,
  revenueByPeriod,
  salesByProduct,
  appointmentsByProfessional,
  topClients,
  type PeriodRange,
  type ReportPeriod,
} from '@/lib/services/reports';
import type { Appointment, Client, Order, Sale, Transaction } from '@/lib/types';
import { isActiveClient } from '@/lib/utils/clientFilters';

type Action = ReportsToolAction;

// Margens de segurança (iguais ao ReportsModule): alargam a janela server-side,
// nunca a estreitam — o recorte fino fica no inPeriod() dentro do serviço.
const SAFETY_DAYS = 1;
const TX_BACKDATE_DAYS = 90;

interface PeriodParams { period?: ReportPeriod; fromDate?: string; toDate?: string }

function resolveRange(p: PeriodParams): PeriodRange {
  if (p.fromDate && p.toDate) return rangeFromDates(p.fromDate, p.toDate);
  return getPeriodRange(p.period ?? '30d');
}

function shiftDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function createdAtBounds(range: PeriodRange, backdateDays = 0): { lo: string; hi: string } {
  return {
    lo: shiftDays(range.start, -(SAFETY_DAYS + backdateDays)).toISOString(),
    hi: shiftDays(range.end, SAFETY_DAYS).toISOString(),
  };
}

function dateStrBounds(range: PeriodRange): { lo: string; hi: string } {
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return {
    lo: fmt(shiftDays(range.start, -SAFETY_DAYS)),
    hi: fmt(shiftDays(range.end, SAFETY_DAYS)),
  };
}

// ─── Loaders (R1: todo query filtra businessId) ──────────────────────────────────

async function loadTransactions(businessId: string, range: PeriodRange): Promise<Transaction[]> {
  const { lo, hi } = createdAtBounds(range, TX_BACKDATE_DAYS);
  const snap = await adminDb.collection('transactions')
    .where('businessId', '==', businessId)
    .where('createdAt', '>=', lo)
    .where('createdAt', '<=', hi)
    .get();
  return snap.docs.map((d) => ({ ...(d.data() as Transaction), id: d.id }));
}

async function loadAppointments(businessId: string, range: PeriodRange): Promise<Appointment[]> {
  const { lo, hi } = dateStrBounds(range);
  const snap = await adminDb.collection('appointments')
    .where('businessId', '==', businessId)
    .where('date', '>=', lo)
    .where('date', '<=', hi)
    .get();
  return snap.docs.map((d) => ({ ...(d.data() as Appointment), id: d.id }));
}

async function loadSales(businessId: string, range: PeriodRange): Promise<Sale[]> {
  const { lo, hi } = createdAtBounds(range);
  const snap = await adminDb.collection('sales')
    .where('businessId', '==', businessId)
    .where('createdAt', '>=', lo)
    .where('createdAt', '<=', hi)
    .get();
  return snap.docs.map((d) => ({ ...(d.data() as Sale), id: d.id }));
}

async function loadOrders(businessId: string, range: PeriodRange): Promise<Order[]> {
  const { lo, hi } = createdAtBounds(range);
  const snap = await adminDb.collection('orders')
    .where('businessId', '==', businessId)
    .where('createdAt', '>=', lo)
    .where('createdAt', '<=', hi)
    .get();
  return snap.docs.map((d) => ({ ...(d.data() as Order), id: d.id }));
}

async function loadClients(businessId: string): Promise<Client[]> {
  // CLV usa o gasto acumulado (não recortado por período, igual ao ReportsModule),
  // então não filtramos clients por createdAt — só por tenant.
  const snap = await adminDb.collection('clients')
    .where('businessId', '==', businessId)
    .get();
  return snap.docs.map((d) => ({ ...(d.data() as Client), id: d.id })).filter(isActiveClient);
}

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await verifyAgentRequest(req);
  } catch (err) {
    const resp = agentAuthErrorResponse(err);
    if (resp) return resp;
    throw err;
  }

  const rawBody = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const { businessId } = ctx;

  let action: Action;
  let params: PeriodParams & { limit?: number };
  try {
    const parsed = parseToolRequest('reports', rawBody);
    action = parsed.action as Action;
    params = parsed.params as PeriodParams & { limit?: number };
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: 400 });
    }
    throw err;
  }

  try {
    const range = resolveRange(params);
    let data: unknown;

    switch (action) {
      case 'revenue_by_period': {
        const transactions = await loadTransactions(businessId, range);
        data = revenueByPeriod(transactions, range);
        break;
      }
      case 'sales_by_product': {
        const [sales, orders, appointments] = await Promise.all([
          loadSales(businessId, range),
          loadOrders(businessId, range),
          loadAppointments(businessId, range),
        ]);
        data = salesByProduct(sales, orders, appointments, range);
        break;
      }
      case 'appointments_by_professional': {
        const appointments = await loadAppointments(businessId, range);
        data = appointmentsByProfessional(appointments, range);
        break;
      }
      case 'top_clients': {
        const [clients, appointments] = await Promise.all([
          loadClients(businessId),
          loadAppointments(businessId, range),
        ]);
        data = topClients(clients, appointments, range, params.limit ?? 10);
        break;
      }
      default: {
        const exhaustiveCheck: never = action;
        return NextResponse.json({ ok: false, error: `Unknown action: ${exhaustiveCheck}` }, { status: 400 });
      }
    }

    const validated = validateToolResponse('reports', action, data);
    return NextResponse.json({ ok: true, data: validated });
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: err.code === 'INTERNAL' ? 500 : 400 });
    }
    console.error('[agent/tools/reports]', action, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
