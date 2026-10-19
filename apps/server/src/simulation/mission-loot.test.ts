import { describe, expect, it } from 'vitest';
import { ItemId, SHIP_HULLS, type SectorDefinition, SectorId, ShipHullId } from '@orbit/catalog';
import { ErrorCode } from '@orbit/contracts';
import { MissionLoot } from './mission-loot';
import { SectorSimulation } from './sector-simulation';

const HULL = SHIP_HULLS[ShipHullId.Scout];
const HATCH = HULL.cargoHatch.position;

/** Container 1 sits alongside the spawn; container 2 is far away. */
const SECTOR: SectorDefinition = {
  id: SectorId.Open,
  bounds: { minX: -6000, minY: -6000, maxX: 6000, maxY: 6000 },
  obstacles: [],
  containers: [
    { id: 'container.1', x: 0, y: HULL.handling.radius + 36 + 100, radius: 36 },
    { id: 'container.2', x: 4000, y: 4000, radius: 36 },
  ],
  extractionZones: [{ id: 'extraction.1', x: -4000, y: 0, radius: 600 }],
  shipSpawn: { position: { x: 0, y: 0 }, angle: 0 },
};

function setUp() {
  const simulation = new SectorSimulation(SECTOR, ShipHullId.Scout);
  let next = 0;
  const loot = new MissionLoot({
    simulation,
    members: [
      {
        accountId: 'acc-a',
        nick: 'Alfa',
        loadout: [
          { slot: 'sidearm', instanceId: 'res-pistol', itemId: ItemId.Pistol, quantity: 1 },
          { slot: 'backpack.0', instanceId: 'res-medkit', itemId: ItemId.Medkit, quantity: 2 },
        ],
      },
      { accountId: 'acc-b', nick: 'Bravo', loadout: [] },
    ],
    loot: new Map([
      ['container.1', [{ itemId: ItemId.Scrap, quantity: 20 }]],
      ['container.2', [{ itemId: ItemId.Ore, quantity: 10 }]],
    ]),
    newId: () => `loot_${next++}`,
  });
  const a = simulation.addCrew('sess-a', 'Alfa');
  const b = simulation.addCrew('sess-b', 'Bravo');
  return { simulation, loot, a, b };
}

const scrapId = (loot: MissionLoot) => loot.inventory.items('container.1')[0]?.id ?? '';
const take = (item: string, quantity = 1) =>
  ({ item, from: 'container.1', to: 'backpack', quantity }) as const;

