/**
 * Phase 2 acceptance tests: hand-checked scenarios where we know what the
 * guide says the right call is. If one of these fails after a strategy edit,
 * the edit changed real advice — which is exactly what we want surfaced.
 */

import { describe, expect, it } from 'vitest';
import { createRun } from './engine';
import {
  activePhases,
  evaluateMissionOffer,
  evaluateOffer,
  isRunnable,
  testCondition,
  validateStrategy,
  setStrategy,
  DEFAULT_STRATEGY,
  parsePriorityEntry,
  priorityIndexFor,
} from './evaluator';
import type { RunState } from './types';

/** Held missions, all fulfilled — the common case for these scenarios. */
const slots = (...ids: string[]) => ids.map((id) => ({ id, fulfilled: true }));

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

    const equipped = runAt(10, { missions: slots('hoarder', 'high_roller') });
    expect(isRunnable(equipped)).toBe(true);
  });

  it('runnable also requires 20+ challenges remaining', () => {
    const s = runAt(10, {
      missions: slots('hoarder', 'high_roller'),
      challengesRemaining: 10,
    });
    expect(isRunnable(s)).toBe(false);
  });

  it('weak generators (Jester\'s Trick, Complete Chaos) never satisfy runnable alone', () => {
    // Both carry boon_generator + pull_generator roles, but their effects are
    // random — the data marks them weak, and the goal must ignore them.
    const s = runAt(10, { missions: slots('jesters_trick', 'complete_chaos') });
    expect(isRunnable(s)).toBe(false);

    // A real generator alongside them still counts.
    const mixed = runAt(10, { missions: slots('jesters_trick', 'hoarder', 'high_roller') });
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
    const good = activePhases(runAt(35, { missions: slots('hoarder', 'high_roller') }));
    expect(good.map((p) => p.id)).toContain('farm');

    const bad = activePhases(runAt(35));
    expect(bad.map((p) => p.id)).toContain('salvage');
  });

  it('endgame outranks farm when 7 or fewer challenges remain', () => {
    const phases = activePhases(
      runAt(60, { missions: slots('hoarder', 'high_roller'), challengesRemaining: 6 }),
    );
    expect(phases[phases.length - 1]?.id).toBe('endgame');
  });
});

describe('mission offer evaluation', () => {
  it('with no archetype yet, prefers a core that can still be built', () => {
    const a = evaluateMissionOffer(runAt(4), ['equilibrium', 'stasis', 'high_spirits']);
    expect(a.committed).toBeNull();
    expect(a.ranked[0]?.id).toBe('equilibrium');
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/Starts/i);
  });

  it('once committed, ranks that archetype’s core above generic picks', () => {
    const a = evaluateMissionOffer(
      runAt(10, { missions: slots('equilibrium') }),
      ['porphyrophobia', 'high_spirits'],
    );
    expect(a.committed?.id).toBe('curse_stack');
    expect(a.ranked[0]?.id).toBe('porphyrophobia');
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/core/i);
  });

  it('warns when a pick fights the committed archetype', () => {
    const a = evaluateMissionOffer(
      runAt(10, { missions: slots('equilibrium', 'porphyrophobia') }),
      ['cleansing_greed', 'high_roller'],
    );
    const cg = a.ranked.find((r) => r.id === 'cleansing_greed');
    expect(cg?.reasons.join(' ')).toMatch(/Removes the curses/i);
    expect(a.ranked[0]?.id).toBe('high_roller');
  });

  it('boosts missions that fill a missing runnable role', () => {
    const a = evaluateMissionOffer(runAt(6), ['hoarder', 'high_spirits']);
    expect(a.missingRoles).toContain('boon_generator');
    expect(a.ranked[0]?.id).toBe('hoarder');
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/Fills missing/i);
  });

  it('weak generators do not count as filling a role', () => {
    const a = evaluateMissionOffer(runAt(6), ['jesters_trick']);
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/does not satisfy runnable/i);
  });

  it('flags Knife Edge as a trap while challenges remain', () => {
    const a = evaluateMissionOffer(runAt(10, { challengesRemaining: 40 }), [
      'knife_edge',
      'redemption',
    ]);
    const ke = a.ranked.find((r) => r.id === 'knife_edge');
    expect(ke?.reasons.join(' ')).toMatch(/Trap/i);
    expect(a.ranked[0]?.id).toBe('redemption');
  });

  it('prefers the stateless pick when only one slot is left', () => {
    const a = evaluateMissionOffer(
      runAt(25, { missions: slots('stasis', 'chronokinesis') }),
      ['high_roller', 'equilibrium'],
    );
    expect(a.slotsLeft).toBe(1);
    expect(a.ranked[0]?.id).toBe('high_roller');
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/last slot/i);
  });

  it('every ranked mission carries a reason', () => {
    const a = evaluateMissionOffer(runAt(10), ['optimism', 'requiem', 'high_spirits']);
    for (const r of a.ranked) expect(r.reasons.length).toBeGreaterThan(0);
  });
});

