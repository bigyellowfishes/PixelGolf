# Hypothesis Log

*Generated index. Never hand-edited. Not part of the GDD and not submitted.*
*Regenerated 2026-09-21 · sorted by cheapest killing test*

| ID | IF/THEN | Source section | Cheapest killing test | Status | Verdict / date | Tested on |
|---|---|---|---|---|---|---|
| H1-01 | IF a player is given the aim-then-two-tap swing with no score, no targets and no reward attached, THEN they keep hitting balls for at least 2 minutes without being asked to. | §3 Core Loop — the swing | greybox in desktop Explorer, owner self-test, ~30 min to build | `parked` | — | — — mobile pending |
| H1-02 | IF the player chooses their own target from 10 areas of differing value, and a shared hot target rotates every 30 seconds, THEN a player's 10th ball of a round is spent on a different area than a same-skill player's 10th ball more often than not. | §3 Core Loop — "why repetition 10 differs from repetition 1" | greybox in desktop Explorer, 2 players side by side, ~30 min to build | `parked` | — | — |
| H1-03 | IF a new player spawns in a free bay with their ball already on the tee and one target highlighted with its points and an arrow above it, THEN at least 4 of 5 first-time players take their first useful action within 5 seconds and can state what they are trying to do by 10 seconds, without help. | §2 First Minutes — the 0–5 and 5–10 second rows | greybox in desktop Explorer, 3 to 5 people who have not seen it, ~30 min to build | `parked` | — | — — mobile pending |
| H2-02 | IF the score multiplier rises with the number of players on the map, THEN players' sessions are longer when others are present than when they play alone. | §5 Social by Design — the repeatable social loop | desktop greybox, 2 to 4 players versus solo, ~1 hour to build | `parked` | — | — |
| H2-01 | IF each player's daily XP resets 24 hours after they last logged in, THEN more than 10% of new players return at least once within their first week. | §4 Why Players Come Back — 4.1 D1 sentence and hook 2 | live World, programme dashboard first-week return, after launch | `parked` | — | — |

**Submission clean-up 2026-09-21:** the `[HYPOTHESIS]` markers were removed from `gdd.md` and their claims left in design-intent voice; the predictions live on here. Working copy with markers: `archive/gdd-working-2026-09-21.md`.

**Invariants checked 2026-09-21 (against the working copy):** every `[HYPOTHESIS]` marker resolves to a row ✓ · parked without a marker in the document: none
