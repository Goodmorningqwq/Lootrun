import { describe, expect, it } from 'vitest';
import {
  beaconChoices,
  completeChallenge,
  createRun,
  die,
  failChallenge,
  firstMissionDue,
  fulfilMission,
  gainBoon,
  pendingMission,
  relabelBoon,
  removeBoon,
  takeMission,
  useReroll,
  isExcluded,
  isExhausted,
  isUnlocked,
  IllegalMoveError,
  legalColors,
  recordOffer,
  resolveTier,
  startChallenge,
  takeBeacon,
} from './engine';
import {
  BEACONS,
  RUN_CONSTANTS as C,
  baseChoicesFor,
  boonChoicesFor,
  vibrancyChanceFor,
} from './data';
import type { RunState } from './types';

/** Base beacon choices at the default rank (Grandmaster) — 3. */
const BASE = baseChoicesFor('grandmaster');

/** Advance n challenges without caring about beacons. */
const advance = (s: RunState, n: number): RunState =>
  Array.from({ length: n }).reduce<RunState>((acc) => completeChallenge(acc), s);

describe('data integrity', () => {
  it('defines all 13 beacons', () => {
    expect(Object.keys(BEACONS)).toHaveLength(13);
  });

  it('self-exclusion is red and green ONLY', () => {
    const flagged = Object.values(BEACONS)
      .filter((b) => b.noRepeatAfterOffer === true)
      .map((b) => b.id)
      .sort();
    expect(flagged).toEqual(['green', 'red']);
  });

  it('aqua and orange are re-offerable (changed in a recent patch)', () => {
    expect(BEACONS.aqua.noRepeatAfterOffer).toBe(false);
    expect(BEACONS.orange.noRepeatAfterOffer).toBe(false);
  });

  it('darkGrey/white/grey disappear via use caps, not exclusion', () => {
    for (const c of ['darkGrey', 'white', 'grey'] as const) {
      expect(BEACONS[c].noRepeatAfterOffer).toBe(false);
      expect(BEACONS[c].maxUses).toBeGreaterThan(0);
    }
  });
});

describe('offer exclusion', () => {
  it('excludes a colour that was OFFERED, not merely taken', () => {
    const s = recordOffer(createRun(), [
      { color: 'blue' },
      { color: 'purple' },
      { color: 'green' },
    ]);
    // Green was offered but NOT taken — still gone next challenge.
    expect(isExcluded(s, 'green')).toBe(true);
    expect(legalColors(s)).not.toContain('green');
  });

  it('leaves aqua and orange available after being offered', () => {
    const s = recordOffer(createRun(), [{ color: 'aqua' }, { color: 'orange' }]);
    expect(isExcluded(s, 'aqua')).toBe(false);
    expect(isExcluded(s, 'orange')).toBe(false);
  });

  it('excludes both red and green from one offer', () => {
    const s = recordOffer(createRun(), [
      { color: 'red' },
      { color: 'green' },
      { color: 'blue' },
    ]);
    expect([...s.excludedNext].sort()).toEqual(['green', 'red']);
  });

  it('clears the exclusion once a new offer is recorded', () => {
    let s = recordOffer(createRun(), [{ color: 'green' }]);
    expect(isExcluded(s, 'green')).toBe(true);
    s = recordOffer(s, [{ color: 'blue' }]);
    expect(isExcluded(s, 'green')).toBe(false);
  });

  it('a declined green is unavailable next challenge (take-now-or-lose-it)', () => {
    const s = recordOffer(createRun({ timeRemaining: 100 }), [
      { color: 'green' },
      { color: 'blue' },
    ]);
    expect(legalColors(s)).not.toContain('green');
  });
});

describe('use caps', () => {
  it('exhausts white after 1 use', () => {
    const s = takeBeacon(createRun(), { color: 'white' });
    expect(isExhausted(s, 'white')).toBe(true);
    expect(() => takeBeacon(s, { color: 'white' })).toThrow(IllegalMoveError);
  });

  it('allows grey exactly 3 times', () => {
    let s = advance(createRun(), 4);
    for (let i = 0; i < 3; i++) s = takeBeacon(s, { color: 'grey' });
    expect(isExhausted(s, 'grey')).toBe(true);
  });

  it('does not cap blue before 30', () => {
    let s = createRun();
    for (let i = 0; i < 29; i++) s = takeBeacon(s, { color: 'blue' });
    expect(isExhausted(s, 'blue')).toBe(false);
    s = takeBeacon(s, { color: 'blue' });
    expect(isExhausted(s, 'blue')).toBe(true);
  });
});

