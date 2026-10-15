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

export const CREW_COLORS = [0x4fc3f7, 0xffb74d, 0x81c784, 0xf06292] as const;

export function crewColor(index: number): number {
  return CREW_COLORS[index % CREW_COLORS.length] ?? CREW_COLORS[0];
}
