/**
 * Free dry run of a purchase: every check a real buy makes, plus the seller's 402 — but no
 * payment is ever signed. Use it in smoke tests, so "it works" means a request actually left
 * the machine and came back, not just that /health answered.
 */
import { checkAdvicePurchaseTarget } from "./buy-advice.js";
import type { BuyAdviceOptions } from "./buy-advice.js";
import {
  evaluateAdvicePurchase,
  isAllowedAdviceRequirement,
  usdcAtomicToUsd,
  type AdvicePaymentRequirement,
} from "./purchase-policy.js";
import { X402_FETCH_HEADERS } from "./x402-paid-fetch.js";

export type PreflightResult = {
  adviceUrl: string;
  host: string;
  trusted: boolean;
  /** HTTP status the seller answered with; 402 is the expected one. */
  status: number;
  /** The payment option the sidecar would sign, if any is acceptable. */
  payable: { usd: number; payTo?: string; network?: string; asset?: string } | null;
  /** What a real purchase would do right now, given price, caps and confirmation. */
  wouldBuy: boolean;
  reason?: string;
};

function decodePaymentRequired(header: string | null, body: unknown): unknown {
  if (header) {
    try {
      return JSON.parse(Buffer.from(header.trim(), "base64").toString("utf8"));
    } catch {
      /* fall through to the body */
    }
  }
  return body;
}

export async function preflightAdvice(
  opts: Pick<BuyAdviceOptions, "adviceUrl" | "trustedHosts" | "checkHost" | "confirmed"> & {
    spentTodayUsd?: number;
  },
): Promise<PreflightResult> {
  const { host, trusted } = await checkAdvicePurchaseTarget(opts);
  const res = await fetch(opts.adviceUrl, {
    method: "GET",
    headers: { ...X402_FETCH_HEADERS },
    redirect: "error",
  });
  const base = { adviceUrl: opts.adviceUrl, host, trusted, status: res.status };

  if (res.status !== 402) {
    return {
      ...base,
      payable: null,
      wouldBuy: false,
      reason:
        res.status === 200
          ? "seller answered 200 without asking for payment"
          : `expected 402 from the seller, got ${res.status}`,
    };
  }

  const body = await res.json().catch(() => undefined);
  const decoded = decodePaymentRequired(res.headers.get("payment-required"), body) as
    | { accepts?: AdvicePaymentRequirement[] }
    | undefined;
  const accepts = Array.isArray(decoded?.accepts) ? decoded.accepts : [];
  const req = accepts.find(isAllowedAdviceRequirement);
  if (!req) {
    return {
      ...base,
      payable: null,
      wouldBuy: false,
      reason: `seller offers no exact USDC-on-Base option (${accepts.length} option(s) advertised)`,
    };
  }

  const usd = usdcAtomicToUsd(req.amount as string);
  const payable = {
    usd,
    payTo: (req as { payTo?: string }).payTo,
    network: req.network,
    asset: req.asset,
  };
  const decision = evaluateAdvicePurchase(req, {
    confirmed: opts.confirmed === true,
    spentTodayUsd: opts.spentTodayUsd ?? 0,
    trustedHost: trusted,
  });
  return decision.ok
    ? { ...base, payable, wouldBuy: true }
    : { ...base, payable, wouldBuy: false, reason: decision.reason };
}
