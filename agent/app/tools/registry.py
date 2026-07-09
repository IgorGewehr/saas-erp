"""Tool schemas for OpenAI function-calling.

Each schema is a dict matching OpenAI's `tools[].function` format. The LLM gets
these at planning time so it can propose structured calls; the executor node
runs the actual HTTP call via `client.call_tool`.

Rules of thumb:
  - Only expose tools relevant to the business's `use_case` (saves tokens).
  - Parameter names mirror the Next.js REST action params exactly.
  - Descriptions are short + action-oriented ("Create a new order") so the LLM
    can pick the right one without rambling CoT.
"""

from __future__ import annotations

from typing import Any, Literal

UseCase = Literal["pedidos", "servicos", "simples", "operator", "analyst"]


# ─── Orders (pedidos) ────────────────────────────────────────────────────────

ORDERS_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "orders_create",
            "description": (
                "Create a new delivery order for the customer. Use after confirming client name, "
                "items, delivery or pickup, address if delivery, and payment method. Returns the "
                "order id + sequential number + estimated delivery time.\n"
                'Example: {"clientName":"Ana","clientPhone":"5547999998888",'
                '"items":[{"productId":"prd_123","quantity":2}],'
                '"deliveryType":"entrega",'
                '"deliveryAddress":{"cep":"01310-100","logradouro":"Av Paulista",'
                '"numero":"1000","bairro":"Bela Vista","municipio":"São Paulo","uf":"SP"},'
                '"paymentMethod":"pix","channel":"whatsapp","conversationId":"conv_abc"}'
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "clientName": {"type": "string"},
                    "clientPhone": {"type": "string"},
                    "clientId": {"type": "string", "description": "Firestore id if already known"},
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "productId": {"type": "string"},
                                "quantity": {"type": "integer", "minimum": 1},
                                "notes": {"type": "string"},
                            },
                            "required": ["productId", "quantity"],
                        },
                    },
                    "deliveryType": {"type": "string", "enum": ["entrega", "retirada"]},
                    "deliveryAddress": {
                        "type": "object",
                        "properties": {
                            "cep": {"type": "string"},
                            "logradouro": {"type": "string"},
                            "numero": {"type": "string"},
                            "complemento": {"type": "string"},
                            "bairro": {"type": "string"},
                            "municipio": {"type": "string"},
                            "uf": {"type": "string"},
                            "reference": {"type": "string"},
                        },
                    },
                    "deliveryFee": {"type": "number"},
                    "discount": {"type": "number"},
                    "paymentMethod": {
                        "type": "string",
                        "enum": ["dinheiro", "cartao_credito", "cartao_debito", "pix", "voucher", "outro"],
                    },
                    "paymentStatus": {"type": "string", "enum": ["pendente", "pago", "estornado"]},
                    "changeFor": {"type": "number", "description": "Troco para (if paying cash)"},
                    "customerNotes": {"type": "string"},
                    "estimatedMinutes": {"type": "integer", "default": 45},
                    "channel": {
                        "type": "string",
                        "enum": ["whatsapp", "facebook", "instagram"],
                        "description": "Channel the order came from (use the contact's channel).",
                    },
                    "conversationId": {
                        "type": "string",
                        "description": "Current conversation id — links order to the chat for provenance.",
                    },
                },
                "required": ["clientName", "items", "deliveryType"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "orders_list_by_client",
            "description": "List a customer's most recent orders (by client id or phone).",
            "parameters": {
                "type": "object",
                "properties": {
                    "clientId": {"type": "string"},
                    "phone": {"type": "string"},
                    "limit": {"type": "integer", "default": 5},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "orders_get",
            "description": "Fetch full details of a single order by id.",
            "parameters": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "orders_cancel",
            "description": "Cancel an existing order. Provide a short human-readable reason.",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "orders_update_items",
            "description": (
                "Replace the items list of an existing order (for adds/removes before the kitchen starts). "
                "Only works when status is still 'recebido'. Fails once items are being prepared."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "productId": {"type": "string"},
                                "quantity": {"type": "integer", "minimum": 1},
                                "notes": {"type": "string"},
                            },
                            "required": ["productId", "quantity"],
                        },
                    },
                },
                "required": ["id", "items"],
            },
        },
    },
]


# ─── Agenda (servicos) ───────────────────────────────────────────────────────

AGENDA_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "agenda_list_services",
            "description": "List every active service offered (name, price, duration).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "agenda_list_professionals",
            "description": (
                "List professionals available. Pass serviceId to filter to those who "
                "offer that specific service."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "serviceId": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "agenda_check_availability",
            "description": (
                "Return free time slots for a given date. Always call before booking. "
                "If the user mentions a relative date, resolve it to YYYY-MM-DD first. "
                "Pass serviceId to filter professionals that actually offer the service, "
                "and the correct durationMinutes from the service catalog. "
                "GROUP SERVICES: when the service has capacity>1 or a weekly grid (sessions), "
                "slots are FIXED grid sessions and each carries `capacity` + `seatsAvailable`. "
                "Offer those fixed sessions and talk in terms of open seats; seatsAvailable=0 "
                "means the class is full (a business rule, NOT a technical error)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "YYYY-MM-DD"},
                    "professionalId": {"type": "string"},
                    "serviceId": {"type": "string"},
                    "durationMinutes": {"type": "integer", "default": 60},
                },
                "required": ["date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "agenda_get_next_available",
            "description": (
                "Find the FIRST day in the next `daysAhead` days that has available slots. "
                "Use when customer asks for the earliest available slot without specifying a date."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "serviceId": {"type": "string"},
                    "professionalId": {"type": "string"},
                    "durationMinutes": {"type": "integer", "default": 60},
                    "daysAhead": {"type": "integer", "default": 7, "description": "Max 30"},
                    "fromDate": {"type": "string", "description": "YYYY-MM-DD (default: today)"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "agenda_book",
            "description": (
                "Book a new appointment after confirming slot + client details. Call ONLY after "
                "the client picked an exact time via interactive list or typed confirmation.\n"
                'Example: {"clientName":"Ana","clientPhone":"5547999998888",'
                '"serviceId":"svc_corte","professionalId":"usr_lucas",'
                '"date":"2026-04-25","startTime":"14:30","duration":45,"price":60}\n'
                "GROUP SERVICES: pass the SAME serviceId/date/startTime/professionalId of the "
                "chosen grid session — the server derives the class key and seats the client. "
                "Possible status values: 'created' (booked / 1:1), 'joined' (added to a class with "
                "room), 'full' (class is full → offer another grid session, NOT a technical error), "
                "'conflict' (slot taken between check and book → use returned alternatives)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "clientId": {"type": "string"},
                    "clientName": {"type": "string"},
                    "clientPhone": {"type": "string"},
                    "serviceId": {"type": "string", "description": "Service ID from services_list or agenda_list_services"},
                    "serviceName": {"type": "string"},
                    "professionalId": {"type": "string", "description": "User ID from agenda_list_professionals response (field 'id')"},
                    "professionalName": {"type": "string"},
                    "date": {"type": "string", "description": "YYYY-MM-DD"},
                    "startTime": {"type": "string", "description": "HH:MM"},
                    "durationMinutes": {"type": "integer", "default": 60},
                    "price": {"type": "number"},
                    "notes": {"type": "string"},
                },
                "required": ["clientName", "serviceId", "date", "startTime", "durationMinutes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "agenda_list_today",
            "description": "List all today's appointments for the business (sorted by startTime). Use when operator asks 'que agendamentos tem hoje?'.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "agenda_list_upcoming",
            "description": (
                "List upcoming appointments from today onwards, excluding cancelled/completed. "
                "Use when operator asks 'próximo agendamento', 'agendamentos da semana', etc."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "default": 20, "description": "1-50"},
                    "daysAhead": {"type": "integer", "default": 7, "description": "dias à frente 1-60"},
                    "professionalId": {"type": "string", "description": "filtra por profissional"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "agenda_list_by_client",
            "description": "List a customer's existing appointments (by id or phone).",
            "parameters": {
                "type": "object",
                "properties": {
                    "clientId": {"type": "string"},
                    "phone": {"type": "string"},
                    "limit": {"type": "integer", "default": 5},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "agenda_update",
            "description": "Edit an appointment — change date, startTime, duration or status.",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "patch": {
                        "type": "object",
                        "properties": {
                            "date": {"type": "string"},
                            "startTime": {"type": "string"},
                            "duration": {"type": "integer"},
                            "status": {
                                "type": "string",
                                "enum": [
                                    "agendado", "confirmado", "em_andamento",
                                    "concluido", "cancelado", "nao_compareceu",
                                ],
                            },
                            "notes": {"type": "string"},
                        },
                    },
                },
                "required": ["id", "patch"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "agenda_cancel",
            "description": "Cancel an appointment.",
            "parameters": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
            },
        },
    },
]


# ─── Catalog (menu for pedidos mode) ─────────────────────────────────────────

CATALOG_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "catalog_list_menu",
            "description": (
                "List all deliverable products. Optional filters by category and/or dietary. "
                "Use when the customer asks 'what do you have?' or wants a full menu."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string"},
                    "dietary": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["vegan", "vegetarian", "glutenfree", "lactosefree",
                                     "organic", "picante", "alcool", "kids"],
                        },
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "catalog_list_categories",
            "description": (
                "List all menu categories with item counts. Use before offering options to "
                "understand what's available without loading every product."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "catalog_search",
            "description": (
                "Fuzzy search the menu by name/category/description. Tolerant to typos "
                "(e.g., 'margueritta' matches 'margherita'). Optional dietary filter."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "dietary": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["vegan", "vegetarian", "glutenfree", "lactosefree",
                                     "organic", "picante", "alcool", "kids"],
                        },
                    },
                },
                "required": ["query"],
            },
        },
    },
]


