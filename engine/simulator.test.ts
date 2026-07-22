import { describe, expect, it } from 'vitest';
import { createRun } from './engine';
import { makeRng, sampleOffer } from './offerModel';
import { DEFAULT_SIM, forecastOffer, rollout } from './simulator';
import { beaconChoices, legalColors } from './engine';
import type { RunState } from './types';

const at = (challenge: number, o: Partial<RunState> = {}) =>
  createRun({ challengesCompleted: challenge, challengesRemaining: 30, ...o });

describe('offer model', () => {
  it('is deterministic for a given seed', () => {
    const a = sampleOffer(at(5), makeRng(42));
    const b = sampleOffer(at(5), makeRng(42));
    expect(a).toEqual(b);
  });

  it('offers exactly beaconChoices distinct legal colours', () => {
    const s = at(15);
    const offer = sampleOffer(s, makeRng(7));
    expect(offer).toHaveLength(beaconChoices(s));
    expect(new Set(offer.map((o) => o.color)).size).toBe(offer.length);
    for (const o of offer) expect(legalColors(s)).toContain(o.color);
  });

  it('never offers a locked beacon', () => {
    // Rainbow needs 10 challenges; crimson needs 20.
    for (let seed = 0; seed < 60; seed++) {
      const offer = sampleOffer(at(3), makeRng(seed));
      const colors = offer.map((o) => o.color);
      expect(colors).not.toContain('rainbow');
      expect(colors).not.toContain('crimson');
    }
  });

  it('respects offer exclusion — a shown green cannot reappear', () => {
    const s = { ...at(15), excludedNext: ['green' as const] };
    for (let seed = 0; seed < 40; seed++) {
      expect(sampleOffer(s, makeRng(seed)).map((o) => o.color)).not.toContain('green');
    }
  });

  it('rainbow gets likelier the longer it has been absent', () => {
    const rate = (challenge: number) => {
      let hits = 0;
      for (let seed = 0; seed < 400; seed++) {
        if (sampleOffer(at(challenge), makeRng(seed)).some((o) => o.color === 'rainbow')) {
          hits++;
        }
      }
      return hits / 400;
    };
    // Ramping hazard: rarer just after unlock than 30 challenges later.
    expect(rate(11)).toBeLessThan(rate(40));
  });

  it('grants vibrancy to everything while a rainbow is active', () => {
    const s = { ...at(15), rainbowChallengesLeft: 10 };
    const offer = sampleOffer(s, makeRng(3));
    expect(offer.every((o) => o.vibrant)).toBe(true);
  });

  it('never grants vibrancy below Assistant III', () => {
    const s = at(15, { rank: 'assistant_2' });
    for (let seed = 0; seed < 40; seed++) {
      expect(sampleOffer(s, makeRng(seed)).some((o) => o.vibrant)).toBe(false);
    }
  });
});

describe('rollout', () => {
  it('terminates and reports how the run ended', () => {
    const out = rollout(at(5), makeRng(1));
    expect(['challenges', 'timeout', 'steps']).toContain(out.endedBy);
    expect(out.challengesCompleted).toBeGreaterThanOrEqual(5);
  });

  it('ends by timeout when challenges cost more time than they grant', () => {
    // +150s granted per challenge; 400s spent is a guaranteed net drain.
    const out = rollout(at(5), makeRng(1), { ...DEFAULT_SIM, secondsPerChallenge: 400 });
    expect(out.endedBy).toBe('timeout');
  });

  it('runs out of challenges when time is plentiful', () => {
    const out = rollout(at(5, { challengesRemaining: 8 }), makeRng(1), {
      ...DEFAULT_SIM,
      secondsPerChallenge: 10,
      maxSteps: 300,
    });
    expect(out.endedBy).toBe('challenges');
  });

  it('acquires missions along the way, reaching a runnable state', () => {
    // Over a long run the greedy policy should assemble the required roles.
    let reached = 0;
    for (let seed = 0; seed < 20; seed++) {
      if (rollout(at(4, { challengesRemaining: 40 }), makeRng(seed)).reachedRunnable) {
        reached++;
      }
    }
    expect(reached).toBeGreaterThan(0);
  });

  it('is reproducible from a seed', () => {
    const a = rollout(at(5), makeRng(99));
    const b = rollout(at(5), makeRng(99));
    expect(a).toEqual(b);
  });
});

