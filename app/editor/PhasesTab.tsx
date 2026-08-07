'use client';

/**
 * Phases tab — priority as a function of WHERE YOU ARE IN THE RUN.
 *
 * The problem this solves: a phase carries up to eight fields, and only three
 * of them (`when`, `beaconPriority`, `decision`) change any advice. The other
 * twenty-odd are expert prose ported from the source guide — `intent`,
 * `escapeHatch`, `stacking`, `crimsonPolicy`, `notes` — and the old editor
 * rendered them as collapsed JSON labelled "N more fields", which reads as
 * "settings you have not configured yet".
 *
 * That prose is the most valuable thing in the file. It is the reasoning that
 * makes the strategy trustworthy. So it is shown as documentation, in full,
 * and clearly marked as something the advisor does not execute — rather than
 * hidden behind a disclosure that implies it does.
 */

import { useState } from 'react';
import { PHASE_TOP_SCORE } from '../../engine/evaluator';
import PriorityEditor, { condText } from './PriorityEditor';

/** Fields the engine actually reads. Everything else is documentation. */
const LIVE = new Set(['id', 'name', 'when', 'beaconPriority', 'decision', 'entryFrom']);

/** Read but only to append an explanation — behaviourally near-inert. */
const SEMI_LIVE = new Set(['hardRule']);

type Phase = Record<string, unknown> & { id: string; name?: string };

/** `escapeHatch` -> `escape hatch`, so field names read as words. */
const humanise = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/** One value as readable text, whatever shape it arrived in. */
function flatten(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(flatten).join(' · ');
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${humanise(k)}: ${flatten(x)}`)
      .join('\n');
  }
  return String(v);
}

function Prose({ label, value }: { label: string; value: unknown }) {
  const text =
    typeof value === 'string'
      ? value
      : Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? (value as string[]).join('\n')
        : null;

  return (
    <div className="border-l-2 border-zinc-800 pl-2.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      {text !== null ? (
        text.split('\n').map((line, i) => (
          <p key={i} className="text-[11px] leading-relaxed text-zinc-400">
            {line}
          </p>
        ))
      ) : (
        <div className="space-y-0.5">
          {flatten(value)
            .split('\n')
            .map((line, i) => (
              <p key={i} className="text-[11px] leading-relaxed text-zinc-400">
                {line}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

export default function PhasesTab({
  phases,
  onChange,
  onError,
}: {
  phases: Phase[];
  onChange: (next: Phase[], note: string) => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(phases[0]?.id ?? null);

  const patch = (id: string, fn: (p: Phase) => Phase, note: string) =>
    onChange(phases.map((p) => (p.id === id ? fn(p) : p)), note);

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Phases</h2>

      <p className="text-xs text-zinc-500">
        Phases run top to bottom and the <b className="text-zinc-300">last matching one wins</b>.
        Drag to reorder priority — position 1 scores {PHASE_TOP_SCORE}, each step down is 10 less,
        and a beacon you do not list scores just 5. Positions are{' '}
        <b className="text-zinc-300">fixed by rank, not by list length</b>, so adding a beacon
        never re-weights the ones above it.
      </p>

      <div className="space-y-2">
        {phases.map((p) => {
          const isOpen = open === p.id;
          const priority = (p.beaconPriority as string[] | undefined) ?? [];
          const prose = Object.entries(p).filter(
            ([k, v]) => !LIVE.has(k) && v !== undefined && v !== null,
          );

          return (
            <div key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-900">
              <button
                onClick={() => setOpen(isOpen ? null : p.id)}
                className="flex w-full flex-wrap items-baseline gap-2 p-2 text-left hover:bg-zinc-800/50"
              >
                <span className="text-[10px] text-zinc-600">{isOpen ? '▾' : '▸'}</span>
                <span className="text-sm font-semibold">{(p.name as string) ?? p.id}</span>
                {p.when !== undefined && (
                  <span className="text-[11px] text-zinc-500">when {condText(p.when)}</span>
                )}
                {priority.length === 0 && (
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                    decision only
                  </span>
                )}
                <span className="ml-auto text-[10px] text-zinc-600">
                  {priority.length} ranked · {prose.length} notes
                </span>
              </button>

              {isOpen && (
                <div className="space-y-3 border-t border-zinc-800 p-2">
                  {priority.length > 0 ? (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-600">
                        beacon priority — drag to reorder
                      </div>
                      <PriorityEditor
                        entries={priority}
                        onError={onError}
                        onChange={(next) =>
                          patch(p.id, (x) => ({ ...x, beaconPriority: next }), `${p.id}: priority`)
                        }
                      />
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-500">
                      This phase routes rather than ranks
                      {p.decision ? ` — ${JSON.stringify(p.decision)}` : ''}. Give it a priority
                      list only if you want it to override beacon order too.
                    </p>
                  )}

                  {prose.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] uppercase tracking-wide text-zinc-600">
                          notes
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          expert reasoning — the advisor does not execute these
                        </span>
                      </div>
                      {prose.map(([k, v]) => (
                        <Prose
                          key={k}
                          label={
                            SEMI_LIVE.has(k)
                              ? `${humanise(k)} — quoted in the advice`
                              : humanise(k)
                          }
                          value={v}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
