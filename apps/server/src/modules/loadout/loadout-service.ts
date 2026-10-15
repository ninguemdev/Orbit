import {
  type Database,
  type Loadout,
  type LoadoutEntry,
  type LoadoutPick,
  type SetLoadoutResult,
  getLoadout,
  setLoadout,
} from '@orbit/database';

/**
 * The single way the server reads and writes loadouts. Every saved change is reported
 * through `onChanged`, which drops the readiness of the player's party; a writer that
 * bypassed this service would leave a party confirmed on a loadout that changed.
 */
export class LoadoutService {
  readonly #db: Database;
  readonly #onChanged: (accountId: string) => void;

  constructor(db: Database, onChanged: (accountId: string) => void) {
    this.#db = db;
    this.#onChanged = onChanged;
  }

  read(accountId: string): Promise<Loadout> {
    return getLoadout(this.#db, accountId);
  }

  /** Saved entries with their current issues (the party room's `LoadoutReader`). */
  async loadout(accountId: string): Promise<readonly LoadoutEntry[]> {
    return (await getLoadout(this.#db, accountId)).entries;
  }

  async save(accountId: string, picks: readonly LoadoutPick[]): Promise<SetLoadoutResult> {
    const result = await setLoadout(this.#db, accountId, picks);
    if (result.ok) this.#onChanged(accountId);
    return result;
  }
}
