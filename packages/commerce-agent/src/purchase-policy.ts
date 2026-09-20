/**
 * What an advice purchase is allowed to pay for. Pure and browser-safe (no node built-ins,
 * no env reads) so it can be unit-tested and shared by server and client callers.
 *
 * Why this exists: a 402 can list several payment options, and the x402 client pays the first
 * one it *supports* — not `accepts[0]`. Guardrails that price `accepts[0]` can approve a $0.01
 * decoy while the client signs a much larger authorization to another address, on any EVM
 * chain, in any token. Everything here therefore works on the requirement actually selected,
 * and filters the options before selection so only USDC on Base can be chosen at all.
 */
import type { x402Client } from "@x402/core/client";
import {
  assertDailyCap,
  assertPerItemCap,
  needsConfirmation,
  type GuardrailResult,
} from "./spend-guardrails.js";

export const ADVICE_NETWORK = "eip155:8453";
/** Native USDC on Base mainnet (6 decimals). */
export const ADVICE_USDC_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const DEFAULT_ADVICE_URL = "https://store.advice-sky.net/api/advice";
export const DEFAULT_ADVICE_ALLOWED_HOSTS: readonly string[] = ["store.advice-sky.net"];

/** Shape of an x402 v2 payment requirement, reduced to the fields the policy reads. */
export type AdvicePaymentRequirement = {
  scheme?: string;
  network?: string;
  asset?: string;
  amount?: string;
};

export function isAllowedAdviceRequirement(req: AdvicePaymentRequirement): boolean {
  return (
    req.scheme === "exact" &&
    req.network === ADVICE_NETWORK &&
    typeof req.asset === "string" &&
    req.asset.toLowerCase() === ADVICE_USDC_ASSET.toLowerCase() &&
    typeof req.amount === "string" &&
    /^\d+$/.test(req.amount)
  );
}

/** Atomic USDC (6 decimals) → USD. Callers must have checked the asset first. */
export function usdcAtomicToUsd(amountAtomic: string): number {
  return Number(BigInt(amountAtomic)) / 1e6;
}

export type AdvicePurchaseContext = {
  /** True only when a human approved this specific purchase. */
  confirmed: boolean;
  /** USD already spent today, counted toward the daily cap. */
  spentTodayUsd: number;
  /**
   * False when the seller is not on the operator's trusted list: every purchase then needs
   * `confirmed`, whatever the price. Omitted means trusted (callers that pin a host themselves).
   */
  trustedHost?: boolean;
};

export type AdvicePurchaseDecision =
  | { ok: true; usd: number }
  | { ok: false; reason: string };

export const UNTRUSTED_NEEDS_CONFIRMATION =
  "not a trusted site: ask the human before every purchase here, then retry with confirmed=true";

/** Decide whether the requirement the x402 client selected may be signed. */
export function evaluateAdvicePurchase(
  req: AdvicePaymentRequirement,
  ctx: AdvicePurchaseContext,
): AdvicePurchaseDecision {
  if (!isAllowedAdviceRequirement(req)) {
    return {
      ok: false,
      reason: `Refusing payment: only exact USDC on Base (${ADVICE_NETWORK}) is allowed, got ${req.scheme}/${req.network}/${req.asset}`,
    };
  }
  const usd = usdcAtomicToUsd(req.amount as string);
  const checks: GuardrailResult[] = [assertPerItemCap(usd)];
  if (ctx.trustedHost === false && ctx.confirmed !== true) {
    checks.push({ ok: false, reason: UNTRUSTED_NEEDS_CONFIRMATION });
  } else if (needsConfirmation(usd) && ctx.confirmed !== true) {
    checks.push({
      ok: false,
      reason: `$${usd} exceeds the confirmation threshold; ask the human, then retry with confirmed=true`,
    });
  }
  checks.push(assertDailyCap(ctx.spentTodayUsd, usd));
  for (const c of checks) {
    if (!c.ok) return { ok: false, reason: c.reason };
  }
  return { ok: true, usd };
}

