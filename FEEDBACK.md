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

## Order of work

1. **A1–A4** (engine/data, testable, no UI churn) ← doing first
2. **C** modal UX (page.tsx restructure)
3. **B** mission objectives (needs completion-requirement data per mission)
4. **E** mod — future
