'use client';

/**
 * Strategy editor. Visualises the advisor's strategy (phases, priorities,
 * safety rules, goal) and lets the user edit the JSON, then import/export it.
 * The tracker scores live against whatever strategy is applied here.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
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

export default function Editor() {
  const { strategy, strategyCustomized, applyStrategy, resetStrategy } = useTracker();
  const [hydrated, setHydrated] = useState(false);
  const [json, setJson] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (hydrated) setJson(JSON.stringify(strategy, null, 2));
  }, [hydrated, strategy]);

  if (!hydrated) return <main className="p-8 text-sm text-zinc-500">Loading…</main>;

  const isCustom = strategyCustomized;

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

  const phases = strategy.phases as Array<{
    id: string; name?: string; when?: unknown; beaconPriority?: string[];
    decision?: { test: string; ifTrue: string; ifFalse: string };
  }>;
  const safety = strategy.safety as Array<{
    id: string; when?: unknown; prefer?: string[]; suppress?: string[]; why?: string;
  }>;

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
          <h2 className="font-semibold">Flow</h2>
          <p className="text-xs text-zinc-500">
            Each phase triggers on its condition (last matching phase wins). Its beacon priority
            is high→low; the archetype and objective logic layer on top of this.
          </p>
          {phases.map((p) => (
            <div key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">{p.name ?? p.id}</span>
                <span className="text-[11px] text-zinc-500">
                  {p.when ? `when ${condText(p.when)}` : p.decision ? 'decision node' : ''}
                </span>
              </div>
              {p.decision ? (
                <p className="mt-1 text-xs text-zinc-400">
                  test <code>{p.decision.test}</code> → {p.decision.ifTrue} / {p.decision.ifFalse}
                </p>
              ) : (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(p.beaconPriority ?? []).map((c, i) => (
                    <span
                      key={c}
                      className={`rounded px-1.5 py-0.5 text-[11px] ${CHIP[c] ?? 'bg-zinc-700'}`}
                    >
                      {i + 1}. {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

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
