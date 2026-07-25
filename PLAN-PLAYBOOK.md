# Plan — Playbook tree, visible mission→beacon logic, direct editing

Answering: *"either the strategy isn't well-rounded or the editor isn't displaying it"* —
**both, but mostly the editor.** Evidence below, then the plan.

---

## 0. Diagnosis

### 0.1 The mission→beacon link EXISTS. The editor shows none of it.

Mission choice already shifts beacon priority through **three** channels:

| Channel | Where it lives | Shown in editor? |
| --- | --- | --- |
| Archetype bias (`flying_chest` → yellow +30, blue −10) | `data/archetypes.json` | ❌ |
| Per-mission bias (Hoarder → yellow +25) | `data/missions.json` | ❌ |
| Per-trial bias (Ultimate Sacrifice → blue −40) | `data/trials.json` | ❌ |
| Phase priority (challenge-number based) | `strategies/default.json` | ✅ |

The editor renders `strategies/default.json` **only**. Every mission-driven rule lives in
`data/`, so the editor is showing roughly the *smaller half* of the strategy.

**Root cause:** the architecture says `data/` = facts, `strategies/` = opinions. But
archetype biases and follow-up orders are *opinions* that leaked into `data/`. The editor
faithfully edits the opinion file; the opinions just aren't all in it.

### 0.2 The mission→next-mission link exists too, and is also hidden

`archetypes.json` carries `followups` as ordered tiers — e.g. curse_stack is
`[[high_roller, redemption], [inner_peace, orphions_grace], [opal_offering]]`. The
mission-pick advisor uses it. The editor never shows it.

### 0.3 Measured gaps in the strategy itself

Not just a display problem — three real holes:

- **7 of 28 missions belong to no line at all**: Cleansing Greed, Route Indigo, High
  Spirits, Beleza Pura, Requiem, King's Court, Sacrificial Ritual. Taking one first commits
  you to nothing.
- **2 archetypes have empty `beaconBias`** (`radiance`, `sac_stack`) — they identify a
  combo but never steer a beacon.
- **84 of 3276 possible first-mission offers (2.6%) give the advisor zero signal** — every
  option scores "No archetype fit or role gap". Verified by enumerating all `28C3` offers.
  Example: `Cleansing Greed + Materialism + Orphion's Grace` — three real missions, no
  guidance. This is exactly the catch-all hole you predicted.

---

## 1. Core design decision: **generate the tree, don't author it**

The obvious move is to hand-write a tree in JSON. **Reject it.** The advisor's score is a
sum of ~8 contributions (phase, activation, archetype, per-mission, per-trial, tactics,
urgency, safety). A hand-drawn tree saying "Hoarder → take yellow" would silently become a
lie the moment a trial or tactic outweighs it — and nobody would notice, because the
drawing and the engine are separate artifacts.

**Instead:** build the tree by *running the real evaluator* on synthetic states.

```ts
buildPlaybookTree(strategy, depth) → TreeNode[]
```

Each node constructs a `RunState` (challenge N, these missions held+activated, these
trials) and calls the actual `evaluateOffer` / `evaluateMissionOffer`. The rendered
priorities are therefore **whatever the advisor will really say**, by construction.

Two payoffs beyond honesty:
- The same function powers the **coverage test** (§5) — the picture and the proof share code.
- Editing a weight and watching the tree redraw is instant feedback that a JSON diff can't give.

---

## 2. Data model — the playbook

### 2.1 Move lines into the strategy

