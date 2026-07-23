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
  removeMission,
  resolveTier,
  startChallenge,
  takeBeacon,
  takeMission,
  useReroll,
} from '../engine/engine';
import { BEACONS } from '../engine/data';
import {
  DEFAULT_STRATEGY,
  setStrategy,
  validateStrategy,
  type Strategy,
} from '../engine/evaluator';
import type { BeaconColor, MissionSlot, OfferedBeacon, RunState } from '../engine/types';

/** Trials whose penalty maps onto an engine behaviour flag. */
const TRIAL_FLAGS: Partial<Record<string, keyof RunState['flags']>> = {
  chronotrigger: 'cannotGainTime',
  hubris: 'hubris',
  ultimate_sacrifice: 'boonsDisabled',
};

/**
 * A follow-up the game demands right after a beacon: a blue makes you choose a
 * boon, a grey makes you choose a mission. Drives the modal so entry happens
 * where the decision does, instead of in a panel the user forgets to fill.
 */
export type Prompt =
  | { kind: 'boon' }
  | { kind: 'mission'; source: 'grey' | 'forced' }
  | null;

interface TrackerStore {
  history: RunState[];
  offer: OfferedBeacon[];
  lastError: string | null;
  prompt: Prompt;

  reset: () => void;
  undo: () => void;
  dismissPrompt: () => void;
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

  /** Missions offered by a grey beacon, awaiting a pick. */
  missionOffer: string[];
  setMissionOffer: (ids: string[]) => void;
  toggleMissionOffer: (id: string) => void;
  takeMissionFromOffer: (id: string, objective?: string) => void;
  addMission: (id: string) => void;
  dropMission: (id: string) => void;
  toggleFulfilled: (id: string) => void;
  setMissionObjective: (id: string, objective: string) => void;
  addTrial: (id: string) => void;
  removeTrial: (id: string) => void;
  setFlag: (flag: keyof RunState['flags'], value: boolean) => void;
  adjustTime: (seconds: number) => void;

  /** The strategy the advisor scores against (editable via the editor). */
  strategy: Strategy;
  /** True once the strategy has been edited/imported away from the default. */
  strategyCustomized: boolean;
  /** Apply an imported/edited strategy. Returns an error string if invalid. */
  applyStrategy: (obj: unknown) => string | null;
  resetStrategy: () => void;
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
    prompt: null,

