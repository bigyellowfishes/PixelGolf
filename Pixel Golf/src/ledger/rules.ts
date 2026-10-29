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
// Wind
// ---------------------------------------------------------------------------

/**
 * One wind for the whole range, set by the server so every shot (and every screen) uses the
 * same one. It holds for `seconds`, then changes: a new strength, and a direction that drifts
 * up to `maxTurn` degrees from the last. The tutorial is always calm.
 */
export const WIND = {
  seconds: 120,
  /** Strength range, m/s (1 m/s is about 2.2 mph) */
  minSpeed: 0,
  maxSpeed: 6,
  /** Most the direction swings round at each change, degrees */
  maxTurn: 90,
  /**
   * How hard it pushes the ball while it's in the air: m/s² of push per m/s of wind. Tune this
   * to make wind matter more or less. On the ground the wind does nothing.
   */
  push: 0.25
}

/** Wind as a vector along the ground, m/s. dir is where it blows TO, degrees (0 = +z, 90 = +x). */
export function windVector(dir: number, speed: number): { x: number; z: number } {
  const r = (dir * Math.PI) / 180
  return { x: Math.sin(r) * speed, z: Math.cos(r) * speed }
}

// ---------------------------------------------------------------------------
// Shared multiplier
// ---------------------------------------------------------------------------

export const MULTIPLIER = {
  /** Never lower than this, so a solo player always gets exactly 2x. */
  floor: 2,
  /**
   * The guaranteed minimum steps up with the crowd: every `step` players lifts it to that many.
   * 5 to 9 players: at least 5x. 10 to 14: at least 10x. And so on.
   */
  step: 5,
  /** Rolls at or above this are announced to the whole range (only when above the minimum). */
  shoutAt: 5
}

/** The lowest roll possible with this many players in the space. Always a whole number. */
export function multiplierFloor(players: number): number {
  const crowd = Math.floor(Math.floor(players) / MULTIPLIER.step) * MULTIPLIER.step
  return Math.max(MULTIPLIER.floor, crowd)
}

