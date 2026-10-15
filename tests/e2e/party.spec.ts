import { expect, test } from '@playwright/test';
import { signUpInNewContext } from './support/accounts';

test('forms a party by code and by invite, and hands over leadership', async ({ browser }) => {
  const alfa = await signUpInNewContext(browser, 'Lider');
  const bravo = await signUpInNewContext(browser, 'Amigo');
  const charlie = await signUpInNewContext(browser, 'Convid');
  const members = (page: typeof alfa.page) => page.getByTestId('party-members');

  await test.step('everyone starts in a solo party with a code', async () => {
    for (const { page, nick } of [alfa, bravo, charlie]) {
      await expect(members(page)).toContainText(`${nick} — líder (você)`);
    }
    await expect(alfa.page.getByTestId('party-code')).toHaveText(/^[0-9A-Z]{6}$/);
  });

  await test.step('an invalid code is refused with a clear message', async () => {
    await bravo.page.getByLabel('Entrar em outra party (código)').fill('ZZZZZZ');
    await bravo.page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(bravo.page.getByTestId('party-notice')).toHaveText(
      'Código de party não encontrado. Confira as letras e números.',
    );
  });

  await test.step('a friend joins with the code', async () => {
    const code = (await alfa.page.getByTestId('party-code').textContent()) ?? '';
    await bravo.page.getByLabel('Entrar em outra party (código)').fill(code.toLowerCase());
    await bravo.page.getByRole('button', { name: 'Entrar', exact: true }).click();
    for (const page of [alfa.page, bravo.page]) {
      await expect(members(page)).toContainText(`${alfa.nick} — líder`);
      await expect(members(page)).toContainText(bravo.nick);
    }
    await expect(bravo.page.getByRole('heading', { name: /Sua party \(2\/4\)/ })).toBeVisible();
  });

  await test.step('only the leader sees invite and member controls', async () => {
    await expect(bravo.page.getByRole('form', { name: 'Convidar por nick' })).toHaveCount(0);
    await expect(bravo.page.getByRole('button', { name: 'Remover' })).toHaveCount(0);
  });

  await test.step('the leader invites an online player by nick', async () => {
    await alfa.page.getByLabel('Convidar jogador online (nick)').fill(charlie.nick);
    await alfa.page.getByRole('button', { name: 'Convidar' }).click();
    const invites = charlie.page.getByRole('list', { name: 'Convites recebidos' });
    await expect(invites).toContainText(`${alfa.nick} convidou você`);
    await invites.getByRole('button', { name: 'Aceitar' }).click();
    for (const page of [alfa.page, bravo.page, charlie.page]) {
      await expect(page.getByRole('heading', { name: /Sua party \(3\/4\)/ })).toBeVisible();
    }
  });

  await test.step('inviting someone offline explains why it failed', async () => {
    await alfa.page.getByLabel('Convidar jogador online (nick)').fill('Ninguem_Online');
    await alfa.page.getByRole('button', { name: 'Convidar' }).click();
    await expect(alfa.page.getByTestId('party-notice')).toHaveText('Esse jogador não está online.');
  });

  await test.step('when the leader leaves, the next member leads', async () => {
    await alfa.page.getByRole('button', { name: 'Sair da party' }).click();
    await expect(members(alfa.page)).toContainText(`${alfa.nick} — líder (você)`);
    await expect(members(bravo.page)).toContainText(`${bravo.nick} — líder (você)`);
    await expect(members(bravo.page)).not.toContainText(alfa.nick);
  });

  await test.step('the new leader removes a member, who returns to a solo party', async () => {
    await members(bravo.page)
      .getByRole('listitem')
      .filter({ hasText: charlie.nick })
      .getByRole('button', { name: 'Remover' })
      .click();
    await expect(charlie.page.getByTestId('party-notice')).toHaveText(
      'Você foi removido da party pelo líder.',
    );
    await expect(members(charlie.page)).toContainText(`${charlie.nick} — líder (você)`);
    await expect(bravo.page.getByRole('heading', { name: /Sua party \(1\/4\)/ })).toBeVisible();
  });
});

test('a second window of the same account takes over the party without a loop', async ({
  browser,
}) => {
  const first = await signUpInNewContext(browser, 'Abas');
  await expect(first.page.getByTestId('party-code')).toBeVisible();
  const second = await first.page.context().newPage();
  await second.goto('/');
  await expect(second.getByTestId('party-code')).toBeVisible();

  const moved = 'Sua conta entrou em uma party em outra janela.';
  await expect(first.page.getByTestId('party-notice')).toHaveText(moved);
  // Stays out (no ping-pong between windows) until the player chooses this window.
  await first.page.waitForTimeout(3000);
  await expect(first.page.getByRole('button', { name: 'Usar a party nesta janela' })).toBeVisible();
  await expect(second.getByTestId('party-code')).toBeVisible();

  await first.page.getByRole('button', { name: 'Usar a party nesta janela' }).click();
  await expect(first.page.getByTestId('party-code')).toBeVisible();
  await expect(second.getByTestId('party-notice')).toHaveText(moved);
});
