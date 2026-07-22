# Open Questions

Everything here lives in `data/` or `strategies/`, so answers are edits, not rewrites.

## Still open

### 1. The 6 new missions + 1 new trial from 2.2.1 🔴
Absent from the changelog, the wiki, and the guide. Pool is 28/34 missions and 13/14 trials. Only source is in-game **Inspect → Missions / Trials**.

**Re-checked 2026-07-21:** the guide's Missions tab was not updated — still lists the same 28 with pre-2.2.1 numbers. Worth noting the extractor reported *"Total Missions: 30"* while enumerating only 28, twice. Either it miscounted, or two entries are consistently being dropped. If the doc's list visibly runs past Complete Chaos, those two entries are worth capturing.

### 2. ~~Does Inspect → Missions show per-mission progress?~~ ✅ **NO** (user, 2026-07-21)

It does not display progress. **Consequence:** the flying/non-flying chest split must be derived after all, since Inspect only exposes one combined `Chests Opened` counter:

```
flyingChests = (Yellow Beacons taken x chests-per-tier) + (2 x challenges completed, if Materialism held)
nonFlying    = chestsOpened - flyingChests
```

This matters for Hoarder (6 flying), Cleansing Greed (flying) and Chronokinesis (non-flying only — confirmed). The engine can compute `flyingChests` from its own action history, so no extra user input is needed, but it is now a **modelled estimate rather than a read value** and should be surfaced as such.

### 3. Curse type breakdown
*(partially answered)* Curses are shown exactly per challenge, so they ARE readable. Still unknown whether the non-Radiance types are individually named. Engine models `generic` + `radiance`; expand if needed.

### 4. How many mission slots does a run actually have? 🆕

The challenge-4 mission is **forced** — offered automatically, not from a grey beacon (user, 2026-07-22). Grey separately has `maxUses: 3`. So the total is either:

- **3** — the forced pick consumes one of grey's three uses, or
- **4** — the forced pick is free and three greys follow

Engine assumes **3** (`RUN_CONSTANTS.maxMissions`), which drives `slotsLeft` and therefore the "take the stateless pick on the last slot" advice. If it is really 4, the advisor turns conservative one pick too early.

**Test:** take the forced mission at challenge 4, then count how many grey beacons still appear before challenge 30.

### 5. Camp selection is now a required run-setup input 🆕

Guide footnote (2.) makes Chronokinesis **camp-dependent**: only environmental chests and Spelunk-challenge chests count, so its value scales with a camp's chest density and challenge-type mix. Corkus is best (many multi-chest spelunks + dense environmental chests), Molten Heights second.

**Needed:** per-camp challenge-type mix and rough environmental-chest density. Without it Chronokinesis cannot be scored, and the `speedrun`/`chronotrigger` archetypes inherit the uncertainty. The guide has a **Lootrun Camps** tab that may cover this.

### 6. Lower White tiers
Tier 3 = +30 challenges confirmed. Tiers 0–2 unmeasured. Minor — the strategy targets max-power White anyway.

---

## Resolved 2026-07-21

| # | Question | Answer |
| --- | --- | --- |
| **Self-exclusion set** | Which beacons can't repeat after being offered? | **Red and green only.** Aqua and orange used to and no longer do (recent patch). darkGrey/white/grey vanish via **use caps**, a different mechanic. |
| **Aqua under additive** | Did 2.2.1 kill aqua-stacking? | **No.** Vibrant-aqua'd White still grants +30 = White's max. The narrow reading was right; my "flagship combos are dead" alarm was overstated. The separate "42 challenges" claim is wrong — 30 is the ceiling. |
| **Gourmand rate** | +1 or +2 choices per reroll? | **+2** (guide right, wiki wrong). Cap of 6 reached in two rerolls, so `reroll_spam` is genuinely viable. |
| **Orange stacking** | Shared timer or per-orange? | **Per-orange, independent.** Each carries its own bonus and expiry; they stack additively and expire one at a time. |
| **Refresh tokens** | How obtained? | 6 tokens for 4 Shares. **Out of scope** — a run-setup input, not something the advisor plans toward. |
| **Thrill Seeker** | Does green still reset it? | **Yes**, the reset survived the 2.2.1 rework. Green-vs-Thrill-Seeker conflict rule stands. |
| **Chronokinesis scope** | All chests or non-flying? | **Non-flying only** (wiki right, guide wrong). So it does *not* combo with `flying_chest` — Materialism won't feed it. |
| **Cleansing Ritual** | Does it exist? | **No** — renamed to Sacrificial Ritual *and* reworked. Old cleanser effect is gone entirely. |

## Resolved 2026-07-22

| # | Question | Answer |
| --- | --- | --- |
| **Orange durations** | How long does each tier last? | **5 / 10 / 15 / 25** challenges. Bonus is always +1; tier scales duration only. Note the +10 jump at tier 3 — not a linear ladder. |
| **Base beacon choices** | 2 or 3 at Grandmaster? | **3.** Sentinel II's "+1 default" runs 2 → 3. This resolved the orange worked example, which only computes to 5 offered beacons with a base of 3. |
| **Rank perks** | Anything beyond beacon unlocks? | Yes — starting rerolls, base beacon *and* boon choices, vibrancy %, interlude walk speed, and the daily bonus's reward reroll (gated at Elite II, doubled by Silverbull). Grandmaster itself grants nothing. |
| **Chronotrigger cleanse** | 7.5% or 10%? | **7.5% cleanse, 5% max pull boost** — guide right on the first, changelog right on the second. |
| **Mission activation** | Can you hold two at once? | **No.** One mission processes at a time; grey will not reappear until the current one is fulfilled. |
| **First mission** | Grey beacon or automatic? | **Forced** on completing challenge 4, with no grey involved. |

### Curses are not a player cost

Curses **never** penalise the player — they only buff mobs. A curse is difficulty scaling, not a resource cost. The only real risk is mobs outscaling your build, which is outside the state machine.

**Consequence:** curse "danger" is a **user preference**, not an engine computation — same category as Imperitia's mana costs. Curse-stacking archetypes are therefore safer than a naive model would score them, and the advisor should never treat accumulating curses as an inherent cost.

### Correction history worth keeping

The self-exclusion rule was modelled wrongly **twice** — first as a per-colour quirk of aqua/red/green keyed on *taking*, then as a broad set including orange keyed on *offering*. Correct: keyed on **offering**, set = **{red, green}**.

This inverted a live strategy rule. The timeout guard originally read *"take green, it costs nothing since it returns next challenge"* — exactly backwards. Green is one of the two beacons that **doesn't** return, making a declined green forfeited. Recorded in `strategies/default.json` under `correctedFrom`.