# ─── Clients (shared) ────────────────────────────────────────────────────────

CLIENT_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "clients_lookup_by_phone",
            "description": "Find a client by phone or WhatsApp. Returns null when none exists.",
            "parameters": {
                "type": "object",
                "properties": {"phone": {"type": "string"}},
                "required": ["phone"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clients_create",
            "description": (
                "Create a new client record. Called when lookup returns null. "
                "Pass `channel` + `externalId` (phone or Meta userId) so future inbound "
                "messages from the same contact auto-link."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "phone": {"type": "string"},
                    "whatsapp": {"type": "string"},
                    "email": {"type": "string"},
                    "source": {
                        "type": "string",
                        "enum": ["site", "indicacao", "whatsapp", "instagram", "facebook",
                                 "google_ads", "linkedin", "evento", "email", "telefone", "outro"],
                    },
                    "channel": {
                        "type": "string",
                        "enum": ["whatsapp", "facebook", "instagram"],
                        "description": "The channel this contact reached us through (for auto-link).",
                    },
                    "externalId": {
                        "type": "string",
                        "description": "Meta user id / phone — stored in channelIdentities for future auto-linking.",
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clients_update",
            "description": (
                "Generic field updater for a client. Use for corrections (name, email, tags, "
                "phone) or CRM moves (status, lifecycleStage). Whitelisted fields only."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "patch": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "email": {"type": "string"},
                            "phone": {"type": "string"},
                            "whatsapp": {"type": "string"},
                            "company": {"type": "string"},
                            "notes": {"type": "string"},
                            "tags": {"type": "array", "items": {"type": "string"}},
                            "status": {"type": "string", "enum": ["novo", "contatado", "qualificado", "proposta", "negociacao", "ganho", "perdido"]},
                            "preferredChannel": {"type": "string", "enum": ["whatsapp", "facebook", "instagram"]},
                            "optInMarketing": {"type": "boolean"},
                        },
                    },
                },
                "required": ["id", "patch"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clients_update_address",
            "description": "Save a client's delivery address for future use.",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "address": {
                        "type": "object",
                        "properties": {
                            "cep": {"type": "string"},
                            "logradouro": {"type": "string"},
                            "numero": {"type": "string"},
                            "complemento": {"type": "string"},
                            "bairro": {"type": "string"},
                            "municipio": {"type": "string"},
                            "uf": {"type": "string"},
                        },
                    },
                },
                "required": ["id", "address"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clients_get_full_history",
            "description": (
                "Fetch a client's complete history in one call: profile + recent orders + "
                "recent appointments + lifetime stats. Use before upsell or when the customer "
                "asks about past purchases/visits."
            ),
            "parameters": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
            },
        },
    },
]


CONVERSATION_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "conversation_send_interactive",
            "description": (
                "Send a WhatsApp list-message with selectable rows (Baileys only). "
                "Use this to present time-slot options so the client can tap to choose. "
                "Each row id should be the time string (e.g. '09:00') so you can read "
                "the client's selection directly from their reply.\n"
                'Example: {"conversation_id":"conv_abc","title":"Horários disponíveis",'
                '"body":"Qual horário fica melhor?","button_text":"Ver horários",'
                '"sections":[{"title":"Amanhã (25/04)","rows":['
                '{"id":"09:00","title":"09:00","description":"<serviço> — R$ <preço>"},'
                '{"id":"14:30","title":"14:30","description":"<serviço> — R$ <preço>"}]}]}'
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "conversation_id": {
                        "type": "string",
                        "description": "Current conversation ID (from the request context)",
                    },
                    "title": {
                        "type": "string",
                        "description": "Bold header text, e.g. 'Horários disponíveis'",
                    },
                    "body": {
                        "type": "string",
                        "description": "Main message text shown above the list button",
                    },
                    "footer": {
                        "type": "string",
                        "description": "Optional footer text (small grey text at bottom)",
                    },
                    "button_text": {
                        "type": "string",
                        "description": "Label on the button that opens the list, e.g. 'Ver horários'",
                    },
                    "sections": {
                        "type": "array",
                        "description": "One section per date. 2-3 rows recomendado (max 10 técnico) no total entre todas as seções.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string", "description": "Section header, e.g. 'Amanhã — 24/04'"},
                                "rows": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "id": {"type": "string", "description": "Time string used as selection value, e.g. '09:00'"},
                                            "title": {"type": "string", "description": "Display title, e.g. '09:00'"},
                                            "description": {"type": "string", "description": "Subtitle, e.g. '<serviço> — R$ <preço>'"},
                                        },
                                        "required": ["id", "title"],
                                    },
                                },
                            },
                            "required": ["title", "rows"],
                        },
                    },
                },
                "required": ["conversation_id", "title", "body", "button_text", "sections"],
            },
        },
    },
]


