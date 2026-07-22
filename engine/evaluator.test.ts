/**
 * Phase 2 acceptance tests: hand-checked scenarios where we know what the
 * guide says the right call is. If one of these fails after a strategy edit,
 * the edit changed real advice — which is exactly what we want surfaced.
 */

import { describe, expect, it } from 'vitest';
import { createRun } from './engine';
import { activePhases, evaluateOffer, isRunnable, testCondition } from './evaluator';
import type { RunState } from './types';

/** A run mid-way through, with sensible defaults, overridable per scenario. */
function runAt(challenge: number, overrides: Partial<RunState> = {}): RunState {
  return createRun({
    challengesCompleted: challenge,
    challengesRemaining: 30,
    timeRemaining: 600,
    ...overrides,
  });
}

describe('condition evaluation', () => {
  it('resolves paths and comparators', () => {
    const s = runAt(5, { timeRemaining: 100 });
    expect(testCondition(s, { path: 'challenge', gte: 4 })).toBe(true);
    expect(testCondition(s, { path: 'timeRemaining', lt: 150 })).toBe(true);
    expect(testCondition(s, { path: 'challenge', eq: 4 })).toBe(false);
  });

  it('counts missions by role for the runnable goal', () => {
    const bare = runAt(10);
    expect(isRunnable(bare)).toBe(false);

    const equipped = runAt(10, { missions: ['hoarder', 'high_roller'] });
    expect(isRunnable(equipped)).toBe(true);
  });

  it('runnable also requires 20+ challenges remaining', () => {
    const s = runAt(10, {
      missions: ['hoarder', 'high_roller'],
      challengesRemaining: 10,
    });
    expect(isRunnable(s)).toBe(false);
  });

  it('weak generators (Jester\'s Trick, Complete Chaos) never satisfy runnable alone', () => {
    // Both carry boon_generator + pull_generator roles, but their effects are
    // random — the data marks them weak, and the goal must ignore them.
    const s = runAt(10, { missions: ['jesters_trick', 'complete_chaos'] });
    expect(isRunnable(s)).toBe(false);

    // A real generator alongside them still counts.
    const mixed = runAt(10, { missions: ['jesters_trick', 'hoarder', 'high_roller'] });
    expect(isRunnable(mixed)).toBe(true);
  });
});

describe('phase resolution', () => {
  it('opening before challenge 4', () => {
    const phases = activePhases(runAt(2));
    expect(phases[phases.length - 1]?.id).toBe('opening');
  });

  it('trial_prep wins over rainbow_window at exactly challenge 19', () => {
    const phases = activePhases(runAt(19));
    expect(phases[phases.length - 1]?.id).toBe('trial_prep');
  });

  it('fork resolves to farm when runnable, salvage when not', () => {
    const good = activePhases(runAt(35, { missions: ['hoarder', 'high_roller'] }));
    expect(good.map((p) => p.id)).toContain('farm');

    const bad = activePhases(runAt(35));
    expect(bad.map((p) => p.id)).toContain('salvage');
  });

  it('endgame outranks farm when 7 or fewer challenges remain', () => {
    const phases = activePhases(
      runAt(60, { missions: ['hoarder', 'high_roller'], challengesRemaining: 6 }),
    );
    expect(phases[phases.length - 1]?.id).toBe('endgame');
  });
});

describe('offer evaluation — hand-checked scenarios', () => {
  it('opening: orange beats blue and red', () => {
    const advice = evaluateOffer(runAt(1), [
      { color: 'blue' },
      { color: 'orange' },
      { color: 'red' },
    ]);
    expect(advice.activePhase).toBe('opening');
    expect(advice.ranked[0]?.color).toBe('orange');
    expect(advice.ranked[0]?.reasons[0]).toContain('priority #1');
  });

  it('rainbow window: rainbow on sight', () => {
    const advice = evaluateOffer(runAt(12), [
      { color: 'rainbow' },
      { color: 'orange' },
      { color: 'aqua' },
    ]);
    expect(advice.ranked[0]?.color).toBe('rainbow');
    // The hard rule's reasoning must surface, not just the rank.
    expect(advice.ranked[0]?.reasons.join(' ')).toMatch(/ramping hazard/i);
  });

  it('timeout guard: green jumps the queue when time is low', () => {
    // At challenge 12 the phase priority alone would never rank green first.
    const advice = evaluateOffer(runAt(12, { timeRemaining: 100 }), [
      { color: 'orange' },
      { color: 'green' },
      { color: 'blue' },
    ]);
    expect(advice.ranked[0]?.color).toBe('green');
    expect(advice.ranked[0]?.reasons.join(' ')).toMatch(/take-now-or-lose-it|Timeout/i);
  });

  it('chronotrigger disables the timeout guard and warns instead', () => {
    const advice = evaluateOffer(
      runAt(25, {
        timeRemaining: 100,
        trials: ['chronotrigger'],
        flags: { hubris: false, boonsDisabled: false, cannotGainTime: true },
      }),
      [{ color: 'green' }, { color: 'orange' }],
    );
    // Green gets no safety boost — orange outranks it on phase priority.
    expect(advice.ranked[0]?.color).toBe('orange');
    expect(advice.warnings.join(' ')).toMatch(/INOPERATIVE/);
  });

  it('hubris produces a persistent warning', () => {
    const advice = evaluateOffer(
      runAt(25, { flags: { hubris: true, boonsDisabled: false, cannotGainTime: false } }),
      [{ color: 'orange' }],
    );
    expect(advice.warnings.join(' ')).toMatch(/HUBRIS/i);
  });

  it('last challenge: blue and yellow are suppressed, red still works', () => {
    const advice = evaluateOffer(runAt(40, { challengesRemaining: 1 }), [
      { color: 'blue' },
      { color: 'yellow' },
      { color: 'red' },
    ]);
    expect(advice.ranked[0]?.color).toBe('red');
    const blue = advice.ranked.find((r) => r.color === 'blue');
    const yellow = advice.ranked.find((r) => r.color === 'yellow');
    expect(blue?.suppressed).toBe(true);
    expect(yellow?.suppressed).toBe(true);
  });

  it('salvage: purple leads when no combo formed by challenge 35', () => {
    const advice = evaluateOffer(runAt(35), [
      { color: 'purple' },
      { color: 'blue' },
      { color: 'yellow' },
    ]);
    expect(advice.activePhase).toBe('salvage');
    expect(advice.runnable).toBe(false);
    expect(advice.ranked[0]?.color).toBe('purple');
  });

  it('farm: rainbow leads a good run at challenge 35', () => {
    const advice = evaluateOffer(runAt(35, { missions: ['hoarder', 'high_roller'] }), [
      { color: 'rainbow' },
      { color: 'purple' },
    ]);
    expect(advice.activePhase).toBe('farm');
    expect(advice.runnable).toBe(true);
    expect(advice.ranked[0]?.color).toBe('rainbow');
  });

  it('endgame: red beats white with 6 challenges left', () => {
    const advice = evaluateOffer(runAt(60, { challengesRemaining: 6 }), [
      { color: 'white' },
      { color: 'red' },
    ]);
    expect(advice.activePhase).toBe('endgame');
    expect(advice.ranked[0]?.color).toBe('red');
  });

  it('every ranked option carries at least one reason', () => {
    const advice = evaluateOffer(runAt(12), [
      { color: 'blue' },
      { color: 'crimson' },
      { color: 'darkGrey' },
    ]);
    for (const r of advice.ranked) {
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });
});
