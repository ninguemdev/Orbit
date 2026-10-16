import { type Page, expect, test } from '@playwright/test';
import { TEST_PASSWORD, seedDev, signUpInNewContext, closeOpenContexts } from './support/accounts';

test.afterEach(closeOpenContexts);

/** 0.2 gate: two accounts prepare a mission together and keep it after signing in again. */
test('two accounts prepare together and keep their choices after signing in again', async ({
  browser,
}) => {
  const alfa = await signUpInNewContext(browser, 'Gate_A');
  const bravo = await signUpInNewContext(browser, 'Gate_B');
  // Dev data: test items for both, and the hauler license for Bravo only.
  seedDev(alfa.nick, { ships: false });
  seedDev(bravo.nick);
  for (const { page } of [alfa, bravo]) await page.reload();

  const chooseClass = async (page: Page, name: string) => {
    const radio = page.getByRole('radio', { name: new RegExp(`^${name}`) });
    await radio.click();
    await expect(radio).toBeChecked();
  };
  const saveLoadout = async (page: Page, picks: Record<string, string>, total: number) => {
    const loadout = page.getByTestId('loadout');
    for (const [slot, item] of Object.entries(picks)) {
      await loadout.getByLabel(slot).selectOption({ label: item });
    }
    await loadout.getByRole('button', { name: 'Salvar loadout' }).click();
    await expect(loadout.getByTestId('loadout-saved')).toHaveText(
      `${total} item(ns) no loadout salvo.`,
    );
  };

  await test.step('Bravo joins Alfa and each chooses a class and a loadout', async () => {
    const code = (await alfa.page.getByTestId('party-code').textContent()) ?? '';
    await bravo.page.getByLabel('Entrar em outra party (código)').fill(code);
    await bravo.page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(alfa.page.getByTestId('party-members')).toContainText(bravo.nick);

    await chooseClass(alfa.page, 'Oficial');
    await chooseClass(bravo.page, 'Engenheiro');
    await saveLoadout(
      alfa.page,
      { 'Arma principal': 'Fuzil longo (só Oficial)', 'Arma secundária': 'Pistola padrão' },
      2,
    );
    await saveLoadout(bravo.page, { Ferramenta: 'Kit de reparo', 'Mochila 1': 'Kit médico ×3' }, 2);
    for (const { page } of [alfa, bravo]) {
      const roster = page.getByTestId('party-members');
      await expect(roster).toContainText(`${alfa.nick} (Oficial)`);
      await expect(roster).toContainText(`${bravo.nick} (Engenheiro)`);
    }
  });

  await test.step('the leader picks a ship only Bravo is licensed for', async () => {
    for (const { page } of [alfa, bravo]) {
      const ships = page.getByTestId('party-ships');
      await expect(ships).toContainText(`BatedoraLiberada por: ${alfa.nick}, ${bravo.nick}`);
      await expect(ships).toContainText(`CargueiraLiberada por: ${bravo.nick}`);
    }
    await alfa.page.getByRole('radio', { name: /Cargueira/ }).click();
    await expect(bravo.page.getByRole('radio', { name: /Cargueira/ })).toBeChecked();
  });

  await test.step('both get ready and the leader confirms', async () => {
    for (const { page } of [alfa, bravo]) {
      await page.getByRole('button', { name: 'Estou pronto' }).click();
      await expect(page.getByRole('button', { name: 'Não estou pronto' })).toBeVisible();
    }
    await alfa.page.getByRole('button', { name: 'Confirmar preparação' }).click();
  });

  await test.step('the confirmation takes both into the mission with the items reserved', async () => {
    for (const { page, nick } of [alfa, bravo]) {
      await expect(page.getByTestId('game').locator('canvas')).toBeVisible();
      await expect(page.getByTestId('hud')).toContainText(nick);
    }
    for (const { page } of [alfa, bravo]) {
      await expect(page.getByTestId('hud')).toContainText(alfa.nick);
      await expect(page.getByTestId('hud')).toContainText(bravo.nick);
    }
  });

  await test.step('leaving ends the match and returns the reserved items', async () => {
    for (const { page } of [alfa, bravo]) {
      await page.getByRole('button', { name: 'Sair da missão' }).click();
      await expect(page.getByTestId('signed-in-as')).toBeVisible();
    }
    for (const { page } of [alfa, bravo]) {
      await expect(page.getByTestId('party-notice')).toHaveText(
        'A missão terminou sem extração e os itens reservados voltaram ao stash.',
      );
      await expect(page.getByTestId('stash')).not.toContainText('(reservado)');
      await expect(page.getByTestId('expedition-preparing')).toHaveCount(0);
    }
  });

  await test.step('signing out and in again keeps class, loadout, inventory and licenses', async () => {
    for (const player of [alfa, bravo]) {
      const { page, nick } = player;
      await page.getByRole('button', { name: 'Sair da conta' }).click();
      const form = page.getByRole('form');
      await form.locator('input[name="nick"]').fill(nick);
      await form.locator('input[name="password"]').fill(TEST_PASSWORD);
      await form.getByRole('button', { name: 'Entrar' }).click();
      await expect(page.getByTestId('signed-in-as')).toContainText(nick);
      await expect(page.getByTestId('credits')).toHaveText('Créditos: 200');
    }

    await expect(alfa.page.getByTestId('party-members')).toContainText(`${alfa.nick} (Oficial)`);
    await expect(bravo.page.getByTestId('party-members')).toContainText(
      `${bravo.nick} (Engenheiro)`,
    );
    const selected = (page: Page, slot: string) =>
      page.getByTestId('loadout').getByLabel(slot).locator('option:checked');
    await expect(selected(alfa.page, 'Arma principal')).toHaveText('Fuzil longo (só Oficial)');
    await expect(selected(alfa.page, 'Arma secundária')).toHaveText('Pistola padrão');
    await expect(selected(bravo.page, 'Ferramenta')).toHaveText('Kit de reparo');
    await expect(selected(bravo.page, 'Mochila 1')).toHaveText('Kit médico ×3');
    for (const { page } of [alfa, bravo]) {
      await expect(page.getByTestId('loadout').getByRole('alert')).toHaveCount(0);
      await expect(
        page.getByTestId('loadout').locator('[data-testid^="loadout-issue-"]'),
      ).toHaveCount(0);
    }
    // Signing out left the party, which cancelled the preparation and returned the items.
    for (const { page } of [alfa, bravo]) {
      await expect(page.getByTestId('stash')).not.toContainText('(reservado)');
      await expect(page.getByTestId('expedition-preparing')).toHaveCount(0);
    }
    await expect(alfa.page.getByTestId('ships')).toHaveText('Naves liberadas: Batedora');
    await expect(bravo.page.getByTestId('ships')).toHaveText(
      'Naves liberadas: Batedora, Cargueira',
    );
  });
});
