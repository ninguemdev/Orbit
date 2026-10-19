import { type Page, expect, test } from '@playwright/test';
import { SHIP_HULLS, ShipHullId } from '@orbit/catalog';
import { closeOpenContexts, seedDev, signUpInNewContext } from './support/accounts';

test.afterEach(closeOpenContexts);

/** The starter ship's cargo hatch, in ship-local coordinates. */
const HATCH = SHIP_HULLS[ShipHullId.Scout].cargoHatch.position;

interface MissionWorld {
  ship: { angle: number };
  crew: Record<string, { x: number; y: number }>;
}

const world = (page: Page) =>
  page.evaluate(() => window.__orbit?.latest() as MissionWorld | null | undefined);

/**
 * Walks to the hatch in closed loop on the authoritative position. The camera does
 * not turn with the ship, so the wanted ship-local direction is turned into screen
 * keys by the ship's heading.
 */
async function walkToHatch(page: Page) {
  const id = await page.evaluate(() => window.__orbit?.sessionId ?? '');
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = await world(page);
    const self = state?.crew[id];
    if (!state || !self) throw new Error('estado ausente');
    const local = { x: HATCH.x - self.x, y: HATCH.y - self.y };
    if (Math.hypot(local.x, local.y) < 12) return;
    const { angle } = state.ship;
    const screen = {
      x: local.x * Math.cos(angle) - local.y * Math.sin(angle),
      y: local.x * Math.sin(angle) + local.y * Math.cos(angle),
    };
    const length = Math.hypot(screen.x, screen.y);
    const keys: string[] = [];
    if (screen.x / length > 0.38) keys.push('KeyD');
    if (screen.x / length < -0.38) keys.push('KeyA');
    if (screen.y / length > 0.38) keys.push('KeyS');
    if (screen.y / length < -0.38) keys.push('KeyW');
    // Keep keyboard focus on the game: top middle, away from the HUD and the panel.
    await page.locator('canvas').click({ position: { x: 640, y: 30 } });
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(Math.min(150, 20 + length * 3));
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(150);
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