/** The highest roll possible with this many players in the space. Always a whole number. */
export function multiplierCeiling(players: number): number {
  return Math.max(multiplierFloor(players), Math.floor(players))
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
  /** The AFK practice range: this much XP every afkTickSeconds spent practising there. */
  afkPerTick: 1,
  afkTickSeconds: 10
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

/** Finishing the tutorial takes a new player to this level (server.ts, tutorialDone). */
export const TUTORIAL_LEVEL = 2

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

export type CosmeticKind = 'ballVis' | 'ballProp' | 'club' | 'hat'

export type Cosmetic = {
  id: string
  kind: CosmeticKind
  name: string
  /** The level that puts it on the shelf. */
  level: number
  /** Pixel Points. 0 means it's yours as soon as it unlocks. */
  price: number
  /** The model it shows (balls: in place of the standard ball). None yet: looks the same as the starter. */
  model?: string
  /** Kept for anyone who already owns it, but not shown in the shop (no art yet) */
  shelved?: boolean
  /** Hats only: the style ('cap', 'visor', 'bucket') and colour (HAT_COLOURS) */
  style?: string
  colour?: string
}

// Hats (added 2026-10-27): Pixel Golf caps, visors and bucket hats, worn on the player's head
// (clothes.ts). Every style comes in every colour, id `hat-cap-navy` and so on, plus 'hat-none'
// for no hat.
export const HAT_COLOURS: { id: string; name: string; rgb: { r: number; g: number; b: number } }[] = [
  { id: 'navy', name: 'Navy', rgb: { r: 0.03, g: 0.16, b: 0.35 } },
  { id: 'blue', name: 'Blue', rgb: { r: 0.27, g: 0.36, b: 0.8 } },
  { id: 'green', name: 'Green', rgb: { r: 0.31, g: 0.53, b: 0.31 } },
  { id: 'yellow', name: 'Yellow', rgb: { r: 0.91, g: 0.78, b: 0.47 } },
  { id: 'grey', name: 'Grey', rgb: { r: 0.64, g: 0.64, b: 0.64 } },
  { id: 'white', name: 'White', rgb: { r: 0.86, g: 0.86, b: 0.86 } },
  { id: 'black', name: 'Black', rgb: { r: 0.06, g: 0.06, b: 0.06 } }
]
export const HAT_STYLES: { id: string; name: string; level: number; price: number }[] = [
  { id: 'cap', name: 'Golf Cap', level: 1, price: 0 },
  { id: 'visor', name: 'Visor', level: 1, price: 0 },
  { id: 'bucket', name: 'Bucket Hat', level: 1, price: 0 }
]
export const NO_HAT = 'hat-none'

/**
 * Where a hat sits on the head bone, which each player can change in their backpack (everyone
 * sees it the way they set it): up and forward in metres, tilt in degrees (front up is positive),
 * size as a scale.
 */
export type HatFit = { up: number; forward: number; tilt: number; size: number }
export const HAT_FIT_DEFAULT: HatFit = { up: 0.09, forward: 0, tilt: 0, size: 1.08 }
export const HAT_FIT_LIMITS: Record<keyof HatFit, [number, number]> = { up: [-0.05, 0.25], forward: [-0.08, 0.08], tilt: [-20, 20], size: [0.8, 1.4] }

/** A fit kept inside the limits (anything missing or broken is the default) */
export function cleanHatFit(f: Partial<HatFit> | undefined): HatFit {
  const out = { ...HAT_FIT_DEFAULT }
  if (!f) return out
  for (const k of Object.keys(HAT_FIT_LIMITS) as (keyof HatFit)[]) {
    const v = Number(f[k])
    if (isFinite(v)) out[k] = Math.round(Math.min(HAT_FIT_LIMITS[k][1], Math.max(HAT_FIT_LIMITS[k][0], v)) * 1000) / 1000
  }
  return out
}

function hats(): Cosmetic[] {
  const out: Cosmetic[] = [{ id: NO_HAT, kind: 'hat', name: 'No hat', level: 1, price: 0 }]
  for (const s of HAT_STYLES) {
    for (const c of HAT_COLOURS) {
      out.push({ id: `hat-${s.id}-${c.id}`, kind: 'hat', name: `${c.name} ${s.name}`, level: s.level, price: s.price, style: s.id, colour: c.id })
    }
  }
  return out
}

/**
 * The clubhouse shop. Cosmetic only: none of these change how far or how
 * straight a ball flies. Placeholder names and prices until the art exists.
 */
export const CATALOGUE: Cosmetic[] = [
  { id: 'ball-classic', kind: 'ballVis', name: 'Classic Ball',  level: 1, price: 0, model: 'assets/Balls/Ball_Classic.glb' },
  { id: 'ball-red',     kind: 'ballVis', name: 'Red Ball',      level: 1, price: 0, model: 'assets/Balls/Ball_Red.glb' },
  { id: 'ball-orange',  kind: 'ballVis', name: 'Orange Ball',   level: 1, price: 0, model: 'assets/Balls/Ball_Orange.glb' },
  { id: 'ball-yellow',  kind: 'ballVis', name: 'Yellow Ball',   level: 1, price: 0, model: 'assets/Balls/Ball_Yellow.glb' },
  { id: 'ball-green',   kind: 'ballVis', name: 'Green Ball',    level: 1, price: 0, model: 'assets/Balls/Ball_Green.glb' },
  { id: 'ball-blue',    kind: 'ballVis', name: 'Blue Ball',     level: 1, price: 0, model: 'assets/Balls/Ball_Blue.glb' },
  { id: 'ball-black',   kind: 'ballVis', name: 'Black Ball',    level: 1, price: 0, model: 'assets/Balls/Ball_Black.glb' },
  // Flies once it's hit, instead of rolling (src/pigeonBall.ts)
  { id: 'ball-pigeon',  kind: 'ballVis', name: 'Pigeon',        level: 1, price: 0, model: 'assets/Balls/Ball_Pigeon.glb' },
  // Effects (how the ball flies, BALL_PROFILES below). Shown as "Effects" in the shop; the ids stay
  // as they were so what players own and have equipped is kept.
  { id: 'prop-classic', kind: 'ballProp', name: 'Standard', level: 1, price: 0},
  { id: 'prop-Styro', kind: 'ballProp', name: 'Lightweight', level: 1, price: 0},
  { id: 'prop-bouncy', kind: 'ballProp', name: 'Super Bounce', level: 1, price: 0},
  { id: 'prop-antigrav', kind: 'ballProp', name: 'Moon Physics', level: 1, price: 0},
  { id: 'prop-bowling', kind: 'ballProp', name: 'Heavyweight', level: 1, price: 0},
  { id: 'prop-boomerang', kind: 'ballProp', name: 'Boomerang', level: 1, price: 0},
  { id: 'prop-pigeon', kind: 'ballProp', name: 'Pigeon', level: 1, price: 0},
  { id: 'prop-egg', kind: 'ballProp', name: 'Crazy Wobble', level: 1, price: 0},
  { id: 'club-classic', kind: 'club', name: 'Classic Clubs', level: 1, price: 0 },
  ...hats(),
]

// ---------------------------------------------------------------------------
// Ball properties (the 'ballProp' cosmetics): how the ball flies
// ---------------------------------------------------------------------------

/**
 * How a ball behaves in flight. ballSim.ts reads this, the server picks it from the shooter's
 * equipped ballProp, and a recorded shot is played back the same everywhere, so nothing here
 * goes over the wire. 'prop-classic' is the baseline: it matches the sim's old fixed numbers.
 */
export type BallProfile = {
  /** x the wind's push while the ball is in the air */
  windMul: number
  /** x gravity (9.82 m/s2) for the whole flight */
  gravityMul: number
  /** How much of its speed the ball keeps on a bounce off the course */
  restitution: number
  /** Linear damping: air drag and rolling resistance in one (the sim has no ground friction) */
  damping: number
  /** x the launch speed */
  speedMul: number
  /** x the launch's upward part (the chip that lifts every shot). 0 keeps it on the ground. */
  liftMul: number
  /** Longest a shot can run, seconds */
  maxSeconds: number
  /** Glide: gravity is cut to gravityMul (of the normal) for the first `seconds` in the air */
  glide?: { seconds: number; gravityMul: number }
  /**
   * Boomerang: flies out (use speedMul and liftMul to send it far and high), and is pulled back
   * towards the player the whole time it's in the air, so it turns round and comes down `land`
   * of the way out to the furthest point it reached (0.5 = half way back). It lands dead, keeping
   * `landKeep` of its speed, so it stops about there rather than rolling back to the player.
   */
  boomerang?: { land: number; landKeep: number }
  /** Wobble: a sideways kick of up to this many m/s on every real bounce (the egg) */
  wobble?: number
}

const BASE_PROFILE: BallProfile = {
  windMul: 1,
  gravityMul: 1,
  restitution: 0.2,
  damping: 0.35,
  speedMul: 1,
  liftMul: 1,
  maxSeconds: 10
}

/** Keyed by the 'prop-...' ids in CATALOGUE. Tune freely: nothing is stored. */
export const BALL_PROFILES: Record<string, BallProfile> = {
  'prop-classic': BASE_PROFILE,
  // Light and draggy: the wind shoves it four times as hard
  'prop-Styro': { ...BASE_PROFILE, windMul: 4 },
  // Keeps most of its speed on a bounce and rolls little
  'prop-bouncy': { ...BASE_PROFILE, restitution: 0.8, damping: 0.25, maxSeconds: 15 },
  // Floats: a third of gravity, so a long way up and a long way down
  'prop-antigrav': { ...BASE_PROFILE, gravityMul: 0.35, maxSeconds: 20 },
  // No lob: stays on the ground, slower off the club, and barely slows once it's rolling
  'prop-bowling': { ...BASE_PROFILE, speedMul: 0.6, liftMul: 0, damping: 0.15, maxSeconds: 20 },
  // Flies out a long way, high, then turns round in the air and comes back to about half way
  'prop-boomerang': { ...BASE_PROFILE, speedMul: 1.7, liftMul: 1.2, boomerang: { land: 0.5, landKeep: 0.15 }, maxSeconds: 18 },
  // Flaps along near the top of its flight for a couple of seconds, then drops
  'prop-pigeon': { ...BASE_PROFILE, glide: { seconds: 2.5, gravityMul: 0.1 }, maxSeconds: 12 },
  // Wobbles off line on every bounce and doesn't roll far
  'prop-egg': { ...BASE_PROFILE, restitution: 0.15, damping: 0.35, wobble: 3 }
}

/** The profile for an equipped ballProp id. Anything unknown (or nothing) is the classic ball. */
export function ballProfile(id?: string): BallProfile {
  return (id && BALL_PROFILES[id]) || BALL_PROFILES['prop-classic']
}

export const DEFAULT_EQUIPPED: Record<CosmeticKind, string> = { ballVis: 'ball-classic', ballProp: 'prop-classic', club: 'club-classic', hat: NO_HAT }

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
