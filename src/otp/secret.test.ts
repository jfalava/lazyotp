import { describe, expect, it } from "vitest";
import { extractSecret, looksLikeSecretInput } from "./secret.ts";

describe("extractSecret", () => {
  it("returns non-otpauth input unchanged", () => {
    expect(extractSecret("JBSWY3DPEHPK3PXP")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("extracts secret query param from otpauth URL", () => {
    expect(
      extractSecret(
        "otpauth://totp/GitHub?secret=JBSWY3DPEHPK3PXP&issuer=GitHub",
      ),
    ).toBe("JBSWY3DPEHPK3PXP");
  });

  it("throws for invalid otpauth URL", () => {
    expect(() => extractSecret("otpauth://[")).toThrow("Invalid otpauth URL");
  });

  it("throws when otpauth URL has no secret param", () => {
    expect(() => extractSecret("otpauth://totp/GitHub?issuer=GitHub")).toThrow(
      "otpauth URL is missing the 'secret' query parameter",
    );
  });
});

describe("looksLikeSecretInput", () => {
  it("returns true for otpauth URLs", () => {
    expect(looksLikeSecretInput("otpauth://totp/GitHub?secret=ABC")).toBe(true);
  });

  it("returns true for likely base32 secret", () => {
    expect(looksLikeSecretInput("jbsw-y3dp ehpk3pxp")).toBe(true);
  });

  it("returns false for short or malformed values", () => {
    expect(looksLikeSecretInput("ABCDEF")).toBe(false);
    expect(looksLikeSecretInput("JBSWY3DPEHPK3PX!")).toBe(false);
  });
});
