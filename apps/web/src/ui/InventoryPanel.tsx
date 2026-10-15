import { LoadoutPanel } from './LoadoutPanel';
import { itemName, shipName } from './catalog-names';
import { type InventoryControls, useInventory } from './use-inventory';

/** Permanent possessions of the account, read from the server (never edited locally). */
export function InventoryPanel({ inventory: controls }: { inventory: InventoryControls }) {
  const { inventory, error, loading } = controls;

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
      <button
        type="button"
        className="secondary"
        disabled={loading}
        onClick={() => void controls.reload()}
      >
        {error ? 'Tentar de novo' : 'Atualizar'}
      </button>
    </section>
  );
}

/** Inventory and loadout of the signed-in account, sharing one inventory read. */
export function PreparationPanels({ classId }: { classId: string }) {
  const inventory = useInventory();
  return (
    <>
      <InventoryPanel inventory={inventory} />
      <LoadoutPanel classId={classId} inventory={inventory} />
    </>
  );
}
