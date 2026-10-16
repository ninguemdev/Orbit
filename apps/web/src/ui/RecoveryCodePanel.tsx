import { useEffect, useState } from 'react';
import { accountClient, describeAccountError } from '../network/account-client';

interface RecoveryCodePanelProps {
  readonly hasCode: boolean;
  /** Shown right after sign-up, when generating a code is suggested. */
  readonly suggested: boolean;
  readonly onChange: () => void;
  /** Told while a new code is on screen, so nothing navigates away from it. */
  readonly onCodeShown?: (shown: boolean) => void;
}

/** Generates the optional recovery code and shows it exactly once. */
export function RecoveryCodePanel({
  hasCode,
  suggested,
  onChange,
  onCodeShown,
}: RecoveryCodePanelProps) {
  const [code, setCode] = useState<string | null>(null);
  const shown = code !== null;
  useEffect(() => {
    onCodeShown?.(shown);
    return () => onCodeShown?.(false);
  }, [shown, onCodeShown]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    setError(null);
    const result = await accountClient.createRecoveryCode();
    setBusy(false);
    if (result.ok) {
      setCode(result.data.code);
      onChange();
    } else {
      setError(describeAccountError(result.code));
    }
  };

  if (code) {
    return (
      <section className="panel recovery" aria-label="Código de recuperação">
        <p>
          Seu código de recuperação. Anote e guarde em local seguro: ele não será mostrado de novo e
          funciona uma única vez.
        </p>
        <p className="code" data-testid="recovery-code">
          {code}
        </p>
        <button type="button" onClick={() => setCode(null)}>
          Já guardei
        </button>
      </section>
    );
  }

  return (
    <section className="panel recovery" aria-label="Código de recuperação">
      {suggested ? (
        <p>
          Conta criada. Quer gerar um código de recuperação? É opcional, mas sem ele não há como
          recuperar a conta se você esquecer a senha.
        </p>
      ) : (
        <p>
          {hasCode
            ? 'Você tem um código de recuperação guardado. Gerar outro invalida o anterior.'
            : 'Você ainda não tem código de recuperação.'}
        </p>
      )}
      <button type="button" disabled={busy} onClick={generate}>
        {hasCode ? 'Gerar novo código de recuperação' : 'Gerar código de recuperação'}
      </button>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
