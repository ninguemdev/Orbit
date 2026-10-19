import { useEffect, useState } from 'react';
import type { MissionResultItemView, MissionResultView } from '@orbit/contracts';
import { accountClient } from '../network/account-client';
import { itemName } from './catalog-names';

const DISMISSED_KEY_PREFIX = 'orbit.missionResultSeen:';

const OUTCOME_TEXT: Record<MissionResultView['outcome'], string> = {
  extracted: 'Extração concluída.',
  destroyed: 'A nave foi destruída.',
  timeout: 'O tempo da missão esgotou.',
  aborted:
    'A missão terminou sem extração (aborto técnico): os itens reservados voltaram ao stash.',
  cancelled: 'A preparação foi cancelada antes da missão começar.',
};

// Keyed by account: a shared browser must not hide one account's result because
// another signed-in account on it dismissed theirs.
function readDismissed(accountId: string): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY_PREFIX + accountId);
  } catch {
    return null;
  }
}

function writeDismissed(accountId: string, expeditionId: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY_PREFIX + accountId, expeditionId);
  } catch {
    // Per-browser convenience only; nothing breaks without it.
  }
}

function itemList(items: readonly MissionResultItemView[]): string {
  return items
    .map((item) => `${itemName(item.itemId)}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`)
    .join(', ');
}

/**
 * The most recent mission this account finished (V03.09), read from the server so it
 * survives a closed tab or a relogin — never from the live room session. Shown once
 * per result: dismissing it, or a newer result arriving, replaces what is remembered.
 */
export function MissionResultPanel({ accountId }: { readonly accountId: string }) {
  const [result, setResult] = useState<MissionResultView | null>(null);
  const [dismissed, setDismissed] = useState(() => readDismissed(accountId));

  useEffect(() => {
    let mounted = true;
    setDismissed(readDismissed(accountId));
    void accountClient.missionResult().then((response) => {
      if (mounted && response.ok) setResult(response.data.result);
    });
    return () => {
      mounted = false;
    };
  }, [accountId]);

  if (!result || result.expeditionId === dismissed) return null;
  const { returned, received, lost } = result;

  return (
    <section className="panel" aria-label="Resultado da missão" data-testid="mission-result">
      <h2>Resultado da missão</h2>
      <p>{OUTCOME_TEXT[result.outcome]}</p>
      {returned.length > 0 ? <p>Equipamento próprio devolvido: {itemList(returned)}.</p> : null}
      {received.length > 0 ? <p>Carga recebida: {itemList(received)}.</p> : null}
      {lost.length > 0 ? <p>Perdido: {itemList(lost)}.</p> : null}
      {returned.length === 0 && received.length === 0 && lost.length === 0 ? (
        <p className="hint">Nenhum item foi concedido ou perdido nesta missão.</p>
      ) : null}
      <button
        type="button"
        className="secondary"
        onClick={() => {
          writeDismissed(accountId, result.expeditionId);
          setDismissed(result.expeditionId);
        }}
      >
        Dispensar
      </button>
    </section>
  );
}
