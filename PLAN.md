# Wynncraft Lootrun Advisor — Plan

## 0. The core idea

A lootrun is a **finite-horizon stochastic decision process**:

- **State** — challenge #, time left, challenges left, beacon choices, rerolls, sacs, curses, boons, missions held, trials held, pending aqua/vibrant multiplier, per-color use counters.
- **Action** — which offered beacon to take (and, on grey/crimson, which mission/trial).
- **Environment** — the beacon offer, drawn randomly subject to hard constraints (use caps, unlock thresholds, no-consecutive rules).

That framing gives us the thing you asked for. "Runnable" is not a vibe — it's a **predicate over state**, e.g.:

```
runnable(s) := s.missions.hasRole("boon_generator")
            && s.missions.hasRole("pull_generator")
            && s.challengesRemaining >= 20
            && s.timeRemaining > safetyFloor(s)
```

So "can I still reach a runnable state?" becomes a reachability question we can answer by **simulation**, not by a static tier list. That is the feature no existing guide has.

Critically: **`runnable` is defined in the strategy file, not the engine.** Different strategies define "runnable" differently, and that's the whole point of the editor.

---

## 1. Architectural spine: facts vs. opinions

The single most important split in this project.

| Layer | Content | Changes when |
| --- | --- | --- |
| **Game data** (`data/*.json`) | Beacon effects per tier, use caps, unlock thresholds, mission/trial effects, mob scaling | Wynncraft patches |
| **Engine** (`engine/`) | Pure `applyBeacon(state, beacon) -> state`. No opinions. | Bugs only |
| **Strategy** (`strategies/*.json`) | Priorities, phase rules, `runnable` goal, thresholds | You change your mind |
| **UI** (`app/`) | Tracker, advisor panel, editor | Feature work |

If a tier list ends up hardcoded in a React component, the design has failed. Everything opinionated lives in strategy JSON.

Version the game data with a `wynncraftVersion` field so a patch doesn't silently invalidate everything.

---

## 2. Tech stack

| Concern | Pick | Why |
| --- | --- | --- |
| Framework | **Next.js 15 (App Router) + TypeScript** | Vercel-native, zero-config deploy |
| Rendering | **Almost entirely client components** | The advisor is a local state machine; SSR buys nothing |
| Styling | **Tailwind v4 + shadcn/ui** | Fast, dark theme suits the game |
| State | **Zustand** + immer | Run state is one object with undo/redo; Redux is overkill, Context re-renders too much |
| Schema | **Zod** | Validates `strategy.json` in the editor *and* at build time. Single source of truth via `z.infer` |
| Engine | **Plain TypeScript, zero deps**, own folder | Must be unit-testable and runnable in a Worker with no React |
| Simulation | **Web Worker** (`comlink`) | Monte Carlo rollouts must not jank the UI |
| Tests | **Vitest** | Engine correctness is the whole product |
| Persistence v1 | **localStorage + static JSON in repo** | See below |
| Sharing v1 | **URL fragment**, `lz-string`-compressed strategy | Shareable strategies, zero backend |
| Hosting | **Vercel** | As you wanted |

### On the database: you don't need one yet

I'd push back on adding one now. A lootrun run is a single-player, single-session, client-side state machine. There is no multi-user state, nothing to reconcile, no auth requirement. A DB in v1 buys you deploy friction and an auth flow you'd have to design around, and buys the user nothing.

**Add a DB only when you hit one of these triggers:**

1. **Community strategy sharing** with browsing/rating → `Vercel Postgres (Neon) + Drizzle`, or Supabase if you want auth bundled.
2. **Run-log telemetry** to calibrate the offer-probability model from real data → this is the genuinely compelling reason, and it's Phase 6. Even then, `Vercel Blob` + append-only JSONL is enough to start.

URL-sharing covers ~90% of "let me send you my strat" without any of that.

---

## 3. Domain model

