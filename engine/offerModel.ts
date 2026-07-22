/**
 * Offer model — samples what the game might show you next.
 *
 * This is the one genuinely *probabilistic* component. Everything else in the
 * engine is deterministic mechanics; here we are estimating a distribution the
 * game never exposes. Treat every weight as a hypothesis, isolated behind
 * `sampleOffer` so it can be replaced wholesale by measured data later
 * without touching the simulator or the strategy.
 */

import { BEACON_COLORS, type BeaconColor, type OfferedBeacon, type RunState } from './types';
import { BEACONS, vibrancyChanceFor } from './data';
import { beaconChoices, legalColors } from './engine';

/** Deterministic PRNG so a rollout can be replayed from its seed. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Relative draw weight by declared rarity. The Beacon List labels each beacon
 * common / medium / rare; these numbers turn those labels into a distribution
 * and are the least evidenced part of the whole model.
 */
const RARITY_WEIGHT: Record<string, number> = {
  common: 10,
  medium: 4,
  rare: 1.5,
};

export interface OfferModelConfig {
  /** Multiplier applied per challenge since rainbow became eligible. */
  rainbowRampPerChallenge: number;
  /** Weight floor for rainbow the moment it unlocks at challenge 10. */
  rainbowBaseWeight: number;
}

export const DEFAULT_OFFER_MODEL: OfferModelConfig = {
  rainbowRampPerChallenge: 0.25,
  rainbowBaseWeight: 0.4,
};

/**
 * Rainbow uses a *ramping hazard*, not a flat chance: 2.2.1 states it appears
 * only after 10 challenges, "gradually increasing the chance of them appearing
 * until they show up". So its weight climbs with challenges completed rather
 * than sitting at its rarity value.
 */
function weightFor(
  state: RunState,
  color: BeaconColor,
  cfg: OfferModelConfig,
): number {
  const rarity = (BEACONS[color].tiers as { rarity?: string }).rarity ?? 'common';
  const base = RARITY_WEIGHT[rarity] ?? 5;

  if (color === 'rainbow') {
    // Already under a rainbow: another one is close to worthless, and the
    // hazard has just reset anyway.
    if (state.rainbowChallengesLeft > 0) return 0.05;
    const since = Math.max(0, state.challengesCompleted - 10);
    return cfg.rainbowBaseWeight * (1 + since * cfg.rainbowRampPerChallenge);
  }

  return base;
}

/** Draw `n` distinct colours without replacement, weighted. */
function drawDistinct(
  pool: BeaconColor[],
  weights: number[],
  n: number,
  rng: () => number,
): BeaconColor[] {
  const chosen: BeaconColor[] = [];
  const remaining = [...pool];
  const w = [...weights];

  while (chosen.length < n && remaining.length > 0) {
    const total = w.reduce((s, x) => s + x, 0);
    if (total <= 0) break;
    let r = rng() * total;
    let idx = 0;
    while (idx < remaining.length - 1 && r >= (w[idx] ?? 0)) {
      r -= w[idx] ?? 0;
      idx++;
    }
    chosen.push(remaining[idx] as BeaconColor);
    remaining.splice(idx, 1);
    w.splice(idx, 1);
  }
  return chosen;
}

/**
 * Sample the offer for the current challenge: `beaconChoices(state)` distinct
 * legal colours, each independently rolled for vibrancy at the rank's chance
 * (or guaranteed vibrant while a rainbow is active).
 */
export function sampleOffer(
  state: RunState,
  rng: () => number,
  cfg: OfferModelConfig = DEFAULT_OFFER_MODEL,
): OfferedBeacon[] {
  const pool = legalColors(state);
  if (pool.length === 0) return [];

  const weights = pool.map((c) => weightFor(state, c, cfg));
  const n = Math.min(beaconChoices(state), pool.length);
  const colors = drawDistinct(pool, weights, n, rng);

  const guaranteedVibrant = state.rainbowChallengesLeft > 0;
  const chance = vibrancyChanceFor(state.rank);

  return colors.map((color) => ({
    color,
    vibrant: guaranteedVibrant || rng() < chance,
  }));
}

/**
 * Sample the missions a grey beacon would offer. Uniform over the unheld
 * pool — mission rarity is undocumented, and 6 of the 34 missions are still
 * unknown, so anything fancier would be false precision.
 */
export function sampleMissionOffer(
  state: RunState,
  allMissionIds: string[],
  rng: () => number,
  count = 3,
): string[] {
  const held = new Set(state.missions.map((m) => m.id));
  const pool = allMissionIds.filter((id) => !held.has(id));
  const out: string[] = [];
  while (out.length < count && pool.length > 0) {
    const i = Math.floor(rng() * pool.length);
    out.push(pool[i] as string);
    pool.splice(i, 1);
  }
  return out;
}

/** Every colour the model could ever draw — used for sanity checks. */
export const ALL_COLORS = BEACON_COLORS;
