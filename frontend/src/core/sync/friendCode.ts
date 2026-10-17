// Friend codes (v6): a read-only share code, never the sync code. 8 characters of Crockford base32,
// shown as XXXX-XXXX and stored without the dash. Pure and main-chunk safe. The SQL helper
// public.em_friend_code_norm applies the same rules.

export const FRIENDS_MAX = 5;
export const FRIEND_CODE_LEN = 8;

/** Crockford base32 without I, L, O, U. Every stored code matches this. */
const VALID = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export type NormalizedFriendCode = { ok: true; code: string } | { ok: false };

/**
 * Drops everything but ASCII letters and digits (before upper-casing, so "ß" cannot grow into "SS"),
 * upper-cases, reads O as 0 and I or L as 1, then requires exactly 8 characters of the alphabet.
 */
export function normalizeFriendCode(raw: string): NormalizedFriendCode {
  const code = String(raw ?? '')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return VALID.test(code) ? { ok: true, code } : { ok: false };
}

/** 'K7QP2MXD' to 'K7QP-2MXD'. Anything that is not a stored code comes back unchanged. */
export function formatFriendCode(code: string): string {
  return VALID.test(code) ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
