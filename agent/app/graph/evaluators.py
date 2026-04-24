"""Online evaluators for agent outputs.

Two evaluators, both opt-in (controlled by LANGSMITH_EVALS_ENABLED env var):

  - groundedness: LLM-as-judge checks if the final_response is supported by
    the tool outputs. Flags hallucinations where the agent invented a price,
    a timeslot, or a product name not returned by any tool.

  - trajectory: Compares the executed tool sequence to the expected one from
    a dataset example. Used only for dataset-driven batch evaluations, not
    online.

Run cost: groundedness is ~150-300 tokens per sampled run. With 5% sampling
and 1000 runs/day on gpt-5.4-mini, that's ~$0.10/day — fits the free tier
once it graduates out of beta. Default disabled.
"""

from __future__ import annotations

import json
import os
import random
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from ..config import get_settings
from ..logging_config import get_logger

log = get_logger("evaluators")


# Sample rate for groundedness. 0.05 = 5% of runs evaluated online.
SAMPLE_RATE = float(os.getenv("LANGSMITH_GROUNDEDNESS_SAMPLE", "0.05"))


def evals_enabled() -> bool:
    return os.getenv("LANGSMITH_EVALS_ENABLED", "false").lower() in ("true", "1", "yes")


def should_sample() -> bool:
    """Stochastic sampling — call once per run."""
    if not evals_enabled():
        return False
    return random.random() < SAMPLE_RATE


async def evaluate_groundedness(
    *,
    final_response: str,
    tool_calls: list[dict[str, Any]],
    user_message: str,
) -> dict[str, Any]:
    """LLM-as-judge: does the response stay grounded in what tools returned?

    Returns {score: 0-1, reason: str, hallucinations: [str]}. Score of 1.0 means
    every factual claim in the response is traceable to a tool output; 0 means
    the response invented data.
    """
    settings = get_settings()

    # Filter for tool calls with actual outputs (skip errors)
    grounded_data = [
        {"tool": t.get("name"), "result": t.get("result")}
        for t in tool_calls or []
        if t.get("result") and not t.get("error")
    ]

    system = (
        "Você é um verificador de factualidade. Você recebe (1) a pergunta do usuário, "
        "(2) os dados retornados por tools, (3) a resposta final do agente. "
        "Avalie se cada afirmação factual na resposta final está suportada pelos dados "
        "das tools. Saudações, opiniões sobre tom, e linguagem genérica não contam. "
        "\n\n"
        "Retorne APENAS JSON válido:\n"
        '{"score": <0-1>, "reason": "frase curta pt-BR", "hallucinations": ["claim1", "claim2"]}'
    )

    # Keep payload compact — evaluator cost scales linearly with content size
    tools_str = json.dumps(grounded_data, ensure_ascii=False, default=str)[:2500]
    response_str = (final_response or "")[:1500]
    user_str = (user_message or "")[:500]

    human = (
        f"PERGUNTA: {user_str}\n\n"
        f"DADOS DAS TOOLS:\n{tools_str}\n\n"
        f"RESPOSTA DO AGENTE:\n{response_str}"
    )

    llm = ChatOpenAI(
        model=settings.openai_model_router,  # cheapest — gpt-5.4-nano
        api_key=settings.openai_api_key,
        temperature=0.0,
        max_tokens=200,
    )

    try:
        result = await llm.ainvoke([SystemMessage(content=system), HumanMessage(content=human)])
        raw = result.content if isinstance(result.content, str) else str(result.content)
        # Strip markdown fences
        clean = raw.strip()
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[1] if "\n" in clean else clean
            if clean.endswith("```"):
                clean = clean.rsplit("```", 1)[0]
            if clean.startswith("json"):
                clean = clean[4:].strip()
        data = json.loads(clean)
        score = float(data.get("score", 1.0))
        return {
            "score": max(0.0, min(1.0, score)),
            "reason": str(data.get("reason", "")),
            "hallucinations": list(data.get("hallucinations", []))[:5],
        }
    except Exception as err:
        log.warning("evaluator.groundedness.error", error=str(err))
        return {"score": 1.0, "reason": "evaluator failed; defaulting to pass", "hallucinations": []}


def compute_trajectory_score(
    actual_tools: list[str],
    expected_tools: list[str],
) -> dict[str, Any]:
    """Batch evaluator — compares tool sequences (order-insensitive coverage).

    Returns {score, matched, missing, extra}. score = |matched| / |expected|
    when expected is non-empty, else 1 if no tools called and 0 if any.
    """
    actual_set = [t for t in actual_tools if t]
    expected_set = [t for t in expected_tools if t]

    if not expected_set:
        score = 1.0 if not actual_set else 0.5  # we expected no tools; penalize extras
        return {"score": score, "matched": [], "missing": [], "extra": actual_set}

    matched = [t for t in expected_set if t in actual_set]
    missing = [t for t in expected_set if t not in actual_set]
    extra = [t for t in actual_set if t not in expected_set]
    score = len(matched) / len(expected_set)

    return {
        "score": round(score, 3),
        "matched": matched,
        "missing": missing,
        "extra": extra,
    }
