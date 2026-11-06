# Testimonia — one container: the API server and the built web app.
# The database is not baked into the image (it is ~1 GB): mount it at /data/build/core.db, or set
# TESTIMONIA_CORE_DB_URL and the container downloads it on first start.

# ---- web front-end
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- server
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TESTIMONIA_DATA=/data \
    PORT=7860
WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY testimonia/ testimonia/
COPY schema/ schema/
COPY curated/ curated/
COPY sources/ sources/
COPY deploy/ deploy/
RUN pip install --no-cache-dir -e .
COPY --from=web /web/dist web/dist

# run as an unprivileged user; /data holds the database
RUN useradd --create-home --uid 1000 app && mkdir -p /data/build && chown -R app /data
USER app
EXPOSE 7860
CMD ["python", "deploy/start.py"]
