/**
 * Mission-advice coverage — how often does the advisor have anything to say?
 *
 * The advice harness (validate-advice) asks whether the advisor's BEACON
 * ranking carries signal. This asks a different and simpler question about
 * MISSION ranking: across every offer the game can present, does the advisor
 * actually distinguish the options, and does it ever recommend something the
 * expert classified as bad?
 *
 * A "blind" offer is one where every mission scores the same, so the advisor is
 * guessing. Those are not evenly distributed — they cluster on missions that
 * no combo claims, which makes the count a direct measure of playbook coverage
 * rather than a vague quality score.
 *
 * This number was originally measured by hand and then lost. Keeping it as a
 * harness means a change that quietly widens the gap gets caught.
 */

import { createRun } from './engine';
import { MISSIONS, evaluateMissionOffer, verdictOf } from './evaluator';
import { CANDIDATES } from './playbookTree';
import type { RunState } from './types';

/** Verdicts the expert says never to build around. */
const BAD = new Set(['avoid', 'bloat', 'deleted']);

export interface Coverage {
  offers: number;
  blind: number;
  /**
   * Blind offers where every option scored ZERO — the advisor knows nothing
   * about any of them. Qualitatively worse than a tie between options it rates
   * equally, which is an honest "these really are interchangeable".
   */
  blindAtZero: number;
  bad: number;
  /** Missions appearing most often in a blind offer, worst first. */
  blindCauses: { id: string; name: string; count: number }[];
  /** Missions the advisor still scores at zero from an empty board. */
  zeroScored: string[];
}

/**
 * Measure across every 3-mission offer. `state` defaults to the forced first
 * mission choice at challenge 4, which is the decision with least information
 * and therefore the hardest case.
 */
export function measureCoverage(state: RunState = createRun({ challengesCompleted: 4 })): Coverage {
  const ids = [...CANDIDATES];
  let offers = 0;
  let blind = 0;
  let blindAtZero = 0;
  let bad = 0;
  const causes = new Map<string, number>();

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      for (let k = j + 1; k < ids.length; k++) {
        const offer = [ids[i]!, ids[j]!, ids[k]!];
        const ranked = evaluateMissionOffer(state, offer).ranked;
        offers++;

        // Blind: nothing separates the options.
        if (ranked[0]!.score === ranked[ranked.length - 1]!.score) {
          blind++;
          if (ranked[0]!.score === 0) blindAtZero++;
          for (const m of offer) causes.set(m, (causes.get(m) ?? 0) + 1);
          continue;
        }

        // Bad: the pick is expert-rejected while a better option was offered.
        const top = ranked[0]!;
        const topBad = BAD.has(verdictOf(top.id) ?? '');
        const alternative = offer.some((m) => !BAD.has(verdictOf(m) ?? ''));
        if (topBad && alternative) bad++;
      }
    }
  }

  const zeroScored = ids.filter(
    (id) => evaluateMissionOffer(state, [id]).ranked[0]!.score === 0,
  );

  return {
    offers,
    blind,
    blindAtZero,
    bad,
    blindCauses: [...causes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ id, name: MISSIONS[id]?.name ?? id, count })),
    zeroScored,
  };
}