# ─── Operator tools (Wave 1 — full CRUD for dashboard chat use_case) ─────────
#
# These are exposed only when use_case='operator' (dashboard chat). They cover
# every module the operator might ask the agent to drive via natural language.
# Schemas are intentionally terse — the operator already knows the system;
# descriptions are enough to disambiguate, not tutorial.

def _simple_tool(_name: str, _desc: str, /, required: list[str] | None = None, **props: Any) -> dict[str, Any]:
    """Helper to declare a tool with a single flat param object.

    The first two positional-only args avoid collisions with props that may
    themselves be named ``name`` (as happens with a property called 'name').
    """
    return {
        "type": "function",
        "function": {
            "name": _name,
            "description": _desc,
            "parameters": {
                "type": "object",
                "properties": props,
                **({"required": required} if required else {}),
            },
        },
    }


FINANCIAL_TOOLS: list[dict[str, Any]] = [
    _simple_tool(
        "financial_list",
        "List transactions (receita=income, despesa=expense). Filters by type/status/date.",
        type={"type": "string", "enum": ["receita", "despesa"]},
        status={"type": "string", "enum": ["pendente", "pago", "atrasado", "cancelado"]},
        fromDate={"type": "string", "description": "YYYY-MM-DD"},
        toDate={"type": "string", "description": "YYYY-MM-DD"},
        category={"type": "string"},
        limit={"type": "integer", "default": 50},
    ),
    _simple_tool("financial_get", "Fetch a single transaction by id.", required=["id"], id={"type": "string"}),
    _simple_tool(
        "financial_create_receivable",
        "Create an income (receita) account receivable. Supports installments.",
        required=["description", "amount"],
        description={"type": "string"},
        amount={"type": "number"},
        dueDate={"type": "string"},
        category={"type": "string"},
        clientId={"type": "string"},
        clientName={"type": "string"},
        installments={"type": "integer", "default": 1, "description": "1-48"},
        notes={"type": "string"},
    ),
    _simple_tool(
        "financial_create_payable",
        "Create an expense (despesa) account payable. Supports installments.",
        required=["description", "amount"],
        description={"type": "string"},
        amount={"type": "number"},
        dueDate={"type": "string"},
        category={"type": "string"},
        installments={"type": "integer", "default": 1},
        notes={"type": "string"},
    ),
    _simple_tool(
        "financial_mark_paid",
        "Mark a pending transaction as paid.",
        required=["id"],
        id={"type": "string"},
        paymentDate={"type": "string", "description": "YYYY-MM-DD (default: today)"},
        paymentMethod={"type": "string", "enum": ["dinheiro", "pix", "credito", "debito", "boleto", "pontos", "gift_card", "outros"]},
    ),
    _simple_tool("financial_cancel", "Cancel a transaction.", required=["id"], id={"type": "string"}, reason={"type": "string"}),
    _simple_tool("financial_summary_today", "Snapshot of today's in/out, pending, overdue."),
    _simple_tool("financial_summary_month", "Summary for a month. Month format YYYY-MM (default: current).", month={"type": "string"}),
]

# ─── Fiscal (NF-e / NFC-e / NFSe) ────────────────────────────────────────────
# READ-FIRST: list/get/query_status leem documentos fiscais já persistidos
# (sem tocar SEFAZ). cancel aciona a SEFAZ e é manager+ (TOOL_MIN_ROLE). emit
# ainda não suportado pelo agent (ver route.ts) — exposto pra mensagem limpa.
FISCAL_TOOLS: list[dict[str, Any]] = [
    _simple_tool(
        "fiscal_list",
        "List fiscal documents (NF-e/NFC-e/NFSe) already issued. Filters by type/status. Read-only.",
        type={"type": "string", "enum": ["nfe", "nfce", "nfse"]},
        status={"type": "string", "description": "ex: autorizada, processando, pendente, cancelada, rejeitada"},
        limit={"type": "integer", "default": 20},
    ),
    _simple_tool("fiscal_get", "Fetch a single fiscal document by id. Read-only.", required=["id"], id={"type": "string"}),
    _simple_tool(
        "fiscal_query_status",
        "Check the status of a fiscal document by id OR access key (chave de acesso). Read-only.",
        id={"type": "string"},
        accessKey={"type": "string", "description": "Chave de acesso (44 dígitos NF-e/NFC-e ou chave NFSe)"},
    ),
    _simple_tool(
        "fiscal_cancel",
        "Cancel an authorized NF-e/NFC-e at SEFAZ (manager+). Requires the 44-digit access key and a justification (15-255 chars).",
        required=["type", "chaveAcesso", "justificativa"],
        type={"type": "string", "enum": ["nfe", "nfce"]},
        chaveAcesso={"type": "string", "description": "44-digit access key"},
        justificativa={"type": "string", "description": "15-255 chars"},
        protocolo={"type": "string"},
    ),
    _simple_tool(
        "fiscal_emit",
        "Emit a fiscal document (NF-e/NFC-e/NFSe). NOTE: not yet supported via agent — returns a clear error directing to the Fiscal panel. Manager+.",
        required=["type"],
        type={"type": "string", "enum": ["nfe", "nfce", "nfse"]},
    ),
]

# ── Reports (BI / read-only) ─────────────────────────────────────────────────
# P2.11 — agregação cross-coleção do ReportsModule exposta ao agent. TODAS read-only
# (seguras pro modo analyst). `period` aceita preset (7d/30d/90d/mes/mes_anterior/ano)
# OU intervalo explícito fromDate+toDate (YYYY-MM-DD). Default 30d.
_PERIOD_PROP = {
    "type": "string",
    "enum": ["7d", "30d", "90d", "mes", "mes_anterior", "ano"],
    "description": "Período preset (default 30d). Ou use fromDate+toDate para intervalo exato.",
}
REPORTS_TOOLS: list[dict[str, Any]] = [
    _simple_tool(
        "reports_revenue_by_period",
        "Faturamento do período: receita, despesa, lucro, margem e quebra por categoria (só transações PAGAS). Read-only.",
        period=_PERIOD_PROP,
        fromDate={"type": "string", "description": "YYYY-MM-DD"},
        toDate={"type": "string", "description": "YYYY-MM-DD"},
    ),
    _simple_tool(
        "reports_sales_by_product",
        "Ranking de produtos e serviços vendidos no período (PDV + pedidos + agendamentos concluídos), com qtd e receita. Read-only.",
        period=_PERIOD_PROP,
        fromDate={"type": "string", "description": "YYYY-MM-DD"},
        toDate={"type": "string", "description": "YYYY-MM-DD"},
    ),
    _simple_tool(
        "reports_appointments_by_professional",
        "Agendamentos por profissional no período: total, concluídos, no-show, taxa de conclusão e receita. Cruza faturamento × profissional. Read-only.",
        period=_PERIOD_PROP,
        fromDate={"type": "string", "description": "YYYY-MM-DD"},
        toDate={"type": "string", "description": "YYYY-MM-DD"},
    ),
    _simple_tool(
        "reports_top_clients",
        "Top clientes por gasto acumulado (CLV) + nº de visitas no período. Read-only.",
        period=_PERIOD_PROP,
        fromDate={"type": "string", "description": "YYYY-MM-DD"},
        toDate={"type": "string", "description": "YYYY-MM-DD"},
        limit={"type": "integer", "default": 10},
    ),
]

