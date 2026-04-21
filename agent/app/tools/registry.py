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

UseCase = Literal["pedidos", "servicos", "simples"]


# ─── Orders (pedidos) ────────────────────────────────────────────────────────

ORDERS_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "orders_create",
            "description": (
                "Create a new delivery order for the customer. Use after confirming client name, "
                "items, delivery or pickup, address if delivery, and payment method. Returns the "
                "order id + sequential number + estimated delivery time."
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
                "and the correct durationMinutes from the service catalog."
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
            "description": "Book a new appointment after confirming slot + client details.",
            "parameters": {
                "type": "object",
                "properties": {
                    "clientId": {"type": "string"},
                    "clientName": {"type": "string"},
                    "clientPhone": {"type": "string"},
                    "serviceId": {"type": "string"},
                    "serviceName": {"type": "string"},
                    "professionalId": {"type": "string"},
                    "professionalName": {"type": "string"},
                    "date": {"type": "string", "description": "YYYY-MM-DD"},
                    "startTime": {"type": "string", "description": "HH:MM"},
                    "durationMinutes": {"type": "integer", "default": 60},
                    "price": {"type": "number"},
                    "notes": {"type": "string"},
                },
                "required": ["clientName", "date", "startTime", "durationMinutes"],
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


def tools_for_use_case(use_case: UseCase) -> list[dict[str, Any]]:
    """Return the subset of tools the LLM should see, given the business mode."""
    base = CLIENT_TOOLS[:]
    if use_case == "pedidos":
        return base + CATALOG_TOOLS + ORDERS_TOOLS
    if use_case == "servicos":
        return base + AGENDA_TOOLS
    # simples / times — generic CRM only
    return base


# Backwards-compatible exports
ALL_TOOLS: list[dict[str, Any]] = (
    ORDERS_TOOLS + AGENDA_TOOLS + CATALOG_TOOLS + CLIENT_TOOLS
)
TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    t["function"]["name"]: t for t in ALL_TOOLS
}


def get_tool(name: str) -> dict[str, Any] | None:
    return TOOL_SCHEMAS.get(name)
