/**
 * Local on-disk record of settled x402 spend, so `DAILY_SPEND_CAP_USD` holds for
 * operators who never configure Supabase (the common case for the public kit).
 *
 * Supabase stays authoritative when it is configured; `buyAdvice` enforces the cap
 * against whichever total is higher.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** UTC day, matching the UTC-midnight window `sumSpentTodayUsd` queries. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Override with `COMMERCE_SPEND_LEDGER_PATH` (systemd units without a HOME should set it). */
export function spendLedgerPath(): string {
  const override = process.env.COMMERCE_SPEND_LEDGER_PATH?.trim();
  if (override) return override;
  return join(homedir(), ".advice-sky", "x402-spend.json");
}

type LedgerFile = { day: string; spentUsd: number };

function readLedger(): LedgerFile | null {
  try {
    const raw = readFileSync(spendLedgerPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LedgerFile>;
    if (typeof parsed?.day !== "string") return null;
    const spent = Number(parsed.spentUsd);
    if (!Number.isFinite(spent) || spent < 0) return null;
    return { day: parsed.day, spentUsd: spent };
  } catch {
    // Missing or unreadable ledger — treated as no spend today by the caller.
    return null;
  }
}

/**
 * Settled x402 spend recorded for the current UTC day. Returns 0 when the ledger is
 * missing, unreadable, or stale (previous day).
 */
export function readSpentTodayUsdLocal(): number {
  const ledger = readLedger();
  if (!ledger || ledger.day !== utcDayKey()) return 0;
  return ledger.spentUsd;
}

/**
 * Append `amountUsd` to today's total. Write failures warn instead of throwing — a purchase
 * that already settled must not surface as an error, though the cap loses this entry.
 *
 * Read-modify-write is not atomic across concurrent sidecars; run one sidecar per wallet,
 * or point `COMMERCE_SPEND_LEDGER_PATH` at a per-process file and keep caps per process.
 */
export function recordSpendUsdLocal(amountUsd: number): void {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return;
  const path = spendLedgerPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    const next: LedgerFile = {
      day: utcDayKey(),
      spentUsd: readSpentTodayUsdLocal() + amountUsd,
    };
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (e) {
    console.warn(
      `[commerce-agent] could not record spend in ${path} (daily cap may undercount):`,
      e instanceof Error ? e.message : e,
    );
  }
}
