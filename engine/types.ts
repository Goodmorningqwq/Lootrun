/**
 * Core domain types.
 *
 * DESIGN RULE: this engine models STRUCTURE (legality, counters, exclusion,
 * tiers, time, phase transitions) — not VALUES (how many pulls a purple grants).
 * Values are disputed across sources and live in `data/`, so encoding them here
 * would bake contested numbers into code we cannot easily re-verify.
 */

export const BEACON_COLORS = [
  'blue', 'purple', 'yellow', 'aqua', 'orange', 'green', 'darkGrey',
  'white', 'grey', 'red', 'pink', 'crimson', 'rainbow',
] as const;

export type BeaconColor = (typeof BEACON_COLORS)[number];

/** Tier 0..3 => white / aqua / purple / rainbow effect text. */
export type Tier = 0 | 1 | 2 | 3;
export const MAX_TIER: Tier = 3;

export interface OfferedBeacon {
  color: BeaconColor;
  /** Vibrant grants +1 tier. */
  vibrant?: boolean;
}

/**
 * Curse types. Radiance was added in 2.2.0 and is read specifically by
 * Radiant Hunter / Lights Out, so curses cannot be a single scalar.
 * The non-Radiance breakdown is unconfirmed; `generic` is the catch-all.
 *
 * IMPORTANT (user, 2026-07-21): curses never penalise the PLAYER — they only
 * buff mobs. So a curse is not a resource cost; it is difficulty scaling. The
 * only real risk is mobs outscaling your build, which is outside this state
 * machine. Curse "danger" is therefore a user preference, not a computation.
 */
export type CurseType = 'generic' | 'radiance';

/**
 * A mission slot. `fulfilled: false` means it is still processing — which
 * blocks grey beacons from being offered until it completes. The guide's
 * "do NOT fulfil the mission until run extension is secure" is exactly a
 * decision about when to flip this.
 */
export interface MissionSlot {
  id: string;
  fulfilled: boolean;
}

/** One orange beacon's contribution, with its own expiry. */
export interface OrangeStack {
  /** Extra beacon choices this orange grants. */
  bonus: number;
  challengesLeft: number;
}

export interface HeldBoon {
  id: string;
  /** Potency as a multiplier of base, e.g. 2 = 200%. */
  potency: number;
}

export interface RunFlags {
  hubris: boolean;
  boonsDisabled: boolean;
  cannotGainTime: boolean;
}

export interface RunState {
  /** Lootrun Division rank id (data/ranks.json). Gates beacons, rerolls,
   *  base choices and vibrancy. */
  rank: string;
  /** Daily bonus claimed for this camp today (+10 pulls, +1 reward reroll at
   *  Elite II+). Granted per CAMP per day, so it is not always available. */
  dailyBonus: boolean;
  /** Silverbull Subscription doubles the daily bonus. */
  silverbull: boolean;
  /** Challenges COMPLETED so far. */
  challengesCompleted: number;
  challengesRemaining: number;
  /** Seconds shown on the timer. Held at the 15-minute SOFT cap. */
  timeRemaining: number;
  /**
   * Cumulative seconds gained across the run, INCLUDING overflow above the
   * soft cap. Backup Beat and other timer-requirement missions read this, not
   * `timeRemaining` — overflow counts for them even though it never displays.
   */
  totalTimeGained: number;

  /**
   * Each orange runs its OWN independent timer and contributes its own choice
   * bonus; they stack additively and expire one at a time. Confirmed by user
   * 2026-07-21 — an earlier shared-timer model was wrong.
   */
  orangeStacks: OrangeStack[];
  /** Gourmand: +2 choices per reroll used, cleared when a challenge begins. */
  gourmandChoices: number;

  beaconRerolls: number;
  rewardRerolls: number;
  sacrifices: number;
  pulls: number;

  curses: Record<CurseType, number>;
  boons: HeldBoon[];
  /**
   * Mission slots in pick order. A mission taken from a grey beacon must be
   * FULFILLED before another grey is offered — only one processes at a time.
   */
  missions: MissionSlot[];
  trials: string[];

  /** Tier boost banked from an aqua, applied to the next beacon taken. */
  pendingAqua: number;
  /** Challenges for which rainbow guarantees vibrant. */
  rainbowChallengesLeft: number;

  beaconUses: Partial<Record<BeaconColor, number>>;
  /**
   * Colours OFFERED last challenge that therefore cannot be offered now.
   * Populated from the whole offer, not from the beacon taken.
   */
  excludedNext: BeaconColor[];

  chestsOpened: number;
  mobsKilled: number;
  deaths: number;

  flags: RunFlags;
}

export interface BeaconSpec {
  id: BeaconColor;
  name: string;
  maxUses?: number;
  /** If true, being OFFERED excludes it from the next challenge's pool. */
  noRepeatAfterOffer: boolean | null;
  /** Per-tier magnitudes from data, indexed [t0, t1, t2, t3]. */
  tiers: Record<string, unknown>;
}
