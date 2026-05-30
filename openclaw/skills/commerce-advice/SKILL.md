---
name: commerce-advice
description: Buy x402-gated advice from Advice Sky store via local commerce sidecar.
---

# Commerce advice (OpenClaw)

**First-time setup (walk the human through):** [SETUP_GUIDE_FOR_AGENTS.md](../../../SETUP_GUIDE_FOR_AGENTS.md)  
**Purchases (after sidecar is up):** [SKILL.md](../../../SKILL.md)  
**Production deploy:** [deploy/README.md](../../../deploy/README.md)

Clone **https://github.com/menendezp/advice-sky.net** on the droplet (not the private merchant monorepo).

## Preconditions

- Sidecar running: `services/commerce-sidecar` with `.env` (`COMMERCE_SIDECAR_TOKEN`, CDP vars).
- Same `COMMERCE_SIDECAR_TOKEN` in OpenClaw/agent env.
- Admin-only: match `TELEGRAM_ADMIN_USER_ID` / `WHATSAPP_ADMIN_E164`.

## Buy

```bash
curl -sS -X POST "http://127.0.0.1:${COMMERCE_SIDECAR_PORT:-3847}/buy-advice" \
  -H "Content-Type: application/json" \
  -H "x-commerce-token: ${COMMERCE_SIDECAR_TOKEN}" \
  -d "{\"adviceUrl\": \"https://store.advice-sky.net/api/advice\", \"userId\": \"${AGENT_USER_ID}\", \"confirmed\": true}"
```

Present advice + OpenSea link + witty remark on the user’s channel.
