# Known Pool — checklist for in-game diff

Generated from `data/` on 2026-07-21 (Wynncraft 2.2.1).

**Purpose:** 2.2.1 added 6 missions and 1 trial that are undocumented everywhere. Open in-game **Inspect → Missions / Trials** and tick off anything below. **Whatever is left over is new** — capture its exact name and effect text.

---

## Missions — 28 known, expect 34 in game

| # | Mission | Effect |
|---|---|---|
| 1 | **Backup Beat** | +1 Beacon Reroll per +300s added to your timer. |
| 2 | **Beleza Pura** | If an Aqua Beacon is offered, all other offered beacons are boosted by that Aqua. |
| 3 | **Chronokinesis** | NON-FLYING chests give +1 Pull but consume 10s (+5s per chest) from the timer. Completing a challenge reduces the penalty by 15s. |
| 4 | **Cleansing Greed** | Opening a Flying Chest removes 1 Curse. |
| 5 | **Complete Chaos** | On finishing a challenge, get an additional random Beacon reward. |
| 6 | **Equilibrium** | Gaining a Curse boosts next Boon's Potency by +100% (max +600%). |
| 7 | **Gourmand** | +2 Beacon Choices per Beacon Reroll used, capped at 6 total choices. Resets when a challenge begins. |
| 8 | **High Roller** | +1 End Reward Reroll and +10 Pulls. |
| 9 | **High Spirits** | +50% Vibrancy Chance. |
| 10 | **Hoarder** | Every 6 Flying Chests opened, choose 1 Boon of 2 (at 200% potency) after next challenge. |
| 11 | **Inner Peace** | Curses are half as effective. |
| 12 | **Interest Scheme** | Every 2 Pulls gained adds +1 Flying Chest to your next Yellow Beacon (max 12). |
| 13 | **Jester's Trick** | Every 25 items offered from Flying Chests: random +3 Pulls / +1 Boon / +1-2 Curse / +60s. |
| 14 | **King's Court** | +1 Crimson Beacon added to your pool. |
| 15 | **Knife Edge** | +7 Pulls on challenge completion, reduced by 1 per challenge remaining (min 0). |
| 16 | **Materialism** | All challenges additionally spawn 2 Flying Chests on completion. |
| 17 | **Opal Offering** | On gaining a Curse, consume 1 Boon for +1 Pull, +2 more per 50% Potency above 100% consumed. |
| 18 | **Optimism** | A rerolled beacon will not be re-offered unless options run out. |
| 19 | **Orphion's Grace** | Boons are 50% more effective. |
| 20 | **Ostinato** | Taking a Boon type you already hold grants +1 Pull per duplicate; boons lose 50% Potency per duplicate type. |
| 21 | **Porphyrophobia** | Being offered a Purple Beacon grants +1 Curse. Purple Beacons give double Pulls. |
| 22 | **Radiant Hunter** | +1 Pull per Radiant Challenge mob defeated (max 5/challenge). Cleanse 1 Radiant Curse per 15 Pulls gained this way. |
| 23 | **Redemption** | +1 End Reward Sacrifice. |
| 24 | **Requiem** | For 15 minutes, Enemy Scaling and Curses are voided. |
| 25 | **Route Indigo** | Purple and Blue Beacons are obscured but always Greatly Empowered — quantified by the user's guide as equivalent to a Vibrant Aqua boost. |
| 26 | **Sacrificial Ritual** | On finishing a challenge, consume 1 Pull to gain +3 Challenges. |
| 27 | **Stasis** | Timer does not decrease while picking a Beacon (max 5m). |
| 28 | **Thrill Seeker** | +1 Pull per Red Beacon challenge completed, increased by +1 per 7 challenges completed (max +3). RESET by taking a Green Beacon. |

---

## Trials — 13 known, expect 14 in game

| # | Trial | Requirement | Reward |
|---|---|---|---|
| 1 | **Adrenaline Junkie** | Until +30 Pulls: lose 100% Boon Potency from a random Boon every 15s during interludes. | +2 End Reward Rerolls |
| 2 | **All In** | For 12 challenges, curse effects are doubled. | At run end, convert each End Reward Sacrifice into +3 End Reward Rerolls. |
| 3 | **Chronotrigger** | For 12 challenges you cannot gain time in any way. | Green Beacons cleanse 10% of Curses and boost Pulls by 1% per curse cleansed (max 5%). |
| 4 | **Dying Light** | Until +800% total Boon Potency: boons drain -5% Potency / 5s, one by one. | Rainbow Beacons grant +1 End Reward Sacrifice. |
| 5 | **Gambling Beast** | On finishing a challenge, consume 300s (+90s per challenge) from timer. +1 End Reward Reroll per activation. | (embedded in requirement) |
| 6 | **Hubris** | For 10 challenges, dying ends your Lootrun. | +1 End Reward Reroll and +1 End Reward Sacrifice. |
| 7 | **Imperitia** | Until +30 Pulls: spell costs increase by +5 Mana per challenge completed. | +2 End Reward Sacrifices |
| 8 | **Lights Out** | Until 25 Radiant Challenge Mobs defeated: receive 2 Radiance Chance Curses after every challenge. | +4 Pulls per Radiant Power/Chance curse held, then cleanse them. |
| 9 | **Monochromokopia** | Until +30 Pulls: completed beacons become Obscured for 7 challenges. | Adds an extra White, Grey and Dark Grey Beacon to the pool. |
| 10 | **Side Hustle** | Until 30 chests opened: starting/completing/failing a challenge sets timer to 75s. | +2 End Reward Rerolls |
| 11 | **Treasury Bill** | Lose 1 Pull every 60s until you reach current Pulls +20. | Boost Current Pulls by +75%. |
| 12 | **Ultimate Sacrifice** | For 10 challenges, your boons are disabled. | +2 End Reward Sacrifices |
| 13 | **Warmth Devourer** | Until +25 Pulls: consume 3 challenges after every challenge. | +1 End Reward Reroll and +1 End Reward Sacrifice. |

---

## What to capture for anything new

- Exact **name**
- Exact **effect text** (verbatim — numbers matter)
- For trials: both the **requirement** and the **reward**

That is enough to slot it into `data/missions.json` or `data/trials.json` with roles and `reads`.