Absorb `data/archetypes.json` into `strategies/default.json` as `playbook.lines[]`, so the
opinion layer is one editable file. Per-mission and per-trial bias **stay** in `data/`
(they're defensible from the effect text — "Hoarder needs chests" is near-factual) but the
editor displays them **read-only** so nothing is invisible.

### 2.2 Line schema

```jsonc
{
  "id": "flying_chest",
  "name": "Flying Chest Engine",
  "popularity": 1,                        // ordering in the tree; 1 = headline line
  "entry":    ["hoarder", "interest_scheme", "jesters_trick"],
  "enablers": ["materialism"],
  "followups": [["orphions_grace"], ["materialism"], ["high_roller", "redemption"]],
  "beaconBias": { "yellow": 30, "blue": -10 },
  "trialPreference": ["side_hustle", "monochromokopia"],
  "boonPreference": ["serendipity", "looter"],
  "conflicts": ["chronokinesis"],         // non-flying chests — does not feed this line
  "fallsBackTo": "universal"              // explicit, was implicit
}
```

`beaconBias` (composable nudges) is kept rather than a hard per-line `beaconPriority`,
because summing is what gives combination coverage. A line MAY set
`beaconPriorityOverride` when it genuinely needs a different order; the tree shows which
lines do.

### 2.3 Fallback chain — the catch-all

Ordered, explicit, terminating:

1. **Named line** — an entry mission was offered.
2. **Role-gap pick** — no line, but a mission fills an unmet `runnable` role (boon/pull generator).
3. **Universal** — High Roller / Redemption / Complete Chaos: stateless, never dead.
4. **Least-bad** — nothing above matched: rank by per-mission bias alignment with the
   current phase, and *say so*: "no line fits; taking the least conflicting option."

Level 4 is new and is what closes the 84 blind offers. It can never be empty because every
mission has *some* bias or role.

### 2.4 Fix the three measured gaps

- Assign the 7 orphan missions to lines or a new `support` line (Route Indigo and Beleza
  Pura are strong enough to anchor their own).
- Give `radiance` and `sac_stack` real `beaconBias`.
- Add `followups` to lines that have none.

---

## 3. Tree view

Replaces the flat phase list as the editor's primary visual. Phases move to a secondary tab.

```
Challenge 4 — forced mission choice (3 of 28 offered)
│
├── ★ Flying Chest Engine            entry: Hoarder · Interest Scheme · Jester's Trick
│   ├── beacons become    yellow 90 ▸ orange 50 ▸ aqua 40 ▸ … (blue −10)   [computed]
│   ├── next mission      Materialism ▸ Orphion's Grace ▸ High Roller
│   ├── trials            Side Hustle ▸ Monochromokopia
│   ├── ⚠ conflicts       Chronokinesis (non-flying chests only)
│   └── ↳ 2nd mission = Materialism →  beacons: yellow 100 ▸ …   [expandable]
│
├── ★ Curse Stacking                 entry: Equilibrium · Porphyrophobia
│   └── …
│
├── ☆ Radiance / Sac Stack / Speedrun / Ostinato / Reroll Spam …
│
└── ⓘ FALLBACK — nothing above offered            covers 84 offers (2.6%)
    ├── role gap?  → take the boon/pull generator
    ├── universal? → High Roller ▸ Redemption ▸ Complete Chaos
    └── least-bad  → best per-mission bias for the current phase
```

Interactions: expand a line to depth 2–3; hover a beacon score to see its contribution
breakdown (the reason lines already exist); toggle "assume trial X" to watch the tree
re-compute.

---

## 4. Direct manipulation (the drag-and-drop ask)

Applies to phase priorities **and** line biases.

- **Drag to reorder** chips within a priority list. Hand-rolled HTML5 DnD
  (`draggable` + `onDragStart/onDragOver/onDrop`) — ~40 lines, no new dependency. The
  editor is desktop-use, so HTML5 DnD's weak touch support is acceptable.
- **Click a chip** → cycle plain ↔ `buffed:` (the boost token from the last commit).
- **× on a chip** → remove. **`+`** → add from a beacon dropdown.
- **Number inputs** for tactic weights and line biases (slider + numeric).
- Every mutation rewrites the strategy object → `applyStrategy` → tree and JSON both
  redraw. JSON textarea stays two-way synced.

---

## 5. Coverage guarantee — make "catch-all" provable

A test, not a hope:

```
for every 3-subset of the 28 missions (3276):
    advice = evaluateMissionOffer(state, offer)
    assert advice.ranked[0] has a concrete reason (line / role-gap / universal / least-bad)
    assert no offer falls through with zero signal
```

Currently **84 fail**. Target: **0**. The same enumeration runs at depth 2 (given each
first pick, all second offers) sampled rather than exhaustive.

Second test: **no line is unreachable** — every line's `entry` must be satisfiable, and
every mission must appear in at least one line or be explicitly marked `support`.

---

## 6. Sequencing

| Step | Work | Gate |
| --- | --- | --- |
| **1** | Coverage test (§5) as a failing test — locks in the 84 | test red, count visible |
| **2** | Playbook schema + absorb archetypes.json; add fallback level 4 | coverage → 0 |
| **3** | Fill the 3 gaps: 7 orphans, 2 empty biases, missing followups | every mission in a line |
| **4** | `buildPlaybookTree()` in `engine/` | unit-tested, no UI yet |
| **5** | Tree view in the editor | mission→beacon finally visible |
| **6** | Drag-to-reorder + chip toggles + weight inputs | the editing ask |
| **7** | Read-only panels for `data/` mission & trial biases | nothing invisible |

Steps 1–3 are pure engine/data and independently valuable — they fix real advice, not just
the picture. 4–5 deliver the tree. 6 is the drag-and-drop.

---

## 7. Decisions I'd want your call on

1. **Which lines are "popular"?** I'd headline Flying Chest, Curse Stack, Ostinato,
   Reroll Spam, Speedrun — but you and Mujtaba play these; my ranking is inferred from the
   guide, not from play.
2. **Route Indigo and Beleza Pura** are currently orphans with strong biases (+25/+25 and
   aqua +30). Own line each, or support picks?
3. **Tree depth** — 2 (first + second mission) is readable; 3 covers a full run but is wide.
   Default 2, expandable to 3?
