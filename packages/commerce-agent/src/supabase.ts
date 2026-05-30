import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Lowercase 0x + 40 hex, or null if invalid. */
export function normalizeEvmWallet(
  input: string | null | undefined,
): string | null {
  const s = (input ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(s)) return null;
  return s;
}

/**
 * Returns `public.users.id` for this wallet, inserting a row on first sight.
 * Requires migration `users.evm_wallet` + unique index.
 */
export async function ensureUserIdForWallet(
  client: SupabaseClient,
  wallet: string,
): Promise<string> {
  const { data: existing, error: selErr } = await client
    .from("users")
    .select("id")
    .eq("evm_wallet", wallet)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing?.id) return existing.id;

  const { data: inserted, error: insErr } = await client
    .from("users")
    .insert({ evm_wallet: wallet })
    .select("id")
    .single();

  if (!insErr && inserted?.id) return inserted.id;

  const code = (insErr as { code?: string } | null)?.code;
  if (code === "23505") {
    const { data: again, error: againErr } = await client
      .from("users")
      .select("id")
      .eq("evm_wallet", wallet)
      .maybeSingle();
    if (againErr) throw againErr;
    if (again?.id) return again.id;
  }

  throw insErr ?? new Error("ensureUserIdForWallet: insert failed");
}

export function createCommerceSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SumSpentTodayOptions = {
  /** If set, only rows whose `entry_type` is in this list (e.g. `['x402']` or `['payout']`). */
  entryTypes?: string[];
};

export async function sumSpentTodayUsd(
  client: SupabaseClient,
  userId: string | null,
  options?: SumSpentTodayOptions,
): Promise<number> {
  if (!userId) return 0;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  let q = client
    .from("tx_logs")
    .select("amount")
    .eq("user_id", userId)
    .eq("currency", "USDC")
    .eq("status", "settled")
    .gte("created_at", start.toISOString());
  if (options?.entryTypes?.length) {
    q = q.in("entry_type", options.entryTypes);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).reduce((s, row) => s + Number(row.amount), 0);
}

/** Sum settled USDC `tx_logs.amount` for `user_id` since UTC month start. */
export async function sumSpentMonthUsd(
  client: SupabaseClient,
  userId: string | null,
  options?: SumSpentTodayOptions,
): Promise<number> {
  if (!userId) return 0;
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  let q = client
    .from("tx_logs")
    .select("amount")
    .eq("user_id", userId)
    .eq("currency", "USDC")
    .eq("status", "settled")
    .gte("created_at", start.toISOString());
  if (options?.entryTypes?.length) {
    q = q.in("entry_type", options.entryTypes);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).reduce((s, row) => s + Number(row.amount), 0);
}
