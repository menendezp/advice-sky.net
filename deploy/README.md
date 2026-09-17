# Deploy: commerce sidecar (+ OpenClaw)

Run **commerce-sidecar** on the same host as your agent (VPS, DigitalOcean, etc.). It holds **your** CDP keys, listens on `127.0.0.1:3847` only, and the agent authenticates with a token kept in a `chmod 600` curl config file.

Clone the **public** operator repo (not the private merchant monorepo):

```bash
git clone https://github.com/menendezp/advice-sky.net.git /opt/advice-sky
```

---

## 1. Droplet prep

- Ubuntu 22.04+ (or similar), SSH.
- UFW: allow SSH (22). Do **not** expose port 3847 publicly. The sidecar binds `127.0.0.1` by default; leave it that way.
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
| `COMMERCE_SIDECAR_TOKEN` | You generate (`openssl rand -hex 32`, 32+ characters) |
| `CDP_*`, `CDP_AGENT_ACCOUNT_NAME` | Your CDP Server Wallet — dedicated project, small balance |
| `BASE_RPC_URL` | e.g. `https://mainnet.base.org` |
| `SUPABASE_*` | Optional purchase history |
| `ENABLE_SEND_PAYOUT` | Leave unset. Enables a USDC transfer endpoint buyers don't need. |

Leave optional settings commented out: values in `.env` override the systemd unit's `Environment=` lines, even when empty.

Then give the agent the token as its own OS user (see [SKILL.md](../SKILL.md) step 3), e.g. for a separate `openclaw` user:

```bash
sudo -u openclaw bash -c 'mkdir -p ~/.advice-sky && chmod 700 ~/.advice-sky'
sudo grep '^COMMERCE_SIDECAR_TOKEN=' /opt/advice-sky/services/commerce-sidecar/.env | cut -d= -f2- \
  | sudo -u openclaw bash -c 'umask 077; printf "header = \"x-commerce-token: %s\"\n" "$(cat)" > ~/.advice-sky/sidecar-curl.conf'
```

---

## 5. systemd

```bash
sudo cp /opt/advice-sky/deploy/commerce-sidecar.service.example /etc/systemd/system/commerce-sidecar.service
sudo systemctl daemon-reload
sudo systemctl enable --now commerce-sidecar
```

Adjust `User` and `/opt/advice-sky` paths if needed. Use `which npm` for `ExecStart` if `/usr/bin/npm` is missing.

The unit pins the sidecar to `127.0.0.1`, keeps the daily-spend ledger in `/var/lib/commerce-sidecar/` (created by systemd, mode 700), and turns on basic sandboxing (`NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`). Check the log after starting: `listening on 127.0.0.1:3847`.

---

## 6. Smoke test

Free checks, as the agent's user:

```bash
curl -s http://127.0.0.1:3847/health
curl -sS -K ~/.advice-sky/sidecar-curl.conf http://127.0.0.1:3847/spend
```

Optional $0.01 purchase:

```bash
curl -sS -K ~/.advice-sky/sidecar-curl.conf -X POST http://127.0.0.1:3847/buy-advice \
  -H "Content-Type: application/json" -d '{"confirmed": true}'
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

Read the changelog at the bottom of [SKILL.md](../SKILL.md) before updating, then:

```bash
cd /opt/advice-sky && git pull && npm ci && npm run build
sudo systemctl restart commerce-sidecar
```

```bash
journalctl -u commerce-sidecar -f
```