describe('MissionLoot', () => {
  it('starts with the reserved loadout and loot with temporary IDs', () => {
    const { loot } = setUp();
    const view = loot.view('acc-a', 'sess-a');
    expect(view.equipment).toEqual([
      { id: 'res-pistol', itemId: ItemId.Pistol, quantity: 1, ownerNick: 'Alfa', mine: true },
    ]);
    expect(view.backpack).toEqual({
      slots: 8,
      items: [
        { id: 'res-medkit', itemId: ItemId.Medkit, quantity: 2, ownerNick: 'Alfa', mine: true },
      ],
    });
    expect(view.cargo).toEqual({ slots: HULL.cargoSlots, items: [] });
    expect(scrapId(loot)).toMatch(/^loot_/);
  });

  it('reaches the hold and the container only from the hatch, by server positions', () => {
    const { loot, a } = setUp();
    const scrap = scrapId(loot);
    // Spawned in the middle of the ship: too far from the hatch.
    expect(loot.transfer('acc-a', 'sess-a', take(scrap))).toBe(ErrorCode.NotAtHatch);
    expect(loot.view('acc-a', 'sess-a')).toMatchObject({ atHatch: false, container: null });

    a.position = HATCH;
    expect(loot.view('acc-a', 'sess-a')).toMatchObject({
      atHatch: true,
      container: { id: 'container.1', items: [{ id: scrap, quantity: 20, ownerNick: null }] },
    });
    expect(loot.transfer('acc-a', 'sess-a', take(scrap, 5))).toBeNull();
    expect(loot.view('acc-a', 'sess-a').backpack.items.map((item) => item.quantity)).toEqual([
      2, 5,
    ]);
  });

  it('refuses a container out of reach, even by naming it', () => {
    const { loot, a, simulation } = setUp();
    a.position = HATCH;
    const ore = loot.inventory.items('container.2')[0]?.id ?? '';
    expect(
      loot.transfer('acc-a', 'sess-a', {
        item: ore,
        from: 'container.2',
        to: 'cargo',
        quantity: 1,
      }),
    ).toBe(ErrorCode.ContainerOutOfReach);
    // The ship drifts away from container 1: it is no longer in reach either.
    simulation.ship.kinematics = { ...simulation.ship.kinematics, position: { x: -2000, y: 0 } };
    expect(loot.transfer('acc-a', 'sess-a', take(scrapId(loot)))).toBe(
      ErrorCode.ContainerOutOfReach,
    );
    expect(loot.view('acc-a', 'sess-a')).toMatchObject({ atHatch: true, container: null });
  });

  it('never puts items into a container', () => {
    const { loot, a } = setUp();
    a.position = HATCH;
    expect(
      loot.transfer('acc-a', 'sess-a', {
        item: 'res-medkit',
        from: 'backpack',
        to: 'container.1',
        quantity: 2,
      }),
    ).toBe(ErrorCode.InvalidTransfer);
  });

  it('keeps the helm operator and disconnected members away from the hatch', () => {
    const { loot, simulation, a } = setUp();
    a.position = HATCH;
    simulation.setConnected('sess-a', false);
    expect(loot.transfer('acc-a', 'sess-a', take(scrapId(loot)))).toBe(ErrorCode.NotAtHatch);
    simulation.setConnected('sess-a', true);
    a.position = HULL.helm.seat;
    expect(simulation.requestHelm('sess-a')).toEqual({ ok: true });
    expect(loot.transfer('acc-a', 'sess-a', take(scrapId(loot)))).toBe(ErrorCode.NotAtHatch);
  });

  it('shows each member only their own backpack, and whose gear is in the hold', () => {
    const { loot, a, b } = setUp();
    a.position = HATCH;
    expect(
      loot.transfer('acc-a', 'sess-a', {
        item: 'res-medkit',
        from: 'backpack',
        to: 'cargo',
        quantity: 2,
      }),
    ).toBeNull();
    a.position = HATCH;
    expect(loot.transfer('acc-a', 'sess-a', take(scrapId(loot), 3))).toBeNull();

    const bravo = loot.view('acc-b', 'sess-b');
    expect(bravo.backpack.items).toEqual([]);
    expect(bravo.equipment).toEqual([]);
    expect(bravo.cargo.items).toEqual([
      { id: 'res-medkit', itemId: ItemId.Medkit, quantity: 2, ownerNick: 'Alfa', mine: false },
    ]);
    // Bravo is not at the hatch: no container contents.
    expect(bravo.container).toBeNull();
    expect(JSON.stringify(bravo)).not.toContain('res-pistol');

    // From the hatch, Bravo takes Alfa's gear out of the hold; it stays Alfa's.
    b.position = { x: HATCH.x, y: HATCH.y + 15 };
    expect(
      loot.transfer('acc-b', 'sess-b', {
        item: 'res-medkit',
        from: 'cargo',
        to: 'backpack',
        quantity: 2,
      }),
    ).toBeNull();
    expect(loot.view('acc-b', 'sess-b').backpack.items).toEqual([
      { id: 'res-medkit', itemId: ItemId.Medkit, quantity: 2, ownerNick: 'Alfa', mine: false },
    ]);
  });

  it('changes the access key when the member or the ship moves', () => {
    const { loot, a, simulation } = setUp();
    const away = loot.accessKey('sess-a');
    a.position = HATCH;
    const atHatch = loot.accessKey('sess-a');
    expect(atHatch).not.toBe(away);
    simulation.ship.kinematics = { ...simulation.ship.kinematics, position: { x: -2000, y: 0 } };
    expect(loot.accessKey('sess-a')).not.toBe(atHatch);
  });
});