    // New run keeps the player's rank — it's a property of the player, not the run.
    reset: () =>
      set((s) => ({
        history: [createRun({ rank: current(s.history).rank })],
        offer: [],
        lastError: null,
        prompt: null,
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
        prompt: null,
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
      // Blue -> boon prompt; grey -> mission prompt. Both are decisions the
      // game forces immediately after the beacon, so surface them right away.
      const prompt: Prompt =
        chosen.color === 'blue'
          ? { kind: 'boon' }
          : chosen.color === 'grey'
            ? { kind: 'mission', source: 'grey' }
            : null;
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
        { offer: [], prompt },
      );
    },

    dismissPrompt: () => set({ prompt: null }),

    reroll: () => {
      const hasGourmand = current(get().history).missions.some((m) => m.id === 'gourmand');
      tryPush((s) => useReroll(s, hasGourmand));
    },

    markDeath: (duringChallenge) =>
      tryPush((s) => (duringChallenge ? failChallenge(die(s)) : die(s))),

    markFailedChallenge: () => tryPush((s) => failChallenge(s)),

    addBoon: (id, potency) => tryPush((s) => gainBoon(s, { id, potency })),

    removeBoonAt: (index) => tryPush((s) => removeBoon(s, index)),

    labelBoon: (index, id) => tryPush((s) => relabelBoon(s, index, id)),

    missionOffer: [],

    setMissionOffer: (ids) => set({ missionOffer: ids }),

    toggleMissionOffer: (id) =>
      set((s) => ({
        missionOffer: s.missionOffer.includes(id)
          ? s.missionOffer.filter((m) => m !== id)
          : [...s.missionOffer, id],
      })),

    takeMissionFromOffer: (id, objective) =>
      tryPush((s) => takeMission(s, id, objective), { missionOffer: [], prompt: null }),

    setMissionObjective: (id, objective) =>
      tryPush((s) => ({
        ...s,
        missions: s.missions.map((m) => (m.id === id ? { ...m, objective } : m)),
      })),

    addMission: (id) => tryPush((s) => takeMission(s, id)),

    dropMission: (id) => tryPush((s) => removeMission(s, id)),

    toggleFulfilled: (id) =>
      tryPush((s) => ({
        ...s,
        missions: s.missions.map((m) =>
          m.id === id ? { ...m, fulfilled: !m.fulfilled } : m,
        ),
      })),

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

    strategy: DEFAULT_STRATEGY,
    strategyCustomized: false,

    applyStrategy: (obj) => {
      const result = validateStrategy(obj);
      if (!result.ok) return result.error;
      setStrategy(result.strategy); // keep the evaluator module in sync
      set({ strategy: result.strategy, strategyCustomized: true });
      return null;
    },

    resetStrategy: () => {
      setStrategy(DEFAULT_STRATEGY);
      set({ strategy: DEFAULT_STRATEGY, strategyCustomized: false });
    },
  };
    },
    {
      // Survives refresh/navigation — losing a run mid-game to an accidental
      // reload is the worst failure mode this tool can have.
      name: 'lootrun-advisor-run-v1',
      // v2: RunState gained `rank`. Old persisted runs must be migrated, not
      // discarded — losing the run is exactly what persistence exists to stop.
      // v2: `rank`. v3: `dailyBonus`/`silverbull`. v4: missions became slots.
      // v5: drop any persisted strategy — see below.
      version: 5,
      migrate: (persisted, version) => {
        const p = persisted as {
          history?: Array<RunState & { missions: Array<string | MissionSlot> }>;
          offer?: OfferedBeacon[];
          strategy?: unknown;
          strategyCustomized?: boolean;
        };
        if (version < 5) {
          // Earlier builds persisted a full copy of the default strategy and
          // derived "customized" by comparing it to DEFAULT_STRATEGY. The
          // moment the shipped default gained a field, every stale copy
          // compared unequal and was mislabelled custom — freezing users on an
          // old strategy. Drop it once; from v5 on we only persist a strategy
          // the user actually edited.
          delete p.strategy;
          delete p.strategyCustomized;
        }
        if (Array.isArray(p?.history)) {
          p.history = p.history.map((s) => ({
            ...s,
            rank: s.rank ?? 'grandmaster',
            // Existing runs predate the daily bonus, so their pull counts
            // already reflect whatever the player had — don't retro-add it.
            dailyBonus: s.dailyBonus ?? (version >= 3),
            silverbull: s.silverbull ?? false,
            // v3 stored bare ids. Treat them as fulfilled: they were held
            // without blocking grey, which is what fulfilled means.
            missions: (s.missions ?? []).map((m) =>
              typeof m === 'string' ? { id: m, fulfilled: true } : m,
            ),
          }));
        }
        return p;
      },
      partialize: (s) => ({
        history: s.history,
        offer: s.offer,
        // Persist the strategy ONLY when the user customised it. Storing an
        // untouched copy would freeze users on whatever the default looked
        // like the day they first loaded the app, so shipped improvements to
        // the default strategy would never reach them.
        strategy: s.strategyCustomized ? s.strategy : undefined,
        strategyCustomized: s.strategyCustomized,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.strategyCustomized && state.strategy) {
          // A custom strategy must be pushed into the evaluator module on load,
          // or advice would score against the default until the next edit.
          setStrategy(state.strategy);
        } else {
          state.strategy = DEFAULT_STRATEGY;
          state.strategyCustomized = false;
          setStrategy(DEFAULT_STRATEGY);
        }
      },
    },
  ),
);

export const useCurrentRun = (): RunState =>
  useTracker((s) => s.history[s.history.length - 1] as RunState);
