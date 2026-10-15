import { expect, test } from '@playwright/test';

const PASSWORD = 'senha de teste longa';
const NEW_PASSWORD = 'senha nova de teste';

test('signs up, signs out, logs in and recovers an account with a one-time code', async ({
  page,
}) => {
  const nick = `Conta_${Date.now().toString(36).slice(-6)}`;
  const form = page.getByRole('form');
  const fill = async (fields: Record<string, string>) => {
    for (const [name, value] of Object.entries(fields)) {
      await form.locator(`input[name="${name}"]`).fill(value);
    }
  };

  await page.goto('/');

  await test.step('sign-up asks only for nick and password', async () => {
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await expect(form.locator('input')).toHaveCount(3); // nick, password, confirmation
    await expect(page.getByText(/Não pedimos e-mail/)).toBeVisible();
    await fill({ nick, password: PASSWORD, confirmation: PASSWORD });
    await form.getByRole('button', { name: 'Criar conta' }).click();
    await expect(page.getByTestId('signed-in-as')).toContainText(nick);
  });

  let code = '';
  await test.step('the optional recovery code is shown once', async () => {
    await expect(page.getByText(/Quer gerar um código de recuperação/)).toBeVisible();
    await page.getByRole('button', { name: 'Gerar código de recuperação' }).click();
    code = (await page.getByTestId('recovery-code').textContent()) ?? '';
    expect(code).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    await page.getByRole('button', { name: 'Já guardei' }).click();
    await expect(page.getByTestId('recovery-code')).toHaveCount(0);
    await expect(page.getByText(/Você tem um código de recuperação guardado/)).toBeVisible();
  });

  await test.step('sign out and the session is gone after reload', async () => {
    await page.getByRole('button', { name: 'Sair da conta' }).click();
    await expect(page.getByText('Você saiu da conta.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('form', { name: 'Entrar' })).toBeVisible();
  });

  await test.step('wrong password gets a message that does not reveal the account', async () => {
    await fill({ nick, password: 'senha errada qualquer' });
    await form.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('alert')).toHaveText('Nick ou senha incorretos.');
    await fill({ nick: 'Ninguem_Mesmo', password: 'senha errada qualquer' });
    await form.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('alert')).toHaveText('Nick ou senha incorretos.');
  });

  await test.step('log in, and the session survives a reload', async () => {
    await fill({ nick, password: PASSWORD });
    await form.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByTestId('signed-in-as')).toContainText(nick);
    await page.reload();
    await expect(page.getByTestId('signed-in-as')).toContainText(nick);
    await page.getByRole('button', { name: 'Sair da conta' }).click();
  });

  await test.step('recover with the code and a new password', async () => {
    await page.getByRole('button', { name: 'Recuperar acesso' }).click();
    await fill({ nick, code, password: NEW_PASSWORD, confirmation: NEW_PASSWORD });
    await form.getByRole('button', { name: 'Recuperar acesso' }).click();
    await expect(page.getByTestId('signed-in-as')).toContainText(nick);
    await page.getByRole('button', { name: 'Sair da conta' }).click();
  });

  await test.step('the same code does not work twice', async () => {
    await page.getByRole('button', { name: 'Recuperar acesso' }).click();
    await fill({ nick, code, password: PASSWORD, confirmation: PASSWORD });
    await form.getByRole('button', { name: 'Recuperar acesso' }).click();
    await expect(page.getByRole('alert')).toContainText('Cada código funciona uma única vez');
  });

  await test.step('only the new password works now', async () => {
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await fill({ nick, password: PASSWORD });
    await form.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('alert')).toHaveText('Nick ou senha incorretos.');
    await fill({ nick, password: NEW_PASSWORD });
    await form.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByTestId('signed-in-as')).toContainText(nick);
  });
});