INVENTORY_TOOLS: list[dict[str, Any]] = [
    _simple_tool(
        "inventory_list",
        (
            "Lista produtos (admin view — inclui inativos se pedido). "
            "NÃO passe nome de produto em `category` — category é bucket (ex: 'Bebidas', 'Sobremesas'). "
            "Pra achar produto por nome use inventory_search."
        ),
        category={
            "type": "string",
            "description": "Bucket (ex: 'Bebidas', 'Higiene'). NÃO é o nome. Pra nome use inventory_search.",
        },
        isActive={"type": "boolean"},
        onlyDeliverable={"type": "boolean"},
        limit={"type": "integer", "default": 100},
    ),
    _simple_tool(
        "inventory_search",
        (
            "Busca fuzzy por produto (nome/SKU/barcode/categoria/descrição). Admin view — "
            "diferente de catalog_search que é customer-facing (só deliverable ativos). "
            "Use quando operador mencionou nome específico."
        ),
        required=["query"],
        query={"type": "string"},
        includeInactive={"type": "boolean"},
        limit={"type": "integer", "default": 10},
    ),
    _simple_tool("inventory_get", "Fetch a single product.", required=["id"], id={"type": "string"}),
    _simple_tool(
        "inventory_create",
        "Create a new product. salePrice and costPrice in BRL.",
        required=["name", "category", "salePrice", "costPrice"],
        name={"type": "string"},
        category={"type": "string"},
        unit={"type": "string", "default": "UN"},
        salePrice={"type": "number"},
        costPrice={"type": "number"},
        currentStock={"type": "number", "default": 0},
        minStock={"type": "number"},
        sku={"type": "string"},
        description={"type": "string"},
        isDeliverable={"type": "boolean"},
    ),
    _simple_tool(
        "inventory_update",
        "Patch a product (name, prices, stock thresholds, isActive, etc).",
        required=["id", "patch"],
        id={"type": "string"},
        patch={"type": "object"},
    ),
    _simple_tool(
        "inventory_adjust_stock",
        "Add/remove stock with audit row. delta>0=entrada, delta<0=saida.",
        required=["productId", "delta", "reason"],
        productId={"type": "string"},
        delta={"type": "number"},
        reason={"type": "string"},
    ),
    _simple_tool("inventory_list_low_stock", "Products at or below minStock.", limit={"type": "integer", "default": 50}),
    _simple_tool("inventory_set_active", "Toggle isActive flag.", required=["id", "isActive"], id={"type": "string"}, isActive={"type": "boolean"}),
    _simple_tool("inventory_set_out_of_stock", "Zero-out currentStock (temporary runout).", required=["id"], id={"type": "string"}),
]

KANBAN_TOOLS: list[dict[str, Any]] = [
    _simple_tool("kanban_list_boards", "List all active kanban boards."),
    _simple_tool("kanban_get_board", "Fetch a single board (includes columns).", required=["id"], id={"type": "string"}),
    _simple_tool(
        "kanban_list_cards",
        (
            "Lista cartões de um board. Filtros são IDs (columnId, assigneeId = uid). "
            "NÃO passe título de cartão aqui — use kanban_search_cards."
        ),
        required=["boardId"],
        boardId={"type": "string", "description": "id do board (use kanban_list_boards pra obter)"},
        columnId={"type": "string", "description": "id da coluna"},
        assigneeId={"type": "string", "description": "uid do usuário assignee (não o nome)"},
        limit={"type": "integer", "default": 100},
    ),
    _simple_tool(
        "kanban_search_cards",
        (
            "Busca fuzzy cartões por título/descrição/assignees. boardId opcional "
            "restringe a um board. Use quando operador mencionou título/nome no cartão."
        ),
        required=["query"],
        query={"type": "string"},
        boardId={"type": "string", "description": "opcional: restringe a um board específico"},
        limit={"type": "integer", "default": 10},
    ),
    _simple_tool("kanban_get_card", "Fetch a single card.", required=["id"], id={"type": "string"}),
    _simple_tool(
        "kanban_create_card",
        "Create a new card. Falls back to the first column if columnId omitted.",
        required=["boardId", "title"],
        boardId={"type": "string"},
        columnId={"type": "string"},
        title={"type": "string"},
        description={"type": "string"},
        priority={"type": "string", "enum": ["urgent", "high", "medium", "low"]},
        assigneeIds={"type": "array", "items": {"type": "string"}},
        dueDate={"type": "string"},
    ),
    _simple_tool("kanban_move_card", "Move card to another column.", required=["id", "columnId"], id={"type": "string"}, columnId={"type": "string"}),
    _simple_tool("kanban_update_card", "Patch a card (title/description/priority/dueDate/etc).", required=["id", "patch"], id={"type": "string"}, patch={"type": "object"}),
    _simple_tool(
        "kanban_assign",
        "Replace assignees on a card.",
        required=["id", "assigneeIds"],
        id={"type": "string"},
        assigneeIds={"type": "array", "items": {"type": "string"}},
    ),
    _simple_tool("kanban_add_comment", "Append a comment to a card.", required=["id", "text"], id={"type": "string"}, text={"type": "string"}),
    _simple_tool("kanban_archive_card", "Delete a card (no restore).", required=["id"], id={"type": "string"}),
]

NOTES_TOOLS: list[dict[str, Any]] = [
    _simple_tool(
        "notes_list",
        "List notes. scope='personal' requires authorId.",
        scope={"type": "string", "enum": ["personal", "team"]},
        authorId={"type": "string"},
        onlyPinned={"type": "boolean"},
        limit={"type": "integer", "default": 50},
    ),
    _simple_tool("notes_get", "Fetch a single note.", required=["id"], id={"type": "string"}),
    _simple_tool(
        "notes_create",
        "Create a note. color defaults to yellow, scope to team.",
        required=["title", "content"],
        title={"type": "string"},
        content={"type": "string"},
        color={"type": "string", "enum": ["yellow", "green", "blue", "pink", "purple", "orange", "red", "neutral"]},
        scope={"type": "string", "enum": ["personal", "team"]},
        isPinned={"type": "boolean"},
    ),
    _simple_tool("notes_update", "Patch title/content/color/pinned.", required=["id", "patch"], id={"type": "string"}, patch={"type": "object"}),
    _simple_tool("notes_delete", "Hard-delete a note.", required=["id"], id={"type": "string"}),
    _simple_tool("notes_search", "Keyword search across title+content.", required=["query"], query={"type": "string"}, scope={"type": "string", "enum": ["personal", "team"]}, limit={"type": "integer", "default": 20}),
]

