'use client';

/**
 * Playbook tree — the mission-decision axis.
 *
 * The Flow panel is a timeline (priority by challenge number). This is the
 * other axis: given these missions, what does priority become?
 *
 * Every number here is produced by calling the real evaluator, so the picture
 * cannot drift from the advice. Rainbow and aqua lead almost everywhere, which
 * is true but uninformative, so scores that DIFFER from the no-missions
 * baseline are highlighted — the differences are the point.
 */

import { useMemo, useState } from 'react';
import { buildPlaybookTree, rootBaseline, type TreeNode } from '../../engine/playbookTree';
import type { BeaconColor } from '../../engine/types';

const CHIP: Record<string, string> = {
  blue: 'bg-blue-600 text-white', purple: 'bg-purple-600 text-white',
  yellow: 'bg-yellow-500 text-black', aqua: 'bg-cyan-500 text-black',
  orange: 'bg-orange-500 text-black', green: 'bg-green-600 text-white',
  darkGrey: 'bg-zinc-600 text-white', white: 'bg-zinc-100 text-black',
  grey: 'bg-zinc-400 text-black', red: 'bg-red-600 text-white',
  pink: 'bg-pink-500 text-black', crimson: 'bg-rose-900 text-white',
  rainbow: 'bg-gradient-to-r from-red-500 via-yellow-400 to-blue-500 text-black',
};

function Node({
  node,
  baseline,
  depth,
  defaultOpen,
}: {
  node: TreeNode;
  baseline: Map<BeaconColor, number>;
  depth: number;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(depth === 0);
  const isOpen = defaultOpen || open;

  const border =
    node.kind === 'fallback'
      ? 'border-amber-800'
      : node.kind === 'line'
        ? 'border-cyan-900'
        : 'border-zinc-800';

  return (
    <div className={`rounded-lg border ${border} bg-zinc-900`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline gap-2 p-2 text-left hover:bg-zinc-800/50"
      >
        <span className="text-[10px] text-zinc-600">{node.children.length > 0 ? (isOpen ? '▾' : '▸') : '·'}</span>
        <span className={`text-sm font-semibold ${node.kind === 'fallback' ? 'text-amber-300' : ''}`}>
          {node.label}
        </span>
        <span className="text-[10px] text-zinc-600">
          {node.missions.length}/3 slots · {node.slotsLeft} left
        </span>
      </button>

      {isOpen && (
        <div className="space-y-2 border-t border-zinc-800 px-2 py-2">
          {node.note && <p className="text-[11px] text-zinc-500">{node.note}</p>}

          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">
              beacon priority here
            </div>
            <div className="flex flex-wrap gap-1">
              {node.beacons.map((b) => {
                const base = baseline.get(b.color);
                const changed = base !== undefined && base !== b.score;
                const delta = changed ? b.score - base! : 0;
                return (
                  <span
                    key={b.color}
                    title={b.why}
                    className={`rounded px-1.5 py-0.5 text-[11px] ${CHIP[b.color] ?? 'bg-zinc-700'} ${
                      changed ? 'ring-2 ring-white' : 'opacity-60'
                    }`}
                  >
                    {b.color} {b.score}
                    {changed && (
                      <b className="ml-1">
                        {delta > 0 ? '↑' : '↓'}
                        {Math.abs(delta)}
                      </b>
                    )}
                  </span>
                );
              })}
            </div>
          </div>

          {node.nextMissions.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">
                take next
              </div>
              <div className="flex flex-wrap gap-1">
                {node.nextMissions.map((m, i) => (
                  <span
                    key={m.id}
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      i === 0 ? 'bg-green-800 text-green-100' : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {m.name} <span className="opacity-60">{m.score}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {node.trials.length > 0 && (
            <div className="text-[11px] text-zinc-500">
              trials: <span className="text-rose-300">{node.trials.join(' ▸ ')}</span>
            </div>
          )}

          {node.children.length > 0 && (
            <div className="space-y-1.5 border-l border-zinc-800 pl-3">
              {node.children.map((c) => (
                <Node key={c.id} node={c} baseline={baseline} depth={depth + 1} defaultOpen={false} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TreeView() {
  const [depth, setDepth] = useState(2);
  const tree = useMemo(() => buildPlaybookTree({ depth, beaconLimit: 6 }), [depth]);

  // Full "no missions" ordering — see rootBaseline for why it must not be the
  // truncated list the root node displays.
  const baseline = useMemo(() => rootBaseline(), []);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Playbook tree</h2>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          depth
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200"
          >
            <option value={1}>1 — entry points only</option>
            <option value={2}>2 — plus follow-ups</option>
          </select>
        </label>
      </div>

      <p className="text-xs text-zinc-500">
        Branches on <b>missions</b>, not beacon offers — offers branch ~286 ways per challenge,
        missions only 3 deep. Every score is a live call to the advisor, so this cannot drift from
        the real advice. Chips that <b className="text-zinc-300">differ from the no-missions
        baseline</b> are ringed; dimmed ones score the same everywhere.
      </p>

      <div className="space-y-2">
        <Node node={tree} baseline={baseline} depth={0} defaultOpen={false} />
      </div>

      <p className="text-[11px] text-zinc-600">
        Shows the <b>named lines</b> and the salvage fallback — not all ~250k mission/trial
        combinations, which cannot be drawn. The coverage test is what proves the unnamed
        remainder is handled.
      </p>
    </section>
  );
}
