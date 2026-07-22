# Strategy Design — what the advisor tracks and how it decides

Data verified against **Wynncraft 2.2.1** (released 12 Jun 2026) — the current patch as of 2026-07-21.

## 1. What changed recently — essentially every written guide is stale

### 2.2.1 (12 Jun 2026) — the balance patch that breaks the old meta

| Change | Impact on the advisor |
| --- | --- |
| **Beacon boosting is now ADDITIVE, not multiplicative** | 🔴 The big one. Aqua-stacking compounded under the old model and was called *"the bread and butter of lootrunning."* Additively the payoff is ~linear in tier while the opportunity cost of spending a challenge on aqua is unchanged. |
| **Unpowered beacons buffed, powered beacons nerfed** | Compresses the boosted-vs-unboosted gap from both directions, on top of the above. Aqua-first priority must be re-derived from scratch, not inherited. |
| **Rainbow appearance is now a ramping chance after challenge 10** | It's a *pity timer*, not a flat probability. Rerolling to "force rainbow" at challenge 11 is near-worthless; patience is rewarded. Opposite of the older guidance. |
| **Equilibrium doubled** (+50%→+100%, cap +300%→+600%) | `curse_stack` is now materially stronger than any guide rates it. |
| **Hoarder buffed** (7→6 chests, boon at 200% potency) | `flying_chest` boon engine is stronger and comes online sooner. |
| **Thrill Seeker completely reworked** | Was "1 Boon per 5 Reds", now pull-based scaling per 7 challenges. |
| **6 new missions + 1 new trial added** | ⚠️ **Unnamed in the changelog, absent from the wiki.** Our pool is ~29/35 missions and 13/14 trials. |
| Chronotrigger, Adrenaline Junkie, Warmth Devourer retuned | Numeric only; captured in `trials.json`. |
| Mythic drop chances readjusted; camp reward levels re-scaled | Affects EV estimates, not decision logic. |

### 2.2.0 "Fruma" (4 Apr 2026)

| Change | Impact |
| --- | --- |
| **Pink Beacon added** (+1 Reroll) | Reroll income became a plannable resource; makes `reroll_spam` real. |
| **New curse type: Radiance** | Curses are no longer a scalar — must track **by type** (Radiant Hunter, Lights Out read Radiance specifically). |
| **Boosted Blue Beacons increase Boon strength** | Blue tier matters now; factor aqua/vibrant into blue's score. |
| **Inspect menu added** | ❓ **Unknown scope.** Changelog says only *"an inspect menu to keep track of information in Lootruns"* — no documentation of how it opens or what it shows. Potentially very significant (see §2), but currently an assumption, not a fact. |

**The headline consequence:** your doc's flagship combos — *"Vibrant Aqua + Vibrant White = 30 challenges"* and *"Aqua-stacked White for 42 challenges"* — assume multiplicative stacking. Under 2.2.1 they are almost certainly wrong. **The default strategy must not prioritise aqua until the per-tier values are re-measured in-game.**

### Data-sourcing methodology (learned the hard way)

The wiki's `Lootrunning` page is **not reliably current** — it still lists Hoarder at 8 chests and Equilibrium at +50%, both stale. The correct method, now encoded in the data files:

> Take the `Lootrunning` page as a base, then **replay every version changelog since** on top of it.

Each record carries `changedIn` so this stays auditable on the next patch.

---

## 2. Should we track boons and trials? — Yes, and the answer is derived, not chosen

Don't decide this by taste. Each mission/boon/trial declares a `reads` array of the state variables its effect depends on. **The union of all `reads` is the minimum state the tracker must maintain.** Anything narrower means the advisor gives confidently wrong advice whenever a mission reading the missing variable is held.

Computing that union over `missions.json` + `boons.json` + `trials.json`:

```
curses (by type, incl. Radiance)   boons (count, types, potency)
pulls                               challengesCompleted / challengesRemaining
timeRemaining / timeGained          flyingChestsOpened / chestsOpened
itemsOffered                        beaconOffers (by colour) / beaconUses (by colour)
rerolls / sacrifices                mobsKilled / radiantMobsKilled
```

### Boons: track, because they are not flavour

