import { type Page, expect, test } from '@playwright/test';
import { CREW, SHIP_HULLS, ShipHullId } from '@orbit/catalog';
import { closeOpenContexts, seedDev, signUpInNewContext } from './support/accounts';

test.afterEach(closeOpenContexts);

/** The starter ship's cargo hatch, in ship-local coordinates. */
const { position: HATCH, interactRadius: HATCH_RADIUS } = SHIP_HULLS[ShipHullId.Scout].cargoHatch;

interface MissionWorld {
  ship: { angle: number };
  crew: Record<string, { x: number; y: number }>;
}

const world = (page: Page) =>
  page.evaluate(() => window.__orbit?.latest() as MissionWorld | null | undefined);

/** Close enough: well inside the hatch's interaction radius. */
const ARRIVED = HATCH_RADIUS - 12;

async function crewPosition(page: Page, id: string) {
  const state = await world(page);
  const self = state?.crew[id];
  if (!state || !self) throw new Error('estado ausente');
  return { self, angle: state.ship.angle };
}

/** Screen keys toward the hatch and how far it is, or null when there. */
async function stepToHatch(page: Page, id: string) {
  const { self, angle } = await crewPosition(page, id);
  const local = { x: HATCH.x - self.x, y: HATCH.y - self.y };
  const distance = Math.hypot(local.x, local.y);
  if (distance < ARRIVED) return null;
  // The camera does not turn with the ship: turn the direction by its heading.
  const screen = {
    x: (local.x * Math.cos(angle) - local.y * Math.sin(angle)) / distance,
    y: (local.x * Math.sin(angle) + local.y * Math.cos(angle)) / distance,
  };
  const keys: string[] = [];
  if (screen.x > 0.38) keys.push('KeyD');
  if (screen.x < -0.38) keys.push('KeyA');
  if (screen.y > 0.38) keys.push('KeyS');
  if (screen.y < -0.38) keys.push('KeyW');
  return { keys, distance };
}

/** Waits until two readings of the authoritative position agree: the member stopped. */
async function untilStill(page: Page, id: string) {
  let last = (await crewPosition(page, id)).self;
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const now = (await crewPosition(page, id)).self;
    if (Math.hypot(now.x - last.x, now.y - last.y) < 0.5) return;
    last = now;
  }
}

/**
 * Walks to the hatch with key pulses, checking the authoritative position once the
 * member stops. Holding a key while polling overshoots on a slow CI, where every
 * reading takes a few hundred milliseconds. A pulse moves the member longer than the
 * key is held (the release is seen a frame later), so each pulse learns that extra
 * time from the last one and holds the key that much less.
 */
async function walkToHatch(page: Page) {
  const id = await page.evaluate(() => window.__orbit?.sessionId ?? '');
  // Keyboard focus on the game: top middle, away from the HUD and the panel.
  await page.locator('canvas').click({ position: { x: 640, y: 30 } });
  let extraMs = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    const step = await stepToHatch(page, id);
    if (step === null) return;
    const wantedMs = (step.distance / CREW.walkSpeed) * 1000 * 0.7;
    const holdMs = Math.min(500, Math.max(30, wantedMs - extraMs));
    const before = (await crewPosition(page, id)).self;
    for (const key of step.keys) await page.keyboard.down(key);
    await page.waitForTimeout(holdMs);
    for (const key of step.keys) await page.keyboard.up(key);
    await untilStill(page, id);
    const after = (await crewPosition(page, id)).self;
    const movedMs = (Math.hypot(after.x - before.x, after.y - before.y) / CREW.walkSpeed) * 1000;
    // Walls cut a pulse short, so only learn from pulses that moved further than held.
    if (movedMs > holdMs) extraMs = movedMs - holdMs;
  }
  throw new Error('não chegou à eclusa');
}

test('a crew member moves gear between the backpack and the hold at the hatch', async ({
  browser,
}) => {
  const { page, nick } = await signUpInNewContext(browser, 'Porao', '/?debug=1');
  seedDev(nick, { ships: false });
  await page.reload();

  await test.step('prepares alone with a medkit in the backpack', async () => {
    const radio = page.getByRole('radio', { name: /^Engenheiro/ });
    await radio.click();
    await expect(radio).toBeChecked();
    const loadout = page.getByTestId('loadout');
    await loadout.getByLabel('Mochila 1').selectOption({ label: 'Kit médico ×3' });
    await loadout.getByRole('button', { name: 'Salvar loadout' }).click();
    await expect(loadout.getByTestId('loadout-saved')).toHaveText('1 item(ns) no loadout salvo.');
    await expect(async () => {
      await page.getByRole('button', { name: 'Estou pronto' }).click();
      await expect(page.getByRole('button', { name: 'Não estou pronto' })).toBeVisible({
        timeout: 1000,
      });
    }).toPass();
    await page.getByRole('button', { name: 'Confirmar preparação' }).click();
  });

  const panel = page.getByTestId('mission-inventory');
  await test.step('the mission shows the reserved gear, out of reach of the hold', async () => {
    await expect(page.getByRole('button', { name: 'Sair da missão' })).toBeVisible();
    await expect(panel.getByTestId('backpack-items')).toContainText('Kit médico ×3 (seu)');
    await expect(panel.getByTestId('hatch-status')).toContainText('Vá até a eclusa');
    await expect(panel.getByRole('button', { name: /Ao porão/ })).toHaveCount(0);
  });

  await test.step('at the hatch, the medkit goes to the hold and back', async () => {
    await walkToHatch(page);
    await expect(panel.getByTestId('hatch-status')).toContainText('Na eclusa');
    await panel.getByRole('button', { name: 'Ao porão: Kit médico' }).click();
    await expect(panel.getByTestId('cargo-items')).toContainText('Kit médico ×3 (seu)');
    await expect(panel.getByTestId('backpack-items')).toContainText('Vazio.');
    await panel.getByRole('button', { name: 'À mochila: Kit médico' }).click();
    await expect(panel.getByTestId('backpack-items')).toContainText('Kit médico ×3 (seu)');
    await expect(panel.getByTestId('cargo-items')).toContainText('Vazio.');
  });
});
