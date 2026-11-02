import { engine } from '@dcl/sdk/ecs'
import {
  achievements,
  boards,
  myBay,
  onRoundResult,
  profile,
  sendAchieve,
  solo,
  stats,
  SOLO_BAY
} from './ledger/client'
import { ACHIEVEMENTS, CATALOGUE, NO_HAT, ZONE_SCORES } from './ledger/rules'
import { onMyShot, onRoundFinished } from './game'
import { afk } from './afk'

// The achievements (ACHIEVEMENTS in ledger/rules.ts): badges only, nothing is paid for them.
//
// This spots them on the player's own screen, from three places:
//   - each of their own shots as it lands (game.ts onMyShot), with what happened in this round
//     so far: targets, bunkers, misses in a row, the hot target, the club, the wind, the ball effect
//   - the end of a round (the score) and the ledger's answer to it (the multiplier, the crowd,
//     a personal best)
//   - every couple of seconds, what the server keeps for them: their stats, level, Pixel Points,
//     what they own and wear, the leaderboards, AFK time, days visited
// and asks the server to note each new one down (sendAchieve). The server keeps the list, sends it
// back ('myAchievements') and tells everyone, so Cooer posts it (shotFeed.ts). A few are earned
// elsewhere and passed in here with earn(): the pigeons' round (pigeonScreen.ts) and Donate
// (donate.ts).
//
// Nothing is sent until the server's list has arrived, so nothing already earned is sent again,
// and each is only sent once a visit.

/** Blue, White and Black: "Blue or better" */
const TOP_TARGETS = ['Blue', 'White', 'Black']
const COLOURS = ['Red', 'Yellow', 'Green', 'Orange', 'Blue', 'White', 'Black']
/** A strong wind along the shot (m/s): about 9 mph */
const STRONG_WIND = 4
/** How near the pigeons counts as watching them (m) */
export const PIGEON_WATCH_RADIUS = 10

const asked = new Set<string>()

/** Earn an achievement (once): asks the server to note it down */
export function earn(id: string): void {
  if (!achievements.ready || achievements.got[id] || asked.has(id)) return
  asked.add(id)
  sendAchieve(id)
}

export function hasAchievement(id: string): boolean {
  return !!achievements.got[id]
}

/** How many of them I have */
export function achievementCount(): { got: number; of: number } {
  return { got: ACHIEVEMENTS.filter((a) => achievements.got[a.id]).length, of: ACHIEVEMENTS.length }
}

// ---- This round, from my own shots ----
type Round = { balls: number; hot: number; misses: number; bunkers: number; top: number }
let round: Round = { balls: 0, hot: 0, misses: 0, bunkers: 0, top: 0 }
let missesInARow = 0
/** Clubs I've scored with this visit (stats.clubs counts the shared bays' shots across visits too) */
const scoredWith = new Set<string>()

function colourOf(zone: string): string {
  return zone.replace(/\d+$/, '')
}

