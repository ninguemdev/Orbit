import { type Browser, type Page, expect, test } from '@playwright/test';

interface CrewView {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly atHelm: boolean;
  readonly connected: boolean;
}

interface WorldView {
  readonly tick: number;
  readonly ship: { x: number; y: number; angle: number; operatorId: string };
  readonly crew: Record<string, CrewView>;
}

declare global {
  interface Window {
    __orbit?: { sessionId: string; status: string; latest(): WorldView | null };
  }
}

async function joinAs(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await context.newPage();
  await page.goto('/?debug=1');
  await page.getByLabel('Nome na tripulação (opcional)').fill(name);
  await page.getByRole('button', { name: 'Entrar na sala' }).click();
  await expect(page.getByTestId('connection-status')).toContainText('Conectado');
  await page.locator('canvas').waitFor();
  // Keyboard focus on the game canvas.
  await page.locator('canvas').click({ position: { x: 20, y: 650 } });
  return page;
}

const world = (page: Page) =>
  page.evaluate(() => {
    const latest = window.__orbit?.latest();
    if (!latest) throw new Error('estado ausente');
    return latest;
  });

const sessionId = (page: Page) => page.evaluate(() => window.__orbit?.sessionId ?? '');

/** Samples both pages until they report ship poses for the same server ticks. */
async function shipsAtSameTicks(a: Page, b: Page) {
  const seenA = new Map<number, WorldView['ship']>();
  const seenB = new Map<number, WorldView['ship']>();
  for (let i = 0; i < 100; i++) {
    const [wa, wb] = await Promise.all([world(a), world(b)]);
    seenA.set(wa.tick, wa.ship);
    seenB.set(wb.tick, wb.ship);
    await a.waitForTimeout(10);
  }
  return [...seenA.keys()]
    .filter((tick) => seenB.has(tick))
    .map((tick) => ({ tick, a: seenA.get(tick), b: seenB.get(tick) }));
}

async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/**
 * Walks to the helm with the keyboard, correcting with the authoritative position
 * between short key presses (key timing in automation is not exact).
 */
async function walkToHelm(page: Page, id: string) {
  const position = async () => {
    const member = (await world(page)).crew[id];
    if (!member) throw new Error('tripulante ausente');
    return member;
  };
  for (let attempt = 0; attempt < 20; attempt++) {
    const { x, y } = await position();
    if (Math.abs(y) <= 8 && x >= 105) return;
    const key = Math.abs(y) > 8 ? (y > 0 ? 'KeyW' : 'KeyS') : 'KeyD';
    await hold(page, key, Math.abs(y) > 8 ? 60 : 400);
    await page.waitForTimeout(400); // let the input go stale and the state settle
  }
  throw new Error(`não chegou ao console: ${JSON.stringify(await position())}`);
}

/** Both pages have received at least the same tick; returns their views of it. */
async function settled(a: Page, b: Page): Promise<[WorldView, WorldView]> {
  await a.waitForTimeout(500); // inputs go stale and the server stops moving entities
  const target = Math.max((await world(a)).tick, (await world(b)).tick) + 2;
  await expect.poll(async () => (await world(a)).tick).toBeGreaterThanOrEqual(target);
  await expect.poll(async () => (await world(b)).tick).toBeGreaterThanOrEqual(target);
  return [await world(a), await world(b)];
}

test('two browsers share the room, walk, and see the same ship being piloted', async ({
  browser,
}) => {
  const alfa = await joinAs(browser, 'Alfa');
  const bravo = await joinAs(browser, 'Bravo');
  const alfaId = await sessionId(alfa);
  const bravoId = await sessionId(bravo);

  await test.step('both crew members appear in both browsers', async () => {
    for (const page of [alfa, bravo]) {
      await expect(page.getByTestId('hud')).toContainText('Alfa');
      await expect(page.getByTestId('hud')).toContainText('Bravo');
    }
    const [a, b] = await settled(alfa, bravo);
    expect(Object.keys(a.crew).sort()).toEqual([alfaId, bravoId].sort());
    expect(b.crew[alfaId]).toEqual(a.crew[alfaId]);
  });

  await test.step('walking in one browser moves the crew member in both', async () => {
    const before = (await world(bravo)).crew[alfaId];
    await hold(alfa, 'KeyS', 200);
    const [a, b] = await settled(alfa, bravo);
    expect(a.crew[alfaId]?.y).toBeGreaterThan(before?.y ?? Infinity);
    expect(b.crew[alfaId]).toEqual(a.crew[alfaId]);
  });

  await test.step('the first to reach the helm takes command', async () => {
    await walkToHelm(alfa, alfaId); // through the bridge doorway up to the console
    await alfa.keyboard.press('KeyE');
    await expect(bravo.getByTestId('helm-operator')).toHaveText('Comando: Alfa');
    await expect(alfa.getByTestId('helm-operator')).toHaveText('Comando: Alfa');
  });

  await test.step('the helm is exclusive', async () => {
    await bravo.keyboard.press('KeyE');
    await expect(bravo.getByRole('status')).toHaveText('O comando já está ocupado.');
    expect((await world(bravo)).ship.operatorId).toBe(alfaId);
  });

  await test.step('the pilot flies the ship and both browsers see the same pose', async () => {
    const start = (await world(bravo)).ship;
    await hold(alfa, 'KeyW', 1500);
    await hold(alfa, 'KeyA', 500);
    const now = await world(alfa);
    expect(Math.hypot(now.ship.x - start.x, now.ship.y - start.y)).toBeGreaterThan(100);
    expect(now.ship.angle).not.toBe(start.angle);
    // The ship keeps coasting, so compare poses received for the same server tick.
    const shared = await shipsAtSameTicks(alfa, bravo);
    expect(shared.length).toBeGreaterThan(5);
    for (const sample of shared) expect(sample.b).toEqual(sample.a);
  });

  await test.step('leaving the console frees the helm for the other player', async () => {
    await alfa.keyboard.press('Escape');
    await expect(bravo.getByTestId('helm-operator')).toHaveText('Comando: livre');
  });

  await test.step('a short network drop reconnects to the same crew member', async () => {
    const context = alfa.context();
    await context.setOffline(true);
    // Detected by the server heartbeat or the client socket closing, whichever comes first.
    await expect(bravo.getByTestId('hud')).toContainText('Alfa — reconectando', {
      timeout: 20_000,
    });
    await context.setOffline(false);
    await expect(alfa.getByTestId('connection-status')).toContainText('Conectado', {
      timeout: 20_000,
    });
    await expect(bravo.getByTestId('hud')).not.toContainText('reconectando', { timeout: 10_000 });
    expect(await sessionId(alfa)).toBe(alfaId);
    const before = (await world(bravo)).crew[alfaId];
    await hold(alfa, 'KeyA', 300);
    const [a, b] = await settled(alfa, bravo);
    expect(a.crew[alfaId]?.x).toBeLessThan(before?.x ?? -Infinity);
    expect(b.crew[alfaId]).toEqual(a.crew[alfaId]);
  });
});
