# Plan — Playbook, tree view, community editor

Rewritten 2026-07-25 after expert review. Supersedes the first-mission-tree plan,
which Mujtaba invalidated: *"theres like no such thing as popular first mission…
combo matters most."*

---

## 0. Settled — do not relitigate

| Question | Answer | Status |
| --- | --- | --- |
| Tree rooted at first mission? | **No.** Combo matters, not order | model reshaped |
| Combo shape | 4–5 mission **pool**, hold best 3 | ✅ |
| Mission slots | **3** = 1 forced (ch 4) + 2 grey | ✅ shipped |
| Combos | 4 + side combo + salvage, with explicit **cores** | ✅ shipped |
| All 28 missions | verdicted core/pool/enabler/side/salvage/bloat/avoid/deleted | ✅ shipped |
| Multi-combo bias | strongest advocate + objector × completeness | ✅ shipped |
| Beleza Pura | offered aqua boosts the whole offer | ✅ shipped |
| "Safe" | avoid conditional payoffs ("gambling aspects") | ✅ defined |
| Long vs short run | user toggle — no derivable threshold | ✅ decided |
| Advice quality | 80% win rate vs own bottom pick (`npm run validate`) | ✅ measured |

**Known ceiling:** the simulator's `E[pulls]` ignores boons and mission effects,
so it is blind to most of what the advisor optimises for. The 80% win rate is
signal; the +3.4% pull delta is **not** a usable effect size. Weight tuning is
blocked on Step 5.

---

## 1. The model

```
        ┌─ combos (cores + pool) ──────────────┐
offer → │  which combos does this keep alive?  │ → ranked picks + reasons
        └─ verdicts · roles · tactics ─────────┘
```

Four operations, taken from how Mujtaba actually plays:

1. **Keep alive** — take the piece that preserves the most valuable reachable combos
2. **Prune** — drop combos an offer has made unreachable (*"I remove jesters trick from the equation"*)
3. **Enable** — when no combo piece is offered, buy flexibility (*"I take beleza pura… more boosted yellows in the future"*)
4. **Re-plan** — when a combo dies, pivot to one reachable from what you already hold (*"now I cant go the yellow ostinato route"*)

Only #1 is fully implemented. #2–#4 are Steps 2–3.

---

## 2. The remaining modelling gap — and it is not "least-bad"

35 of 3276 first-mission offers (1.1%) still produce **zero signal**. Measured
which missions cause it:

```
Materialism · Orphion's Grace · Equilibrium · Inner Peace
Optimism · Beleza Pura · Sacrificial Ritual
```

**All seven are `pool` or `enabler`.** That is not a random catch-all hole — it
is a structural one. A `core` scores via *"Starts combo X"*; `avoid`/`bloat`
score via verdict; `salvage` scores as universal. But a **pool member offered
before you hold its core scores nothing**, because `followups` only apply once
committed.

So the fix is principled, not a fallback: score a pool/enabler mission by the
combos it *would* contribute to, discounted because the core is not yet held.
That is exactly the speculative commitment Mujtaba described — taking Ostinato
and *"praying"* for Interest Scheme and Hoarder later.

```
speculativeScore(m) = max over combos C containing m of
      value(C) × P(reach C | slots left, pieces still needed)
```

`P(reach)` need not be exact — monotonic in *pieces needed* and *slots left* is
enough, and it makes the advisor prefer combos that are closer to completable.
This closes all 35 **and** improves the many offers that currently score a pool
member only by role-gap luck.

---

## 3. Work steps

Each step lists files, change, and an acceptance gate that must pass before moving on.

### Step 1 — Playbook migration (unblocks community editing)

**Why first:** combos live in `data/archetypes.json` today. The community must
be able to add and export their own, so combos must move into the **strategy**
file, which is what import/export already round-trips.

| File | Change |
| --- | --- |
| `strategies/default.json` | add `playbook: { lines: [...] }`, absorbing `data/archetypes.json` |
| `engine/evaluator.ts` | read lines from `strategy.playbook.lines`, fall back to the bundled default when absent |
| `app/store.ts` | persist migration v6 |
| `data/archetypes.json` | keep one release as the fallback source, marked deprecated |

**Migration safety (this bit has bitten us twice):** a user's exported strategy
has no `playbook` key. Merging must be *field-wise against the default*, never
wholesale replacement, or their advice silently loses every combo. Rule:

```ts
const lines = strategy.playbook?.lines ?? DEFAULT_STRATEGY.playbook.lines;
```

plus a `schemaVersion` on the strategy so future additions are detectable.

**Gate:** 184 tests green; a strategy exported *before* this step still produces
identical advice after it. Add a test that asserts exactly that.

### Step 2 — Speculative pool/enabler scoring

| File | Change |
| --- | --- |
| `engine/evaluator.ts` | `speculativeCombos(state, missionId)` → `{line, needed, reachable}[]` |
| | apply in `evaluateMissionOffer` for `pool`/`enabler` verdicts |
| `strategies/default.json` | `speculativeWeight` knob (editable) |

**Gate:** the 3276-offer sweep reports **0** blind offers, and no offer
recommends an `avoid`/`deleted` mission over a live one. Promote that sweep from
a throwaway probe to a committed test.

