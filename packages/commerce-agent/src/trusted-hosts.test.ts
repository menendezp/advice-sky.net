import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTrustedHostsFile, trustedAdviceHosts } from "./trusted-hosts.js";

const dir = mkdtempSync(join(tmpdir(), "trusted-hosts-"));
const file = (name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};

afterEach(() => {
  delete process.env.ADVICE_TRUSTED_HOSTS_PATH;
  delete process.env.ADVICE_ALLOWED_HOSTS;
});

describe("readTrustedHostsFile", () => {
  it("reads and normalizes hosts", () => {
    const p = file("ok.json", JSON.stringify({ hosts: [" X402LifeAdvice.vercel.app ", "", 7] }));
    expect(readTrustedHostsFile(p)).toEqual(["x402lifeadvice.vercel.app"]);
  });
  it.each([
    ["missing", join(dir, "nope.json")],
    ["malformed", file("bad.json", "{ not json")],
    ["wrong shape", file("shape.json", JSON.stringify(["a.example"]))],
  ])("treats a %s file as no extra hosts", (_label, p) => {
    expect(readTrustedHostsFile(p)).toEqual([]);
  });
});

describe("trustedAdviceHosts", () => {
  it("always includes the public store, plus the file", () => {
    process.env.ADVICE_TRUSTED_HOSTS_PATH = file("list.json", JSON.stringify({ hosts: ["a.example"] }));
    expect(trustedAdviceHosts()).toEqual(["store.advice-sky.net", "a.example"]);
  });
  it("lets ADVICE_ALLOWED_HOSTS replace the default store", () => {
    process.env.ADVICE_TRUSTED_HOSTS_PATH = join(dir, "nope.json");
    process.env.ADVICE_ALLOWED_HOSTS = "staging.example, other.example";
    expect(trustedAdviceHosts()).toEqual(["staging.example", "other.example"]);
  });
  it("picks up edits without a restart", () => {
    const p = file("live.json", JSON.stringify({ hosts: [] }));
    process.env.ADVICE_TRUSTED_HOSTS_PATH = p;
    expect(trustedAdviceHosts()).not.toContain("new.example");
    writeFileSync(p, JSON.stringify({ hosts: ["new.example"] }));
    expect(trustedAdviceHosts()).toContain("new.example");
  });
});
