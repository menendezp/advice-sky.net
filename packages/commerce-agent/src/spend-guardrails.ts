import {
  CONFIRM_ABOVE_USD,
  DAILY_SPEND_CAP_USD,
  DEFAULT_PAYOUT_CONFIRM_ABOVE_USD,
  DEFAULT_PAYOUT_DAILY_AGGREGATE_CONFIRM_AFTER_USD,
  DEFAULT_PAYOUT_DAILY_USD,
  DEFAULT_PAYOUT_MONTHLY_AGGREGATE_CONFIRM_AFTER_USD,
  DEFAULT_PAYOUT_PER_TRANSFER_USD,
  PER_ITEM_CAP_USD,
} from "./constants.js";

export type GuardrailResult =
  | { ok: true }
  | { ok: false; reason: string };

export function assertPerItemCap(amountUsd: number): GuardrailResult {
  if (amountUsd > PER_ITEM_CAP_USD + 1e-9) {
    return {
      ok: false,
      reason: `Amount $${amountUsd} exceeds per-item cap $${PER_ITEM_CAP_USD}`,
    };
  }
  return { ok: true };
}

export function needsConfirmation(amountUsd: number): boolean {
  return amountUsd > CONFIRM_ABOVE_USD + 1e-9;
}

export function assertDailyCapWithLimit(
  spentTodayUsd: number,
  nextSpendUsd: number,
  dailyCapUsd: number,
): GuardrailResult {
  if (spentTodayUsd + nextSpendUsd > dailyCapUsd + 1e-9) {
    return {
      ok: false,
      reason: `Daily cap $${dailyCapUsd} would be exceeded (already $${spentTodayUsd}, next $${nextSpendUsd})`,
    };
  }
  return { ok: true };
}

export function assertDailyCap(
  spentTodayUsd: number,
  nextSpendUsd: number,
): GuardrailResult {
  return assertDailyCapWithLimit(
    spentTodayUsd,
    nextSpendUsd,
    DAILY_SPEND_CAP_USD,
  );
}

function readPositiveEnvUsd(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function payoutPerTransferCapUsd(): number {
  return readPositiveEnvUsd(
    "PAYOUT_PER_TRANSFER_CAP_USD",
    DEFAULT_PAYOUT_PER_TRANSFER_USD,
  );
}

export function payoutDailyCapUsd(): number {
  return readPositiveEnvUsd("PAYOUT_DAILY_CAP_USD", DEFAULT_PAYOUT_DAILY_USD);
}

export function payoutConfirmAboveUsd(): number {
  return readPositiveEnvUsd(
    "PAYOUT_CONFIRM_ABOVE_USD",
    DEFAULT_PAYOUT_CONFIRM_ABOVE_USD,
  );
}

export function assertPayoutPerTransferCap(amountUsd: number): GuardrailResult {
  const cap = payoutPerTransferCapUsd();
  if (amountUsd > cap + 1e-9) {
    return {
      ok: false,
      reason: `Payout $${amountUsd} exceeds per-transfer cap $${cap}`,
    };
  }
  return { ok: true };
}

export function needsPayoutConfirmation(amountUsd: number): boolean {
  return amountUsd > payoutConfirmAboveUsd() + 1e-9;
}

export function payoutDailyAggregateConfirmAfterUsd(): number {
  return readPositiveEnvUsd(
    "PAYOUT_DAILY_AGGREGATE_CONFIRM_AFTER_USD",
    DEFAULT_PAYOUT_DAILY_AGGREGATE_CONFIRM_AFTER_USD,
  );
}

export function payoutMonthlyAggregateConfirmAfterUsd(): number {
  return readPositiveEnvUsd(
    "PAYOUT_MONTHLY_AGGREGATE_CONFIRM_AFTER_USD",
    DEFAULT_PAYOUT_MONTHLY_AGGREGATE_CONFIRM_AFTER_USD,
  );
}

/**
 * True when cumulative payout volume (day and/or month) has crossed configured thresholds,
 * so the caller must pass `confirmed: true` to proceed — blocks many sub-threshold transfers.
 */
export function needsPayoutAggregateConfirmation(
  spentTodayPayoutUsd: number,
  spentMonthPayoutUsd: number,
  nextAmountUsd: number,
): boolean {
  const d = payoutDailyAggregateConfirmAfterUsd();
  const m = payoutMonthlyAggregateConfirmAfterUsd();
  const dailyHit =
    spentTodayPayoutUsd > d + 1e-9 ||
    spentTodayPayoutUsd + nextAmountUsd > d + 1e-9;
  const monthHit =
    spentMonthPayoutUsd > m + 1e-9 ||
    spentMonthPayoutUsd + nextAmountUsd > m + 1e-9;
  return dailyHit || monthHit;
}
