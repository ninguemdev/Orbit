/**
 * Stat modifiers from classes, equipment and effects. Additive modifiers are summed
 * first, then multiplicative ones are applied, and the result is clamped to the
 * stat's caps so stacked bonuses cannot exceed what the catalog allows.
 */
export type ModifierKind = 'add' | 'multiply';

export interface StatModifier {
  readonly stat: string;
  readonly kind: ModifierKind;
  readonly value: number;
  /** Who granted the modifier, e.g. `class.pilot` or `item.boots`. */
  readonly source: string;
}

export interface StatCaps {
  readonly min: number;
  readonly max: number;
}

export function applyModifiers(
  base: number,
  stat: string,
  modifiers: readonly StatModifier[],
  caps: StatCaps,
): number {
  if (!Number.isFinite(base)) throw new RangeError(`Base inválida para ${stat}`);
  let added = 0;
  let multiplier = 1;
  for (const modifier of modifiers) {
    if (modifier.stat !== stat) continue;
    if (!Number.isFinite(modifier.value)) {
      throw new RangeError(`Modificador inválido de ${modifier.source} para ${stat}`);
    }
    if (modifier.kind === 'add') added += modifier.value;
    else multiplier *= modifier.value;
  }
  const value = (base + added) * multiplier;
  return Math.min(caps.max, Math.max(caps.min, value));
}
