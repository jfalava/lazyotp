export function extractSecret(input: string): string {
  if (!input.startsWith("otpauth://")) {
    return input;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid otpauth URL");
  }

  const secret = url.searchParams.get("secret");
  if (!secret) {
    throw new Error("otpauth URL is missing the 'secret' query parameter");
  }

  return secret;
}

export function looksLikeSecretInput(input: string): boolean {
  if (input.startsWith("otpauth://")) {
    return true;
  }

  const normalized = input.toUpperCase().replace(/[\s-]/g, "");
  return normalized.length >= 16 && /^[A-Z2-7]+=*$/.test(normalized);
}