CRM_TOOLS: list[dict[str, Any]] = [
    _simple_tool(
        "crm_list_contacts",
        (
            "Filtra contatos CRM por status/lifecycle/tag/assignee. TODOS esses filtros "
            "são enums/IDs — NÃO passe nome de pessoa aqui. Pra achar por nome/email/"
            "telefone use crm_search_contacts."
        ),
        status={"type": "string", "enum": ["novo", "contatado", "qualificado", "proposta", "negociacao", "ganho", "perdido"]},
        lifecycleStage={"type": "string", "enum": ["new_lead", "contacted", "qualified", "proposal", "negotiation", "customer", "churned"]},
        tag={"type": "string", "description": "Tag exata (não é texto livre — passe o valor literal da tag)"},
        assignedTo={"type": "string", "description": "uid do usuário responsável (não o nome)"},
        limit={"type": "integer", "default": 50},
    ),
    _simple_tool(
        "crm_search_contacts",
        (
            "Busca fuzzy contatos CRM por nome/email/telefone/empresa. Tolera acentos, "
            "case, e números de telefone formatados ou não. Use quando o operador disser "
            "um nome próprio ('fulano', 'joão silva') ou parte de telefone."
        ),
        required=["query"],
        query={"type": "string", "description": "nome, fragmento de email, telefone ou empresa"},
        limit={"type": "integer", "default": 10},
    ),
    _simple_tool(
        "crm_list_deals",
        (
            "Lista pipeline de deals. Filtros são IDs/enums — stage é bucket do kanban "
            "(ex: 'proposta_enviada'), contactId é uid. Pra achar deal por título use "
            "crm_search_deals."
        ),
        stage={"type": "string", "description": "nome do estágio do pipeline (não é título)"},
        assignedTo={"type": "string"},
        contactId={"type": "string"},
        limit={"type": "integer", "default": 50},
    ),
    _simple_tool(
        "crm_search_deals",
        "Busca fuzzy deals por título/contactName/notas. Use quando operador mencionou título ou nome do cliente.",
        required=["query"],
        query={"type": "string"},
        limit={"type": "integer", "default": 10},
    ),
    _simple_tool("crm_get_deal", "Fetch a single deal.", required=["id"], id={"type": "string"}),
    _simple_tool(
        "crm_create_deal",
        "Create a deal. Requires linked contactId, title, value, stage.",
        required=["contactId", "title", "value", "stage"],
        contactId={"type": "string"},
        title={"type": "string"},
        value={"type": "number"},
        stage={"type": "string"},
        probability={"type": "integer", "description": "0-100"},
        expectedCloseDate={"type": "string"},
        assignedTo={"type": "string"},
        notes={"type": "string"},
    ),
    _simple_tool("crm_update_deal_stage", "Move deal to a new stage.", required=["id", "stage"], id={"type": "string"}, stage={"type": "string"}, probability={"type": "integer"}),
    _simple_tool("crm_close_deal", "Close won (won=true) or lost (false with reason).", required=["id", "won"], id={"type": "string"}, won={"type": "boolean"}, reason={"type": "string"}),
    _simple_tool(
        "crm_list_activities",
        "List CRM activities (calls, emails, tasks, notes).",
        contactId={"type": "string"},
        dealId={"type": "string"},
        type={"type": "string", "enum": ["ligacao", "email", "reuniao", "whatsapp", "tarefa", "nota", "proposta"]},
        limit={"type": "integer", "default": 50},
    ),
    _simple_tool(
        "crm_log_activity",
        "Log a CRM activity. Requires contactId or dealId.",
        required=["type", "title"],
        type={"type": "string", "enum": ["ligacao", "email", "reuniao", "whatsapp", "tarefa", "nota", "proposta"]},
        title={"type": "string"},
        description={"type": "string"},
        contactId={"type": "string"},
        dealId={"type": "string"},
        scheduledAt={"type": "string"},
        isCompleted={"type": "boolean"},
        duration={"type": "integer", "description": "minutes"},
    ),
    _simple_tool("crm_list_segments", "List all segments for the business."),
    _simple_tool("crm_segment_query", "Resolve a segment to its contact list.", required=["segmentId"], segmentId={"type": "string"}, limit={"type": "integer", "default": 100}),
]

CONVERSATIONS_ADMIN_TOOLS: list[dict[str, Any]] = [
    _simple_tool(
        "conversations_list",
        "List conversation threads with filters.",
        channel={"type": "string", "enum": ["whatsapp", "facebook", "instagram"]},
        status={"type": "string", "enum": ["open", "waiting", "resolved"]},
        priority={"type": "string", "enum": ["low", "medium", "high", "urgent"]},
        limit={"type": "integer", "default": 30},
    ),
    _simple_tool("conversations_get", "Fetch single conversation.", required=["id"], id={"type": "string"}),
    _simple_tool("conversations_list_messages", "List messages in a conversation (newest-last).", required=["conversationId"], conversationId={"type": "string"}, limit={"type": "integer", "default": 50}),
    _simple_tool("conversations_set_label", "Add (remove=false) or remove (true) a label on a conversation.", required=["id", "label"], id={"type": "string"}, label={"type": "string"}, remove={"type": "boolean"}),
    _simple_tool("conversations_set_priority", "Set priority.", required=["id", "priority"], id={"type": "string"}, priority={"type": "string", "enum": ["low", "medium", "high", "urgent"]}),
    _simple_tool("conversations_set_status", "Set status.", required=["id", "status"], id={"type": "string"}, status={"type": "string", "enum": ["open", "waiting", "resolved"]}),
    _simple_tool(
        "conversations_list_snippets",
        "List snippet (quick-reply) library.",
        category={"type": "string"},
        sectorId={"type": "string"},
        limit={"type": "integer", "default": 50},
    ),
    _simple_tool("conversations_search_snippets", "Keyword search in snippets.", required=["query"], query={"type": "string"}, limit={"type": "integer", "default": 20}),
]

TEAM_TOOLS: list[dict[str, Any]] = [
    _simple_tool("team_list_sectors", "List sectors/departments."),
    _simple_tool(
        "team_list_members",
        "List team members with filters.",
        sectorId={"type": "string"},
        role={"type": "string", "enum": ["founder", "admin", "manager", "operator", "viewer"]},
        isProfessional={"type": "boolean"},
        isActive={"type": "boolean"},
        limit={"type": "integer", "default": 100},
    ),
    _simple_tool("team_get_member", "Fetch a single user.", required=["id"], id={"type": "string"}),
    _simple_tool("team_capacity_today", "Pending work per team member (appointments/orders/kanban/conversations).", userId={"type": "string"}),
]