export type AdviceUrlCheck =
  | { ok: true; host: string; trusted: boolean }
  | { ok: false; reason: string };

/** Names that can never belong to a public seller, whatever DNS answers. */
const NON_PUBLIC_SUFFIXES = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home.arpa"];
const NON_PUBLIC_NAMES = ["localhost", "metadata.google.internal", "metadata.goog"];
/** Bare IPv4/IPv6 literals; sellers are named hosts, and literals skip DNS entirely. */
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[?[0-9a-f:]*:[0-9a-f:.]*\]?)$/i;

/**
 * Rules that hold without asking DNS anything, so they work the same on a normal host and
 * inside a sandbox whose resolver rewrites every name (see host-safety.ts).
 */
function isStructurallyNonPublic(host: string): boolean {
  if (NON_PUBLIC_NAMES.includes(host)) return true;
  if (NON_PUBLIC_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (!host.includes(".")) return true; // single-label: intranet name, never a public seller
  return IP_LITERAL.test(host);
}

/**
 * Any https URL may be bought from; `trusted` says whether its host is on the operator's list.
 * Untrusted hosts need human confirmation per purchase and a public-address check before the
 * sidecar fetches them (see host-safety.ts), so a prompt-injected agent can't point the
 * sidecar at localhost or the local network.
 */
export function classifyAdviceUrl(
  adviceUrl: string,
  trustedHosts: readonly string[] = DEFAULT_ADVICE_ALLOWED_HOSTS,
): AdviceUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(adviceUrl);
  } catch {
    return { ok: false, reason: "adviceUrl is not a valid URL" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "adviceUrl must use https" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "adviceUrl must not contain credentials" };
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (isStructurallyNonPublic(host)) {
    return {
      ok: false,
      reason: `${host} is not a public seller hostname (IP literal or local/internal name); refusing to buy from it`,
    };
  }
  const trusted = trustedHosts.map((h) => h.trim().toLowerCase()).includes(host);
  return { ok: true, host, trusted };
}

/**
 * Only https URLs on an allowlisted host may be bought from. The sidecar would otherwise pay
 * (and fetch) any URL a prompt-injected agent passes it.
 */
export function assertAllowedAdviceUrl(
  adviceUrl: string,
  allowedHosts: readonly string[] = DEFAULT_ADVICE_ALLOWED_HOSTS,
): GuardrailResult {
  let parsed: URL;
  try {
    parsed = new URL(adviceUrl);
  } catch {
    return { ok: false, reason: "adviceUrl is not a valid URL" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "adviceUrl must use https" };
  }
  const host = parsed.hostname.toLowerCase();
  if (!allowedHosts.map((h) => h.trim().toLowerCase()).includes(host)) {
    return {
      ok: false,
      reason: `adviceUrl host ${host} is not allowlisted (allowed: ${allowedHosts.join(", ")})`,
    };
  }
  return { ok: true };
}

export type AdvicePurchaseGuards = {
  /** Resolved right before signing, so spend totals are as fresh as possible. */
  resolveContext: () => Promise<AdvicePurchaseContext>;
  /** Called with the approved USD once every check passes, before the payment is signed. */
  onAuthorized?: (usd: number, requirement: AdvicePaymentRequirement) => void | Promise<void>;
};

/**
 * Install the advice purchase policy on an x402 client: filter options down to USDC on Base
 * before selection, then price the requirement actually selected before it is signed.
 */
export function installAdvicePurchaseGuards(client: x402Client, guards: AdvicePurchaseGuards): void {
  client.registerPolicy((_version, reqs) => reqs.filter((r) => isAllowedAdviceRequirement(r)));
  client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    const decision = evaluateAdvicePurchase(selectedRequirements, await guards.resolveContext());
    if (!decision.ok) return { abort: true, reason: decision.reason };
    await guards.onAuthorized?.(decision.usd, selectedRequirements);
    return;
  });
}