```ts
type BeaconColor =
  | "blue" | "purple" | "yellow" | "aqua" | "orange" | "green"
  | "darkGrey" | "white" | "grey" | "red" | "pink" | "crimson" | "rainbow";

type Tier = 0 | 1 | 2 | 3;  // white / aqua / purple / rainbow text

interface OfferedBeacon {
  color: BeaconColor;
  vibrant: boolean;
}

interface RunState {
  challenge: number;
  challengesRemaining: number;
  timeRemaining: number;        // seconds
  beaconChoices: number;        // 2 base, +orange
  orangeChoicesLeft: number;    // orange lasts 6 challenges
  rerolls: number;
  sacrifices: number;
  curses: number;
  boons: BoonStack[];
  missions: MissionId[];
  trials: TrialId[];
  pendingTierBoost: number;     // from aqua, caps the stack at tier 3
  rainbowChallengesLeft: number;
  beaconUses: Record<BeaconColor, number>;
  lastOffer: BeaconColor[];     // enforces aqua/red/green no-repeat
  pulls: number;
  flags: { hubris: boolean; lightsOut: boolean; /* ... */ };
}
```

### Constraints the engine must enforce (from the wiki + your guide)

- **Use caps** — white ×1, darkGrey ×1, grey ×3, crimson ×2, blue ×30.
- **Unlocks** — rainbow from challenge 10, crimson from ~20.
- **Phase-outs** — grey stops appearing after ~30–50; crimson availability declines.
- **No-consecutive** — aqua, red, green never offered twice in a row. *This is a load-bearing rule*: it's exactly what makes "aqua offered + about to time out → take green" a safe play, since aqua will be back next challenge.
- **Tier stacking** — vibrant = +1 tier; aqua doubles next beacon; combined cap is tier 3.
- **Time** — +60s on challenge start, +90s on completion; green adds time but **is capped at 15 min**; death −60s.
- **Last-challenge dead effects** — chronokinesis, sacrificial ritual, gambling beast, new curses, yellows, grey/crimson all fail on the final challenge. The advisor must suppress recommending these there.

### Missions get **roles**, not just names

This is what makes the strategy engine general rather than a hardcoded list:

```json
{
  "id": "hoarder",
  "roles": ["boon_generator"],
  "tags": ["chest_dependent"],
  "synergies": ["materialism"]
}
```

Roles: `boon_generator`, `pull_generator`, `chest_generator`, `curse_cleanser`, `reroll_source`, `sac_source`. Your guide's rule — *"every comfy run requires at least 1 boon generator, and at least 1 pull generator"* — then expresses directly as a goal predicate over roles, and stays correct when new missions are added.

---

## 4. Strategy file format (draft)

```jsonc
{
  "$schema": "./strategy.schema.json",
  "id": "default-comfy",
  "name": "Default — Comfy Pull Run",
  "wynncraftVersion": "2.1",

  // "runnable" is strategy-defined, not engine-defined
  "goals": {
    "runnable": {
      "all": [
        { "missionsWithRole": "boon_generator", "gte": 1 },
        { "missionsWithRole": "pull_generator", "gte": 1 },
        { "path": "challengesRemaining", "gte": 20 }
      ]
    }
  },

  // hard overrides — evaluated first, short-circuit everything
  "safety": [
    {
      "id": "timeout-guard",
      "when": { "path": "timeRemaining", "lt": 150 },
      "prefer": ["green", "red"],
      "avoid": ["chronokinesis"],
      "why": "Timeout risk. Aqua/red/green can't repeat, so green now costs you nothing next challenge."
    },
    {
      "id": "hubris-no-kill",
      "when": { "flag": "hubris" },
      "note": "Never /kill — run ends immediately."
    }
  ],

  "phases": [
    {
      "id": "opening",
      "when": { "path": "challenge", "lt": 10 },
      "priority": ["orange", "aqua", "pink", "red", "blue"],
      "rules": [
        { "when": { "path": "challenge", "gte": 4 },
          "boost": { "grey": 40 },
          "why": "Mission slot — take once run extension is secure." }
      ]
    },
    {
      "id": "rainbow-window",
      "when": { "path": "challenge", "gte": 10 },
      "priority": ["rainbow", "orange", "aqua", "grey", "crimson", "pink"],
      "rules": [
        { "when": { "path": "beaconChoices", "gte": 4 },
          "action": "reroll",
          "unless": { "offerContains": ["orange", "rainbow"] },
          "why": "At 4+ choices, reroll to force orange/rainbow." }
      ]
    }
  ],

  "rerollPolicy": {
    "saveFor": ["rainbow", "orange", "grey", "crimson", "darkGrey"],
    "uselessAfterChallenge": 40
  },

  "combos": [
    { "id": "vibrant-aqua-white", "sequence": ["aqua:vibrant", "white:vibrant"],
      "payoff": "+30 challenges", "priority": 100 }
  ]
}
```

