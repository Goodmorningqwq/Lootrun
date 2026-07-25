/**
 * Advice quality harness — opt-in via `npm run validate`.
 *
 * The unit tests prove the advisor is SELF-CONSISTENT: it applies the rules it
 * claims to apply. They cannot prove the advice is GOOD. This is the only thing
 * that can — it plays the advisor's top pick and its bottom pick out to the end
 * of the run many times and compares the outcomes.
 *
 * KNOWN CEILING — read before trusting the number. The simulator's E[pulls]
 * ignores boons and mission effects (see simulator.ts), so it is blind to most
 * of what the advisor actually optimises for: orange (beacon choices), grey
 * (missions) and aqua (boosts) convert to pulls only indirectly. This harness
 * therefore UNDERSTATES the advisor by construction. A win rate meaningfully
 * above 50% is real signal; the pull delta is NOT a meaningful effect size
 * until the simulator models boons and missions.
 *
 * Excluded from the default vitest run (see vitest.config.ts) — it takes ~20s.
 */

import { describe, expect, it } from 'vitest';
import { completeChallenge, createRun, recordOffer, startChallenge, takeBeacon } from './engine';
import { evaluateOffer } from './evaluator';
import { makeRng, sampleOffer } from './offerModel';
import { rollout } from './simulator';
import type { OfferedBeacon, RunState } from './types';

function outcome(state: RunState, offer: OfferedBeacon[], pick: OfferedBeacon, n: number) {
  let pulls = 0;
  let ok = 0;
  for (let r = 0; r < n; r++) {
    try {
      let s = takeBeacon(recordOffer(state, offer), pick);
      s = completeChallenge(startChallenge(s));
      pulls += rollout(s, makeRng(1000 + r * 7919), { runs: 1 }).pulls;
      ok++;
    } catch {
      /* illegal pick for this state — skip */
    }
  }
  return ok ? pulls / ok : null;
}

export function validateAdvice(offers = 60, rollouts = 120) {
  let better = 0;
  let worse = 0;
  let tied = 0;
  let sumTop = 0;
  let sumBottom = 0;
  let n = 0;

  for (let seed = 0; seed < offers; seed++) {
    const base = createRun({
      challengesCompleted: 12,
      challengesRemaining: 25,
      timeRemaining: 600,
    });
    const offer = sampleOffer(base, makeRng(seed));
    if (offer.length < 2) continue;

    const live = evaluateOffer(base, offer).ranked.filter((r) => !r.suppressed);
    if (live.length < 2) continue;

    const top = live[0]!;
    const bottom = live[live.length - 1]!;
    const a = outcome(base, offer, { color: top.color, vibrant: top.vibrant }, rollouts);
    const b = outcome(base, offer, { color: bottom.color, vibrant: bottom.vibrant }, rollouts);
    if (a === null || b === null) continue;

    n++;
    sumTop += a;
    sumBottom += b;
    if (a > b) better++;
    else if (a < b) worse++;
    else tied++;
  }

  return {
    n,
    better,
    worse,
    tied,
    winRate: better / (better + worse || 1),
    meanTop: sumTop / n,
    meanBottom: sumBottom / n,
  };
}

describe('advice quality (opt-in — npm run validate)', () => {
  it('advisor top pick beats its bottom pick more often than chance', () => {
    const r = validateAdvice();
    console.log(`Compared ${r.n} offers — advisor #1 vs advisor last pick`);
    console.log(`  #1 better:  ${r.better}`);
    console.log(`  #1 worse:   ${r.worse}`);
    console.log(`  tied:       ${r.tied}`);
    console.log(`  win rate:   ${(r.winRate * 100).toFixed(0)}%   (50% = no signal)`);
    console.log(`  mean pulls: ${r.meanTop.toFixed(1)} vs ${r.meanBottom.toFixed(1)}`);
    console.log('NOTE: E[pulls] is blind to boons and missions — this understates the advisor.');

    expect(r.n).toBeGreaterThan(20);
    expect(r.winRate).toBeGreaterThan(0.5);
  });
});
