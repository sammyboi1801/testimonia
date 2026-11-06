"""FastAPI application: the JSON API plus the built front-end (web/dist) as a single-page app."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .. import __version__, config
from .api import router
from .store import Store

DIST = config.WEB_DIR / "dist"


def create_app(db_path: Path | None = None, dist: Path = DIST) -> FastAPI:
    app = FastAPI(title="Testimonia", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.store = Store(db_path or config.CORE_DB)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.include_router(router)

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
