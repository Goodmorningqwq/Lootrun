import { describe, expect, it } from 'vitest';
import { createRun } from './engine';
import {
  SIM_ECONOMY,
  simBeaconTaken,
  simChallengeCompleted,
  simGainBoon,
  simMissionAcquired,
  simOpalOnCurses,
} from './missionEffects';
import type { RunState } from './types';

const withMissions = (ids: string[], o: Partial<RunState> = {}) =>
  createRun({
    dailyBonus: false, // isolate mission income from the opening endowment
    missions: ids.map((id) => ({ id, fulfilled: true })),
    ...o,
  });

describe('chest generation', () => {
  it('yellow spawns flying chests by tier', () => {
    const s = simBeaconTaken(withMissions([]), { color: 'yellow' }, 0);
    expect(s.flyingChests).toBe(2); // tier 0 = 2 chests
    const t3 = simBeaconTaken(withMissions([]), { color: 'yellow' }, 3);
    expect(t3.flyingChests).toBe(5);
  });

  it('Materialism adds chests on yellow AND every challenge', () => {
    const onYellow = simBeaconTaken(withMissions(['materialism']), { color: 'yellow' }, 0);
    expect(onYellow.flyingChests).toBe(4); // 2 + 2

    const onComplete = simChallengeCompleted(withMissions(['materialism']), false);
    expect(onComplete.flyingChests).toBe(2);
  });

  it('Interest Scheme converts banked pulls into chests on the next yellow', () => {
    const s = simBeaconTaken(
      withMissions(['interest_scheme'], { pulls: 10 }),
      { color: 'yellow' },
      0,
    );
    // 2 base + floor(10 / 2) = 7
    expect(s.flyingChests).toBe(7);
  });
});

describe('chest -> boon -> pull chain', () => {
  it('Hoarder converts 6 flying chests into a boon at 200% potency', () => {
    const s = simBeaconTaken(
      withMissions(['hoarder'], { flyingChests: 6 }),
      { color: 'red' }, // irrelevant beacon; the conversion runs regardless
      0,
    );
    expect(s.boons).toHaveLength(1);
    expect(s.boons[0]!.potency).toBe(SIM_ECONOMY.hoarderBoonPotency);
    expect(s.flyingChests).toBe(0);
  });

  it('the full yellow -> Hoarder chain produces boons from one beacon', () => {
    // Materialism + yellow tier 3 = 5 + 2 = 7 chests -> 1 boon, 1 left over.
    const s = simBeaconTaken(withMissions(['hoarder', 'materialism']), { color: 'yellow' }, 3);
    expect(s.boons).toHaveLength(1);
    expect(s.flyingChests).toBe(1);
  });

  it('blue grants a boon whose potency scales with tier', () => {
    expect(simBeaconTaken(withMissions([]), { color: 'blue' }, 0).boons[0]!.potency).toBe(1);
    expect(simBeaconTaken(withMissions([]), { color: 'blue' }, 3).boons[0]!.potency).toBe(4);
  });
});

describe('boon -> pull conversion', () => {
  it('Ostinato pays per duplicate boon already held', () => {
    let s = withMissions(['ostinato']);
    s = simGainBoon(s, 1); // first boon — no duplicates
    expect(s.pulls).toBe(0);
    s = simGainBoon(s, 1); // second — 1 duplicate
    expect(s.pulls).toBe(1);
    s = simGainBoon(s, 1); // third — 2 duplicates
    expect(s.pulls).toBe(3);
  });

  it('Ostinato pays nothing when not held', () => {
    let s = withMissions([]);
    s = simGainBoon(s, 1);
    s = simGainBoon(s, 1);
    expect(s.pulls).toBe(0);
  });

  it('Opal consumes a boon per curse, paying more for high potency', () => {
    const base = simOpalOnCurses(
      { ...withMissions(['opal_offering']), boons: [{ id: 'x', potency: 1 }] },
      1,
    );
    expect(base.pulls).toBe(1); // 100% potency -> +1
    expect(base.boons).toHaveLength(0); // boon consumed

    // "+2 more per 50% Potency above 100%" — 150% is one step, 200% is two.
    const mid = simOpalOnCurses(
      { ...withMissions(['opal_offering']), boons: [{ id: 'x', potency: 1.5 }] },
      1,
    );
    expect(mid.pulls).toBe(3); // 1 + (1 step x 2)

    const strong = simOpalOnCurses(
      { ...withMissions(['opal_offering']), boons: [{ id: 'x', potency: 2 }] },
      1,
    );
    expect(strong.pulls).toBe(5); // 1 + (2 steps x 2)
  });

  it('Opal cannot pay without boons to eat', () => {
    const s = simOpalOnCurses(withMissions(['opal_offering']), 3);
    expect(s.pulls).toBe(0);
  });
});

describe('direct pull income', () => {
  it('Porphyrophobia doubles purple pulls', () => {
    const plain = simBeaconTaken(withMissions([]), { color: 'purple' }, 0);
    const porph = simBeaconTaken(withMissions(['porphyrophobia']), { color: 'purple' }, 0);
    // The engine credits base pulls before this runs, so compare the delta.
    expect(porph.pulls - plain.pulls).toBe(2);
  });

  it('High Roller pays a flat 10 pulls and a reward reroll on acquisition', () => {
    const s = simMissionAcquired(withMissions([]), 'high_roller');
    expect(s.pulls).toBe(10);
    expect(s.rewardRerolls).toBe(1);
  });

  it('Knife Edge pays more the closer the run is to ending', () => {
    const far = simChallengeCompleted(withMissions(['knife_edge'], { challengesRemaining: 30 }), false);
    const near = simChallengeCompleted(withMissions(['knife_edge'], { challengesRemaining: 2 }), false);
    expect(far.pulls).toBe(0); // 7 - 30 floored at 0
    expect(near.pulls).toBe(5); // 7 - 2
  });

  it('Thrill Seeker only pays on a red challenge', () => {
    const red = simChallengeCompleted(withMissions(['thrill_seeker']), true);
    const notRed = simChallengeCompleted(withMissions(['thrill_seeker']), false);
    expect(red.pulls).toBeGreaterThan(0);
    expect(notRed.pulls).toBe(0);
  });

  it('Sacrificial Ritual trades a pull for challenges', () => {
    const s = simChallengeCompleted(
      withMissions(['sacrificial_ritual'], { pulls: 5, challengesRemaining: 10 }),
      false,
    );
    expect(s.pulls).toBe(4);
    expect(s.challengesRemaining).toBe(13);
  });
});

describe('un-activated missions earn nothing', () => {
  it('a pending Hoarder does not convert chests', () => {
    const pending = createRun({
      dailyBonus: false,
      missions: [{ id: 'hoarder', fulfilled: false }],
      flyingChests: 12,
    });
    const s = simBeaconTaken(pending, { color: 'red' }, 0);
    expect(s.boons).toHaveLength(0);
    expect(s.flyingChests).toBe(12);
  });
});
