# Deploying Testimonia (free)

Testimonia is one Python server (FastAPI) plus one read-only SQLite database (~700 MB) and a static web app.
Nothing is stored about visitors: notes live in their browsers, and the AI assistant uses each visitor's own
API key for that one request.

## Option A: an Oracle Cloud Always Free VM (always on)

Oracle's Always Free Ampere instances (up to 4 cores / 24 GB) run around the clock without sleeping. An
instance you already use for something else works too.

**Quickest (VM on Tailscale):** after publishing the database (step 2, release `data-v1`), run on the VM

```bash
curl -fsSL https://raw.githubusercontent.com/<you>/testimonia/main/deploy/oracle/install.sh | bash -s -- <you>/testimonia
```

It installs Docker, starts the app and publishes it with Tailscale Funnel; run it again to update. The steps
below are what it does.

1. **Install Docker** on the VM: `curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER`,
   then log out and back in.

2. **Get the database there.** Either copy it (over Tailscale, from the computer that built it):

   ```bash
   scp ~/TestimoniaData/build/core-public.db ubuntu@<machine>:testimonia/deploy/oracle/data/core.db
   ```

   or publish it as a GitHub release asset (free, up to 2 GB) and let the container download it on first start:

   ```bash
   gh release create data-v1 ~/TestimoniaData/build/core-public.db --title "Database" --notes "Public build"
   # then in deploy/oracle/.env on the VM:
   # TESTIMONIA_CORE_DB_URL=https://github.com/<you>/testimonia/releases/download/data-v1/core-public.db
   ```

3. **Start the app** (on the VM; `tmux` keeps the build running if the connection drops):

   ```bash
   git clone https://github.com/<you>/testimonia.git && cd testimonia/deploy/oracle && mkdir -p data
   docker compose up -d --build          # the app listens on 127.0.0.1:7860 only
   ```

4. **Make it public**, one of:

   - **Tailscale Funnel** (if the VM is on Tailscale): no ports to open, HTTPS included.

     ```bash
     sudo tailscale funnel --bg 7860     # first time: follow the link it prints to allow Funnel
     ```

     The site is at `https://<machine>.<tailnet>.ts.net` (shown by `tailscale funnel status`). The setting
     survives reboots; `sudo tailscale funnel --https=443 off` takes it down.

   - **Caddy on the VM's public IP:** open TCP 80 and 443 in the subnet's *Security list* (source
     `0.0.0.0/0`) and in Ubuntu's firewall
     (`sudo iptables -I INPUT 6 -m state --state NEW -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save`),
     put `SITE_ADDRESS=<ip with dashes>.sslip.io` (or your domain) in `.env`, and run
     `docker compose --profile caddy up -d`. Caddy obtains the certificate itself.

To update later: `git pull && docker compose up -d --build`.

## Option B: a Hugging Face Space (paid for new Spaces)

Since mid-2026 new Docker Spaces need a PRO account (Spaces created earlier on free CPU keep running). With
PRO, a CPU Space (2 vCPU, 16 GB RAM) sleeps after 48 hours without visitors and wakes in about a minute.

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

Host only the web app on Firebase Hosting or Vercel and let it call the server above (the VM or the Space).
The server must be on HTTPS, which both VM setups provide.

```bash
cd web
VITE_API_BASE=https://<machine>.<tailnet>.ts.net npm run build   # the server's public address
```

- **Firebase Hosting** (Spark plan, free): `firebase init hosting` with public dir `web/dist`, then use
  `deploy/firebase.json` (single-page-app rewrite) and `firebase deploy` → `https://<project>.web.app`.
- **Vercel** (Hobby plan, free): import the repo, root `web`, build `npm run build`, output `dist`,
  environment variable `VITE_API_BASE`; `deploy/vercel.json` adds the single-page-app rewrite.

Allow that address on the server so the browser may call the API: on the VM add
`TESTIMONIA_CORS_ORIGINS=https://<project>.web.app` to `deploy/oracle/.env` and run `docker compose up -d`
(on a Space, set it under *Variables*). A custom
domain (~$10/year from any registrar) can point at whichever host you use.

## Running it yourself

```bash
docker build -t testimonia .
docker run -p 7860:7860 -v ~/TestimoniaData/build:/data/build testimonia     # uses your core.db
```

or, without Docker: `pip install -e .`, `testimonia fetch && testimonia build`, `cd web && npm ci && npm run build`,
then `testimonia serve --open`. A local server (bound to 127.0.0.1) may use local models (Ollama, LM Studio)
for the assistant directly.
