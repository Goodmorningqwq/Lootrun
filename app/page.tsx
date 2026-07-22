'use client';

/**
 * Run Tracker — the primary screen. Design constraint: this is used mid-run
 * against a timer, so every decision must be enterable in a few clicks with
 * no typing, and the advice must always show its reasoning.
 */

import { useEffect, useMemo, useState } from 'react';
import { BEACON_COLORS, type BeaconColor, type OrangeStack, type Tier } from '../engine/types';
import {
  beaconChoices,
  isExcluded,
  isExhausted,
  isUnlocked,
  resolveTier,
} from '../engine/engine';
import { activePhases, evaluateOffer } from '../engine/evaluator';
import { BEACONS, RANKS, vibrancyChanceFor } from '../engine/data';
import missionsJson from '../data/missions.json';
import trialsJson from '../data/trials.json';
import boonsJson from '../data/boons.json';
import { useCurrentRun, useTracker } from './store';

const MISSIONS = (missionsJson as { missions: Array<{ id: string; name: string; effect: string | null }> })
  .missions.filter((m) => m.effect);
const TRIALS = (trialsJson as { trials: Array<{ id: string; name: string; requirement: string | null; guideTier?: string }> })
  .trials.filter((t) => t.requirement);
const BOONS = (boonsJson as { boons: Array<{ id: string; name: string; kind: string }> }).boons;

const CHIP: Record<BeaconColor, string> = {
  blue: 'bg-blue-600 text-white',
  purple: 'bg-purple-600 text-white',
  yellow: 'bg-yellow-500 text-black',
  aqua: 'bg-cyan-500 text-black',
  orange: 'bg-orange-500 text-black',
  green: 'bg-green-600 text-white',
  darkGrey: 'bg-zinc-600 text-white',
  white: 'bg-zinc-100 text-black',
  grey: 'bg-zinc-400 text-black',
  red: 'bg-red-600 text-white',
  pink: 'bg-pink-500 text-black',
  crimson: 'bg-rose-900 text-white',
  rainbow: 'bg-gradient-to-r from-red-500 via-yellow-400 to-blue-500 text-black',
};

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const TIER_STYLE: Record<Tier, string> = {
  0: 'text-zinc-400',
  1: 'text-cyan-300',
  2: 'text-purple-300',
  3: 'text-yellow-300',
};
const TIER_NAME: Record<Tier, string> = { 0: 'T0', 1: 'T1', 2: 'T2', 3: 'T3' };

/** What this beacon would actually grant at the given tier — from data. */
function tierPreview(color: BeaconColor, tier: Tier): string | null {
  const t = BEACONS[color].tiers as Record<string, unknown>;
  const n = (k: string) => (Array.isArray(t[k]) ? (t[k] as number[])[tier] : undefined);
  switch (color) {
    case 'green': return `+${n('seconds')}s`;
    case 'white':
    case 'red': return `+${n('challenges')} challenges`;
    case 'pink': return `+${n('rerolls')} rerolls`;
    case 'orange': return `+1 choice for ${n('durationChallenges')}`;
    case 'rainbow': return `vibrant for ${n('vibrantChallenges')}`;
    case 'yellow': return `${n('flyingChests')} flying chests`;
    case 'purple':
    case 'darkGrey': return `+${n('curses')} curses · +${n('pulls')} pulls`;
    case 'blue': return `boon at ${n('potencyPct')}%`;
    case 'grey': return `${n('missionChoices')} mission choices`;
    case 'crimson': return `${n('trialChoices')} trial choices`;
    case 'aqua': return `banks +${Math.min(3, tier + 1)} tier`;
    default: return null;
  }
}

