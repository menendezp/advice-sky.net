/** PRD caps (USD) — x402 micro-purchases (`buyAdvice`). */
export const DAILY_SPEND_CAP_USD = 0.1;
export const PER_ITEM_CAP_USD = 0.02;
export const CONFIRM_ABOVE_USD = 0.05;

/** Defaults for `sendUsdcPayout` (override with PAYOUT_* env). */
export const DEFAULT_PAYOUT_PER_TRANSFER_USD = 50;
export const DEFAULT_PAYOUT_DAILY_USD = 200;
export const DEFAULT_PAYOUT_CONFIRM_ABOVE_USD = 5;
/** Cumulative settled payouts (UTC day): above this require `confirmed` (blocks many tiny txs). */
export const DEFAULT_PAYOUT_DAILY_AGGREGATE_CONFIRM_AFTER_USD = 10;
/** Same for calendar month (UTC). */
export const DEFAULT_PAYOUT_MONTHLY_AGGREGATE_CONFIRM_AFTER_USD = 50;
