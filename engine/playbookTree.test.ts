/**
 * The tree's whole claim is that it is GENERATED, not drawn — every number in
 * it is what the advisor would really say. These tests enforce exactly that,
 * plus the structural properties the UI relies on.
 */

import { describe, expect, it } from 'vitest';
import { createRun, legalColors } from './engine';
import { evaluateOffer } from './evaluator';
import { buildPlaybookTree, rootBaseline, walkTree, type TreeNode } from './playbookTree';

const tree = buildPlaybookTree({ depth: 2, beaconLimit: 6 });

const nodes: TreeNode[] = [];
walkTree(tree, (n) => nodes.push(n));

/** Rebuild the node's state the same way playbookTree does. */
function stateFor(missions: string[]) {
  return createRun({
    challengesCompleted: 12,
    challengesRemaining: 25,
    timeRemaining: 600,
    missions: missions.map((id) => ({ id, fulfilled: true })),
  });
}

describe('the tree is generated, not authored', () => {
  it('every rendered priority equals a live evaluateOffer call for that node', () => {
    // This is the acceptance gate. If someone hand-edits a score, or the
    // evaluator changes and the tree does not, this fails.
    for (const node of nodes) {
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
    for (const node of nodes) {
      const legal = new Set(legalColors(stateFor(node.missions)).map((c) => c));
      for (const b of node.beacons) expect(legal.has(b.color)).toBe(true);
    }
  });
});

describe('structure the UI depends on', () => {
  it('never proposes more missions than the 3 slots allow', () => {
    for (const node of nodes) {
      expect(node.missions.length).toBeLessThanOrEqual(3);
      expect(node.slotsLeft).toBe(3 - node.missions.length);
    }
  });

  it('a child holds its parent missions plus exactly one more', () => {
    walkTree(tree, (n) => {
      for (const c of n.children) {
        if (n.kind === 'root') continue; // level 1 introduces whole cores
        expect(c.missions).toEqual(expect.arrayContaining(n.missions));
        expect(c.missions.length).toBe(n.missions.length + 1);
      }
    });
  });

  it('never repeats a mission within a branch', () => {
    for (const node of nodes) {
      expect(new Set(node.missions).size).toBe(node.missions.length);
    }
  });

  it('never suggests taking a mission already held', () => {
    for (const node of nodes) {
      const held = new Set(node.missions);
      for (const m of node.nextMissions) expect(held.has(m.id)).toBe(false);
    }
  });

  it('ranks next-missions and beacons best-first', () => {
    for (const node of nodes) {
      const bs = node.beacons.map((b) => b.score);
      expect([...bs].sort((a, b) => b - a)).toEqual(bs);
      const ms = node.nextMissions.map((m) => m.score);
      expect([...ms].sort((a, b) => b - a)).toEqual(ms);
    }
  });

  it('gives every node a unique id so React keys are stable', () => {
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the tree is worth drawing', () => {
  it('branches — different missions really do produce different priority', () => {
    // If every node showed the same ordering the view would be pointless.
    const orderings = new Set(
      nodes.map((n) => n.beacons.map((b) => b.color).join('>')),
    );
    expect(orderings.size).toBeGreaterThan(4);
  });

  it('always offers a salvage branch, because no offer is ever dead', () => {
    const fallback = nodes.find((n) => n.kind === 'fallback');
    expect(fallback).toBeDefined();
    expect(fallback!.beacons.length).toBeGreaterThan(0);
  });

  it('the baseline covers every colour a node can promote', () => {
    // The UI marks a chip "changed" by looking it up in the baseline. If the
    // baseline is missing a colour, the biggest movers render as unchanged —
    // the failure this test exists to catch.
    const base = rootBaseline();
    for (const node of nodes) {
      for (const b of node.beacons) expect(base.has(b.color)).toBe(true);
    }
  });

  it('acquiring a combo member raises that combo\'s payoff beacon', () => {
    // Ostinato wants boons, so blue must score higher once it is held than at
    // the no-missions root. This is the tree's central promise in one assertion.
    const root = tree.beacons.find((b) => b.color === 'blue')?.score ?? 0;
    const ost = nodes.find((n) => n.missions.includes('ostinato'));
    expect(ost).toBeDefined();
    const withOst = ost!.beacons.find((b) => b.color === 'blue')?.score ?? 0;
    expect(withOst).toBeGreaterThan(root);
  });
});
