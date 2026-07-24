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
import trialsJson from '../data/trials.json';
import archetypesJson from '../data/archetypes.json';
import objectivesJson from '../data/mission_objectives.json';
import { BEACON_COLORS, type BeaconColor, type OfferedBeacon, type RunState } from './types';
import { beaconChoices, pendingMission, resolveTier } from './engine';
import { BEACONS, RUN_CONSTANTS } from './data';

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

/** Cross-phase tactics that layer on top of phase priority and archetype bias. */
export interface Tactics {
  boostedOnly?: {
    beacons: string[];
    unboostedPenalty: number;
    boostedBonusPerTier: number;
    firstRainbowRaw?: boolean;
  };
  aquaLoop?: {
    setupBonus: number;
    payoffBonus: number;
    payoffByNeed: Record<string, string>;
  };
  orangeRefresh?: { whenChallengesLeftLte: number; bonus: number };
  missionUrgency?: { bonus: number; rawGreyUrgentFromChallenge: number };
}

export interface Strategy {
  id: string;
  name?: string;
  goals: { runnable: Condition & { all?: Condition[] } };
  safety: SafetyRule[];
  phases: Phase[];
  tactics?: Tactics;
}

/**
 * Structural check for an imported strategy. Not a full schema — just enough
 * that a malformed paste is rejected with a message instead of crashing the
 * advisor mid-run. Returns the typed strategy or a human-readable error.
 */
export function validateStrategy(obj: unknown): { ok: true; strategy: Strategy } | { ok: false; error: string } {
  if (typeof obj !== 'object' || obj === null) return { ok: false, error: 'not an object' };
  const s = obj as Record<string, unknown>;
  if (typeof s.id !== 'string') return { ok: false, error: 'missing string "id"' };
  if (!Array.isArray(s.phases) || s.phases.length === 0)
    return { ok: false, error: '"phases" must be a non-empty array' };
  if (typeof s.goals !== 'object' || s.goals === null || !('runnable' in s.goals))
    return { ok: false, error: 'missing "goals.runnable"' };
  if (!Array.isArray(s.safety)) return { ok: false, error: '"safety" must be an array' };
  const validColors = new Set<string>(BEACON_COLORS);
  for (const [i, p] of (s.phases as unknown[]).entries()) {
    if (typeof p !== 'object' || p === null || typeof (p as { id?: unknown }).id !== 'string')
      return { ok: false, error: `phase[${i}] needs a string "id"` };
    const bp = (p as { beaconPriority?: unknown }).beaconPriority;
    if (bp !== undefined) {
      if (!Array.isArray(bp))
        return { ok: false, error: `phase "${(p as { id: string }).id}": beaconPriority must be an array` };
      for (const entry of bp) {
        if (typeof entry !== 'string')
          return { ok: false, error: `phase "${(p as { id: string }).id}": priority entries must be strings` };
        const { color } = parsePriorityEntry(entry);
        if (!validColors.has(color))
          return {
            ok: false,
            error: `phase "${(p as { id: string }).id}": "${entry}" is not a valid beacon (colour "${color}" unknown)`,
          };
      }
    }
  }
  return { ok: true, strategy: obj as Strategy };
}

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */

export const DEFAULT_STRATEGY = strategyJson as unknown as Strategy;

/**
 * The strategy the advisor scores against. Swappable at runtime so the editor
 * can apply a user-customised strategy without a rebuild. Module-level (like
 * MISSIONS/ARCHETYPES) rather than threaded through every function — the app
 * and the sim worker both call setStrategy after loading a custom one.
 */
let strategy: Strategy = DEFAULT_STRATEGY;

export function setStrategy(s: Strategy): void {
  strategy = s;
}
export function getStrategy(): Strategy {
  return strategy;
}

interface MissionSpec {
  id: string;
  name: string;
  effect?: string | null;
  roles?: string[];
  strength?: string;
  archetypes?: string[];
  notes?: string;
  beaconBias?: Partial<Record<BeaconColor, number>>;
  beaconBiasWhy?: string;
}

