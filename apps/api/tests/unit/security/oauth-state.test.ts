import { describe, expect, it } from "vitest";
import { generateOauthTransaction, sha256Hex } from "../../../src/security/oauth-state.js";

describe("oauth state generation", () => {
  const now = new Date("2026-10-25T12:00:00.000Z");

  it("produces unique random state, binding, and verifier values", () => {
    const a = generateOauthTransaction(600, now);
    const b = generateOauthTransaction(600, now);
    expect(a.state).not.toBe(b.state);
    expect(a.binding).not.toBe(b.binding);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.binding).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.codeVerifier.length).toBeGreaterThanOrEqual(43);
  });

  it("hashes state and binding with sha256", () => {
    const txn = generateOauthTransaction(600, now);
    expect(txn.stateHash).toBe(sha256Hex(txn.state));
    expect(txn.bindingHash).toBe(sha256Hex(txn.binding));
    expect(txn.stateHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("computes expiry from the transaction TTL", () => {
    const txn = generateOauthTransaction(600, now);
    expect(txn.expiresAt.getTime()).toBe(now.getTime() + 600_000);
  });
});
