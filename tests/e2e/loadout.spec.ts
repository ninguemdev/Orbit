import { expect, test } from '@playwright/test';
import { seedDev, signUpInNewContext } from './support/accounts';

test('prepares a loadout from the stash, checked by the server', async ({ browser }) => {
  const { page, nick } = await signUpInNewContext(browser, 'Equipa');
  seedDev(nick);
  await page.reload();
  const loadout = page.getByTestId('loadout');
  const stash = page.getByTestId('stash');
  await expect(stash).toContainText('Pistola padrão');
  const stashText = await stash.textContent();

  await test.step('picks are a draft until saved, and the stash does not change', async () => {
    await loadout.getByLabel('Arma secundária').selectOption({ label: 'Pistola padrão' });
    await loadout.getByLabel('Mochila 1').selectOption({ label: 'Kit médico ×3' });
    await expect(loadout.getByTestId('loadout-saved')).toHaveCount(0);
    await loadout.getByRole('button', { name: 'Salvar loadout' }).click();
    await expect(loadout.getByTestId('loadout-saved')).toHaveText('2 item(ns) no loadout salvo.');
    await expect(stash).toHaveText(stashText ?? '');
  });

  await test.step('the saved loadout comes back after a reload', async () => {
    await page.reload();
    await expect(loadout.getByLabel('Arma secundária')).toHaveValue(/.+/);
    await expect(loadout.getByLabel('Arma secundária').locator('option:checked')).toHaveText(
      'Pistola padrão',
    );
    await expect(loadout.getByLabel('Mochila 1').locator('option:checked')).toHaveText(
      'Kit médico ×3',
    );
  });

  await test.step('a class weapon is refused until the class allows it', async () => {
    await loadout.getByLabel('Arma principal').selectOption({ label: 'Fuzil longo (só Oficial)' });
    await loadout.getByRole('button', { name: 'Salvar loadout' }).click();
    await expect(loadout.getByTestId('loadout-issue-primary')).toHaveText(
      'sua classe não pode equipar esse item',
    );
    await expect(loadout.getByRole('alert')).toHaveText(
      'O loadout tem itens que não podem ir nesses espaços.',
    );

    // The class radio follows the party state, confirmed by the server.
    await page.getByRole('radio', { name: /^Oficial/ }).click();
    await expect(page.getByRole('radio', { name: /^Oficial/ })).toBeChecked();
    await expect(loadout).toContainText('Classe: Oficial');
    await loadout.getByLabel('Arma principal').selectOption({ label: 'Fuzil longo (só Oficial)' });
    await loadout.getByRole('button', { name: 'Salvar loadout' }).click();
    await expect(loadout.getByTestId('loadout-saved')).toHaveText('3 item(ns) no loadout salvo.');
    await expect(loadout.getByTestId('loadout-issue-primary')).toHaveCount(0);
  });

  await test.step('changing class flags the weapon it no longer allows', async () => {
    // The class radio follows the party state, confirmed by the server.
    await page.getByRole('radio', { name: /^Piloto/ }).click();
    await expect(page.getByRole('radio', { name: /^Piloto/ })).toBeChecked();
    await expect(loadout.getByTestId('loadout-issue-primary')).toHaveText(
      'sua classe não pode equipar esse item',
    );
  });
});