describe('availability windows', () => {
  it('locks rainbow before 10 challenges completed', () => {
    expect(isUnlocked(createRun(), 'rainbow')).toBe(false);
    expect(isUnlocked(advance(createRun(), 10), 'rainbow')).toBe(true);
  });

  it('locks crimson before 20 challenges completed', () => {
    expect(isUnlocked(advance(createRun(), 19), 'crimson')).toBe(false);
    expect(isUnlocked(advance(createRun(), 20), 'crimson')).toBe(true);
  });

  it('opens grey at 4 and closes it after 30', () => {
    expect(isUnlocked(advance(createRun(), 3), 'grey')).toBe(false);
    expect(isUnlocked(advance(createRun(), 4), 'grey')).toBe(true);
    expect(isUnlocked(advance(createRun(), 31), 'grey')).toBe(false);
  });

  it('rejects taking a locked beacon', () => {
    expect(() => takeBeacon(createRun(), { color: 'rainbow' })).toThrow(IllegalMoveError);
  });
});

describe('tier resolution', () => {
  it('is 0 for a plain beacon', () => {
    expect(resolveTier(createRun(), { color: 'blue' })).toBe(0);
  });

  it('is 1 when vibrant', () => {
    expect(resolveTier(createRun(), { color: 'blue', vibrant: true })).toBe(1);
  });

  it('adds a banked aqua to a vibrant beacon', () => {
    const s = takeBeacon(createRun(), { color: 'aqua' });
    expect(resolveTier(s, { color: 'white', vibrant: true })).toBe(2);
  });

  it('caps at tier 3', () => {
    const s = takeBeacon(createRun(), { color: 'aqua', vibrant: true });
    expect(resolveTier(s, { color: 'white', vibrant: true })).toBe(3);
  });

  it('treats rainbow as granting vibrancy', () => {
    const s = takeBeacon(advance(createRun(), 10), { color: 'rainbow' });
    expect(s.rainbowChallengesLeft).toBeGreaterThan(0);
    expect(resolveTier(s, { color: 'blue' })).toBe(1);
  });

  it('consumes the banked aqua on the next beacon', () => {
    let s = takeBeacon(createRun(), { color: 'aqua' });
    expect(s.pendingAqua).toBe(1);
    s = takeBeacon(s, { color: 'blue' });
    expect(s.pendingAqua).toBe(0);
  });

  /**
   * Aqua chaining: an aqua's empowerment is its own resolved tier + 1.
   * Guide: "maximum stacking of 3 with power capped at 400%".
   */
  it('chains aquas: plain then plain banks 2', () => {
    let s = takeBeacon(createRun(), { color: 'aqua' }); // tier 0 -> banks 1
    s = takeBeacon(s, { color: 'aqua' }); // tier 1 -> banks 2
    expect(s.pendingAqua).toBe(2);
  });

  it('chains aquas: vibrant then vibrant reaches the bank cap of 3', () => {
    let s = takeBeacon(createRun(), { color: 'aqua', vibrant: true }); // banks 2
    s = takeBeacon(s, { color: 'aqua', vibrant: true }); // tier 3 -> capped 3
    expect(s.pendingAqua).toBe(3);
  });
});

describe('purple and dark grey grants', () => {
  /** No daily bonus, so pulls isolate the beacon's own grant. */
  const bare = () => createRun({ dailyBonus: false });

  it('purple grants 2 curses and 2 pulls at tier 0', () => {
    const s = takeBeacon(bare(), { color: 'purple' });
    expect(s.curses.generic).toBe(2);
    expect(s.pulls).toBe(2);
  });

  it('vibrant dark grey grants 10 curses and 10 pulls', () => {
    const s = takeBeacon(bare(), { color: 'darkGrey', vibrant: true });
    expect(s.curses.generic).toBe(10);
    expect(s.pulls).toBe(10);
  });

  it('aqua-boosted purple doubles to tier 1 amounts', () => {
    let s = takeBeacon(bare(), { color: 'aqua' });
    s = takeBeacon(s, { color: 'purple' }); // tier 1: 4 curses, 4 pulls
    expect(s.curses.generic).toBe(4);
    expect(s.pulls).toBe(4);
  });

  it('stacks on top of the daily bonus when it is active', () => {
    const s = takeBeacon(createRun(), { color: 'purple' }); // 10 daily + 2
    expect(s.pulls).toBe(12);
  });
});

