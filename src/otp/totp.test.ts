import { afterEach, describe, expect, it, vi } from "vitest";
import { generateTotp } from "./totp.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("generateTotp", () => {
  it("matches RFC 6238 SHA-1 vector at T=59", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000);

    const code = await generateTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 8, 30);
    expect(code).toBe("94287082");
  });

  it("matches RFC 6238 SHA-1 vector at T=1111111109", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_111_111_109_000);

    const code = await generateTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 8, 30);
    expect(code).toBe("07081804");
  });

  it("accepts normalized base32 with spaces and hyphens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000);

    const code = await generateTotp(
      "gezd-gnbv gy3tqojq gezdgnbvgy3tqojq",
      8,
      30,
    );
    expect(code).toBe("94287082");
  });

  it("throws for invalid base32 characters", async () => {
    await expect(generateTotp("JBSWY3DPEHPK3PX!", 6, 30)).rejects.toThrow(
      "Invalid Base32 character in secret: !",
    );
  });

  it("throws when secret is empty after normalization", async () => {
    await expect(generateTotp("   ", 6, 30)).rejects.toThrow(
      "Secret cannot be empty",
    );
  });
});
