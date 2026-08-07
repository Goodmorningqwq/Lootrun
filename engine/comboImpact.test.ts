/**
 * These tests are the reason the impact rail exists. Each one reproduces a way
 * the old editor would have let an author change nothing while believing they
 * had changed something.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { analyseCombo } from './comboImpact';
import { DEFAULT_COMBOS, type Combo } from './combos';
import { DEFAULT_STRATEGY, activeCombos, setStrategy } from './evaluator';

const combo = (over: Partial<Combo>): Combo => ({
  id: 'mine', name: 'My combo', core: ['ostinato'], wants: [], avoids: [], ...over,
});

/** Install a playbook of the shipped combos plus one under test. */
const withMine = (mine: Combo) =>
  setStrategy({ ...DEFAULT_STRATEGY, combos: [...DEFAULT_COMBOS, mine] });

afterEach(() => setStrategy(DEFAULT_STRATEGY));

describe('the silent no-op', () => {
  it('flags a want that another combo already advocates harder', () => {
    // Combo 3 wants purple at full completeness. A newcomer asking for the
    // same colour contributes nothing, because composeBeaconBias takes the
    // strongest advocate rather than summing.
    const mine = combo({ core: ['porphyrophobia'], wants: ['purple'] });
    withMine(mine);

    const r = analyseCombo(mine);
    expect(r.dominated).toContain('purple');
    expect(r.effective).not.toContain('purple');
    expect(r.inert).toBe(true);
  });

  it('does not flag a want nobody else is asking for', () => {
    const mine = combo({ core: ['ostinato'], wants: ['crimson'] });
    withMine(mine);

    const r = analyseCombo(mine);
    expect(r.effective).toContain('crimson');
    expect(r.dominated).not.toContain('crimson');
    expect(r.inert).toBe(false);
  });

  it('a combo with no opinions at all is not called inert', () => {
    // Nothing was claimed, so nothing failed to apply. Warning here would be
    // noise on every freshly created combo.
    const mine = combo({ wants: [], avoids: [] });
    withMine(mine);
    expect(analyseCombo(mine).inert).toBe(false);
  });
});

describe('the tie nobody announces', () => {
  it('reports losing a shared core mission to an earlier combo', () => {
    // committedArchetype scans in array order and keeps the first best hit.
    const mine = combo({ core: ['ostinato'] });
    withMine(mine);

    const r = analyseCombo(mine);
    const hit = r.collisions.find((c) => c.shared.includes('ostinato'));
    expect(hit).toBeDefined();
    expect(hit!.loses).toBe(true);
    expect(hit!.winner.id).not.toBe('mine');
  });

  it('reports no collision when the core is unclaimed', () => {
    const mine = combo({ core: ['gourmand'] });
    withMine(mine);
    expect(analyseCombo(mine).collisions).toEqual([]);
  });

  it('names which combo wins, so the fix is actionable', () => {
    const mine = combo({ core: ['porphyrophobia'] });
    withMine(mine);
    const hit = analyseCombo(mine).collisions[0];
    expect(hit?.winner.name).toBeTruthy();
  });
});

describe('reach and preview', () => {
  it('counts every core mission as an entry point', () => {
    // A single core hit commits the combo, so reach is the core size.
    const mine = combo({ core: ['ostinato', 'hoarder', 'porphyrophobia'] });
    withMine(mine);
    const r = analyseCombo(mine);
    expect(r.reach).toBe(3);
    expect(r.reachOf).toBe(27);
  });

  it('ignores core entries that are not real candidates', () => {
    const mine = combo({ core: ['ostinato', 'chronokinesis'] });
    withMine(mine);
    expect(analyseCombo(mine).reach).toBe(1);
  });

  it('previews the ordering a core mission produces, against the empty baseline', () => {
    const mine = combo({ core: ['ostinato'], wants: ['blue'] });
    withMine(mine);
    const r = analyseCombo(mine);
    expect(r.preview.length).toBeGreaterThan(0);
    expect(r.preview.find((p) => p.color === 'blue')!.delta).toBeGreaterThan(0);
  });
});

describe('analysis never leaves the strategy modified', () => {
  it('restores the playbook it swapped out', () => {
    // The dominated check re-scores with the combo removed. If that swap
    // leaked, the live advisor would silently lose a combo for the rest of
    // the session — worse than the bug the check exists to find.
    const mine = combo({ wants: ['blue'] });
    withMine(mine);

    const before = activeCombos().map((c) => c.id);
    expect(before).toContain('mine');

    analyseCombo(mine);

    expect(activeCombos().map((c) => c.id)).toEqual(before);
  });
});
