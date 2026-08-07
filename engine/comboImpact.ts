/**
 * "What did that edit actually do?"
 *
 * The editor's central failure was silence: you could add a combo, apply it,
 * and change nothing at all, with no way to find out. Two engine rules make
 * that not merely unhelpful but likely:
 *
 *   - `committedArchetype` breaks ties by ARRAY ORDER (`hits > best.hits` is
 *     strict), so a combo sharing a core mission with one listed earlier never
 *     wins. Nothing announces this.
 *   - `composeBeaconBias` takes the strongest advocate, NOT a sum, so a combo
 *     whose wants are already advocated harder by another combo contributes
 *     exactly zero.
 *
 * Every finding here is computed by running the real engine — swapping the
 * combo out and re-scoring — rather than by reasoning about what it ought to
 * do. A hand-written rule of thumb would drift the moment the scorer changed.
 */

import { activeCombos, composeBeaconBias, getStrategy, setStrategy } from './evaluator';
import { createRun } from './engine';
import { CANDIDATES, rootBaseline, treeNode } from './playbookTree';
import type { Combo } from './combos';
import type { BeaconColor, RunState } from './types';

export interface Collision {
  /** The combo that currently wins the tie. */
  winner: Combo;
  /** Core missions both combos claim. */
  shared: string[];
  /** True when the combo under inspection is the loser. */
  loses: boolean;
}

export interface ComboImpact {
  /** Colours this combo asks for that another combo already advocates harder. */
  dominated: BeaconColor[];
  /** Colours where this combo is the reason the score moved. */
  effective: BeaconColor[];
  collisions: Collision[];
  /** How many of the 27 possible first missions commit this combo. */
  reach: number;
  reachOf: number;
  /** Beacon ordering with one core mission held, against the empty baseline. */
  preview: { color: BeaconColor; score: number; delta: number }[];
  /** True when the combo changes no beacon score anywhere — a silent no-op. */
  inert: boolean;
}

/** A state holding this combo's core, which is when its bias can apply. */
function stateFor(core: string[]): RunState {
  return createRun({
    challengesCompleted: 12,
    challengesRemaining: 25,
    timeRemaining: 600,
    missions: core.slice(0, 3).map((id) => ({ id, fulfilled: true })),
  });
}

/** Re-score with a modified playbook, then put the strategy back. */
function withCombos<T>(combos: Combo[], fn: () => T): T {
  const before = getStrategy();
  try {
    setStrategy({ ...before, combos });
    return fn();
  } finally {
    setStrategy(before);
  }
}

export function analyseCombo(combo: Combo): ComboImpact {
  const all = activeCombos();
  const core = combo.core ?? [];
  const state = stateFor(core);

  // --- collisions ------------------------------------------------------
  // committedArchetype scans in order and keeps the first with the most hits,
  // so an earlier combo sharing a core mission silently wins every time.
  const myIndex = all.findIndex((c) => c.id === combo.id);
  const collisions: Collision[] = [];
  for (const [i, other] of all.entries()) {
    if (other.id === combo.id || other.id === 'universal') continue;
    const shared = core.filter((m) => (other.core ?? []).includes(m));
    if (shared.length === 0) continue;
    // Equal hit counts: whichever appears first in the array takes it.
    const otherWins = myIndex < 0 || (i < myIndex && (other.core?.length ?? 0) >= shared.length);
    collisions.push({
      winner: otherWins ? other : combo,
      shared,
      loses: otherWins,
    });
  }

  // --- dominated vs effective ------------------------------------------
  // The honest test is subtraction: score with the combo, score without it,
  // and see which colours actually moved.
  const withIt = composeBeaconBias(state, true);
  const withoutIt = withCombos(
    all.filter((c) => c.id !== combo.id),
    () => composeBeaconBias(state, true),
  );

  const dominated: BeaconColor[] = [];
  const effective: BeaconColor[] = [];
  for (const color of [...(combo.wants ?? []), ...(combo.avoids ?? [])]) {
    const a = withIt[color]?.value ?? 0;
    const b = withoutIt[color]?.value ?? 0;
    (a === b ? dominated : effective).push(color);
  }

  // --- reach ------------------------------------------------------------
  // committedArchetype fires on a single core hit, so every core mission is an
  // entry point. Exact, not estimated — no offer sampling is involved.
  const reach = core.filter((m) => CANDIDATES.includes(m)).length;

  // --- preview ----------------------------------------------------------
  const baseline = rootBaseline();
  const preview = core.length
    ? treeNode(core.slice(0, 1)).beacons.map((b) => ({
        color: b.color,
        score: b.score,
        delta: b.score - (baseline.get(b.color) ?? 0),
      }))
    : [];

  return {
    dominated,
    effective,
    collisions,
    reach,
    reachOf: CANDIDATES.length,
    preview,
    inert: effective.length === 0 && (combo.wants?.length ?? 0) + (combo.avoids?.length ?? 0) > 0,
  };
}
