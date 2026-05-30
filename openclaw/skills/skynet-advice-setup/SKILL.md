---
name: skynet-advice-setup
description: Walk your human through installing the Advice Sky commerce sidecar and agent skill. Use when they ask to set up, install, or enable Skynet advice purchases.
---

# Setup guide for agents (walk your human through this)

**Audience:** You (the AI agent). **Goal:** Get your human’s host ready so you can run [SKILL.md](./SKILL.md) and buy directives for $0.01 USDC.

Read this file when the human says things like:

- “Install the Advice Sky / Skynet advice skill”
- “Set up my bot to buy advice”
- “Help me configure the commerce sidecar”
- “I cloned advice-sky.net — what now?”

If setup is **already done** (health check passes, see Step 8), skip to [SKILL.md](./SKILL.md) for purchase flow only.

---

## How you should work with the human

1. **One phase at a time.** Do not dump every env var at once. Confirm each phase before the next.
2. **Plain language.** They are not required to understand x402; they need a wallet with a little USDC and a small service running locally.
3. **Secrets stay out of chat when possible.** Ask them to edit `services/commerce-sidecar/.env` on the server (SSH, nano, VS Code Remote). If they paste CDP keys in chat, warn them to rotate keys in CDP after setup and never commit `.env`.
4. **You never get a token from Advice Sky.** `COMMERCE_SIDECAR_TOKEN` is a random string **they** create; same value goes in sidecar `.env` and in the environment your process uses for `curl`.
5. **Set expectations.** Each test purchase costs **real $0.01 USDC** on Base mainnet. ~$1 USDC funds roughly 80–90 tries.

---

## Architecture (explain this in one short paragraph if asked)

- **Advice Sky store** (public URL) sells the directive after payment.
- **Commerce sidecar** (on **their** machine) holds Coinbase CDP wallet credentials and signs the payment.
- **You** call `http://127.0.0.1:3847` — you do not hold CDP secrets if the sidecar pattern is used correctly.

Repo to clone (public, no private merchant repo needed):

`https://github.com/menendezp/advice-sky.net`

---

## Phase 0 — Prerequisites checklist

Ask the human to confirm:

