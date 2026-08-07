'use client';

/**
 * Missions tab — the expert's call on each mission, and your right to disagree.
 *
 * A verdict ("Ostinato is core", "Gourmand is avoid") is an OPINION, not a game
 * fact, and this project has already overturned one of them in conversation.
 * So verdicts are editable, but as an override layer: the shipped judgement
 * stays visible underneath, and a fork reads as a disagreement rather than a
 * silent rewrite of `data/missions.json`.
 *
 * What is NOT editable here is the mission's effect, roles or beacon bias.
 * Those are what the game does, and a strategy that could edit them could lie
 * about Wynncraft rather than merely disagree about tactics.
 */

import { useMemo, useState } from 'react';
import { MISSIONS, activeCombos, type Verdict } from '../../engine/evaluator';
import { chipClass } from './beaconStyles';

const VERDICTS: Verdict[] = [
  'core', 'enabler', 'pool', 'side', 'salvage', 'bloat', 'avoid', 'deleted',
];

const VERDICT_STYLE: Record<string, string> = {
  core: 'bg-cyan-900 text-cyan-200',
  enabler: 'bg-teal-900 text-teal-200',
  pool: 'bg-zinc-700 text-zinc-300',
  side: 'bg-indigo-900 text-indigo-200',
  salvage: 'bg-amber-900 text-amber-200',
  bloat: 'bg-zinc-800 text-zinc-500',
  avoid: 'bg-red-950 text-red-300',
  deleted: 'bg-zinc-950 text-zinc-600',
};

export default function MissionsTab({
  overrides,
  weights,
  onOverrides,
  onWeights,
}: {
  overrides: Record<string, Verdict>;
  weights: Record<string, number>;
  onOverrides: (next: Record<string, Verdict>, note: string) => void;
  onWeights: (next: Record<string, number>, note: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  /** Which combos name this mission, and in what role. */
  const claims = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of activeCombos()) {
      const add = (id: string, role: string) =>
        m.set(id, [...(m.get(id) ?? []), `${c.name} (${role})`]);
      for (const id of c.core ?? []) add(id, 'core');
      for (const id of c.enablers ?? []) add(id, 'enabler');
      for (const t of c.followups ?? []) for (const id of t) add(id, 'follow-up');
    }
    return m;
  }, []);

  const missions = Object.values(MISSIONS).sort((a, b) => a.name.localeCompare(b.name));
  const shown = showAll ? missions : missions.filter((m) => (claims.get(m.id) ?? []).length > 0);

  const setVerdict = (id: string, v: Verdict | null) => {
    const next = { ...overrides };
    if (v === null) delete next[id];
    else next[id] = v;
    onOverrides(next, v === null ? `${id}: verdict reset` : `${id}: verdict → ${v}`);
  };

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Missions</h2>

      <p className="text-xs text-zinc-500">
        Verdicts are one expert&apos;s opinion and you can overrule any of them — the shipped call
        stays visible underneath. Effects, roles and beacon bias are{' '}
        <b className="text-zinc-300">not editable</b>: those are what the game does, and a
        strategy that could edit them could lie about Wynncraft rather than disagree about tactics.
      </p>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">
          verdict weights — added to every mission of that class
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          {VERDICTS.map((v) => (
            <label key={v} className="flex items-center justify-between gap-2 text-[11px]">
              <span className={`rounded px-1 ${VERDICT_STYLE[v]}`}>{v}</span>
              <input
                type="number"
                value={weights[v] ?? 0}
                onChange={(e) =>
                  onWeights({ ...weights, [v]: Number(e.target.value) }, `${v} weight`)
                }
                className="w-16 rounded bg-zinc-950 px-1.5 py-0.5 text-right text-zinc-200"
              />
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-zinc-600">
          Positive tiers ship at 0 on purpose — combo fit and role gaps already reward them, so
          these exist to PENALISE the classes nothing else pushed down.
        </p>
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-zinc-500 hover:text-zinc-300"
        >
          {showAll ? '− show only missions a combo claims' : `+ show all ${missions.length} missions`}
        </button>
        <span className="ml-auto text-zinc-600">
          {Object.keys(overrides).length} overridden
        </span>
      </div>

      <div className="space-y-1.5">
        {shown.map((m) => {
          const shipped = m.verdict;
          const active = overrides[m.id] ?? shipped;
          const isOpen = open === m.id;
          const overridden = overrides[m.id] !== undefined && overrides[m.id] !== shipped;
          const mine = claims.get(m.id) ?? [];

          return (
            <div key={m.id} className="rounded-lg border border-zinc-800 bg-zinc-900">
              <button
                onClick={() => setOpen(isOpen ? null : m.id)}
                className="flex w-full flex-wrap items-center gap-2 p-2 text-left hover:bg-zinc-800/50"
              >
                <span className="text-[10px] text-zinc-600">{isOpen ? '▾' : '▸'}</span>
                <span className="text-sm">{m.name}</span>
                {active && (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${VERDICT_STYLE[active]}`}>
                    {active}
                  </span>
                )}
                {overridden && (
                  <span className="rounded bg-amber-950 px-1.5 py-0.5 text-[10px] text-amber-300">
                    was {shipped}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-zinc-600">
                  {mine.length ? `${mine.length} combo${mine.length > 1 ? 's' : ''}` : 'unclaimed'}
                </span>
              </button>

              {isOpen && (
                <div className="space-y-2 border-t border-zinc-800 p-2 text-[11px]">
                  <p className="text-zinc-400">{m.effect}</p>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-zinc-600">
                      verdict
                    </span>
                    {VERDICTS.map((v) => (
                      <button
                        key={v}
                        onClick={() => setVerdict(m.id, v === shipped ? null : v)}
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          active === v ? VERDICT_STYLE[v] : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                    {overridden && (
                      <button
                        onClick={() => setVerdict(m.id, null)}
                        className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400"
                      >
                        reset to {shipped}
                      </button>
                    )}
                  </div>

                  {m.verdictWhy && (
                    <p className="border-l-2 border-zinc-800 pl-2 text-zinc-500">
                      <span className="text-zinc-600">shipped reasoning: </span>
                      {m.verdictWhy}
                    </p>
                  )}

                  {(m.roles?.length ?? 0) > 0 && (
                    <p className="text-zinc-500">
                      <span className="text-zinc-600">roles: </span>
                      {m.roles!.join(', ')}
                    </p>
                  )}

                  {m.beaconBias && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-zinc-600">pulls toward:</span>
                      {Object.entries(m.beaconBias).map(([c, v]) => (
                        <span
                          key={c}
                          className={`rounded px-1.5 py-0.5 text-[10px] ${chipClass(c)} ${
                            (v as number) < 0 ? 'opacity-60 line-through decoration-1' : ''
                          }`}
                        >
                          {c}
                        </span>
                      ))}
                      <span className="text-[10px] text-zinc-600">(game data — not editable)</span>
                    </div>
                  )}

                  <div className="text-zinc-500">
                    <span className="text-zinc-600">claimed by: </span>
                    {mine.length ? mine.join(' · ') : (
                      <span className="text-amber-400">
                        no combo — it can never score a speculative fit, so it will rank near zero
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
