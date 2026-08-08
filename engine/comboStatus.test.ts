import { describe, expect, it } from 'vitest';
import { comboStatuses, leadingCombo } from './comboStatus';
import { createRun } from './engine';
import type { RunState } from './types';

const run = (ids: string[], o: Partial<RunState> = {}) =>
  createRun({
    challengesCompleted: 12,
    missions: ids.map((id) => ({ id, fulfilled: true })),
    ...o,
  });

const statusOf = (state: RunState, id: string) =>
  comboStatuses(state).find((s) => s.combo.id === id)!;

describe('combo reachability', () => {
  it('an untouched combo is not the same as a dead one', () => {
    // Holding nothing, everything is still possible — the distinction matters
    // because "dead" should mean STOP steering toward this.
    const s = statusOf(run([]), 'curse_stack');
    expect(s.state).toBe('untouched');
    expect(s.held).toEqual([]);
  });

  it('goes alive once a core mission is held', () => {
    // Ostinato is one of combo 1's four pool missions.
    const s = statusOf(run(['ostinato']), 'flying_chest');
    expect(s.state).toBe('alive');
    expect(s.held).toEqual(['ostinato']);
    expect(s.missing).toContain('hoarder');
  });

  it('is complete when every core mission is held', () => {
    // Combo 3 is a single core mission, so one pick finishes it. Combo 1's
    // four-mission pool can never be 'complete' this way — only three slots
    // exist — which is why running out of slots counts as complete instead.
    const s = statusOf(run(['porphyrophobia']), 'curse_stack');
    expect(s.state).toBe('complete');
    expect(s.missing).toEqual([]);
    expect(s.completeness).toBe(1);
  });

  it('dies when the slots run out and none of it is held', () => {
    // The case the advisor could not previously see: three unrelated missions
    // held, so this plan can never be entered.
    const full = run(['high_roller', 'redemption', 'gourmand']);
    const s = statusOf(full, 'curse_stack');
    expect(s.slotsLeft).toBe(0);
    expect(s.state).toBe('dead');
    expect(s.why).toMatch(/unreachable/i);
  });

  it('is final rather than dead when slots run out mid-build', () => {
    // Partially built and out of slots is not a failure — it is just finished.
    const s = statusOf(run(['ostinato', 'high_roller', 'redemption']), 'flying_chest');
    expect(s.state).toBe('complete');
    expect(s.why).toMatch(/final at 1 of 4/);
  });

  it('reports completeness as the fraction that scales beacon bias', () => {
    // Must agree with composeBeaconBias, which scales by hits / core.length.
    const s = statusOf(run(['ostinato']), 'flying_chest');
    expect(s.completeness).toBe(0.25);
  });

  it('never reports on fallback combos', () => {
    // Salvage is what you fall back TO; calling it "alive" would be noise.
    const ids = comboStatuses(run([])).map((s) => s.combo.id);
    expect(ids).not.toContain('sac_stack');
    expect(ids).not.toContain('universal');
  });
});

describe('which plan the run is actually on', () => {
  it('picks the combo furthest along', () => {
    // Both hold one core mission, so completeness breaks the tie: combo 3 is
    // fully built off Porphyrophobia alone, combo 1 is a quarter built.
    const lead = leadingCombo(run(['ostinato', 'porphyrophobia']));
    expect(lead?.combo.id).toBe('curse_stack');
    expect(lead?.completeness).toBe(1);
  });

  it('is null when nothing has been started', () => {
    expect(leadingCombo(run([]))).toBeNull();
  });

  it('ignores a combo that is dead even if it was once led', () => {
    const lead = leadingCombo(run(['high_roller', 'redemption', 'gourmand']));
    expect(lead).toBeNull();
  });
});
