import { type FormEvent, useState } from 'react';
import type { MeResponse } from '@orbit/contracts';
import { type ApiResult, accountClient, describeAccountError } from '../network/account-client';

type Mode = 'login' | 'signup' | 'recover';

interface AccessScreenProps {
  /** Called with the signed-in account and how it got in (sign-up offers the recovery code). */
  readonly onSignedIn: (me: MeResponse, origin: 'login' | 'signup' | 'recover') => void;
  readonly notice?: string | undefined;
}

const TITLES: Record<Mode, string> = {
  login: 'Entrar',
  signup: 'Criar conta',
  recover: 'Recuperar acesso',
};

export function AccessScreen({ onSignedIn, notice }: AccessScreenProps) {
  const [mode, setMode] = useState<Mode>('login');
  const [nick, setNick] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setPassword('');
    setConfirmation('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode !== 'login' && password !== confirmation) {
      setError('As senhas não conferem.');
      return;
    }
    setBusy(true);
    setError(null);
    let result: ApiResult<MeResponse>;
    if (mode === 'login') result = await accountClient.login(nick.trim(), password);
    else if (mode === 'signup') result = await accountClient.signUp(nick.trim(), password);
    else result = await accountClient.recover(nick.trim(), code, password);
    setBusy(false);
    if (result.ok) onSignedIn(result.data, mode);
    else setError(describeAccountError(result.code));
  };

  const newPassword = mode !== 'login';
  return (
    <main className="menu">
      <h1>Orbit</h1>
      <nav className="tabs" aria-label="Acesso">
        {(['login', 'signup', 'recover'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={item === mode ? 'tab active' : 'tab'}
            aria-pressed={item === mode}
            onClick={() => switchMode(item)}
          >
            {TITLES[item]}
          </button>
        ))}
      </nav>
      {notice ? <p role="status">{notice}</p> : null}
      <form onSubmit={submit} aria-label={TITLES[mode]}>
        <label>
          Nick
          <input
            name="nick"
            value={nick}
            autoComplete="username"
            maxLength={20}
            required
            onChange={(event) => setNick(event.target.value)}
          />
        </label>
        {mode === 'recover' ? (
          <label>
            Código de recuperação
            <input
              name="code"
              value={code}
              autoComplete="off"
              spellCheck={false}
              required
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          {mode === 'recover' ? 'Nova senha' : 'Senha'}
          <input
            name="password"
            type="password"
            value={password}
            autoComplete={newPassword ? 'new-password' : 'current-password'}
            minLength={newPassword ? 12 : 1}
            maxLength={128}
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {newPassword ? (
          <label>
            Confirmar senha
            <input
              name="confirmation"
              type="password"
              value={confirmation}
              autoComplete="new-password"
              required
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        ) : null}
        {mode === 'signup' ? (
          <p className="hint">
            Só nick e senha (mínimo de 12 caracteres). Não pedimos e-mail: se esquecer a senha, a
            única forma de recuperar a conta é um código de recuperação, que você pode gerar logo
            depois do cadastro.
          </p>
        ) : null}
        {mode === 'recover' ? (
          <p className="hint">
            Use o código que você gerou e guardou. Ele funciona uma única vez; depois, todas as
            sessões abertas são encerradas. Sem o código não há como recuperar a conta.
          </p>
        ) : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Aguarde…' : TITLES[mode]}
        </button>
      </form>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </main>
  );
}
