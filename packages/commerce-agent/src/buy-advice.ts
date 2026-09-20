import { CdpClient } from "@coinbase/cdp-sdk";
import { cdpAccountToX402Signer } from "./cdp-signer.js";
import {
  DEFAULT_ADVICE_ALLOWED_HOSTS,
  UNTRUSTED_NEEDS_CONFIRMATION,
  classifyAdviceUrl,
  installAdvicePurchaseGuards,
  type AdvicePaymentRequirement,
} from "./purchase-policy.js";
import type { GuardrailResult } from "./spend-guardrails.js";
import {
  createCommerceSupabase,
  ensureUserIdForWallet,
  normalizeEvmWallet,
  sumSpentTodayUsd,
} from "./supabase.js";
import { extractDirectiveTokenIdFromAdvice } from "./advice-directive.js";
import { fetchPaidAdviceX402 } from "./x402-paid-fetch.js";

export type BuyAdviceOptions = {
  /**
   * Full https URL of the paid resource. Trusted hosts buy within the caps; any other host
   * needs `confirmed` for every purchase and a `checkHost` that rejects non-public addresses.
   */
  adviceUrl: string;
  /** Trusted hosts. Defaults to `ADVICE_ALLOWED_HOSTS`, or the public store when unset. */
  trustedHosts?: readonly string[];
  /**
   * Refuses hosts that resolve to local or private addresses. Required for untrusted hosts;
   * `buyAdviceWithLedger` supplies `assertPublicHost`.
   */
  checkHost?: (host: string) => Promise<GuardrailResult>;
  /**
   * Optional `public.users.id`. When omitted and Supabase is configured, a row is
   * created or reused by the payer EVM address (`evm_wallet`) so logs stay keyed per wallet.
   */
  userId?: string | null;
  /** True only when a human approved this specific purchase. Anything but `true` is false. */
  confirmed?: boolean;
  /**
   * USD already spent today by this wallet, counted toward `DAILY_SPEND_CAP_USD`. Required so
   * no caller skips the daily cap by accident; when Supabase is configured the higher of this
   * and the Supabase total is used. Node callers should use `buyAdviceWithLedger` from
   * `@agentic/commerce-agent/server`, which supplies it and records spend.
   */
  spentTodayUsd: number;
  /**
   * Called after every guardrail passes and before the payment is signed. Once signed, the
   * authorization can be settled even if the paid request later fails, so spend trackers
   * should record here rather than after the response.
   */
  onPaymentAuthorized?: (usd: number) => void | Promise<void>;
};

export type BuyAdviceResult = {
  advice: unknown;
  settlementTx: string;
  payer?: string;
  /** USD authorized for this purchase, or 0 when settlement reported failure. */
  paidUsd: number;
  /** True when `tx_logs` and `content` rows were inserted (Supabase env configured). */
  loggedToSupabase: boolean;
  /** `public.users.id` used for inserts when set (explicit `userId` or wallet-linked row). */
  buyerUserId: string | null;
  /** `advice_sale_events` row appended (duplicate `x402_tx_hash` counts as logged). */
  loggedAdviceSale: boolean;
};

/** `ADVICE_ALLOWED_HOSTS` (comma-separated) overrides the default store host, e.g. for a staging store. */
function allowedAdviceHosts(): readonly string[] {
  const raw = process.env.ADVICE_ALLOWED_HOSTS?.trim();
  if (!raw) return DEFAULT_ADVICE_ALLOWED_HOSTS;
  return raw.split(",").map((h) => h.trim()).filter(Boolean);
}

/**
 * Decide, before any network call to the seller, whether this URL may be bought from.
 * Returns whether the host is trusted; throws with a reason the agent can relay otherwise.
 */
export async function checkAdvicePurchaseTarget(
  opts: Pick<BuyAdviceOptions, "adviceUrl" | "trustedHosts" | "checkHost" | "confirmed">,
): Promise<{ host: string; trusted: boolean }> {
  const url = classifyAdviceUrl(opts.adviceUrl, opts.trustedHosts ?? allowedAdviceHosts());
  if (!url.ok) throw new Error(url.reason);
  // Trusted hosts skip the resolved-address check: the operator picked them, not the agent, so
  // the SSRF this guards against does not apply — and on hosts whose DNS is rewritten by a
  // sandbox egress proxy the check would otherwise block every seller. Structural hostname rules
  // in classifyAdviceUrl still apply to every URL.
  if (!url.trusted) {
    if (!opts.checkHost) {
      throw new Error(
        `${url.host} is not a trusted site, and buying from untrusted sites needs a public-address check (use buyAdviceWithLedger)`,
      );
    }
    if (opts.confirmed !== true) throw new Error(`${url.host} is ${UNTRUSTED_NEEDS_CONFIRMATION}`);
    const safe = await opts.checkHost(url.host);
    if (!safe.ok) throw new Error(safe.reason);
  }
  return { host: url.host, trusted: url.trusted };
}

