import { type Page, expect, test } from '@playwright/test';
import { signUpInNewContext, closeOpenContexts } from './support/accounts';

test.afterEach(closeOpenContexts);

/** Picks a class and waits for the server to show it. */
async function chooseClass(page: Page, name: string) {
  const radio = page.getByRole('radio', { name: new RegExp(`^${name}`) });
  await radio.click();
  await expect(radio).toBeChecked();
}

/** Readiness names the revision on screen; a click right after a change may be stale. */
async function getReady(page: Page) {
  await expect(async () => {
    await page.getByRole('button', { name: 'Estou pronto' }).click();
    await expect(page.getByRole('button', { name: 'Não estou pronto' })).toBeVisible({
      timeout: 1000,
    });
  }).toPass();
}

test('a member whose loading failed enters the mission again before the deadline', async ({
  browser,
}) => {
  const alfa = await signUpInNewContext(browser, 'Missao_A', '/?debug=1');
  const bravo = await signUpInNewContext(browser, 'Missao_B', '/?debug=1');
  const code = (await alfa.page.getByTestId('party-code').textContent()) ?? '';
  await bravo.page.getByLabel('Entrar em outra party (código)').fill(code);
  await bravo.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(alfa.page.getByRole('heading', { name: /Sua party \(2\/4\)/ })).toBeVisible();
  await chooseClass(alfa.page, 'Piloto');
  await chooseClass(bravo.page, 'Engenheiro');
  await getReady(alfa.page);
  await getReady(bravo.page);

  // Bravo's first ticket request fails, as if the page lost the connection.
  await bravo.page.route('**/api/missions/tickets', (route) => route.abort());
  await alfa.page.getByRole('button', { name: 'Confirmar preparação' }).click();

  await test.step('the leader loads and waits; the member sees the failure', async () => {
    await expect(alfa.page.getByTestId('game').locator('canvas')).toBeVisible();
    await expect(bravo.page.getByRole('alert')).toBeVisible();
    await expect(bravo.page.getByTestId('expedition-preparing')).toContainText(
      'Entrando na missão',
    );
  });

  await test.step('trying again brings both into the same match', async () => {
    await bravo.page.unroute('**/api/missions/tickets');
    await bravo.page.getByRole('button', { name: 'Entrar na missão' }).click();
    for (const { page } of [alfa, bravo]) {
      await expect(page.getByTestId('game').locator('canvas')).toBeVisible();
      await expect(page.getByTestId('hud')).toContainText(alfa.nick);
      await expect(page.getByTestId('hud')).toContainText(bravo.nick);
    }
  });

  await test.step('both see the same generated sector, with loot and an exit', async () => {
    const layoutOf = (page: Page) =>
      page.evaluate(() => JSON.stringify(window.__orbit?.layout() ?? null));
    await expect.poll(() => layoutOf(alfa.page)).not.toBe('null');
    const layout = JSON.parse(await layoutOf(alfa.page)) as {
      bounds: { minX: number; maxX: number };
      containers: unknown[];
      extractionZones: unknown[];
    };
    expect(layout.bounds.maxX - layout.bounds.minX).toBe(12_000);
    expect(layout.containers.length).toBeGreaterThan(0);
    expect(layout.extractionZones).toHaveLength(1);
    await expect.poll(() => layoutOf(bravo.page)).toBe(JSON.stringify(layout));
  });
});

test('a member waiting in the test room is taken into the mission', async ({ browser }) => {
  const alfa = await signUpInNewContext(browser, 'Sala_A');
  const bravo = await signUpInNewContext(browser, 'Sala_B');
  const code = (await alfa.page.getByTestId('party-code').textContent()) ?? '';
  await bravo.page.getByLabel('Entrar em outra party (código)').fill(code);
  await bravo.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(alfa.page.getByRole('heading', { name: 'Sua party (2/4)' })).toBeVisible();
  await chooseClass(alfa.page, 'Piloto');
  await chooseClass(bravo.page, 'Médico');
  await getReady(alfa.page);
  await getReady(bravo.page);

  // Bravo waits in the shared test room of 0.1, still in the party.
  await bravo.page.getByRole('button', { name: 'Entrar na sala' }).click();
  await expect(bravo.page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
  await alfa.page.getByRole('button', { name: 'Confirmar preparação' }).click();

  for (const { page } of [alfa, bravo]) {
    await expect(page.getByRole('button', { name: 'Sair da missão' })).toBeVisible();
    await expect(page.getByTestId('hud')).toContainText(alfa.nick);
    await expect(page.getByTestId('hud')).toContainText(bravo.nick);
  }
});
