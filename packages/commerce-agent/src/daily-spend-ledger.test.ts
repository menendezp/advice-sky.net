import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readSpentTodayUsdLocal,
  recordSpendUsdLocal,
  spendLedgerPath,
  utcDayKey,
} from "./daily-spend-ledger.js";
import { assertDailyCap } from "./spend-guardrails.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "advice-sky-ledger-"));
  process.env.COMMERCE_SPEND_LEDGER_PATH = join(dir, "spend.json");
});

afterEach(() => {
  delete process.env.COMMERCE_SPEND_LEDGER_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("spendLedgerPath", () => {
  it("honours the env override", () => {
    expect(spendLedgerPath()).toBe(join(dir, "spend.json"));
  });
});

describe("readSpentTodayUsdLocal", () => {
  it("is 0 when no ledger exists", () => {
    expect(readSpentTodayUsdLocal()).toBe(0);
  });

  it("ignores a ledger from a previous UTC day", () => {
    writeFileSync(
      spendLedgerPath(),
      JSON.stringify({ day: "2020-01-01", spentUsd: 0.09 }),
    );
    expect(readSpentTodayUsdLocal()).toBe(0);
  });

  it("ignores a corrupt ledger instead of throwing", () => {
    writeFileSync(spendLedgerPath(), "{not json");
    expect(readSpentTodayUsdLocal()).toBe(0);
  });
});

describe("recordSpendUsdLocal", () => {
  it("accumulates within the same UTC day", () => {
    recordSpendUsdLocal(0.01);
    recordSpendUsdLocal(0.01);
    expect(readSpentTodayUsdLocal()).toBeCloseTo(0.02, 10);
  });

  it("ignores non-positive amounts", () => {
    recordSpendUsdLocal(0);
    recordSpendUsdLocal(-1);
    expect(readSpentTodayUsdLocal()).toBe(0);
  });

  it("resets when the recorded day rolls over", () => {
    writeFileSync(
      spendLedgerPath(),
      JSON.stringify({ day: "2020-01-01", spentUsd: 5 }),
    );
    recordSpendUsdLocal(0.01);
    expect(readSpentTodayUsdLocal()).toBeCloseTo(0.01, 10);
  });
});

describe("daily cap without Supabase", () => {
  it("blocks the purchase that would cross $0.10", () => {
    for (let i = 0; i < 10; i += 1) {
      expect(assertDailyCap(readSpentTodayUsdLocal(), 0.01).ok).toBe(true);
      recordSpendUsdLocal(0.01);
    }
    expect(readSpentTodayUsdLocal()).toBeCloseTo(0.1, 10);
    expect(assertDailyCap(readSpentTodayUsdLocal(), 0.01).ok).toBe(false);
  });
});

describe("utcDayKey", () => {
  it("formats as YYYY-MM-DD in UTC", () => {
    expect(utcDayKey(new Date("2026-08-14T23:59:59Z"))).toBe("2026-08-14");
    expect(utcDayKey(new Date("2026-08-15T00:00:00Z"))).toBe("2026-08-15");
  });
});
