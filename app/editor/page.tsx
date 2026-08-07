'use client';

/**
 * Strategy editor. Visualises the advisor's strategy (phases, priorities,
 * safety rules, goal) and lets the user edit the JSON, then import/export it.
 * The tracker scores live against whatever strategy is applied here.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTracker } from '../store';
import TreeView from './TreeView';
import CombosTab from './CombosTab';
import { DEFAULT_COMBOS, type Combo } from '../../engine/combos';
import { BEACON_LIST, CHIP } from './beaconStyles';

const BOOST_PREFIXES = new Set(['buffed', 'aqua', 'boosted', 'vibrant']);
/** Split "buffed:white" -> {color:'white', boosted:true, prefix:'buffed'}. */
function parseEntry(entry: string): { color: string; boosted: boolean; prefix?: string } {
  const i = entry.indexOf(':');
  if (i < 0) return { color: entry, boosted: false };
  const prefix = entry.slice(0, i).toLowerCase();
  return { color: entry.slice(i + 1), boosted: BOOST_PREFIXES.has(prefix), prefix };
}

function condText(c: unknown): string {
  if (!c || typeof c !== 'object') return '';
  const o = c as Record<string, number | undefined> & { path?: string };
  const p = o.path ?? '?';
  const parts: string[] = [];
  if (o.lt !== undefined) parts.push(`${p} < ${o.lt}`);
  if (o.lte !== undefined) parts.push(`${p} ≤ ${o.lte}`);
  if (o.gt !== undefined) parts.push(`${p} > ${o.gt}`);
  if (o.gte !== undefined) parts.push(`${p} ≥ ${o.gte}`);
  if (o.eq !== undefined) parts.push(`${p} = ${o.eq}`);
  return parts.join(', ');
}

/**
 * Drag-to-reorder beacon priority for one phase.
 *
 * HTML5 drag events rather than a library — this is a short list on a
 * desktop-only editing screen, so the ~40 lines are cheaper than a dependency.
 *
 * Enforces the boost ordering rule: a `buffed:` entry must sit ABOVE the plain
 * entry of the same colour. A boosted white always outranks a raw one, so the
 * reverse order can never fire — we refuse the drop and say why instead of
 * silently accepting a list with a dead rule in it.
 */
function PriorityEditor({
  entries,
  onChange,
  onError,
}: {
  entries: string[];
  onChange: (next: string[]) => void;
  onError: (msg: string) => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  /** Would this ordering put a plain entry above its own buffed twin? */
  const brokenPair = (list: string[]): string | null => {
    for (let i = 0; i < list.length; i++) {
      const a = parseEntry(list[i]!);
      if (a.boosted) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = parseEntry(list[j]!);
        if (b.boosted && b.color === a.color) return a.color;
      }
    }
    return null;
  };

  const commit = (next: string[]) => {
    const bad = brokenPair(next);
    if (bad) {
      onError(
        `A boosted ${bad} must rank above a plain ${bad} — a boosted beacon always outranks a raw one, so that order could never apply.`,
      );
      return;
    }
    onChange(next);
  };

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...entries];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    commit(next);
  };

  const used = new Set(entries);
  const addable = BEACON_LIST.filter(
    (c) => !used.has(c) || !used.has(`buffed:${c}`),
  );

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {entries.map((entry, i) => {
          const { color, boosted } = parseEntry(entry);
          return (
            <span
              key={entry}
              draggable
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(i);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) move(dragFrom, i);
                setDragFrom(null);
                setDragOver(null);
              }}
              className={`group inline-flex cursor-grab items-center gap-1 rounded px-1.5 py-0.5 text-[11px] active:cursor-grabbing ${
                CHIP[color] ?? 'bg-zinc-700'
              } ${boosted ? 'ring-1 ring-cyan-300' : ''} ${
                dragOver === i && dragFrom !== i ? 'outline outline-2 outline-white' : ''
              } ${dragFrom === i ? 'opacity-40' : ''}`}
              title="drag to reorder · click to toggle boosted · ✕ to remove"
            >
              <span className="opacity-50">⠿</span>
              <button
                onClick={() => {
                  const next = [...entries];
                  next[i] = boosted ? color : `buffed:${color}`;
                  commit(next);
                }}
                className="font-medium"
              >
                {i + 1}. {boosted ? '✦' : ''}{color}
              </button>
              <button
                onClick={() => commit(entries.filter((_, k) => k !== i))}
                className="opacity-40 hover:opacity-100"
                title="remove"
              >
                ✕
              </button>
            </span>
          );
        })}

        {adding ? (
          <select
            autoFocus
            className="rounded bg-zinc-800 px-1 py-0.5 text-[11px]"
            defaultValue=""
            onBlur={() => setAdding(false)}
            onChange={(e) => {
              if (e.target.value) commit([...entries, e.target.value]);
              setAdding(false);
            }}
          >
            <option value="">add…</option>
            {addable.flatMap((c) => [
              !used.has(c) ? <option key={c} value={c}>{c}</option> : null,
              !used.has(`buffed:${c}`) ? (
                <option key={`b-${c}`} value={`buffed:${c}`}>✦ buffed:{c}</option>
              ) : null,
            ])}
          </select>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="rounded border border-dashed border-zinc-600 px-1.5 py-0.5 text-[11px] text-zinc-400 hover:border-zinc-400 hover:text-zinc-200"
          >
            + beacon
          </button>
        )}
      </div>
      {entries.length === 0 && (
        <p className="mt-1 text-[11px] text-zinc-600">
          no priority — every beacon scores the neutral fallback here
        </p>
      )}
    </div>
  );
}

