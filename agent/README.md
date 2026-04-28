# ServicePro — Autonomous AI Agent

LangGraph-powered concierge that responds to WhatsApp / Facebook / Instagram
messages on behalf of the business. Creates orders, books appointments, consults
the menu — all without human intervention.

## Architecture

```
┌─────────────────┐    HMAC     ┌──────────────────┐
│  Next.js (web)  │────────────►│  Python agent    │
│  - webhooks     │◄────────────│  - FastAPI       │
│  - REST tools   │             │  - LangGraph     │
│  - UI           │             │  - OpenAI        │
└─────────────────┘             └──────────────────┘
```

Every request in either direction is signed with **HMAC-SHA256** using a shared
secret (`AGENT_SHARED_SECRET`), preventing forgery between the services. The
Python service never accesses Firestore directly — everything goes through
the Next.js REST layer, which enforces multi-tenant isolation.

## Graph topology

```
    START
      ↓
   router        — GPT classifies intent (pedido / agenda / info / …)
      ↓
   planner ←─┐   — GPT with bound tools; emits tool_calls or draft response
      ↓      │
   executor ─┘   — runs tool_calls in parallel via HTTP
      ↓
   responder     — polishes the draft in the business's tone
      ↓
     END
```

Iteration cap: `AGENT_MAX_ITERATIONS` (default 8).

## Run locally

```bash
cd agent
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env  # then fill in real values
python main.py        # listens on :8080
```

## Testing

```bash
pytest
```

## Adding a tool

1. Implement the action in `app/api/agent/tools/<domain>/route.ts` (Next.js).
2. Add the JSON schema in `app/tools/registry.py`.
3. Add the path to `TOOL_ENDPOINTS` in `app/tools/client.py`.

That's it — the LangGraph planner will see the new tool automatically.

## Observability

Every run produces:

- Structured JSON logs (stdout) keyed by `run_id`.
- An `AgentRun` document saved to Firestore (via `/api/agent/runs`) with every
  node's input/output, tool call, token counts, latency and cost.
- Optional LangSmith tracing (set `LANGCHAIN_TRACING_V2=true` in `.env`).

The Next.js UI shows the latest runs per conversation in a debug drawer.
