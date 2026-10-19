import { useEffect, useState } from 'react';
import {
  type HolderRef,
  type MissionInventoryView,
  type MissionItemView,
  RoomPhase,
} from '@orbit/contracts';
import type { SectorBridge } from '../network/sector-connection';
import { itemName } from './catalog-names';

/** Connection and match phase are read this often; inventory views arrive as pushed. */
const REFRESH_MS = 200;
/** A click waits this long for the server's answer before the buttons come back. */
const PENDING_MS = 1000;

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
  readonly items: readonly MissionItemView[];
  readonly slots?: number;
  /** Where the listed items are and what can be done with them; absent = read only. */
  readonly movable?:
    | {
        readonly from: HolderRef;
        readonly disabled: boolean;
        readonly actions: (item: MissionItemView) => Move[];
        readonly onMove: (item: MissionItemView, from: HolderRef, move: Move) => void;
      }
    | undefined;
}

function ItemList({ title, testId, items, slots, movable }: ItemListProps) {
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
              {movable?.actions(item).map((move) => (
                <button
                  key={move.label}
                  type="button"
                  disabled={movable.disabled}
                  aria-label={`${move.label}: ${itemName(item.itemId)}`}
                  onClick={() => movable.onMove(item, movable.from, move)}
                >
                  {move.label}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function statusText(view: MissionInventoryView, connected: boolean, active: boolean): string {
  if (!connected) return 'Sem conexão com a missão; aguarde a reconexão.';
  if (!active) return 'A coleta começa quando toda a tripulação entrar.';
  if (!view.atHatch) {
    return 'Vá até a eclusa de carga (círculo lilás na popa) para usar o porão e os contêineres.';
  }
  return view.container
    ? 'Na eclusa, com um contêiner ao alcance.'
    : 'Na eclusa. Encoste a nave num contêiner para ver o que ele guarda.';
}

/**
 * The player's items during a mission, as the server last described them. Moving
 * only sends a request: the list changes when the server's new view arrives, and the
 * buttons wait for it so a double click does not ask twice.
 */
export function MissionInventoryPanel({ bridge }: { readonly bridge: SectorBridge }) {
  const [view, setView] = useState<MissionInventoryView | null>(() => bridge.inventory());
  const [connected, setConnected] = useState(bridge.status === 'connected');
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const unsubscribe = bridge.onInventory((next) => {
      setView(next);
      setPending(false);
    });
    const timer = setInterval(() => {
      setConnected(bridge.status === 'connected');
      setActive(bridge.latest()?.phase === RoomPhase.Active);
    }, REFRESH_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [bridge]);

  useEffect(() => {
    if (!pending) return;
    // A refused request brings no new view: give the buttons back anyway.
    const timer = setTimeout(() => setPending(false), PENDING_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  if (!view) return null;
  const usable = connected && active && view.atHatch;
  const onMove = (item: MissionItemView, from: HolderRef, move: Move) => {
    setPending(true);
    bridge.transfer({ item: item.id, from, to: move.to, quantity: move.quantity });
  };
  const at = (from: HolderRef, actions: (item: MissionItemView) => Move[]) =>
    usable ? { from, disabled: pending, actions, onMove } : undefined;
  // Gear of another member is moved only by its owner.
  const mayMove = (item: MissionItemView) => item.mine || item.ownerNick === null;

  return (
    <aside
      className="mission-inventory"
      data-testid="mission-inventory"
      aria-label="Inventário da missão"
    >
      <h2>Inventário da missão</h2>
      <p className="hint" data-testid="hatch-status">
        {statusText(view, connected, active)}
      </p>
      {view.container ? (
        <ItemList
          title="Contêiner"
          testId="container-items"
          items={view.container.items}
          movable={at(view.container.id, (item) => [
            ...moves(item, 'backpack', 'Pegar'),
            ...moves(item, 'cargo', 'Ao porão'),
          ])}
        />
      ) : null}
      <ItemList title="Equipado" testId="equipment-items" items={view.equipment} />
      <ItemList
        title="Mochila"
        testId="backpack-items"
        items={view.backpack.items}
        slots={view.backpack.slots}
        movable={at('backpack', (item) => (mayMove(item) ? moves(item, 'cargo', 'Ao porão') : []))}
      />
      <ItemList
        title="Porão da nave"
        testId="cargo-items"
        items={view.cargo.items}
        slots={view.cargo.slots}
        movable={at('cargo', (item) => (mayMove(item) ? moves(item, 'backpack', 'À mochila') : []))}
      />
    </aside>
  );
}
