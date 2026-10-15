import { useEffect, useState } from 'react';
import { ITEMS, SHIP_HULLS, isItemId } from '@orbit/catalog';
import type { InventoryResponse } from '@orbit/contracts';
import { accountClient, describeAccountError } from '../network/account-client';

const itemName = (itemId: string) => (isItemId(itemId) ? ITEMS[itemId].name : itemId);
const shipName = (shipId: string) =>
  Object.values(SHIP_HULLS).find((hull) => hull.id === shipId)?.name ?? shipId;

/** Permanent possessions of the account, read from the server (never edited locally). */
export function InventoryPanel() {
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void accountClient.inventory().then((result) => {
      if (cancelled) return;
      if (result.ok) setInventory(result.data);
      else setError(describeAccountError(result.code));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  }
  if (!inventory) return <p>Carregando inventário…</p>;

  return (
    <section className="inventory" aria-label="Inventário" data-testid="inventory">
      <h2>Inventário</h2>
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
    </section>
  );
}