describe('division ranks', () => {
  it('defaults to grandmaster with 2 rerolls and 3 base choices', () => {
    const s = createRun();
    expect(s.rank).toBe('grandmaster');
    expect(s.beaconRerolls).toBe(2);
    expect(beaconChoices(s)).toBe(3);
  });

  it('boon choices are 3 below Sentinel II, 4 from Sentinel II', () => {
    expect(boonChoicesFor('sentinel_1')).toBe(3);
    expect(boonChoicesFor('grandmaster')).toBe(4);
  });

  it('vibrancy is 0 below Assistant III, 5% there, 10% from Elite II', () => {
    expect(vibrancyChanceFor('sentinel_1')).toBeCloseTo(0.05);
    expect(vibrancyChanceFor('assistant_2')).toBe(0);
    expect(vibrancyChanceFor('elite_2')).toBeCloseTo(0.1);
  });
});

describe('daily bonus', () => {
  it('a run opens with the daily bonus, not from zero', () => {
    const s = createRun();
    expect(s.pulls).toBe(10);
    expect(s.rewardRerolls).toBe(1);
  });

  it('withholds the reward reroll below Elite II, but still grants pulls', () => {
    const s = createRun({ rank: 'elite_1' });
    expect(s.pulls).toBe(10);
    expect(s.rewardRerolls).toBe(0);
  });

  it('silverbull doubles the daily bonus', () => {
    const s = createRun({ silverbull: true });
    expect(s.pulls).toBe(20);
    expect(s.rewardRerolls).toBe(2);
  });

  it('grants nothing when the daily bonus is already used for this camp', () => {
    const s = createRun({ dailyBonus: false });
    expect(s.pulls).toBe(0);
    expect(s.rewardRerolls).toBe(0);
  });

  it('derives starting rerolls from rank: rookie 0, assistant 1, admiral 2', () => {
    expect(createRun({ rank: 'rookie_1' }).beaconRerolls).toBe(0);
    expect(createRun({ rank: 'assistant_1' }).beaconRerolls).toBe(1);
    expect(createRun({ rank: 'admiral' }).beaconRerolls).toBe(2);
  });

  it('base choices are 2 below Sentinel II, 3 from Sentinel II', () => {
    expect(beaconChoices(createRun({ rank: 'sentinel_1' }))).toBe(2);
    expect(beaconChoices(createRun({ rank: 'sentinel_2' }))).toBe(3);
  });

  it('rank gates beacon availability', () => {
    const rookie = createRun({ rank: 'rookie_1' });
    expect(isUnlocked(rookie, 'aqua')).toBe(false); // Rookie II unlock
    expect(isUnlocked(rookie, 'red')).toBe(false); // Elite III unlock
    expect(isUnlocked(rookie, 'blue')).toBe(true); // never gated

    const elite3 = createRun({ rank: 'elite_3' });
    expect(isUnlocked(elite3, 'red')).toBe(true);
    expect(isUnlocked(elite3, 'pink')).toBe(false); // Admiral unlock

    expect(() => takeBeacon(rookie, { color: 'red' })).toThrow(IllegalMoveError);
  });

  it('rank gate composes with challenge windows: Master still needs 20 challenges for crimson', () => {
    const master = createRun({ rank: 'master' });
    expect(isUnlocked(master, 'crimson')).toBe(false); // rank ok, challenge not
    expect(isUnlocked(advance(master, 20), 'crimson')).toBe(true);
  });
});

describe('forced first mission', () => {
  it('is not due before challenge 4', () => {
    expect(firstMissionDue(advance(createRun(), 3))).toBe(false);
  });

  it('fires on completing challenge 4, with no grey beacon involved', () => {
    expect(firstMissionDue(advance(createRun(), 4))).toBe(true);
  });

  it('stays due until a mission is actually taken', () => {
    expect(firstMissionDue(advance(createRun(), 9))).toBe(true);
  });

  it('clears once the first mission is taken', () => {
    const s = takeMission(advance(createRun(), 4), 'hoarder');
    expect(firstMissionDue(s)).toBe(false);
  });

  it('does not require grey to be available — it is forced, not offered', () => {
    // Grey's own window opens at 4 too, but the forced pick is independent:
    // it stays due even while grey is blocked by a pending mission elsewhere.
    const s = advance(createRun(), 4);
    expect(firstMissionDue(s)).toBe(true);
    expect(takeMission(s, 'high_roller').missions).toHaveLength(1);
  });
});

