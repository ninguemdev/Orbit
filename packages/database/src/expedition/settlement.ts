import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { type Executor, grantItem, lockAccounts } from '../inventory/inventory';
import {
  type ExpeditionState,
  expeditionMembers,
  expeditions,
  itemInstances,
  itemReservations,
  activeParticipations,
  settlements,
} from '../schema';

/**
 * Mirrors `apps/server/src/modules/settlement/manifest.ts`'s `Manifest`; packages never
 * import from apps (docs/04-ARQUITETURA.md), so the shape is declared again here and
 * matched structurally — the real `Manifest` already satisfies it.
 */
export interface SettlementDestination {
  readonly sourceId: string;
  readonly accountId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly origin: string;
}

export interface SettlementLoss {
  readonly sourceId: string;
  readonly accountId: string | null;
  readonly itemId: string;
  readonly quantity: number;
  readonly origin: string;
  readonly reason: string;
}

export interface SettlementManifest {
  readonly expeditionId: string;
  readonly outcome: 'extracted' | 'destroyed' | 'timeout';
  readonly eligibleAccountIds: readonly string[];
  readonly destinations: readonly SettlementDestination[];
  readonly losses: readonly SettlementLoss[];
}

export type SettleExpeditionResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: 'not_found' | 'not_running' };

const FINAL_STATE: Readonly<Record<SettlementManifest['outcome'], string>> = {
  extracted: 'extracted',
  destroyed: 'destroyed',
  timeout: 'timeout',
};

/**
 * Persists one extraction (docs/06-DADOS-E-ECONOMIA.md, V03.07): grants the new loot,
 * destroys what personal gear was lost, releases every reservation, records each
 * member's final state and ends the expedition — all in one transaction. Settling the
 * same expedition again with the same manifest hash changes nothing and returns the
 * same result; a different hash for an already settled expedition is a bug and throws
 * instead of silently applying it or silently keeping the old one.
 */
export async function settleExpedition(
  db: Database,
  manifest: SettlementManifest,
  manifestHash: string,
): Promise<SettleExpeditionResult> {
  return db.transaction(async (tx) => {
    const members = await tx
      .select({ accountId: expeditionMembers.accountId })
      .from(expeditionMembers)
      .where(eq(expeditionMembers.expeditionId, manifest.expeditionId));
    if (members.length === 0) return { ok: false, reason: 'not_found' };
    // Same lock order as every other inventory change: accounts, then the expedition.
    await lockAccounts(tx, members.map((member) => member.accountId).sort());

    const rows = await tx.execute<{ state: string }>(
      sql`SELECT ${expeditions.state} AS state FROM ${expeditions}
          WHERE ${expeditions.id} = ${manifest.expeditionId} FOR UPDATE`,
    );
    const state = rows.rows[0]?.state;
    if (state === undefined) return { ok: false, reason: 'not_found' };

    const [already] = await tx
      .select({ manifestHash: settlements.manifestHash })
      .from(settlements)
      .where(eq(settlements.expeditionId, manifest.expeditionId));
    if (already) {
      if (already.manifestHash !== manifestHash) {
        throw new Error(
          `Manifesto conflitante para a expedição já liquidada: ${manifest.expeditionId}`,
        );
      }
      return { ok: true };
    }
    if (!(['ACTIVE', 'EXTRACTING'] as readonly string[]).includes(state)) {
      return { ok: false, reason: 'not_running' };
    }

    // Releasing every reservation first lets lost personal gear be deleted next: the
    // reservation's restrict foreign key would otherwise forbid it.
    await tx
      .delete(itemReservations)
      .where(eq(itemReservations.expeditionId, manifest.expeditionId));

    const lostInstanceIds = manifest.losses
      .filter((loss) => loss.origin === 'loadout' && loss.accountId !== null)
      .map((loss) => loss.sourceId);
    if (lostInstanceIds.length > 0) {
      await tx.delete(itemInstances).where(inArray(itemInstances.id, lostInstanceIds));
    }

    for (const destination of manifest.destinations) {
      // Personal gear kept by its own owner is already the real stash item: nothing to
      // grant, only its reservation (already released above) stood in the way.
      if (destination.origin === 'loadout') continue;
      await grantAsExecutor(tx, {
        accountId: destination.accountId,
        itemId: destination.itemId,
        quantity: destination.quantity,
        origin: `expedition:${manifest.expeditionId}`,
        reason: 'expedition_loot',
      });
    }

    await tx
      .delete(activeParticipations)
      .where(eq(activeParticipations.expeditionId, manifest.expeditionId));
    await tx
      .update(expeditionMembers)
      .set({ finalState: FINAL_STATE[manifest.outcome] })
      .where(eq(expeditionMembers.expeditionId, manifest.expeditionId));
    if (manifest.outcome === 'extracted') {
      const eligible = new Set(manifest.eligibleAccountIds);
      const notEligible = members
        .map((member) => member.accountId)
        .filter((accountId) => !eligible.has(accountId));
      if (notEligible.length > 0) {
        await tx
          .update(expeditionMembers)
          .set({ finalState: 'not_eligible' })
          .where(
            and(
              eq(expeditionMembers.expeditionId, manifest.expeditionId),
              inArray(expeditionMembers.accountId, notEligible),
            ),
          );
      }
    }

    const endState: ExpeditionState = manifest.outcome === 'extracted' ? 'CLOSED' : 'FAILED';
    await tx
      .update(expeditions)
      .set({ state: endState, endedAt: sql`now()` })
      .where(eq(expeditions.id, manifest.expeditionId));
    await tx.insert(settlements).values({
      expeditionId: manifest.expeditionId,
      outcome: manifest.outcome,
      manifest,
      manifestHash,
    });

    return { ok: true };
  });
}

/** `grantItem` opens its own transaction; called from inside one, it uses a savepoint. */
async function grantAsExecutor(
  tx: Executor,
  grant: Parameters<typeof grantItem>[1],
): Promise<void> {
  await grantItem(tx as Database, grant);
}