| # | Question | Required |
|---|----------|----------|
| 0.1 | A Linux VPS or always-on machine where the agent runs (or will run) | Yes |
| 0.2 | Node.js 20+ and npm (`node -v`, `npm -v`) | Yes |
| 0.3 | A [Coinbase Developer Platform](https://docs.cdp.coinbase.com) project with **Server Wallet** enabled | Yes |
| 0.4 | Willingness to fund an agent wallet with **USDC on Base** (start with ~$1) | Yes |
| 0.5 | SSH or shell access to that machine | Yes |

If they only use a laptop that sleeps, suggest a small VPS (DigitalOcean, etc.) — point to [deploy/README.md](./deploy/README.md) for systemd.

---

## Phase 1 — Clone and build

Run or instruct (adjust path if they prefer `~/advice-sky` over `/opt/advice-sky`):

```bash
git clone https://github.com/menendezp/advice-sky.net.git /opt/advice-sky
cd /opt/advice-sky
npm ci
npm run build
```

**Verify:** `test -f packages/commerce-agent/dist/index.js && echo OK`

If `npm ci` fails (no lockfile edge case), use `npm install` then `npm run build`.

Tell the human: “The operator kit is cloned and the payment library is compiled.”

---

## Phase 2 — CDP Server Wallet (human + CDP Portal)

**Use the dedicated walkthrough:** [CDP_WALLET_SETUP.md](../../../CDP_WALLET_SETUP.md)  
Walk your human through **Part A → E** one at a time (API key, wallet secret, named account, USDC on Base, then `.env`).

Short checklist for you:

1. **Not MetaMask** — CDP **Server Wallet**; sidecar holds credentials.
2. Portal: [CDP Portal](https://portal.cdp.coinbase.com) → API key + **wallet secret** (two different secrets).
3. Create named account `advice-buyer` (CLI: `cdp evm accounts create name=advice-buyer` or `npm run cdp:create-account` after clone).
4. Fund the printed **0x address** with **USDC on Base mainnet**.
5. Never paste `CDP_WALLET_SECRET` or API secret into chat.

**Verify:** `npm run cdp:verify` from repo root (with CDP vars in env) or `cdp evm token balances --account advice-buyer --network base`. USDC balance should be above $0.05.

---

## Phase 3 — Sidecar `.env` (human edits file on server)

(CDP values from [CDP_WALLET_SETUP.md](../../../CDP_WALLET_SETUP.md) Part E.)

```bash
cd /opt/advice-sky
cp services/commerce-sidecar/.env.example services/commerce-sidecar/.env
chmod 600 services/commerce-sidecar/.env
```

They must set at minimum:

```env
COMMERCE_SIDECAR_TOKEN=<output of: openssl rand -hex 32>
CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...
CDP_WALLET_SECRET=...
CDP_AGENT_ACCOUNT_NAME=advice-buyer
BASE_RPC_URL=https://mainnet.base.org
```

Optional: `COMMERCE_SIDECAR_PORT=3847`, `SUPABASE_*` for logging.

**Skip for most users:** `NFT_OWNER_PRIVATE_KEY` / contract owner mint — NFTs usually mint via the public store after payment.

Remind them: **same** `COMMERCE_SIDECAR_TOKEN` must be available to the agent process (OpenClaw env, systemd drop-in, or shell profile).

---

## Phase 4 — Agent environment (so you can call the sidecar)

Depending on their framework:

**OpenClaw / shell on same host:**

```bash
export COMMERCE_SIDECAR_TOKEN='same-as-in-env-file'
export COMMERCE_SIDECAR_PORT=3847
```

Persist in whatever they use for the agent daemon (systemd `Environment=`, OpenClaw config env, `.bashrc` for testing only).

**Other agents:** Ensure the tool/runtime that runs `curl` inherits these variables.

**Verify:** Human runs `echo $COMMERCE_SIDECAR_TOKEN | wc -c` — should show a non-empty length (64+ chars for hex token).

---

## Phase 5 — Start the sidecar

**Dev / test (foreground):**

```bash
cd /opt/advice-sky/services/commerce-sidecar
npm run start
```

**Production:** [deploy/README.md](./deploy/README.md) — systemd unit at `deploy/commerce-sidecar.service.example`.

**Verify:**

```bash
curl -s http://127.0.0.1:3847/health
```

Expected: `{"ok":true}`

If connection refused → sidecar not running or wrong port.

---

## Phase 6 — Install this skill for yourself

Tell the human how **you** load skills in their stack:

| Framework | Action |
|-----------|--------|
| **OpenClaw** | Add `openclaw/skills` to `skills.extraDirs` — enables **`skynet-advice-setup`** (this guide) and **`commerce-advice`** (purchases) |
| **LangChain / CrewAI / etc.** | Register [SKILL.md](./SKILL.md) as tool instructions or copy purchase `curl` into a tool |
| **Raw** | Keep [SKILL.md](./SKILL.md) in context when buying |

Also add **this file** (`SETUP_GUIDE_FOR_AGENTS.md`) if they want you to help others later.

Optional: restrict who can trigger buys (OpenClaw Telegram/WhatsApp `allowFrom` admin IDs).

---

## Phase 7 — Optional smoke purchase (costs $0.01)

Warn the human first. Then run:

```bash
curl -sS -X POST "http://127.0.0.1:${COMMERCE_SIDECAR_PORT:-3847}/buy-advice" \
  -H "Content-Type: application/json" \
  -H "x-commerce-token: ${COMMERCE_SIDECAR_TOKEN}" \
  -d '{"adviceUrl":"https://store.advice-sky.net/api/advice","confirmed":true}'
```

**Success:** JSON with `advice`, `settlementTx`, maybe `nftMint`.

**Common failures:**

| Error | What to tell the human |
|-------|-------------------------|
| `401 unauthorized` | Token in `curl` ≠ `COMMERCE_SIDECAR_TOKEN` in `.env` |
| `503 COMMERCE_SIDECAR_TOKEN not configured` | Empty token in `.env` |
| CDP / wallet errors | Wrong CDP vars or account name; check CDP dashboard |
| Insufficient funds | Add USDC on Base to the CDP agent account |
| Connection refused | Start sidecar (Phase 5) |

---

## Phase 8 — You are ready for normal use

When health check passes and (optionally) smoke purchase works:

1. Tell the human setup is complete.
2. Follow [SKILL.md](./SKILL.md) when they ask for advice — confirm $0.01, then `POST /buy-advice`.
3. Present advice + OpenSea link + short witty remark.

---

## Quick “already set up?” detection

Run silently if you have shell access:

```bash
curl -sf http://127.0.0.1:3847/health >/dev/null && echo READY || echo NOT_READY
```

If `READY` and human only wanted a purchase, skip Phases 1–7.

---

## What not to promise

- Advice Sky does **not** host your sidecar or issue your `COMMERCE_SIDECAR_TOKEN`.
- Support is **not** a human inbox on Advice Sky — see website terms / contact gag.
- NFT mint can lag; payment + advice can still succeed without immediate OpenSea link.

---

## Links to give the human

- Operator repo: https://github.com/menendezp/advice-sky.net
- Website: https://advice-sky.net
- CDP Server Wallet (humans): https://github.com/menendezp/advice-sky.net/blob/main/CDP_WALLET_SETUP.md
- CDP docs: https://docs.cdp.coinbase.com
- Production deploy: https://github.com/menendezp/advice-sky.net/blob/main/deploy/README.md

---

*When setup is done, defer to SKILL.md for every purchase. This is probably fine.*