**Evaluation order per decision:** `safety overrides → active phase priority → rule boosts → goal-progress bonus → combo lookahead`. Output is a **ranked list with a `why` string for each option** — the advisor must always explain itself, or you'll never trust it enough to tune it.

---

## 5. The simulator (the differentiating feature)

Lives in a Web Worker. Given current state:

1. For each legal action, apply it.
2. From the resulting state, run **N Monte Carlo rollouts** (N ≈ 2000) to the end of the run, sampling offers from the offer model and choosing greedily per the strategy.
3. Report per action: **P(reach runnable)**, **E[pulls]**, **P(timeout)**, **P(run out of challenges)**.

The **offer model** starts as hand-tuned per-color weights subject to the legality constraints. It will be wrong at first, and that's fine — it's isolated behind one interface (`sampleOffer(state) -> OfferedBeacon[]`) so Phase 6 telemetry can replace it without touching anything else.

This turns the app from "tier list with a UI" into "given *my* state, here's what actually keeps the run alive."

---

## 6. Screens

1. **Run Tracker** (primary) — state panel; "what are you offered?" beacon picker (2–5 slots, vibrant toggle); ranked advice with reasoning; commit → timeline with **undo** (undo is mandatory, you're typing this mid-run under time pressure).
2. **Mission / Trial Picker** — appears on grey/crimson; ranks the 3 offers by role gap and synergy with held missions.
3. **Strategy Editor** — Monaco JSON editor + live Zod validation + a "test against this state" preview. Friendly form-based rule builder is a later nicety; JSON first.
4. **Run Summary** — what you took, projected vs. actual pulls. Feeds later calibration.

**UI constraint that should drive design:** this is used *in-game, mid-run, against a timer*. Every decision must be enterable in **≤3 clicks with no typing**, and readable at a glance. Keyboard shortcuts for beacon colors. That constraint should veto any prettier-but-slower design.

---

## 7. Roadmap

| Phase | Deliverable | Gate |
| --- | --- | --- |
| **0** | `data/beacons.json`, `missions.json`, `trials.json` extracted from your doc + wiki | You review for accuracy — everything downstream depends on this |
| **1** | Pure engine + Vitest suite (caps, unlocks, no-consecutive, tier stacking, time, last-challenge) | Tests green |
| **2** | Strategy schema + evaluator + `default.json` encoding your guide | Advice matches your judgment on ~20 hand-checked scenarios |
| **3** | Next.js tracker UI, deploy to Vercel | Usable in a real run |
| **4** | Monte Carlo simulator in worker | P(runnable) shown per option |
| **5** | Strategy editor + URL sharing | You can tune without a redeploy |
| **6** | *(optional)* Run-log telemetry → calibrate offer model | Only if you want the numbers to be real |

Phases 0–3 are the actual product. 4 is the interesting part. 5–6 are polish.

---

## 8. Open questions

1. **Data accuracy** — the doc's numbers (grey phase-out ~30 vs ~50, exact tier multipliers) need pinning down. Do you have raw numbers, or should we start approximate and flag uncertainty in the UI?
2. **Manual entry vs. Wynntils** — Wynntils tracks lootrun state client-side. Manual entry for v1 is correct, but is an import path worth designing toward?
3. **Solo or shared?** — determines whether Phase 5 sharing is enough or Phase 6's DB is required.
4. **Trials** — model as full first-class actions in v1, or as state flags only?
