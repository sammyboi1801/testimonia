"""FastAPI application: the JSON API plus the built front-end (web/dist) as a single-page app."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .. import __version__, config
from .agent import router as agent_router
from .api import router
from .manuscripts import router as manuscripts_router
from .store import Store

DIST = config.WEB_DIR / "dist"


def create_app(db_path: Path | None = None, dist: Path = DIST, agent_allow_private: bool = False) -> FastAPI:
    app = FastAPI(title="Testimonia", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.store = Store(db_path or config.CORE_DB)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    # a front-end hosted elsewhere (e.g. Firebase Hosting) may call this API: TESTIMONIA_CORS_ORIGINS=https://a,https://b
    origins = [o.strip() for o in (config.setting("CORS_ORIGINS", "") or "").split(",") if o.strip()]
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type", "X-Api-Key"],
        )
    app.include_router(router)
    app.include_router(agent_router)
    app.include_router(manuscripts_router)
    # the assistant may call private/local model servers only when this server itself is private (local use)
    app.state.agent_allow_private = agent_allow_private

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False, response_model=None)
    def spa(path: str) -> FileResponse | JSONResponse:
        if path.startswith("api/"):
            raise HTTPException(404, "unknown API endpoint")
        target = (dist / path).resolve()
        if path and target.is_file() and target.is_relative_to(dist.resolve()):
            return FileResponse(target)
        index = dist / "index.html"
        if index.is_file():
            return FileResponse(index)
        return JSONResponse(
            {"error": "front-end not built", "hint": "run: cd web && npm install && npm run build"}, status_code=503
        )

    return app
