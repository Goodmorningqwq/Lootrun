/**
 * Is the combo I am chasing still reachable?
 *
 * The advisor could rank beacons for a plan that had already become impossible
 * — you hold two missions, one slot is left, and the combo you are steering
 * toward needs two more. Nothing said so. The run would keep taking blue for an
 * Ostinato engine that could never finish.
 *
 * Mission slots are the hard constraint: three, ever. A combo's core is a POOL
 * (the user's framing: "a 4-5 mission pool, and you hold the best 3 you
 * actually get offered"), so there is no single completion point — but there IS
 * a point past which the plan cannot improve, and that is worth saying out loud.
 */

import { RUN_CONSTANTS } from './data';
import { activeCombos } from './evaluator';
import type { Combo } from './combos';
import type { RunState } from './types';

export type ComboState =
  /** Every core member held, or no slots left to add another. */
  | 'complete'
  /** Holding some of it, with slots left to add more. */
  | 'alive'
  /** Holding none of it, but it could still be started. */
  | 'untouched'
  /** Can never be entered or improved. */
  | 'dead';

export interface ComboStatus {
  combo: Combo;
  state: ComboState;
  /** Core members currently held. */
  held: string[];
  /** Core members not held. */
  missing: string[];
  /** held / core, the same fraction that scales this combo's beacon bias. */
  completeness: number;
  slotsLeft: number;
  why: string;
}

export function comboStatuses(state: RunState): ComboStatus[] {
  const heldSet = new Set(state.missions.map((m) => m.id));
  const slotsLeft = Math.max(0, RUN_CONSTANTS.maxMissions - state.missions.length);

  return activeCombos()
    .filter((c) => !c.fallback)
    .map((combo) => {
      const core = combo.core ?? [];
      const held = core.filter((m) => heldSet.has(m));
      const missing = core.filter((m) => !heldSet.has(m));
      const completeness = core.length ? held.length / core.length : 0;

      const conflict = (combo.conflicts ?? []).find((m) => heldSet.has(m));

      let stateName: ComboState;
      let why: string;

      if (core.length === 0) {
        stateName = 'dead';
        why = 'No core missions — this combo can never trigger.';
      } else if (conflict) {
        stateName = 'dead';
        why = `You hold ${conflict}, which this combo conflicts with.`;
      } else if (missing.length === 0) {
        stateName = 'complete';
        why = 'Every core mission held. This is as strong as it gets.';
      } else if (slotsLeft === 0) {
        stateName = held.length > 0 ? 'complete' : 'dead';
        why =
          held.length > 0
            ? `No mission slots left, so this is final at ${held.length} of ${core.length}.`
            : 'No mission slots left and none of its missions held — unreachable.';
      } else if (held.length > 0) {
        stateName = 'alive';
        why = `${held.length} of ${core.length} held, ${slotsLeft} slot${
          slotsLeft > 1 ? 's' : ''
        } left to add ${missing.length > slotsLeft ? `${slotsLeft} more` : 'the rest'}.`;
      } else {
        stateName = 'untouched';
        why = `Not started. ${slotsLeft} slot${slotsLeft > 1 ? 's' : ''} left if one is offered.`;
      }

      return { combo, state: stateName, held, missing, completeness, slotsLeft, why };
    });
}

/**
 * The combo the run is actually executing, if any — the most complete live one.
 * Ties break toward the one further along, then toward a bigger core, so a
 * two-of-two beats a one-of-one that happens to be listed first.
 */
export function leadingCombo(state: RunState): ComboStatus | null {
  const live = comboStatuses(state).filter(
    (s) => (s.state === 'alive' || s.state === 'complete') && s.held.length > 0,
  );
  if (live.length === 0) return null;
  return live.sort(
    (a, b) => b.held.length - a.held.length || b.completeness - a.completeness,
  )[0]!;
}