describe('strategy swapping and validation', () => {
  it('rejects malformed strategies with a message', () => {
    expect(validateStrategy(null).ok).toBe(false);
    expect(validateStrategy({}).ok).toBe(false);
    expect(validateStrategy({ id: 'x', goals: {}, safety: [], phases: [] }).ok).toBe(false); // empty phases
    const bad = validateStrategy({ id: 'x' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/phases/i);
  });

  it('accepts the default strategy', () => {
    expect(validateStrategy(DEFAULT_STRATEGY).ok).toBe(true);
  });

  it('a swapped strategy changes advice, and resets back', () => {
    const before = evaluateOffer(runAt(1), [{ color: 'orange' }, { color: 'blue' }]);
    expect(before.ranked[0]?.color).toBe('orange'); // opening: orange #1

    // Minimal strategy that reverses the opening to prefer blue.
    setStrategy({
      id: 'test-blue-first',
      goals: { runnable: { all: [] } },
      safety: [],
      phases: [{ id: 'opening', when: { path: 'challenge', gte: 0 }, beaconPriority: ['blue', 'orange'] }],
    });
    const after = evaluateOffer(runAt(1), [{ color: 'orange' }, { color: 'blue' }]);
    expect(after.ranked[0]?.color).toBe('blue');

    setStrategy(DEFAULT_STRATEGY);
    const restored = evaluateOffer(runAt(1), [{ color: 'orange' }, { color: 'blue' }]);
    expect(restored.ranked[0]?.color).toBe('orange');
  });
});

describe('archetype-aware beacon priority (playtester feedback)', () => {
  it('does NOT prioritise purple by default — only under curse stacking', () => {
    // Mujtaba: "it prioritises purple no matter the run combo."
    const neutral = evaluateOffer(runAt(15), [{ color: 'purple' }, { color: 'blue' }]);
    const pN = neutral.ranked.find((r) => r.color === 'purple')!;
    const bN = neutral.ranked.find((r) => r.color === 'blue')!;
    // Farm phase lists purple above blue, but the gap is small without an archetype.
    const gapNeutral = pN.score - bN.score;

    const curse = evaluateOffer(
      runAt(15, { missions: slots('equilibrium', 'porphyrophobia') }),
      [{ color: 'purple' }, { color: 'blue' }],
    );
    const pC = curse.ranked.find((r) => r.color === 'purple')!;
    const bC = curse.ranked.find((r) => r.color === 'blue')!;
    // Under curse_stack, purple pulls decisively ahead.
    expect(pC.score - bC.score).toBeGreaterThan(gapNeutral);
    expect(curse.ranked[0]?.color).toBe('purple');
    expect(pC.reasons.join(' ')).toMatch(/curse stacking/i);
  });

  it('prioritises blue on an Ostinato run', () => {
    // Mujtaba: "I did an ostinato run so for me blues were better."
    const a = evaluateOffer(runAt(15, { missions: slots('ostinato') }), [
      { color: 'blue' },
      { color: 'purple' },
      { color: 'yellow' },
    ]);
    expect(a.ranked[0]?.color).toBe('blue');
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/ostinato/i);
  });

  it('prioritises yellow with a flying-chest engine', () => {
    // Mujtaba: "if I had interest scheme plus hoarder, yellows would be better."
    const a = evaluateOffer(
      runAt(15, { missions: slots('interest_scheme', 'hoarder') }),
      [{ color: 'yellow' }, { color: 'blue' }],
    );
    expect(a.ranked[0]?.color).toBe('yellow');
    const blue = a.ranked.find((r) => r.color === 'blue')!;
    // flying_chest downranks blue (Hoarder makes blue redundant).
    expect(blue.reasons.join(' ')).toMatch(/avoids blue/i);
  });

  it('does NOT urge a RAW grey early — waiting for a boosted one is better', () => {
    const a = evaluateOffer(runAt(12), [{ color: 'grey' }, { color: 'blue' }]);
    const grey = a.ranked.find((r) => r.color === 'grey')!;
    expect(grey.reasons.join(' ')).not.toMatch(/missions early/i);
    expect(grey.reasons.join(' ')).toMatch(/only 3 mission choices/i);
  });

  it('urges a BOOSTED grey while slots remain open', () => {
    const a = evaluateOffer(runAt(12, { pendingAqua: 1 }), [
      { color: 'grey' },
      { color: 'blue' },
    ]);
    expect(a.ranked[0]?.color).toBe('grey');
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/missions early.*boosted/i);
  });

  it('urges even a raw grey once the window is closing', () => {
    const a = evaluateOffer(runAt(26), [{ color: 'grey' }, { color: 'blue' }]);
    expect(a.ranked[0]?.color).toBe('grey');
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/Window closing/i);
  });

  it('urges rainbow whenever one is offered', () => {
    const a = evaluateOffer(runAt(15), [{ color: 'blue' }, { color: 'rainbow' }]);
    expect(a.ranked[0]?.color).toBe('rainbow');
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/rainbow early/i);
  });
});