/** "+2 choices for 4 more offers, then +1 for 6 more" from the orange stacks. */
function orangeSummary(stacks: OrangeStack[]): string {
  const expiring = new Map<number, number>();
  for (const o of stacks) {
    expiring.set(o.challengesLeft, (expiring.get(o.challengesLeft) ?? 0) + o.bonus);
  }
  const levels = [...expiring.keys()].sort((a, b) => a - b);
  let bonus = stacks.reduce((s, o) => s + o.bonus, 0);
  let prev = -1;
  const parts: string[] = [];
  for (const level of levels) {
    const span = level - prev;
    parts.push(`+${bonus} for ${span} more offer${span === 1 ? '' : 's'}`);
    bonus -= expiring.get(level) ?? 0;
    prev = level;
  }
  return parts.join(', then ');
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-lg bg-zinc-900 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold ${accent ?? ''}`}>{value}</div>
    </div>
  );
}

export default function Tracker() {
  const run = useCurrentRun();
  const {
    offer, toggleOffer, toggleVibrant, clearOffer, take, reroll,
    markDeath, markFailedChallenge, undo, reset, lastError,
    addMission, removeMission, addTrial, removeTrial, adjustTime,
    addBoon, removeBoonAt, labelBoon, setRank,
  } = useTracker();

  const advice = useMemo(
    () => (offer.length > 0 ? evaluateOffer(run, offer) : null),
    [run, offer],
  );
  const phase = useMemo(() => {
    const matched = activePhases(run);
    return matched[matched.length - 1]?.id ?? 'opening';
  }, [run]);

  const choices = beaconChoices(run);

  /** Take the advisor's top non-suppressed pick (Enter key / convenience). */
  const takeTop = () => {
    if (!advice) return;
    const top = advice.ranked.find((r) => !r.suppressed);
    if (!top) return;
    take(offer.findIndex((o) => o.color === top.color && (o.vibrant ?? false) === top.vibrant));
  };

  // Keyboard: Enter = take top pick, Ctrl/Cmd+Z = undo.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'Enter') takeTop();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // The store rehydrates from localStorage on the client; rendering before
  // that finishes would mismatch the server-rendered fresh-run HTML.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (!hydrated) {
    return <main className="p-8 text-sm text-zinc-500">Loading run…</main>;
  }

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Lootrun Advisor</h1>
        <span className="rounded bg-zinc-800 px-2 py-1 text-xs uppercase tracking-wide">
          phase: {phase}
        </span>
        {advice && (
          <span
            className={`rounded px-2 py-1 text-xs font-semibold uppercase ${
              advice.runnable ? 'bg-green-800 text-green-100' : 'bg-amber-900 text-amber-100'
            }`}
          >
            {advice.runnable ? 'runnable' : 'not runnable'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            rank
            <select
              value={run.rank}
              onChange={(e) => setRank(e.target.value)}
              className="rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100"
              title="Lootrun Division rank — gates beacons, rerolls, choices and vibrancy"
            >
              {RANKS.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <button onClick={undo} className="rounded bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700">
            Undo
          </button>
          <button onClick={reset} className="rounded bg-red-900 px-3 py-1 text-sm hover:bg-red-800">
            New run
          </button>
        </div>
      </header>

      {/* Warnings / errors */}
      {advice?.warnings.map((w) => (
        <div key={w} className="rounded-lg border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-200">
          ⚠ {w}
        </div>
      ))}
      {lastError && (
        <div className="rounded-lg border border-amber-700 bg-amber-950 px-3 py-2 text-sm text-amber-200">
          {lastError}
        </div>
      )}

      {/* State panel */}
      <section className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        <Stat label="Challenge" value={run.challengesCompleted} />
        <Stat label="Remaining" value={run.challengesRemaining}
          accent={run.challengesRemaining <= 4 ? 'text-red-400' : undefined} />
        <Stat label="Timer" value={mmss(run.timeRemaining)}
          accent={run.timeRemaining < 150 ? 'text-red-400' : undefined} />
        <Stat label="Choices" value={choices} />
        <Stat label="Rerolls" value={run.beaconRerolls} />
        <Stat label="Pulls" value={run.pulls} />
        <Stat label="Curses" value={run.curses.generic + run.curses.radiance} />
        <Stat label="Aqua bank" value={run.pendingAqua > 0 ? `+${run.pendingAqua}` : '—'}
          accent={run.pendingAqua > 0 ? 'text-cyan-400' : undefined} />
        <Stat label="Rainbow" value={run.rainbowChallengesLeft > 0 ? `${run.rainbowChallengesLeft}` : '—'}
          accent={run.rainbowChallengesLeft > 0 ? 'text-yellow-300' : undefined} />
      </section>

      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
        <span>Timer adjust:</span>
        {[-60, -10, 10, 60].map((d) => (
          <button key={d} onClick={() => adjustTime(d)}
            className="rounded bg-zinc-800 px-2 py-0.5 hover:bg-zinc-700">
            {d > 0 ? `+${d}` : d}s
          </button>
        ))}
        {run.excludedNext.length > 0 && (
          <span className="ml-auto">
            Not offered next: {run.excludedNext.join(', ')}
          </span>
        )}
      </div>

      {/* Orange duration breakdown */}
      {run.orangeStacks.length > 0 && (
        <div className="rounded-lg border border-orange-900 bg-orange-950/40 px-3 py-2 text-sm text-orange-200">
          🟧 Orange: {orangeSummary(run.orangeStacks)}
        </div>
      )}

      {/* Active boosts */}
      {run.pendingAqua > 0 && (
        <div className="rounded-lg border border-cyan-800 bg-cyan-950/40 px-3 py-2 text-sm text-cyan-200">
          🟦 Aqua banked (+{run.pendingAqua} tier{run.pendingAqua > 1 ? 's' : ''}) — your next
          beacon resolves boosted. Chips below show the exact boosted values.
        </div>
      )}
      {run.rainbowChallengesLeft > 0 && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-950/40 px-3 py-2 text-sm text-yellow-200">
          🌈 Rainbow — all beacons vibrant for {run.rainbowChallengesLeft} more challenge
          {run.rainbowChallengesLeft > 1 ? 's' : ''}.
        </div>
      )}

      {/* Offer builder */}
      <section className="rounded-xl bg-zinc-900 p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold">
            What are you offered? <span className="text-sm text-zinc-500">({offer.length}/{choices})</span>
          </h2>
          {offer.length > 0 && (
            <button onClick={clearOffer} className="text-sm text-zinc-400 hover:text-zinc-200">
              clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {BEACON_COLORS.map((c) => {
            const inOffer = offer.some((o) => o.color === c);
            const illegal = isExhausted(run, c) || !isUnlocked(run, c) || isExcluded(run, c);
            return (
              <button
                key={c}
                onClick={() => toggleOffer(c)}
                disabled={illegal && !inOffer}
                title={
                  isExhausted(run, c) ? 'use cap reached'
                  : !isUnlocked(run, c) ? 'not available at this challenge'
                  : isExcluded(run, c) ? 'excluded — was offered last challenge'
                  : BEACONS[c].name
                }
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${CHIP[c]} ${
                  inOffer ? 'ring-2 ring-white' : illegal ? 'opacity-25' : 'opacity-80 hover:opacity-100'
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>

        {offer.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {offer.map((o, i) => {
              const canVibrant = vibrancyChanceFor(run.rank) > 0;
              const tier = resolveTier(run, o);
              const preview = tierPreview(o.color, tier);
              return (
                <div
                  key={`${o.color}-${i}`}
                  className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-2 py-1"
                >
                  <button
                    onClick={() => canVibrant && toggleVibrant(i)}
                    className={`rounded px-2 py-0.5 text-xs ${CHIP[o.color]} ${
                      o.vibrant ? 'ring-2 ring-fuchsia-400' : 'opacity-90'
                    }`}
                    title={
                      canVibrant
                        ? 'click to toggle vibrant'
                        : 'vibrant beacons unlock at Assistant III'
                    }
                  >
                    {o.color} {o.vibrant ? '✨' : ''}
                  </button>
                  <span className={`text-xs font-semibold ${TIER_STYLE[tier]}`}>
                    {TIER_NAME[tier]}
                  </span>
                  {preview && (
                    <span className={`text-xs ${TIER_STYLE[tier]}`}>{preview}</span>
                  )}
                </div>
              );
            })}
            {vibrancyChanceFor(run.rank) > 0 && (
              <span className="self-center text-xs text-zinc-500">
                click a chip to toggle vibrant
              </span>
            )}
          </div>
        )}
      </section>

      {/* Advice */}
      {advice && (
        <section className="rounded-xl bg-zinc-900 p-4">
          <h2 className="mb-3 font-semibold">Advice</h2>
          <ol className="space-y-2">
            {advice.ranked.map((r, i) => (
              <li
                key={`${r.color}-${i}`}
                className={`rounded-lg border p-3 ${
                  r.suppressed
                    ? 'border-zinc-800 opacity-50'
                    : i === 0
                      ? 'border-green-700 bg-green-950/40'
                      : 'border-zinc-800'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`rounded px-2 py-0.5 text-sm font-semibold ${CHIP[r.color]}`}>
                    #{i + 1} {r.color} {r.vibrant ? '✨' : ''}
                  </span>
                  <span className="text-xs text-zinc-500">score {r.score}</span>
                  {!r.suppressed && (
                    <button
                      onClick={() => take(offer.findIndex((o) => o.color === r.color && (o.vibrant ?? false) === r.vibrant))}
                      className="ml-auto rounded bg-green-700 px-3 py-1 text-sm font-medium hover:bg-green-600"
                    >
                      Take → complete
                    </button>
                  )}
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-zinc-400">
                  {r.reasons.map((why) => <li key={why}>• {why}</li>)}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Run events */}
      <section className="flex flex-wrap gap-2">
        <button onClick={reroll} className="rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">
          Use reroll ({run.beaconRerolls})
        </button>
        <button onClick={() => markDeath(false)} className="rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">
          Died (interlude)
        </button>
        <button onClick={() => markDeath(true)} className="rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">
          Died (in challenge)
        </button>
        <button onClick={markFailedChallenge} className="rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">
          Failed challenge
        </button>
      </section>

      {/* Boons */}
      <section className="rounded-xl bg-zinc-900 p-4">
        <h2 className="mb-2 font-semibold">
          Boons ({run.boons.length}
          {run.boons.length > 0 && (
            <span className="text-sm font-normal text-zinc-500">
              {' '}· total potency {Math.round(run.boons.reduce((n, b) => n + b.potency, 0) * 100)}%
            </span>
          )})
        </h2>
        <p className="mb-2 text-xs text-zinc-500">
          Blue takes are counted automatically at tier potency. Naming the boon is optional —
          only Ostinato and boon-pick advice need it. Use the dropdown for boons from other
          sources (Hoarder, Jester&apos;s Trick).
        </p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {run.boons.map((b, i) => (
            <button
              key={`${b.id}-${i}`}
              onClick={() => removeBoonAt(i)}
              title="click to remove"
              className={`rounded px-2 py-1 text-xs hover:bg-red-900 ${
                b.id === 'unknown' ? 'bg-zinc-700 italic text-zinc-300' : 'bg-blue-900'
              }`}
            >
              {b.id === 'unknown' ? 'unnamed' : BOONS.find((x) => x.id === b.id)?.name ?? b.id}
              {' '}{Math.round(b.potency * 100)}% ✕
            </button>
          ))}
        </div>
        <select
          className="w-full rounded bg-zinc-800 p-2 text-sm"
          value=""
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            // Label the most recent unnamed boon if one exists; otherwise add.
            const lastUnknown = run.boons.map((b) => b.id).lastIndexOf('unknown');
            if (lastUnknown >= 0) labelBoon(lastUnknown, id);
            else addBoon(id);
          }}
        >
          <option value="">
            {run.boons.some((b) => b.id === 'unknown')
              ? '+ name the latest unnamed boon…'
              : '+ add boon (Hoarder / Jester’s)…'}
          </option>
          {BOONS.map((b) => (
            <option key={b.id} value={b.id}>
              [{b.kind}] {b.name}
            </option>
          ))}
        </select>
      </section>

      {/* Missions & trials */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-zinc-900 p-4">
          <h2 className="mb-2 font-semibold">Missions ({run.missions.length}/3)</h2>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {run.missions.map((id) => (
              <button key={id} onClick={() => removeMission(id)}
                className="rounded bg-zinc-700 px-2 py-1 text-xs hover:bg-red-900"
                title="click to remove">
                {MISSIONS.find((m) => m.id === id)?.name ?? id} ✕
              </button>
            ))}
          </div>
          <select
            className="w-full rounded bg-zinc-800 p-2 text-sm"
            value=""
            onChange={(e) => e.target.value && addMission(e.target.value)}
          >
            <option value="">+ add mission…</option>
            {MISSIONS.filter((m) => !run.missions.includes(m.id)).map((m) => (
              <option key={m.id} value={m.id} title={m.effect ?? ''}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-xl bg-zinc-900 p-4">
          <h2 className="mb-2 font-semibold">Trials ({run.trials.length}/2)</h2>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {run.trials.map((id) => (
              <button key={id} onClick={() => removeTrial(id)}
                className="rounded bg-zinc-700 px-2 py-1 text-xs hover:bg-red-900"
                title="click to remove">
                {TRIALS.find((t) => t.id === id)?.name ?? id} ✕
              </button>
            ))}
          </div>
          <select
            className="w-full rounded bg-zinc-800 p-2 text-sm"
            value=""
            onChange={(e) => e.target.value && addTrial(e.target.value)}
          >
            <option value="">+ add trial…</option>
            {TRIALS.filter((t) => !run.trials.includes(t.id)).map((t) => (
              <option key={t.id} value={t.id}>
                {t.guideTier ? `[${t.guideTier}] ` : ''}{t.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <footer className="pb-8 text-center text-xs text-zinc-600">
        Wynncraft 2.2.1 · data-driven — all numbers live in data/, not code
      </footer>
    </main>
  );
}
