# Deploying Testimonia (free)

Testimonia is one Python server (FastAPI) plus one read-only SQLite database (~1 GB) and a static web app.
Nothing is stored about visitors: notes live in their browsers, and the AI assistant uses each visitor's own
API key for that one request.

## Recommended: everything on a free Hugging Face Space

Free CPU Spaces need no card and are large enough (2 vCPU, 16 GB RAM). They sleep after 48 hours without
visitors; the next visit wakes them in about a minute.

1. **Build the shareable database** (leaves out sources not cleared for redistribution, e.g. CCEL's files):

   ```bash
   TESTIMONIA_CORE_DB=~/TestimoniaData/build/core-public.db testimonia build --public
   ```

2. **Upload it as a Hugging Face dataset** (for example `yourname/testimonia-data`), file `core.db`.
   Its download URL is `https://huggingface.co/datasets/yourname/testimonia-data/resolve/main/core.db`.

3. **Create a Space** → SDK *Docker* → blank. Push this repository to the Space (or connect it), and put this
   front matter at the top of the Space's `README.md` (see `deploy/huggingface/README.md`):

   ```yaml
   ---
   title: Testimonia
   emoji: 📜
   colorFrom: yellow
   colorTo: red
   sdk: docker
   app_port: 7860
   ---
   ```

4. **Space settings → Variables:**

   | Variable | Value |
   |---|---|
   | `TESTIMONIA_CORE_DB_URL` | the dataset download URL from step 2 |
   | `TESTIMONIA_CORE_DB_SHA256` | *(optional)* `sha256sum core.db` |
   | `TESTIMONIA_CORS_ORIGINS` | *(only with a separate front door, below)* e.g. `https://testimonia.web.app` |

   On start the container downloads the database once and serves the app on port 7860
   (`deploy/start.py`). The public server never lets the assistant call private network addresses.

The app is then live at `https://yourname-testimonia.hf.space`.

## Optional: a nicer address in front (still free)

Host only the web app on Firebase Hosting or Vercel and let it call the Space's API.

```bash
cd web
VITE_API_BASE=https://yourname-testimonia.hf.space npm run build   # the API lives on the Space
```

- **Firebase Hosting** (Spark plan, free): `firebase init hosting` with public dir `web/dist`, then use
  `deploy/firebase.json` (single-page-app rewrite) and `firebase deploy` → `https://<project>.web.app`.
- **Vercel** (Hobby plan, free): import the repo, root `web`, build `npm run build`, output `dist`,
  environment variable `VITE_API_BASE`; `deploy/vercel.json` adds the single-page-app rewrite.

Set `TESTIMONIA_CORS_ORIGINS` on the Space to that address so the browser may call the API. A custom
domain (~$10/year from any registrar) can point at whichever host you use.

## Running it yourself

```bash
docker build -t testimonia .
docker run -p 7860:7860 -v ~/TestimoniaData/build:/data/build testimonia     # uses your core.db
```

or, without Docker: `pip install -e .`, `testimonia fetch && testimonia build`, `cd web && npm ci && npm run build`,
then `testimonia serve --open`. A local server (bound to 127.0.0.1) may use local models (Ollama, LM Studio)
for the assistant directly.