describe('forecastOffer', () => {
  const fast = { ...DEFAULT_SIM, runs: 40 };

  /**
   * Regression: callers pass a partial config (the UI sends only
   * secondsPerChallenge). Before merging against defaults, `runs` arrived
   * undefined, every rollout loop exited on the first check, and the forecast
   * came back empty with no error at all.
   */
  it('merges a partial config against defaults instead of running zero rollouts', () => {
    const f = forecastOffer(at(12), [{ color: 'blue' }], { secondsPerChallenge: 90 });
    expect(f.actions).toHaveLength(1);
    expect(f.actions[0]!.runs).toBe(DEFAULT_SIM.runs);
  });

  it('uses defaults when given no config at all', () => {
    const f = forecastOffer(at(12), [{ color: 'blue' }]);
    expect(f.actions[0]!.runs).toBe(DEFAULT_SIM.runs);
  });

  it('produces one forecast per offered beacon', () => {
    const f = forecastOffer(at(12), [{ color: 'rainbow' }, { color: 'blue' }], fast);
    expect(f.actions).toHaveLength(2);
    expect(f.actions.map((a) => a.color).sort()).toEqual(['blue', 'rainbow']);
  });

  it('reports probabilities in range and a best action', () => {
    const f = forecastOffer(at(12), [{ color: 'orange' }, { color: 'blue' }], fast);
    for (const a of f.actions) {
      expect(a.pRunnable).toBeGreaterThanOrEqual(0);
      expect(a.pRunnable).toBeLessThanOrEqual(1);
      expect(a.pTimeout).toBeGreaterThanOrEqual(0);
      expect(a.pTimeout).toBeLessThanOrEqual(1);
      expect(a.runs).toBe(fast.runs);
    }
    expect(f.best).not.toBeNull();
  });

  /**
   * The headline claim: white adds challenges, so with the run about to end on
   * challenges it should beat a blue on expected challenges completed.
   */
  it('values White over Blue when challenges are the binding constraint', () => {
    const s = at(12, { challengesRemaining: 3 });
    const f = forecastOffer(s, [{ color: 'white' }, { color: 'blue' }], fast);
    const white = f.actions.find((a) => a.color === 'white');
    const blue = f.actions.find((a) => a.color === 'blue');
    expect(white!.meanChallenges).toBeGreaterThan(blue!.meanChallenges);
  });

  /** Green buys time, so it should cut timeout risk on a short clock. */
  it('values Green over Blue when the timer is the binding constraint', () => {
    const s = at(12, { timeRemaining: 200, challengesRemaining: 40 });
    const cfg = { ...fast, secondsPerChallenge: 200 };
    const f = forecastOffer(s, [{ color: 'green' }, { color: 'blue' }], cfg);
    const green = f.actions.find((a) => a.color === 'green');
    const blue = f.actions.find((a) => a.color === 'blue');
    expect(green!.pTimeout).toBeLessThanOrEqual(blue!.pTimeout);
  });

  it('is deterministic for a given seed', () => {
    const offer = [{ color: 'orange' as const }, { color: 'red' as const }];
    expect(forecastOffer(at(12), offer, fast, 5)).toEqual(
      forecastOffer(at(12), offer, fast, 5),
    );
  });

  it('skips actions the engine would reject', () => {
    // Rainbow is locked before challenge 10.
    const f = forecastOffer(at(3), [{ color: 'rainbow' }, { color: 'blue' }], fast);
    expect(f.actions.map((a) => a.color)).toEqual(['blue']);
  });
});
