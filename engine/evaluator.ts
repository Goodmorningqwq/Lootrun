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
import archetypesJson from '../data/archetypes.json';
import type { BeaconColor, OfferedBeacon, RunState } from './types';
import { beaconChoices } from './engine';
import { RUN_CONSTANTS } from './data';

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

interface MissionSpec {
  id: string;
  name: string;
  effect?: string | null;
  roles?: string[];
  strength?: string;
  archetypes?: string[];
  notes?: string;
}

const missionFile = missionsJson as unknown as { missions: MissionSpec[] };

export const MISSIONS: Record<string, MissionSpec> = {};
const MISSION_ROLES: Record<string, string[]> = {};
/** Random-effect missions (Jester's Trick, Complete Chaos) fill roles too
 *  unreliably to count toward goals like `runnable` on their own. */
const WEAK_MISSIONS = new Set<string>();
for (const m of missionFile.missions) {
  if (!m.effect) continue; // skip placeholders
  MISSIONS[m.id] = m;
  MISSION_ROLES[m.id] = m.roles ?? [];
  if (m.strength === 'weak') WEAK_MISSIONS.add(m.id);
}

interface Archetype {
  id: string;
  name: string;
  core: string[];
  enablers?: string[];
  followups?: string[][];
  conflicts?: string[];
  notes?: string;
}

