/**
 * Pure run-state transitions. No React, no I/O, no opinions.
 * Every function returns a new state; nothing mutates its input.
 */

import {
  BEACON_COLORS,
  MAX_TIER,
  type BeaconColor,
  type MissionSlot,
  type OfferedBeacon,
  type RunState,
  type Tier,
} from './types';
import {
  AVAILABILITY,
  BEACONS,
  BEACON_MIN_RANK,
  DEFAULT_RANK,
  RUN_CONSTANTS as C,
  baseChoicesFor,
  dailyBonusFor,
  rankIndex,
  startingRerollsFor,
} from './data';

export function createRun(overrides: Partial<RunState> = {}): RunState {
  const rank = overrides.rank ?? DEFAULT_RANK;
  const dailyBonus = overrides.dailyBonus ?? true;
  const silverbull = overrides.silverbull ?? false;
  // Runs do NOT start from zero: the daily bonus is an opening endowment.
  const daily = dailyBonus
    ? dailyBonusFor(rank, silverbull)
    : { pulls: 0, rewardRerolls: 0 };
  return {
    rank,
    dailyBonus,
    silverbull,
    challengesCompleted: 0,
    challengesRemaining: C.startingChallenges,
    timeRemaining: C.timeCapSeconds,
    totalTimeGained: 0,
    orangeStacks: [],
    gourmandChoices: 0,
    // Rank-derived: 0 below Assistant I, 1 to Admiral, 2 from Admiral up.
    beaconRerolls: startingRerollsFor(rank),
    rewardRerolls: daily.rewardRerolls,
    sacrifices: 0,
    pulls: daily.pulls,
    curses: { generic: 0, radiance: 0 },
    boons: [],
    missions: [],
    trials: [],
    pendingAqua: 0,
    rainbowChallengesLeft: 0,
    beaconUses: {},
    excludedNext: [],
    chestsOpened: 0,
    mobsKilled: 0,
    deaths: 0,
    flags: { hubris: false, boonsDisabled: false, cannotGainTime: false },
    ...overrides,
  };
}

const uses = (s: RunState, c: BeaconColor) => s.beaconUses[c] ?? 0;

/** The 15-minute cap is SOFT: it caps the display, not what missions count. */
export const isOvercapped = (s: RunState) => s.timeRemaining >= C.timeCapSeconds;

/**
 * Grant time. The displayed timer saturates at the soft cap, but the full
 * amount accrues to `totalTimeGained` because Backup Beat and other
 * timer-requirement missions read cumulative gain, overflow included.
 */
function grantTime(state: RunState, seconds: number): RunState {
  return {
    ...state,
    timeRemaining: Math.min(C.timeCapSeconds, state.timeRemaining + seconds),
    totalTimeGained: state.totalTimeGained + seconds,
  };
}

/**
 * Time granted by starting/completing a challenge. Unlike beacon time, this
 * does NOT register at all while already overcapped — so sitting at the cap
 * actively forfeits the +60s/+90s grants.
 */
function grantChallengeTime(state: RunState, seconds: number): RunState {
  if (state.flags.cannotGainTime || isOvercapped(state)) return state;
  return grantTime(state, seconds);
}

const spendTime = (s: RunState, sec: number): RunState => ({
  ...s,
  timeRemaining: Math.max(0, s.timeRemaining - sec),
});

/**
 * Beacon choices are DERIVED, never stored — storing them alongside the orange
 * stacks would let the two drift out of sync.
 */
export function beaconChoices(state: RunState): number {
  const fromOrange = state.orangeStacks.reduce((n, o) => n + o.bonus, 0);
  return Math.min(
    baseChoicesFor(state.rank) + fromOrange + state.gourmandChoices,
    C.maxBeaconChoices,
  );
}

/** Has this beacon hit its per-run use cap? */
export function isExhausted(state: RunState, color: BeaconColor): boolean {
  const max = BEACONS[color].maxUses;
  return max !== undefined && uses(state, color) >= max;
}

/** A mission taken but not yet fulfilled — blocks further grey beacons. */
export const pendingMission = (s: RunState): MissionSlot | undefined =>
  s.missions.find((m) => !m.fulfilled);

/**
 * The first mission is FORCED: completing challenge 4 offers a 3-way mission
 * choice automatically, with no grey beacon involved. Until it is taken the
 * run is effectively paused on that decision, so the UI must demand it rather
 * than wait for the player to open a picker.
 */
export const firstMissionDue = (s: RunState): boolean =>
  s.challengesCompleted >= C.firstMissionAtChallenge && s.missions.length === 0;

/** Is this colour inside its availability window AND unlocked by rank? */
export function isUnlocked(state: RunState, color: BeaconColor): boolean {
  if (rankIndex(state.rank) < BEACON_MIN_RANK[color]) return false;
  // Only one mission processes at a time: grey will not reappear while a
  // mission is still being fulfilled.
  if (color === 'grey' && pendingMission(state)) return false;
  const w = AVAILABILITY[color];
  if (!w) return true;
  const n = state.challengesCompleted;
  if (w.minChallenges !== undefined && n < w.minChallenges) return false;
  if (w.maxChallenges !== undefined && n > w.maxChallenges) return false;
  return true;
}