describe('mission slots and grey blocking', () => {
  const atGrey = () => advance(createRun(), 4);

  it('a taken mission starts unfulfilled', () => {
    const s = takeMission(atGrey(), 'hoarder');
    expect(s.missions).toEqual([{ id: 'hoarder', fulfilled: false }]);
    expect(pendingMission(s)?.id).toBe('hoarder');
  });

  it('grey is blocked while a mission is processing', () => {
    const s = takeMission(atGrey(), 'hoarder');
    expect(isUnlocked(s, 'grey')).toBe(false);
    expect(legalColors(s)).not.toContain('grey');
    expect(() => takeBeacon(s, { color: 'grey' })).toThrow(IllegalMoveError);
  });

  it('fulfilling the mission frees grey again', () => {
    let s = takeMission(atGrey(), 'hoarder');
    s = fulfilMission(s, 'hoarder');
    expect(pendingMission(s)).toBeUndefined();
    expect(isUnlocked(s, 'grey')).toBe(true);
  });

  it('refuses a second mission while one is processing', () => {
    const s = takeMission(atGrey(), 'hoarder');
    expect(() => takeMission(s, 'high_roller')).toThrow(IllegalMoveError);
  });

  it('allows the next mission once the previous is fulfilled', () => {
    let s = takeMission(atGrey(), 'hoarder');
    s = fulfilMission(s, 'hoarder');
    s = takeMission(s, 'high_roller');
    expect(s.missions.map((m) => m.id)).toEqual(['hoarder', 'high_roller']);
  });

  it('refuses a duplicate mission', () => {
    let s = takeMission(atGrey(), 'hoarder');
    s = fulfilMission(s, 'hoarder');
    expect(() => takeMission(s, 'hoarder')).toThrow(IllegalMoveError);
  });
});

describe('boons', () => {
  it('counts a boon without requiring its identity', () => {
    const s = gainBoon(createRun(), { potency: 2 });
    expect(s.boons).toHaveLength(1);
    expect(s.boons[0]).toEqual({ id: 'unknown', potency: 2 });
  });

  it('relabels an unnamed boon later', () => {
    let s = gainBoon(createRun(), { potency: 1 });
    s = relabelBoon(s, 0, 'madman');
    expect(s.boons[0]?.id).toBe('madman');
    expect(s.boons[0]?.potency).toBe(1); // potency untouched by naming
  });

  it('removes a boon by index (Opal Offering consumption)', () => {
    let s = gainBoon(gainBoon(createRun(), { id: 'madman' }), { id: 'killstreak' });
    s = removeBoon(s, 0);
    expect(s.boons.map((b) => b.id)).toEqual(['killstreak']);
  });
});

describe('failing a challenge', () => {
  it('consumes the challenge without counting a completion', () => {
    const s = failChallenge(createRun());
    expect(s.challengesRemaining).toBe(11);
    expect(s.challengesCompleted).toBe(0);
  });

  it('still ticks orange and rainbow timers — the challenge happened', () => {
    const s = failChallenge(takeBeacon(createRun(), { color: 'orange' }));
    expect(s.orangeStacks[0]?.challengesLeft).toBe(4);
  });

  it('refuses with no challenges remaining', () => {
    expect(() => failChallenge(createRun({ challengesRemaining: 0 }))).toThrow(
      IllegalMoveError,
    );
  });
});

