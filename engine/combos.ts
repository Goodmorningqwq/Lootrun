/**
 * Combos — the community-editable playbook.
 *
 * A combo is one opinion about which missions belong together and what beacons
 * that pairing wants. Combos used to live in `data/archetypes.json` alongside
 * game facts, which made them unreachable from the editor; they now live in the
 * strategy, so forking the playbook is a normal edit.
 *
 * WHY ORDERED LISTS AND NOT NUMBERS. Beacon preference is expressed as two
 * ordered lists, `wants` and `avoids`, rather than signed integers.
 *
 *   - The engine already works this way. Phase priority is a drag-ordered list
 *     turned into points by one line (`(priority.length - idx) * 10`); numeric
 *     bias was the inconsistent outlier.
 *   - Nobody used the numeric range. Across the 25 authored bias objects the
 *     maximum entry count was TWO, drawn from 11 distinct values, all multiples
 *     of five.
 *   - Numbers invite an arms race. `composeBeaconBias` takes the strongest
 *     advocate, so under numeric bias a tie goes to whoever typed the bigger
 *     number — which, with many authors, trends toward everyone writing 99.
 *     With ordering, ties break on `completeness`, so the combo you are further
 *     into wins. That is a property of the run, not of the author.
 *
 * WHY THE LADDER IS FIXED AND NOT LENGTH-SCALED. Reusing the phase formula
 * would mean adding a fourth `want` silently re-weighted the three above it.
 * Fixed rungs make an edit local: appending never disturbs what is already
 * there. That matters when the people editing are lootrun experts rather than
 * programmers.
 */

import archetypesJson from '../data/archetypes.json';
import type { BeaconColor } from './types';

export interface Combo {
  id: string;
  name: string;
  /** Hold ANY of these and the combo commits. Completeness = held / core. */
  core: string[];
  /** Independent entry points, when a combo has more than one (combo 1). */
  cores?: string[][];
  enablers?: string[];
  followups?: string[][];
  conflicts?: string[];
  /** Ordered, best first. Rank 1 pulls hardest. */
  wants: BeaconColor[];
  /** Ordered, worst first. Rank 1 pushes away hardest. */
  avoids: BeaconColor[];
  trialPreference?: string[];
  notes?: string;
  /** Expert prose the engine does not read. Preserved, never executed. */
  meta?: Record<string, unknown>;
}

/**
 * Rung values. Deliberately coarse — the authored data only ever distinguished
 * about three levels, and coarse rungs are what make the lists readable.
 * Ranks past the end clamp to the last rung rather than decaying to zero, so a
 * long list still expresses a real preference.
 */
export const LADDER = {
  wants: [30, 20, 10],
  avoids: [-20, -15, -10],
} as const;

export function ladderValue(kind: 'wants' | 'avoids', rank: number): number {
  const rungs = LADDER[kind];
  return rungs[Math.min(rank, rungs.length - 1)] ?? 0;
}

/**
 * Collapse the two ordered lists into the numeric map the scorer consumes.
 * Memoised per combo object: `composeBeaconBias` runs for every beacon of every
 * offer, and combo objects are stable between edits.
 */
const biasCache = new WeakMap<Combo, Partial<Record<BeaconColor, number>>>();

export function resolvedBias(combo: Combo): Partial<Record<BeaconColor, number>> {
  const hit = biasCache.get(combo);
  if (hit) return hit;

  const out: Partial<Record<BeaconColor, number>> = {};
  (combo.wants ?? []).forEach((c, i) => {
    out[c] = ladderValue('wants', i);
  });
  (combo.avoids ?? []).forEach((c, i) => {
    // A colour in both lists is rejected by validateStrategy; if one slips
    // through, the avoid wins — refusing to recommend is the safer failure.
    out[c] = ladderValue('avoids', i);
  });

  biasCache.set(combo, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Migration from the legacy numeric shape                             */
/* ------------------------------------------------------------------ */

interface LegacyArchetype {
  id: string;
  name: string;
  core?: string[];
  beaconBias?: Partial<Record<BeaconColor, number>>;
  [k: string]: unknown;
}

/** Fields the engine reads. Everything else is prose and moves to `meta`. */
const LIVE_FIELDS = new Set([
  'id', 'name', 'core', 'cores', 'enablers', 'followups',
  'conflicts', 'wants', 'avoids', 'trialPreference', 'notes',
]);

/**
 * Convert one legacy archetype (numeric `beaconBias`) into a Combo.
 *
 * Ordering is taken straight from the numbers: positives descending become
 * `wants`, negatives ascending become `avoids`. The absolute values change —
 * that is the point — but the RANKING each combo expresses is preserved
 * exactly, which is the invariant the migration test asserts.
 */
export function comboFromArchetype(a: LegacyArchetype): Combo {
  const bias = Object.entries(a.beaconBias ?? {}) as [BeaconColor, number][];
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) {
    if (!LIVE_FIELDS.has(k) && k !== 'beaconBias') meta[k] = v;
  }

  return {
    id: a.id,
    name: a.name,
    core: a.core ?? [],
    ...(a.cores ? { cores: a.cores as string[][] } : {}),
    ...(a.enablers ? { enablers: a.enablers as string[] } : {}),
    ...(a.followups ? { followups: a.followups as string[][] } : {}),
    ...(a.conflicts ? { conflicts: a.conflicts as string[] } : {}),
    wants: bias.filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).map(([c]) => c),
    avoids: bias.filter(([, v]) => v < 0).sort((x, y) => x[1] - y[1]).map(([c]) => c),
    ...(a.trialPreference ? { trialPreference: a.trialPreference as string[] } : {}),
    ...(a.notes ? { notes: a.notes as string } : {}),
    ...(Object.keys(meta).length ? { meta } : {}),
  };
}

/**
 * The playbook shipped in `data/archetypes.json`, as combos.
 *
 * Kept as a fallback so a strategy authored before combos existed — an old
 * export, or a stale persisted copy — still scores instead of losing its whole
 * playbook.
 */
export const DEFAULT_COMBOS: Combo[] = (
  archetypesJson as unknown as { archetypes: LegacyArchetype[] }
).archetypes.map(comboFromArchetype);
