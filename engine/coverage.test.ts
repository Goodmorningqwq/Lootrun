/**
 * Coverage harness — opt-in via `npm run validate` (see vitest.validate.config.ts).
 *
 * Enumerates every 3-mission offer the game can present and asks whether the
 * advisor has anything to say about it. Excluded from the default run because
 * it scores ~2,925 offers.
 */

import { describe, expect, it } from 'vitest';
import { measureCoverage } from './coverage';

describe('mission advice coverage (opt-in — npm run validate)', () => {
  it('distinguishes the options in nearly every offer, and never picks a bad one', () => {
    const c = measureCoverage();

    console.log(`Scored all ${c.offers} possible 3-mission offers at the forced pick`);
    console.log(`  blind (no basis to choose): ${c.blind}  (${((c.blind / c.offers) * 100).toFixed(1)}%)`);
    console.log(`    of which every option scored zero: ${c.blindAtZero}`);
    console.log(`  bad recommendations:        ${c.bad}`);
    if (c.blindCauses.length) {
      console.log('  missions causing blind offers:');
      for (const m of c.blindCauses) console.log(`    ${m.name} — ${m.count}`);
    }
    console.log(`  still scoring zero: ${c.zeroScored.join(', ') || 'none'}`);

    // The advisor must never steer someone into a mission the expert rejected
    // when a better one was on the table. This is the hard floor.
    expect(c.bad).toBe(0);

    // Blind offers cluster on missions no combo claims, so this is really a
    // playbook-coverage bound rather than a scoring one.
    expect(c.blind / c.offers).toBeLessThan(0.02);

    // The remaining blind offers must be ties between options the advisor
    // rates equally — three combo starters, say — not offers it knows nothing
    // about. Only Inner Peace still scores zero, and no offer is all-zero.
    expect(c.blindAtZero).toBe(0);
  });
});
