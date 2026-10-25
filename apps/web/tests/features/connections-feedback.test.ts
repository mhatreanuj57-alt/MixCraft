import { describe, expect, it } from "vitest";
import {
  connectionErrorMessage,
  connectionStatusTone,
  feedbackBanner,
  parseConnectionsFeedback,
  providerLabel,
} from "../../src/features/connections/feedback";

describe("parseConnectionsFeedback", () => {
  it("returns null for an empty query string", () => {
    expect(parseConnectionsFeedback("")).toBeNull();
    expect(parseConnectionsFeedback("?")).toBeNull();
  });

  it("parses a successful connect redirect", () => {
    expect(parseConnectionsFeedback("?provider=github&status=connected")).toEqual({
      provider: "github",
      status: "connected",
      error: undefined,
    });
  });

  it("parses an error redirect", () => {
    expect(parseConnectionsFeedback("?provider=npm&error=VALIDATION_FAILED")).toEqual({
      provider: "npm",
      status: undefined,
      error: "VALIDATION_FAILED",
    });
  });

  it("ignores unknown providers and malformed input", () => {
    expect(parseConnectionsFeedback("?provider=bitbucket&status=connected")).toBeNull();
    expect(parseConnectionsFeedback("?status=connected")).toBeNull();
    expect(parseConnectionsFeedback("?provider=")).toBeNull();
  });
});

describe("connectionErrorMessage", () => {
  it("maps every supported code to a human explanation", () => {
    expect(connectionErrorMessage("CONNECTION_EXPIRED")).toContain("expired");
    expect(connectionErrorMessage("PROVIDER_UNAVAILABLE")).toContain("credentials");
    expect(connectionErrorMessage("OPERATION_CONFLICT")).toContain("another MixCraft account");
    expect(connectionErrorMessage("AUTHENTICATION_REQUIRED")).toContain("Sign in");
  });

  it("falls back for unknown codes", () => {
    expect(connectionErrorMessage("SOMETHING_ELSE")).toBe("The connection could not be completed.");
  });
});

describe("feedbackBanner", () => {
  it("renders a success banner for a connected provider", () => {
    const banner = feedbackBanner({ provider: "vercel", status: "connected" });
    expect(banner.tone).toBe("success");
    expect(banner.title).toBe("Vercel connected");
  });

  it("renders a danger banner with mapped text for an error", () => {
    const banner = feedbackBanner({ provider: "github", error: "OPERATION_CONFLICT" });
    expect(banner.tone).toBe("danger");
    expect(banner.title).toBe("GitHub connection failed");
    expect(banner.detail).toContain("another MixCraft account");
  });
});

describe("helpers", () => {
  it("resolves provider labels from shared metadata", () => {
    expect(providerLabel("npm")).toBe("npm");
    expect(providerLabel("github")).toBe("GitHub");
  });

  it("maps connection statuses to visual tones", () => {
    expect(connectionStatusTone("connected")).toBe("connected");
    expect(connectionStatusTone("expired")).toBe("attention");
    expect(connectionStatusTone("pending")).toBe("attention");
    expect(connectionStatusTone("disconnected")).toBe("idle");
  });
});