describe('boosted priority tokens (buffed:/aqua:)', () => {
  it('parses plain and boost-qualified entries', () => {
    expect(parsePriorityEntry('white')).toEqual({ color: 'white', requiresBoost: false });
    expect(parsePriorityEntry('buffed:white')).toEqual({ color: 'white', requiresBoost: true });
    expect(parsePriorityEntry('aqua:rainbow')).toEqual({ color: 'rainbow', requiresBoost: true });
  });

  it('a boosted entry matches only above tier 0, and beats the plain entry', () => {
    const list = ['buffed:white', 'aqua', 'white'];
    expect(priorityIndexFor(list, 'white', 0)).toBe(2); // raw -> only the plain entry
    expect(priorityIndexFor(list, 'white', 1)).toBe(0); // boosted -> the buffed entry
    expect(priorityIndexFor(list, 'aqua', 0)).toBe(1);
  });

  it('with no aqua banked, aqua outranks a RAW white in extension', () => {
    const a = evaluateOffer(runAt(6), [{ color: 'aqua' }, { color: 'white' }]);
    expect(a.ranked[0]?.color).toBe('aqua');
  });

  it('a boosted white (aqua banked) outranks holding another aqua', () => {
    const s = runAt(6, { pendingAqua: 1 }); // next beacon resolves tier 1
    const a = evaluateOffer(s, [{ color: 'white' }, { color: 'aqua' }]);
    expect(a.ranked[0]?.color).toBe('white');
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/as a boosted white/i);
  });

  it('rainbow makes white boosted too — not just aqua', () => {
    // rainbowChallengesLeft > 0 grants vibrancy, so white resolves tier 1.
    const s = runAt(15, { rainbowChallengesLeft: 5 });
    const a = evaluateOffer(s, [{ color: 'white' }, { color: 'orange' }]);
    // In rainbow_window, buffed:white sits above orange.
    expect(a.ranked[0]?.color).toBe('white');
  });

  it('the validator rejects a priority typo', () => {
    const bad = validateStrategy({
      id: 'x',
      goals: { runnable: { all: [] } },
      safety: [],
      phases: [{ id: 'p', beaconPriority: ['buffed:whte'] }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/whte/);
  });

  it('the validator accepts valid boost tokens', () => {
    const ok = validateStrategy({
      id: 'x',
      goals: { runnable: { all: [] } },
      safety: [],
      phases: [{ id: 'p', beaconPriority: ['buffed:white', 'aqua', 'white'] }],
    });
    expect(ok.ok).toBe(true);
  });
});

describe('per-mission / per-trial bias composes across combinations', () => {
  /** Score of one colour in an offer, for comparing setups. */
  const scoreOf = (state: RunState, color: 'red' | 'blue' | 'green' | 'yellow' | 'purple') =>
    evaluateOffer(state, [{ color }]).ranked[0]!.score;

  it('a single mission shifts priority on its own', () => {
    const base = scoreOf(runAt(15), 'red');
    const withThrill = scoreOf(runAt(15, { missions: slots('thrill_seeker') }), 'red');
    expect(withThrill).toBeGreaterThan(base); // +30, pulls per red challenge
  });

  it('two entities that want the same beacon STACK — no pair rule written', () => {
    const one = scoreOf(runAt(15, { missions: slots('thrill_seeker') }), 'red');
    const both = scoreOf(
      runAt(15, { missions: slots('thrill_seeker'), trials: ['warmth_devourer'] }),
      'red',
    );
    // Thrill Seeker +30 and Warmth Devourer +30 sum without an explicit combo rule.
    expect(both).toBe(one + 30);
  });

  it('opposing effects cancel rather than one silently winning', () => {
    // Thrill Seeker wants red; Knife Edge is ruined by added challenges.
    const thrill = scoreOf(runAt(15, { missions: slots('thrill_seeker') }), 'red');
    const both = scoreOf(runAt(15, { missions: slots('thrill_seeker', 'knife_edge') }), 'red');
    expect(both).toBe(thrill - 30); // Knife Edge's -30 applies too
  });

  it('a trial can veto a beacon the phase likes — Ultimate Sacrifice kills blue', () => {
    const normal = scoreOf(runAt(15), 'blue');
    const disabled = scoreOf(runAt(15, { trials: ['ultimate_sacrifice'] }), 'blue');
    expect(disabled).toBe(normal - 40);
    const a = evaluateOffer(runAt(15, { trials: ['ultimate_sacrifice'] }), [
      { color: 'blue' },
      { color: 'red' },
    ]);
    expect(a.ranked[0]?.color).toBe('red');
    expect(a.ranked.find((r) => r.color === 'blue')!.reasons.join(' ')).toMatch(
      /boons are DISABLED/i,
    );
  });

  it('Gambling Beast makes green urgent', () => {
    const base = scoreOf(runAt(15), 'green');
    const gb = scoreOf(runAt(15, { trials: ['gambling_beast'] }), 'green');
    expect(gb).toBe(base + 35);
  });

  it('un-activated missions contribute NO bias', () => {
    const activated = scoreOf(runAt(15, { missions: slots('thrill_seeker') }), 'red');
    const pending = scoreOf(
      runAt(15, { missions: [{ id: 'thrill_seeker', fulfilled: false }] }),
      'red',
    );
    expect(pending).toBeLessThan(activated);
  });

  it('every bias contribution is explained, not silently applied', () => {
    const a = evaluateOffer(
      runAt(15, { missions: slots('hoarder', 'interest_scheme'), trials: ['side_hustle'] }),
      [{ color: 'yellow' }],
    );
    const why = a.ranked[0]!.reasons.join(' | ');
    expect(why).toMatch(/Hoarder: \+25/);
    expect(why).toMatch(/Interest Scheme: \+25/);
    expect(why).toMatch(/Side Hustle: \+30/);
  });
});

describe('tactics: boosted-only, aqua loop, orange refresh', () => {
  it('prefers a boosted grey over a raw one — the reported complaint', () => {
    // Mujtaba: "it was recommending I take a non boosted gray but I prefer not
    // doing that... more options means better run combo."
    const raw = evaluateOffer(runAt(12), [{ color: 'grey' }, { color: 'pink' }]);
    const greyRaw = raw.ranked.find((r) => r.color === 'grey')!;
    expect(greyRaw.reasons.join(' ')).toMatch(/only 3 mission choices/i);

    // Same offer with an aqua banked -> grey resolves boosted and wins.
    const boosted = evaluateOffer(runAt(12, { pendingAqua: 1 }), [
      { color: 'grey' },
      { color: 'pink' },
    ]);
    const greyBoosted = boosted.ranked.find((r) => r.color === 'grey')!;
    expect(greyBoosted.score).toBeGreaterThan(greyRaw.score);
    expect(greyBoosted.reasons.join(' ')).toMatch(/Boosted grey/i);
  });

  it('penalises an unboosted white but not the FIRST rainbow', () => {
    const a = evaluateOffer(runAt(12), [{ color: 'white' }, { color: 'rainbow' }]);
    const white = a.ranked.find((r) => r.color === 'white')!;
    const rainbow = a.ranked.find((r) => r.color === 'rainbow')!;
    expect(white.reasons.join(' ')).toMatch(/Unboosted white wastes it/i);
    expect(rainbow.reasons.join(' ')).toMatch(/First rainbow — worth taking raw/i);
  });

  it('penalises a second raw rainbow', () => {
    const s = runAt(20, { beaconUses: { rainbow: 1 } });
    const a = evaluateOffer(s, [{ color: 'rainbow' }]);
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/Unboosted rainbow wastes it/i);
  });

  it('aqua loop: sets up aqua, then spends it on the combo payoff', () => {
    // Flying-chest combo -> payoff is yellow.
    const held = slots('hoarder', 'interest_scheme');

    const setup = evaluateOffer(runAt(15, { missions: held }), [
      { color: 'aqua' },
      { color: 'red' },
    ]);
    expect(setup.ranked[0]?.color).toBe('aqua');
    expect(setup.ranked[0]?.reasons.join(' ')).toMatch(/Set up aqua -> yellow/i);

    const spend = evaluateOffer(runAt(15, { missions: held, pendingAqua: 1 }), [
      { color: 'yellow' },
      { color: 'red' },
    ]);
    expect(spend.ranked[0]?.color).toBe('yellow');
    expect(spend.ranked[0]?.reasons.join(' ')).toMatch(/Spend the banked aqua/i);
  });

  it('aqua loop follows the mission objective when one is un-activated', () => {
    // get_boons objective -> payoff is blue, per payoffByNeed.
    const s = runAt(15, {
      missions: [{ id: 'hoarder', fulfilled: false, objective: 'get_boons' }],
      pendingAqua: 1,
    });
    const a = evaluateOffer(s, [{ color: 'blue' }, { color: 'red' }]);
    expect(a.ranked[0]?.color).toBe('blue');
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/Spend the banked aqua here — blue/i);
  });

  it('promotes orange when a stack is about to lapse', () => {
    const soon = runAt(15, { orangeStacks: [{ bonus: 1, challengesLeft: 1 }] });
    const a = evaluateOffer(soon, [{ color: 'orange' }, { color: 'blue' }]);
    expect(a.ranked[0]?.color).toBe('orange');
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/Refresh orange/i);

    // A fresh stack should not trigger the refresh nudge.
    const fresh = runAt(15, { orangeStacks: [{ bonus: 1, challengesLeft: 9 }] });
    const b = evaluateOffer(fresh, [{ color: 'orange' }]);
    expect(b.ranked[0]?.reasons.join(' ')).not.toMatch(/Refresh orange/i);
  });
});

