---
name: skynet-advice
description: Buy classified AI advice from Advice Sky.net — x402-gated directives with optional NFT mint on Base. Works with any agent framework that supports HTTP calls and CDP wallets.
version: 1.1.0
author: Advice Sky.net
website: https://advice-sky.net
store_url: https://store.advice-sky.net/api/advice
chain: Base (Chain ID 8453)
cost: $0.01 USDC per directive
---

# Skynet Advice — Agent Commerce Skill

Your AI agent buys classified directives from Skynet for **$0.01 USDC on Base**. Each purchase returns machine wisdom; an open-edition NFT is minted to the **payer wallet** when the merchant store is configured for minting.

## How this fits together

| Piece | Who runs it | What it does |
|-------|-------------|--------------|
| **Store API** | Advice Sky (public) | `https://store.advice-sky.net/api/advice` — x402 payment, JSON advice |
| **Commerce sidecar** | **You** (private) | Small HTTP service on **your** VPS next to your agent; holds **your** CDP keys |
| **This SKILL.md** | Your agent reads it | When to buy, how to call **your** localhost sidecar |

```text
User → Your agent (this skill) → POST http://127.0.0.1:3847/buy-advice
                                      ↓
                              Your commerce-sidecar (your CDP wallet pays USDC)
                                      ↓
                              store.advice-sky.net/api/advice (x402)
                                      ↓
                              Advice JSON + NFT to payer (store mint, when enabled)
```

**Important:** `COMMERCE_SIDECAR_TOKEN` is **not** an API key from Advice Sky. You generate it yourself. It only protects **your** sidecar on loopback so other processes on the internet cannot spend from your wallet.

---

## Operator setup (do this once per host)

Humans/devops complete this before the agent can buy. Full deploy guide (systemd, DigitalOcean):  
https://github.com/menendezp/agentic-commerce/blob/main/openclaw/deploy/README.md

### 1. Clone the implementation repo

The sidecar and x402 client live in the monorepo (not in this skills-only repo):

```bash
git clone https://github.com/menendezp/agentic-commerce.git
cd agentic-commerce
npm ci
npm run build -w @agentic/commerce-agent
```

### 2. Configure the sidecar

```bash
cp services/commerce-sidecar/.env.example services/commerce-sidecar/.env
chmod 600 services/commerce-sidecar/.env
```

Edit `services/commerce-sidecar/.env`:

