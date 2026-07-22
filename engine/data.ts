/**
 * Loads game data from `data/`. Data is the source of truth; code is not.
 * Static JSON imports so the same module runs in Node (tests) and the
 * browser bundle (Next.js) without a filesystem.
 */

import rawBeaconsJson from '../data/beacons.json';
import ranksJson from '../data/ranks.json';
import { BEACON_COLORS, type BeaconColor, type BeaconSpec } from './types';

/** Per-tier magnitudes, indexed [tier0, tier1, tier2, tier3]. */
export interface BeaconTiers {
  [key: string]: unknown;
  rarity?: string;
  seconds?: number[];
  challenges?: number[];
  rerolls?: number[];
  durationChallenges?: number[];
  vibrantChallenges?: number[];
  extraChoices?: number;
  flyingChests?: number[];
  curses?: number[];
  pulls?: number[];
  missionChoices?: number[];
  trialChoices?: number[];
  empowerPct?: number[];
}

interface RawBeaconFile {
  wynncraftVersion: string;
  beacons: Array<{
    id: string;
    name: string;
    maxUses?: number;
    noRepeatAfterOffer: boolean | null;
    tiers?: BeaconTiers;
  }>;
}

const rawBeacons = rawBeaconsJson as unknown as RawBeaconFile;

export const WYNNCRAFT_VERSION = rawBeacons.wynncraftVersion;

export const BEACONS: Record<BeaconColor, BeaconSpec> = (() => {
  const out = {} as Record<BeaconColor, BeaconSpec>;
  for (const b of rawBeacons.beacons) {
    if (!(BEACON_COLORS as readonly string[]).includes(b.id)) {
      throw new Error(`data/beacons.json: unknown beacon id "${b.id}"`);
    }
    out[b.id as BeaconColor] = {
      id: b.id as BeaconColor,
      name: b.name,
      maxUses: b.maxUses,
      noRepeatAfterOffer: b.noRepeatAfterOffer,
      tiers: b.tiers ?? {},
    };
  }
  for (const c of BEACON_COLORS) {
    if (!out[c]) throw new Error(`data/beacons.json is missing beacon "${c}"`);
  }
  return out;
})();

/* ------------------------------------------------------------------ */
/* Lootrun Division ranks                                              */
/* ------------------------------------------------------------------ */

export interface RankSpec {
  id: string;
  name: string;
  xpRequired?: number;
  unlocksBeacon?: string;
  beaconRerolls?: number;
  beaconChoices?: number;
  boonChoices?: number;
  vibrancyChance?: number;
  dailyRewardReroll?: boolean;
  interludeWalkSpeed?: number;
  note?: string;
}

const rankFile = ranksJson as unknown as {
  ranks: RankSpec[];
  dailyBonus: {
    grants: { lootrunXp: number; rewardPulls: number; rewardRerolls: number };
    rewardRerollGate: string;
  };
};

export const RANKS: RankSpec[] = rankFile.ranks;
export const DAILY_BONUS = rankFile.dailyBonus;

const RANK_INDEX: Record<string, number> = {};
RANKS.forEach((r, i) => (RANK_INDEX[r.id] = i));

export const DEFAULT_RANK = 'grandmaster';

export function rankIndex(rankId: string): number {
  const i = RANK_INDEX[rankId];
  if (i === undefined) throw new Error(`unknown lootrun rank "${rankId}"`);
  return i;
}

/** Minimum rank index required per beacon; colours never listed unlock at 0. */
export const BEACON_MIN_RANK: Record<BeaconColor, number> = (() => {
  const out = Object.fromEntries(BEACON_COLORS.map((c) => [c, 0])) as Record<
    BeaconColor,
    number
  >;
  RANKS.forEach((r, i) => {
    if (r.unlocksBeacon) out[r.unlocksBeacon as BeaconColor] = i;
  });
  return out;
})();

