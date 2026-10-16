import { APPEARANCE_COLORS, APPEARANCE_COLOR_ORDER } from '@orbit/catalog';

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
  container: 0xb07a3a,
  containerEdge: 0xffd08a,
  extraction: 0x4caf7a,
  extractionEdge: 0x8de8b0,
  minimap: 0x0a1120,
} as const;

const CREW_COLORS: readonly number[] = APPEARANCE_COLOR_ORDER.map(
  (id) => APPEARANCE_COLORS[id].hex,
);
const FIRST_CREW_COLOR =
  APPEARANCE_COLORS[APPEARANCE_COLOR_ORDER[0] ?? 'appearance.color.cyan'].hex;

/** Never white: white outlines mark the local player. */
export function crewColor(index: number): number {
  if (!Number.isInteger(index) || index < 0) return FIRST_CREW_COLOR;
  return CREW_COLORS[index % CREW_COLORS.length] ?? FIRST_CREW_COLOR;
}
