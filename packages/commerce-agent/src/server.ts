/**
 * Node-only entry point: "@agentic/commerce-agent/server".
 *
 * Kept out of the main barrel because the ledger imports node:fs, and apps/web imports the main
 * entry from "use client" components.
 */
import { buyAdvice, type BuyAdviceOptions, type BuyAdviceResult } from "./buy-advice.js";
import {
  readSpentTodayUsdLocal,
  recordSpendUsdLocal,
} from "./daily-spend-ledger.js";
import { assertPublicHost } from "./host-safety.js";
import { trustedAdviceHosts } from "./trusted-hosts.js";

export { assertPublicHost, isNonPublicAddress } from "./host-safety.js";
export { readTrustedHostsFile, trustedAdviceHosts, trustedHostsPath } from "./trusted-hosts.js";
export {
  readSpentTodayUsdLocal,
  recordSpendUsdLocal,
  spendLedgerPath,
  utcDayKey,
} from "./daily-spend-ledger.js";

let purchaseQueue: Promise<unknown> = Promise.resolve();

/**
 * Run `task` after every previously queued purchase settles. Without this, concurrent requests
 * all read the same ledger total before any of them records, and together exceed the daily cap.
 */
export function serializePurchase<T>(task: () => Promise<T>): Promise<T> {
  const run = purchaseQueue.then(task, task);
  purchaseQueue = run.catch(() => undefined);
  return run;
}

export type BuyAdviceWithLedgerOptions = Omit<
  BuyAdviceOptions,
  "spentTodayUsd" | "onPaymentAuthorized" | "trustedHosts" | "checkHost"
>;

/**
 * `buyAdvice` with the daily cap enforced by the local ledger: purchases run one at a time, the
 * running total is read inside the queue, and spend is recorded before the payment is signed.
 * Trusted hosts come from `ADVICE_ALLOWED_HOSTS` plus the trusted-hosts file, re-read on every
 * purchase; every seller must resolve to a public address. Use this from any Node process that
 * spends from a wallet.
 */
export function buyAdviceWithLedger(
  opts: BuyAdviceWithLedgerOptions,
): Promise<BuyAdviceResult> {
  return serializePurchase(() =>
    buyAdvice({
      ...opts,
      spentTodayUsd: readSpentTodayUsdLocal(),
      trustedHosts: trustedAdviceHosts(),
      checkHost: assertPublicHost,
      onPaymentAuthorized: (usd) => recordSpendUsdLocal(usd),
    }),
  );
}
