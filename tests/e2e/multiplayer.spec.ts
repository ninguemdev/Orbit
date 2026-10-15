import { type Browser, type Page, expect, test } from '@playwright/test';
import { signUpInNewContext } from './support/accounts';

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
    __orbit?: {
      sessionId: string;
      status: string;
      latest(): WorldView | null;
      shipHistory(): unknown;
    };
  }
}

/** Cuts the real TCP connections of one session at the E2E drop proxy. */
async function dropConnection(id: string, refuseMs: number) {
  const response = await fetch(`http://127.0.0.1:2569/cut?sessionId=${id}&ms=${refuseMs}`, {
    method: 'POST',
  });
  return ((await response.json()) as { cut: number }).cut;
}

/** Creates a fresh account (the nick becomes the crew label) and enters the room. */
async function joinAs(browser: Browser, name: string): Promise<Page> {
  const { page } = await signUpInNewContext(browser, name, '/?debug=1');
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

type ShipAtTick = { tick: number; ship: WorldView['ship'] };

/** Ship poses that both pages received for the same server ticks (recent history). */
async function shipsAtSameTicks(a: Page, b: Page) {
  const history = (page: Page) =>
    page.evaluate(() => (window.__orbit?.shipHistory() ?? []) as ShipAtTick[]);
  const [historyA, historyB] = await Promise.all([history(a), history(b)]);
  const byTickB = new Map(historyB.map((entry) => [entry.tick, entry.ship]));
  return historyA
    .filter((entry) => byTickB.has(entry.tick))
    .map((entry) => ({ tick: entry.tick, a: entry.ship, b: byTickB.get(entry.tick) }));
}

async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** Holds a key until the authoritative state satisfies `done`, then releases it. */
async function holdUntil(page: Page, key: string, done: () => Promise<boolean>) {
  await page.keyboard.down(key);
  try {
    const deadline = Date.now() + 4000;
    while (!(await done()) && Date.now() < deadline) await page.waitForTimeout(15);
  } finally {
    await page.keyboard.up(key);
  }
  await page.waitForTimeout(400); // inputs go stale and the server stops the crew member
}

/**
 * Walks to the helm with the keyboard in closed loop on the authoritative position:
 * key timing in automation (and frame rate on CI) is not exact. Vertical
 * corrections release the key as soon as the server reports movement; the
 * doorway admits |y| < 22, wider than one correction step.
 */
async function walkToHelm(page: Page, id: string) {
  const position = async () => {
    const member = (await world(page)).crew[id];
    if (!member) throw new Error('tripulante ausente');
    return member;
  };
  for (let attempt = 0; attempt < 30; attempt++) {
    const { x, y } = await position();
    if (Math.abs(y) <= 20 && x >= 100) return;
    // Keep keyboard focus on the game in case anything moved it away.
    await page.locator('canvas').click({ position: { x: 20, y: 650 } });
    if (Math.abs(y) > 20) {
      // A short tap moves one or two ticks (7.5–15 px), less than the ±20 px band, so
      // corrections converge even when frames are slow; a missed tap is just retried.
      await page.keyboard.down(y > 0 ? 'KeyW' : 'KeyS');
      await page.waitForTimeout(30);
      await page.keyboard.up(y > 0 ? 'KeyW' : 'KeyS');
      await page.waitForTimeout(400);
    } else {
      await holdUntil(page, 'KeyD', async () => (await position()).x >= 100);
    }
  }
  const status = await page.evaluate(() => window.__orbit?.status);
  const tick = (await world(page)).tick;
  throw new Error(
    `não chegou ao console: ${JSON.stringify(await position())} status=${status} tick=${tick}`,
  );
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
  test.setTimeout(120_000);
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
    await expect(bravo.getByTestId('helm-operator')).toHaveText(/^Comando: Alfa_/);
    await expect(alfa.getByTestId('helm-operator')).toHaveText(/^Comando: Alfa_/);
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
    // Real TCP connections are cut and new ones refused for 3 s.
    expect(await dropConnection(alfaId, 3000)).toBeGreaterThan(0);
    await expect(alfa.getByTestId('connection-status')).toContainText('Reconectando');
    await expect(bravo.getByTestId('hud')).toContainText(/Alfa_[A-Za-z0-9]+ — reconectando/);
    await expect(alfa.getByTestId('connection-status')).toContainText('Conectado', {
      timeout: 20_000,
    });
    await expect(bravo.getByTestId('hud')).not.toContainText('reconectando', { timeout: 10_000 });
    expect(await sessionId(alfa)).toBe(alfaId);
    // Measured once both views settled: right after reconnecting, the last movement may
    // still be arriving.
    const [settledBefore] = await settled(alfa, bravo);
    const before = settledBefore.crew[alfaId];
    // In CI the first key presses right after reconnecting sometimes have no effect;
    // pressing again must move the same crew member.
    await expect
      .poll(
        async () => {
          await hold(alfa, 'KeyA', 300);
          return (await world(alfa)).crew[alfaId]?.x ?? Infinity;
        },
        { timeout: 10_000 },
      )
      .toBeLessThan((before?.x ?? -Infinity) - 10);
    const [a, b] = await settled(alfa, bravo);
    expect(a.crew[alfaId]?.x).toBeLessThan(before?.x ?? -Infinity);
    expect(b.crew[alfaId]).toEqual(a.crew[alfaId]);
  });
});
