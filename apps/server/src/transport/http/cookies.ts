import { SESSION_COOKIE } from '@orbit/contracts';

/** Reads one cookie from a Cookie header without decoding surprises. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

export interface CookieOptions {
  readonly secure: boolean;
}

/** HttpOnly + SameSite=Strict: scripts cannot read it and other sites cannot send it. */
export function sessionCookie(token: string, expiresAt: Date, now: Date, options: CookieOptions) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearedSessionCookie(options: CookieOptions): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    ...(options.secure ? ['Secure'] : []),
  ].join('; ');
}