/** Numeric knob that writes straight back into the strategy. */
function NumberKnob({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px]">
      <span className="font-mono text-cyan-400">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 rounded bg-zinc-950 px-1.5 py-0.5 text-right text-zinc-200"
      />
    </label>
  );
}

export default function Editor() {
  const { strategy, strategyCustomized, applyStrategy, resetStrategy } = useTracker();
  const [hydrated, setHydrated] = useState(false);
  const [json, setJson] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [panel, setPanel] = useState<'flow' | 'combos' | 'tree'>('combos');

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (hydrated) setJson(JSON.stringify(strategy, null, 2));
  }, [hydrated, strategy]);

  if (!hydrated) return <main className="p-8 text-sm text-zinc-500">Loading…</main>;

  const isCustom = strategyCustomized;

  /**
   * Apply a structural edit: clone the strategy, mutate, push through the same
   * validation as an import, and resync the JSON pane. Every direct-manipulation
   * control routes through here so the two views can never diverge.
   */
  const mutate = (fn: (draft: Record<string, unknown>) => void, note?: string) => {
    const draft = JSON.parse(JSON.stringify(strategy)) as Record<string, unknown>;
    fn(draft);
    const err = applyStrategy(draft);
    if (err) {
      setMsg({ kind: 'err', text: err });
      return;
    }
    setJson(JSON.stringify(draft, null, 2));
    setMsg({ kind: 'ok', text: note ?? 'Applied — the tracker is scoring against this now.' });
  };

  const apply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      setMsg({ kind: 'err', text: `Invalid JSON: ${e instanceof Error ? e.message : e}` });
      return;
    }
    const err = applyStrategy(parsed);
    setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: 'Strategy applied. The tracker now scores against it.' });
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(strategy, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${strategy.id || 'strategy'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      setJson(text);
      try {
        const err = applyStrategy(JSON.parse(text));
        setMsg(err ? { kind: 'err', text: err } : { kind: 'ok', text: `Imported ${file.name}.` });
      } catch (err) {
        setMsg({ kind: 'err', text: `Invalid JSON: ${err instanceof Error ? err.message : err}` });
      }
    });
    e.target.value = '';
  };

  type Phase = {
    id: string; name?: string; when?: unknown; beaconPriority?: string[];
    decision?: { test: string; ifTrue: string; ifFalse: string };
    [k: string]: unknown;
  };
  const phases = strategy.phases as Phase[];
  const safety = strategy.safety as Array<{
    id: string; when?: unknown; prefer?: string[]; suppress?: string[]; why?: string;
  }>;
  const tactics = (strategy as { tactics?: Record<string, unknown> }).tactics;
  const verdictScores = (strategy as { verdictScores?: Record<string, unknown> }).verdictScores;

  // Fields already shown in the card head; everything else goes in "details".
  const SHOWN = new Set(['id', 'name', 'when', 'beaconPriority', 'decision']);

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Strategy Editor</h1>
        <span className="rounded bg-zinc-800 px-2 py-1 text-xs">
          active: <b>{strategy.name ?? strategy.id}</b>{' '}
          {isCustom && <span className="text-amber-400">(custom)</span>}
        </span>
        <Link
          href="/"
          className="ml-auto rounded bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700"
        >
          ← Tracker
        </Link>
      </header>

      {msg && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            msg.kind === 'ok'
              ? 'border-green-700 bg-green-950 text-green-200'
              : 'border-red-700 bg-red-950 text-red-200'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Visualisation */}
        <section className="space-y-3">
          {/* Two axes of the same strategy: Flow is priority over TIME,
              Tree is priority over MISSIONS HELD. */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {(['combos', 'flow', 'tree'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPanel(p)}
                  className={`rounded px-2 py-1 text-sm font-semibold capitalize ${
                    panel === p ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            {panel === 'flow' && (
              <div className="flex gap-2 text-[11px]">
                <button onClick={() => setAllOpen(true)} className="text-zinc-500 hover:text-zinc-300">expand all</button>
                <button onClick={() => setAllOpen(false)} className="text-zinc-500 hover:text-zinc-300">collapse all</button>
              </div>
            )}
          </div>

          {panel === 'tree' && <TreeView />}

          {panel === 'combos' && (
            <CombosTab
              combos={(strategy.combos ?? DEFAULT_COMBOS) as Combo[]}
              onChange={(next, note) =>
                mutate((d) => {
                  d.combos = next;
                }, note)
              }
            />
          )}

          {panel === 'flow' && (
          <>
          <p className="text-xs text-zinc-500">
            Each phase triggers on its condition (last matching phase wins). Its beacon priority is
            high→low. A <span className="text-cyan-300">✦ boosted</span> entry (e.g.{' '}
            <code>buffed:white</code>) only counts when that beacon is aqua/rainbow-boosted, and
            outranks the plain one. Expand a phase to see everything.
          </p>
          {phases.map((p) => {
            const extras = Object.entries(p).filter(([k]) => !SHOWN.has(k));
            return (
              <details
                key={p.id}
                open={allOpen}
                className="rounded-lg border border-zinc-800 bg-zinc-900"
              >
                <summary className="cursor-pointer list-none p-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold">{p.name ?? p.id}</span>
                    <span className="text-[11px] text-zinc-500">
                      {p.when ? `when ${condText(p.when)}` : p.decision ? 'decision node' : ''}
                    </span>
                    {extras.length > 0 && (
                      <span className="ml-auto text-[10px] text-zinc-600">
                        {extras.length} more field{extras.length > 1 ? 's' : ''} ▾
                      </span>
                    )}
                  </div>
                  {p.decision ? (
                    <p className="mt-1 text-xs text-zinc-400">
                      test <code>{p.decision.test}</code> → {p.decision.ifTrue} / {p.decision.ifFalse}
                    </p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(p.beaconPriority ?? []).map((entry, i) => {
                        const { color, boosted, prefix } = parseEntry(entry);
                        return (
                          <span
                            key={entry}
                            title={boosted ? `${prefix}: only when ${color} is boosted` : color}
                            className={`rounded px-1.5 py-0.5 text-[11px] ${CHIP[color] ?? 'bg-zinc-700'} ${
                              boosted ? 'ring-1 ring-cyan-300' : ''
                            }`}
                          >
                            {i + 1}. {boosted ? '✦' : ''}{color}
                          </span>
                        );
                      })}
                      <span className="self-center text-[10px] text-zinc-600">
                        — expand to edit
                      </span>
                    </div>
                  )}
                </summary>

                {/* Editable priority lives in the body: dragging inside a
                    <summary> would toggle the disclosure on every grab. */}
                {!p.decision && (
                  <div className="border-t border-zinc-800 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                      beacon priority — drag to reorder, click a chip to toggle ✦boosted
                    </div>
                    <PriorityEditor
                      entries={p.beaconPriority ?? []}
                      onError={(text) => setMsg({ kind: 'err', text })}
                      onChange={(next) =>
                        mutate((d) => {
                          const ph = (d.phases as Array<Record<string, unknown>>).find(
                            (x) => x.id === p.id,
                          );
                          if (ph) ph.beaconPriority = next;
                        }, `Updated "${p.name ?? p.id}" priority.`)
                      }
                    />
                  </div>
                )}
                {extras.length > 0 && (
                  <div className="space-y-2 border-t border-zinc-800 px-3 py-2">
                    {extras.map(([k, v]) => (
                      <div key={k} className="text-xs">
                        <span className="font-mono text-cyan-400">{k}</span>
                        {typeof v === 'string' ? (
                          <span className="text-zinc-300"> — {v}</span>
                        ) : (
                          <pre className="mt-0.5 overflow-x-auto rounded bg-zinc-950 p-2 text-[11px] text-zinc-400">
                            {JSON.stringify(v, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </details>
            );
          })}

          <h2 className="pt-2 font-semibold">Safety overrides</h2>
          {safety.map((r) => (
            <div key={r.id} className="rounded-lg border border-red-900/50 bg-zinc-900 p-2 text-xs">
              <b>{r.id}</b>{' '}
              <span className="text-zinc-500">{r.when ? `when ${condText(r.when)}` : ''}</span>
              {r.prefer && <div className="text-green-400">prefer: {r.prefer.join(', ')}</div>}
              {r.suppress && <div className="text-red-400">suppress: {r.suppress.join(', ')}</div>}
              {r.why && <div className="mt-0.5 text-zinc-400">{r.why}</div>}
            </div>
          ))}

          {tactics && (
            <>
              <h2 className="pt-2 font-semibold">Tactics</h2>
              <p className="text-xs text-zinc-500">
                Cross-phase scoring layered on top of phase priority. Expand each to see its knobs.
              </p>
              {Object.entries(tactics)
                .filter(([, v]) => v && typeof v === 'object')
                .map(([name, v]) => {
                  const t = v as Record<string, unknown>;
                  return (
                    <details key={name} open={allOpen} className="rounded-lg border border-zinc-800 bg-zinc-900">
                      <summary className="cursor-pointer list-none p-2 text-xs">
                        <span className="font-semibold text-cyan-300">{name}</span>
                        {typeof t.why === 'string' && (
                          <span className="text-zinc-500"> — {t.why}</span>
                        )}
                      </summary>
                      <div className="space-y-1 border-t border-zinc-800 p-2">
                        {Object.entries(t)
                          .filter(([, val]) => typeof val === 'number')
                          .map(([k, val]) => (
                            <NumberKnob
                              key={k}
                              label={k}
                              value={val as number}
                              onChange={(nv) =>
                                mutate((d) => {
                                  const tt = (d.tactics as Record<string, Record<string, unknown>>)[
                                    name
                                  ];
                                  if (tt) tt[k] = nv;
                                }, `${name}.${k} = ${nv}`)
                              }
                            />
                          ))}
                        {Object.entries(t).every(([, val]) => typeof val !== 'number') && (
                          <pre className="overflow-x-auto text-[11px] text-zinc-400">
                            {JSON.stringify(v, null, 2)}
                          </pre>
                        )}
                      </div>
                    </details>
                  );
                })}
            </>
          )}

          {/* Verdict scores — the expert classification weights. */}
          {verdictScores && (
            <>
              <h2 className="pt-2 font-semibold">Verdict weights</h2>
              <p className="text-xs text-zinc-500">
                Applied to mission ranking. Negative values push a mission down. These encode one
                expert&apos;s opinion — disagree freely.
              </p>
              <div className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-900 p-2">
                {Object.entries(verdictScores)
                  .filter(([, v]) => typeof v === 'number')
                  .map(([k, v]) => (
                    <NumberKnob
                      key={k}
                      label={k}
                      value={v as number}
                      onChange={(nv) =>
                        mutate((d) => {
                          (d.verdictScores as Record<string, unknown>)[k] = nv;
                        }, `verdictScores.${k} = ${nv}`)
                      }
                    />
                  ))}
              </div>
            </>
          )}
          </>
          )}
        </section>

        {/* JSON editor */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Edit JSON</h2>
            <button onClick={apply} className="rounded bg-green-700 px-3 py-1 text-sm hover:bg-green-600">
              Apply
            </button>
            <button onClick={download} className="rounded bg-zinc-700 px-3 py-1 text-sm hover:bg-zinc-600">
              Export ↓
            </button>
            <label className="cursor-pointer rounded bg-zinc-700 px-3 py-1 text-sm hover:bg-zinc-600">
              Import ↑
              <input type="file" accept="application/json,.json" onChange={importFile} className="hidden" />
            </label>
            <button
              onClick={() => {
                resetStrategy();
                setMsg({ kind: 'ok', text: 'Reset to the built-in default strategy.' });
              }}
              className="rounded bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700"
            >
              Reset to default
            </button>
          </div>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
            className="h-[70vh] w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-200"
          />
          <p className="text-xs text-zinc-500">
            Edit, then <b>Apply</b>. The tracker (and the simulator) score against the applied
            strategy immediately — and it persists across reloads. Game facts (beacon numbers,
            missions) live in data/ and are not edited here.
          </p>
        </section>
      </div>
    </main>
  );
}