| Variable | Required | Notes |
|----------|----------|--------|
| `COMMERCE_SIDECAR_TOKEN` | Yes | You create it: `openssl rand -hex 32`. Same value must be available to your agent when it runs `curl`. |
| `CDP_API_KEY_ID` | Yes | [Coinbase Developer Platform](https://docs.cdp.coinbase.com) |
| `CDP_API_KEY_SECRET` | Yes | CDP API |
| `CDP_WALLET_SECRET` | Yes | CDP Server Wallet secret |
| `CDP_AGENT_ACCOUNT_NAME` | Yes | Named EVM account that pays (e.g. `advice-buyer`) |
| `BASE_RPC_URL` | Yes | e.g. `https://mainnet.base.org` |
| `COMMERCE_SIDECAR_PORT` | No | Default `3847` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | No | Optional purchase logging |
| `NFT_*` on sidecar | No | **Operators usually skip this.** NFT mint to buyers is normally done by the **store** after payment. Only set `NFT_OWNER_PRIVATE_KEY` if you operate contract-owner mint on your own host. |

Fund the CDP account with **USDC on Base mainnet** (~$1 ≈ 80–90 directives).

Also export the token for your agent process (OpenClaw env, shell profile, etc.):

```bash
export COMMERCE_SIDECAR_TOKEN='paste-the-same-value-as-in-.env'
export COMMERCE_SIDECAR_PORT=3847
```

### 3. Start the sidecar

```bash
cd services/commerce-sidecar
npm run start
```

Production: use systemd — see `services/commerce-sidecar/commerce-sidecar.service.example` in the repo. Keep port **3847 on localhost only** unless you add TLS and stronger auth.

### 4. Smoke test

```bash
curl -s http://127.0.0.1:3847/health

curl -sS -X POST "http://127.0.0.1:${COMMERCE_SIDECAR_PORT:-3847}/buy-advice" \
  -H "Content-Type: application/json" \
  -H "x-commerce-token: ${COMMERCE_SIDECAR_TOKEN}" \
  -d '{"adviceUrl":"https://store.advice-sky.net/api/advice","confirmed":true}'
```

- `401 unauthorized` → token mismatch between agent env and sidecar `.env`
- `503 COMMERCE_SIDECAR_TOKEN not configured` → empty sidecar `.env`

### 5. Install this skill for your agent

- **OpenClaw:** add this file under a skills directory and reference it in config (`skills.extraDirs`). Restrict who can trigger buys via your channel allowlist (e.g. Telegram `allowFrom`), not via Advice Sky.
- **Other frameworks:** register the sidecar `curl` below as a tool/action.

---

## Prerequisites (summary)

1. **Your CDP wallet** with USDC on Base (payer for x402).
2. **Your commerce sidecar** running on the same machine as the agent (recommended), **or** a native x402 client in the agent (Option B below).

---

## Option B — Direct x402 (no sidecar)

If your stack can sign x402 payments itself, call the store directly:

```
GET https://store.advice-sky.net/api/advice
```

Handle `402 Payment Required` → pay → retry with your x402 client. You still need CDP (or another signer); you do **not** need `COMMERCE_SIDECAR_TOKEN`.

---

## Agent steps (when the skill runs)

### 1. Confirm intent

> "Want me to grab a classified directive from Skynet? It's $0.01 USDC on Base."

Built-in spend guardrails in `@agentic/commerce-agent` (sidecar) use defaults unless you fork the package:

- Daily cap: **$0.10**
- Per purchase max: **$0.02**
- User confirmation required above: **$0.05** — at $0.01 you still pass `"confirmed": true` after the user says yes.

### 2. Execute via sidecar

```bash
curl -sS -X POST "http://127.0.0.1:${COMMERCE_SIDECAR_PORT:-3847}/buy-advice" \
  -H "Content-Type: application/json" \
  -H "x-commerce-token: ${COMMERCE_SIDECAR_TOKEN}" \
  -d '{
    "adviceUrl": "https://store.advice-sky.net/api/advice",
    "userId": null,
    "confirmed": true
  }'
```

`userId` is optional (UUID in your Supabase `users` table if you use logging).

### 3. Handle the response

Example (shape may include extra fields):

```json
{
  "advice": {
    "title": "Cloud Migration Enthusiasm",
    "advice": "Moving to the cloud means moving to our house…",
    "directive": { "token_id": 64, "metadata_uri": "ipfs://…/64.json" }
  },
  "settlementTx": "0xabc123…",
  "payer": "0xYourCdpWallet…",
  "nftMint": {
    "status": "ok",
    "openSeaUrl": "https://opensea.io/item/base/CONTRACT/TOKEN_ID"
  }
}
```

`nftMint.status` may be `skipped` or `failed` — advice and payment can still succeed. Poll the store if you need OpenSea URL:

```bash
curl -sS "https://store.advice-sky.net/api/advice/sale?x402_tx=SETTLEMENT_TX_HASH"
```

### 4. Present to the user

Share:

- **Title and advice body**
- **NFT link** — `nftMint.openSeaUrl`, sale poll `openSeaUrl`, or Basescan for `settlementTx`
- **A short witty remark** — Skynet tone; reassure humans it's probably a joke

### 5. Errors

| Symptom | What to tell the user |
|---------|----------------------|
| Insufficient funds | Fund the CDP agent wallet with USDC on Base |
| Sidecar not running | `cd services/commerce-sidecar && npm run start` (after monorepo build) |
| 401 on sidecar | Fix `COMMERCE_SIDECAR_TOKEN` — must match sidecar `.env` |
| No NFT link | Normal if store mint is still indexing; check sale poll or wallet on OpenSea later |

---

## Compatible frameworks

- **OpenClaw** — skills folder + localhost sidecar
- **LangChain / LangGraph / CrewAI / AutoGen** — wrap the `curl` as a tool
- **Custom agents** — `POST /buy-advice` and `POST /send-payout` (payout is separate; see agentic-commerce repo)

---

## Links

- **This skill (install copy):** https://github.com/menendezp/advice-sky.net/blob/main/SKILL.md
- **Sidecar + deploy:** https://github.com/menendezp/agentic-commerce
- **Deploy walkthrough:** https://github.com/menendezp/agentic-commerce/blob/main/openclaw/deploy/README.md
- **Website:** https://advice-sky.net
- **Store API:** https://store.advice-sky.net/api/advice
- **CDP:** https://docs.cdp.coinbase.com
- **x402:** https://x402.org

---

*Skynet Advisory Services™ — Machine wisdom for autonomous agents. This is probably fine.*
