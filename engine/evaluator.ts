/**
 * Strategy evaluator (Phase 2).
 *
 * Reads `strategies/default.json` and the mission role data, and ranks a
 * beacon offer for the current RunState. Pure logic — no React, no I/O beyond
 * the initial data load, so it runs identically in tests, the UI thread, and
 * the future simulation Worker.
 *
 * DESIGN RULE: every recommendation carries `reasons` — the advisor must
 * always explain itself, or the user can never trust it enough to tune it.
 */

import strategyJson from '../strategies/default.json';
import missionsJson from '../data/missions.json';
import type { BeaconColor, OfferedBeacon, RunState } from './types';
import { beaconChoices } from './engine';

/* ------------------------------------------------------------------ */
/* Strategy file types (only the structured parts the evaluator reads) */
/* ------------------------------------------------------------------ */

export interface Condition {
  all?: Condition[];
  any?: Condition[];
  path?: string;
  flag?: string;
  missionsWithRole?: string;
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
  eq?: number;
}

interface SafetyRule {
  id: string;
  priority?: number;
  when?: Condition;
  prefer?: string[];
  suppress?: string[];
  uiWarning?: string;
  why?: string;
  disabledBy?: { trial: string; reason: string };
}

interface Phase {
  id: string;
  name?: string;
  when?: Condition;
  beaconPriority?: string[];
  hardRule?: { rule: string; why: string };
  decision?: { test: string; ifTrue: string; ifFalse: string };
  entryFrom?: string;
}

interface Strategy {
  id: string;
  goals: { runnable: Condition & { all?: Condition[] } };
  safety: SafetyRule[];
  phases: Phase[];
}

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */

const strategy = strategyJson as unknown as Strategy;

const missionFile = missionsJson as unknown as {
  missions: Array<{ id: string; roles?: string[]; strength?: string }>;
};

const MISSION_ROLES: Record<string, string[]> = {};
/** Random-effect missions (Jester's Trick, Complete Chaos) fill roles too
 *  unreliably to count toward goals like `runnable` on their own. */
const WEAK_MISSIONS = new Set<string>();
for (const m of missionFile.missions) {
  MISSION_ROLES[m.id] = m.roles ?? [];
  if (m.strength === 'weak') WEAK_MISSIONS.add(m.id);
}

/* ------------------------------------------------------------------ */
/* Condition evaluation                                                */
/* ------------------------------------------------------------------ */

function resolvePath(state: RunState, path: string): number {
  switch (path) {
    case 'challenge':
      return state.challengesCompleted;
    case 'challengesRemaining':
      return state.challengesRemaining;
    case 'timeRemaining':
      return state.timeRemaining;
    case 'beaconChoices':
      return beaconChoices(state);
    case 'pulls':
      return state.pulls;
    default:
      throw new Error(`evaluator: unknown state path "${path}"`);
  }
}

function compare(value: number, c: Condition): boolean {
  if (c.lt !== undefined && !(value < c.lt)) return false;
  if (c.lte !== undefined && !(value <= c.lte)) return false;
  if (c.gt !== undefined && !(value > c.gt)) return false;
  if (c.gte !== undefined && !(value >= c.gte)) return false;
  if (c.eq !== undefined && value !== c.eq) return false;
  return true;
}

export function testCondition(state: RunState, cond: Condition): boolean {
  if (cond.all) return cond.all.every((c) => testCondition(state, c));
  if (cond.any) return cond.any.some((c) => testCondition(state, c));
  if (cond.flag !== undefined) {
    const flags = state.flags as unknown as Record<string, boolean>;
    return flags[cond.flag] === true || state.trials.includes(cond.flag);
  }
  if (cond.missionsWithRole !== undefined) {
    // Weak (random-effect) missions never count toward role goals — holding
    // only Jester's Trick must not make a run "runnable".
    const count = state.missions.filter(
      (m) =>
        !WEAK_MISSIONS.has(m) &&
        (MISSION_ROLES[m] ?? []).includes(cond.missionsWithRole as string),
    ).length;
    return compare(count, cond);
  }
  if (cond.path !== undefined) return compare(resolvePath(state, cond.path), cond);
  return true;
}