### Step 3 — Prune and re-plan

| File | Change |
| --- | --- |
| `engine/evaluator.ts` | `comboStatus(state)` → `alive / dead / complete` per line |
| | dead when: needed pieces > slots left, or a required core is unreachable |
| `app/page.tsx` | show live combos with progress; strike through dead ones |

**Gate:** a scripted run reproducing Mujtaba's worked example (Ostinato → Beleza
Pura → the Orphion's/Porph fork) marks the yellow-Ostinato route **dead** at the
same point he does, and surfaces both pivots.

### Step 4 — Tree view (generated, never authored)

`buildPlaybookTree(strategy, depth)` constructs synthetic `RunState`s and calls
the **real** `evaluateOffer` / `evaluateMissionOffer` at each node.

**Why generated:** a hand-drawn tree saying "Hoarder → take yellow" becomes a
lie the moment a trial or tactic outweighs it, and nobody notices, because the
drawing and the engine are separate artifacts. Generation makes the tree
*whatever the advisor will actually say*, and the same function backs the
coverage test — picture and proof share code.

**Honest scope:** the tree shows the **named lines**; the coverage test proves
the unnamed remainder is caught. It cannot "plot all" — ~250k combinations
exist. Say so in the UI rather than implying completeness.

**Gate:** every rendered priority equals a live `evaluateOffer` call for that node.

### Step 5 — Simulator: model boons and missions

Unblocks weight tuning, which is currently guesswork.

| File | Change |
| --- | --- |
| `engine/simulator.ts` | apply mission effects during rollout (Hoarder→boons, Interest Scheme→chests, Opal→pulls) |
| | credit boons toward pulls |

**Gate:** `npm run validate` effect size becomes meaningful — top pick beats
bottom pick by a margin that moves when weights change. Then, and only then,
tune the verdict/bias magnitudes against it.

### Step 6 — Editor (see §4)

---

## 4. Editor specification

Two independent halves. **The first ships today** — it needs nothing from Steps 1–5.

### 4a. Direct manipulation of phase priorities *(no dependencies)*

`app/editor/page.tsx`, phase cards.

| Control | Behaviour |
| --- | --- |
| **Drag chip** | reorder within `beaconPriority`. HTML5 DnD (`draggable` + `onDragStart/Over/Drop`), ~40 lines, no dependency. Editor is desktop-use, so weak touch support is acceptable. |
| **Click chip** | cycle plain ↔ `buffed:` |
| **✕ on chip** | remove from the list |
| **`+` in a phase** | dropdown of the 13 beacons, appends |
| **Number inputs** | tactic weights, verdict scores, bias values |

**The `buffed:` ordering trap.** The same colour can appear twice
(`buffed:white` and `white`), and dragging raw `white` *above* `buffed:white` is
incoherent — a boosted white always outranks a raw one. The UI must prevent that
drop and explain why, rather than silently accepting a list that can never fire.

Every mutation → rewrite strategy object → `applyStrategy()` → tree, advice and
JSON all redraw. JSON textarea stays two-way synced.

### 4b. Combo editing *(needs Step 1)*

| Control | Behaviour |
| --- | --- |
| **`+ combo`** | new line: name, cores, pool, bias, trials |
| **`+ mission`** on a line | add to core or pool |
| **`+ branch`** | a route within a line (Ostinato's yellow vs blue) |
| **Verdict override** | per-mission, per-strategy |

### 4c. Safety rails for community strategies

- **Diff vs default** — "you have changed 6 things"; the whole point is tuning, so drift must be visible
- **Validation on apply** — already rejects bad colours; extend to line references
- **Named presets** — save/load several, not just one
- **Share via URL** — compressed strategy in the fragment, no backend

---

## 5. Risks

| Risk | Mitigation |
| --- | --- |
| **Weights are unvalidated guesses** — the single biggest weakness | Step 5, then tune against a real effect size |
| Playbook migration silently drops a user's combos | field-wise merge + a before/after advice-equality test |
| Tree implies completeness it cannot have | state the named-lines scope in the UI |
| Community strategies produce bad advice with no feedback | diff-vs-default; `npm run validate` runnable on any strategy |
| Expert verdicts are one person's opinion | they are per-strategy and overridable — that is the point of 4c |

---

## 6. Still unknown

- **6 missions + 1 trial from 2.2.1** — undocumented anywhere; in-game only
- **Materialism, Orphion's Grace** verdicts are my inference, flagged in data
- **Run Combos "passive combo" section** — Mujtaba referenced it; tab URL not supplied
- **Whether verdicts hold across patches** — no re-validation process yet

---

## 7. Order, and why

```
1 Playbook migration ──┬─→ 4b combo editing
2 Speculative scoring ─┘
3 Prune / re-plan ─────→ 4 Tree view
5 Simulator ───────────→ weight tuning

4a drag-to-reorder ─── independent, ship first
```

**4a ships first** because it is the longest-outstanding request and has no
dependencies. Steps 1–3 then make the tree worth drawing; Step 5 is what finally
turns the weights from guesses into something measured.
