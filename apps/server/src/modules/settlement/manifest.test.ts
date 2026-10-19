import { describe, expect, it } from 'vitest';
import { ItemId } from '@orbit/catalog';
import {
  type BuildManifestInput,
  type ManifestSourceItem,
  buildManifest,
  manifestHash,
} from './manifest';

const ORE = ItemId.Ore;
const PISTOL = ItemId.Pistol;

function stack(
  id: string,
  quantity: number,
  owner: string | null = null,
  origin = 'container.1',
): ManifestSourceItem {
  return { id, itemId: ORE, quantity, owner, origin };
}

function base(overrides: Partial<BuildManifestInput> = {}): BuildManifestInput {
  return {
    expeditionId: 'exp-1',
    outcome: 'extracted',
    roster: ['a', 'b', 'c', 'd'],
    eligibleAccountIds: ['a', 'b', 'c', 'd'],
    items: [],
    ...overrides,
  };
}

describe('buildManifest — personal gear', () => {
  it('returns personal gear to its eligible owner', () => {
    const manifest = buildManifest(
      base({ items: [{ id: 'p1', itemId: PISTOL, quantity: 1, owner: 'a', origin: 'loadout' }] }),
    );
    expect(manifest.destinations).toEqual([
      { sourceId: 'p1', accountId: 'a', itemId: PISTOL, quantity: 1, origin: 'loadout' },
    ]);
    expect(manifest.losses).toEqual([]);
  });

  it('loses personal gear of an owner who is not eligible, never handing it to someone else', () => {
    const manifest = buildManifest(
      base({
        eligibleAccountIds: ['b', 'c', 'd'],
        items: [{ id: 'p1', itemId: PISTOL, quantity: 1, owner: 'a', origin: 'loadout' }],
      }),
    );
    expect(manifest.destinations).toEqual([]);
    expect(manifest.losses).toEqual([
      {
        sourceId: 'p1',
        accountId: 'a',
        itemId: PISTOL,
        quantity: 1,
        origin: 'loadout',
        reason: 'not_eligible',
      },
    ]);
  });
});

describe('buildManifest — common loot split', () => {
  it('divides a stack across 1 to 4 participants, always summing to the original quantity', () => {
    for (let n = 1; n <= 4; n++) {
      const eligible = ['a', 'b', 'c', 'd'].slice(0, n);
      const manifest = buildManifest(
        base({ eligibleAccountIds: eligible, items: [stack('s1', 10)] }),
      );
      expect(manifest.losses).toEqual([]);
      expect(manifest.destinations.reduce((sum, d) => sum + d.quantity, 0)).toBe(10);
      expect(new Set(manifest.destinations.map((d) => d.accountId)).size).toBeLessThanOrEqual(n);
      for (const destination of manifest.destinations)
        expect(eligible).toContain(destination.accountId);
    }
  });

  it('gives an indivisible stack to exactly one recipient, never a copy to each', () => {
    const manifest = buildManifest(base({ items: [stack('s1', 1)] }));
    expect(manifest.destinations).toHaveLength(1);
    expect(manifest.destinations[0]?.quantity).toBe(1);
  });

  it('splits an odd quantity into integer parts that sum to the original', () => {
    const manifest = buildManifest(
      base({ eligibleAccountIds: ['a', 'b', 'c'], items: [stack('s1', 7)] }),
    );
    expect(manifest.destinations.reduce((sum, d) => sum + d.quantity, 0)).toBe(7);
    const quantities = manifest.destinations.map((d) => d.quantity).sort();
    expect(quantities).toEqual([2, 2, 3]);
  });

  it('rotates who gets the remainder across stacks, instead of always the same member', () => {
    const manifest = buildManifest(base({ items: [stack('s1', 5), stack('s2', 5)] }));
    const extra = (sourceId: string) =>
      manifest.destinations.find((d) => d.sourceId === sourceId && d.quantity === 2)?.accountId;
    expect(extra('s1')).not.toBe(extra('s2'));
  });

  it('loses common loot with nobody eligible to receive it', () => {
    const manifest = buildManifest(base({ eligibleAccountIds: [], items: [stack('s1', 3)] }));
    expect(manifest.destinations).toEqual([]);
    expect(manifest.losses).toEqual([
      {
        sourceId: 's1',
        accountId: null,
        itemId: ORE,
        quantity: 3,
        origin: 'container.1',
        reason: 'no_recipients',
      },
    ]);
  });
});

describe('buildManifest — mission failure', () => {
  for (const outcome of ['destroyed', 'timeout'] as const) {
    it(`loses every item, personal and common, on ${outcome}`, () => {
      const manifest = buildManifest(
        base({
          outcome,
          items: [
            stack('s1', 5),
            { id: 'p1', itemId: PISTOL, quantity: 1, owner: 'a', origin: 'loadout' },
          ],
        }),
      );
      expect(manifest.destinations).toEqual([]);
      expect(manifest.losses).toHaveLength(2);
      expect(manifest.losses.every((loss) => loss.reason === 'mission_failed')).toBe(true);
    });
  }
});

describe('buildManifest — determinism and retries', () => {
  it('produces the identical manifest and hash from the same input, whatever the item order', () => {
    const input = base({
      items: [
        stack('s1', 7),
        stack('s2', 4),
        { id: 'p1', itemId: PISTOL, quantity: 1, owner: 'b', origin: 'loadout' },
      ],
    });
    const again: BuildManifestInput = { ...input, items: [...input.items].reverse() };
    const first = buildManifest(input);
    const second = buildManifest(again);
    expect(second).toEqual(first);
    expect(manifestHash(second)).toBe(manifestHash(first));
  });

  it('changes the hash when the outcome differs', () => {
    const input = base({ items: [stack('s1', 3)] });
    const extracted = buildManifest(input);
    const destroyed = buildManifest({ ...input, outcome: 'destroyed' });
    expect(manifestHash(destroyed)).not.toBe(manifestHash(extracted));
  });
});

describe('buildManifest — conflicting data', () => {
  it('rejects an eligible account that is not in the roster', () => {
    expect(() => buildManifest(base({ eligibleAccountIds: ['a', 'ghost'] }))).toThrow();
  });

  it('rejects a roster with a duplicate account', () => {
    expect(() => buildManifest(base({ roster: ['a', 'a', 'b'] }))).toThrow();
  });

  it('rejects two items with the same id', () => {
    expect(() => buildManifest(base({ items: [stack('s1', 1), stack('s1', 2)] }))).toThrow();
  });

  it('rejects a non-integer or non-positive quantity', () => {
    expect(() => buildManifest(base({ items: [stack('s1', 0)] }))).toThrow();
    expect(() => buildManifest(base({ items: [stack('s1', 1.5)] }))).toThrow();
  });
});
