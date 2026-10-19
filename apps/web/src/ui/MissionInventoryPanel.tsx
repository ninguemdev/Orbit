import { useEffect, useState } from 'react';
import type { HolderRef, MissionInventoryView, MissionItemView } from '@orbit/contracts';
import type { SectorBridge } from '../network/sector-connection';
import { itemName } from './catalog-names';

const REFRESH_MS = 200;

interface Move {
  readonly label: string;
  readonly to: HolderRef;
  readonly quantity: number;
}

function ownerLabel(item: MissionItemView): string {
  if (item.mine) return 'seu';
  return item.ownerNick === null ? 'comum' : `de ${item.ownerNick}`;
}

/** Moving all, and one unit when it is a stack of common loot. */
function moves(item: MissionItemView, to: HolderRef, verb: string): Move[] {
  const all: Move = { label: verb, to, quantity: item.quantity };
  if (item.quantity === 1 || item.ownerNick !== null) return [all];
  return [all, { label: `${verb} 1`, to, quantity: 1 }];
}

interface ItemListProps {
  readonly title: string;
  readonly testId: string;
  readonly from: HolderRef | null;
  readonly items: readonly MissionItemView[];
  readonly slots?: number;
  readonly actions: (item: MissionItemView) => Move[];
  readonly onMove: (item: MissionItemView, from: HolderRef, move: Move) => void;
}

function ItemList({ title, testId, from, items, slots, actions, onMove }: ItemListProps) {
  return (
    <section data-testid={testId}>
      <h3>
        {title}
        {slots !== undefined ? ` (${items.length}/${slots})` : ''}
      </h3>
      {items.length === 0 ? (
        <p className="hint">Vazio.</p>
      ) : (
        <ul className="mission-items">
          {items.map((item) => (
            <li key={item.id}>
              <span>
                {itemName(item.itemId)}
                {item.quantity > 1 ? ` ×${item.quantity}` : ''}{' '}
                <small className="hint">({ownerLabel(item)})</small>
              </span>
              {from !== null
                ? actions(item).map((move) => (
                    <button
                      key={move.label}
                      type="button"
                      aria-label={`${move.label}: ${itemName(item.itemId)}`}
                      onClick={() => onMove(item, from, move)}
                    >
                      {move.label}
                    </button>
                  ))
                : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The player's items during a mission, as the server last described them. Moving
 * only sends a request: the list changes when the server's new view arrives.
 */
export function MissionInventoryPanel({ bridge }: { readonly bridge: SectorBridge }) {
  const [view, setView] = useState<MissionInventoryView | null>(() => bridge.inventory());

  useEffect(() => {
    const timer = setInterval(() => setView(bridge.inventory()), REFRESH_MS);
    return () => clearInterval(timer);
  }, [bridge]);

  if (!view) return null;
  const onMove = (item: MissionItemView, from: HolderRef, move: Move) =>
    bridge.transfer({ item: item.id, from, to: move.to, quantity: move.quantity });
  // Gear of another member is moved only by its owner.
  const movable = (item: MissionItemView) => item.mine || item.ownerNick === null;
  const atHatch = view.atHatch;

  return (
    <aside
      className="mission-inventory"
      data-testid="mission-inventory"
      aria-label="Inventário da missão"
    >
      <h2>Inventário da missão</h2>
      <p className="hint" data-testid="hatch-status">
        {!atHatch
          ? 'Vá até a eclusa de carga (círculo verde na popa) para usar o porão e os contêineres.'
          : view.container
            ? 'Na eclusa, com um contêiner ao alcance.'
            : 'Na eclusa. Encoste a nave num contêiner para ver o que ele guarda.'}
      </p>
      {view.container ? (
        <ItemList
          title="Contêiner"
          testId="container-items"
          from={view.container.id as HolderRef}
          items={view.container.items}
          actions={(item) => [
            ...moves(item, 'backpack', 'Pegar'),
            ...moves(item, 'cargo', 'Ao porão'),
          ]}
          onMove={onMove}
        />
      ) : null}
      <ItemList
        title="Equipado"
        testId="equipment-items"
        from={null}
        items={view.equipment}
        actions={() => []}
        onMove={onMove}
      />
      <ItemList
        title="Mochila"
        testId="backpack-items"
        from={atHatch ? 'backpack' : null}
        items={view.backpack.items}
        slots={view.backpack.slots}
        actions={(item) => (movable(item) ? moves(item, 'cargo', 'Ao porão') : [])}
        onMove={onMove}
      />
      <ItemList
        title="Porão da nave"
        testId="cargo-items"
        from={atHatch ? 'cargo' : null}
        items={view.cargo.items}
        slots={view.cargo.slots}
        actions={(item) => (movable(item) ? moves(item, 'backpack', 'À mochila') : [])}
        onMove={onMove}
      />
    </aside>
  );
}
