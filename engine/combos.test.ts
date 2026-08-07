/**
 * The combo model, and the gate on the numbers → ordering migration.
 *
 * Absolute bias values change under the ladder — that is the point. What must
 * NOT change is the ranking each combo expresses, because the ranking is the
 * opinion. These tests pin the ranking and leave the rungs free to be tuned.
 */

import { describe, expect, it } from 'vitest';
import archetypesJson from '../data/archetypes.json';
import {
  DEFAULT_COMBOS,
  LADDER,
  comboFromArchetype,
  ladderValue,
  resolvedBias,
  type Combo,
} from './combos';
import { DEFAULT_STRATEGY, MISSIONS, activeCombos, setStrategy, validateStrategy } from './evaluator';
import type { BeaconColor } from './types';

interface Legacy {
  id: string;
  name: string;
  beaconBias?: Partial<Record<BeaconColor, number>>;
  [k: string]: unknown;
}
const LEGACY = (archetypesJson as unknown as { archetypes: Legacy[] }).archetypes;

/** Colours ordered by bias value, strongest advocate first. */
const rank = (bias: Partial<Record<BeaconColor, number>>) =>
  (Object.entries(bias) as [BeaconColor, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);

describe('the migration preserves every combo opinion', () => {
  it('ranks beacons in exactly the order the numbers did', () => {
    // The acceptance gate. If a conversion reordered a combo's preferences,
    // the strategy would say something its author never said.
    for (const legacy of LEGACY) {
      if (!legacy.beaconBias) continue;
      const combo = comboFromArchetype(legacy);
      expect(rank(resolvedBias(combo)), legacy.name).toEqual(rank(legacy.beaconBias));
    }
  });

  it('keeps the sign of every opinion', () => {
    // A want must never become an avoid, which reordering alone could hide.
    for (const legacy of LEGACY) {
      if (!legacy.beaconBias) continue;
      const resolved = resolvedBias(comboFromArchetype(legacy));
      for (const [color, was] of Object.entries(legacy.beaconBias) as [BeaconColor, number][]) {
        expect(Math.sign(resolved[color] ?? 0), `${legacy.name} ${color}`).toBe(Math.sign(was));
      }
    }
  });

  it('converted every shipped combo, losing none', () => {
    expect(DEFAULT_COMBOS).toHaveLength(LEGACY.length);
    expect(DEFAULT_COMBOS.map((c) => c.id)).toEqual(LEGACY.map((a) => a.id));
  });

  it('preserves expert prose under meta instead of deleting it', () => {
    // The source doc's reasoning is the reason to trust the strategy; the
    // engine ignoring a field is not a reason to throw it away.
    const purple = DEFAULT_COMBOS.find((c) => c.id === 'curse_stack')!;
    expect(purple.meta).toBeDefined();
    expect(purple.meta).toHaveProperty('sequencing');
    expect(purple.meta).not.toHaveProperty('core');
  });

  it('the seeded copy in the strategy matches the source in data/', () => {
    // default.json carries combos so an export is self-contained, which means
    // two copies exist. This is the guard that keeps them the same copy.
    expect(DEFAULT_STRATEGY.combos).toEqual(DEFAULT_COMBOS);
  });

  it('every core mission still resolves to a real mission', () => {
    for (const c of DEFAULT_COMBOS) {
      for (const m of c.core) expect(MISSIONS[m], `${c.name} → ${m}`).toBeDefined();
    }
  });
});

describe('the ladder', () => {
  it('is fixed, so appending never re-weights what is above it', () => {
    // The reason this is not the phase formula: with (length - idx) * 10 a
    // fourth want would silently change the value of the first three.
    const short: Combo = { id: 'a', name: 'a', core: [], wants: ['blue'], avoids: [] };
    const long: Combo = {
      id: 'b', name: 'b', core: [],
      wants: ['blue', 'purple', 'red', 'green'], avoids: [],
    };
    expect(resolvedBias(short).blue).toBe(resolvedBias(long).blue);
  });

  it('clamps past the end rather than decaying to nothing', () => {
    const last = LADDER.wants[LADDER.wants.length - 1];
    expect(ladderValue('wants', 99)).toBe(last);
    expect(ladderValue('wants', 99)).toBeGreaterThan(0);
  });

  it('ranks wants descending and avoids ascending', () => {
    expect(ladderValue('wants', 0)).toBeGreaterThan(ladderValue('wants', 1));
    expect(ladderValue('avoids', 0)).toBeLessThan(ladderValue('avoids', 1));
    expect(ladderValue('avoids', 0)).toBeLessThan(0);
  });
});

describe('validation catches what a non-programmer will actually type', () => {
  const withCombos = (combos: unknown) => ({ ...DEFAULT_STRATEGY, combos });

  it('accepts the shipped playbook', () => {
    expect(validateStrategy(withCombos(DEFAULT_COMBOS)).ok).toBe(true);
  });

  it('rejects a beacon colour that does not exist', () => {
    const r = validateStrategy(
      withCombos([{ id: 'x', name: 'Mine', core: ['ostinato'], wants: ['purpl'], avoids: [] }]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/purpl.*not a valid beacon/);
  });

  it('rejects a mission that does not exist', () => {
    const r = validateStrategy(
      withCombos([{ id: 'x', name: 'Mine', core: ['ostinado'], wants: [], avoids: [] }]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ostinado.*not a known mission/);
  });

  it('rejects a beacon listed as both wanted and avoided', () => {
    const r = validateStrategy(
      withCombos([
        { id: 'x', name: 'Mine', core: ['ostinato'], wants: ['blue'], avoids: ['blue'] },
      ]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/both wants and avoids/);
  });

  it('rejects duplicate combo ids', () => {
    const one = { id: 'x', name: 'Mine', core: ['ostinato'], wants: [], avoids: [] };
    const r = validateStrategy(withCombos([one, { ...one, name: 'Other' }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/duplicate combo id/);
  });

  it('names the offending combo so the author can find it', () => {
    const r = validateStrategy(
      withCombos([{ id: 'x', name: 'My purple rush', core: ['nope'], wants: [], avoids: [] }]),
    );
    if (!r.ok) expect(r.error).toContain('My purple rush');
  });
});

describe('a strategy without combos still scores', () => {
  it('falls back to the shipped playbook rather than losing it', () => {
    // Old exports and stale persisted copies predate the move out of data/.
    const legacyShape = { ...DEFAULT_STRATEGY };
    delete (legacyShape as { combos?: unknown }).combos;
    setStrategy(legacyShape);

    expect(activeCombos().length).toBe(DEFAULT_COMBOS.length);

    setStrategy(DEFAULT_STRATEGY);
  });
});
