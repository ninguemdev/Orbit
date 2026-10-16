import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLASS_NAMES,
  EQUIP_SLOTS,
  EQUIP_SLOT_NAMES,
  ITEMS,
  LOADOUT_SLOTS,
  type LoadoutIssue,
  isClassId,
  isItemId,
} from '@orbit/catalog';
import type { LoadoutRefusalBody, LoadoutResponse } from '@orbit/contracts';
import { accountClient, describeAccountError } from '../network/account-client';
import { itemName } from './catalog-names';
import type { InventoryControls } from './use-inventory';

const ISSUE_TEXT: Record<LoadoutIssue, string> = {
  invalid_slot: 'espaço inválido',
  unknown_item: 'item fora do catálogo',
  wrong_slot: 'esse item não vai nesse espaço',
  class_restricted: 'sua classe não pode equipar esse item',
  not_owned: 'o item não está mais no seu stash',
  duplicate_item: 'item escolhido em dois espaços',
  duplicate_slot: 'espaço repetido',
};

type Issues = Partial<Record<string, LoadoutIssue>>;

/** First issue of each slot (a repeated slot must not hide the real problem). */
function issuesBySlot(list: readonly { slot: string; issue: LoadoutIssue | null }[]): Issues {
  const issues: Issues = {};
  for (const { slot, issue } of list) if (issue && !issues[slot]) issues[slot] = issue;
  return issues;
}

function isRefusal(body: unknown): body is LoadoutRefusalBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { issues?: unknown }).issues)
  );
}

const slotLabel = (slot: string) =>
  (EQUIP_SLOT_NAMES as Record<string, string>)[slot] ?? `Mochila ${Number(slot.split('.')[1]) + 1}`;

const restriction = (itemId: string) => {
  if (!isItemId(itemId)) return '';
  const classes = ITEMS[itemId].classes;
  return classes ? ` (só ${classes.map((id) => CLASS_NAMES[id]).join(', ')})` : '';
};

/**
 * Items picked for the next mission. Choices are a draft until saved; the server
 * checks ownership, slot and class, and the stash is never changed by picking.
 * `classId` (the class shown by the party) reloads the server's check of the saved
 * loadout; the party shows a class only after the account has saved it.
 */
export function LoadoutPanel({
  classId,
  inventory,
}: {
  classId: string;
  inventory: InventoryControls;
}) {
  const [saved, setSaved] = useState<LoadoutResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<Issues>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirtyRef = useRef(false);
  const latest = useRef(0);
  const mounted = useRef(true);

  const markDirty = (value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  };

  /** Shows a loadout from the server; unsaved picks are kept unless `discard`. */
  const apply = useCallback((loadout: LoadoutResponse, discard: boolean) => {
    setSaved(loadout);
    if (dirtyRef.current && !discard) return;
    setDraft(Object.fromEntries(loadout.entries.map((entry) => [entry.slot, entry.instanceId])));
    setIssues(issuesBySlot(loadout.entries));
    dirtyRef.current = false;
    setDirty(false);
  }, []);

  const load = useCallback(
    async (discard = false) => {
      const request = ++latest.current;
      const result = await accountClient.loadout();
      // Only the latest answer counts, and none after the panel is gone.
      if (!mounted.current || request !== latest.current) return;
      if (!result.ok) return setError(describeAccountError(result.code));
      setError(null);
      apply(result.data, discard);
    },
    [apply],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load, classId]);

  const pick = (slot: string, instanceId: string) => {
    setDraft((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([other]) => other !== slot));
      return instanceId ? { ...next, [slot]: instanceId } : next;
    });
    markDirty(true);
  };

  const save = async () => {
    setBusy(true);
    const request = ++latest.current;
    const picks = Object.entries(draft).map(([slot, instanceId]) => ({ slot, instanceId }));
    const result = await accountClient.saveLoadout(picks);
    if (!mounted.current) return;
    setBusy(false);
    if (result.ok) {
      setError(null);
      if (request === latest.current) apply(result.data, true);
      return;
    }
    setError(describeAccountError(result.code));
    if (result.code === 'invalid_loadout' && isRefusal(result.body)) {
      setIssues(issuesBySlot(result.body.issues));
    }
  };

  const refresh = () => {
    if (dirty) return void load(true);
    void inventory.reload();
    void load();
  };

  const stash = inventory.inventory?.stash ?? [];
  // Items already placed elsewhere in the draft are not offered again.
  const options = (slot: string) => {
    const used = new Set(
      Object.entries(draft).flatMap(([other, id]) => (other === slot ? [] : [id])),
    );
    const equip = (EQUIP_SLOTS as readonly string[]).includes(slot);
    return stash.filter((entry) => {
      if (used.has(entry.instanceId)) return false;
      if (!equip) return true;
      return isItemId(entry.itemId) && ITEMS[entry.itemId].equipSlot === slot;
    });
  };
  const serverClass = saved?.classId ?? null;

  return (
    <section className="panel" aria-label="Loadout" data-testid="loadout">
      <h2>Loadout da próxima missão</h2>
      <p className="hint">
        Classe: {serverClass && isClassId(serverClass) ? CLASS_NAMES[serverClass] : 'não escolhida'}
        . Os itens continuam no stash; ao confirmar a preparação, ficam reservados para a missão.
      </p>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      <div className="loadout-grid">
        {LOADOUT_SLOTS.map((slot) => {
          const current = draft[slot] ?? '';
          const currentItem = stash.find((entry) => entry.instanceId === current);
          const choices = options(slot);
          const issue = issues[slot];
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
              {issue ? (
                <span className="error" data-testid={`loadout-issue-${slot}`}>
                  {ISSUE_TEXT[issue]}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      <button type="button" disabled={busy || !dirty} onClick={() => void save()}>
        Salvar loadout
      </button>{' '}
      <button type="button" className="secondary" disabled={busy} onClick={refresh}>
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
