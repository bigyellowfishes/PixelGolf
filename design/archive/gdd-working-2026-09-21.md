# Pixel Golf

*Work in progress · grown from `gdd-template.md`*
*Doc: `▓▓▓▓▓▓▓▓▓▓` · every section has content · ⚑ submission bar reached · still open: the TBDs and bookmarks below, and a sign-off pass before submitting*

| | |
|---|---|
| Public experience title | Pixel Golf — IP & Content Policy self-check: clear (original name from the studio's own Pixel Arcade ecosystem; Topgolf appears only as a comparable) |
| Deployment target | World: pixelgolf.dcl.eth |
| Studio / team name | Big Yellow Fishes |
| Date | 2026-09-21 |
| Contact (Discord + email) | Discord: mkswoodbigyellowfishes · hello@bigyellowfishes.com |

---

## 0. TL;DR

| | |
|---|---|
| **Player promise** | Ten balls, ten targets, one of them worth double. You choose where every ball goes. |
| **Primary player** | For players who already enjoy cosy, nostalgic games and being social in Decentraland, arriving alone or with friends, looking for relaxed, fun golf rather than a simulation. |
| **Current status** | sketches: a look render of the range (`design/assets/look-reference-2026-09-18.png`); no playable build yet |
| **Requested round** | v0: a playable core loop completed by week 2 of the build, then v1 at week 4 to 5 |
| **Live at end of the round** | Players play ten-ball rounds in their own bay, chase the hot target, climb daily to monthly leaderboards, and level up towards cosmetic clubs and balls. |

---

## 1. Player Promise ⛳

**One-line promise**

> Ten balls, ten targets, one of them worth double. You choose where every ball goes.

---

## 2. First Minutes & How to Play 🏌️

*166 words*

| Time | Player experience |
|---|---|
| **0–5 seconds after control** | You spawn in a free bay, ball already on the tee, ready to go. Before you is the range: ten coloured target areas, the furthest almost too far to see. |
| **5–10 seconds** | Your first swing is the tutorial. One target is highlighted, with its points and an arrow above it, so you know exactly where to hit. You aim at it and confirm. |
| **10–60 seconds** | A Power bar slides from 0 to 10 and you stop it to set distance. Then an Accuracy bar slides between −10 and +10: the closer to 0 you stop it, the straighter the ball flies. |
| **1–3 minutes** | The tutorial ends when your tenth ball lands. Your total posts to the daily board and you see exactly where you sit on it. |
| **3–10 minutes** | You can leave the bay and look around, or play another round. Every round earns XP, and you notice the far targets pay more XP than the near ones. |
| **Natural stopping point** | Your name on the daily board, with the clock on it counting down to tomorrow's reset. |

`[HYPOTHESIS H1-03]` The 5/10 rule: at least 80% of players take their first useful action within 5 seconds and can state the immediate goal by 10, without help.

**Player-facing How to Play**

- Aim at a target, complete the swing cycle.
- Ten balls a round, points build your score.
- Hot targets pay double points.

---

## 3. Core Loop 🏌️

| # | Step (verb) | What the player does (Player input → what they see or hear → what changes) | Why do it again? |
|---|---|---|---|
| 1 | **Target** | You choose one of the 10 target areas → it lights up and shows what it is worth, and an arrow appears whose length shows the distance to it → your distance is set | Every area is a different score, and what you should go for changes as your total changes. |
| 2 | **Aim** | The arrow rotates left and right, and you set it at the angle you want → a faint ghost line shows roughly where the ball will go → your line is set | Reading distance is a skill you feel improving over time. |
| 3 | **Swing** | You stop the Power bar (0 to 10) for distance, then the Accuracy bar (−10 to +10) as close to 0 as you can → the club swings, with sound → the ball launches on your line at your power | The bars never change, so getting closer to the centre is improvement you can see. `[HYPOTHESIS H1-01]` |
| 4 | **Score** | You watch the ball land → points count up, and more XP for further targets → your bay board and the leaderboards update | You get to decide your next shot, and the board tells you what it needs to be. |

| | |
|---|---|
| **One complete loop takes** | `[OPEN: waiting on the verb being proven fun]` One loop is one ball. Ten balls make one round, and the round closes when the 10th ball lands: your total posts to the range board and your personal best either moves or it doesn't. Intended at roughly 20 to 30 seconds per ball, which puts a round near 4 minutes. |
| **Decision, challenge, or expression** | Which of the 10 areas to spend each ball on. Close areas are safe and cheap, far areas pay more and are easier to miss entirely. With three balls left and a personal best in reach, the choice between banking and gambling is the game. |
| **Shortest satisfying visit / typical session** | A typical session: log in and collect the daily bonus, play one ten-ball round, then either head to the AFK practice range or log off for the day. The shortest satisfying visit is that one round, intended at about 4 minutes; exact minutes `TBD: measured once the round is playable`. |
| **Why repetition 10 differs from repetition 1** | `[HYPOTHESIS H1-02]` Two sources. The player's own target choice, which changes with their running total, so no two rounds spend their balls the same way. And a **hot target**: one of the 10 areas lights up for everyone on the range at once, is worth double, and rotates every 30 seconds or so. |

**Pillars**

1. **Easy to understand mechanics that can be picked up on the first use.**
2. **Every ball is a choice.** The range is a series of small bets, not a series of repetitions.
3. **Nobody waits.** No turns, no queue, no lobby. You walk up and swing.

---

## 4. Why Players Come Back 🔁

### 4.1 The next-day (D1) sentence

> "A player who enjoyed their first session returns the next day (D1) because **their daily XP resets** 24 hours after they last logged in, so a fresh day of XP towards their next level and unlock is waiting."

`[HYPOTHESIS H2-01]`

### 4.2 The progression chain

> **Play rounds → earn XP → level up → unlock cosmetic clubs and balls**

Unlocked clubs and balls are **cosmetic**: they change how your shot looks, never how far or how straight it flies. A new player competes on skill from their first round, so the leaderboards never become a ranking of who has played longest.

| Moment | What persists or has been built? | What becomes possible next? | How can another player tell? |
|---|---|---|---|
| **End of first session** | XP, your first level, your name on the daily board | Your first cosmetic unlock is in reach | Your name on the daily board |
| **End of first week** | Several levels and your first cosmetic clubs and balls | Chasing the weekly board | Your club and ball look different in your bay |
| **Week 3+ — what takes more than two weeks?** | Higher levels in the levelling and progression system, and a place on the monthly board | Quests (in v1 scope; `TBD: quest design not discussed yet`), and the weekly meetups `TBD: day and time to be confirmed` | Your level, your name on the monthly board, and being a regular face at the weekly meetups |

**End of the first week, as a scene**

You walk into your usual bay with a club nobody had on day one, and your ball leaves a trail when it flies. You know which targets are worth the gamble now. The weekly board has your name in the middle of it, and the player two places above you is in the next bay.

**Currency: Pixel Points.** Earned by playing: every game played earns points. Spent in the clubhouse shop on cosmetic clubs and balls. Points are held per scene for now and will later carry across the wider Pixel Arcade ecosystem. Main abuse risk: idle farming, answered by design: the AFK practice range pays XP, never Pixel Points.

### 4.3 Two return hooks

| Selected hook | Exact trigger or timing | What the player anticipates | Reminder channel + no-reminder fallback |
|---|---|---|---|
| **1. Daily leaderboard reset** | Every day at 00:00 UTC, for everyone at once | A fresh daily board they can top, even against veterans | Reminder: `TBD: not discussed yet` · Fallback: the countdown clock on the daily board, the last thing seen before leaving |
| **2. Daily XP reset** | 24 hours after the player last logged in | A fresh day of XP towards their next level and cosmetic unlock. XP comes from logging in each day, and later from quests as well. | Reminder: `TBD: not discussed yet` · Fallback: `TBD: not discussed yet` |

---

## 5. Social by Design 👥

| | |
|---|---|
| **The repeatable social loop** | A player arrives on the map, playing or AFK → the multiplier ceiling rises for everyone: each roll lands randomly between 2x and the number of players in the space (50 players, up to 50x), and never below 2x → big rolls happen in front of a crowd → players have a reason to come when others are on. Every score posts to two boards: a **True Score** board (skill only, no multiplier) and a **Multiplier** board. `[HYPOTHESIS H2-02]` |
| **The disappearance test** | The shared multiplier drops to its base. Rounds, leaderboards and progression all still work: Pixel Golf is designed to work when no one is around, and gets better with company. |
| **From strangers to a group** | You don't need to find a group: stepping into a bay makes you part of the range. Your arrival raises everyone's multiplier, and when the hot target lights up, the whole range swings for the same area at once, so within seconds you are playing alongside strangers without a word said. |
| **Recognition & continuity** | You first learn another player's name on the daily board. Weekly and monthly boards make the same names recur. |
| **Quiet hours & player counts** | Pixel Golf is designed to work with one player in the space: a solo player can play full rounds, climb both boards, level up and use the AFK practice range. Social play begins at 2 players, when the multiplier and the hot target start to be shared. Ideal group: no fixed size, since every extra player raises the multiplier ceiling and the space grows as more people engage. v1 tested maximum: 20 players, one per bay across the range's 20 bays. The multiplier never drops below 2x: a solo player always gets exactly 2x, and the random ceiling only opens up as more players arrive. What happens to a 21st player when every bay is full: `TBD: to be confirmed` |
| **Drop-in / drop-out** | Every player has their own bay and nobody takes turns, so a late arrival plays immediately and raises the multiplier. A player leaving breaks nothing for anyone else. |
| **The AFK practice range** | Where AFK players go to chat and hang out. Time there earns XP towards their level, never Pixel Points, and their presence raises the shared multiplier for everyone playing. Rate of AFK XP compared with playing: `TBD: to be confirmed`. Practice swings on a screen: `TBD: detail to be designed during the build`. |
| **Visible play (the bystander test)** | Watching a neighbour, you see which target they picked and whether it landed, and you learn the swing. |
| **Shareable play (the memorable moment)** | A huge multiplier roll landing on a busy night, with the whole range watching. |
| **Bring-a-friend** | Every friend who joins raises the multiplier for both of you. |

---

## 6. Mobile-First 📱

Pixel Golf is built on desktop first and plays exactly the same on mobile, with a focus on lightweight models and textures.

**Every core-loop verb on touch**

| Core-loop verb | How it works with touch controls |
|---|---|
| Target | Tap a target area |
| Aim | `TBD: to be confirmed (arrow sweeps and you tap to stop it, or you drag to steer it)` |
| Swing | Tap to stop the Power bar, tap again to stop the Accuracy bar |
| Score | No input: watch the ball land |

**UI plan.** `TBD: the UI layout will be tested with players over time to find the right setup`

**Performance.** Lightweight models and textures throughout. Tested on the team's iPhones and Android phones at the v1 tested maximum of 20 players. Specific models and fps results: `TBD: to be named when testing starts`. Biggest risk: asset weight across the canyon, trees and a full row of occupied bays.

**Desktop-only dependencies.** None expected, since the swing uses only tap and drag. `TBD: check against the Desktop vs Mobile Feature Gap tracker before submission`

---

## 7. World, Look & Story 🎨

**The world** *— 2 sentences*

> Pixel Golf is a driving range cut into the floor of a bright sandstone canyon, part of the Pixel Arcade ecosystem. The canyon walls close the range on both sides, so every ball has somewhere to land and nowhere to get lost, and the ten target areas are set flush into the fairway rather than standing on it.

**Visual direction and small-screen readability**

Four things carry the readability, and all four are already in the look reference:

- **Targets are flat coloured discs with concentric rings.** Colour says which target, rings say how close you were. Both read at thumbnail size, and neither needs a label.
- **The mown stripes across the fairway are a distance ruler.** A player counts bands to judge how far a target is, which is how they learn the range without a rangefinder or a number on screen.
- **The canyon walls are a fixed frame.** The player always knows which way they are facing, and the scene has a hard boundary, which keeps the draw distance and the asset budget bounded.
- **Avatars in the bays sit against bright grass**, so a neighbour mid-swing is legible from across the range. That is what makes the range teach itself.

**Visual signature**

> A low camera at ball height, looking down a striped green fairway at ten coloured rings set flush in the grass and receding into the distance, sandstone cliffs and dark pines framing both sides.

*Look reference: `design/assets/look-reference-2026-09-18.png`*

---

## 8. Audience & Comparables 🎯

**Primary player + arrival context**

> For players who already enjoy cosy, nostalgic games and being social in Decentraland, arriving alone or with friends, looking for relaxed, fun golf rather than a simulation.

**How the first group arrives**

Through the existing Pixel Arcade ecosystem, and from Decentraland players left without a golf game since Golfcraft left the platform. The game works with one player, so nobody has to wait for a crowd before it is playable; every extra arrival makes it better for everyone already there.

**Deliberately not for**

Players who want an accurate golf simulation: Pixel Golf is social and fun first.

### Comparables

| | Comparable A — outside Decentraland: **Wii Sports golf** | Comparable B — outside Decentraland: **Topgolf** (the anchor this game is based on) |
|---|---|---|
| What we observed works | Anyone can take a swing within seconds of picking it up, with no golf knowledge and no reading. It is warm and unintimidating rather than a sport, and people who would never play a golf game will play this one. | The bays-and-targets format is legible in about three seconds, including to people who have never held a club. Scoring by which area you land in, rather than by strokes, turns golf into a game anyone can read. |
| What does not fit our audience or context, and why | You pass the controller and wait your turn. Waiting to play is always the problem with golf, and in a persistent world with strangers in it, waiting is worse: a player who has to queue behind someone else simply leaves. A full round is also far too long for a Decentraland session. | A bay is booked by the hour and shared by up to six people, so most of a paid session is spent not hitting. That is tolerable when you are out with friends and there is food on the table. In Decentraland there is no table, no food and no booking, so the same idle time has nothing to fill it and the player leaves. |
| What we will do differently | Every player hits at the same time in their own bay, and a round is ten balls rather than nine holes. The warmth and the low barrier are what we are keeping. | Nobody shares a bay and nobody waits. Everyone on the range hits at the same time, in their own bay, and a round lasts about four minutes rather than an hour. |

---

## 9. 4 Week Plan (v1 scope)

| Week | What is playable / done |
|---|---|
| 1 — Prototype definition | Map built in Blender; core design concept executed |
| 2 — Core interaction + first-group test | Mechanics and the initial game concept working in Decentraland. First-group social playtest with 5 to 10 players |
| 3 — Core systems refinement | Testing, and the v1 build |
| 4 — Playable prototype, final design direction (mobile playtest) | Final testing, updates and marketing |


**What keeps the experience changing after launch**

- Without building a new level, the hot target rotates every 30 seconds and the daily, weekly and monthly boards reset on schedule.
- If an update is skipped, the hot target and the board resets still create variation.
- Progression is cosmetic only, so there is no power gap: a new player can compete for the daily board in their first round.
- One player behaviour that would change what we build next: `TBD: not discussed yet`

**Not building in v1**

1. Carrying Pixel Points across the wider Pixel Arcade ecosystem: v1 holds them per scene only.
2. Different game modes: v1 ships the ten-ball round only, and new modes follow after v1.
3. Wind and other per-shot modifiers: v1 keeps the swing clean.

If v1 hits its numbers, cross-ecosystem Pixel Points come back first.

**Top risk + fallback.** Build time running short. Fallback: cut the AFK zone from v1; the range, progression and leaderboards all work without it.