describe('time — soft cap semantics', () => {
  it('the displayed timer never exceeds the 15 minute cap', () => {
    const s = takeBeacon(createRun(), { color: 'green' });
    expect(s.timeRemaining).toBe(C.timeCapSeconds);
  });

  /**
   * Guide footnote (1.): time gained above the soft cap still counts toward
   * Backup Beat and other timer requirements, even though it never displays.
   * A model that merely clamps would silently lose it.
   */
  it('credits beacon overflow above the cap to totalTimeGained', () => {
    const s = takeBeacon(createRun({ timeRemaining: C.timeCapSeconds }), { color: 'green' });
    expect(s.timeRemaining).toBe(C.timeCapSeconds); // invisible
    expect(s.totalTimeGained).toBe(210); // but counted
  });

  /**
   * Same footnote, other half: challenge time does NOT register at all while
   * overcapped — so sitting at the cap forfeits the +60s/+90s grants.
   */
  it('registers no challenge time while overcapped', () => {
    const s = createRun({ timeRemaining: C.timeCapSeconds });
    expect(completeChallenge(s).totalTimeGained).toBe(0);
    expect(startChallenge(s).totalTimeGained).toBe(0);
  });

  it('registers challenge time normally below the cap', () => {
    const s = completeChallenge(createRun({ timeRemaining: 100 }));
    expect(s.timeRemaining).toBe(190);
    expect(s.totalTimeGained).toBe(90);
  });

  /**
   * Backup Beat pays +1 reroll per +300s gained. With green at 210s, ONE green
   * plus ONE challenge completion (+90) hits exactly 300 — so Backup Beat is a
   * far more reliable reroll engine than a 60s-per-green model would suggest.
   */
  it('one green plus one completion hits the 300s Backup Beat threshold exactly', () => {
    let s = createRun({ timeRemaining: 0 });
    s = takeBeacon(s, { color: 'green' }); // +210
    s = completeChallenge(s); // +90
    expect(s.totalTimeGained).toBe(300);
  });

  it('grants time on challenge completion', () => {
    const s = completeChallenge(createRun({ timeRemaining: 100 }));
    expect(s.timeRemaining).toBe(190);
  });

  it('costs 60s on death and voids a banked aqua', () => {
    let s = takeBeacon(createRun({ timeRemaining: 300 }), { color: 'aqua' });
    s = die(s);
    expect(s.timeRemaining).toBe(240);
    expect(s.pendingAqua).toBe(0);
    expect(s.deaths).toBe(1);
  });

  it('never goes negative', () => {
    expect(die(createRun({ timeRemaining: 10 })).timeRemaining).toBe(0);
  });

  it('grants no time while Chronotrigger blocks time gain', () => {
    const base = createRun({ timeRemaining: 100 });
    base.flags.cannotGainTime = true;
    expect(completeChallenge(base).timeRemaining).toBe(100);
    expect(startChallenge(base).timeRemaining).toBe(100);
    expect(takeBeacon(base, { color: 'green' }).timeRemaining).toBe(100);
  });
});

describe('orange beacon choices', () => {
  it('grants +1 choice regardless of tier — tier extends DURATION (5/10)', () => {
    const plain = takeBeacon(createRun(), { color: 'orange' });
    const vibrant = takeBeacon(createRun(), { color: 'orange', vibrant: true });

    expect(beaconChoices(plain)).toBe(BASE + 1);
    expect(beaconChoices(vibrant)).toBe(BASE + 1); // same bonus
    expect(plain.orangeStacks[0]?.challengesLeft).toBe(5); // tier 0
    expect(vibrant.orangeStacks[0]?.challengesLeft).toBe(10); // tier 1
  });

  /**
   * A duration-5 orange must boost exactly 5 offers. Each offer follows a
   * completion, so the stack stays active at challengesLeft 0 (its 5th and
   * final boosted offer) and disappears on the 6th tick.
   */
  it('boosts exactly D offers: still active after 5 ticks, gone after 6', () => {
    const after5 = advance(takeBeacon(createRun(), { color: 'orange' }), 5);
    expect(after5.orangeStacks).toHaveLength(1);
    expect(beaconChoices(after5)).toBe(BASE + 1);

    const after6 = advance(after5, 1);
    expect(after6.orangeStacks).toHaveLength(0);
    expect(beaconChoices(after6)).toBe(BASE);
  });

  /**
   * User's worked example, verbatim (2026-07-22): orange at challenge 1
   * (+1 for 5 challenges), vibrant orange at challenge 2 (+1 for 10) —
   * "you will have 5 offered beacons for the next 5 chals", then it drops.
   * A shared-timer model cannot produce this; independent expiries can.
   *
   * The 5 is what pinned the base at 3: 3 + 1 + 1 = 5. It read as 4 while
   * the base was wrongly 2, which is what surfaced the discrepancy.
   */
  it('reproduces the confirmed scenario: 5 offered beacons, then stepwise expiry', () => {
    let s = takeBeacon(createRun(), { color: 'orange' }); // ch1: D=5
    s = completeChallenge(s); // plain orange: 4 left
    s = takeBeacon(s, { color: 'orange', vibrant: true }); // ch2: D=10

    expect(beaconChoices(s)).toBe(5); // base 3 + 1 + 1 — matches the report

    s = advance(s, 4); // the 4 overlapped challenges (3-6)
    expect(s.orangeStacks).toHaveLength(2); // plain at 0 = last boosted offer
    expect(beaconChoices(s)).toBe(5);

    s = advance(s, 1); // plain orange expires
    expect(s.orangeStacks).toHaveLength(1);
    expect(beaconChoices(s)).toBe(4);

    s = advance(s, 6); // vibrant orange exhausts its 10 offers
    expect(s.orangeStacks).toHaveLength(0);
    expect(beaconChoices(s)).toBe(BASE);
  });

  it('caps total choices at 6', () => {
    let s = createRun();
    for (let i = 0; i < 8; i++) s = takeBeacon(s, { color: 'orange' });
    expect(beaconChoices(s)).toBe(6);
  });
});

