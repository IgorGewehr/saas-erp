"""FastAPI app entry — run with `uvicorn main:app --reload` or python main.py."""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import get_settings
from app.logging_config import configure_logging, get_logger


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    # LangSmith tracing (optional)
    if settings.langchain_tracing_v2:
        os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
        if settings.langchain_api_key:
            os.environ.setdefault("LANGCHAIN_API_KEY", settings.langchain_api_key)
        if settings.langchain_project:
            os.environ.setdefault("LANGCHAIN_PROJECT", settings.langchain_project)

    app = FastAPI(
        title="ServicePro Agent",
        version="0.1.0",
        description="Autonomous LangGraph agent for orders & appointments.",
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
    log.info("agent.boot", port=settings.port, model=settings.openai_model_default)
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    s = get_settings()
    uvicorn.run("main:app", host=s.host, port=s.port, reload=False, log_level=s.log_level.lower())
