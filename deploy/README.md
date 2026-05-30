# Deploy: commerce sidecar (+ OpenClaw)

Run **commerce-sidecar** on the same host as your agent (VPS, DigitalOcean, etc.). It holds **your** CDP keys; the agent calls `http://127.0.0.1:3847` with `x-commerce-token`.

Clone the **public** operator repo (not the private merchant monorepo):

```bash
git clone https://github.com/menendezp/advice-sky.net.git /opt/advice-sky
```

---

## 1. Droplet prep

- Ubuntu 22.04+ (or similar), SSH.
- UFW: allow SSH (22). Do **not** expose port 3847 publicly.
- Deploy user (example `agentic`):

```bash
sudo adduser agentic
sudo mkdir -p /opt/advice-sky && sudo chown agentic:agentic /opt/advice-sky
sudo -u agentic git clone https://github.com/menendezp/advice-sky.net.git /opt/advice-sky
```

---

## 2. Node.js

Node **20 LTS** or newer (`node -v`, `npm -v`).

---

## 3. Install and build

```bash
cd /opt/advice-sky
git pull
npm ci
npm run build
```

`npm run build` compiles `@agentic/commerce-agent` to `dist/` (required by the sidecar).

---

## 4. Environment

```bash
cp services/commerce-sidecar/.env.example services/commerce-sidecar/.env
chmod 600 services/commerce-sidecar/.env
```

| Variable | Purpose |
|----------|---------|
| `COMMERCE_SIDECAR_TOKEN` | You generate (`openssl rand -hex 32`); agent sends same value in `x-commerce-token` |
| `CDP_*`, `CDP_AGENT_ACCOUNT_NAME` | Your CDP Server Wallet |
| `BASE_RPC_URL` | e.g. `https://mainnet.base.org` |
| `SUPABASE_*` | Optional logging |
| `NFT_*` | Optional local mint; **most operators rely on store mint** at `store.advice-sky.net` |

Export `COMMERCE_SIDECAR_TOKEN` for your agent/OpenClaw process too.

---

## 5. systemd

```bash
sudo cp /opt/advice-sky/deploy/commerce-sidecar.service.example /etc/systemd/system/commerce-sidecar.service
sudo systemctl daemon-reload
sudo systemctl enable --now commerce-sidecar
```

Adjust `User` and `/opt/advice-sky` paths if needed. Use `which npm` for `ExecStart` if `/usr/bin/npm` is missing.

---

## 6. Smoke test

```bash
curl -s http://127.0.0.1:3847/health

curl -sS -X POST http://127.0.0.1:3847/buy-advice \
  -H "Content-Type: application/json" \
  -H "x-commerce-token: $COMMERCE_SIDECAR_TOKEN" \
  -d '{"adviceUrl":"https://store.advice-sky.net/api/advice","confirmed":true}'
```

---

## 7. OpenClaw

Point `skills.extraDirs` at `openclaw/skills` in this repo:

- **`skynet-advice-setup`** — walk the human through first-time install
- **`commerce-advice`** — buy directives after the sidecar is running

Restrict purchases to your admin IDs per `commerce-advice`.

Docs: [SETUP_GUIDE_FOR_AGENTS.md](../SETUP_GUIDE_FOR_AGENTS.md), [SKILL.md](../SKILL.md).

---

## Updates

```bash
cd /opt/advice-sky && git pull && npm ci && npm run build
sudo systemctl restart commerce-sidecar
```

```bash
journalctl -u commerce-sidecar -f
```
