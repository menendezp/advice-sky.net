import { CdpClient } from "@coinbase/cdp-sdk";
import { cdpAccountToX402Signer } from "./cdp-signer.js";
import {
  assertDailyCap,
  assertPerItemCap,
  needsConfirmation,
} from "./spend-guardrails.js";
import {
  createCommerceSupabase,
  ensureUserIdForWallet,
  normalizeEvmWallet,
  sumSpentTodayUsd,
} from "./supabase.js";
import { extractDirectiveTokenIdFromAdvice } from "./advice-directive.js";
import { fetchPaidAdviceX402 } from "./x402-paid-fetch.js";

export type BuyAdviceOptions = {
  /** Full URL to GET /api/advice (paid resource). */
  adviceUrl: string;
  /**
   * Optional `public.users.id`. When omitted and Supabase is configured, a row is
   * created or reused by the payer EVM address (`evm_wallet`) so logs stay keyed per wallet.
   */
  userId?: string | null;
  /** Set true when the human approved a spend above the confirmation threshold. */
  confirmed?: boolean;
};

export type BuyAdviceResult = {
  advice: unknown;
  settlementTx: string;
  payer?: string;
  /** True when `tx_logs` and `content` rows were inserted (Supabase env configured). */
  loggedToSupabase: boolean;
  /** `public.users.id` used for inserts when set (explicit `userId` or wallet-linked row). */
  buyerUserId: string | null;
  /** `advice_sale_events` row appended (duplicate `x402_tx_hash` counts as logged). */
  loggedAdviceSale: boolean;
};

function usdcAtomicToUsd(amountAtomic: string): number {
  return Number(BigInt(amountAtomic)) / 1e6;
}

export async function buyAdvice(opts: BuyAdviceOptions): Promise<BuyAdviceResult> {
  const { adviceUrl, userId = null, confirmed = false } = opts;

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

  const paid = await fetchPaidAdviceX402({
    adviceUrl,
    signer: evmSigner,
    rpcUrl,
    configureClient: (core) => {
      core.onBeforePaymentCreation(async ({ paymentRequired }) => {
        const first = paymentRequired.accepts[0];
        if (!first) return { abort: true, reason: "No payment options in 402" };

        const usd = usdcAtomicToUsd(first.amount);
        const per = assertPerItemCap(usd);
        if (!per.ok) return { abort: true, reason: per.reason };

        if (needsConfirmation(usd) && !confirmed) {
          return {
            abort: true,
            reason:
              "Spend exceeds confirmation threshold; set confirmed=true after user approves in WhatsApp/Telegram",
          };
        }

        if (sbForBuyer && buyerUserId) {
          const spent = await sumSpentTodayUsd(sbForBuyer, buyerUserId, {
            entryTypes: ["x402"],
          });
          const daily = assertDailyCap(spent, usd);
          if (!daily.ok) return { abort: true, reason: daily.reason };
        }

        return;
      });
    },
  });

  const { advice, settlement } = paid;
  const paymentRequired = paid.paymentRequired;
  const body = paid.raw402Body;

  const sb = createCommerceSupabase();
  let loggedToSupabase = false;
  let loggedAdviceSale = false;
  if (sb && paymentRequired !== undefined && body !== undefined) {
    const pr = paymentRequired as { accepts?: Array<{ payTo?: string; network?: string; amount?: string }> };
    const firstReq = pr.accepts?.[0];
    const payTo = firstReq?.payTo?.trim()
      ? firstReq.payTo.trim().toLowerCase()
      : null;
    // USDC sender: the wallet that pays the merchant (CDP account; settlement.payer should match).
    const payFrom =
      payerWallet ?? normalizeEvmWallet(settlement.payer) ?? null;

    await sb.from("tx_logs").insert({
      user_id: buyerUserId,
      entry_type: "x402",
      chain: firstReq?.network ?? "unknown",
      amount: usdcAtomicToUsd(firstReq?.amount ?? "0"),
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
    loggedToSupabase,
    buyerUserId,
    loggedAdviceSale,
  };
}
