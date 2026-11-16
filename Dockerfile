# Testimonia — one container: the API server and the built web app.
# The database is not baked into the image (it is ~1 GB): mount it at /data/build/core.db, or set
# TESTIMONIA_CORE_DB_URL and the container downloads it on first start.

# ---- web front-end
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# optional sign-in and sync (Firebase web config: not secret, it ships in the page); empty = no sign-in
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_APP_ID=""
RUN npm run build

# ---- server (the API and the assistant): target "api" leaves the web app out (Firebase serves it on GCP), so a
# small server never runs the memory-hungry web build
FROM python:3.13-slim AS api
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TESTIMONIA_DATA=/data \
    PORT=7860
WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
# the dependencies on their own layer: they change rarely, so code changes do not reinstall them
RUN python -c "import tomllib; d = tomllib.load(open('pyproject.toml', 'rb')); open('/tmp/req.txt', 'w').write(chr(10).join(d['project']['dependencies']))" \
    && pip install --no-cache-dir -r /tmp/req.txt
COPY testimonia/ testimonia/
COPY schema/ schema/
COPY curated/ curated/
COPY sources/ sources/
COPY deploy/ deploy/
RUN pip install --no-cache-dir --no-deps -e .
# run as an unprivileged user; /data holds the database
RUN useradd --create-home --uid 1000 app && mkdir -p /data/build && chown -R app /data
USER app
EXPOSE 7860
CMD ["python", "deploy/start.py"]

# ---- everything: the API server and the built web app in one container (the default target)
FROM api AS full
COPY --from=web /web/dist web/dist
