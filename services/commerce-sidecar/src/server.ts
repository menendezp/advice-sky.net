/**
 * Local HTTP service an agent calls to buy Advice Sky directives with the operator's CDP wallet.
 *
 * GET  /health      — liveness, unauthenticated
 * GET  /spend       — today's recorded spend vs the daily cap
 * POST /buy-advice  — x402 purchase (USDC on Base, allowlisted store only)
 * POST /send-payout — USDC transfer; disabled unless ENABLE_SEND_PAYOUT=true
 *
 * Auth: header `x-commerce-token` must equal COMMERCE_SIDECAR_TOKEN (32+ chars).
 * Binds 127.0.0.1 unless COMMERCE_SIDECAR_HOST says otherwise.
 *
 * NFTs are minted to the payer by the store after settlement, so this service holds no
 * contract-owner key.
 */
import "dotenv/config";
import { createHash, timingSafeEqual } from "node:crypto";
import express from "express";
import {
  DAILY_SPEND_CAP_USD,
  DEFAULT_ADVICE_URL,
  sendUsdcPayout,
} from "@agentic/commerce-agent";
import {
  buyAdviceWithLedger,
  readSpentTodayUsdLocal,
} from "@agentic/commerce-agent/server";

const MIN_TOKEN_LENGTH = 32;
const RATE_LIMIT_PER_MINUTE = 60;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

const token = process.env.COMMERCE_SIDECAR_TOKEN?.trim() ?? "";
const tokenDigest = createHash("sha256").update(token).digest();

function tokenMatches(presented: string): boolean {
  // Compare fixed-length digests so neither content nor length leaks through timing.
  const digest = createHash("sha256").update(presented).digest();
  return timingSafeEqual(digest, tokenDigest);
}

/**
 * Fixed-window limit per client address. Mostly relevant if someone rebinds the service off
 * loopback; the token is too long to brute-force, but there is no reason to allow unbounded tries.
 */
const hits = new Map<string, { windowStart: number; count: number }>();
function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const now = Date.now();
  const key = req.ip ?? "unknown";
  const entry = hits.get(key);
  if (!entry || now - entry.windowStart >= 60_000) {
    if (hits.size > 1_000) {
      for (const [k, v] of hits) if (now - v.windowStart >= 60_000) hits.delete(k);
    }
    hits.set(key, { windowStart: now, count: 1 });
    next();
    return;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_PER_MINUTE) {
    res.status(429).json({ error: "rate limited" });
    return;
  }
  next();
}

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (token.length < MIN_TOKEN_LENGTH) {
    res.status(503).json({
      error: `COMMERCE_SIDECAR_TOKEN not configured or shorter than ${MIN_TOKEN_LENGTH} characters (use: openssl rand -hex 32)`,
    });
    return;
  }
  const h = req.headers["x-commerce-token"];
  if (typeof h !== "string" || !tokenMatches(h)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

/** Supabase `users.id` is a UUID; anything else fails only after payment, so reject it up front. */
function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Readable message for any thrown value (CDP and x402 sometimes throw plain objects). */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/spend", rateLimit, auth, (_req, res) => {
  res.json({ spentTodayUsd: readSpentTodayUsdLocal(), dailyCapUsd: DAILY_SPEND_CAP_USD });
});

app.post("/buy-advice", rateLimit, auth, async (req, res) => {
  const body = (req.body ?? {}) as {
    adviceUrl?: unknown;
    userId?: unknown;
    confirmed?: unknown;
  };
  const adviceUrl = body.adviceUrl ?? DEFAULT_ADVICE_URL;
  if (typeof adviceUrl !== "string") {
    res.status(400).json({ error: "adviceUrl must be a string" });
    return;
  }
  if (body.userId != null && (typeof body.userId !== "string" || !isUuid(body.userId))) {
    res.status(400).json({ error: "userId must be a UUID or omitted" });
    return;
  }
  try {
    // Serialized, allowlisted, and spend recorded before signing — see buyAdviceWithLedger.
    const result = await buyAdviceWithLedger({
      adviceUrl,
      userId: (body.userId as string | undefined) ?? null,
      confirmed: body.confirmed === true,
    });
    // The store's `nft` field is an internal minting hint; the store mints to the payer itself.
    const advice =
      result.advice && typeof result.advice === "object"
        ? (({ nft: _nft, ...rest }) => rest)(result.advice as Record<string, unknown>)
        : result.advice;
    res.json({ ...result, advice });
  } catch (e) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.post("/send-payout", rateLimit, auth, async (req, res) => {
  if (process.env.ENABLE_SEND_PAYOUT !== "true") {
    res.status(403).json({
      error: "send-payout is disabled; set ENABLE_SEND_PAYOUT=true in the sidecar .env to enable it",
    });
    return;
  }
  const { to, amountUsd, userId, confirmed, memo } = req.body as {
    to?: string;
    amountUsd?: number;
    userId?: string | null;
    confirmed?: boolean;
    memo?: string | null;
  };
  if (!to || typeof to !== "string") {
    res.status(400).json({ error: "to required (0x recipient)" });
    return;
  }
  if (typeof amountUsd !== "number" || !Number.isFinite(amountUsd)) {
    res.status(400).json({ error: "amountUsd required (number)" });
    return;
  }
  try {
    const result = await sendUsdcPayout({
      to,
      amountUsd,
      userId: userId ?? null,
      confirmed: confirmed === true,
      memo: memo ?? null,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

const port = Number(process.env.COMMERCE_SIDECAR_PORT ?? 3847);
const host = process.env.COMMERCE_SIDECAR_HOST?.trim() || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`commerce-sidecar listening on ${host}:${port}`);
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    console.warn(
      `[commerce-sidecar] bound to ${host}, not loopback — anyone who can reach this port and guess or steal the token can spend from the wallet. Only do this behind TLS and a firewall.`,
    );
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    console.warn(
      `[commerce-sidecar] COMMERCE_SIDECAR_TOKEN missing or shorter than ${MIN_TOKEN_LENGTH} characters; authenticated routes return 503.`,
    );
  }
  if (process.env.NFT_OWNER_PRIVATE_KEY?.trim()) {
    console.warn(
      "[commerce-sidecar] NFT_OWNER_PRIVATE_KEY is set but no longer used — the store mints to the payer. Remove it from this host's .env.",
    );
  }
});
