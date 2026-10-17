// Sync code: the only secret. Email and password are derived from it on the device and are never
// stored in AppData; the code itself is not stored either.

export const SYNC_CODE_MIN = 8;
export const SYNC_CODE_MAX = 64; // the email local part may not exceed 64 characters

// Supabase rejects reserved TLDs such as .local, so the address lives on the site's own domain.
// Nothing is ever sent to it (Confirm email is off).
export const SYNC_CODE_EMAIL_DOMAIN = '@dathanbn.github.io';

export type SyncCodeError = 'code_empty' | 'code_too_short' | 'code_too_long' | 'code_invalid_chars';

export type NormalizedSyncCode = { ok: true; code: string } | { ok: false; error: SyncCodeError };

/**
 * Trim, lowercase, collapse whitespace runs to "-", then validate. Allowed: a-z 0-9 - _ .
 * Minimum 8 characters after normalizing (`code_too_short`); empty gives `code_empty`.
 */
export function normalizeSyncCode(raw: string): NormalizedSyncCode {
  const code = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  if (code.length === 0) return { ok: false, error: 'code_empty' };
  if (code.length < SYNC_CODE_MIN) return { ok: false, error: 'code_too_short' };
  if (!/^[a-z0-9\-_.]+$/.test(code)) return { ok: false, error: 'code_invalid_chars' };
  if (code.length > SYNC_CODE_MAX) return { ok: false, error: 'code_too_long' };
  return { ok: true, code };
}

export interface SyncCredentials {
  email: string;
  password: string;
}

/** Hex SHA-256 via Web Crypto, with a pure-JS fallback when `crypto.subtle` is unavailable. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', bytes);
      return toHex(new Uint8Array(digest));
    } catch {
      /* fall through to the pure-JS version */
    }
  }
  return toHex(sha256Bytes(bytes));
}

/**
 * email = `${slug}${SYNC_CODE_EMAIL_DOMAIN}` (slug is the normalized code with "." replaced by "-");
 * password = hex SHA-256 of `em-time:v1:` + the normalized code. The same code (in any casing or
 * spacing that normalizes alike) always gives the same pair.
 */
export async function deriveSyncCredentials(
  raw: string,
): Promise<{ ok: true; credentials: SyncCredentials } | { ok: false; error: SyncCodeError }> {
  const n = normalizeSyncCode(raw);
  if (!n.ok) return n;
  return {
    ok: true,
    credentials: {
      email: `${n.code.replace(/\./g, '-')}${SYNC_CODE_EMAIL_DOMAIN}`,
      password: await sha256Hex(`em-time:v1:${n.code}`),
    },
  };
}

// ---- tiny pure-JS SHA-256 (fallback only) ------------------------------------------------------

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

export function sha256Bytes(msg: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = msg.length;
  const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64);
  padded.set(msg);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 0x20000000), false);
  view.setUint32(padded.length - 4, (len << 3) >>> 0, false);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]!, false);
  return out;
}
