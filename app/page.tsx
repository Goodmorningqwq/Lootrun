'use client';

/**
 * Run Tracker — the primary screen. Design constraint: this is used mid-run
 * against a timer, so every decision must be enterable in a few clicks with
 * no typing, and the advice must always show its reasoning.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BEACON_COLORS, type BeaconColor, type OrangeStack, type Tier } from '../engine/types';
import {
  beaconChoices,
  firstMissionDue,
  isExcluded,
  isExhausted,
  isUnlocked,
  pendingMission,
  resolveTier,
} from '../engine/engine';
import { activePhases, evaluateMissionOffer, evaluateOffer } from '../engine/evaluator';
import {
  BEACONS,
  RANKS,
  baseChoicesFor,
  boonChoicesFor,
  dailyRewardRerollFor,
  interludeWalkSpeedFor,
  rankIndex,
  startingRerollsFor,
  vibrancyChanceFor,
} from '../engine/data';
import missionsJson from '../data/missions.json';
import trialsJson from '../data/trials.json';
import boonsJson from '../data/boons.json';
import { useCurrentRun, useTracker } from './store';
import { useForecast } from './useForecast';

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

/** Everything the current rank grants — beacons unlocked plus passive perks. */
function rankPerks(rankId: string): { unlocked: string[]; locked: string[]; perks: string[] } {
  const idx = rankIndex(rankId);
  const unlocked: string[] = [];
  const locked: string[] = [];
  RANKS.forEach((r, i) => {
    if (!r.unlocksBeacon) return;
    (i <= idx ? unlocked : locked).push(
      i <= idx ? r.unlocksBeacon : `${r.unlocksBeacon} (${r.name})`,
    );
  });

  const vib = vibrancyChanceFor(rankId);
  const walk = interludeWalkSpeedFor(rankId);
  const perks = [
    `${startingRerollsFor(rankId)} beacon reroll${startingRerollsFor(rankId) === 1 ? '' : 's'} per run`,
    `${baseChoicesFor(rankId)} base beacon choices`,
    `${boonChoicesFor(rankId)} boon choices per blue`,
    vib > 0 ? `${Math.round(vib * 100)}% vibrancy chance` : 'no vibrant beacons',
    walk > 0 ? `+${Math.round(walk * 100)}% interlude walk speed` : null,
    dailyRewardRerollFor(rankId)
      ? 'daily bonus includes +1 reward reroll'
      : 'daily bonus has NO reward reroll (needs Elite II)',
  ].filter((x): x is string => x !== null);

  return { unlocked, locked, perks };
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

/** Centered overlay. Click the backdrop or ✕ to dismiss. */
function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="mt-12 w-full max-w-lg rounded-xl border border-zinc-600 bg-zinc-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-zinc-400">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            title="close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Grey/forced mission entry: type the offered missions, get them ranked, take
 * one. Self-contained (reads the store) so it can appear both in the modal and
 * in the editable panel below.
 */
function MissionPicker() {
  const run = useCurrentRun();
  const { missionOffer, toggleMissionOffer, setMissionOffer, takeMissionFromOffer } =
    useTracker();
  const advice = useMemo(
    () => (missionOffer.length > 0 ? evaluateMissionOffer(run, missionOffer) : null),
    [run, missionOffer],
  );

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            Which missions are offered? ({missionOffer.length} entered)
          </span>
          {missionOffer.length > 0 && (
            <button
              onClick={() => setMissionOffer([])}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {MISSIONS.filter((m) => !run.missions.some((h) => h.id === m.id)).map((m) => (
            <button
              key={m.id}
              onClick={() => toggleMissionOffer(m.id)}
              title={m.effect ?? ''}
              className={`rounded px-1.5 py-0.5 text-[11px] ${
                missionOffer.includes(m.id)
                  ? 'bg-cyan-800 text-cyan-100 ring-1 ring-cyan-400'
                  : 'bg-zinc-800 hover:bg-zinc-700'
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      {advice && (
        <div className="space-y-2">
          {advice.committed && (
            <p className="text-xs text-cyan-300">
              Committed: {advice.committed.name} ({advice.committed.progress})
            </p>
          )}
          {advice.missingRoles.length > 0 && (
            <p className="text-xs text-amber-400">
              Still missing: {advice.missingRoles.join(', ')}
            </p>
          )}
          <ol className="space-y-1.5">
            {advice.ranked.map((r, i) => (
              <li
                key={r.id}
                className={`rounded-lg border p-2 ${
                  i === 0 ? 'border-green-700 bg-green-950/40' : 'border-zinc-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">
                    #{i + 1} {r.name}
                  </span>
                  <span className="text-[11px] text-zinc-500">score {r.score}</span>
                  <button
                    onClick={() => takeMissionFromOffer(r.id)}
                    className="ml-auto rounded bg-green-700 px-2 py-0.5 text-xs hover:bg-green-600"
                  >
                    Take
                  </button>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-500">{r.effect}</p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-400">
                  {r.reasons.map((why) => (
                    <li key={why}>• {why}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** Boon prompt shown after a blue: the boon is already counted; name it or move on. */
function BoonNamer({ onDone }: { onDone: () => void }) {
  const run = useCurrentRun();
  const { labelBoon, addBoon } = useTracker();
  const lastUnknown = run.boons.map((b) => b.id).lastIndexOf('unknown');
  const potency = lastUnknown >= 0 ? Math.round((run.boons[lastUnknown]?.potency ?? 1) * 100) : 100;

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-300">
        Boon counted automatically at <b>{potency}%</b> potency. Naming it is optional — only
        Ostinato and boon-pick advice use the specific type.
      </p>
      <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto">
        {BOONS.map((b) => (
          <button
            key={b.id}
            onClick={() => {
              if (lastUnknown >= 0) labelBoon(lastUnknown, b.id);
              else addBoon(b.id);
              onDone();
            }}
            className="rounded bg-zinc-800 px-2 py-1 text-left text-xs hover:bg-blue-900"
          >
            <span className="text-zinc-500">[{b.kind}]</span> {b.name}
          </button>
        ))}
      </div>
      <button
        onClick={onDone}
        className="w-full rounded bg-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-600"
      >
        Leave unnamed
      </button>
    </div>
  );
}

export default function Tracker() {
  const run = useCurrentRun();
  const {
    offer, toggleOffer, toggleVibrant, clearOffer, take, reroll,
    markDeath, markFailedChallenge, undo, reset, lastError,
    addTrial, removeTrial, adjustTime,
    addBoon, removeBoonAt, labelBoon, setRunSetup,
    missionOffer, dropMission, toggleFulfilled, prompt, dismissPrompt,
  } = useTracker();
  const [showPerks, setShowPerks] = useState(false);

  const pending = pendingMission(run);
  const missionDue = firstMissionDue(run);

  // Mission modal is dismissable, but reopens when a new trigger appears.
  const [missionModalClosed, setMissionModalClosed] = useState(false);
  useEffect(() => {
    setMissionModalClosed(false);
  }, [prompt, run.missions.length]);

  const { forecast, running: simRunning, error: simError, run: runSim, clear: clearSim } =
    useForecast();
  const [secsPerChallenge, setSecsPerChallenge] = useState(120);

  // A forecast is only valid for the offer it was computed from.
  useEffect(() => {
    clearSim();
  }, [offer, run.challengesCompleted, clearSim]);

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

  // Boon prompt takes precedence over a freshly-due mission so the two resolve
  // in the order they happen (pick your blue's boon, then the next mission).
  const showBoonModal = prompt?.kind === 'boon';
  const missionModalWanted = !showBoonModal && (prompt?.kind === 'mission' || missionDue);
  const showMissionModal = missionModalWanted && !missionModalClosed;

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      {showBoonModal && (
        <Modal title="Blue Beacon — choose your boon" onClose={dismissPrompt}>
          <BoonNamer onDone={dismissPrompt} />
        </Modal>
      )}
      {showMissionModal && (
        <Modal
          title={
            missionDue && prompt?.kind !== 'mission'
              ? '🎯 Forced mission choice (challenge 4)'
              : 'Grey Beacon — choose a mission'
          }
          subtitle="Enter the 3 missions you were offered; the advisor ranks them for your run."
          onClose={() => {
            dismissPrompt();
            setMissionModalClosed(true);
          }}
        >
          <MissionPicker />
        </Modal>
      )}

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
              onChange={(e) => setRunSetup({ rank: e.target.value })}
              className="rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-100"
              title="Lootrun Division rank — gates beacons, rerolls, choices and vibrancy"
            >
              {RANKS.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setShowPerks((v) => !v)}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700"
            title="what this rank grants"
          >
            perks {showPerks ? '▲' : '▼'}
          </button>
          <button onClick={undo} className="rounded bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700">
            Undo
          </button>
          <button onClick={reset} className="rounded bg-red-900 px-3 py-1 text-sm hover:bg-red-800">
            New run
          </button>
        </div>
      </header>

      {/* Rank perks + run setup */}
      {showPerks && (() => {
        const { unlocked, locked, perks } = rankPerks(run.rank);
        return (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <h3 className="mb-1 font-semibold text-zinc-300">Perks at this rank</h3>
                <ul className="space-y-0.5 text-xs text-zinc-400">
                  {perks.map((p) => <li key={p}>• {p}</li>)}
                </ul>
              </div>
              <div>
                <h3 className="mb-1 font-semibold text-zinc-300">Beacons</h3>
                <p className="text-xs text-green-400">✓ {unlocked.join(', ') || 'none'}</p>
                {locked.length > 0 && (
                  <p className="mt-1 text-xs text-zinc-600">✗ locked: {locked.join(', ')}</p>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-zinc-800 pt-3">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Run setup</span>
              <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={run.dailyBonus}
                  onChange={(e) => setRunSetup({ dailyBonus: e.target.checked })}
                />
                daily bonus (first run at this camp today)
              </label>
              <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={run.silverbull}
                  onChange={(e) => setRunSetup({ silverbull: e.target.checked })}
                />
                Silverbull subscription (doubles it)
              </label>
              {run.challengesCompleted > 0 && (
                <span className="text-xs text-amber-500">
                  run in progress — changes no longer re-derive opening state
                </span>
              )}
            </div>
          </section>
        );
      })()}

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

      {/* Forced-mission reopen chip: the modal is dismissable, but a due
          mission still blocks the run, so keep a visible way back to it. */}
      {missionDue && missionModalClosed && (
        <button
          onClick={() => setMissionModalClosed(false)}
          className="w-full rounded-lg border-2 border-amber-500 bg-amber-950/60 px-4 py-2 text-left text-sm font-semibold text-amber-100 hover:bg-amber-900/60"
        >
          🎯 Forced mission choice pending — click to pick
        </button>
      )}

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
                  : c === 'grey' && pending ? 'blocked — a mission is still processing'
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
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="font-semibold">Advice</h2>
            <button
              onClick={() => runSim(run, offer, { secondsPerChallenge: secsPerChallenge })}
              disabled={simRunning}
              className="rounded bg-indigo-700 px-3 py-1 text-sm hover:bg-indigo-600 disabled:opacity-50"
              title="Play this run out hundreds of times per option"
            >
              {simRunning ? 'Simulating…' : '🎲 Simulate outcomes'}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-zinc-500">
              sec/challenge
              <input
                type="number"
                value={secsPerChallenge}
                min={10}
                max={600}
                step={10}
                onChange={(e) => setSecsPerChallenge(Number(e.target.value))}
                className="w-16 rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-100"
                title="How long a challenge takes you. Challenges grant +150s total, so under 150 nets time and over 150 drains it. Timeout odds are very sensitive to this."
              />
            </label>
            {forecast && (
              <span className="text-xs text-zinc-500">
                {forecast.actions[0]?.runs ?? 0} rollouts/option
              </span>
            )}
          </div>
          {simError && (
            <p className="mb-2 text-xs text-red-400">simulation failed: {simError}</p>
          )}
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
                  {r.suppressed ? (
                    <span className="rounded bg-red-900/60 px-2 py-0.5 text-xs font-semibold text-red-200">
                      ✕ dead pick
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-500">score {r.score}</span>
                  )}
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
                {(() => {
                  const f = forecast?.actions.find(
                    (a) => a.color === r.color && a.vibrant === r.vibrant,
                  );
                  if (!f) return null;
                  const isBest = forecast?.best?.color === f.color;
                  return (
                    <div
                      className={`mt-1.5 flex flex-wrap gap-x-4 gap-y-1 rounded border px-2 py-1 text-xs ${
                        isBest
                          ? 'border-indigo-600 bg-indigo-950/50 text-indigo-200'
                          : 'border-zinc-800 bg-zinc-950/50 text-zinc-400'
                      }`}
                    >
                      <span title="Probability the run reaches a runnable state">
                        P(runnable) <b>{Math.round(f.pRunnable * 100)}%</b>
                      </span>
                      <span title="Expected reward pulls by run end">
                        E[pulls] <b>{f.meanPulls.toFixed(1)}</b>
                      </span>
                      <span title="Expected challenges completed">
                        E[challenges] <b>{f.meanChallenges.toFixed(1)}</b>
                      </span>
                      <span
                        className={f.pTimeout > 0.3 ? 'text-red-400' : undefined}
                        title="Probability the run ends by running out of time"
                      >
                        P(timeout) <b>{Math.round(f.pTimeout * 100)}%</b>
                      </span>
                      {isBest && <span className="font-semibold">← best simulated</span>}
                    </div>
                  );
                })()}
              </li>
            ))}
          </ol>
          {forecast && (
            <p className="mt-2 text-[11px] text-zinc-600">
              Simulated by playing the rest of the run out {forecast.actions[0]?.runs} times per
              option. Compare options against each other — absolutes inherit the offer model,
              which is estimated rather than measured.{' '}
              <b className="text-amber-600">
                E[pulls] currently ignores boons and mission effects
              </b>
              , so trust P(runnable) and E[challenges] first.
            </p>
          )}
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
          <h2 className="mb-1 font-semibold">Missions ({run.missions.length}/3)</h2>
          {pending && (
            <p className="mb-2 text-xs text-amber-400">
              ⏳ {MISSIONS.find((m) => m.id === pending.id)?.name} is still processing —
              grey beacons will not reappear until it is fulfilled.
            </p>
          )}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {run.missions.map((m) => (
              <span
                key={m.id}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${
                  m.fulfilled ? 'bg-zinc-700' : 'bg-amber-900/70 ring-1 ring-amber-600'
                }`}
              >
                <label className="flex cursor-pointer items-center gap-1" title="fulfilled?">
                  <input
                    type="checkbox"
                    checked={m.fulfilled}
                    onChange={() => toggleFulfilled(m.id)}
                  />
                  {MISSIONS.find((x) => x.id === m.id)?.name ?? m.id}
                </label>
                <button onClick={() => dropMission(m.id)} className="hover:text-red-400"
                  title="remove">✕</button>
              </span>
            ))}
            {run.missions.length === 0 && (
              <span className="text-xs text-zinc-600">none yet</span>
            )}
          </div>

          {/* Grey/forced picks happen in the modal; this is a manual fallback. */}
          {pending ? (
            <p className="text-xs text-zinc-600">mission processing — no grey offers</p>
          ) : (
            <details className="mb-1" open={missionOffer.length > 0}>
              <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">
                manually enter a grey/mission offer
              </summary>
              <div className="mt-2">
                <MissionPicker />
              </div>
            </details>
          )}
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
