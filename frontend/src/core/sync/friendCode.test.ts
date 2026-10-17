import { describe, expect, it } from 'vitest';
import { FRIEND_CODE_LEN, FRIENDS_MAX, formatFriendCode, normalizeFriendCode } from './friendCode';

describe('friend codes (v6)', () => {
  it('constants', () => {
    expect(FRIENDS_MAX).toBe(5);
    expect(FRIEND_CODE_LEN).toBe(8);
  });

  it('accepts a stored code, with or without the dash, in any case and spacing', () => {
    for (const raw of ['K7QP2MXD', 'K7QP-2MXD', 'k7qp-2mxd', '  k7qp 2mxd  ', 'K7QP_2MXD', 'K7QP–2MXD', '\tK7QP2MXD\n']) {
      expect(normalizeFriendCode(raw)).toEqual({ ok: true, code: 'K7QP2MXD' });
    }
  });

  it('reads O as 0 and I or L as 1 (Crockford)', () => {
    expect(normalizeFriendCode('lolo-ozzz')).toEqual({ ok: true, code: '10100ZZZ' });
    expect(normalizeFriendCode('IiLl0O0O')).toEqual({ ok: true, code: '11110000' });
  });

  it('rejects U, wrong lengths and empty input', () => {
    for (const raw of ['', '   ', 'K7QP2MX', 'K7QP2MXDD', 'K7QP-2MXU', 'UUUUUUUU', '----', 'abc']) {
      expect(normalizeFriendCode(raw)).toEqual({ ok: false });
    }
  });

  it('keeps only ASCII letters and digits: no unicode folding (sharp s, dotless i, accents)', () => {
    expect(normalizeFriendCode('K7QP2MXß')).toEqual({ ok: false }); // not "SS"
    expect(normalizeFriendCode('K7QP2MéXßD')).toEqual({ ok: true, code: 'K7QP2MXD' });
    expect(normalizeFriendCode('\u0131K7QP2MX')).toEqual({ ok: false }); // the dotless i is dropped, 7 characters are left
  });

  it('does not throw on non-strings', () => {
    expect(normalizeFriendCode(undefined as unknown as string)).toEqual({ ok: false });
    expect(normalizeFriendCode(null as unknown as string)).toEqual({ ok: false });
    expect(normalizeFriendCode(12345678 as unknown as string)).toEqual({ ok: true, code: '12345678' });
  });

  it('every symbol of the alphabet survives, and the other letters are refused', () => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    expect(alphabet).toHaveLength(32);
    for (let i = 0; i < alphabet.length; i += 1) {
      const code = alphabet[i]!.repeat(8);
      expect(normalizeFriendCode(code)).toEqual({ ok: true, code });
    }
    expect(normalizeFriendCode('UUUUUUUU').ok).toBe(false);
  });

  it('formats as XXXX-XXXX and leaves anything else alone', () => {
    expect(formatFriendCode('K7QP2MXD')).toBe('K7QP-2MXD');
    expect(formatFriendCode('K7QP-2MXD')).toBe('K7QP-2MXD');
    expect(formatFriendCode('short')).toBe('short');
    expect(formatFriendCode('')).toBe('');
  });

  it('format then normalize round-trips', () => {
    const r = normalizeFriendCode(formatFriendCode('7ZZA0B1C'));
    expect(r).toEqual({ ok: true, code: '7ZZA0B1C' });
  });
});
