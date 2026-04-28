"""FastAPI app entry — run with `uvicorn main:app --reload` or python main.py."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import get_settings, langsmith_project_name
from app.logging_config import configure_logging, get_logger
from app.observability import enable_langsmith_if_configured


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    langsmith_active = enable_langsmith_if_configured(settings)

    app = FastAPI(
        title="ServicePro Agent",
        version="0.2.0",
        description="Autonomous LangGraph agent for orders, appointments & operator commands.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.include_router(router)

    log = get_logger("startup")
    log.info(
        "agent.boot",
        port=settings.port,
        model=settings.openai_model_default,
        env=settings.app_env,
        langsmith=langsmith_active,
        langsmith_project=langsmith_project_name(settings) if langsmith_active else None,
        pii_redaction=settings.redact_pii_in_traces,
    )
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    s = get_settings()
    uvicorn.run("main:app", host=s.host, port=s.port, reload=False, log_level=s.log_level.lower())
