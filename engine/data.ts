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
  unlocksBeacon?: string;
  beaconRerolls?: number;
  beaconChoices?: number;
  boonChoices?: number;
  vibrancyChance?: number;
  dailyFreeRewardReroll?: number;
  interludeWalkSpeed?: number;
}

export const RANKS: RankSpec[] = (ranksJson as { ranks: RankSpec[] }).ranks;

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
function accumulate(rankId: string, key: 'beaconRerolls' | 'beaconChoices' | 'vibrancyChance'): number {
  const idx = rankIndex(rankId);
  return RANKS.slice(0, idx + 1).reduce((n, r) => n + (r[key] ?? 0), 0);
}

export const startingRerollsFor = (rankId: string) => accumulate(rankId, 'beaconRerolls');
export const vibrancyChanceFor = (rankId: string) => accumulate(rankId, 'vibrancyChance');
/** Confirmed base of 2 at high rank; the Sentinel II '+1 default' implies 1 below. */
export const baseChoicesFor = (rankId: string) => 1 + accumulate(rankId, 'beaconChoices');

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
  baseBeaconChoices: 2,
  /** Confirmed: "Limit: 6 simultaneous beacon choices". */
  maxBeaconChoices: 6,
  /** Confirmed: "Default: 2 rerolls per lootrun". */
  startingBeaconRerolls: 2,
  /** A run can be reset by failing before this challenge; 15 min cooldown. */
  resetBeforeChallenge: 4,
  /** Gourmand: +2 choices per beacon reroll used (confirmed 2026-07-21). */
  gourmandChoicesPerReroll: 2,
} as const;
