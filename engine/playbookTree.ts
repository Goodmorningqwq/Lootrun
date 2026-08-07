/**
 * Playbook tree — the mission-decision axis of the strategy.
 *
 * The phase list is a TIMELINE (priority by challenge number). This is the
 * orthogonal view: given the missions you hold, what does beacon priority
 * become, and what should you take next?
 *
 * WHY IT BRANCHES ONE MISSION AT A TIME. The game forces a 3-way mission choice
 * at challenge 4 and you pick a SINGLE mission; a combo is something you
 * discover you are in, not something you select. An earlier version branched on
 * whole named combos, which meant it could answer "what does Combo 2 look
 * like?" but not "I just took Ostinato — now what?", and had no node at all for
 * a run forced into a mission nobody's core contains.
 *
 * WHY IT IS A LATTICE, NOT REALLY A TREE. `nodeState` reads only the mission
 * SET, never the order, so A→B and B→A are the same node. Keying the cache by
 * the sorted set therefore both dedupes and makes re-expansion free.
 *
 * WHY IT IS LAZY. 27 candidates × 3 slots is ~17k reachable sets; precomputing
 * them to draw a handful would be wasteful. Nodes are built on demand as the
 * user expands them.
 *
 * WHY IT IS GENERATED, NOT AUTHORED. Every node builds a synthetic RunState and
 * calls the real `evaluateOffer` / `evaluateMissionOffer`. A hand-drawn tree
 * would drift the moment a tactic or trial outweighed it, and nobody would
 * notice because the drawing and the engine would be separate artifacts. Here
 * the tree is by construction whatever the advisor will actually say.
 */

import archetypesJson from '../data/archetypes.json';
import { RUN_CONSTANTS } from './data';
import { createRun, legalColors } from './engine';
import {
  MISSIONS,
  committedArchetype,
  evaluateMissionOffer,
  evaluateOffer,
  getStrategy,
  type Verdict,
} from './evaluator';
import type { BeaconColor, RunState } from './types';

interface Line {
  id: string;
  name: string;
  core: string[];
  cores?: string[][];
}

const LINES = (archetypesJson as unknown as { archetypes: Line[] }).archetypes.filter(
  (l) => l.id !== 'universal',
);

/**
 * Every mission that can actually be held. `MISSIONS` already drops entries
 * with no `effect`, which excludes the 2.2.1 placeholder; `deleted` covers
 * Chronokinesis, which no longer exists in game.
 */
export const CANDIDATES: string[] = Object.keys(MISSIONS)
  .filter((id) => MISSIONS[id]!.verdict !== 'deleted')
  .sort();

export interface TreeBeacon {
  color: BeaconColor;
  score: number;
  /** The single most explanatory reason, for a compact display. */
  why: string;
}

export interface NextMission {
  id: string;
  name: string;
  score: number;
  verdict?: Verdict;
  /** The most explanatory reason the advisor gave. */
  why: string;
}

export interface TreeNode {
  /** Sorted mission-set key — identical for every path reaching this set. */
  id: string;
  /** Held set in acquisition order. Display only; scores ignore the order. */
  missions: string[];
  /** The mission just taken, or the root label. */
  label: string;
  verdict?: Verdict;
  /** Archetype this set commits to. A single core member is enough. */
  commits: { id: string; name: string } | null;
  /** Other archetypes whose core also contains the newest mission. */
  alsoIn: string[];
  beacons: TreeBeacon[];
  /** Every unheld candidate, ranked. These are the potential children. */
  nextMissions: NextMission[];
  slotsLeft: number;
  note?: string;
}

const ROOT_NOTE =
  'Completing challenge 4 forces a 3-way mission choice — you can be pushed into a mission no combo wants. Nothing is committed yet, so priority is pure phase order.';

/** A state standing in for "mid-run, holding these activated missions". */
function nodeState(missions: string[], challenge = 12): RunState {
  return createRun({
    challengesCompleted: challenge,
    challengesRemaining: 25,
    timeRemaining: 600,
    missions: missions.map((id) => ({ id, fulfilled: true })),
  });
}

