/**
 * The rules of the ledger, shared by the scene and the server.
 *
 * Everything that decides a number lives here: what each target is worth, what
 * pays XP and Pixel Points, the level curve, the hot target, the multiplier and
 * the cosmetic catalogue. Both ends import this file, so the scene can show the
 * same figures the server pays and the two can never drift apart.
 *
 * No imports from the rest of the scene on purpose. The server runs this code
 * too, and it has no screen, no balls and no physics.
 *
 * Tune anything in this file freely. The only things the server stores are
 * totals (XP, Pixel Points, best rounds), so changing a price or a curve takes
 * effect on the next round without migrating anyone.
 */

// ---------------------------------------------------------------------------
// Rounds and scoring
// ---------------------------------------------------------------------------

/** Balls in a round. The round closes and posts when the last one lands. */
export const ROUND_BALLS = 10

/** Bays on the range. One player per bay. */
export const BAY_COUNT = 20

/**
 * Points at the very edge of a zone ("outside") and at its exact centre
 * ("inside"). game.ts scales between the two by how close the ball finished,
 * then rounds up to the nearest 10. The server checks every ball against these.
 */
export const ZONE_SCORES: Record<string, { outside: number; inside: number }> = {
  Bunker: { outside: -1000, inside: -1000 },
  Red: { outside: 500, inside: 1000 },
  Yellow: { outside: 750, inside: 2000 },
  Green: { outside: 750, inside: 4000 },
  Orange: { outside: 1250, inside: 8000 },
  Blue: { outside: 2000, inside: 10000 },
  White: { outside: 2000, inside: 12500 },
  Black: { outside: 20000, inside: 20000 }
}

/** Zone names in the scene end in a number when there are several: Red1 -> Red. */
export function zoneColour(zone: string): string {
  return zone.replace(/\d+$/, '')
}

/**
 * Whether one ball's result is possible.
 *
 * A miss is no zone and no points. A bunker is exactly its penalty. A target is
 * a multiple of 10 between its edge and centre values.
 */
export function validBall(zone: string, points: number): boolean {
  if (!Number.isInteger(points)) return false
  if (zone === '') return points === 0
  const s = ZONE_SCORES[zoneColour(zone)]
  if (!s) return false
  const lo = Math.min(s.outside, s.inside)
  const hi = Math.max(s.outside, s.inside)
  if (lo === hi) return points === lo
  return points % 10 === 0 && points >= lo && points <= Math.ceil(hi / 10) * 10
}

// ---------------------------------------------------------------------------
// Hot target
// ---------------------------------------------------------------------------

export const HOT = {
  /** How long each target stays hot before the next one lights up. */
  seconds: 30,
  /** What a hot target multiplies a ball's points by, on both boards. */
  factor: 2,
  /**
   * The zones that can light up. These are the entity names in the scene.
   * Bunkers are never hot.
   */
  targets: ['Red1', 'Red2', 'Red3', 'Red4', 'Yellow1', 'Yellow2', 'Green', 'Orange', 'Blue', 'White', 'Black']
}

// ---------------------------------------------------------------------------
// Shared multiplier
// ---------------------------------------------------------------------------

export const MULTIPLIER = {
  /** Never lower than this, so a solo player always gets exactly 2x. */
  floor: 2,
  /** Rolls at or above this are announced to the whole range. */
  shoutAt: 5
}

/** The highest roll possible with this many players in the space. */
export function multiplierCeiling(players: number): number {
  return Math.max(MULTIPLIER.floor, Math.floor(players))
}

// ---------------------------------------------------------------------------
// XP
// ---------------------------------------------------------------------------

export const XP = {
  /** Per ball, by target colour. Further targets pay more. */
  perZone: {
    Red: 10,
    Yellow: 15,
    Green: 20,
    Orange: 30,
    Blue: 40,
    White: 50,
    Black: 75
  } as Record<string, number>,
  /** A ball that found no target. Something for trying. */
  miss: 2,
  /** A ball in a bunker. */
  bunker: 0,
  /** Extra for a hot target hit, on top of the target's own XP. */
  hotHit: 10,
  /** For finishing a round of ten. */
  roundComplete: 25,
  /** For beating your own best True Score. */
  personalBest: 50,
  /** The daily login bonus. Comes back 24 hours after it was last collected. */
  dailyLogin: 100,
  /** Hours between daily login bonuses. */
  dailyHours: 24,
  /** The AFK practice range, per minute spent there. TBD in the GDD; tune here. */
  afkPerMinute: 5
}

/** XP for one ball. */
export function ballXp(zone: string, hot: boolean): number {
  if (zone === '') return XP.miss
  const colour = zoneColour(zone)
  if (colour === 'Bunker') return XP.bunker
  return (XP.perZone[colour] ?? XP.miss) + (hot ? XP.hotHit : 0)
}

// ---------------------------------------------------------------------------
// Pixel Points
// ---------------------------------------------------------------------------

/**
 * Pixel Points are earned by playing rounds and spent in the clubhouse shop.
 * The AFK practice range never pays them.
 */
