/**
 * Aqua valuation — opt-in via `npm run validate`.
 *
 * Answers whether phase priority is right to rank aqua second overall, behind
 * only rainbow. Prints the analytic table (exact, from data/beacons.json) and
 * the realised ranking (simulated), with the analytic result serving as a
 * check on the simulator before the simulator is believed.
 */

import { describe, expect, it } from 'vitest';
import {
  analyticAquaVsPurple,
  boostedTier,
  purplePulls,
  realisedRanking,
} from './aquaValue';
import { activePhases, getStrategy } from './evaluator';
import { legalColors } from './engine';
import { standardState } from './aquaValue';

describe('aqua valuation (opt-in — npm run validate)', () => {
  it('the mechanic is what we think it is', () => {
    // Aqua at tier T lifts the next beacon by T+1 tiers, capped at 3.
    expect(boostedTier(0, 0)).toBe(1);
    expect(boostedTier(0, 1)).toBe(2);
    expect(boostedTier(1, 1)).toBe(3);
    expect(boostedTier(2, 3)).toBe(3); // cap
    expect(purplePulls(0)).toBe(2);
    expect(purplePulls(3)).toBe(8);
  });

  it('prices aqua against purple exactly, with no economy assumptions', () => {
    const rows = analyticAquaVsPurple();

    console.log('\nANALYTIC — aqua then purple, vs purple twice (pulls over 2 challenges)');
    console.log('  best case for aqua: assumes purple is offered both times');
    console.log('  aquaT  baseT   aqua→purple   purple×2   edge');
    for (const r of rows) {
      console.log(
        `    ${r.aquaTier}      ${r.baseTier}         ${String(r.aquaThenPurple).padStart(2)}` +
          `           ${String(r.purpleTwice).padStart(2)}       ${r.edge > 0 ? '+' : ''}${r.edge}`,
      );
    }

    // The headline case: everything at base tier, which is the common state.
    const flat = rows.find((r) => r.aquaTier === 0 && r.baseTier === 0)!;
    expect(flat.aquaThenPurple).toBe(4);
    expect(flat.purpleTwice).toBe(4);
    expect(flat.edge).toBe(0);
  });

  it('measures what each colour actually returns, against the strategy order', () => {
    const state = standardState();
    const colors = legalColors(state);
    const ranked = realisedRanking(colors, 60, state);

    // The strategy's opinion AT THIS STATE. Must be the active phase, not just
    // the first one that happens to carry a priority list — the same
    // last-match-wins rule the scorer uses.
    const phase = [...activePhases(state)].reverse().find((p) => p.beaconPriority?.length);
    console.log('\nREALISED VALUE — mean pulls from taking each colour at challenge 12');
    for (const [i, r] of ranked.entries()) {
      console.log(
        `  ${String(i + 1).padStart(2)}. ${r.color.padEnd(9)} ${r.meanPulls.toFixed(1)}` +
          `  ${r.vsBest === 0 ? '(best)' : r.vsBest.toFixed(1)}`,
      );
    }
    console.log(`\nSTRATEGY ORDER (phase "${phase?.id}"): ${phase?.beaconPriority?.join(' > ')}`);

    const aqua = ranked.findIndex((r) => r.color === 'aqua');
    console.log(`\nAqua sits at realised rank ${aqua + 1} of ${ranked.length}.`);

    expect(ranked.length).toBeGreaterThan(5);
  });

  it('reports which phases still omit the payoff beacons', () => {
    // An unlisted colour scores the neutral fallback of 5 regardless of what
    // it actually does, so omitting purple is not a mild preference — it puts
    // the game's main pull source below almost everything. rainbow_window is
    // fixed; this prints the phases that still have the hole.
    const PAYOFF = ['purple', 'yellow', 'green', 'darkGrey'];
    console.log('\nPAYOFF BEACONS MISSING, BY PHASE (unlisted scores 5)');

    for (const p of getStrategy().phases) {
      if (!p.beaconPriority?.length) continue;
      const listed = new Set(p.beaconPriority.map((e) => (e.includes(':') ? e.split(':')[1]! : e)));
      const missing = PAYOFF.filter((c) => !listed.has(c));
      const aquaAt = p.beaconPriority.indexOf('aqua');
      console.log(
        `  ${p.id.padEnd(16)} aqua ${aquaAt < 0 ? '—' : `#${aquaAt + 1}/${p.beaconPriority.length}`}` +
          `   missing: ${missing.join(', ') || 'none'}`,
      );
    }

    const fixed = getStrategy().phases.find((p) => p.id === 'rainbow_window')!;
    for (const c of PAYOFF) expect(fixed.beaconPriority).toContain(c);
  });

  it('is worth least in the very phase that ranks it highest', () => {
    // The rainbow_window phase ranks aqua third. But while a rainbow is up
    // every beacon is already vibrant, so the base tier is 1 — and the tier
    // cap at 3 eats part of the boost aqua is paying a whole challenge for.
    // This is exact, from the tier tables, with no simulator involved.
    const rows = analyticAquaVsPurple();

    console.log('\nUNDER AN ACTIVE RAINBOW (base tier 1 — everything is vibrant)');
    for (const r of rows.filter((x) => x.baseTier === 1)) {
      console.log(
        `  aqua at tier ${r.aquaTier}: aqua→purple ${r.aquaThenPurple} vs purple×2 ` +
          `${r.purpleTwice}  →  ${r.edge > 0 ? '+' : ''}${r.edge}`,
      );
    }

    // A raw aqua taken under a rainbow strictly loses to just taking purple.
    const raw = rows.find((r) => r.aquaTier === 0 && r.baseTier === 1)!;
    expect(raw.edge).toBeLessThan(0);

    // And it never wins under a rainbow, at any aqua tier.
    for (const r of rows.filter((x) => x.baseTier >= 1)) {
      expect(r.edge).toBeLessThanOrEqual(0);
    }
  });
});
