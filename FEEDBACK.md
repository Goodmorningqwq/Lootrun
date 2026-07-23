# User feedback → fix plan

Source: Mujtaba (playtester) + owner, 2026-07-23.

## A. Advice quality — the "AI is wrong" complaints

| # | Report | Root cause | Fix |
| --- | --- | --- | --- |
| A1 | "prioritises purple beacons no matter the run combo" | `evaluateOffer` reads only phase `beaconPriority`; the archetype's `beaconBias` is dead data | Wire `beaconBias` into beacon scoring |
| A2 | "Ostinato run → blues were better" | No `ostinato` archetype exists, and blue is never biased up | Add `ostinato` archetype with blue bias |
| A3 | "Interest Scheme + Hoarder → yellows better" | `flying_chest` already has `yellow:+30` but it's never applied (same as A1) | Falls out of A1 |
| A4 | "prioritise getting all missions done and rainbow as early as possible" | Grey/rainbow priority is phase-shaped, not urgency-shaped | Global bump: unacquired mission slots + rainbow-in-window |

## B. Mission objectives (Mujtaba #1)

"add what objectives you have for a mission and make the AI prioritise that."

Each mission has a completion requirement (Hoarder: 6 flying chests; High Roller: instant; etc.).
Let the user record progress toward the *held, unfulfilled* mission, and have the advisor bias
toward beacons that advance it (e.g. Hoarder held → yellow up; Interest Scheme → yellow up).

## C. UX — modal-first entry (owner)

"want mission selection and boons to be like a pop-up after selecting blue/grey or when
triggering forced mission. the tabs below are mainly for edits or display."

- Taking **blue** → boon popup (which boon did you pick / auto-count).
- Taking **grey** or the **forced challenge-4 mission** → mission-pick popup.
- The always-on Missions/Boons panels become edit/display surfaces, not the primary entry.
- Rationale: "my lazy ass keeps forgetting to input the beacons" — reduce friction to near-zero.

## D. Last-challenge suppression clarity (owner screenshot)

Grey scored −100 with the reason buried. Show a clear "✕ dead pick" badge. *(done)*

## E. Future

- Wynntils **mod** instead of a website, so beacon state is read automatically rather than
  typed. Biggest friction win; large, separate effort. Not now.

---

## Status

| Item | State |
| --- | --- |
| **A1–A4** archetype-aware beacon advice | ✅ `afd6428` |
| **C** modal-first entry | ✅ `8a8645c` |
| **B** mission objectives + activation | ✅ `c96641f` (research) + `2a76494` (model) |
| **D** last-challenge clarity | ✅ |
| **6** strategy editor + import/export | ✅ `953ff1d` |
| **E** Wynntils mod | ⬜ deferred by owner |

### B — how it landed

Research showed the activation objective is **randomized per pickup**, not a
fixed per-mission property, so it could not be pre-listed. The model is
two-phase instead:

- **Before activation** the mission has no effect, so its archetype must not
  steer beacons; the advisor pushes the beacon that *completes the objective*.
- **After activation** (user ticks the box, which also unblocks grey) the
  archetype bias applies.

Objective pool: gain_time*, earn_pulls, open_chests, get_boons, get_curses,
offered_beacons, complete_challenges*. (*passive — completes through normal
play, pushes no beacon.) darkGrey is never recommended for an objective since
it is once-per-run and saved for a max-power play.

## Remaining

- **E** — Wynntils mod so beacon state is read rather than typed. Deferred.
- Deploy to Vercel (owner's account needed).
- Simulator limitations still open: E[pulls] ignores boons and mission effects.