/** Cumulative rank effect up to and including the given rank. */
function accumulate(
  rankId: string,
  key: 'beaconRerolls' | 'beaconChoices' | 'boonChoices' | 'vibrancyChance',
): number {
  const idx = rankIndex(rankId);
  return RANKS.slice(0, idx + 1).reduce((n, r) => n + (r[key] ?? 0), 0);
}

export const startingRerollsFor = (rankId: string) => accumulate(rankId, 'beaconRerolls');
export const vibrancyChanceFor = (rankId: string) => accumulate(rankId, 'vibrancyChance');
/**
 * Base beacon choices: 2 below Sentinel II, 3 at or above.
 * Confirmed by user 2026-07-22 (Grandmaster starts at 3), which also
 * reconciles their orange worked example: 3 base + 1 + 1 = 5 offered.
 */
export const baseChoicesFor = (rankId: string) => 2 + accumulate(rankId, 'beaconChoices');
/** Blue offers 4 boon choices at high rank; Sentinel II's '+1' implies 3 below. */
export const boonChoicesFor = (rankId: string) => 3 + accumulate(rankId, 'boonChoices');

/** Interlude walk speed bonus — shortens interludes, easing Adrenaline Junkie. */
export const interludeWalkSpeedFor = (rankId: string) =>
  RANKS.slice(0, rankIndex(rankId) + 1).reduce((n, r) => n + (r.interludeWalkSpeed ?? 0), 0);

/** Does the daily bonus include its +1 Reward Reroll at this rank? */
export const dailyRewardRerollFor = (rankId: string) =>
  rankIndex(rankId) >= rankIndex(DAILY_BONUS.rewardRerollGate);

/**
 * Daily bonus a run opens with. Granted on the first run at EACH camp per day,
 * so runs do not start from zero. Silverbull Subscription doubles it.
 */
export function dailyBonusFor(rankId: string, silverbull = false): {
  pulls: number;
  rewardRerolls: number;
} {
  const mult = silverbull ? 2 : 1;
  return {
    pulls: DAILY_BONUS.grants.rewardPulls * mult,
    rewardRerolls: dailyRewardRerollFor(rankId) ? DAILY_BONUS.grants.rewardRerolls * mult : 0,
  };
}

/**
 * Availability windows. Sourced from the wiki + the community guide; the
 * fuzzy ones ("grey stops around 30-50") are deliberately conservative.
 */
export const AVAILABILITY: Partial<
  Record<BeaconColor, { minChallenges?: number; maxChallenges?: number }>
> = {
  rainbow: { minChallenges: 10 },
  crimson: { minChallenges: 20 },
  grey: { minChallenges: 4, maxChallenges: 30 },
};

export const RUN_CONSTANTS = {
  startingChallenges: 12,
  maxChallenges: 100,
  timeCapSeconds: 900,
  timeOnChallengeStart: 60,
  timeOnChallengeComplete: 90,
  timeLostOnDeath: 60,
  /** Fallback only — real durations come from data (5/10/15/20 by tier). */
  orangeDurationChallenges: 5,
  // NOTE: base beacon choices are RANK-DERIVED — use baseChoicesFor(rank).
  // A flat constant here would be wrong at 15 of the 16 ranks.
  /** Confirmed: "Limit: 6 simultaneous beacon choices". */
  maxBeaconChoices: 6,
  /** Confirmed: "Default: 2 rerolls per lootrun". */
  startingBeaconRerolls: 2,
  /** A run can be reset by failing before this challenge; 15 min cooldown. */
  resetBeforeChallenge: 4,
  /** Completing this challenge FORCES a 3-way mission choice — no grey needed. */
  firstMissionAtChallenge: 4,
  /**
   * Total mission slots per run.
   * UNVERIFIED: grey has maxUses 3, and the challenge-4 mission is forced
   * rather than coming from a grey. If that forced pick does NOT consume a
   * grey use, the true total is 4. Set to 3 pending in-game confirmation —
   * see OPEN-QUESTIONS.md.
   */
  maxMissions: 3,
  /** Gourmand: +2 choices per beacon reroll used (confirmed 2026-07-21). */
  gourmandChoicesPerReroll: 2,
} as const;
