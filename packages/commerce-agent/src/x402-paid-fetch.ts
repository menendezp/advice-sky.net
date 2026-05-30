import type { Address, Hex } from "viem";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";

/** Minimal signer surface for `@x402/evm/exact/client` (CDP account or viem wallet). */
export type X402EvmSigner = {
  address: Address;
  signTypedData: (message: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<Hex>;
};

/** x402 JSON responses (402 body + payment headers); without this, many servers return HTML. */
export const X402_FETCH_HEADERS = {
  Accept: "application/json",
  "User-Agent": "agentic-commerce-agent/1.0",
} as const;

export type FetchPaidAdviceX402Options = {
  adviceUrl: string;
  signer: X402EvmSigner;
  rpcUrl?: string | null;
  /** Optional hook chain on the client (e.g. spend guardrails in `buyAdvice`). */
  configureClient?: (client: ReturnType<typeof x402Client.fromConfig>) => void;
};

export type FetchPaidAdviceX402Result = {
  advice: unknown;
  settlement: {
    transaction: string;
    payer?: string;
    success?: boolean;
  };
  /** Present when a full 402 → pay flow ran (for logging / sale rows). */
  paymentRequired?: unknown;
  raw402Body?: unknown;
};

/**
 * Browser or server: complete x402 (402 → sign → paid GET) for a JSON advice resource.
 */
export async function fetchPaidAdviceX402(
  opts: FetchPaidAdviceX402Options,
): Promise<FetchPaidAdviceX402Result> {
  const { adviceUrl, signer, rpcUrl } = opts;
  const schemeClient = rpcUrl?.trim()
    ? new ExactEvmScheme(signer, { rpcUrl: rpcUrl.trim() })
    : new ExactEvmScheme(signer);

  const client = x402Client.fromConfig({
    schemes: [{ network: "eip155:*", client: schemeClient }],
  });
  opts.configureClient?.(client);
  const httpClient = new x402HTTPClient(client);

  const first = await fetch(adviceUrl, {
    method: "GET",
    headers: { ...X402_FETCH_HEADERS },
  });

  if (first.ok) {
    const advice = await first.json();
    let settlementTx = "";
    let payer: string | undefined;
    try {
      const settlement = httpClient.getPaymentSettleResponse((n) =>
        first.headers.get(n),
      );
      settlementTx = settlement.transaction ?? "";
      payer = settlement.payer;
    } catch {
      /* non-x402 200 */
    }
    return {
      advice,
      settlement: { transaction: settlementTx, payer, success: true },
    };
  }

  if (first.status !== 402) {
    const t = await first.text().catch(() => "");
    const trimmed = t.replace(/\s+/g, " ").trim();
    const snippet = trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
    const hint404 =
      first.status === 404
        ? "\n\nHint: Route missing on this host. x402 lives on the **store** app (`apps/store` in the monorepo). If you use two Vercel projects, `ADVICE_URL` must be the store deployment (and Vercel Root Directory = `apps/store`), not the marketing `apps/web` site."
        : "";
    throw new Error(
      `Expected 402 from merchant, got ${first.status}${hint404}${snippet ? `: ${snippet}` : ""}`,
    );
  }

  let body: unknown;
  try {
    body = await first.json();
  } catch {
    throw new Error("402 response had no JSON body");
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (n) => first.headers.get(n),
    body,
  );

  const paymentPayload =
    await httpClient.createPaymentPayload(paymentRequired);
  const payHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  const second = await fetch(adviceUrl, {
    method: "GET",
    headers: { ...payHeaders, ...X402_FETCH_HEADERS, Accept: "application/json" },
  });

  if (!second.ok) {
    const t = await second.text();
    throw new Error(`Paid retry failed ${second.status}: ${t}`);
  }

  const advice = await second.json();
  const settlement = httpClient.getPaymentSettleResponse((n) =>
    second.headers.get(n),
  );

  return {
    advice,
    settlement: {
      transaction: settlement.transaction,
      payer: settlement.payer,
      success: settlement.success,
    },
    paymentRequired,
    raw402Body: body,
  };
}
