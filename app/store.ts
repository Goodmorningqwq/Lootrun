/**
 * Run-tracker store. A thin history wrapper around the pure engine:
 * every action derives the next RunState via engine transitions and pushes
 * it, so undo is just popping the stack. No game logic lives here.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  beaconChoices,
  completeChallenge,
  createRun,
  die,
  failChallenge,
  gainBoon,
  recordOffer,
  relabelBoon,
  removeBoon,
  resolveTier,
  startChallenge,
  takeBeacon,
  useReroll,
} from '../engine/engine';
import { BEACONS } from '../engine/data';
import type { BeaconColor, OfferedBeacon, RunState } from '../engine/types';

/** Trials whose penalty maps onto an engine behaviour flag. */
const TRIAL_FLAGS: Partial<Record<string, keyof RunState['flags']>> = {
  chronotrigger: 'cannotGainTime',
  hubris: 'hubris',
  ultimate_sacrifice: 'boonsDisabled',
};

interface TrackerStore {
  history: RunState[];
  offer: OfferedBeacon[];
  lastError: string | null;

  reset: () => void;
  undo: () => void;
  setRank: (rank: string) => void;
  /** Rank/daily-bonus changes re-derive the opening state, so they only make
   *  sense before the run starts — the UI hides them after challenge 0. */
  setRunSetup: (patch: { rank?: string; dailyBonus?: boolean; silverbull?: boolean }) => void;

  toggleOffer: (color: BeaconColor) => void;
  toggleVibrant: (index: number) => void;
  clearOffer: () => void;

  /** Take the offered beacon at `index`, run and complete its challenge. */
  take: (index: number) => void;
  reroll: () => void;
  markDeath: (duringChallenge: boolean) => void;
  markFailedChallenge: () => void;

  addBoon: (id: string, potency?: number) => void;
  removeBoonAt: (index: number) => void;
  labelBoon: (index: number, id: string) => void;

  addMission: (id: string) => void;
  removeMission: (id: string) => void;
  addTrial: (id: string) => void;
  removeTrial: (id: string) => void;
  setFlag: (flag: keyof RunState['flags'], value: boolean) => void;
  adjustTime: (seconds: number) => void;
}

const current = (h: RunState[]): RunState => h[h.length - 1] as RunState;