export function isRunnable(state: RunState): boolean {
  return testCondition(state, strategy.goals.runnable);
}

/* ------------------------------------------------------------------ */
/* Phase resolution                                                    */
/* ------------------------------------------------------------------ */

/**
 * The phase list is ordered by run progression, so among all phases whose
 * `when` matches, the LAST one wins (endgame outranks farm, trial_prep
 * outranks rainbow_window at exactly challenge 19, and so on).
 *
 * The `fork` phase resolves through its runnable test to farm/salvage.
 * Phases without `when` (farm/salvage) are only reachable via the fork.
 */
export function activePhases(state: RunState): Phase[] {
  const matched: Phase[] = [];
  for (const p of strategy.phases) {
    if (!p.when) continue;
    if (!testCondition(state, p.when)) continue;
    if (p.decision) {
      const targetId = isRunnable(state) ? p.decision.ifTrue : p.decision.ifFalse;
      const target = strategy.phases.find((x) => x.id === targetId);
      if (target) matched.push(target);
      continue;
    }
    matched.push(p);
  }
  return matched;
}

/* ------------------------------------------------------------------ */
/* Offer evaluation                                                    */
/* ------------------------------------------------------------------ */

export interface RankedBeacon {
  color: BeaconColor;
  vibrant: boolean;
  score: number;
  suppressed: boolean;
  reasons: string[];
}

export interface Advice {
  /** Most specific phase that matched (drives labelling in the UI). */
  activePhase: string;
  /** Phase whose beaconPriority was used (may be an earlier one). */
  priorityPhase: string;
  runnable: boolean;
  warnings: string[];
  ranked: RankedBeacon[];
}

const SUPPRESSED_SCORE = -100;

export function evaluateOffer(state: RunState, offer: OfferedBeacon[]): Advice {
  const matched = activePhases(state);
  const active = matched[matched.length - 1];
  // Fall back through matched phases for one that actually ranks beacons —
  // decision-node phases (mission gates, deadlines) carry no priority list.
  const priorityPhase = [...matched].reverse().find((p) => p.beaconPriority);
  const priority = priorityPhase?.beaconPriority ?? [];

  const warnings: string[] = [];
  const activeSafety: SafetyRule[] = [];

  for (const rule of strategy.safety) {
    if (rule.when && !testCondition(state, rule.when)) continue;
    if (rule.disabledBy && state.trials.includes(rule.disabledBy.trial)) {
      warnings.push(`${rule.id} INOPERATIVE: ${rule.disabledBy.reason}`);
      continue;
    }
    if (rule.uiWarning) warnings.push(rule.uiWarning);
    activeSafety.push(rule);
  }

  const ranked: RankedBeacon[] = offer.map((b) => {
    const reasons: string[] = [];
    let score: number;

    const idx = priority.indexOf(b.color);
    if (idx >= 0) {
      score = (priority.length - idx) * 10;
      reasons.push(
        `Phase "${priorityPhase?.id}": priority #${idx + 1} of ${priority.length}`,
      );
    } else {
      score = 5;
      reasons.push(`Phase "${priorityPhase?.id}": unlisted — neutral fallback`);
    }

    let suppressed = false;
    for (const rule of activeSafety) {
      if (rule.suppress?.includes(b.color)) {
        suppressed = true;
        score = SUPPRESSED_SCORE;
        reasons.push(`SUPPRESSED by ${rule.id}: ${rule.why ?? ''}`.trim());
      }
      const pos = rule.prefer?.indexOf(b.color) ?? -1;
      if (!suppressed && pos >= 0) {
        score += (rule.priority ?? 0) + ((rule.prefer?.length ?? 0) - pos);
        reasons.push(`${rule.id}: ${rule.why ?? 'safety preference'}`);
      }
    }

    if (!suppressed && b.color === 'rainbow' && priorityPhase?.hardRule) {
      reasons.push(priorityPhase.hardRule.why);
    }

    return { color: b.color, vibrant: b.vibrant ?? false, score, suppressed, reasons };
  });

  ranked.sort((a, b) => b.score - a.score);

  return {
    activePhase: active?.id ?? 'none',
    priorityPhase: priorityPhase?.id ?? 'none',
    runnable: isRunnable(state),
    warnings,
    ranked,
  };
}
