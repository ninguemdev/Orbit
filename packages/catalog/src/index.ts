import type { Circle, Rect, ShipHandling, Vec2 } from '@orbit/simulation';

/**
 * Versioned game definitions. IDs are stable: never reuse an ID for a different
 * meaning; bump CATALOG_VERSION when definitions change.
 */
export const CATALOG_VERSION = 3;

export const ClassId = {
  Pilot: 'class.pilot',
  Engineer: 'class.engineer',
  Medic: 'class.medic',
  Officer: 'class.officer',
} as const;
export type ClassId = (typeof ClassId)[keyof typeof ClassId];

export const CLASS_NAMES: Readonly<Record<ClassId, string>> = {
  [ClassId.Pilot]: 'Piloto',
  [ClassId.Engineer]: 'Engenheiro',
  [ClassId.Medic]: 'Médico',
  [ClassId.Officer]: 'Oficial',
};

export interface ClassDescription {
  /** What the class does in the crew, as designed (docs/03-CLASSES.md). */
  readonly role: string;
  /** Milestone where its effects start to work in game; shown so nothing is promised early. */
  readonly availableIn: string;
}

export const CLASS_DESCRIPTIONS: Readonly<Record<ClassId, ClassDescription>> = {
  [ClassId.Pilot]: {
    role: 'Melhora velocidade, aceleração e giro da nave enquanto ocupa o comando, e recarrega o boost mais rápido.',
    availableIn: '0.4',
  },
  [ClassId.Engineer]: {
    role: 'Repara casco e motor mais rápido, move-se melhor em EVA e sobrecarrega o motor por alguns segundos.',
    availableIn: '0.4',
  },
  [ClassId.Medic]: {
    role: 'Cultiva ingredientes na horta da nave, fabrica seringas e aplica tratamentos mais rápido.',
    availableIn: '0.6',
  },
  [ClassId.Officer]: {
    role: 'Tem mais vida e stamina, recarrega e causa mais dano com armas pessoais, usa armas longas e melhora a arma da nave sob seu comando (mais dano, menos calor).',
    availableIn: '0.6 e 0.7',
  },
};

/** Display order of the classes. */
export const CLASS_ORDER: readonly ClassId[] = [
  ClassId.Pilot,
  ClassId.Engineer,
  ClassId.Medic,
  ClassId.Officer,
];

export function isClassId(value: string): value is ClassId {
  return Object.hasOwn(CLASS_NAMES, value);
}

/** Player appearance options. Profiles store these IDs; the server rejects anything else. */
export const AppearanceColorId = {
  Cyan: 'appearance.color.cyan',
  Amber: 'appearance.color.amber',
  Green: 'appearance.color.green',
  Pink: 'appearance.color.pink',
} as const;
export type AppearanceColorId = (typeof AppearanceColorId)[keyof typeof AppearanceColorId];

export const APPEARANCE_COLORS: Readonly<Record<AppearanceColorId, { name: string; hex: number }>> =
  {
    [AppearanceColorId.Cyan]: { name: 'Ciano', hex: 0x4fc3f7 },
    [AppearanceColorId.Amber]: { name: 'Âmbar', hex: 0xffb74d },
    [AppearanceColorId.Green]: { name: 'Verde', hex: 0x81c784 },
    [AppearanceColorId.Pink]: { name: 'Rosa', hex: 0xf06292 },
  };

/** Stable order used to tint crew members in shared rooms. */
export const APPEARANCE_COLOR_ORDER: readonly AppearanceColorId[] = [
  AppearanceColorId.Cyan,
  AppearanceColorId.Amber,
  AppearanceColorId.Green,
  AppearanceColorId.Pink,
];

export const DEFAULT_APPEARANCE_COLOR: AppearanceColorId = AppearanceColorId.Cyan;

export function isAppearanceColorId(value: string): value is AppearanceColorId {
  return Object.hasOwn(APPEARANCE_COLORS, value);
}

export interface CrewDefinition {
  readonly radius: number;
  /** Walking speed inside a ship, px/s. */
  readonly walkSpeed: number;
}

export const CREW: CrewDefinition = { radius: 10, walkSpeed: 150 };

export interface ConsoleDefinition {
  readonly id: string;
  /** Where the operator stands, in ship-local coordinates. */
  readonly seat: Vec2;
  /** Maximum distance from the seat to take the console. */
  readonly interactRadius: number;
  /** Physical console; also listed in the hull's interior walls. */
  readonly body: Rect;
}

export interface ShipHullDefinition {
  readonly id: string;
  readonly name: string;
  readonly handling: ShipHandling;
  /** Exterior outline in ship-local coordinates (+x is the nose). */
  readonly outline: readonly Vec2[];
  /** Walkable interior area. */
  readonly interiorBounds: Rect;
  /** Interior obstacles: partitions, consoles and cargo. */
  readonly interiorWalls: readonly Rect[];
  readonly helm: ConsoleDefinition;
  readonly crewSpawns: readonly Vec2[];
}