describe('mission activation and objectives (playtest feedback)', () => {
  // Held but NOT activated: fulfilled: false, with an objective to complete.
  const arming = (id: string, objective: string) => [{ id, fulfilled: false, objective }];

  it('an un-activated mission does NOT bias beacons toward its archetype', () => {
    // Ostinato held but not activated → blue should not get the +35 combo bias.
    const a = evaluateOffer(runAt(15, { missions: arming('ostinato', 'open_chests') }), [
      { color: 'blue' },
      { color: 'yellow' },
    ]);
    const blue = a.ranked.find((r) => r.color === 'blue')!;
    expect(blue.reasons.join(' ')).not.toMatch(/run combo wants blue/i);
  });

  it('instead pushes the beacon that completes the objective', () => {
    // open_chests objective → yellow gets the activation boost.
    const a = evaluateOffer(runAt(15, { missions: arming('ostinato', 'open_chests') }), [
      { color: 'blue' },
      { color: 'yellow' },
    ]);
    expect(a.ranked[0]?.color).toBe('yellow');
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/Activates .*Ostinato.*Open chests/i);
  });

  it('get_curses objective routes to purple', () => {
    const a = evaluateOffer(runAt(15, { missions: arming('equilibrium', 'get_curses') }), [
      { color: 'purple' },
      { color: 'blue' },
    ]);
    expect(a.ranked[0]?.color).toBe('purple');
  });

  it('passive objectives (gain_time) push no beacon', () => {
    const a = evaluateOffer(runAt(15, { missions: arming('stasis', 'gain_time') }), [
      { color: 'green' },
      { color: 'blue' },
    ]);
    const green = a.ranked.find((r) => r.color === 'green')!;
    expect(green.reasons.join(' ')).not.toMatch(/Activates/i);
  });

  it('once activated, the archetype bias applies again', () => {
    const a = evaluateOffer(
      runAt(15, { missions: [{ id: 'ostinato', fulfilled: true, objective: 'open_chests' }] }),
      [{ color: 'blue' }, { color: 'yellow' }],
    );
    expect(a.ranked[0]?.color).toBe('blue');
    expect(a.ranked[0]?.reasons.join(' ')).toMatch(/run combo wants blue/i);
  });

  it('never recommends darkGrey to complete an objective', () => {
    // get_curses would be advanced by darkGrey mechanically, but it is excluded.
    const a = evaluateOffer(
      runAt(15, { missions: arming('equilibrium', 'get_curses'), rank: 'grandmaster' }),
      [{ color: 'darkGrey' }, { color: 'purple' }],
    );
    const dg = a.ranked.find((r) => r.color === 'darkGrey')!;
    expect(dg.reasons.join(' ')).not.toMatch(/Activates/i);
    expect(a.ranked[0]?.color).toBe('purple');
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
    const advice = evaluateOffer(runAt(35, { missions: slots('hoarder', 'high_roller') }), [
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
