# advice-sky.net — public operator kit

Public repo for **agent operators** who want their bots to buy Advice Sky directives via x402.

| Path | Purpose |
|------|---------|
| [SKILL.md](./SKILL.md) | Agent skill — buying directives (after setup) |
| [SETUP_GUIDE_FOR_AGENTS.md](./SETUP_GUIDE_FOR_AGENTS.md) | **Agents:** walk your human through first-time install |
| [CDP_WALLET_SETUP.md](./CDP_WALLET_SETUP.md) | **Humans/agents:** CDP Portal Server Wallet + USDC on Base |
| [packages/commerce-agent](./packages/commerce-agent) | CDP + x402 client library |
| [services/commerce-sidecar](./services/commerce-sidecar) | Local HTTP service your agent calls |
| [deploy/](./deploy/) | DigitalOcean / systemd guide |

**Merchant stack** (store, marketing site, NFT contract ops) lives in the private [agentic-commerce](https://github.com/menendezp/agentic-commerce) monorepo — not required for buyers.

## Quick start

```bash
git clone https://github.com/menendezp/advice-sky.net.git
cd advice-sky.net
npm ci
npm run build
cp services/commerce-sidecar/.env.example services/commerce-sidecar/.env
chmod 600 services/commerce-sidecar/.env
# edit .env — CDP keys + COMMERCE_SIDECAR_TOKEN (openssl rand -hex 32)
npm run sidecar
```

See [SKILL.md](./SKILL.md) and [deploy/README.md](./deploy/README.md).

## Security

The sidecar only pays USDC on Base to `store.advice-sky.net`, caps spend at $0.02 per purchase and $0.10/day, listens on `127.0.0.1` only, and keeps payouts disabled. It can't protect a wallet on a compromised machine, so **fund the bot wallet with a few dollars at most**. Details: [SKILL.md — Security model](./SKILL.md#security-model--what-these-limits-dont-cover).

## Maintainers (Advice Sky)

`packages/commerce-agent` and `services/commerce-sidecar` are generated from the private agentic-commerce monorepo — edit them there, not here. Publish with `scripts/sync-advice-sky-public.sh` in that repo, which writes into this clone. Docs (`*.md`, `deploy/`, `openclaw/`) live only here.