SERVICES_MGMT_TOOLS: list[dict[str, Any]] = [
    _simple_tool(
        "services_list",
        (
            "Lista o catálogo de serviços do negócio. SEM filtro retorna todos "
            "os serviços ativos (use isso 90% das vezes). "
            "NÃO passe o nome de um serviço em `category` — category é o BUCKET "
            "de agrupamento (ex: 'Estética', 'Cabelo', 'Depilação'), não o nome. "
            "Pra achar serviço por nome use services_search."
        ),
        includeInactive={"type": "boolean", "description": "true inclui serviços desativados"},
        category={
            "type": "string",
            "description": (
                "Bucket de agrupamento (ex: 'Estética', 'Cabelo'). SÓ use se o operador "
                "pedir explicitamente 'serviços de categoria X'. Se ele disser o nome de "
                "um serviço (ex: 'maquiagem', 'corte feminino'), use services_search."
            ),
        },
        limit={"type": "integer", "default": 100},
    ),
    _simple_tool(
        "services_search",
        (
            "Busca fuzzy por serviços via nome/descrição/categoria. Tolera acentos, "
            "case e espaços. Use quando o usuário mencionou um nome específico "
            "('você tem maquiagem?', 'tem corte feminino?'). Retorna ordenado por relevância."
        ),
        required=["query"],
        query={"type": "string", "description": "Texto a procurar (nome do serviço ou fragmento)"},
        includeInactive={"type": "boolean"},
        limit={"type": "integer", "default": 10},
    ),
    _simple_tool("services_get", "Fetch a single service.", required=["id"], id={"type": "string"}),
    _simple_tool(
        "services_create",
        "Create a new service in the catalog.",
        required=["name", "duration", "price"],
        name={"type": "string"},
        duration={"type": "integer", "description": "minutes"},
        price={"type": "number"},
        description={"type": "string"},
        category={"type": "string"},
        color={"type": "string"},
        commissionRate={"type": "number", "description": "0-100 (%)"},
    ),
    _simple_tool("services_update", "Patch a service.", required=["id", "patch"], id={"type": "string"}, patch={"type": "object"}),
    _simple_tool("services_set_active", "Toggle isActive.", required=["id", "isActive"], id={"type": "string"}, isActive={"type": "boolean"}),
    _simple_tool(
        "services_import_grade",
        (
            "Importa uma grade de horários em TEXTO (ex: a descrição do negócio, onde o dono "
            "costuma colar os horários das aulas/turmas) para a Agenda — cria/atualiza serviços "
            "com a grade semanal ESTRUTURADA (sessions), que é a fonte da verdade que o "
            "agendamento usa. SEMPRE rode primeiro com apply=false, mostre o preview (quais "
            "modalidades e quantos horários) e peça confirmação ao operador; só rode apply=true "
            "depois do 'pode aplicar'. Se `text` for omitido, usa a descrição do negócio."
        ),
        text={"type": "string", "description": "Texto da grade. Omita para usar a descrição do negócio (businessDescription)."},
        apply={"type": "boolean", "description": "false = só preview (padrão); true = grava os serviços."},
        defaultCapacity={"type": "integer", "description": "Vagas por turma (padrão 20). Só aplica em serviço sem capacity."},
        defaultDuration={"type": "integer", "description": "Duração em minutos ao criar uma modalidade nova (padrão 60)."},
        matchOnly={"type": "boolean", "description": "true = só atualiza serviços existentes; não cria modalidade nova."},
    ),
]

SALES_TOOLS: list[dict[str, Any]] = [
    _simple_tool(
        "sales_list",
        "List PDV sales transactions with filters.",
        status={"type": "string", "enum": ["aberta", "finalizada", "cancelada"]},
        fromDate={"type": "string"},
        toDate={"type": "string"},
        limit={"type": "integer", "default": 50},
    ),
    _simple_tool("sales_get", "Fetch a single sale.", required=["id"], id={"type": "string"}),
    _simple_tool("sales_list_by_client", "List sales for a specific client.", required=["clientId"], clientId={"type": "string"}, limit={"type": "integer", "default": 20}),
    _simple_tool(
        "sales_create",
        "Create a new PDV sale. items + payments required; totals auto-computed if omitted.",
        required=["items", "payments"],
        clientId={"type": "string"},
        clientName={"type": "string"},
        items={
            "type": "array",
            "description": "Itens da venda. Cada item = produto ou serviço com quantidade e preço.",
            "items": {
                "type": "object",
                "properties": {
                    "productId": {"type": "string", "description": "id do produto (se aplicável)"},
                    "serviceId": {"type": "string", "description": "id do serviço (se aplicável)"},
                    "description": {"type": "string"},
                    "quantity": {"type": "number", "minimum": 0.001},
                    "unitPrice": {"type": "number", "minimum": 0},
                    "discount": {"type": "number", "minimum": 0},
                    "total": {"type": "number", "minimum": 0},
                },
                "required": ["description", "quantity", "unitPrice"],
            },
        },
        payments={
            "type": "array",
            "description": "Formas de pagamento. A soma deve bater com o total da venda.",
            "items": {
                "type": "object",
                "properties": {
                    "method": {
                        "type": "string",
                        "enum": ["dinheiro", "pix", "credito", "debito", "boleto", "pontos", "gift_card", "outros"],
                    },
                    "amount": {"type": "number", "minimum": 0},
                    "installments": {"type": "integer", "minimum": 1, "maximum": 24},
                    "cardBrand": {"type": "string"},
                },
                "required": ["method", "amount"],
            },
        },
        discount={"type": "number"},
        tip={"type": "number"},
        notes={"type": "string"},
    ),
    _simple_tool("sales_cancel", "Cancel a finalized sale.", required=["id"], id={"type": "string"}, reason={"type": "string"}),
    _simple_tool("sales_summary_today", "Today's sales summary (revenue, count, payment breakdown)."),
]

SUPPLIERS_TOOLS: list[dict[str, Any]] = [
    _simple_tool(
        "suppliers_list",
        "Lista fornecedores ativos (ordenado por razaoSocial). Pra achar por nome/CNPJ use suppliers_search.",
        includeInactive={"type": "boolean"},
        limit={"type": "integer", "default": 100},
    ),
    _simple_tool(
        "suppliers_search",
        (
            "Busca fuzzy fornecedor por razaoSocial/nomeFantasia/CNPJ. Tolera acentos, "
            "case, CNPJ formatado ou não. Use quando operador mencionou nome ou CNPJ."
        ),
        required=["query"],
        query={"type": "string", "description": "nome, fragmento de CNPJ (≥8 dígitos) ou razão"},
        limit={"type": "integer", "default": 10},
    ),
    _simple_tool("suppliers_get", "Fetch a single supplier.", required=["id"], id={"type": "string"}),
    _simple_tool(
        "suppliers_create",
        "Create a new supplier. De-dups by CNPJ.",
        required=["razaoSocial", "cnpj"],
        razaoSocial={"type": "string"},
        nomeFantasia={"type": "string"},
        cnpj={"type": "string"},
        phone={"type": "string"},
        email={"type": "string"},
    ),
    _simple_tool("suppliers_update", "Patch a supplier.", required=["id", "patch"], id={"type": "string"}, patch={"type": "object"}),
    _simple_tool("suppliers_find_by_cnpj", "Lookup supplier by CNPJ.", required=["cnpj"], cnpj={"type": "string"}),
]

