const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function normalizeBase32Input(raw: string): string {
  const input = raw.toUpperCase().replace(/[\s-]/g, "");
  if (!input) {
    throw new Error("Secret cannot be empty");
  }
  return input;
}

function base32CharToValue(char: string): number {
  const value = BASE32_ALPHABET.indexOf(char);
  if (value < 0) {
    throw new Error(`Invalid Base32 character in secret: ${char}`);
  }
  return value;
}

function toFiveBitBinary(value: number): string {
  return value.toString(2).padStart(5, "0");
}

function buildBitStream(input: string): string {
  let bits = "";

  for (const char of input) {
    if (char === "=") {
      break;
    }
    bits += toFiveBitBinary(base32CharToValue(char));
  }

  return bits;
}

function bitsToBytes(bitStream: string): number[] {
  const bytes: number[] = [];

  for (let offset = 0; offset + 8 <= bitStream.length; offset += 8) {
    const byteChunk = bitStream.slice(offset, offset + 8);
    bytes.push(Number.parseInt(byteChunk, 2));
  }

  return bytes;
}

function decodeBase32(raw: string): Uint8Array {
  const normalized = normalizeBase32Input(raw);
  const bytes = bitsToBytes(buildBitStream(normalized));

  if (bytes.length === 0) {
    throw new Error("Secret did not decode to any bytes");
  }

  return new Uint8Array(bytes);
}

function createCounterBuffer(period: number): ArrayBuffer {
  const counter = Math.floor(Date.now() / 1000 / period);
  const counterBuffer = new ArrayBuffer(8);
  const view = new DataView(counterBuffer);
  view.setBigUint64(0, BigInt(counter), false);
  return counterBuffer;
}

async function importHmacKey(keyMaterial: Uint8Array): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(keyMaterial);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
}

async function createHmacDigest(keyMaterial: Uint8Array, counterBuffer: ArrayBuffer): Promise<Uint8Array> {
  const key = await importHmacKey(keyMaterial);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBuffer));
}

function readTruncateOffset(hmac: Uint8Array): number {
  const tail = hmac[hmac.length - 1];
  if (tail === undefined) {
    throw new Error("Failed to compute HMAC digest");
  }
  return tail & 0x0f;
}

function readDynamicBytes(hmac: Uint8Array, offset: number): [number, number, number, number] {
  if (offset + 3 >= hmac.length) {
    throw new Error("Failed to compute OTP from digest");
  }

  const values = hmac.slice(offset, offset + 4);
  if (values.length !== 4) {
    throw new Error("Failed to compute OTP bytes");
  }

  return [values[0]!, values[1]!, values[2]!, values[3]!];
}

function truncateToOtpInteger(hmac: Uint8Array): number {
  const offset = readTruncateOffset(hmac);
  const [b0, b1, b2, b3] = readDynamicBytes(hmac, offset);
  return ((b0 & 0x7f) << 24) | (b1 << 16) | (b2 << 8) | b3;
}

function formatOtp(binary: number, digits: number): string {
  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

export async function generateTotp(secret: string, digits: number, period: number): Promise<string> {
  const keyMaterial = Uint8Array.from(decodeBase32(secret));
  const counterBuffer = createCounterBuffer(period);
  const hmac = await createHmacDigest(keyMaterial, counterBuffer);
  return formatOtp(truncateToOtpInteger(hmac), digits);
}
