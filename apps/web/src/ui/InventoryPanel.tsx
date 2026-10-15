import { useCallback, useEffect, useState } from 'react';
import { ITEMS, SHIP_HULLS, isItemId, isShipHullId } from '@orbit/catalog';
import type { InventoryResponse } from '@orbit/contracts';
import { accountClient, describeAccountError } from '../network/account-client';

const itemName = (itemId: string) => (isItemId(itemId) ? ITEMS[itemId].name : itemId);
const shipName = (shipId: string) => (isShipHullId(shipId) ? SHIP_HULLS[shipId].name : shipId);

/**
 * Permanent possessions of the account, read from the server (never edited locally).
 * Refreshed on demand and whenever the window regains focus.
 */
export function InventoryPanel() {
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await accountClient.inventory();
    setLoading(false);
    if (result.ok) {
      setInventory(result.data);
      setError(null);
    } else {
      setError(describeAccountError(result.code));
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  return (
    <section className="inventory" aria-label="Inventário" data-testid="inventory">
      <h2>Inventário</h2>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {inventory ? (
        <>
          <p data-testid="credits">Créditos: {inventory.credits}</p>
          <p data-testid="ships">
            Naves liberadas: {inventory.ships.map((ship) => shipName(ship.shipId)).join(', ')}
          </p>
          <p>
            Stash ({inventory.stash.length}/{inventory.stashCapacity}):
          </p>
          {inventory.stash.length === 0 ? (
            <p className="hint">Vazio. Itens recuperados em missões ficam aqui.</p>
          ) : (
            <ul className="stash" data-testid="stash">
              {inventory.stash.map((entry) => (
                <li key={entry.instanceId}>
                  {itemName(entry.itemId)}
                  {entry.quantity > 1 ? ` ×${entry.quantity}` : ''}
                </li>
              ))}
            </ul>
          )}
          {inventory.inbox.length > 0 ? (
            <>
              <p>Caixa de recebimento:</p>
              <ul className="stash" data-testid="inbox">
                {inventory.inbox.map((entry) => (
                  <li key={entry.entryId}>
                    {itemName(entry.itemId)}
                    {entry.quantity > 1 ? ` ×${entry.quantity}` : ''} — {entry.reason}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : !error ? (
        <p>Carregando inventário…</p>
      ) : null}
      <button type="button" className="secondary" disabled={loading} onClick={() => void load()}>
        {error ? 'Tentar de novo' : 'Atualizar'}
      </button>
    </section>
  );
}