export const ShipHullId = { Scout: 'ship.scout', Hauler: 'ship.hauler' } as const;
export type ShipHullId = (typeof ShipHullId)[keyof typeof ShipHullId];

const SCOUT_HELM_BODY: Rect = { minX: 136, minY: -18, maxX: 148, maxY: 18 };
const HAULER_HELM_BODY: Rect = { minX: 166, minY: -18, maxX: 178, maxY: 18 };

export const SHIP_HULLS: Readonly<Record<ShipHullId, ShipHullDefinition>> = {
  [ShipHullId.Scout]: {
    id: ShipHullId.Scout,
    name: 'Batedora',
    handling: {
      maxSpeed: 260,
      thrustAcceleration: 140,
      reverseAcceleration: 90,
      turnRate: 1.6,
      linearDamping: 0.25,
      radius: 216,
    },
    outline: [
      { x: 215, y: 0 },
      { x: 152, y: -95 },
      { x: -170, y: -95 },
      { x: -190, y: -60 },
      { x: -190, y: 60 },
      { x: -170, y: 95 },
      { x: 152, y: 95 },
    ],
    interiorBounds: { minX: -150, minY: -80, maxX: 150, maxY: 80 },
    interiorWalls: [
      // Bridge partition with a central doorway.
      { minX: 70, minY: -80, maxX: 76, maxY: -32 },
      { minX: 70, minY: 32, maxX: 76, maxY: 80 },
      SCOUT_HELM_BODY,
      // Cargo crates.
      { minX: -140, minY: -70, maxX: -108, maxY: -42 },
      { minX: -140, minY: 42, maxX: -108, maxY: 70 },
    ],
    helm: { id: 'console.helm', seat: { x: 120, y: 0 }, interactRadius: 34, body: SCOUT_HELM_BODY },
    crewSpawns: [
      { x: -40, y: -30 },
      { x: -40, y: 30 },
      { x: 10, y: -30 },
      { x: 10, y: 30 },
    ],
  },
  // Larger and slower, with more room for cargo. Usable in missions from 0.3.
  [ShipHullId.Hauler]: {
    id: ShipHullId.Hauler,
    name: 'Cargueira',
    handling: {
      maxSpeed: 200,
      thrustAcceleration: 100,
      reverseAcceleration: 70,
      turnRate: 1.1,
      linearDamping: 0.25,
      radius: 252,
    },
    outline: [
      { x: 250, y: 0 },
      { x: 180, y: -115 },
      { x: -200, y: -115 },
      { x: -220, y: -80 },
      { x: -220, y: 80 },
      { x: -200, y: 115 },
      { x: 180, y: 115 },
    ],
    interiorBounds: { minX: -180, minY: -100, maxX: 180, maxY: 100 },
    interiorWalls: [
      { minX: 100, minY: -100, maxX: 106, maxY: -32 },
      { minX: 100, minY: 32, maxX: 106, maxY: 100 },
      HAULER_HELM_BODY,
      { minX: -170, minY: -90, maxX: -120, maxY: -50 },
      { minX: -170, minY: 50, maxX: -120, maxY: 90 },
      { minX: -100, minY: -90, maxX: -60, maxY: -60 },
      { minX: -100, minY: 60, maxX: -60, maxY: 90 },
    ],
    helm: {
      id: 'console.helm',
      seat: { x: 150, y: 0 },
      interactRadius: 34,
      body: HAULER_HELM_BODY,
    },
    crewSpawns: [
      { x: -20, y: -30 },
      { x: -20, y: 30 },
      { x: 40, y: -30 },
      { x: 40, y: 30 },
    ],
  },
};

export function isShipHullId(value: string): value is ShipHullId {
  return Object.hasOwn(SHIP_HULLS, value);
}

export interface SectorDefinition {
  readonly id: string;
  readonly bounds: Rect;
  readonly obstacles: readonly Circle[];
  readonly shipSpawn: { readonly position: Vec2; readonly angle: number };
}

export const SectorId = { Dev: 'sector.dev' } as const;
export type SectorId = (typeof SectorId)[keyof typeof SectorId];

export const SECTORS: Readonly<Record<SectorId, SectorDefinition>> = {
  [SectorId.Dev]: {
    id: SectorId.Dev,
    bounds: { minX: -4000, minY: -4000, maxX: 4000, maxY: 4000 },
    obstacles: [
      { x: 900, y: -150, radius: 120 },
      { x: 1300, y: 520, radius: 80 },
      { x: -700, y: 820, radius: 150 },
      { x: -1200, y: -600, radius: 100 },
      { x: 400, y: -1100, radius: 60 },
      { x: 2100, y: -900, radius: 200 },
      { x: -2300, y: 300, radius: 180 },
      { x: 300, y: 1700, radius: 110 },
      { x: -400, y: -2000, radius: 140 },
      { x: 2600, y: 1800, radius: 90 },
      { x: -2700, y: -2400, radius: 220 },
      { x: 1700, y: 2900, radius: 160 },
    ],
    shipSpawn: { position: { x: 0, y: 0 }, angle: 0 },
  },
};
export * from './items';
