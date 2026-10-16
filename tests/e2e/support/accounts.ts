import { execFileSync } from 'node:child_process';
import { type Browser, type BrowserContext, type Page, expect } from '@playwright/test';

export const TEST_PASSWORD = 'senha de teste longa';

/** A nick unique to this run, within the 20-character limit. */
export function uniqueNick(prefix: string): string {
  return `${prefix}_${Date.now().toString(36).slice(-6)}`;
}

/**
 * Contexts opened by the helpers. Playwright closes only its own fixtures, and a page
 * left in a match keeps rendering: each spec closes these after every test.
 */
const openContexts: BrowserContext[] = [];

export async function closeOpenContexts(): Promise<void> {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
}

/** Opens a fresh browser context and signs up a new account; returns the page and nick. */
export async function signUpInNewContext(
  browser: Browser,
  prefix: string,
  path = '/',
): Promise<{ page: Page; nick: string }> {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  openContexts.push(context);
  const page = await context.newPage();
  await page.goto(path);
  const nick = uniqueNick(prefix);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  const form = page.getByRole('form');
  await form.locator('input[name="nick"]').fill(nick);
  await form.locator('input[name="password"]').fill(TEST_PASSWORD);
  await form.locator('input[name="confirmation"]').fill(TEST_PASSWORD);
  await form.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByTestId('signed-in-as')).toContainText(nick);
  return { page, nick };
}

/** Grants dev data (items, and the hauler license unless `ships` is false) through the database script. */
export function seedDev(nick: string, { ships = true }: { ships?: boolean } = {}): void {
  if (!/^[A-Za-z0-9_]+$/.test(nick)) throw new Error(`nick inesperado: ${nick}`);
  // pnpm is a .cmd on Windows, which needs a shell; the nick was checked above.
  execFileSync('pnpm', ['db:seed-dev', nick, ...(ships ? [] : ['--no-ships'])], {
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
}
