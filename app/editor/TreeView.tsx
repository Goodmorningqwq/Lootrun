'use client';

/**
 * Playbook tree — the mission-decision axis.
 *
 * The Flow panel is a timeline (priority by challenge number). This is the
 * other axis: given the missions you hold, what does priority become?
 *
 * Every number here is produced by calling the real evaluator, so the picture
 * cannot drift from the advice. Rainbow and aqua lead almost everywhere, which
 * is true but uninformative, so scores that DIFFER from the no-missions
 * baseline are highlighted — the differences are the point.
 *
 * Nodes are built lazily as rows are expanded; nothing below the visible
 * frontier is computed.
 */

import { useMemo, useState } from 'react';
import { childOf, rootBaseline, treeNode, type NextMission, type TreeNode } from '../../engine/playbookTree';
import type { BeaconColor } from '../../engine/types';
import { useTracker } from '../store';

const CHIP: Record<string, string> = {
  blue: 'bg-blue-600 text-white', purple: 'bg-purple-600 text-white',
  yellow: 'bg-yellow-500 text-black', aqua: 'bg-cyan-500 text-black',
  orange: 'bg-orange-500 text-black', green: 'bg-green-600 text-white',
  darkGrey: 'bg-zinc-600 text-white', white: 'bg-zinc-100 text-black',
  grey: 'bg-zinc-400 text-black', red: 'bg-red-600 text-white',
  pink: 'bg-pink-500 text-black', crimson: 'bg-rose-900 text-white',
  rainbow: 'bg-gradient-to-r from-red-500 via-yellow-400 to-blue-500 text-black',
};

/** Verdicts the expert says not to build around — dimmed, never hidden. */
const WEAK = new Set(['avoid', 'bloat']);

const VERDICT_STYLE: Record<string, string> = {
  core: 'bg-cyan-900 text-cyan-200',
  enabler: 'bg-teal-900 text-teal-200',
  pool: 'bg-zinc-700 text-zinc-300',
  side: 'bg-indigo-900 text-indigo-200',
  salvage: 'bg-amber-900 text-amber-200',
  bloat: 'bg-zinc-800 text-zinc-500',
  avoid: 'bg-red-950 text-red-300',
};

function Badge({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] ${className || 'bg-zinc-800 text-zinc-400'}`}>
      {text}
    </span>
  );
}

/** How many good picks to show before the "show all" divider. */
const TOP_N = 8;

function Node({
  node,
  baseline,
  depth,
}: {
  node: TreeNode;
  baseline: Map<BeaconColor, number>;
  depth: number;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const strong = node.nextMissions.filter((m) => !WEAK.has(m.verdict ?? ''));
  const weak = node.nextMissions.filter((m) => WEAK.has(m.verdict ?? ''));
  const shown = showAll ? [...strong, ...weak] : strong.slice(0, TOP_N);
  const hidden = node.nextMissions.length - shown.length;

  const row = (m: NextMission) => {
    const isOpen = open === m.id;
    const dim = WEAK.has(m.verdict ?? '');
    return (
      <div key={m.id}>
        <button
          onClick={() => setOpen(isOpen ? null : m.id)}
          title={m.why}
          className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-zinc-800 ${
            dim ? 'opacity-55' : ''
          } ${isOpen ? 'bg-zinc-800' : ''}`}
        >
          <span className="text-[10px] text-zinc-600">{isOpen ? '▾' : '▸'}</span>
          <span className={isOpen ? 'font-semibold' : ''}>{m.name}</span>
          {m.verdict && <Badge text={m.verdict} className={VERDICT_STYLE[m.verdict]} />}
          <span className="ml-auto font-mono text-[11px] text-zinc-500">{m.score}</span>
        </button>
        {isOpen && (
          <div className="my-1 ml-3 border-l border-zinc-800 pl-2.5">
            <Node node={childOf(node, m.id)} baseline={baseline} depth={depth + 1} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold">
          {depth > 0 && <span className="text-zinc-600">+ </span>}
          {node.label}
        </span>
        {node.verdict && <Badge text={node.verdict} className={VERDICT_STYLE[node.verdict]} />}
        {node.commits && (
          <Badge text={`commits: ${node.commits.name}`} className="bg-cyan-950 text-cyan-300" />
        )}
        {node.alsoIn.length > 0 && <Badge text={`also in: ${node.alsoIn.join(', ')}`} />}
        <span className="ml-auto text-[10px] text-zinc-600">
          {node.missions.length}/3 slots
        </span>
      </div>

      {node.note && <p className="mb-2 text-[11px] text-zinc-500">{node.note}</p>}

      <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">
        beacon priority here
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
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

      {node.nextMissions.length > 0 ? (
        <>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">
            take next — ranked over all {node.nextMissions.length} candidates
          </div>
          <div>{shown.map(row)}</div>
          {hidden > 0 && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-1 w-full rounded border-t border-zinc-800 pt-1.5 text-[11px] text-zinc-500 hover:text-zinc-300"
            >
              + show all {node.nextMissions.length} candidates ({hidden} more, including avoid/bloat)
            </button>
          )}
        </>
      ) : (
        <p className="text-[11px] text-zinc-500">
          All 3 mission slots are full — nothing left to decide.
        </p>
      )}
    </div>
  );
}

export default function TreeView() {
  // The tree is derived from the ACTIVE strategy, so it must recompute when the
  // strategy is edited in the panel next door.
  const strategy = useTracker((s) => s.strategy);

  const root = useMemo(() => treeNode([]), [strategy]);
  const baseline = useMemo(() => rootBaseline(), [strategy]);

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Playbook tree</h2>

      <p className="text-xs text-zinc-500">
        Branches on the <b>mission you take</b> — one per edge, which is the decision the game
        actually asks you to make. Beacon offers branch ~286 ways per challenge and cannot be
        drawn; missions branch 3 deep. Every score is a live call to the advisor, so this cannot
        drift from the real advice. Chips that{' '}
        <b className="text-zinc-300">differ from the no-missions baseline</b> are ringed; dimmed
        ones score the same everywhere. Combos are shown as{' '}
        <span className="rounded bg-cyan-950 px-1 text-[10px] text-cyan-300">commits:</span> badges
        rather than as branches — you discover which combo you are in, you do not pick one.
      </p>

      <Node node={root} baseline={baseline} depth={0} />
    </section>
  );
}
