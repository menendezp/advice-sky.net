import { CdpClient } from "@coinbase/cdp-sdk";
import {
  assertDailyCapWithLimit,
  assertPayoutPerTransferCap,
  needsPayoutAggregateConfirmation,
  needsPayoutConfirmation,
  payoutDailyAggregateConfirmAfterUsd,
  payoutDailyCapUsd,
  payoutMonthlyAggregateConfirmAfterUsd,
} from "./spend-guardrails.js";
import {
  createCommerceSupabase,
  ensureUserIdForWallet,
  normalizeEvmWallet,
  sumSpentMonthUsd,
  sumSpentTodayUsd,
} from "./supabase.js";

export type SendUsdcPayoutOptions = {
  /** Recipient `0x` address (any valid EVM address you trust). */
  to: string;
  /** Amount in USD (USDC, 6 decimals). */
  amountUsd: number;
  /** Optional `public.users.id`; otherwise keyed by payer `evm_wallet`. */
  userId?: string | null;
  /**
   * Required when a single payout exceeds `PAYOUT_CONFIRM_ABOVE_USD`, or when cumulative
   * settled payouts today/month cross `PAYOUT_*_AGGREGATE_CONFIRM_AFTER_USD` (anti-spam).
   */
  confirmed?: boolean;
  /** Short note for `tx_logs.merchant_ref` (e.g. channel + user handle). */
  memo?: string | null;
};

export type SendUsdcPayoutResult = {
  transactionHash: string;
  payer: string;
  payee: string;
  amountUsd: number;
  loggedToSupabase: boolean;
  buyerUserId: string | null;
};

function cdpNetworkToCaip2(network: string): string {
  const n = network.trim().toLowerCase();
  if (n === "base") return "eip155:8453";
  if (n === "base-sepolia") return "eip155:84532";
  if (n === "ethereum") return "eip155:1";
  return `unknown:${network}`;
}

function usdToUsdcAtomic(amountUsd: number): bigint {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("amountUsd must be a finite number > 0");
  }
  return BigInt(Math.round(amountUsd * 1_000_000));
}

/**
 * Send USDC from the CDP agent wallet to any valid EVM address (Base by default).
 * Enforces per-transfer cap, daily payout hard cap, per-tx confirmation, and aggregate
 * day/month confirmation (after $10/day and $50/month cumulative by default) so many small
 * transfers cannot bypass human approval.
 */
export async function sendUsdcPayout(
  opts: SendUsdcPayoutOptions,
): Promise<SendUsdcPayoutResult> {
  const { to, amountUsd, userId = null, confirmed = false, memo = null } = opts;

  const payee = normalizeEvmWallet(to);
  if (!payee) {
    throw new Error("Invalid recipient address (expected 0x + 40 hex)");
  }

  const per = assertPayoutPerTransferCap(amountUsd);
  if (!per.ok) throw new Error(per.reason);

  if (needsPayoutConfirmation(amountUsd) && !confirmed) {
    throw new Error(
      `Payout $${amountUsd} requires explicit confirmation; set confirmed=true after user approves on your channel`,
    );
  }

  const cdp = new CdpClient();
  const name = process.env.CDP_AGENT_ACCOUNT_NAME;
  if (!name) {
    throw new Error("Missing CDP_AGENT_ACCOUNT_NAME");
  }

  const network = (process.env.CDP_EVM_NETWORK ?? "base").trim() as
    | "base"
    | "base-sepolia"
    | "ethereum";

  const account = await cdp.evm.getAccount({ name });
  const payerWallet = normalizeEvmWallet(account.address);
  if (!payerWallet) {
    throw new Error("CDP account address invalid");
  }
  if (payee === payerWallet) {
    throw new Error("Cannot send payout to the same address as the payer wallet");
  }

  const sb = createCommerceSupabase();
  let buyerUserId: string | null = userId ?? null;
  if (sb && payerWallet && !buyerUserId) {
    buyerUserId = await ensureUserIdForWallet(sb, payerWallet);
  }

  if (sb && buyerUserId) {
    const spentPayoutToday = await sumSpentTodayUsd(sb, buyerUserId, {
      entryTypes: ["payout"],
    });
    const spentPayoutMonth = await sumSpentMonthUsd(sb, buyerUserId, {
      entryTypes: ["payout"],
    });

    if (
      needsPayoutAggregateConfirmation(
        spentPayoutToday,
        spentPayoutMonth,
        amountUsd,
      ) &&
      !confirmed
    ) {
      throw new Error(
        `Cumulative payouts cross $${payoutDailyAggregateConfirmAfterUsd()}/day and/or $${payoutMonthlyAggregateConfirmAfterUsd()}/month (today $${spentPayoutToday.toFixed(2)}, month $${spentPayoutMonth.toFixed(2)}); set confirmed=true after explicit approval to continue`,
      );
    }

    const daily = assertDailyCapWithLimit(
      spentPayoutToday,
      amountUsd,
      payoutDailyCapUsd(),
    );
    if (!daily.ok) throw new Error(daily.reason);
  }

  const scoped = await account.useNetwork(network);
  const { transactionHash } = await scoped.transfer({
    to: payee as `0x${string}`,
    amount: usdToUsdcAtomic(amountUsd),
    token: "usdc",
  });

  let loggedToSupabase = false;
  if (sb) {
    const ref =
      memo && memo.trim()
        ? `payout:${memo.trim().slice(0, 240)}`
        : "payout:manual";
    await sb.from("tx_logs").insert({
      user_id: buyerUserId,
      entry_type: "payout",
      chain: cdpNetworkToCaip2(network),
      amount: amountUsd,
      currency: "USDC",
      merchant_ref: ref,
      pay_from: payerWallet,
      pay_to: payee,
      tx_hash: transactionHash,
      status: "settled",
      raw_402: null,
    });
    loggedToSupabase = true;
  }

  return {
    transactionHash,
    payer: payerWallet,
    payee,
    amountUsd,
    loggedToSupabase,
    buyerUserId,
  };
}
