import { describe, expect, it } from "vitest";
import { serializePurchase } from "./server.js";

describe("serializePurchase", () => {
  it("runs concurrent purchases one at a time, in order", async () => {
    const events: string[] = [];
    const task = (id: number) => async () => {
      events.push(`start ${id}`);
      await new Promise((r) => setTimeout(r, 5));
      events.push(`end ${id}`);
      return id;
    };
    const results = await Promise.all([1, 2, 3].map((id) => serializePurchase(task(id))));
    expect(results).toEqual([1, 2, 3]);
    expect(events).toEqual(["start 1", "end 1", "start 2", "end 2", "start 3", "end 3"]);
  });

  it("keeps the queue moving after a failed purchase", async () => {
    const failed = serializePurchase(async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    await expect(serializePurchase(async () => "next")).resolves.toBe("next");
  });

  it("closes the read-then-record race on a shared total", async () => {
    let spent = 0;
    const cap = 0.1;
    const buy = () =>
      serializePurchase(async () => {
        const seen = spent;
        await new Promise((r) => setTimeout(r, 1));
        if (seen + 0.01 > cap + 1e-9) return false;
        spent = seen + 0.01;
        return true;
      });
    const outcomes = await Promise.all(Array.from({ length: 25 }, buy));
    expect(outcomes.filter(Boolean)).toHaveLength(10);
    expect(spent).toBeCloseTo(0.1, 10);
  });
});