describe('data-driven tier magnitudes', () => {
  it('green adds 210/330/450/570s by tier', () => {
    const base = createRun({ timeRemaining: 0 });
    expect(takeBeacon(base, { color: 'green' }).totalTimeGained).toBe(210);
    expect(takeBeacon(base, { color: 'green', vibrant: true }).totalTimeGained).toBe(330);
  });

  it('white adds 15 challenges at tier 0 and 30 at tier 3', () => {
    const t0 = takeBeacon(createRun(), { color: 'white' });
    expect(t0.challengesRemaining).toBe(12 + 15);

    // vibrant aqua -> vibrant white reaches tier 3
    let s = takeBeacon(createRun(), { color: 'aqua', vibrant: true });
    s = takeBeacon(s, { color: 'white', vibrant: true });
    expect(s.challengesRemaining).toBe(12 + 30);
  });

  it('red adds 6 challenges at tier 0', () => {
    expect(takeBeacon(createRun(), { color: 'red' }).challengesRemaining).toBe(12 + 6);
  });

  it('pink grants 2 rerolls at tier 0, 3 when vibrant', () => {
    expect(takeBeacon(createRun(), { color: 'pink' }).beaconRerolls).toBe(2 + 2);
    expect(takeBeacon(createRun(), { color: 'pink', vibrant: true }).beaconRerolls).toBe(2 + 3);
  });

  it('rainbow makes beacons vibrant for 15 challenges at tier 0', () => {
    const s = takeBeacon(advance(createRun(), 10), { color: 'rainbow' });
    expect(s.rainbowChallengesLeft).toBe(15);
  });

  it('never exceeds the 100 challenge ceiling', () => {
    const s = takeBeacon(createRun({ challengesRemaining: 95 }), { color: 'white' });
    expect(s.challengesRemaining).toBe(100);
  });
});

describe('gourmand rerolls', () => {
  it('a run starts with 2 beacon rerolls', () => {
    expect(createRun().beaconRerolls).toBe(2);
  });

  it('grants +2 choices per reroll used', () => {
    const s = useReroll(createRun(), true);
    expect(beaconChoices(s)).toBe(BASE + 2);
  });

  it('reaches the 6-choice cap on the two starting rerolls alone', () => {
    let s = createRun();
    s = useReroll(s, true);
    s = useReroll(s, true);
    expect(beaconChoices(s)).toBe(6);
    expect(s.beaconRerolls).toBe(0);
  });

  it('clears its bonus when the next challenge begins', () => {
    let s = useReroll(createRun(), true);
    s = startChallenge(s);
    expect(beaconChoices(s)).toBe(BASE);
  });

  it('refuses to reroll with none left', () => {
    expect(() => useReroll(createRun({ beaconRerolls: 0 }), true)).toThrow(IllegalMoveError);
  });
});

describe('challenge accounting', () => {
  it('starts at 12 remaining', () => {
    expect(createRun().challengesRemaining).toBe(12);
  });

  it('decrements remaining and increments completed', () => {
    const s = completeChallenge(createRun());
    expect(s.challengesCompleted).toBe(1);
    expect(s.challengesRemaining).toBe(11);
  });

  it('refuses to start a challenge with none remaining', () => {
    expect(() => startChallenge(createRun({ challengesRemaining: 0 }))).toThrow(IllegalMoveError);
  });
});

describe('purity', () => {
  it('does not mutate the input state', () => {
    const s = createRun();
    const snapshot = structuredClone(s);
    takeBeacon(s, { color: 'orange' });
    completeChallenge(s);
    recordOffer(s, [{ color: 'aqua' }]);
    die(s);
    failChallenge(s);
    expect(s).toEqual(snapshot);
  });
});