/** Excluded because it was OFFERED last challenge. */
export function isExcluded(state: RunState, color: BeaconColor): boolean {
  return state.excludedNext.includes(color);
}

/**
 * Every colour that could legally be offered right now.
 * This is the input to the offer model and to reroll reasoning.
 */
export function legalColors(state: RunState): BeaconColor[] {
  return BEACON_COLORS.filter(
    (c) => !isExhausted(state, c) && isUnlocked(state, c) && !isExcluded(state, c),
  );
}

/**
 * Record the offer shown to the player.
 *
 * The exclusion set is built from EVERY colour offered — not the one taken.
 * Seeing a beacon is what removes it from next challenge's pool, which is why
 * an offer can be used deliberately to thin the pool.
 */
export function recordOffer(state: RunState, offer: OfferedBeacon[]): RunState {
  const excluded = offer
    .map((o) => o.color)
    .filter((c) => BEACONS[c].noRepeatAfterOffer === true);
  return { ...state, excludedNext: [...new Set(excluded)] };
}

/** Effective tier: base 0, +1 if vibrant, + any banked aqua, capped at 3. */
export function resolveTier(state: RunState, beacon: OfferedBeacon): Tier {
  const vibrant = beacon.vibrant || state.rainbowChallengesLeft > 0;
  const raw = (vibrant ? 1 : 0) + state.pendingAqua;
  return Math.min(raw, MAX_TIER) as Tier;
}

export class IllegalMoveError extends Error {}

/**
 * Take a beacon.
 *
 * Applies STRUCTURAL effects only — use counters, choice counts, challenge
 * counts, time, rerolls, tier bookkeeping. Reward magnitudes (pulls, boon
 * potency, chest counts) are deliberately not applied here: those numbers are
 * disputed across sources and belong to the scoring layer reading `data/`.
 */
export function takeBeacon(state: RunState, beacon: OfferedBeacon): RunState {
  const { color } = beacon;

  if (isExhausted(state, color)) {
    throw new IllegalMoveError(`${color} has hit its use cap`);
  }
  if (!isUnlocked(state, color)) {
    throw new IllegalMoveError(`${color} is not available at challenge ${state.challengesCompleted}`);
  }

  const tier = resolveTier(state, beacon);
  let next: RunState = {
    ...state,
    beaconUses: { ...state.beaconUses, [color]: uses(state, color) + 1 },
    // Aqua is consumed by whatever beacon it boosted.
    pendingAqua: 0,
  };

  // All magnitudes come from data/beacons.json `tiers`, never from formulas.
  const t = BEACONS[color].tiers as Record<string, number[] | number | undefined>;
  const at = (key: string): number | undefined => {
    const v = t[key];
    return Array.isArray(v) ? v[tier] : undefined;
  };

  switch (color) {
    case 'aqua':
      // An aqua's empowerment is its OWN resolved tier + 1, capped at 3
      // (guide: "maximum stacking of 3 with power capped at 400%"). This is
      // what makes chaining work: a vibrant aqua (tier 1) banks 2; a vibrant
      // aqua taken under that bank resolves at tier 3 and banks the max 3.
      next.pendingAqua = Math.min(MAX_TIER, tier + 1);
      break;
    case 'orange':
      // Independent stack. Tier affects DURATION, not the choice bonus.
      next.orangeStacks = [
        ...state.orangeStacks,
        {
          bonus: (t.extraChoices as number) ?? 1,
          challengesLeft: at('durationChallenges') ?? C.orangeDurationChallenges,
        },
      ];
      break;
    case 'pink':
      next.beaconRerolls = state.beaconRerolls + (at('rerolls') ?? 1);
      break;
    case 'green':
      // Beacon time DOES register while overcapped — the overflow is invisible
      // on the timer but still counts toward Backup Beat.
      if (!state.flags.cannotGainTime) {
        next = grantTime(next, at('seconds') ?? 0);
      }
      break;
    case 'rainbow':
      next.rainbowChallengesLeft = at('vibrantChallenges') ?? 0;
      break;
    case 'white':
    case 'red':
      next.challengesRemaining = Math.min(
        C.maxChallenges,
        state.challengesRemaining + (at('challenges') ?? 0),
      );
      break;
    case 'purple':
    case 'darkGrey':
      // Curse TYPE is assigned by the game per challenge; we count them as
      // generic until the type is known (the UI can reclassify to radiance).
      next.curses = {
        ...state.curses,
        generic: state.curses.generic + (at('curses') ?? 0),
      };
      next.pulls = state.pulls + (at('pulls') ?? 0);
      break;
    default:
      break;
  }

  return next;
}

