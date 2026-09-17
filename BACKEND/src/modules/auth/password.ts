import { randomInt } from 'node:crypto';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Returns a plain-language problem, or null when the password is acceptable. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use both letters and numbers';
  if (/^(.)\1+$/.test(password)) return 'Do not repeat one character';
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) return 'Do not use your email name in the password';
  return null;
}

// No 0/O, 1/l/I: these passwords are read out or typed from a message.
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';

/** A random, easy-to-type starter password, e.g. "Tqmx-8kRp-3vna". */
export function generatePassword() {
  const pick = (chars: string) => chars[randomInt(chars.length)];
  const all = LOWER + UPPER + DIGITS;
  const groups = [0, 1, 2].map(() => Array.from({ length: 4 }, () => pick(all)).join(''));
  // Guarantee a letter and a digit whatever the dice said.
  groups[0] = pick(UPPER) + groups[0].slice(1);
  groups[1] = pick(DIGITS) + groups[1].slice(1);
  return groups.join('-');
}
