/**
 * Monte Carlo simulator.
 *
 * Answers the question a tier list cannot: *given this state, what does taking
 * each offered beacon actually do to my odds?* It plays each candidate action
 * out to the end of the run many times, following the strategy greedily, and
 * reports outcome distributions rather than a score.
 *
 * Pure and dependency-free so it runs identically in tests, on the main
 * thread, and inside a Web Worker.
 *
 * Boons and mission effects ARE modelled, via ./missionEffects — blue grants a
 * boon, yellow spawns flying chests, Hoarder converts chests to boons, Ostinato
 * and Opal convert boons to pulls, and so on. That economic layer is what makes
 * E[pulls] respond to anything other than purple, and therefore what makes the
 * ranking tunable at all.
 *
 * REMAINING LIMITATIONS — read before trusting a number:
 *
 * 1. The economy is approximate by construction. Items per chest, radiant mobs
 *    per challenge and Jester's Trick's random outcomes are constants; see
 *    SIM_ECONOMY. Trust the ORDERING of options, not the absolute pull counts.
 *
 * 2. P(timeout) is inert at default settings: challenges grant +150s and cost
 *    `secondsPerChallenge` (default 120), so time only binds above ~150.
 *
 * 3. Trials are held but their effects are not simulated.
 */

import type { OfferedBeacon, RunState } from './types';
import {
  completeChallenge,
  createRun,
  recordOffer,
  startChallenge,
  takeBeacon,
  takeMission,
  fulfilMission,
  pendingMission,
  resolveTier,
  firstMissionDue,
} from './engine';
import {
  evaluateMissionOffer,
  evaluateOffer,
  isRunnable,
  MISSIONS,
} from './evaluator';
import { simBeaconTaken, simChallengeCompleted, simMissionAcquired } from './missionEffects';
import {
  DEFAULT_OFFER_MODEL,
  makeRng,
  sampleMissionOffer,
  sampleOffer,
  type OfferModelConfig,
} from './offerModel';

export interface SimConfig {
  /** Rollouts per candidate action. */
  runs: number;
  /**
   * Real seconds a challenge consumes. THE dominant assumption in this model:
   * a challenge grants +60s on start and +90s on completion, so anything under
   * 150s nets time and anything over drains it. Timeout probability is highly
   * sensitive to this, which is why it is a visible knob rather than a
   * constant buried in code.
   */
  secondsPerChallenge: number;
  /** Cap on simulated challenges, so a pathological rollout cannot hang. */
  maxSteps: number;
  offerModel: OfferModelConfig;
}

export const DEFAULT_SIM: SimConfig = {
  runs: 400,
  secondsPerChallenge: 120,
  maxSteps: 120,
  offerModel: DEFAULT_OFFER_MODEL,
};

export interface Outcome {
  reachedRunnable: boolean;
  pulls: number;
  challengesCompleted: number;
  endedBy: 'challenges' | 'timeout' | 'steps';
}

const MISSION_IDS = Object.keys(MISSIONS);

/**
 * Play one run to completion from `state`, choosing greedily by the strategy.
 * Returns how it ended and what it earned.
 */
