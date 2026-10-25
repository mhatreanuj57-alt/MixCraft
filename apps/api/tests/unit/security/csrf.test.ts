import { describe, expect, it } from "vitest";
import { csrfTokensMatch, generateCsrfToken, isOriginAllowed } from "../../../src/security/csrf.js";

describe("csrf", () => {
  it("generates unique url-safe tokens", () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it("matches identical cookie and header tokens", () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch(token, token)).toBe(true);
  });

  it("rejects mismatched tokens", () => {
    expect(csrfTokensMatch(generateCsrfToken(), generateCsrfToken())).toBe(false);
  });

  it("rejects missing tokens", () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch(undefined, token)).toBe(false);
    expect(csrfTokensMatch(token, undefined)).toBe(false);
    expect(csrfTokensMatch(undefined, undefined)).toBe(false);
    expect(csrfTokensMatch("", "")).toBe(false);
  });

  it("allows requests without an Origin header", () => {
    expect(isOriginAllowed(undefined, ["http://localhost:5173"])).toBe(true);
    expect(isOriginAllowed("", ["http://localhost:5173"])).toBe(true);
  });

  it("allows only listed origins", () => {
    const allowed = ["http://localhost:5173", "http://127.0.0.1:3001"];
    expect(isOriginAllowed("http://localhost:5173", allowed)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:3001", allowed)).toBe(true);
    expect(isOriginAllowed("https://evil.example", allowed)).toBe(false);
  });
});
