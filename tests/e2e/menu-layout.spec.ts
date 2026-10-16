import { expect, test } from '@playwright/test';
import { signUpInNewContext, closeOpenContexts } from './support/accounts';

test.afterEach(closeOpenContexts);

test('the menu spreads into columns on a 16:9 window and scrolls when it does not fit', async ({
  browser,
}) => {
  const { page } = await signUpInNewContext(browser, 'Tela');
  await expect(page.getByTestId('party-code')).not.toBeEmpty();
  await expect(page.getByTestId('credits')).toBeVisible();

  await test.step('party, mission and equipment sit side by side', async () => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const box = async (testId: string) => {
      const found = await page.getByTestId(testId).boundingBox();
      if (!found) throw new Error(`${testId} is not rendered`);
      return found;
    };
    const party = await box('party');
    const mission = await box('mission-setup');
    const inventory = await box('inventory');
    expect(party.x + party.width).toBeLessThanOrEqual(mission.x);
    expect(mission.x + mission.width).toBeLessThanOrEqual(inventory.x);
    expect(Math.abs(party.y - mission.y)).toBeLessThan(2);
    expect(Math.abs(mission.y - inventory.y)).toBeLessThan(2);
  });

  await test.step('a short window reaches the end of the loadout with the mouse wheel', async () => {
    await page.setViewportSize({ width: 900, height: 600 });
    const save = page.getByTestId('loadout').getByRole('button', { name: 'Salvar loadout' });
    await expect(save).not.toBeInViewport();
    await page.mouse.move(450, 300);
    await page.mouse.wheel(0, 10_000);
    await expect(save).toBeInViewport();
  });
});
