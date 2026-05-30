import { describe, expect, it } from "vitest";
import {
  assertDailyCap,
  assertDailyCapWithLimit,
  assertPerItemCap,
  assertPayoutPerTransferCap,
  needsConfirmation,
  needsPayoutAggregateConfirmation,
} from "./spend-guardrails.js";

describe("assertPerItemCap", () => {
  it("allows small amounts", () => {
    expect(assertPerItemCap(0.01).ok).toBe(true);
  });
  it("rejects above cap", () => {
    const r = assertPerItemCap(0.05);
    expect(r.ok).toBe(false);
  });
});

describe("needsConfirmation", () => {
  it("is false for micro amounts", () => {
    expect(needsConfirmation(0.01)).toBe(false);
  });
  it("is true above threshold", () => {
    expect(needsConfirmation(0.06)).toBe(true);
  });
});

describe("assertDailyCap", () => {
  it("allows spend within cap", () => {
    expect(assertDailyCap(0.05, 0.05).ok).toBe(true);
  });
  it("rejects when next spend exceeds cap", () => {
    const r = assertDailyCap(0.09, 0.02);
    expect(r.ok).toBe(false);
  });
});

describe("assertDailyCapWithLimit", () => {
  it("uses custom cap", () => {
    expect(assertDailyCapWithLimit(100, 50, 200).ok).toBe(true);
    expect(assertDailyCapWithLimit(180, 30, 200).ok).toBe(false);
  });
});

describe("assertPayoutPerTransferCap", () => {
  it("allows within default cap", () => {
    expect(assertPayoutPerTransferCap(25).ok).toBe(true);
  });
  it("rejects above default cap", () => {
    const r = assertPayoutPerTransferCap(100);
    expect(r.ok).toBe(false);
  });
});

describe("needsPayoutAggregateConfirmation", () => {
  it("is false when day and month cumulative stay at or below thresholds", () => {
    expect(needsPayoutAggregateConfirmation(5, 20, 5)).toBe(false);
    expect(needsPayoutAggregateConfirmation(10, 50, 0)).toBe(false);
  });
  it("is true when this payout pushes daily total over default $10", () => {
    expect(needsPayoutAggregateConfirmation(8, 0, 3)).toBe(true);
  });
  it("is true when already over daily threshold before this payout", () => {
    expect(needsPayoutAggregateConfirmation(10.01, 0, 0.01)).toBe(true);
  });
  it("is true when monthly cumulative would exceed default $50", () => {
    expect(needsPayoutAggregateConfirmation(0, 49, 2)).toBe(true);
  });
});
