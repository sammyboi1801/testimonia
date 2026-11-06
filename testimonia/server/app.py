"""FastAPI application: the JSON API plus the built front-end (web/dist) as a single-page app."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

from .. import __version__, config
from .agent import router as agent_router
from .api import router
from .store import Store
from .study import router as study_router

DIST = config.WEB_DIR / "dist"

#: Responses streamed as server-sent events. Starlette's gzip holds compressed output back until its buffer
#: fills, which turned the assistant's live answer into one burst at the very end; these are sent uncompressed.
STREAMED_PATHS = ("/api/agent/chat",)


class GZipExceptStreams:
    """GZip for everything except the live event streams."""

    def __init__(self, app: ASGIApp) -> None:
        self.plain = app
        self.gzip = GZipMiddleware(app, minimum_size=1024)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"].startswith(STREAMED_PATHS):
            await self.plain(scope, receive, send)
        else:
            await self.gzip(scope, receive, send)


def create_app(db_path: Path | None = None, dist: Path = DIST, agent_allow_private: bool = False) -> FastAPI:
    app = FastAPI(title="Testimonia", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.store = Store(db_path or config.CORE_DB)
    app.add_middleware(GZipExceptStreams)
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
    app.include_router(study_router)
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