const ARCHETYPES = (archetypesJson as unknown as { archetypes: Archetype[] }).archetypes;

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
    return (
      flags[cond.flag] === true ||
      state.trials.includes(cond.flag) ||
      state.missions.some((m) => m.id === cond.flag)
    );
  }
  if (cond.missionsWithRole !== undefined) {
    // Weak (random-effect) missions never count toward role goals — holding
    // only Jester's Trick must not make a run "runnable".
    const count = state.missions.filter(
      (m) =>
        !WEAK_MISSIONS.has(m.id) &&
        (MISSION_ROLES[m.id] ?? []).includes(cond.missionsWithRole as string),
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

/* ------------------------------------------------------------------ */
/* Mission offers                                                      */
/* ------------------------------------------------------------------ */

export interface RankedMission {
  id: string;
  name: string;
  effect: string;
  score: number;
  reasons: string[];
}

export interface MissionAdvice {
  /** Archetype the run has committed to, if any. */
  committed: { id: string; name: string; progress: string } | null;
  /** Roles the `runnable` goal still needs. */
  missingRoles: string[];
  slotsLeft: number;
  ranked: RankedMission[];
}

/** Roles the runnable goal requires, read from the strategy. */
function requiredRoles(): string[] {
  const all = strategy.goals.runnable.all ?? [];
  return all.map((c) => c.missionsWithRole).filter((r): r is string => !!r);
}

/**
 * Rank a mission offer.
 *
 * The core idea: with only ~3 mission slots, the first pick largely commits
 * the run to an archetype, so scoring is "how well does this fit the plan we
 * are already on — or could still start" rather than a flat tier list.
 */
export function evaluateMissionOffer(state: RunState, offered: string[]): MissionAdvice {
  const held = state.missions.map((m) => m.id);
  const heldSet = new Set(held);

  // Which archetype are we on? Best fit by cores already held.
  let best: { a: Archetype; hits: number } | null = null;
  for (const a of ARCHETYPES) {
    if (a.id === 'universal') continue;
    const hits = a.core.filter((c) => heldSet.has(c)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { a, hits };
  }

  const missing = requiredRoles().filter(
    (role) =>
      !held.some((id) => !WEAK_MISSIONS.has(id) && (MISSION_ROLES[id] ?? []).includes(role)),
  );

  const slotsLeft = Math.max(0, RUN_CONSTANTS.maxMissions - state.missions.length);

  const ranked: RankedMission[] = offered.map((id) => {
    const spec = MISSIONS[id];
    const reasons: string[] = [];
    let score = 0;

    if (!spec) {
      return { id, name: id, effect: 'unknown mission', score: 0, reasons: ['not in dataset'] };
    }

    // --- archetype fit -------------------------------------------------
    if (best) {
      const { a } = best;
      if (a.core.includes(id)) {
        score += 100;
        reasons.push(`Completes the ${a.name} core`);
      } else if (a.enablers?.includes(id)) {
        score += 70;
        reasons.push(`Enabler for ${a.name}`);
      } else {
        const tier = (a.followups ?? []).findIndex((t) => t.includes(id));
        if (tier >= 0) {
          score += 60 - tier * 12;
          reasons.push(`${a.name} follow-up, tier ${tier + 1}`);
        }
      }
      if (a.conflicts?.includes(id)) {
        score -= 60;
        reasons.push(`⚠ Conflicts with ${a.name}`);
      }
    } else {
      // Nothing committed yet — a core is a speculative but real plan.
      const starts = ARCHETYPES.filter((a) => a.id !== 'universal' && a.core.includes(id));
      if (starts.length > 0) {
        // Worth the gamble only if slots remain to finish the archetype.
        score += slotsLeft >= 2 ? 70 : 30;
        reasons.push(
          slotsLeft >= 2
            ? `Starts ${starts.map((a) => a.name).join(' / ')} — ${slotsLeft} slots left to build it`
            : `Starts ${starts[0]?.name}, but only ${slotsLeft} slot left to finish it`,
        );
      }
    }

    // --- universal value ----------------------------------------------
    const universal = ARCHETYPES.find((a) => a.id === 'universal');
    if (universal?.core.includes(id)) {
      const bonus = slotsLeft <= 1 ? 75 : 45;
      score += bonus;
      reasons.push(
        slotsLeft <= 1
          ? 'Stateless and never dead — the safe pick on the last slot'
          : 'Stateless value, fits any archetype',
      );
    }

    // --- unmet goal roles ----------------------------------------------
    const fills = (spec.roles ?? []).filter((r) => missing.includes(r));
    if (fills.length > 0) {
      if (WEAK_MISSIONS.has(id)) {
        score += 10;
        reasons.push(`Nominally ${fills.join('/')}, but random — does not satisfy runnable`);
      } else {
        score += 55 * fills.length;
        reasons.push(`Fills missing ${fills.join(' + ')} for a runnable run`);
      }
    }

    // --- state-dependent traps ------------------------------------------
    if (id === 'knife_edge' && state.challengesRemaining > 7) {
      score -= 80;
      reasons.push(
        `⚠ Trap: pays 7 minus challenges remaining — worth 0 at ${state.challengesRemaining} left`,
      );
    }
    if (id === 'chronokinesis' && state.timeRemaining < 300) {
      score -= 50;
      reasons.push('⚠ Drains the timer, and time is already short');
    }
    if (id === 'sacrificial_ritual' && heldSet.has('knife_edge')) {
      score -= 50;
      reasons.push('⚠ Adds challenges, which directly reduces Knife Edge');
    }
    if (id === 'cleansing_greed' && best?.a.id === 'curse_stack') {
      score -= 40;
      reasons.push('⚠ Removes the curses this run is built on');
    }
    if (id === 'gourmand' && state.beaconRerolls === 0) {
      score -= 25;
      reasons.push('⚠ No rerolls banked — needs a reroll income to do anything');
    }
    if (id === 'kings_court') {
      score -= 20;
      reasons.push('Costs a mission slot to gain a trial — charge it the slot');
    }

    if (reasons.length === 0) reasons.push('No archetype fit or role gap — neutral');
    return { id, name: spec.name, effect: spec.effect ?? '', score, reasons };
  });

  ranked.sort((a, b) => b.score - a.score);

  return {
    committed: best
      ? {
          id: best.a.id,
          name: best.a.name,
          progress: `${best.hits}/${best.a.core.length} core`,
        }
      : null,
    missingRoles: missing,
    slotsLeft,
    ranked,
  };
}

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
