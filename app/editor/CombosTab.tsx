'use client';

/**
 * Combos tab — where a lootrun expert forks the playbook.
 *
 * Design rule: no numbers. Preference is expressed by ORDER, in two lists —
 * what the combo wants and what it avoids. The scoring ladder is fixed, so
 * dragging is the only control and appending never re-weights what is above.
 *
 * Every card is paired with an impact rail that re-runs the real engine. That
 * pairing is the point of the tab: the old editor let you add a combo, apply
 * it, and change nothing at all, with nothing to tell you.
 */

import { useMemo, useState } from 'react';
import { analyseCombo, type ComboImpact } from '../../engine/comboImpact';
import type { Combo } from '../../engine/combos';
import { MISSIONS } from '../../engine/evaluator';
import { BEACON_LIST, chipClass } from './beaconStyles';
import type { BeaconColor } from '../../engine/types';

/* ------------------------------------------------------------------ */
/* Ordered drag list                                                   */
/* ------------------------------------------------------------------ */

/**
 * One ordered beacon list. HTML5 drag events rather than a library — same
 * reasoning as the phase priority editor: a short list on a desktop editing
 * screen, where ~40 lines beat a dependency.
 */
function BeaconOrder({
  list,
  kind,
  onChange,
}: {
  list: BeaconColor[];
  kind: 'wants' | 'avoids';
  onChange: (next: BeaconColor[]) => void;
}) {
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const move = (a: number, b: number) => {
    if (a === b) return;
    const next = [...list];
    const [m] = next.splice(a, 1);
    next.splice(b, 0, m!);
    onChange(next);
  };

  const free = BEACON_LIST.filter((c) => !list.includes(c));

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
          {kind === 'wants' ? 'wants' : 'avoids'}
        </span>
        <span className="text-[10px] text-zinc-600">
          {kind === 'wants' ? 'strongest first' : 'worst first'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {list.map((color, i) => (
          <span
            key={color}
            draggable
            onDragStart={() => setFrom(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(i);
            }}
            onDragEnd={() => {
              setFrom(null);
              setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (from !== null) move(from, i);
              setFrom(null);
              setOver(null);
            }}
            title="drag to reorder · ✕ to remove"
            className={`inline-flex cursor-grab items-center gap-1 rounded px-1.5 py-0.5 text-[11px] active:cursor-grabbing ${chipClass(
              color,
            )} ${kind === 'avoids' ? 'opacity-70 line-through decoration-1' : ''} ${
              over === i && from !== i ? 'outline outline-2 outline-white' : ''
            } ${from === i ? 'opacity-40' : ''}`}
          >
            <span className="opacity-50">⠿</span>
            <span className="font-medium">
              {i + 1}. {color}
            </span>
            <button
              onClick={() => onChange(list.filter((_, k) => k !== i))}
              className="opacity-40 hover:opacity-100"
              title="remove"
            >
              ✕
            </button>
          </span>
        ))}

        {list.length === 0 && (
          <span className="text-[11px] text-zinc-600">none</span>
        )}

        {adding ? (
          <select
            autoFocus
            onBlur={() => setAdding(false)}
            onChange={(e) => {
              if (e.target.value) onChange([...list, e.target.value as BeaconColor]);
              setAdding(false);
            }}
            className="rounded bg-zinc-800 px-1 py-0.5 text-[11px] text-zinc-200"
            defaultValue=""
          >
            <option value="">pick…</option>
            {free.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          free.length > 0 && (
            <button
              onClick={() => setAdding(true)}
              className="rounded border border-dashed border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-500 hover:text-zinc-300"
            >
              + beacon
            </button>
          )
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Core mission picker                                                 */
/* ------------------------------------------------------------------ */

function CoreMissions({
  core,
  onChange,
}: {
  core: string[];
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const free = Object.keys(MISSIONS)
    .filter((id) => !core.includes(id) && MISSIONS[id]!.verdict !== 'deleted')
    .sort((a, b) => MISSIONS[a]!.name.localeCompare(MISSIONS[b]!.name));

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">core pool</span>
        <span className="text-[10px] text-zinc-600">
          holding any one of these commits the run
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {core.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px]"
          >
            {MISSIONS[id]?.name ?? id}
            <button
              onClick={() => onChange(core.filter((m) => m !== id))}
              className="opacity-40 hover:opacity-100"
              title="remove"
            >
              ✕
            </button>
          </span>
        ))}
        {core.length === 0 && (
          <span className="text-[11px] text-amber-400">
            no missions — this combo can never trigger
          </span>
        )}
        {adding ? (
          <select
            autoFocus
            onBlur={() => setAdding(false)}
            onChange={(e) => {
              if (e.target.value) onChange([...core, e.target.value]);
              setAdding(false);
            }}
            className="rounded bg-zinc-800 px-1 py-0.5 text-[11px] text-zinc-200"
            defaultValue=""
          >
            <option value="">pick…</option>
            {free.map((id) => (
              <option key={id} value={id}>
                {MISSIONS[id]!.name}
              </option>
            ))}
          </select>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="rounded border border-dashed border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            + mission
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Impact rail                                                         */
/* ------------------------------------------------------------------ */

function ImpactRail({
  impact,
  onPromote,
}: {
  impact: ComboImpact;
  onPromote: () => void;
}) {
  const lost = impact.collisions.filter((c) => c.loses);

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
        what this does
      </div>

      {lost.map((c) => (
        <div
          key={c.winner.id}
          className="rounded border border-amber-800 bg-amber-950/40 p-2 text-[11px] text-amber-200"
        >
          <b className="font-semibold">Loses {c.shared.join(', ')}</b> to{' '}
          {c.winner.name}, which is listed first and takes the tie. Holding that mission will
          steer mission picks toward their plan, not this one.
          <button
            onClick={onPromote}
            className="mt-1.5 block rounded bg-amber-900 px-2 py-0.5 text-[11px] hover:bg-amber-800"
          >
            Move above it
          </button>
        </div>
      ))}

      {impact.dominated.length > 0 && (
        <div className="rounded border border-amber-800 bg-amber-950/40 p-2 text-[11px] text-amber-200">
          <b className="font-semibold">
            {impact.dominated.join(', ')} {impact.dominated.length > 1 ? 'do' : 'does'} nothing
          </b>{' '}
          — another combo already pulls {impact.dominated.length > 1 ? 'those' : 'that'} way at
          least as hard, and only the strongest advocate counts.
        </div>
      )}

      {impact.inert && (
        <div className="rounded border border-red-800 bg-red-950/40 p-2 text-[11px] text-red-200">
          <b className="font-semibold">Changes no beacon priority.</b> Every beacon it asks for is
          already claimed at least as strongly elsewhere. It can still shape which missions get
          recommended — the core pool above does that — but it will not move a single beacon.
        </div>
      )}

      {impact.effective.length > 0 && (
        <div className="rounded border border-green-800 bg-green-950/40 p-2 text-[11px] text-green-200">
          Moves <b className="font-semibold">{impact.effective.join(', ')}</b>.
        </div>
      )}

      <div className="rounded border border-zinc-800 bg-zinc-900 p-2 text-[11px] text-zinc-400">
        Triggers on <b className="text-zinc-200">{impact.reach}</b> of {impact.reachOf} possible
        first missions.
      </div>

      {impact.preview.length > 0 && (
        <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
          <div className="mb-1 text-[10px] text-zinc-600">
            priority with the first core mission held
          </div>
          <div className="flex flex-wrap gap-1">
            {impact.preview.slice(0, 6).map((p) => (
              <span
                key={p.color}
                className={`rounded px-1.5 py-0.5 text-[11px] ${chipClass(p.color)} ${
                  p.delta !== 0 ? 'ring-2 ring-white' : 'opacity-60'
                }`}
              >
                {p.color} {p.score}
                {p.delta !== 0 && (
                  <b className="ml-1">
                    {p.delta > 0 ? '↑' : '↓'}
                    {Math.abs(p.delta)}
                  </b>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */

let newComboSeq = 0;

export default function CombosTab({
  combos,
  onChange,
}: {
  combos: Combo[];
  onChange: (next: Combo[], note: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(combos[0]?.id ?? null);

  // Recomputed whenever the playbook changes, which is what makes the rail live.
  const impacts = useMemo(() => {
    const m = new Map<string, ComboImpact>();
    for (const c of combos) {
      try {
        m.set(c.id, analyseCombo(c));
      } catch {
        /* a half-edited combo is not worth crashing the page over */
      }
    }
    return m;
  }, [combos]);

  const patch = (id: string, fn: (c: Combo) => Combo, note: string) =>
    onChange(combos.map((c) => (c.id === id ? fn(c) : c)), note);

  const addCombo = () => {
    const id = `custom_${Date.now().toString(36)}_${newComboSeq++}`;
    onChange(
      [...combos, { id, name: 'New combo', core: [], wants: [], avoids: [] }],
      'added a combo',
    );
    setOpen(id);
  };

  /** Move a combo above the first one that beats it on a shared core. */
  const promote = (id: string) => {
    const impact = impacts.get(id);
    const rival = impact?.collisions.find((c) => c.loses)?.winner.id;
    if (!rival) return;
    const next = combos.filter((c) => c.id !== id);
    const at = next.findIndex((c) => c.id === rival);
    const me = combos.find((c) => c.id === id)!;
    next.splice(Math.max(0, at), 0, me);
    onChange(next, `moved ${me.name} above ${rival}`);
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Combos</h2>
        <button
          onClick={addCombo}
          className="rounded bg-green-800 px-2 py-1 text-[11px] hover:bg-green-700"
        >
          + new combo
        </button>
        <span className="ml-auto text-[10px] text-zinc-600">{combos.length} in this playbook</span>
      </div>

      <p className="text-xs text-zinc-500">
        A combo is one opinion: which missions belong together, and what beacons that pairing
        wants. Preference is <b className="text-zinc-300">order, not numbers</b> — drag to
        reorder, and the top entry pulls hardest. The panel on the right re-runs the real advisor
        after every change, so a combo that quietly changes nothing says so.
      </p>

      <div className="space-y-2">
        {combos.map((c) => {
          const isOpen = open === c.id;
          const impact = impacts.get(c.id);
          const bad = impact && (impact.inert || impact.collisions.some((x) => x.loses));

          return (
            <div key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900">
              <button
                onClick={() => setOpen(isOpen ? null : c.id)}
                className="flex w-full items-center gap-2 p-2 text-left hover:bg-zinc-800/50"
              >
                <span className="text-[10px] text-zinc-600">{isOpen ? '▾' : '▸'}</span>
                <span className="text-sm font-semibold">{c.name}</span>
                <span className="text-[10px] text-zinc-600">
                  {c.core.length} core · {c.wants.length} wants
                </span>
                {bad && <span className="text-[11px] text-amber-400">⚠</span>}
              </button>

              {isOpen && (
                <div className="grid gap-3 border-t border-zinc-800 p-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <input
                      value={c.name}
                      onChange={(e) => patch(c.id, (x) => ({ ...x, name: e.target.value }), 'renamed a combo')}
                      className="w-full rounded bg-zinc-800 px-2 py-1 text-sm"
                      aria-label="combo name"
                    />
                    <label
                      className="flex cursor-pointer items-start gap-2 rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]"
                      title="Fallback combos never score as a speculative commitment."
                    >
                      <input
                        type="checkbox"
                        checked={c.fallback ?? false}
                        onChange={(e) =>
                          patch(
                            c.id,
                            (x) => {
                              const next = { ...x };
                              if (e.target.checked) next.fallback = true;
                              else delete next.fallback;
                              return next;
                            },
                            `${c.name}: fallback`,
                          )
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <b className="font-semibold text-zinc-300">Safety net, not a plan</b>
                        <span className="block text-zinc-500">
                          Tick this for combos that are what you fall back TO, not something you
                          set out to build. They stop counting as &quot;starts a plan&quot; when
                          ranking missions — without it, a salvage pile outranks every real combo
                          starter.
                        </span>
                      </span>
                    </label>

                    <CoreMissions
                      core={c.core}
                      onChange={(core) => patch(c.id, (x) => ({ ...x, core }), `${c.name}: core`)}
                    />
                    <BeaconOrder
                      list={c.wants}
                      kind="wants"
                      onChange={(wants) =>
                        patch(
                          c.id,
                          (x) => ({ ...x, wants, avoids: x.avoids.filter((a) => !wants.includes(a)) }),
                          `${c.name}: wants`,
                        )
                      }
                    />
                    <BeaconOrder
                      list={c.avoids}
                      kind="avoids"
                      onChange={(avoids) =>
                        patch(
                          c.id,
                          (x) => ({ ...x, avoids, wants: x.wants.filter((w) => !avoids.includes(w)) }),
                          `${c.name}: avoids`,
                        )
                      }
                    />
                    <button
                      onClick={() =>
                        onChange(combos.filter((x) => x.id !== c.id), `deleted ${c.name}`)
                      }
                      className="rounded border border-red-900 px-2 py-0.5 text-[11px] text-red-400 hover:bg-red-950"
                    >
                      delete combo
                    </button>
                  </div>

                  {impact && <ImpactRail impact={impact} onPromote={() => promote(c.id)} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
