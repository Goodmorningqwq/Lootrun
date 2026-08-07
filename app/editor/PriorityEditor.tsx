'use client';

/**
 * Drag-to-reorder beacon priority for one phase.
 *
 * Extracted so the Flow timeline and the Phases tab share one implementation —
 * they were about to diverge, and a phase list that reorders differently
 * depending on which panel you edit it from would be a nasty bug to chase.
 *
 * HTML5 drag events rather than a library: a short list on a desktop-only
 * editing screen, so the ~40 lines are cheaper than a dependency.
 */

import { useState } from 'react';
import { BEACON_LIST, CHIP } from './beaconStyles';

const BOOST_PREFIXES = new Set(['buffed', 'aqua', 'boosted', 'vibrant']);

/** Split "buffed:white" -> {color:'white', boosted:true, prefix:'buffed'}. */
export function parseEntry(entry: string): { color: string; boosted: boolean; prefix?: string } {
  const i = entry.indexOf(':');
  if (i < 0) return { color: entry, boosted: false };
  const prefix = entry.slice(0, i).toLowerCase();
  return { color: entry.slice(i + 1), boosted: BOOST_PREFIXES.has(prefix), prefix };
}

/** Render a `when` condition as something a human reads. */
export function condText(c: unknown): string {
  if (!c || typeof c !== 'object') return '';
  const o = c as Record<string, unknown> & { path?: string; flag?: string; all?: unknown[] };
  if (Array.isArray(o.all)) return o.all.map(condText).filter(Boolean).join(' and ');
  if (Array.isArray(o.any)) return o.any.map(condText).filter(Boolean).join(' or ');
  if (o.flag) return `${o.flag} is active`;
  const p = o.path ?? '?';
  const parts: string[] = [];
  const n = o as Record<string, number | undefined>;
  if (n.lt !== undefined) parts.push(`${p} < ${n.lt}`);
  if (n.lte !== undefined) parts.push(`${p} ≤ ${n.lte}`);
  if (n.gt !== undefined) parts.push(`${p} > ${n.gt}`);
  if (n.gte !== undefined) parts.push(`${p} ≥ ${n.gte}`);
  if (n.eq !== undefined) parts.push(`${p} = ${n.eq}`);
  return parts.join(', ');
}

export default function PriorityEditor({
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
  const addable = BEACON_LIST.filter((c) => !used.has(c) || !used.has(`buffed:${c}`));

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
                {i + 1}. {boosted ? '✦' : ''}
                {color}
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
              !used.has(c) ? (
                <option key={c} value={c}>
                  {c}
                </option>
              ) : null,
              !used.has(`buffed:${c}`) ? (
                <option key={`b-${c}`} value={`buffed:${c}`}>
                  ✦ buffed:{c}
                </option>
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