export function setupAchievements(): void {
  onMyShot((s) => {
    if (s.ballInRound === 1) round = { balls: 0, hot: 0, misses: 0, bunkers: 0, top: 0 }
    round.balls++
    const colour = colourOf(s.zone)
    const onTarget = colour !== '' && colour !== 'Bunker' && s.points > 0

    if (colour === 'Bunker') {
      round.bunkers++
      earn('beach-holiday')
      if (round.bunkers >= 3) earn('sandcastle')
    }
    if (!onTarget) {
      round.misses++
      missesInARow++
      if (missesInARow >= 5) earn('wayward')
      if (s.out) earn('postcode-lottery')
      return
    }
    missesInARow = 0

    earn('on-the-board')
    if (colour === 'Black') earn('into-the-black')
    // Dead centre: the target's top score (Black is the same anywhere on it, so it doesn't count)
    const zs = ZONE_SCORES[colour]
    if (zs && zs.inside > zs.outside && s.basePoints >= zs.inside) earn('bullseye')
    if (s.hot) {
      round.hot++
      earn('hot-shot')
      if (round.hot >= 2) earn('hot-streak')
    }
    const top = TOP_TARGETS.indexOf(colour) >= 0
    if (top) round.top++
    if (top && s.windSpeed >= STRONG_WIND) {
      if (s.windAlong <= -STRONG_WIND * 0.6) earn('into-the-wind')
      if (s.windAlong >= STRONG_WIND * 0.6) earn('wind-assisted')
    }
    scoredWith.add(s.club)
    if (scoredWith.has('wedge') && scoredWith.has('iron') && scoredWith.has('driver')) earn('full-bag')
    // The effect badges only count with an effect you've unlocked yourself (not the Tester code)
    const effect = profile.tester ? '' : profile.equipped.ballProp ?? ''
    if (effect === 'prop-pigeon') earn('pigeon-post')
    if (effect === 'prop-boomerang') earn('it-came-back')
    if (effect === 'prop-antigrav') earn('moonwalker')
  })

  // The tenth ball has landed (before the ledger answers)
  onRoundFinished((r) => {
    if (r.tutorial) {
      earn('first-swing')
      return
    }
    earn('first-swing')
    earn('tee-time')
    if (round.balls >= 10 && round.misses === 0 && round.bunkers === 0) earn('clean-sheet')
    if (round.balls >= 10 && round.top >= 10) earn('perfect-10')
    if (myBay() === SOLO_BAY || solo.joined) earn('going-solo')
  })

  // The ledger's answer to a round
  onRoundResult((r) => {
    if (!r.counted) return
    if (r.trueScore >= 50000) earn('big-round')
    if (r.trueScore >= 100000) earn('huge-round')
    if (r.trueScore < 1000) earn('glutton-for-punishment')
    if (r.personalBest) earn('personal-best')
    if (r.roll >= 5) earn('lucky-roll')
    if (r.players >= 5) earn('busy-range')
  })

  // What the server keeps for me, checked every couple of seconds
  let wait = 0
  engine.addSystem((dt) => {
    wait -= dt
    if (wait > 0) return
    wait = 2
    if (!achievements.ready || !profile.ready) return

    if (profile.rounds >= 1) {
      earn('first-swing')
      earn('tee-time')
    }
    if (profile.rounds >= 100) earn('centurion')
    if (profile.level >= 10) earn('level-10')
    if (profile.level >= 25) earn('level-25')
    if (profile.level >= 50) earn('level-50')
    if (profile.points >= 100000) earn('pixel-rich')

    // What you own and wear: not while the Tester code has unlocked everything for this visit
    if (!profile.tester) {
      // Bought anything that costs Pixel Points
      if (profile.owned.some((id) => (CATALOGUE.find((c) => c.id === id)?.price ?? 0) > 0)) earn('window-shopper')
      const hat = profile.equipped.hat
      if (hat && hat !== NO_HAT) earn('dressed-for-it')
      const effects = CATALOGUE.filter((c) => c.kind === 'ballProp' && c.id !== 'prop-classic')
      if (effects.length && effects.every((c) => profile.owned.indexOf(c.id) >= 0)) earn('collector')
      const allHats = CATALOGUE.filter((c) => c.kind === 'hat' && c.id !== NO_HAT)
      if (allHats.length && allHats.every((h) => profile.owned.indexOf(h.id) >= 0)) earn('mad-hatter')
    }

    if (stats.ready) {
      const hits = stats.hits
      if (COLOURS.some((c) => (hits[c] ?? 0) > 0)) earn('on-the-board')
      if (COLOURS.every((c) => (hits[c] ?? 0) > 0)) earn('rainbow')
      if ((hits.Black ?? 0) > 0) earn('into-the-black')
      if (stats.hotHits > 0) earn('hot-shot')
      if (stats.bunkers > 0) earn('beach-holiday')
      if (stats.bigRolls > 0) earn('lucky-roll')
      if ((stats.daysPlayed ?? 0) >= 7) earn('regular')
      if ((stats.afkSeconds ?? 0) >= 1800 || stats.afkMinutes >= 30) earn('practice-makes-perfect')
    }
    if (afk.active && afk.seconds >= 1800) earn('practice-makes-perfect')

    if (boards.ready) {
      const day = boards.mine.day
      if ((day.true > 0 && day.true <= 5) || (day.multi > 0 && day.multi <= 5)) earn('on-the-leaderboard')
      for (const k in boards.mine) {
        const m = boards.mine[k as keyof typeof boards.mine]
        if (m.true === 1 || m.multi === 1) earn('champion')
      }
    }
  })
}
