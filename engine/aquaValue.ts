/**
 * What is an Aqua Beacon actually worth?
 *
 * The advice harness fell from 65% to 38% after mission scoring was fixed, and
 * the diagnostic said the losing pick was overwhelmingly AQUA — beaten by
 * green, purple and yellow. Phase priority ranks aqua second overall, behind
 * only rainbow. This module asks whether it deserves that.
 *
 * THE MECHANIC. `takeBeacon` sets `pendingAqua = min(3, tier + 1)`, and
 * `resolveTier` adds that to the next beacon. So an aqua taken at tier T lifts
 * the NEXT beacon by T+1 tiers, capped at 3. Aqua produces nothing itself; its
 * entire value is the tier difference it creates on the following pick.
 *
 * WHY THIS IS NOT JUST ANOTHER SIMULATION. Most beacons pay indirectly —
 * yellow's chests are worth nothing without the chest combo, blue's boons need
 * Ostinato — so pricing them all in pulls needs the very economy constants
 * (SIM_ECONOMY) that made the harness's verdict circular in the first place.
 *
 * Purple is the exception: its tier table IS pulls, [2,4,6,8], no conversion.
 * So we compute purple analytically from `data/beacons.json`, then check the
 * simulator reproduces that exact number. If it does, the instrument is sound
 * for the colours we cannot compute by hand. If it does not, we have found a
 * simulator bug rather than a strategy problem — which is worth knowing before
 * retuning anything.
 */

import { BEACONS } from './data';
import { completeChallenge, createRun, recordOffer, startChallenge, takeBeacon } from './engine';
import { makeRng } from './offerModel';
import { rollout } from './simulator';
import type { BeaconColor, OfferedBeacon, RunState, Tier } from './types';

const MAX_TIER = 3;

/** Pull yield of a purple beacon at a tier — straight from the data file. */
export function purplePulls(tier: Tier | number): number {
  const t = Math.max(0, Math.min(MAX_TIER, tier));
  return (BEACONS.purple.tiers as { pulls: number[] }).pulls[t] ?? 0;
}

/** Tier the next beacon reaches after taking an aqua at `aquaTier`. */
export function boostedTier(baseTier: number, aquaTier: number): number {
  return Math.min(MAX_TIER, baseTier + aquaTier + 1);
}

export interface AquaVsPurple {
  aquaTier: number;
  baseTier: number;
  /** Take aqua now (0 pulls), then purple next challenge — boosted. */
  aquaThenPurple: number;
  /** Take purple now, then purple again next challenge — both unboosted. */
  purpleTwice: number;
  /** Positive means aqua was the better of the two. */
  edge: number;
}

/**
 * The exact two-challenge comparison, assuming purple is available on both.
 *
 * This is the most favourable possible case for aqua — it assumes the very
 * best boost target turns up immediately. If aqua does not win here, it cannot
 * win on average.
 */
export function analyticAquaVsPurple(): AquaVsPurple[] {
  const rows: AquaVsPurple[] = [];
  for (let aquaTier = 0; aquaTier <= MAX_TIER; aquaTier++) {
    for (let baseTier = 0; baseTier <= MAX_TIER; baseTier++) {
      const aquaThenPurple = purplePulls(boostedTier(baseTier, aquaTier));
      const purpleTwice = purplePulls(baseTier) * 2;
      rows.push({
        aquaTier,
        baseTier,
        aquaThenPurple,
        purpleTwice,
        edge: aquaThenPurple - purpleTwice,
      });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Empirical: what each colour is really worth, in realised pulls      */
/* ------------------------------------------------------------------ */

/** A representative mid-run state — the same one the advice harness uses. */
export function standardState(): RunState {
  return createRun({ challengesCompleted: 12, challengesRemaining: 25, timeRemaining: 600 });
}

/**
 * Mean pulls from taking `color` at `state` and then playing the run out.
 * Every seed is shared across colours by the caller, so the comparison is
 * paired rather than two independent samples.
 */
export function realisedValue(
  state: RunState,
  color: BeaconColor,
  runs: number,
  offer?: OfferedBeacon[],
): number | null {
  const pick: OfferedBeacon = { color };
  const shown = offer ?? [pick];
  let total = 0;
  let ok = 0;

  for (let r = 0; r < runs; r++) {
    try {
      let s = takeBeacon(recordOffer(state, shown), pick);
      s = completeChallenge(startChallenge(s));
      total += rollout(s, makeRng(1000 + r * 7919), { runs: 1 }).pulls;
      ok++;
    } catch {
      /* illegal for this state — skip */
    }
  }
  return ok ? total / ok : null;
}

export interface ColourValue {
  color: BeaconColor;
  meanPulls: number;
  /** Difference against the best colour measured, for readability. */
  vsBest: number;
}

/**
 * Rank every legal colour by what it actually returns, so the result can be
 * put beside the strategy's own priority order.
 *
 * DO NOT SORT THE PHASE BY THIS. It measures a colour GIVEN THE CURRENT
 * POLICY, not a property of the colour, and it moves when the policy moves.
 * Demoting aqua from 3rd to 10th took its realised value from 525 (rank 10) to
 * 1024 (rank 4), because it is now only taken when nothing better is offered.
 * Promoting orange sent it the other way. Re-sorting by these numbers would
 * chase a fixed point that does not exist.
 *
 * Use it as a SMELL TEST — a colour scoring far below its priority position is
 * worth investigating — and settle the question with the analytic table above
 * or with win rate and mean pulls, which are outcome measures.
 */
export function realisedRanking(
  colors: BeaconColor[],
  runs = 60,
  state: RunState = standardState(),
): ColourValue[] {
  const out: { color: BeaconColor; meanPulls: number }[] = [];
  for (const color of colors) {
    const v = realisedValue(state, color, runs);
    if (v !== null) out.push({ color, meanPulls: v });
  }
  out.sort((a, b) => b.meanPulls - a.meanPulls);
  const best = out[0]?.meanPulls ?? 0;
  return out.map((o) => ({ ...o, vsBest: o.meanPulls - best }));
}
