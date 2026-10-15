import { useCallback, useEffect, useState } from 'react';
import {
  BACKPACK_SLOTS,
  CLASS_NAMES,
  EQUIP_SLOTS,
  EQUIP_SLOT_NAMES,
  ITEMS,
  backpackSlot,
  isClassId,
  isItemId,
} from '@orbit/catalog';
import type { InventoryResponse, LoadoutRefusalBody, LoadoutResponse } from '@orbit/contracts';
import { accountClient, describeAccountError } from '../network/account-client';
import { itemName } from './catalog-names';

type StashItem = InventoryResponse['stash'][number];

const ISSUE_TEXT: Record<string, string> = {
  invalid_slot: 'espaço inválido',
  unknown_item: 'item fora do catálogo',
  wrong_slot: 'esse item não vai nesse espaço',
  class_restricted: 'sua classe não pode equipar esse item',
  not_owned: 'o item não está mais no seu stash',
  duplicate_item: 'item escolhido em dois espaços',
  duplicate_slot: 'espaço repetido',
};
const describeIssue = (issue: string) => ISSUE_TEXT[issue] ?? issue;

const ALL_SLOTS: readonly string[] = [
  ...EQUIP_SLOTS,
  ...Array.from({ length: BACKPACK_SLOTS }, (_, index) => backpackSlot(index)),
];

/**
 * Items picked for the next mission. Choices are a draft until saved; the server
 * checks ownership, slot and class, and the stash is never changed by picking.
 * `classId` reloads the loadout when the class changes, so stale picks show up.
 */
export function LoadoutPanel({ classId }: { classId: string }) {
  const [stash, setStash] = useState<readonly StashItem[]>([]);
  const [saved, setSaved] = useState<LoadoutResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((loadout: LoadoutResponse) => {
    setSaved(loadout);
    setDraft(Object.fromEntries(loadout.entries.map((entry) => [entry.slot, entry.instanceId])));
    setIssues(
      Object.fromEntries(
        loadout.entries.flatMap((entry) => (entry.issue ? [[entry.slot, entry.issue]] : [])),
      ),
    );
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    const [inventory, firstLoadout] = await Promise.all([
      accountClient.inventory(),
      accountClient.loadout(),
    ]);
    // The party saves a class change to the account a moment after showing it; wait
    // briefly for the server to check the loadout against the class on screen.
    let loadout = firstLoadout;
    for (
      let attempt = 0;
      attempt < 5 && loadout.ok && (loadout.data.classId ?? '') !== classId;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      loadout = await accountClient.loadout();
    }
    if (!inventory.ok) return setError(describeAccountError(inventory.code));
    if (!loadout.ok) return setError(describeAccountError(loadout.code));
    setError(null);
    setStash(inventory.data.stash);
    apply(loadout.data);
  }, [apply, classId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pick = (slot: string, instanceId: string) => {
    setDraft((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([other]) => other !== slot));
      return instanceId ? { ...next, [slot]: instanceId } : next;
    });
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    const picks = Object.entries(draft).map(([slot, instanceId]) => ({ slot, instanceId }));
    const result = await accountClient.saveLoadout(picks);
    setBusy(false);
    if (result.ok) {
      setError(null);
      apply(result.data);
    } else if (result.code === 'invalid_loadout') {
      const body = result.body as LoadoutRefusalBody;
      setIssues(Object.fromEntries(body.issues.map((entry) => [entry.slot, entry.issue])));
      setError(describeAccountError(result.code));
    } else {
      setError(describeAccountError(result.code));
    }
  };

  // Items already placed elsewhere in the draft are not offered again.
  const usedElsewhere = (slot: string) =>
    new Set(Object.entries(draft).flatMap(([other, id]) => (other === slot ? [] : [id])));

  const options = (slot: string) => {
    const used = usedElsewhere(slot);
    const equip = (EQUIP_SLOTS as readonly string[]).includes(slot);
    return stash.filter((entry) => {
      if (used.has(entry.instanceId)) return false;
      if (!equip) return true;
      return isItemId(entry.itemId) && ITEMS[entry.itemId].equipSlot === slot;
    });
  };

  const restriction = (itemId: string) => {
    if (!isItemId(itemId)) return '';
    const classes = ITEMS[itemId].classes;
    return classes ? ` (só ${classes.map((id) => CLASS_NAMES[id]).join(', ')})` : '';
  };

  const slotLabel = (slot: string) =>
    (EQUIP_SLOT_NAMES as Record<string, string>)[slot] ??
    `Mochila ${Number(slot.split('.')[1]) + 1}`;

  return (
    <section className="inventory" aria-label="Loadout" data-testid="loadout">
      <h2>Loadout da próxima missão</h2>
      <p className="hint">
        Classe: {isClassId(classId) ? CLASS_NAMES[classId] : 'não escolhida'}. Os itens continuam no
        stash; a reserva para a partida começa na 0.3.
      </p>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      <div className="loadout-grid">
        {ALL_SLOTS.map((slot) => {
          const current = draft[slot] ?? '';
          const currentItem = stash.find((entry) => entry.instanceId === current);
          const choices = options(slot);
          return (
            <label key={slot} className="loadout-slot">
              <span>{slotLabel(slot)}</span>
              <select
                aria-label={slotLabel(slot)}
                value={current}
                onChange={(event) => pick(slot, event.target.value)}
              >
                <option value="">— vazio —</option>
                {currentItem && !choices.includes(currentItem) ? (
                  <option value={currentItem.instanceId}>{itemName(currentItem.itemId)}</option>
                ) : null}
                {choices.map((entry) => (
                  <option key={entry.instanceId} value={entry.instanceId}>
                    {itemName(entry.itemId)}
                    {entry.quantity > 1 ? ` ×${entry.quantity}` : ''}
                    {restriction(entry.itemId)}
                  </option>
                ))}
              </select>
              {issues[slot] ? (
                <span className="error" data-testid={`loadout-issue-${slot}`}>
                  {describeIssue(issues[slot])}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      <button type="button" disabled={busy || !dirty} onClick={() => void save()}>
        Salvar loadout
      </button>{' '}
      <button type="button" className="secondary" disabled={busy} onClick={() => void load()}>
        {dirty ? 'Descartar alterações' : 'Atualizar'}
      </button>
      {saved && !dirty ? (
        <p className="hint" data-testid="loadout-saved">
          {saved.entries.length} item(ns) no loadout salvo.
        </p>
      ) : null}
    </section>
  );
}
