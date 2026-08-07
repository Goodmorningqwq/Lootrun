/**
 * The tree's whole claim is that it is GENERATED, not drawn — every number in
 * it is what the advisor would really say. These tests enforce exactly that,
 * plus the structural properties the UI relies on.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createRun, legalColors } from './engine';
import { DEFAULT_STRATEGY, MISSIONS, evaluateOffer, setStrategy } from './evaluator';
import { CANDIDATES, childOf, rootBaseline, treeNode, type TreeNode } from './playbookTree';

/** Rebuild a node's state the same way playbookTree does. */
function stateFor(missions: string[]) {
  return createRun({
    challengesCompleted: 12,
    challengesRemaining: 25,
    timeRemaining: 600,
    missions: missions.map((id) => ({ id, fulfilled: true })),
  });
}

/** Walk a representative slice: root, its top picks, and their top picks. */
function samplePaths(): TreeNode[] {
  const root = treeNode([]);
  const out: TreeNode[] = [root];
  for (const a of root.nextMissions.slice(0, 6)) {
    const one = childOf(root, a.id);
    out.push(one);
    for (const b of one.nextMissions.slice(0, 3)) out.push(childOf(one, b.id));
  }
  return out;
}

afterEach(() => setStrategy(DEFAULT_STRATEGY));

describe('the tree is generated, not authored', () => {
  it('every rendered priority equals a live evaluateOffer call for that node', () => {
    // This is the acceptance gate. If someone hand-edits a score, or the
    // evaluator changes and the tree does not, this fails.
    for (const node of samplePaths()) {
      const state = stateFor(node.missions);
      const live = evaluateOffer(
        state,
        legalColors(state).map((color) => ({ color })),
      )
        .ranked.filter((r) => !r.suppressed)
        .slice(0, 6);

      expect(node.beacons.map((b) => `${b.color}:${b.score}`)).toEqual(
        live.map((r) => `${r.color}:${r.score}`),
      );
    }
  });

  it('shows only beacons that are legal in that state', () => {
    for (const node of samplePaths()) {
      const legal = new Set(legalColors(stateFor(node.missions)));
      for (const b of node.beacons) expect(legal.has(b.color)).toBe(true);
    }
  });
});

describe('candidates', () => {
  it('covers every real mission and excludes the unreal ones', () => {
    expect(CANDIDATES).toHaveLength(27);
    // Deleted from the game — the user was explicit that it does not exist.
    expect(CANDIDATES).not.toContain('chronokinesis');
    // The 2.2.1 placeholder has no `effect`, so MISSIONS drops it already.
    expect(CANDIDATES).not.toContain('unknown_2_2_1_missions');
    for (const id of CANDIDATES) expect(MISSIONS[id]).toBeDefined();
  });
});

describe('the mission set, not the path, determines the node', () => {
  it('the same two missions in either order give the same advice', () => {
    const ab = treeNode(['hoarder', 'ostinato']);
    const ba = treeNode(['ostinato', 'hoarder']);
    expect(ab.id).toBe(ba.id);
    expect(ab.beacons).toEqual(ba.beacons);
    expect(ab.nextMissions).toEqual(ba.nextMissions);
    // …but each still reports the path the caller actually walked.
    expect(ab.missions).toEqual(['hoarder', 'ostinato']);
    expect(ba.missions).toEqual(['ostinato', 'hoarder']);
    expect(ab.label).not.toBe(ba.label);
  });
});

describe('the cache cannot serve stale advice', () => {
  it('recomputes when the strategy changes', () => {
    // Regression test: the cache is keyed by mission set, so without a
    // generation guard an edited strategy would keep showing old numbers.
    const before = treeNode(['gourmand']).nextMissions.find((m) => m.id === 'high_roller')!;

    setStrategy({
      ...DEFAULT_STRATEGY,
      verdictScores: { ...DEFAULT_STRATEGY.verdictScores, salvage: 999 },
    });
    const after = treeNode(['gourmand']).nextMissions.find((m) => m.id === 'high_roller')!;

    expect(after.score).toBeGreaterThan(before.score);
  });
});

