import { APPEARANCE_COLORS } from '@orbit/catalog';

/** Flat colors for the geometric art. Crew colors are paired with name labels so color is never the only cue. */
export const PALETTE = {
  space: 0x05070d,
  star: 0xcfd8e6,
  sectorEdge: 0x24314a,
  asteroid: 0x5d6470,
  asteroidEdge: 0x8a93a3,
  hull: 0x2c3a52,
  hullEdge: 0x7f95b8,
  floor: 0x16202f,
  wall: 0x46566f,
  console: 0xffc857,
  consoleBusy: 0xff6b6b,
  seat: 0xffc857,
  self: 0xffffff,
} as const;

const CREW_COLORS: readonly number[] = Object.values(APPEARANCE_COLORS).map((color) => color.hex);

export function crewColor(index: number): number {
  return CREW_COLORS[index % CREW_COLORS.length] ?? PALETTE.self;
}