export const useTracker = create<TrackerStore>()(
  persist(
    (set, get) => {
  /** Push a new state derived from the current one; clears any stale error. */
  const push = (next: RunState, alsoSet: Partial<TrackerStore> = {}) =>
    set((s) => ({ history: [...s.history, next], lastError: null, ...alsoSet }));

  /** Run an engine transition, surfacing IllegalMoveError instead of throwing. */
  const tryPush = (fn: (s: RunState) => RunState, alsoSet: Partial<TrackerStore> = {}) => {
    try {
      push(fn(current(get().history)), alsoSet);
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    }
  };

  return {
    history: [createRun()],
    offer: [],
    lastError: null,

    // New run keeps the player's rank — it's a property of the player, not the run.
    reset: () =>
      set((s) => ({
        history: [createRun({ rank: current(s.history).rank })],
        offer: [],
        lastError: null,
      })),

    setRank: (rank) => tryPush((s) => ({ ...s, rank })),

    setRunSetup: (patch) =>
      tryPush((s) =>
        // Before the run starts, rebuild from scratch so rank/daily-bonus
        // effects on opening pulls, rerolls and choices are recomputed.
        s.challengesCompleted === 0
          ? createRun({
              rank: patch.rank ?? s.rank,
              dailyBonus: patch.dailyBonus ?? s.dailyBonus,
              silverbull: patch.silverbull ?? s.silverbull,
            })
          : { ...s, ...patch },
      ),

    undo: () =>
      set((s) => ({
        history: s.history.length > 1 ? s.history.slice(0, -1) : s.history,
        lastError: null,
      })),

    toggleOffer: (color) =>
      set((s) => {
        const idx = s.offer.findIndex((o) => o.color === color);
        if (idx >= 0) return { offer: s.offer.filter((_, i) => i !== idx) };
        if (s.offer.length >= beaconChoices(current(s.history))) return s;
        return { offer: [...s.offer, { color, vibrant: false }] };
      }),

    toggleVibrant: (index) =>
      set((s) => ({
        offer: s.offer.map((o, i) => (i === index ? { ...o, vibrant: !o.vibrant } : o)),
      })),

    clearOffer: () => set({ offer: [] }),

    take: (index) => {
      const { offer } = get();
      const chosen = offer[index];
      if (!chosen) return;
      tryPush(
        (s) => {
          let next = completeChallenge(
            startChallenge(takeBeacon(recordOffer(s, offer), chosen)),
          );
          // Blue always grants a boon — count it automatically at the
          // tier-derived potency (100/200/300/400%). Naming it is optional.
          if (chosen.color === 'blue') {
            const tier = resolveTier(s, chosen);
            const pct = (BEACONS.blue.tiers as { potencyPct?: number[] }).potencyPct?.[tier] ?? 100;
            next = gainBoon(next, { potency: pct / 100 });
          }
          return next;
        },
        { offer: [] },
      );
    },

    reroll: () => {
      const hasGourmand = current(get().history).missions.includes('gourmand');
      tryPush((s) => useReroll(s, hasGourmand));
    },

    markDeath: (duringChallenge) =>
      tryPush((s) => (duringChallenge ? failChallenge(die(s)) : die(s))),

    markFailedChallenge: () => tryPush((s) => failChallenge(s)),

    addBoon: (id, potency) => tryPush((s) => gainBoon(s, { id, potency })),

    removeBoonAt: (index) => tryPush((s) => removeBoon(s, index)),

    labelBoon: (index, id) => tryPush((s) => relabelBoon(s, index, id)),

    addMission: (id) =>
      tryPush((s) =>
        s.missions.includes(id) ? s : { ...s, missions: [...s.missions, id] },
      ),

    removeMission: (id) =>
      tryPush((s) => ({ ...s, missions: s.missions.filter((m) => m !== id) })),

    addTrial: (id) =>
      tryPush((s) => {
        if (s.trials.includes(id)) return s;
        const flag = TRIAL_FLAGS[id];
        return {
          ...s,
          trials: [...s.trials, id],
          flags: flag ? { ...s.flags, [flag]: true } : s.flags,
        };
      }),

    removeTrial: (id) =>
      tryPush((s) => {
        const flag = TRIAL_FLAGS[id];
        return {
          ...s,
          trials: s.trials.filter((t) => t !== id),
          flags: flag ? { ...s.flags, [flag]: false } : s.flags,
        };
      }),

    setFlag: (flag, value) =>
      tryPush((s) => ({ ...s, flags: { ...s.flags, [flag]: value } })),

    adjustTime: (seconds) =>
      tryPush((s) => ({
        ...s,
        timeRemaining: Math.max(0, Math.min(900, s.timeRemaining + seconds)),
      })),
  };
    },
    {
      // Survives refresh/navigation — losing a run mid-game to an accidental
      // reload is the worst failure mode this tool can have.
      name: 'lootrun-advisor-run-v1',
      // v2: RunState gained `rank`. Old persisted runs must be migrated, not
      // discarded — losing the run is exactly what persistence exists to stop.
      // v2: added `rank`. v3: added `dailyBonus` / `silverbull`.
      version: 3,
      migrate: (persisted, version) => {
        const p = persisted as { history?: RunState[]; offer?: OfferedBeacon[] };
        if (Array.isArray(p?.history)) {
          p.history = p.history.map((s) => ({
            ...s,
            rank: s.rank ?? 'grandmaster',
            // Existing runs predate the daily bonus, so their pull counts
            // already reflect whatever the player had — don't retro-add it.
            dailyBonus: s.dailyBonus ?? (version >= 3),
            silverbull: s.silverbull ?? false,
          }));
        }
        return p;
      },
      partialize: (s) => ({ history: s.history, offer: s.offer }),
    },
  ),
);

export const useCurrentRun = (): RunState =>
  useTracker((s) => s.history[s.history.length - 1] as RunState);