describe('structure the UI depends on', () => {
  it('never proposes more missions than the 3 slots allow', () => {
    for (const node of samplePaths()) {
      expect(node.missions.length).toBeLessThanOrEqual(3);
      expect(node.slotsLeft).toBe(3 - node.missions.length);
    }
  });

  it('a child holds its parent missions plus exactly one more', () => {
    const root = treeNode([]);
    const one = childOf(root, root.nextMissions[0]!.id);
    const two = childOf(one, one.nextMissions[0]!.id);
    expect(one.missions.length).toBe(1);
    expect(two.missions).toEqual(expect.arrayContaining(one.missions));
    expect(two.missions.length).toBe(2);
  });

  it('stops offering missions once all 3 slots are full', () => {
    const full = treeNode(['ostinato', 'hoarder', 'orphions_grace']);
    expect(full.slotsLeft).toBe(0);
    expect(full.nextMissions).toEqual([]);
  });

  it('never suggests a mission already held', () => {
    for (const node of samplePaths()) {
      const held = new Set(node.missions);
      for (const m of node.nextMissions) expect(held.has(m.id)).toBe(false);
    }
  });

  it('ranks next-missions and beacons best-first', () => {
    for (const node of samplePaths()) {
      const bs = node.beacons.map((b) => b.score);
      expect([...bs].sort((a, b) => b - a)).toEqual(bs);
      const ms = node.nextMissions.map((m) => m.score);
      expect([...ms].sort((a, b) => b - a)).toEqual(ms);
    }
  });
});

describe('the tree is worth drawing', () => {
  it('the root offers every candidate, so no forced pick is unreachable', () => {
    // Challenge 4 can force a mission nobody's core wants; the old combo-rooted
    // tree had no node for those at all.
    expect(treeNode([]).nextMissions).toHaveLength(CANDIDATES.length);
    expect(treeNode([]).nextMissions.map((m) => m.id)).toContain('gourmand');
  });

  it('a mission the expert says to avoid still produces real advice', () => {
    const forced = treeNode(['gourmand']);
    expect(forced.beacons.length).toBeGreaterThan(0);
    expect(forced.nextMissions.length).toBeGreaterThan(0);
    expect(forced.verdict).toBe('avoid');
  });

  it('branches — different first missions really do produce different priority', () => {
    const orderings = new Set(
      CANDIDATES.map((id) => treeNode([id]).beacons.map((b) => b.color).join('>')),
    );
    expect(orderings.size).toBeGreaterThan(4);
  });

  it('reads the live playbook, so deleting a combo removes its badges', () => {
    // Regression: `alsoIn` read data/archetypes.json directly while `commits`
    // went through the engine, so deleting a combo in the editor left the tree
    // citing a combo that no longer existed.
    const before = treeNode(['ostinato']);
    expect([before.commits?.name, ...before.alsoIn].join(' ')).toMatch(/Ostinato/);

    setStrategy({
      ...DEFAULT_STRATEGY,
      combos: (DEFAULT_STRATEGY.combos ?? []).filter((c) => c.id !== 'ostinato'),
    });
    const after = treeNode(['ostinato']);

    expect([after.commits?.name, ...after.alsoIn].join(' ')).not.toMatch(/pull generator/);
  });

  it('a single core mission is enough to commit to its archetype', () => {
    const ost = treeNode(['ostinato']);
    expect(ost.commits).not.toBeNull();
    // Ostinato sits in more than one combo's core, which the badge must show.
    expect(ost.alsoIn.length).toBeGreaterThan(0);
  });

  it("acquiring a combo member raises that combo's payoff beacon", () => {
    // Ostinato wants boons, so blue must score higher once it is held than at
    // the no-missions root. This is the tree's central promise in one assertion.
    const base = rootBaseline().get('blue') ?? 0;
    const withOst = treeNode(['ostinato']).beacons.find((b) => b.color === 'blue')?.score ?? 0;
    expect(withOst).toBeGreaterThan(base);
  });

  it('the baseline covers every colour a node can promote', () => {
    // The UI marks a chip "changed" by looking it up in the baseline. If the
    // baseline is missing a colour, the biggest movers render as unchanged —
    // the failure this test exists to catch.
    const base = rootBaseline();
    for (const node of samplePaths()) {
      for (const b of node.beacons) expect(base.has(b.color)).toBe(true);
    }
  });
});
