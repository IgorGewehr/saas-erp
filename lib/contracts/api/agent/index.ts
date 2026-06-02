/**
 * lib/contracts/api/agent/index.ts
 *
 * Barrel: exporta o registry de TODAS as tools.
 * Permite o executor (TS ou Python via codegen) descobrir schemas por nome.
 */

import { z } from 'zod';

import * as Agenda from './agenda';
import * as Orders from './orders';
import * as Catalog from './catalog';
import * as Clients from './clients';
import * as Financial from './financial';
import * as CRM from './crm';
import * as Inventory from './inventory';
import * as Sales from './sales';
import * as Memory from './memory';
import * as Business from './business';
import * as Services from './services';
import * as Team from './team';
import * as Knowledge from './knowledge';
import * as Conversations from './conversations';
import * as Notes from './notes';
import * as PurchaseNotes from './purchase-notes';
import * as Suppliers from './suppliers';
import * as Kanban from './kanban';
import * as Fiscal from './fiscal';
import * as Reports from './reports';

export const AGENT_TOOL_DOMAINS = [
  'agenda', 'orders', 'catalog', 'clients', 'financial', 'crm',
  'inventory', 'sales', 'memory', 'business', 'services', 'team',
  'knowledge', 'conversations', 'notes', 'purchase-notes', 'suppliers',
  'kanban', 'fiscal', 'reports',
] as const;
export type AgentToolDomain = (typeof AGENT_TOOL_DOMAINS)[number];

/** Mapa domain → { request: discriminated union, data: map por action }. */
export const AGENT_TOOLS_REGISTRY = {
  agenda:           { request: Agenda.AgendaToolRequestSchema,            data: Agenda.AGENDA_DATA_SCHEMAS },
  orders:           { request: Orders.OrdersToolRequestSchema,             data: Orders.ORDERS_DATA_SCHEMAS },
  catalog:          { request: Catalog.CatalogToolRequestSchema,           data: Catalog.CATALOG_DATA_SCHEMAS },
  clients:          { request: Clients.ClientsToolRequestSchema,           data: Clients.CLIENTS_DATA_SCHEMAS },
  financial:        { request: Financial.FinancialToolRequestSchema,       data: Financial.FINANCIAL_DATA_SCHEMAS },
  crm:              { request: CRM.CRMToolRequestSchema,                   data: CRM.CRM_DATA_SCHEMAS },
  inventory:        { request: Inventory.InventoryToolRequestSchema,       data: Inventory.INVENTORY_DATA_SCHEMAS },
  sales:            { request: Sales.SalesToolRequestSchema,               data: Sales.SALES_DATA_SCHEMAS },
  memory:           { request: Memory.MemoryToolRequestSchema,             data: Memory.MEMORY_DATA_SCHEMAS },
  business:         { request: Business.BusinessToolRequestSchema,         data: Business.BUSINESS_DATA_SCHEMAS },
  services:         { request: Services.ServicesToolRequestSchema,         data: Services.SERVICES_DATA_SCHEMAS },
  team:             { request: Team.TeamToolRequestSchema,                 data: Team.TEAM_DATA_SCHEMAS },
  knowledge:        { request: Knowledge.KnowledgeToolRequestSchema,       data: Knowledge.KNOWLEDGE_DATA_SCHEMAS },
  conversations:    { request: Conversations.ConversationsToolRequestSchema, data: Conversations.CONVERSATIONS_DATA_SCHEMAS },
  notes:            { request: Notes.NotesToolRequestSchema,               data: Notes.NOTES_DATA_SCHEMAS },
  'purchase-notes': { request: PurchaseNotes.PurchaseNotesToolRequestSchema, data: PurchaseNotes.PURCHASE_NOTES_DATA_SCHEMAS },
  suppliers:        { request: Suppliers.SuppliersToolRequestSchema,       data: Suppliers.SUPPLIERS_DATA_SCHEMAS },
  kanban:           { request: Kanban.KanbanToolRequestSchema,             data: Kanban.KANBAN_DATA_SCHEMAS },
  fiscal:           { request: Fiscal.FiscalToolRequestSchema,             data: Fiscal.FISCAL_DATA_SCHEMAS },
  reports:          { request: Reports.ReportsToolRequestSchema,           data: Reports.REPORTS_DATA_SCHEMAS },
} as const satisfies Record<AgentToolDomain, { request: z.ZodTypeAny; data: Record<string, z.ZodTypeAny> }>;

/** Helper para obter o schema de response.data por (domain, action). Útil no executor Python via codegen. */
export function getAgentToolDataSchema(domain: AgentToolDomain, action: string): z.ZodTypeAny | undefined {
  const entry = AGENT_TOOLS_REGISTRY[domain];
  if (!entry) return undefined;
  return (entry.data as Record<string, z.ZodTypeAny>)[action];
}

export * from './_shared';
export * as agenda from './agenda';
export * as orders from './orders';
export * as catalog from './catalog';
export * as clients from './clients';
export * as financial from './financial';
export * as crm from './crm';
export * as inventory from './inventory';
export * as sales from './sales';
export * as memory from './memory';
export * as business from './business';
export * as services from './services';
export * as team from './team';
export * as knowledge from './knowledge';
export * as conversations from './conversations';
export * as notes from './notes';
export * as purchaseNotes from './purchase-notes';
export * as suppliers from './suppliers';
export * as kanban from './kanban';
export * as fiscal from './fiscal';
export * as reports from './reports';