export const POINTS = {
  /** For every round finished. */
  roundComplete: 20,
  /** One Pixel Point per this many True Score points in the round. */
  perScore: 1000,
  /** For beating your own best True Score. */
  personalBest: 25,
  /** With the daily login bonus. 0 keeps the GDD's "XP from logging in". */
  dailyLogin: 0
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export const LEVELS = {
  /** XP from level 1 to level 2. */
  first: 150,
  /** Each level after that needs this much more than the one before. */
  step: 50,
  /** The top of the ladder. */
  max: 50
}

/** Total XP needed to reach a level. Level 1 needs nothing. */
export function xpToReach(level: number): number {
  const n = Math.max(0, Math.min(LEVELS.max, level) - 1)
  return n * LEVELS.first + (LEVELS.step * n * (n - 1)) / 2
}

/** The level a total XP puts you at. */
export function levelFor(xp: number): number {
  let level = 1
  while (level < LEVELS.max && xp >= xpToReach(level + 1)) level++
  return level
}

/** For the level card: the level, XP into it, and XP the level needs in all. */
export function levelProgress(xp: number): { level: number; into: number; need: number } {
  const level = levelFor(xp)
  if (level >= LEVELS.max) return { level, into: 0, need: 0 }
  const base = xpToReach(level)
  return { level, into: xp - base, need: xpToReach(level + 1) - base }
}

// ---------------------------------------------------------------------------
// Cosmetics
// ---------------------------------------------------------------------------

export type CosmeticKind = 'ball' | 'club'

export type Cosmetic = {
  id: string
  kind: CosmeticKind
  name: string
  /** The level that puts it on the shelf. */
  level: number
  /** Pixel Points. 0 means it's yours as soon as it unlocks. */
  price: number
}

/**
 * The clubhouse shop. Cosmetic only: none of these change how far or how
 * straight a ball flies. Placeholder names and prices until the art exists.
 */
export const CATALOGUE: Cosmetic[] = [
  { id: 'ball-classic', kind: 'ball', name: 'Classic Ball', level: 1, price: 0 },
  { id: 'ball-sunshine', kind: 'ball', name: 'Sunshine Ball', level: 3, price: 150 },
  { id: 'ball-pixel', kind: 'ball', name: 'Pixel Ball', level: 6, price: 400 },
  { id: 'ball-comet', kind: 'ball', name: 'Comet Trail Ball', level: 10, price: 900 },
  { id: 'club-classic', kind: 'club', name: 'Classic Clubs', level: 1, price: 0 },
  { id: 'club-arcade', kind: 'club', name: 'Arcade Clubs', level: 4, price: 250 },
  { id: 'club-canyon', kind: 'club', name: 'Canyon Clubs', level: 8, price: 600 },
  { id: 'club-gold', kind: 'club', name: 'Gold Clubs', level: 12, price: 1200 }
]

export const DEFAULT_EQUIPPED: Record<CosmeticKind, string> = { ball: 'ball-classic', club: 'club-classic' }

export function itemById(id: string): Cosmetic | undefined {
  return CATALOGUE.find((i) => i.id === id)
}

// ---------------------------------------------------------------------------
// Leaderboard periods, all in UTC
// ---------------------------------------------------------------------------

export type Period = 'day' | 'week' | 'month' | 'all'
export const PERIODS: Period[] = ['day', 'week', 'month', 'all']

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)

/** Which day, week or month a moment belongs to. The daily board resets at 00:00 UTC. */
export function periodKey(period: Period, when: Date = new Date()): string {
  const y = when.getUTCFullYear()
  const m = when.getUTCMonth()
  const d = when.getUTCDate()
  if (period === 'day') return `${y}-${pad(m + 1)}-${pad(d)}`
  if (period === 'month') return `${y}-${pad(m + 1)}`
  if (period === 'week') {
    // Weeks start on Monday. The key is that Monday's date.
    const back = (when.getUTCDay() + 6) % 7
    const monday = new Date(Date.UTC(y, m, d - back))
    return `w${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`
  }
  return 'all'
}

/** Seconds until the next reset of a period, for the countdown on the boards. */
export function secondsToReset(period: Period, now: Date = new Date()): number {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  let next: number
  if (period === 'day') next = Date.UTC(y, m, d + 1)
  else if (period === 'week') next = Date.UTC(y, m, d + (7 - ((now.getUTCDay() + 6) % 7)))
  else if (period === 'month') next = Date.UTC(y, m + 1, 1)
  else return 0
  return Math.max(0, Math.floor((next - now.getTime()) / 1000))
}

// ---------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------

/**
 * Who can use the admin tools (the Reset ledger button in Settings). Same people as
 * Pixel Pirate Mini Golf's ADMIN.allow / ADMIN.allowNames.
 *
 * `wallets` is the list the server checks before it does anything, so it's the one that
 * actually protects the ledger. Compared lower-case.
 *
 * `names` only decides who sees the button. A client reports its own name, so a name can't
 * be trusted to permit anything: someone named here whose wallet isn't in `wallets` sees the
 * button but the server refuses the reset. The #tag on an unclaimed name and case are ignored.
 */
export const ADMIN = {
  wallets: ['0xbe21e2cbac649134e1b113e613f0dad15c91a9e2', '0x87b1a311980ed517a26b3cb2111dcaebdf584662'] as string[],
  names: ['thepixelarcade', 'JoelC'] as string[]
}

/** What the scene must send with adminReset, so a stray message can't wipe the ledger. */
export const RESET_CONFIRM = 'wipe-everyone'

/** Whether a wallet is on the admin list. This is the server's check. */
export function isAdminWallet(address: string): boolean {
  const a = (address || '').toLowerCase()
  return a !== '' && ADMIN.wallets.some((w) => w.toLowerCase() === a)
}

/** Whether a display name is on the admin list. Only used to show the button. */
export function isAdminName(name: string): boolean {
  const n = (name || '').split('#')[0].trim().toLowerCase()
  return n !== '' && ADMIN.names.some((x) => x.toLowerCase() === n)
}