export function rollout(
  state: RunState,
  rng: () => number,
  partial: Partial<SimConfig> = {},
): Outcome {
  const cfg: SimConfig = { ...DEFAULT_SIM, ...partial };
  let s = state;
  let runnable = isRunnable(s);
  let steps = 0;

  while (s.challengesRemaining > 0 && s.timeRemaining > 0 && steps < cfg.maxSteps) {
    steps++;

    // Forced first mission, or a grey-driven one — resolve before the beacon.
    if (firstMissionDue(s) || (!pendingMission(s) && s.missions.length === 0)) {
      const offer = sampleMissionOffer(s, MISSION_IDS, rng);
      const advice = evaluateMissionOffer(s, offer);
      const pick = advice.ranked[0];
      if (pick) {
        s = takeMission(s, pick.id);
        // Assume the mission is fulfilled promptly; the strategic question of
        // *when* to fulfil is a human decision the rollout does not model.
        s = fulfilMission(s, pick.id);
        s = simMissionAcquired(s, pick.id);
      }
    }

    const offer = sampleOffer(s, rng, cfg.offerModel);
    if (offer.length === 0) break;

    s = recordOffer(s, offer);
    const advice = evaluateOffer(s, offer);
    const best = advice.ranked.find((r) => !r.suppressed) ?? advice.ranked[0];
    if (!best) break;

    const chosen: OfferedBeacon = { color: best.color, vibrant: best.vibrant };
    const takenTier = resolveTier(s, chosen);
    try {
      s = takeBeacon(s, chosen);
    } catch {
      break; // engine rejected it — treat as run end rather than guessing
    }
    // Economic effects the engine deliberately leaves out: chests, boons, and
    // the pull multipliers missions place on them.
    s = simBeaconTaken(s, chosen, takenTier);

    // A grey beacon hands out another mission.
    if (chosen.color === 'grey' && !pendingMission(s)) {
      const mOffer = sampleMissionOffer(s, MISSION_IDS, rng);
      const mAdvice = evaluateMissionOffer(s, mOffer);
      const pick = mAdvice.ranked[0];
      if (pick) {
        s = fulfilMission(takeMission(s, pick.id), pick.id);
        s = simMissionAcquired(s, pick.id);
      }
    }

    s = startChallenge(s);
    // The challenge itself burns real time.
    s = { ...s, timeRemaining: Math.max(0, s.timeRemaining - cfg.secondsPerChallenge) };
    if (s.timeRemaining <= 0) {
      return {
        reachedRunnable: runnable,
        pulls: s.pulls,
        challengesCompleted: s.challengesCompleted,
        endedBy: 'timeout',
      };
    }

    s = completeChallenge(s);
    // Per-challenge mission income (Materialism chests, Knife Edge, etc.).
    s = simChallengeCompleted(s, chosen.color === 'red');
    if (!runnable && isRunnable(s)) runnable = true;
  }

  return {
    reachedRunnable: runnable,
    pulls: s.pulls,
    challengesCompleted: s.challengesCompleted,
    endedBy:
      s.timeRemaining <= 0 ? 'timeout' : steps >= cfg.maxSteps ? 'steps' : 'challenges',
  };
}

export interface ActionForecast {
  color: string;
  vibrant: boolean;
  pRunnable: number;
  pTimeout: number;
  meanPulls: number;
  meanChallenges: number;
  runs: number;
}

export interface Forecast {
  actions: ActionForecast[];
  /** Best action by P(runnable), tie-broken on expected pulls. */
  best: ActionForecast | null;
  config: SimConfig;
}

/**
 * For each offered beacon: take it, then roll the rest of the run out N times
 * and summarise. Comparing across actions is what makes this useful — the
 * absolute numbers inherit every assumption in the offer model.
 */
export function forecastOffer(
  state: RunState,
  offer: OfferedBeacon[],
  partial: Partial<SimConfig> = {},
  seed = 1,
): Forecast {
  // Accept a PARTIAL config and merge. Taking a whole SimConfig here invited
  // callers to pass one field; `runs` then came through undefined and every
  // rollout loop exited immediately, producing an empty forecast with no error.
  const cfg: SimConfig = { ...DEFAULT_SIM, ...partial };
  const actions: ActionForecast[] = [];

  for (const [i, candidate] of offer.entries()) {
    let runnableCount = 0;
    let timeoutCount = 0;
    let pulls = 0;
    let challenges = 0;
    let completed = 0;

    for (let r = 0; r < cfg.runs; r++) {
      // Same seed sequence per action so comparisons are paired, not noisy.
      const rng = makeRng(seed + r * 7919);
      let s: RunState;
      try {
        s = takeBeacon(recordOffer(state, offer), candidate);
      } catch {
        break; // illegal action — no forecast
      }
      s = completeChallenge(startChallenge(s));

      const out = rollout(s, rng, cfg);
      if (out.reachedRunnable) runnableCount++;
      if (out.endedBy === 'timeout') timeoutCount++;
      pulls += out.pulls;
      challenges += out.challengesCompleted;
      completed++;
    }

    if (completed === 0) continue;
    actions.push({
      color: candidate.color,
      vibrant: candidate.vibrant ?? false,
      pRunnable: runnableCount / completed,
      pTimeout: timeoutCount / completed,
      meanPulls: pulls / completed,
      meanChallenges: challenges / completed,
      runs: completed,
    });
    void i;
  }

  const best =
    [...actions].sort(
      (a, b) => b.pRunnable - a.pRunnable || b.meanPulls - a.meanPulls,
    )[0] ?? null;

  return { actions, best, config: cfg };
}

/** Convenience for tests: forecast from a fresh run. */
export const forecastFresh = (offer: OfferedBeacon[], cfg?: SimConfig) =>
  forecastOffer(createRun(), offer, cfg);
