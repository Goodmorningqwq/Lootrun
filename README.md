# Lootrun Advisor

An interactive decision advisor for **Wynncraft lootrunning**. You tell it what beacons you're
offered; it ranks them for your current run state and explains why.

Data verified against **Wynncraft 2.2.1** (12 Jun 2026).

## Why it exists

A lootrun is a finite-horizon stochastic decision process: at each challenge you're shown a
random subset of beacons and must choose one, under constraints (use caps, rank unlocks,
offer exclusion) and a timer. Existing guides are static tier lists. This models the run as
actual state and gives advice conditioned on it — including advice a tier list structurally
cannot express, like *"don't take blue yet, bank 6 curses first"*.

## Architecture

The central rule: **facts and opinions are separated, and neither lives in code.**

| Layer | Contents | Changes when |
| --- | --- | --- |
| `data/*.json` | Beacon tier tables, missions, boons, trials, curses, camps, ranks | Wynncraft patches |
| `strategies/*.json` | Phase priorities, safety rules, the `runnable` goal | You change your mind |
| `engine/` | Pure state machine + strategy evaluator. No numbers, no opinions. | Bugs only |
| `app/` | Next.js tracker UI | Feature work |

If a tier list ends up hardcoded in a React component, the design has failed.

The engine models **structure** (legality, use caps, unlock windows, offer exclusion, tier
arithmetic, time, challenge accounting) and reads every **magnitude** from `data/`. That
separation has paid for itself repeatedly: when measured in-game values contradicted the
published ones, the fix was a data edit, not a rewrite.

## Notable mechanics modelled

- **Offer exclusion** — red and green cannot be offered two challenges running, keyed on being
  *offered*, not taken. A green you decline is gone next challenge.
- **Soft time cap** — the 15-minute cap limits the display, but overflow still counts toward
  Backup Beat; challenge time doesn't register at all while overcapped.
- **Orange stacking** — each orange runs an independent timer (5/10/15/25 challenges by tier)
  and grants +1 choice regardless of tier.
- **Aqua chaining** — an aqua's empowerment is its own resolved tier + 1, capped at 3.
- **Division rank** — gates which beacons exist, starting rerolls, base choices and vibrancy.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # engine + evaluator tests
npm run typecheck
```

## Status

- ✅ Engine + strategy evaluator (84 tests)
- ✅ Run tracker UI with ranked advice, undo, persistence
- ⬜ Monte Carlo simulator — P(reach runnable) and E[pulls] per option
- ⬜ Strategy editor

See [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) for unresolved data gaps, and
[STRATEGY-DESIGN.md](STRATEGY-DESIGN.md) for the reasoning behind the model.

## Data provenance

Sources disagree, so precedence is explicit: **in-game confirmation → version changelogs →
wiki → community guide**. Every record carries `changedIn` / `resolvedBy` / `conflict` fields
so any number can be traced. Both the wiki and the community guide have been wrong where the
other was right — neither is trusted wholesale.