/**
 * Rank every legal beacon at this node by asking the advisor directly.
 * Offering all legal colours at once yields the full ordering, which is the
 * useful summary — real offers are subsets of it.
 */
function beaconsAt(state: RunState, limit: number): TreeBeacon[] {
  const offer = legalColors(state).map((color) => ({ color }));
  if (offer.length === 0) return [];
  return evaluateOffer(state, offer)
    .ranked.filter((r) => !r.suppressed)
    .slice(0, limit)
    .map((r) => ({
      color: r.color,
      score: r.score,
      // Prefer a combo/mission reason over the generic phase line.
      why: r.reasons.find((w) => !/^Phase "/.test(w)) ?? r.reasons[0] ?? '',
    }));
}

/** What the advisor would pick next, offered everything still available. */
function nextMissionsAt(state: RunState, held: Set<string>): NextMission[] {
  if (held.size >= RUN_CONSTANTS.maxMissions) return [];
  const offer = CANDIDATES.filter((id) => !held.has(id));
  if (offer.length === 0) return [];
  return evaluateMissionOffer(state, offer).ranked.map((r) => ({
    id: r.id,
    name: r.name,
    score: r.score,
    verdict: MISSIONS[r.id]?.verdict,
    why: r.reasons[0] ?? '',
  }));
}

const keyOf = (missions: string[]) => [...missions].sort().join('+');

/**
 * The cache is only valid for the strategy that filled it. `setStrategy`
 * swaps the object, so identity is a sufficient and un-stale-able guard —
 * without this, editing the strategy would silently show old advice.
 */
const cache = new Map<string, TreeNode>();
let cachedFor: unknown = null;

function checkGeneration() {
  const current = getStrategy();
  if (current !== cachedFor) {
    cache.clear();
    cachedFor = current;
  }
}

/** Build (or recall) the node for exactly this set of held missions. */
export function treeNode(missions: string[]): TreeNode {
  checkGeneration();
  const id = keyOf(missions);
  const hit = cache.get(id);
  // A cached node was built for the same SET; keep its ordering-independent
  // data but present the path the caller actually walked.
  if (hit) return { ...hit, missions: [...missions], label: labelFor(missions) };

  const held = new Set(missions);
  const state = nodeState(missions);
  const newest = missions[missions.length - 1];
  const committed = committedArchetype(state);

  const node: TreeNode = {
    id,
    missions: [...missions],
    label: labelFor(missions),
    verdict: newest ? MISSIONS[newest]?.verdict : undefined,
    commits: committed ? { id: committed.id, name: committed.name } : null,
    alsoIn: newest
      ? LINES.filter(
          (l) =>
            l.id !== committed?.id &&
            (l.core.includes(newest) || (l.cores ?? []).some((c) => c.includes(newest))),
        ).map((l) => l.name)
      : [],
    beacons: beaconsAt(state, 6),
    nextMissions: nextMissionsAt(state, held),
    slotsLeft: Math.max(0, RUN_CONSTANTS.maxMissions - missions.length),
    note: missions.length === 0 ? ROOT_NOTE : undefined,
  };

  cache.set(id, node);
  return node;
}

function labelFor(missions: string[]): string {
  if (missions.length === 0) return 'No missions yet';
  const newest = missions[missions.length - 1]!;
  return MISSIONS[newest]?.name ?? newest;
}

/** Descend one edge: take `missionId` on top of what this node already holds. */
export function childOf(node: TreeNode, missionId: string): TreeNode {
  return treeNode([...node.missions, missionId]);
}

/**
 * Every colour's score with no missions held, as the yardstick for "what did
 * committing to this line actually change?".
 *
 * It must be the FULL ordering, not the displayed top-N: the colours a combo
 * promotes (blue for Ostinato, yellow for the chest engine) start outside the
 * top of the root list, so a truncated baseline would report the biggest
 * movers as "unchanged" — exactly backwards.
 */
export function rootBaseline(): Map<BeaconColor, number> {
  const state = nodeState([]);
  const m = new Map<BeaconColor, number>();
  for (const b of beaconsAt(state, Number.MAX_SAFE_INTEGER)) m.set(b.color, b.score);
  return m;
}