KNOWLEDGE_TOOLS: list[dict[str, Any]] = [
    _simple_tool(
        "knowledge_search",
        (
            "Busca semântica na base de conhecimento do negócio (produtos, serviços, snippets, "
            "descrição do negócio, políticas). Use para perguntas que não têm lookup direto via "
            "outras tools: opções veganas, políticas de cancelamento, 'me fale sobre o estabelecimento'."
        ),
        required=["query"],
        query={"type": "string"},
        k={"type": "integer", "default": 5, "description": "top-K, max 20"},
        sources={
            "type": "array",
            "items": {
                "type": "string",
                "enum": ["product", "service", "snippet", "faq", "business_desc", "policy"],
            },
            "description": "Optional: restringe a tipos específicos",
        },
        minScore={"type": "number", "description": "threshold de similaridade 0-1 (default 0.3)"},
    ),
]

MEMORY_TOOLS: list[dict[str, Any]] = [
    _simple_tool(
        "memory_recall",
        (
            "Recupera fatos persistentes sobre um contato (preferências, alergias, pedidos recorrentes). "
            "Use no início de uma conversa com cliente cadastrado."
        ),
        required=["contactId"],
        contactId={"type": "string"},
    ),
    _simple_tool(
        "memory_remember",
        (
            "Grava um fato novo sobre o contato para uso futuro. Use quando o cliente revelar "
            "preferência persistente (ex: 'sem cebola', 'sempre pede pizza sexta à noite', 'alergia X')."
        ),
        required=["contactId", "text"],
        contactId={"type": "string"},
        text={"type": "string", "description": "Fato em 1 frase pt-BR"},
        evidence={"type": "string", "description": "origem: 'order:id', 'conv:id', 'explicit'"},
        confidence={"type": "number", "description": "0-1, padrão 0.7"},
        validUntil={"type": "string", "description": "ISO date se aplicável (promo, sazonalidade)"},
        tags={"type": "array", "items": {"type": "string"}},
    ),
    _simple_tool(
        "memory_forget",
        "Remove um fato específico por id (caso fique desatualizado).",
        required=["contactId", "factId"],
        contactId={"type": "string"},
        factId={"type": "string"},
    ),
]

PURCHASE_NOTES_TOOLS: list[dict[str, Any]] = [
    _simple_tool(
        "purchase-notes_list",
        "List purchase notes (NF-e de compra).",
        status={"type": "string", "enum": ["pendente", "importada", "cancelada"]},
        supplierId={"type": "string"},
        limit={"type": "integer", "default": 30},
    ),
    _simple_tool("purchase-notes_get", "Fetch a single purchase note with items.", required=["id"], id={"type": "string"}),
    _simple_tool("purchase-notes_match_products", "Fuzzy-match note items against products catalog. Preview only.", required=["id"], id={"type": "string"}),
    _simple_tool("purchase-notes_apply_to_stock", "Apply matched items to inventory (creates stockMovements). Idempotent.", required=["id"], id={"type": "string"}),
    _simple_tool("purchase-notes_list_unmatched", "List notes with unmatched items pending review.", limit={"type": "integer", "default": 20}),
]


# ─── Dashboard tool groups — for intent-based pre-selection (operator/analyst) ─
#
# The operator use_case exposes ~109 tools (~12.9k tokens of JSON-schema) and the
# planner re-sends them on every iteration. Most are irrelevant to a given command
# ("fluxo de caixa" doesn't need kanban/suppliers/notes schemas). We group tools by
# module and pre-select 1-3 groups from the operator's message via cheap keyword
# matching, cutting the per-iteration tool payload from ~12.9k to ~2-4k tokens.
# `clients`/`knowledge`/`memory` are always-on base context.

_DASHBOARD_GROUPS: dict[str, list[dict[str, Any]]] = {
    "financial": FINANCIAL_TOOLS,
    "inventory": INVENTORY_TOOLS,
    "sales": SALES_TOOLS,
    "agenda": AGENDA_TOOLS,
    "services": SERVICES_MGMT_TOOLS,
    "orders": CATALOG_TOOLS + ORDERS_TOOLS,
    "kanban": KANBAN_TOOLS,
    "notes": NOTES_TOOLS,
    "crm": CRM_TOOLS,
    "conversations": CONVERSATIONS_ADMIN_TOOLS + CONVERSATION_TOOLS,
    "team": TEAM_TOOLS,
    "suppliers": SUPPLIERS_TOOLS,
    "purchase-notes": PURCHASE_NOTES_TOOLS,
    "fiscal": FISCAL_TOOLS,
    "reports": REPORTS_TOOLS,
}

# Keyword → group. Matched (accent-insensitive, substring) against the message.
_GROUP_KEYWORDS: dict[str, tuple[str, ...]] = {
    "financial": ("financ", "caixa", "receb", "pagar", "pagamento", "despesa", "receita", "fatur", "boleto", "pix", "conta", "saldo", "lucro", "atrasad", "vencim"),
    "inventory": ("estoque", "produto", "inventario", "sku", "low stock", "reposi", "mercadoria", "preco de custo"),
    "sales": ("venda", "pdv", "ticket", "vendido", "vendeu", "caixa do dia"),
    "agenda": ("agenda", "agendamento", "horario", "marcar", "consulta", "appointment", "remarcar", "no-show", "no show", "compareceu"),
    "services": ("servico", "serviços", "catalogo de servico", "comissao"),
    "orders": ("pedido", "delivery", "entrega", "cardapio", "menu", "retirada"),
    "kanban": ("kanban", "board", "cartao", "card", "tarefa", "coluna", "quadro"),
    "notes": ("nota pessoal", "nota da equipe", "anota", "lembrete", "post-it", "postit"),
    "crm": ("crm", "lead", "deal", "contato", "pipeline", "negociac", "segmento", "oportunidade", "cliente novo"),
    "conversations": ("conversa", "chat", "mensagem", "atendimento", "label", "snippet", "prioridade", "whatsapp", "interativ"),
    "team": ("equipe", "membro", "setor", "colaborador", "funcionario", "capacidade", "profissional"),
    "suppliers": ("fornecedor", "cnpj", "razao social"),
    "purchase-notes": ("nota de compra", "nf-e", "nfe", "nota fiscal", "importar nota", "compra"),
    "fiscal": ("fiscal", "nfce", "nfse", "nota fiscal", "sefaz", "emitir nota", "cancelar nota", "danfe", "chave de acesso", "documento fiscal"),
    "reports": ("relatorio", "report", "faturamento", "receita do periodo", "bi", "dashboard", "indicador", "kpi", "ranking", "top clientes", "por profissional", "por produto", "desempenho", "analise", "comparativo"),
}


