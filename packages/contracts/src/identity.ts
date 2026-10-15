import { z } from 'zod';

/** Nick: 3–20 ASCII letters, digits or `_`; unique without case distinction. */
export const nickSchema = z.string().regex(/^[A-Za-z0-9_]{3,20}$/);

/** Passwords are never truncated; length is bounded to keep hashing cost predictable. */
export const passwordSchema = z.string().min(12).max(128);

/** Normalized form used for uniqueness and lookup. ASCII-only, so lowercasing is unambiguous. */
export function normalizeNick(nick: string): string {
  return nick.toLowerCase();
}
