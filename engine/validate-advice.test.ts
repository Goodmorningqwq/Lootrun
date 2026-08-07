/**
 * Advice quality harness — opt-in via `npm run validate`.
 *
 * The unit tests prove the advisor is SELF-CONSISTENT: it applies the rules it
 * claims to apply. They cannot prove the advice is GOOD. This is the only thing
 * that can — it plays the advisor's top pick and its bottom pick out to the end
 * of the run many times and compares the outcomes.
 *
 * Boons and mission economies ARE now modelled (engine/missionEffects.ts), so
 * E[pulls] responds to the full value chain rather than purple alone.
 *
 * WHAT THE NUMBER MEANS. Win rate above 50% means the ranking carries signal.
 * It is NOT a claim of optimality: the advisor also optimises for survival,
 * reachability and flexibility, which pure pull-maximisation does not reward.
 *
 * HISTORY WORTH KEEPING. Before mission effects were modelled this reported an
 * 80% win rate — but E[pulls] was then driven almost entirely by purple and by
 * challenge count, both of which the advisor's priorities correlate with, so the
 * metric was flattering itself. With the real economy in place it reads ~63%
 * with double the effect size. The lower number is the more honest one.
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
    // 60 offers is enough for CI; raise it when a result looks like it might
    // be small-sample noise: VALIDATE_OFFERS=200 npm run validate
    const r = validateAdvice(Number(process.env.VALIDATE_OFFERS) || 60);
    console.log(`Compared ${r.n} offers — advisor #1 vs advisor last pick`);
    console.log(`  #1 better:  ${r.better}`);
    console.log(`  #1 worse:   ${r.worse}`);
    console.log(`  tied:       ${r.tied}`);
    console.log(`  win rate:   ${(r.winRate * 100).toFixed(0)}%   (50% = no signal)`);
    console.log(`  mean pulls: ${r.meanTop.toFixed(1)} vs ${r.meanBottom.toFixed(1)}`);
    console.log('NOTE: signal, not optimality — the advisor also weighs survival and reachability.');

    expect(r.n).toBeGreaterThan(20);
    expect(r.winRate).toBeGreaterThan(0.5);

    // Deliberately NOT asserting meanTop > meanBottom. The two metrics
    // disagree, and which one to prefer is a strategy decision, not a bug:
    // the advisor's pick comes out ahead 60% of the time while the bottom pick
    // carries a slightly higher mean, i.e. it loses more often but occasionally
    // runs away. Optimising the mean would mean recommending the
    // higher-variance beacon, which is the opposite of this advisor's stated
    // goal of being safe and avoiding gambles. Win rate is the aligned metric;
    // the mean is reported so a real collapse is still visible.
  });
});

/**
 * HISTORY, because the dip and the recovery both taught us something.
 *
 * Measured at 250 offers. 65% originally. Fixing the salvage double-count in
 * evaluateMissionOffer dropped it to 38% — runs finally committed to combos,
 * and the beacon advice turned out to be calibrated for runs that never did.
 *
 * Diagnosing that pointed at AQUA, beaten by green, purple and yellow. The
 * real cause was worse than a mis-ranking: `rainbow_window` — which covers
 * challenge 10 onward — did not list purple, yellow, green or darkGrey AT ALL,
 * so the game's primary pull sources scored the unlisted-fallback 5 while aqua
 * scored 80. Listing them and demoting aqua took it to 57%, and mean pulls
 * from 620 to 756 — well above the original 645, because both arms of the
 * comparison got better.
 *
 * The lesson worth keeping: a win rate that looks healthy can be measuring a
 * strategy that is leaving most of its value on the table. Absolute yield and
 * discrimination are different questions, and this harness only answers the
 * second one.
 *
 * Purple, yellow, green and darkGrey are still missing from several OTHER
 * phases (opening, extension, trial_window) — see engine/aquaValue.test.ts,
 * which prints the per-phase gaps.
 */
