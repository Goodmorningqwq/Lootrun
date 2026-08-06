/**
 * Playbook tree — the mission-decision axis of the strategy.
 *
 * The phase list is a TIMELINE (priority by challenge number). This is the
 * orthogonal view: given a set of missions, what does beacon priority become,
 * and what should you take next?
 *
 * WHY IT BRANCHES ON MISSIONS, NOT BEACONS. Branching on offers is hopeless —
 * ~286 possible 3-of-13 offers per challenge, ~100 challenges deep. Missions
 * branch only 3 deep across ~6 combos, which is small enough to read.
 *
 * WHY IT IS GENERATED, NOT AUTHORED. Every node builds a synthetic RunState and
 * calls the real `evaluateOffer` / `evaluateMissionOffer`. A hand-drawn tree
 * would drift the moment a tactic or trial outweighed it, and nobody would
 * notice because the drawing and the engine would be separate artifacts. Here
 * the tree is by construction whatever the advisor will actually say.
 *
 * WHAT IT IS NOT. It shows the NAMED lines, not all ~250k mission/trial
 * combinations. It is an inspection aid; the coverage test is what proves the
 * unnamed remainder is handled.
 */

import archetypesJson from '../data/archetypes.json';
import { createRun, legalColors } from './engine';
import { MISSIONS, evaluateMissionOffer, evaluateOffer } from './evaluator';
import type { BeaconColor, RunState } from './types';

interface Line {
  id: string;
  name: string;
  core: string[];
  cores?: string[][];
  followups?: string[][];
  beaconBias?: Partial<Record<BeaconColor, number>>;
  trialPreference?: string[];
  notes?: string;
}

const LINES = (archetypesJson as unknown as { archetypes: Line[] }).archetypes;

export interface TreeBeacon {
  color: BeaconColor;
  score: number;
  /** The single most explanatory reason, for a compact display. */
  why: string;
}

export interface TreeNode {
  id: string;
  /** Human label for this branch — a line name or the missions acquired. */
  label: string;
  kind: 'root' | 'line' | 'acquire' | 'fallback';
  /** Missions held (and activated) at this node. */
  missions: string[];
  /** Beacon priority the advisor produces here, best first. */
  beacons: TreeBeacon[];
  /** What the advisor would take next, given a representative offer. */
  nextMissions: { id: string; name: string; score: number }[];
  trials: string[];
  slotsLeft: number;
  note?: string;
  children: TreeNode[];
}

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
      why:
        r.reasons.find((w) => !/^Phase "/.test(w)) ??
        r.reasons[0] ??
        '',
    }));
}

/** What the advisor would pick next, offered this line's own follow-ups. */
function nextMissionsAt(state: RunState, candidates: string[]) {
  const held = new Set(state.missions.map((m) => m.id));
  const offer = candidates.filter((id) => !held.has(id) && MISSIONS[id]);
  if (offer.length === 0) return [];
  return evaluateMissionOffer(state, offer)
    .ranked.slice(0, 4)
    .map((r) => ({ id: r.id, name: r.name, score: r.score }));
}

const MAX_MISSIONS = 3;

function makeNode(
  id: string,
  label: string,
  kind: TreeNode['kind'],
  missions: string[],
  line: Line | null,
  beaconLimit: number,
  note?: string,
): TreeNode {
  const state = nodeState(missions);
  const candidates = [
    ...(line?.followups?.flat() ?? []),
    ...(line?.cores?.flat() ?? []),
    ...(line?.core ?? []),
    'high_roller',
    'redemption',
  ];
  return {
    id,
    label,
    kind,
    missions,
    beacons: beaconsAt(state, beaconLimit),
    nextMissions: nextMissionsAt(state, [...new Set(candidates)]),
    trials: line?.trialPreference ?? [],
    slotsLeft: Math.max(0, MAX_MISSIONS - missions.length),
    note: note ?? line?.notes,
    children: [],
  };
}

export interface TreeOptions {
  /** How many mission picks deep. 2 is readable; 3 covers a whole run. */
  depth?: number;
  /** Beacons shown per node. */
  beaconLimit?: number;
}

/**
 * Build the tree. Level 1 is each line's entry point(s); deeper levels apply
 * that line's ordered follow-ups.
 */
export function buildPlaybookTree(opts: TreeOptions = {}): TreeNode {
  const depth = opts.depth ?? 2;
  const beaconLimit = opts.beaconLimit ?? 5;

  const root = makeNode(
    'root',
    'No missions yet',
    'root',
    [],
    null,
    beaconLimit,
    'Challenge 4 forces the first mission. Nothing is committed yet, so priority is pure phase order.',
  );

  for (const line of LINES) {
    if (line.id === 'universal') continue;

    // A line may have several independent entry points (combo 1 has two).
    const entries: string[][] = line.cores?.length ? line.cores : [line.core ?? []];

    for (const [i, entry] of entries.entries()) {
      if (entry.length === 0) continue;
      const held = entry.slice(0, MAX_MISSIONS);
      const node = makeNode(
        `${line.id}-${i}`,
        entries.length > 1 ? `${line.name} — core ${i + 1}` : line.name,
        'line',
        held,
        line,
        beaconLimit,
      );

      if (depth > 1) {
        for (const tier of line.followups ?? []) {
          for (const add of tier) {
            if (held.includes(add) || !MISSIONS[add]) continue;
            if (held.length >= MAX_MISSIONS) continue;
            const next = [...held, add];
            node.children.push(
              makeNode(
                `${line.id}-${i}-${add}`,
                `+ ${MISSIONS[add]!.name}`,
                'acquire',
                next,
                line,
                beaconLimit,
              ),
            );
          }
        }
      }
      root.children.push(node);
    }
  }

  // The catch-all: nothing from any line was offered.
  root.children.push(
    makeNode(
      'fallback',
      'No line fits — salvage',
      'fallback',
      ['high_roller', 'redemption'],
      LINES.find((l) => l.id === 'universal') ?? null,
      beaconLimit,
      'Raw reroll and sacrifice. Never dead, so this is what an offer with no line piece resolves to.',
    ),
  );

  return root;
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

/** Flatten for rendering or assertions. */
export function walkTree(node: TreeNode, fn: (n: TreeNode, depth: number) => void, d = 0) {
  fn(node, d);
  node.children.forEach((c) => walkTree(c, fn, d + 1));
}