/** Beginning a challenge grants time. */
export function startChallenge(state: RunState): RunState {
  if (state.challengesRemaining <= 0) {
    throw new IllegalMoveError('no challenges remaining');
  }
  // Gourmand's bonus is per-challenge and does not carry over.
  return grantChallengeTime({ ...state, gourmandChoices: 0 }, C.timeOnChallengeStart);
}

/**
 * Spend a beacon reroll. With Gourmand held this also buys choices, which is
 * what makes the reroll_spam archetype work.
 */
export function useReroll(state: RunState, hasGourmand = false): RunState {
  if (state.beaconRerolls <= 0) {
    throw new IllegalMoveError('no beacon rerolls remaining');
  }
  return {
    ...state,
    beaconRerolls: state.beaconRerolls - 1,
    gourmandChoices: hasGourmand
      ? state.gourmandChoices + C.gourmandChoicesPerReroll
      : state.gourmandChoices,
  };
}

/** Completing a challenge grants time and advances every per-challenge counter. */
export function completeChallenge(state: RunState): RunState {
  const timed = grantChallengeTime(state, C.timeOnChallengeComplete);
  return {
    ...timed,
    challengesCompleted: state.challengesCompleted + 1,
    challengesRemaining: state.challengesRemaining - 1,
    // Each orange ticks and expires independently. A duration-D orange must
    // boost exactly D offers, and each offer sits AFTER a completion — so a
    // stack stays active at challengesLeft 0 (its final boosted offer) and is
    // removed only when it would go below 0. Filtering at > 0 would boost
    // D-1 offers: a classic off-by-one.
    orangeStacks: state.orangeStacks
      .map((o) => ({ ...o, challengesLeft: o.challengesLeft - 1 }))
      .filter((o) => o.challengesLeft >= 0),
    rainbowChallengesLeft: Math.max(0, state.rainbowChallengesLeft - 1),
  };
}

/**
 * Death: costs time and voids a banked aqua boost.
 * NOTE: dying DURING a challenge additionally fails it — the UI should
 * compose `die` + `failChallenge` in that case. Kept separate because a
 * death between challenges (interlude) costs time without failing anything.
 */
export function die(state: RunState): RunState {
  return {
    ...spendTime(state, C.timeLostOnDeath),
    deaths: state.deaths + 1,
    pendingAqua: 0,
  };
}

/**
 * A failed/abandoned challenge is consumed with no completion rewards: the
 * challenge counter advances nothing, but the remaining pool shrinks and
 * per-challenge timers still tick (the challenge did happen).
 */
export function failChallenge(state: RunState): RunState {
  if (state.challengesRemaining <= 0) {
    throw new IllegalMoveError('no challenges remaining');
  }
  return {
    ...state,
    challengesRemaining: state.challengesRemaining - 1,
    orangeStacks: state.orangeStacks
      .map((o) => ({ ...o, challengesLeft: o.challengesLeft - 1 }))
      .filter((o) => o.challengesLeft >= 0),
    rainbowChallengesLeft: Math.max(0, state.rainbowChallengesLeft - 1),
  };
}

/**
 * Gain a boon. `potency` is a multiplier (1 = 100%). Identity is optional:
 * a boon counter is accurate without knowing WHICH boon (Midas/Lightbringer
 * caps, Opal consumption, Warmth Devourer's boonless exploit all read count
 * or potency) — only Ostinato and boon-pick advice need the specific type.
 */
export function gainBoon(
  state: RunState,
  boon: { id?: string; potency?: number } = {},
): RunState {
  return {
    ...state,
    boons: [...state.boons, { id: boon.id ?? 'unknown', potency: boon.potency ?? 1 }],
  };
}

export function removeBoon(state: RunState, index: number): RunState {
  return { ...state, boons: state.boons.filter((_, i) => i !== index) };
}

/**
 * Take a mission from a grey beacon. It starts UNFULFILLED with a randomized
 * activation objective — no effect until that objective is completed.
 */
export function takeMission(state: RunState, id: string, objective?: string): RunState {
  if (pendingMission(state)) {
    throw new IllegalMoveError('a mission is already processing');
  }
  if (state.missions.some((m) => m.id === id)) {
    throw new IllegalMoveError(`${id} is already held`);
  }
  return { ...state, missions: [...state.missions, { id, fulfilled: false, objective }] };
}

/** Mark a mission fulfilled, which frees grey beacons to appear again. */
export function fulfilMission(state: RunState, id: string): RunState {
  return {
    ...state,
    missions: state.missions.map((m) => (m.id === id ? { ...m, fulfilled: true } : m)),
  };
}

export function removeMission(state: RunState, id: string): RunState {
  return { ...state, missions: state.missions.filter((m) => m.id !== id) };
}

export function relabelBoon(state: RunState, index: number, id: string): RunState {
  return {
    ...state,
    boons: state.boons.map((b, i) => (i === index ? { ...b, id } : b)),
  };
}

export const isFinalChallenge = (s: RunState) => s.challengesRemaining === 1;
export const totalCurses = (s: RunState) => s.curses.generic + s.curses.radiance;