def _normalize(text: str) -> str:
    import unicodedata
    nfkd = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def select_dashboard_groups(message: str, *, max_groups: int = 3) -> list[str]:
    """Pick the most relevant dashboard tool groups for an operator/analyst message
    via keyword scoring. Returns up to `max_groups` group names (best first). Empty
    list means 'no confident match' → caller should fall back to the full tool set."""
    if not message:
        return []
    norm = _normalize(message)
    scores: list[tuple[int, str]] = []
    for group, kws in _GROUP_KEYWORDS.items():
        hits = sum(1 for kw in kws if _normalize(kw) in norm)
        if hits:
            scores.append((hits, group))
    scores.sort(key=lambda x: (-x[0], x[1]))
    return [g for _, g in scores[:max_groups]]


def dashboard_tools_for_groups(groups: list[str], *, read_only: bool = False) -> list[dict[str, Any]]:
    """Assemble the operator/analyst tool list for the selected groups, always on
    top of the base (clients + knowledge + memory). When `read_only`, the write
    tools are filtered out (analyst mode)."""
    base = CLIENT_TOOLS[:] + KNOWLEDGE_TOOLS + MEMORY_TOOLS
    selected: list[dict[str, Any]] = []
    for g in groups:
        selected += _DASHBOARD_GROUPS.get(g, [])
    pool = base + selected
    if read_only:
        pool = [t for t in pool if _is_read_only_tool(t["function"]["name"])]
        # memory_recall is read; clients_lookup is read — base already mostly read.
    return pool


# P3.4 — Fonte da verdade EXPLÍCITA do que escreve/muta estado (x_mutates).
# O gating read-only do modo analyst consulta este conjunto PRIMEIRO; a
# heurística de substring (_READ_ONLY_PREFIXES) só decide para nomes que não
# constam aqui (fallback conservador). Ao adicionar uma tool de escrita nova,
# registre o nome aqui — não confie na heurística para mantê-la fora do analyst.
_MUTATING_TOOLS: frozenset[str] = frozenset({
    # orders
    "orders_create", "orders_cancel", "orders_update_items",
    # agenda
    "agenda_book", "agenda_update", "agenda_cancel",
    # clients
    "clients_create", "clients_update", "clients_update_address",
    # conversations (interactive + state)
    "conversation_send_interactive",
    "conversations_set_label", "conversations_set_priority", "conversations_set_status",
    # financial
    "financial_create_receivable", "financial_create_payable",
    "financial_mark_paid", "financial_cancel",
    # fiscal (acionam SEFAZ / criam documento)
    "fiscal_cancel", "fiscal_emit",
    # inventory
    "inventory_create", "inventory_update", "inventory_adjust_stock",
    "inventory_set_active", "inventory_set_out_of_stock",
    # kanban
    "kanban_create_card", "kanban_move_card", "kanban_update_card",
    "kanban_assign", "kanban_add_comment", "kanban_archive_card",
    # notes
    "notes_create", "notes_update", "notes_delete",
    # crm
    "crm_create_deal", "crm_update_deal_stage", "crm_close_deal", "crm_log_activity",
    # services
    "services_create", "services_update", "services_set_active",
    # sales
    "sales_create", "sales_cancel",
    # suppliers
    "suppliers_create", "suppliers_update",
    # memory
    "memory_remember", "memory_forget",
})


_READ_ONLY_PREFIXES = (
    "_list", "_get", "_search", "_summary", "_recall", "_capacity",
    "_next_available", "_availability", "_check_", "_full_history",
    "_by_client", "_find_by", "_categories", "_menu", "_recent",
    "_segments", "_segment_query", "_messages", "_activities", "_boards", "_cards",
    "_today", "_month", "_low_stock", "_unmatched", "_match_products",
    "_context", "_services", "_professionals", "lookup_by_phone",
    "_query_status", "reports_",
)


def _is_read_only_tool(name: str) -> bool:
    # P3.4: flag explícita tem precedência. Tool registrada como mutante nunca
    # é tratada como read-only, mesmo que o nome bata um prefixo read.
    if name in _MUTATING_TOOLS:
        return False
    # Fallback conservador: nomes não-registrados caem na heurística de substring
    # (mantida para não regredir tools ainda não migradas para a flag explícita).
    return any(name.endswith(suf) or suf in name for suf in _READ_ONLY_PREFIXES)


def tools_for_use_case(use_case: UseCase) -> list[dict[str, Any]]:
    """Return the subset of tools the LLM should see, given the business mode."""
    base = CLIENT_TOOLS[:] + KNOWLEDGE_TOOLS + MEMORY_TOOLS
    if use_case == "pedidos":
        return base + CATALOG_TOOLS + ORDERS_TOOLS
    if use_case == "servicos":
        return base + AGENDA_TOOLS + CONVERSATION_TOOLS
    if use_case == "operator":
        # Dashboard chat — full CRUD over all modules.
        return (
            base
            + CATALOG_TOOLS + ORDERS_TOOLS
            + AGENDA_TOOLS + CONVERSATION_TOOLS
            + FINANCIAL_TOOLS + INVENTORY_TOOLS + KANBAN_TOOLS
            + NOTES_TOOLS + CRM_TOOLS + CONVERSATIONS_ADMIN_TOOLS
            + TEAM_TOOLS + SERVICES_MGMT_TOOLS + SALES_TOOLS
            + SUPPLIERS_TOOLS + PURCHASE_NOTES_TOOLS + FISCAL_TOOLS
            + REPORTS_TOOLS
        )
    if use_case == "analyst":
        # Analyst chat — READ-ONLY tools only (list/get/search/summary).
        # Guardrails layer also role-gates destructive tools, but the analyst
        # prompt shouldn't even see the write tools.
        all_operator = (
            CATALOG_TOOLS + ORDERS_TOOLS
            + AGENDA_TOOLS + CONVERSATION_TOOLS
            + FINANCIAL_TOOLS + INVENTORY_TOOLS + KANBAN_TOOLS
            + NOTES_TOOLS + CRM_TOOLS + CONVERSATIONS_ADMIN_TOOLS
            + TEAM_TOOLS + SERVICES_MGMT_TOOLS + SALES_TOOLS
            + SUPPLIERS_TOOLS + PURCHASE_NOTES_TOOLS + FISCAL_TOOLS
            + REPORTS_TOOLS
        )
        read_only = [t for t in all_operator if _is_read_only_tool(t["function"]["name"])]
        return base + read_only
    # simples / times — generic CRM only
    return base


# Backwards-compatible exports
ALL_TOOLS: list[dict[str, Any]] = (
    ORDERS_TOOLS + AGENDA_TOOLS + CATALOG_TOOLS + CLIENT_TOOLS + CONVERSATION_TOOLS
    + FINANCIAL_TOOLS + INVENTORY_TOOLS + KANBAN_TOOLS + NOTES_TOOLS + CRM_TOOLS
    + CONVERSATIONS_ADMIN_TOOLS + TEAM_TOOLS + SERVICES_MGMT_TOOLS + SALES_TOOLS
    + SUPPLIERS_TOOLS + PURCHASE_NOTES_TOOLS + FISCAL_TOOLS
    + KNOWLEDGE_TOOLS + MEMORY_TOOLS
)
TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    t["function"]["name"]: t for t in ALL_TOOLS
}


def get_tool(name: str) -> dict[str, Any] | None:
    return TOOL_SCHEMAS.get(name)
