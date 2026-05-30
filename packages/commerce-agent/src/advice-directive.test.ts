import { describe, expect, it } from "vitest";
import { extractDirectiveTokenIdFromAdvice } from "./advice-directive.js";

describe("extractDirectiveTokenIdFromAdvice", () => {
  it("reads directive.token_id as number", () => {
    expect(
      extractDirectiveTokenIdFromAdvice({
        directive: { token_id: 42 },
      }),
    ).toBe(42);
  });

  it("reads directive.token_id as numeric string", () => {
    expect(
      extractDirectiveTokenIdFromAdvice({
        directive: { token_id: "7" },
      }),
    ).toBe(7);
  });

  it("returns null when missing", () => {
    expect(extractDirectiveTokenIdFromAdvice({ title: "x" })).toBeNull();
  });
});
