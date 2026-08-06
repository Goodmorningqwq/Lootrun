/**
 * Mission effects for SIMULATION only.
 *
 * The engine (engine.ts) models mechanics the tracker must get exactly right —
 * legality, tiers, timers, counters. It deliberately does not apply reward
 * magnitudes, because those were disputed across sources.
 *
 * This module is different: it is an approximate economic model used by the
 * Monte Carlo rollout so that `E[pulls]` actually responds to boons and mission
 * effects. Without it the simulator is blind to most of what the advisor
 * optimises for — orange, grey, aqua and blue convert to pulls only indirectly,
 * so every option scored nearly the same and the weights could not be tuned.
 *
 * APPROXIMATIONS, stated rather than hidden:
 *  - Items per flying chest is a constant (real chests vary).
 *  - Radiant mob kills per challenge is a constant (depends on the challenge).
 *  - Jester's Trick's four random outcomes are applied at their mean.
 *  - Boon potency contributes to pulls through Opal/Ostinato only.
 *
 * Do NOT import this into the tracker's advice path. It exists to make the
 * simulator's ranking meaningful, not to state facts about the game.
 */

import { BEACONS } from './data';
import { gainBoon } from './engine';
import type { OfferedBeacon, RunState, Tier } from './types';

/** Tunable constants for the economic model. All approximate by construction. */
export const SIM_ECONOMY = {
  itemsPerFlyingChest: 4,
  radiantMobsPerChallenge: 2,
  /** Hoarder: flying chests consumed per boon granted (2.2.1 value). */
  hoarderChestsPerBoon: 6,
  hoarderBoonPotency: 2,
  /** Jester's Trick fires per N items; mean of its four outcomes ≈ +1.4 pulls. */
  jesterItemsPerProc: 25,
  jesterMeanPulls: 1.4,
  /** Interest Scheme: pulls needed per extra flying chest on the next yellow. */
  interestPullsPerChest: 2,
  interestMaxChests: 12,
} as const;

const active = (s: RunState, id: string) =>
  s.missions.some((m) => m.id === id && m.fulfilled);

const tierValue = (color: keyof typeof BEACONS, key: string, tier: Tier): number => {
  const t = BEACONS[color].tiers as Record<string, unknown>;
  const arr = t[key];
  return Array.isArray(arr) ? ((arr as number[])[tier] ?? 0) : 0;
};

/** Boons whose potency exceeds 100% pay Opal Offering extra. */
function opalPullsFor(potency: number): number {
  const over = Math.max(0, potency - 1);
  return 1 + Math.floor(over / 0.5) * 2;
}

/**
 * Apply what a beacon yields beyond the structural effects the engine already
 * handles: chests, boons, and the pull multipliers missions place on them.
 */
export function simBeaconTaken(
  state: RunState,
  beacon: OfferedBeacon,
  tier: Tier,
): RunState {
  let s = state;

  switch (beacon.color) {
    case 'yellow': {
      let chests = tierValue('yellow', 'flyingChests', tier);
      if (active(s, 'interest_scheme')) {
        chests += Math.min(
          SIM_ECONOMY.interestMaxChests,
          Math.floor(s.pulls / SIM_ECONOMY.interestPullsPerChest),
        );
      }
      if (active(s, 'materialism')) chests += 2;
      s = { ...s, flyingChests: s.flyingChests + chests };
      break;
    }
    case 'blue': {
      const potency = tierValue('blue', 'potencyPct', tier) / 100;
      s = simGainBoon(s, potency);
      break;
    }
    case 'purple':
    case 'darkGrey': {
      // The engine already credited base pulls/curses; Porphyrophobia doubles
      // purple's pulls on top of that.
      if (beacon.color === 'purple' && active(s, 'porphyrophobia')) {
        s = { ...s, pulls: s.pulls + tierValue('purple', 'pulls', tier) };
      }
      // Opal converts each incoming curse into pulls by eating a boon.
      const curses = tierValue(beacon.color, 'curses', tier);
      if (active(s, 'opal_offering')) s = simOpalOnCurses(s, curses);
      break;
    }
    default:
      break;
  }

  return simConsumeChests(s);
}

/** A boon arrived — Ostinato pays for duplicates of a type already held. */
export function simGainBoon(state: RunState, potency: number): RunState {
  let s = gainBoon(state, { potency });
  if (active(s, 'ostinato')) {
    // Rollout boons are unnamed, so "duplicate type" is approximated by how
    // many boons are already held — the shape Ostinato rewards.
    const duplicates = Math.max(0, s.boons.length - 1);
    if (duplicates > 0) s = { ...s, pulls: s.pulls + duplicates };
  }
  return s;
}

/** Opal Offering: each curse consumes a boon for pulls scaled by its potency. */
export function simOpalOnCurses(state: RunState, curses: number): RunState {
  let s = state;
  for (let i = 0; i < curses && s.boons.length > 0; i++) {
    const consumed = s.boons[s.boons.length - 1]!;
    s = {
      ...s,
      boons: s.boons.slice(0, -1),
      pulls: s.pulls + opalPullsFor(consumed.potency),
    };
  }
  return s;
}

/** Hoarder turns accumulated flying chests into boons; Jester's pays on items. */
export function simConsumeChests(state: RunState): RunState {
  let s = state;

  if (active(s, 'hoarder')) {
    const boons = Math.floor(s.flyingChests / SIM_ECONOMY.hoarderChestsPerBoon);
    if (boons > 0) {
      s = { ...s, flyingChests: s.flyingChests % SIM_ECONOMY.hoarderChestsPerBoon };
      for (let i = 0; i < boons; i++) s = simGainBoon(s, SIM_ECONOMY.hoarderBoonPotency);
    }
  }

  if (active(s, 'jesters_trick')) {
    const items = s.flyingChests * SIM_ECONOMY.itemsPerFlyingChest;
    const procs = Math.floor(items / SIM_ECONOMY.jesterItemsPerProc);
    if (procs > 0) s = { ...s, pulls: s.pulls + Math.round(procs * SIM_ECONOMY.jesterMeanPulls) };
  }

  return s;
}

/** Per-challenge mission income. */
export function simChallengeCompleted(state: RunState, tookRed: boolean): RunState {
  let s = state;

  if (active(s, 'materialism')) s = { ...s, flyingChests: s.flyingChests + 2 };

  if (active(s, 'radiant_hunter')) {
    s = { ...s, pulls: s.pulls + Math.min(5, SIM_ECONOMY.radiantMobsPerChallenge) };
  }

  if (tookRed && active(s, 'thrill_seeker')) {
    const bonus = Math.min(3, 1 + Math.floor(s.challengesCompleted / 7));
    s = { ...s, pulls: s.pulls + bonus };
  }

  if (active(s, 'knife_edge')) {
    s = { ...s, pulls: s.pulls + Math.max(0, 7 - s.challengesRemaining) };
  }

  if (active(s, 'sacrificial_ritual') && s.pulls >= 1) {
    s = { ...s, pulls: s.pulls - 1, challengesRemaining: s.challengesRemaining + 3 };
  }

  return simConsumeChests(s);
}

/** Flat, one-off pulls granted the moment a mission is acquired. */
export function simMissionAcquired(state: RunState, id: string): RunState {
  if (id === 'high_roller') {
    return { ...state, pulls: state.pulls + 10, rewardRerolls: state.rewardRerolls + 1 };
  }
  if (id === 'redemption') return { ...state, sacrifices: state.sacrifices + 1 };
  return state;
}