interface TrialSpec {
  id: string;
  name: string;
  requirement?: string | null;
  beaconBias?: Partial<Record<BeaconColor, number>>;
  beaconBiasWhy?: string;
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
  beaconBias?: Partial<Record<BeaconColor, number>>;
  boonPreference?: string[];
  notes?: string;
}

/**
 * The archetype a run has committed to, by best fit of held mission cores.
 * Shared by beacon and mission scoring so both steer off the same plan.
 *
 * `activatedOnly` restricts to missions whose objective is complete — used for
 * BEACON bias, because an un-activated mission has no effect yet, so its
 * archetype must not steer beacon priority. Mission-pick advice leaves it false
 * (you plan toward an archetype from every mission you hold, activated or not).
 */
export function committedArchetype(state: RunState, activatedOnly = false): Archetype | null {
  const held = new Set(
    state.missions.filter((m) => !activatedOnly || m.fulfilled).map((m) => m.id),
  );
  let best: { a: Archetype; hits: number } | null = null;
  for (const a of ARCHETYPES) {
    if (a.id === 'universal') continue;
    const hits = a.core.filter((c) => held.has(c)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { a, hits };
  }
  return best?.a ?? null;
}

export const TRIALS: Record<string, TrialSpec> = Object.fromEntries(
  (trialsJson as unknown as { trials: TrialSpec[] }).trials
    .filter((t) => t.requirement)
    .map((t) => [t.id, t]),
);

const ARCHETYPES = (archetypesJson as unknown as { archetypes: Archetype[] }).archetypes;

interface ObjectiveType {
  id: string;
  label: string;
  advancedBy: BeaconColor[];
  passive?: boolean;
}
export const OBJECTIVE_TYPES = (
  objectivesJson as unknown as { objectiveTypes: ObjectiveType[] }
).objectiveTypes;
const OBJECTIVE_BY_ID: Record<string, ObjectiveType> = Object.fromEntries(
  OBJECTIVE_TYPES.map((o) => [o.id, o]),
);

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

/**
 * A beacon-priority entry is either a plain colour (`"white"`) or a
 * boost-qualified one (`"buffed:white"`, `"aqua:white"`, `"boosted:white"`),
 * which matches ONLY when that beacon resolves above tier 0 — from any source,
 * aqua or rainbow alike.
 *
 * This lets a phase rank "a white worth taking" above "aqua" above "a raw
 * white", so the setup-then-spend play is expressed in the priority list
 * itself rather than inferred.
 */
const BUFFED_PREFIXES = new Set(['buffed', 'aqua', 'boosted', 'vibrant']);

export function parsePriorityEntry(entry: string): {
  color: string;
  requiresBoost: boolean;
} {
  const i = entry.indexOf(':');
  if (i < 0) return { color: entry, requiresBoost: false };
  const prefix = entry.slice(0, i).toLowerCase();
  return {
    color: entry.slice(i + 1),
    requiresBoost: BUFFED_PREFIXES.has(prefix),
  };
}

/**
 * Best (lowest) index in the priority list that this beacon satisfies.
 * A boosted white matches both `buffed:white` and `white`, and takes the
 * stronger of the two positions. Returns -1 when unlisted.
 */
export function priorityIndexFor(
  priority: string[],
  color: BeaconColor,
  tier: number,
): number {
  let best = -1;
  for (let i = 0; i < priority.length; i++) {
    const raw = priority[i];
    if (raw === undefined) continue;
    const { color: c, requiresBoost } = parsePriorityEntry(raw);
    if (c !== color) continue;
    if (requiresBoost && tier <= 0) continue;
    if (best < 0 || i < best) best = i;
  }
  return best;
}

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

  // Same committed-archetype detection the beacon advisor uses.
  const committed = committedArchetype(state);
  const best = committed
    ? { a: committed, hits: committed.core.filter((c) => heldSet.has(c)).length }
    : null;

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

  // Only ACTIVATED missions steer beacon priority — an un-activated mission
  // has no effect yet (point 5 of the playtest feedback).
  const archetype = committedArchetype(state, true);
  const bias = archetype?.beaconBias ?? {};

  /**
   * Every held mission and trial contributes its own beacon bias, and they SUM.
   * That is what makes priority shift for each unique combination without
   * enumerating them — 28C3 missions x 13C2 trials is ~250k combinations, but
   * composing per-entity effects covers all of them.
   */
  const modifiers: Array<{ label: string; why?: string; bias: Partial<Record<BeaconColor, number>> }> = [];
  for (const m of state.missions) {
    if (!m.fulfilled) continue; // no effect until activated
    const spec = MISSIONS[m.id];
    if (spec?.beaconBias) {
      modifiers.push({ label: spec.name, why: spec.beaconBiasWhy, bias: spec.beaconBias });
    }
  }
  for (const id of state.trials) {
    const spec = TRIALS[id];
    if (spec?.beaconBias) {
      modifiers.push({ label: spec.name, why: spec.beaconBiasWhy, bias: spec.beaconBias });
    }
  }

  // The un-activated mission (if any) needs its objective completed before it
  // does anything. Push the beacon that advances that objective instead.
  const armingMission = pendingMission(state);
  const armingObjective = armingMission?.objective
    ? OBJECTIVE_BY_ID[armingMission.objective]
    : undefined;
  const armingBeacons = new Set(armingObjective?.advancedBy ?? []);

  const tactics = strategy.tactics ?? {};

  /**
   * The beacon this run's combo actually converts into value — what an aqua
   * should be spent on. Taken from the un-activated mission's objective if
   * there is one, else the archetype's strongest positive bias.
   */
  const payoffBeacon: BeaconColor | undefined = (() => {
    const byNeed = tactics.aquaLoop?.payoffByNeed ?? {};
    if (armingMission?.objective && byNeed[armingMission.objective]) {
      return byNeed[armingMission.objective] as BeaconColor;
    }
    const entries = Object.entries(bias).filter(([, v]) => (v ?? 0) > 0);
    if (entries.length === 0) return undefined;
    entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    return entries[0]?.[0] as BeaconColor;
  })();

  /** Orange about to lapse — refresh before beacon choices shrink. */
  const orangeExpiringIn = state.orangeStacks.length
    ? Math.min(...state.orangeStacks.map((o) => o.challengesLeft))
    : Infinity;

  // "Get all missions and rainbow as early as possible" (playtester request):
  // grey is urgent while mission slots remain and its window is open; rainbow
  // is urgent whenever it is legally offerable (it uses a ramping pity timer,
  // so a visible rainbow should almost never be passed).
  const missionSlotsLeft = RUN_CONSTANTS.maxMissions - state.missions.length;
  const greyUrgent = missionSlotsLeft > 0 && !pendingMission(state);

  const ranked: RankedBeacon[] = offer.map((b) => {
    const reasons: string[] = [];
    let score: number;

    const beaconTier = resolveTier(state, b);
    const idx = priorityIndexFor(priority, b.color, beaconTier);
    if (idx >= 0) {
      score = (priority.length - idx) * 10;
      const entry = priority[idx];
      const boosted = entry !== undefined && parsePriorityEntry(entry).requiresBoost;
      reasons.push(
        `Phase "${priorityPhase?.id}": priority #${idx + 1} of ${priority.length}${
          boosted ? ` (as a boosted ${b.color})` : ''
        }`,
      );
    } else {
      score = 5;
      reasons.push(`Phase "${priorityPhase?.id}": unlisted — neutral fallback`);
    }

    // --- activate the pending mission ---------------------------------
    // Completing its objective is high priority: the mission is dead weight
    // and grey is blocked until it activates.
    if (armingBeacons.has(b.color)) {
      score += 50;
      reasons.push(
        `Activates ${MISSIONS[armingMission!.id]?.name ?? armingMission!.id}: completes its "${armingObjective!.label}" objective`,
      );
    }

    // --- archetype beacon bias (activated missions only) --------------
    const biasVal = bias[b.color];
    if (biasVal) {
      score += biasVal;
      reasons.push(
        `${archetype?.name}: ${biasVal > 0 ? '+' : ''}${biasVal} (run combo ${
          biasVal > 0 ? 'wants' : 'avoids'
        } ${b.color})`,
      );
    }

    // --- per-mission / per-trial bias, summed --------------------------
    for (const mod of modifiers) {
      const v = mod.bias[b.color];
      if (!v) continue;
      score += v;
      reasons.push(
        `${mod.label}: ${v > 0 ? '+' : ''}${v}${mod.why ? ` — ${mod.why}` : ''}`,
      );
    }

    // --- earliness urgency --------------------------------------------
    // A grey is only *promoted* when it is worth taking: boosted (more mission
    // choices → better combo), or the window is closing so waiting no longer
    // pays. Promoting a raw grey early is the behaviour playtesting rejected.
    if (b.color === 'grey' && greyUrgent) {
      const mu = tactics.missionUrgency;
      const greyTier = resolveTier(state, b);
      const windowClosing =
        !mu || state.challengesCompleted >= mu.rawGreyUrgentFromChallenge;
      if (greyTier > 0 || windowClosing) {
        score += mu?.bonus ?? 35;
        reasons.push(
          greyTier > 0
            ? `Get missions early — ${missionSlotsLeft} slot${missionSlotsLeft > 1 ? 's' : ''} open, and this grey is boosted`
            : `Window closing (challenge ${state.challengesCompleted}) — take the grey even raw, ${missionSlotsLeft} slot${missionSlotsLeft > 1 ? 's' : ''} still empty`,
        );
      }
    }
    if (b.color === 'rainbow' && state.rainbowChallengesLeft === 0) {
      score += 45;
      reasons.push('Get rainbow early — ramping pity timer, do not pass it');
    }

    // --- tactics: high-value beacons want to be boosted ---------------
    const bo = tactics.boostedOnly;
    if (bo?.beacons.includes(b.color)) {
      const tier = resolveTier(state, b);
      const firstRainbowRaw =
        bo.firstRainbowRaw && b.color === 'rainbow' && (state.beaconUses.rainbow ?? 0) === 0;
      if (tier === 0 && !firstRainbowRaw) {
        score += bo.unboostedPenalty;
        reasons.push(
          b.color === 'grey'
            ? 'Unboosted grey = only 3 mission choices (5 when aqua-boosted). Greys are skippable ~10x — wait for a boosted one.'
            : `Unboosted ${b.color} wastes it — wait for an aqua/vibrant one`,
        );
      } else if (firstRainbowRaw) {
        reasons.push('First rainbow — worth taking raw, it makes everything vibrant');
      } else {
        score += bo.boostedBonusPerTier * tier;
        reasons.push(
          b.color === 'grey'
            ? `Boosted grey (T${tier}) — ${(BEACONS.grey.tiers as { missionChoices?: number[] }).missionChoices?.[tier] ?? '?'} mission choices`
            : `Boosted ${b.color} (T${tier}) — taken at power`,
        );
      }
    }

    // --- tactics: the aqua loop ---------------------------------------
    const loop = tactics.aquaLoop;
    if (loop && payoffBeacon) {
      if (state.pendingAqua > 0 && b.color === payoffBeacon) {
        score += loop.payoffBonus;
        reasons.push(`Spend the banked aqua here — ${payoffBeacon} is what this combo converts`);
      } else if (state.pendingAqua === 0 && b.color === 'aqua') {
        score += loop.setupBonus;
        reasons.push(`Set up aqua -> ${payoffBeacon} (the combo's payoff loop)`);
      }
    }

    // --- tactics: refresh orange before it lapses ----------------------
    const orf = tactics.orangeRefresh;
    if (orf && b.color === 'orange' && orangeExpiringIn <= orf.whenChallengesLeftLte) {
      score += orf.bonus;
      reasons.push(
        `Refresh orange — a stack expires in ${orangeExpiringIn} offer${orangeExpiringIn === 1 ? '' : 's'}`,
      );
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
