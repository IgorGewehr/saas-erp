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

UseCase = Literal["pedidos", "servicos", "simples", "times"]


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
            "name": "agenda_check_availability",
            "description": (
                "Return free time slots for a given date. Always call before booking. "
                "If the user mentions a relative date, resolve it to YYYY-MM-DD first."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "YYYY-MM-DD"},
                    "professionalId": {"type": "string"},
                    "durationMinutes": {"type": "integer", "default": 60},
                },
                "required": ["date"],
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
            "description": "List all deliverable products. Optional category filter.",
            "parameters": {
                "type": "object",
                "properties": {"category": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "catalog_search",
            "description": "Search the menu by name/category/description (substring match).",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
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
            "description": "Create a new client record. Called when lookup returns null.",
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
                },
                "required": ["name"],
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
