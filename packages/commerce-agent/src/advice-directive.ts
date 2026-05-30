/** Pulls `directive.token_id` from GET /api/advice JSON (`directives` keyed for NFT linkage). */

export function extractDirectiveTokenIdFromAdvice(advice: unknown): number | null {
  if (!advice || typeof advice !== "object") return null;
  const o = advice as Record<string, unknown>;
  const directive = o.directive;
  if (!directive || typeof directive !== "object") return null;
  const d = directive as Record<string, unknown>;
  const tid = d.token_id ?? d.tokenId;
  if (typeof tid === "number" && Number.isInteger(tid) && tid >= 0) return tid;
  if (typeof tid === "string" && /^\d+$/.test(tid)) {
    const n = parseInt(tid, 10);
    return n >= 0 ? n : null;
  }
  return null;
}