export async function buyAdvice(opts: BuyAdviceOptions): Promise<BuyAdviceResult> {
  const { adviceUrl, userId = null, spentTodayUsd, onPaymentAuthorized } = opts;
  const confirmed = opts.confirmed === true;

  if (!Number.isFinite(spentTodayUsd) || spentTodayUsd < 0) {
    throw new Error("spentTodayUsd must be a non-negative number");
  }
  const { trusted } = await checkAdvicePurchaseTarget({ ...opts, confirmed });

  const cdp = new CdpClient();
  const name = process.env.CDP_AGENT_ACCOUNT_NAME;
  if (!name) {
    throw new Error("Missing CDP_AGENT_ACCOUNT_NAME");
  }

  const account = await cdp.evm.getAccount({ name });
  const payerWallet = normalizeEvmWallet(account.address);
  const sbForBuyer = createCommerceSupabase();
  let buyerUserId: string | null = userId ?? null;
  if (sbForBuyer && payerWallet && !buyerUserId) {
    buyerUserId = await ensureUserIdForWallet(sbForBuyer, payerWallet);
  }

  const rpcUrl = process.env.BASE_RPC_URL;
  const evmSigner = cdpAccountToX402Signer(account);

  /** USD approved by the guardrail hook for the requirement the client selected. */
  let authorizedUsd = 0;
  let selected: (AdvicePaymentRequirement & { payTo?: string }) | null = null;

  const paid = await fetchPaidAdviceX402({
    adviceUrl,
    signer: evmSigner,
    rpcUrl,
    configureClient: (core) =>
      installAdvicePurchaseGuards(core, {
        resolveContext: async () => {
          let spent = spentTodayUsd;
          if (sbForBuyer && buyerUserId) {
            const remote = await sumSpentTodayUsd(sbForBuyer, buyerUserId, {
              entryTypes: ["x402"],
            });
            spent = Math.max(spent, remote);
          }
          return { confirmed, spentTodayUsd: spent, trustedHost: trusted };
        },
        onAuthorized: async (usd, requirement) => {
          await onPaymentAuthorized?.(usd);
          authorizedUsd = usd;
          selected = requirement;
        },
      }),
  });

  const { advice, settlement } = paid;
  const paymentRequired = paid.paymentRequired;
  const body = paid.raw402Body;

  const sb = createCommerceSupabase();
  let loggedToSupabase = false;
  let loggedAdviceSale = false;
  const req = selected as (AdvicePaymentRequirement & { payTo?: string }) | null;
  if (sb && req && paymentRequired !== undefined && body !== undefined) {
    const payTo = req.payTo?.trim() ? req.payTo.trim().toLowerCase() : null;
    // USDC sender: the wallet that pays the merchant (CDP account; settlement.payer should match).
    const payFrom =
      payerWallet ?? normalizeEvmWallet(settlement.payer) ?? null;

    await sb.from("tx_logs").insert({
      user_id: buyerUserId,
      entry_type: "x402",
      chain: req.network ?? "unknown",
      amount: authorizedUsd,
      currency: "USDC",
      merchant_ref: adviceUrl,
      pay_from: payFrom,
      pay_to: payTo,
      tx_hash: settlement.transaction,
      status: settlement.success === false ? "failed" : "settled",
      raw_402: body as object,
    });
    await sb.from("content").insert({
      user_id: buyerUserId,
      source: "advice",
      payload: advice as object,
      tx_hash: settlement.transaction,
    });
    loggedToSupabase = true;

    const settlementOk = settlement.success !== false;
    const directiveTokenId = extractDirectiveTokenIdFromAdvice(advice);
    const payerNormalized =
      payerWallet ?? normalizeEvmWallet(settlement.payer) ?? null;
    if (settlementOk && directiveTokenId !== null) {
      try {
        const { error } = await sb.from("advice_sale_events").insert({
          token_id: directiveTokenId,
          payer: payerNormalized,
          user_id: buyerUserId,
          merchant_ref: adviceUrl,
          x402_tx_hash: settlement.transaction ?? null,
          mint_status: "not_configured",
        });
        if (!error) {
          loggedAdviceSale = true;
        } else if ((error as { code?: string }).code === "23505") {
          loggedAdviceSale = true;
        } else {
          console.warn(
            "[buyAdvice] advice_sale_events:",
            (error as { message?: string }).message ?? JSON.stringify(error),
          );
        }
      } catch (e) {
        console.warn("[buyAdvice] advice_sale_events insert failed:", e);
      }
    }
  }

  return {
    advice,
    settlementTx: settlement.transaction,
    payer: settlement.payer,
    paidUsd: settlement.success !== false ? authorizedUsd : 0,
    loggedToSupabase,
    buyerUserId,
    loggedAdviceSale,
  };
}