The decisive field is **`kind: dynamic | static`**:

- **Dynamic** boons accrue over the *rest* of the run → worth more **early**.
- **Static** boons snapshot your *current* state on pickup → worth more **late**.

That one bit inverts blue-beacon advice by run phase, and it explains a rule in your doc that otherwise looks arbitrary: *"keep at least 8 curses active."* **8 is exactly Madman's cap.** It isn't folk wisdom, it's a cap-fill rule — and once encoded as `cap: 8` it generalises instead of being a magic number.

Six missions and four trials read boon state (Ostinato, Opal Offering, Orphion's Grace, Equilibrium, Midas Touch, Lightbringer; Dying Light, Ultimate Sacrifice, Adrenaline Junkie, All In). Not tracking boons breaks advice for roughly a third of the mission pool.

The sharpest example: **Ostinato inverts boon selection.** Normally you avoid duplicate boon types; with Ostinato you deliberately stack them (+1 pull per duplicate, −50% potency each). And Ostinato is hard anti-synergy with Opal Offering, which wants *high* potency to consume. An advisor blind to boons cannot see either fact.

### Trials: track, and they're cheap

Two slots per run, 13 total, each a long-lived flag that **overrides normal advice**:

- `chronotrigger` → **disables the timeout guard for 12 challenges.** The most dangerous interaction in the game to get wrong.
- `ultimate_sacrifice` → boons disabled 10 challenges; downrank blue and all boon generators.
- `hubris` → `/kill` ends the run. Needs a persistent UI warning, not a scoring tweak.
- `side_hustle` → *sets* the timer to 75s (a clamp, not a decrement); invalidates normal time reasoning.
- `warmth_devourer` → burns 4 challenges per challenge completed.

These are modelled as `behaviourFlags` that short-circuit the scorer, not as score modifiers.

### Tracking fidelity — three tiers

The engine should **derive everything it can** and only ask the user for what it cannot know.

**REVISED 2026-07-21 after inspecting the in-game Inspect menu (screenshots).** The menu is a far better data source than assumed — it exposes counters I had written off as untrackable.

### What the Inspect menu actually provides

Tabbed UI. **General** tab exposes, each as a hoverable counter:

| Field | Tooltip |
| --- | --- |
| Active Boosts | Daily Bonuses — e.g. `+100 Lootrun Experience`, `+10 Reward Pulls`, `+1 Reward Reroll` |
| Reward Pulls | "You have gained N Reward Pulls" |
| Reward Sacrifices | "You have gained N Reward Sacrifices" |
| **Chests Opened** | "You have opened N chests during this run" |
| **Mobs Killed** | "You have killed N mobs during this run" |
| Deaths | "You have died N times during this run" |
| Time Elapsed | "You have spent MM:SS in this lootrun" |

Remaining tabs: **Beacons** (shows all 13 beacon types), **Curses**, **Missions**, **Trials**.

### Revised tiers

| Tier | Variables | Source |
| --- | --- | --- |
| **A — engine-derived** | challenge #, challenges remaining, curses by type, boons held, rerolls, sacs, beacon uses/offers, pulls | State machine. Zero user input. |
| **A2 — user-readable from Inspect** ✨ | `chestsOpened`, `mobsKilled`, `deaths`, `timeElapsed`, `pulls`, `sacrifices`, `dailyBonuses` | Single glance at one menu. Cheap to enter, exact — **not** an estimate. |
| **B — engine-estimated** | per-boon potency % | Computed from base × Orphion's × Equilibrium × tier. Estimate with manual override. |
| **C — derived from a tracked sibling** | `itemsOffered`, `radiantMobsKilled` | Not surfaced by Inspect and untrackable in a browser. **Do not ask the user.** Estimate from the counters we do have (below). |

**Tier C shrank from four variables to two.** Mob Slaughter and Killstreak (`mobsKilled`) and Serendipity/Chronokinesis/Side Hustle (`chestsOpened`) move from guesswork to exact. This is a material improvement to advice quality and removes most of the argument for a Wynntils dependency.

### New state fields this revealed

Two things I had not modelled at all:

- **`dailyBonuses`** — runs do **not** start at zero. A daily `+10 Reward Pulls` / `+1 Reward Reroll` is a real starting endowment, and it shifts the marginal value of pull/reroll missions (High Roller's `+1 reward reroll` is worth less when you already hold one free). Must be a run-setup input.
- **`deaths`** — tracked by the game, and load-bearing: death costs 60s, reduces challenges, voids a held aqua boost, and **ends the run entirely under Hubris**.

### Tier C policy — derive, don't max

`itemsOffered` and `radiantMobsKilled` cannot be tracked from a browser. The tempting shortcut is to **assume them maxed**. Rejected, because:

> **The caps are reached late, but the decision is made early.** Looter caps at 60 items, Parsimonious at 150 — trivially exceeded by run end, so "maxed" is roughly true *terminally*. But the advisor is asked at challenge 5 whether to take Looter. Assuming max at the moment of choice makes the boons we understand least look like guaranteed top picks, biasing advice toward exactly the wrong things.

Instead, estimate each from a counter the Inspect menu **does** expose:

```
itemsOffered      ≈ chestsOpened × avgItemsPerChest     // chestsOpened is Tier A2, exact
radiantMobsKilled ≈ mobsKilled   × radiantRate(curses)  // mobsKilled exact; rate reads curse state
```

Two calibration constants, both living in `data/` rather than code, and both refinable from run logs (Phase 6). Zero additional user input.

**What actually matters is the terminal projection, not the snapshot** — "will this max out given projected chests over the remaining run?" That is exactly what the Monte Carlo rollout computes, so this needs no separate machinery.

### Chest types — resolved

**"Chests Opened" is a single combined counter; flying chests count toward it.** (Confirmed by user, 2026-07-21.)

Consequence: the counter alone **cannot** separate the flying/non-flying split that three effects need — Hoarder (flying, 6), Cleansing Greed (flying), Chronokinesis (explicitly *non*-flying).

Mitigation, cheapest first:
1. **Check whether the Inspect Missions tab shows per-mission progress.** If the game already displays "Hoarder 4/6", we never derive it at all and the problem is moot for missions.
2. Otherwise derive the split: the engine knows how many flying chests it *caused* (Yellow Beacons taken × tier, plus Materialism's 2/challenge), so `flyingChests` is largely engine-derivable and `nonFlying = chestsOpened − flyingChests`.

---

## 3. Conditional mission priority — the archetype model

Your instinct ("if I get mission X first, mission Y gets higher priority next") is right, but encoding it as pairwise if/then rules is O(n²) over 29 missions and unmaintainable.

Model it as **archetypes** instead (`data/archetypes.json`). You only ever get ~3 grey beacons, so **your first mission largely commits the run.** An archetype declares:

```jsonc
{
  "core":       ["equilibrium", "porphyrophobia"],   // identifies the archetype
  "followups":  [["cleansing_ritual"],               // ordered tiers;
                 ["high_roller", "redemption"],      // within a tier = equal value
                 ["inner_peace", "orphions_grace"]],
  "boonPreference":  ["madman", "bad_omen"],         // ALSO steers blue beacons
  "trialPreference": ["all_in", "dying_light"],      // ALSO steers crimson
  "beaconBias":      { "purple": 40, "green": -15 }, // ALSO steers every beacon
  "sequencing":      [ /* explicit ordering rules */ ]
}
```

The key design win: **an archetype steers missions, boons, trials *and* raw beacon priority from one declaration.** Commit to `curse_stack` and purple beacons rise, green falls, Madman becomes the top boon, All In becomes the top trial — all from one place.

### Scoring a mission offer

```
score(m) = max over archetypes A of:
             fit(A | missionsHeld) × value(A) × tierRank(m in A.followups)
         + universalValue(m)          // High Roller, Redemption: never dead
         + roleGapBonus(m)            // does it satisfy an unmet `runnable` role?
         − trapPenalty(m, state)      // Knife Edge at 40 challenges remaining
```

Three things fall out of this that a flat tier list can't express:

1. **Commitment vs. flexibility.** With 3 slots left, a speculative archetype core is worth the gamble. With 1 slot left, take the stateless `universal` pick — the archetype can no longer complete.
2. **Traps are state-dependent, not intrinsic.** Knife Edge pays `7 − challengesRemaining`: literally zero above 7 remaining, excellent at 2. Same mission, opposite advice. Chronokinesis is identical — great with time surplus, run-ending without.
3. **Sequencing beats selection.** With Equilibrium held, the advice isn't *which* beacon but **"don't take blue yet — bank 6 curses first"** (6 × +100% = the +600% cap under 2.2.1). Deferral is a first-class recommendation, and a pure ranking model cannot express it. Note the figure stayed 6 across the rebalance *by coincidence* — derive it as `cap / perCurse`, never hardcode it.

### Explicit conflicts to encode

| Conflict | Rule |
| --- | --- |
| Thrill Seeker vs. Green Beacon | Green **reset is unconfirmed post-2.2.1 rework** — if it still applies, green (the timeout guard) wipes the stack. Surface the tradeoff; never silently resolve it. |
| Knife Edge vs. White / Red / Sacrificial Ritual | All add challenges; Knife Edge pays inversely. Mutually exclusive. |
| Ostinato vs. Opal Offering | One wants duplicate low-potency boons, the other high-potency ones. |
| Clockworker vs. Slowrunner | Literal opposites (time high vs. time low). Never hold both. |
| Backup Beat vs. Chronotrigger | Backup Beat needs time gain; Chronotrigger forbids it for 12 challenges. |
| Cleansing Greed vs. curse_stack | Removing curses defeats Madman / Equilibrium / Bad Omen payoffs. |

---

## 4. Data confidence — be honest in the UI

Every record carries a confidence level, and the UI shows it:

- **Verified (2.2.1):** 13 beacons, 29 missions, 17 boons, 13 trials.
- **Resolved:** ~~Cleansing Ritual~~ — **does not exist.** Confirmed by the user 2026-07-21. Community guides (wynnvets and forum guides alike) conflate it with **Sacrificial Ritual**, which is real and does something entirely unrelated (consume 1 Pull → +3 Challenges). Removed from all three archetype follow-up lists, and kept as a tombstone in `missions.json` so a stale source can't reintroduce it.
- **🔴 Blocking gap:** the **6 missions and 1 trial added in 2.2.1** are unnamed in the changelog and absent from the wiki. Pool is ~29/35 and 13/14. Any probability the simulator reports over mission/trial offers is **biased until these are collected in-game** — the UI must say so rather than imply precision.
- **Flagged for re-derivation:** all aqua priorities and every `beaconBias` value, inherited from the pre-2.2.1 multiplicative meta.
- **Low confidence:** `radiance` and `speedrun` archetypes — both post-date the written guides entirely.

That Cleansing Ritual survived in three community guides while not existing in the game is the argument for the tombstone pattern: **record what's false, not only what's true**, or it gets re-imported the next time someone reads a guide.

---

## 5. Open questions for you

0. **What does the 2.2.0 inspect menu actually show?** Undocumented anywhere I can reach. If it displays `itemsOffered` / `mobsKilled` / `chestsOpened`, it **collapses Tier C into Tier A** and four boons stop being guesswork. Cheapest question here with the largest design consequence — one screenshot answers it.
1. **The 6 new missions + 1 new trial from 2.2.1** — top blocker. Can you collect names and effects in-game?
2. **Aqua under additive boosting** — what does a vibrant-aqua'd White Beacon actually grant now? A single measured data point tells us whether aqua stays top priority or drops to mid-tier, and it gates the entire default strategy.
3. **Does Green still reset Thrill Seeker?** The 2.2.1 rework text drops the reset clause. The green-vs-Thrill-Seeker conflict rule depends on it.
4. **Curse types** — is Radiance the only *named* type, or are the older effects (Health / Damage / Radiant Power / Damage Resist) individually named too? Decides whether `curses` is a 2-field or 6-field structure.
5. **Boon potency display** — exact % shown in-game, or must we estimate? Decides whether Tier B is real tracking or a model.
6. **Your doc's expected-pull figures** (Token Assisted Speedrun 2000+, Chronotrigger 1000–2000, Ostinato 400–1500) — measured or estimated, and pre- or post-2.2.1?
