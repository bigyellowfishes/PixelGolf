import { engine } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'

import { room } from './room'
import { ShotPath, Vec3, decodePath } from '../ballSim'
import { WIND, windVector, HOT, Period, PERIODS, levelProgress, multiplierCeiling, multiplierFloor,isAdminName, isAdminWallet, RESET_CONFIRM } from './rules'

/**
 * The scene's side of the ledger.
 *
 * Says hello, keeps the server told that this player is here, posts finished
 * rounds, and holds what the server sends back so the UI can read it. Nothing
 * here decides a number the server pays: the scene reports, the server pays.
 *
 * The UI reads the exported objects below each frame. Anything that needs to
 * react at a moment (a round result, a level-up) subscribes with the on...()
 * functions.
 */

// ---------------------------------------------------------------------------
// What the server has told us
// ---------------------------------------------------------------------------

export const profile = {
  /** True once the server has answered. Until then, show a dash. */
  ready: false,
  /** False for a guest: progress won't be there next visit. */
  durable: false,
  xp: 0,
  level: 1,
  /** XP into this level, and what the level needs in all. */
  levelXp: 0,
  levelNeed: 0,
  points: 0,
  pointsEarned: 0,
  best: 0,
  bestMulti: 0,
  rounds: 0,
  owned: [] as string[],
  equipped: { ball: 'ball-classic', club: 'club-classic' } as Record<string, string>,
  /** Seconds until the daily login bonus is back, counted down locally. */
  dailyIn: 0,
  /**
   * Whether the server has this player down as having finished the tutorial round (the
   * 'tutorial' message). Starts true so nothing happens until the server explicitly says false.
   */
  tutorialDone: true
}

/**
 * The range's wind, from the server ('wind'). dir is where it blows to, degrees (0 = +z,
 * 90 = +x), speed m/s. Calm until the server says otherwise.
 */
export const wind = {
  dir: 0,
  speed: 0,
  changesAt: 0,
  ready: false
}

/**
 * The tutorial's own wind and hot target, set by game.ts for the lesson on each shot: a slight
 * wind on shot 4 and a 2X hot target on the orange target on shot 5. Everything else in the
 * tutorial is calm and has no hot target. Only on this player's screen.
 */
export const tutorialLesson = { windDir: 0, windSpeed: 0, hot: '' }

/** The wind as this player sees it: the tutorial's lesson wind in the tutorial, else the range's. */
export function effectiveWind(): { dir: number; speed: number; ready: boolean } {
  if (tutorial.active) return { dir: tutorialLesson.windDir, speed: tutorialLesson.windSpeed, ready: tutorialLesson.windSpeed > 0 }
  return wind
}

/** The hot target as this player sees it: the tutorial's lesson target in the tutorial, else the range's. */
export function effectiveHot(): string {
  return tutorial.active ? tutorialLesson.hot : range.hot
}

/** The wind a shot should fly in right now: the range's, or the tutorial's (calm except its wind lesson). */
export function shotWind(): { x: number; z: number } {
  const w = effectiveWind()
  if (!w.ready) return { x: 0, z: 0 }
  return windVector(w.dir, w.speed)
}

/** Seconds until the wind changes */
export function windSecondsLeft(): number {
  return Math.max(0, Math.ceil((wind.changesAt - Date.now()) / 1000))
}

/** Strongest wind, for scaling a gauge */
export const WIND_MAX = WIND.maxSpeed

export const range = {
  /** The hot target's zone name, or '' until the server says. */
  hot: '',
  /** When it rotates, in this client's clock (ms). */
  hotEndsAt: 0,
  /** Players in the space, by the server's count. At least 1: you. */
  players: 1
}

export type BoardRow = { n: string; v: number; u: string }
export type Board = { key: string; true: BoardRow[]; multi: BoardRow[] }
export type MyRank = { true: number; trueV: number; multi: number; multiV: number }

export const boards: { ready: boolean; tables: Record<Period, Board>; mine: Record<Period, MyRank> } = {
  ready: false,
  tables: {
    day: { key: '', true: [], multi: [] },
    week: { key: '', true: [], multi: [] },
    month: { key: '', true: [], multi: [] },
    all: { key: '', true: [], multi: [] }
  },
  mine: {
    day: { true: 0, trueV: 0, multi: 0, multiV: 0 },
    week: { true: 0, trueV: 0, multi: 0, multiV: 0 },
    month: { true: 0, trueV: 0, multi: 0, multiV: 0 },
    all: { true: 0, trueV: 0, multi: 0, multiV: 0 }
  }
}

/**
 * Your running stats for the Player Stats page (ui/PlayerStats.tsx), as the server last sent them
 * (Stats in ledger/server.ts). ready is false until it has.
 */
export const stats = {
  ready: false,
  since: 0,
  rounds: 0,
  balls: 0,
  misses: 0,
  bunkers: 0,
  hits: {} as Record<string, number>,
  hotHits: 0,
  bestShot: 0,
  bestShotZone: '',
  totalScore: 0,
  perfect: 0,
  biggestRoll: 0,
  bigRolls: 0,
  longest: 0,
  longestClub: '',
  clubs: {} as Record<string, number>,
  streak: 0,
  bestStreak: 0,
  lastDay: 0,
  playSeconds: 0,
  afkMinutes: 0
}

/** Which ball each player has equipped (wallet, lower case -> ball id), by the server's list. */
export const ballLooks: Record<string, string> = {}

/** The ball id of whoever holds this bay ('' if nobody, or they have the standard ball). */
export function bayBallLook(bay: number): string {
  const o = bays.owners[String(bay)]
  return o ? ballLooks[o.u.toLowerCase()] ?? '' : ''
}

/** Who has which bay, by the server's list, and a claim waiting for its answer. */
export const bays = {
  owners: {} as Record<string, { u: string; n: string }>,
  pending: 0
}

// ---------------------------------------------------------------------------
// Tutorial
// ---------------------------------------------------------------------------

/** The bay reserved for the tutorial round. It's local to each player's screen: never claimed on the server. */
export const TUTORIAL_BAY = 19

/**
 * Shots in the tutorial round. A miss doesn't use one up: the ball comes back and the player
 * tries that shot again (game.ts). The tutorial round isn't posted to the ledger, since the
 * server only takes full rounds of ROUND_BALLS.
 */
export const TUTORIAL_BALLS = 5

/**
 * The solo bay. Anyone can play here, any number at once: it's never owned by one player like
 * the other bays (no "in use by" lock). Each player's ball, score and shots stay on their own
 * screen, like the tutorial bay. Players who have joined it (clicked its Tee Off screen) are
 * hidden from everyone while they're in the bay, and see nobody else; anyone just walking past
 * stays visible (tutorialVisuals.ts).
 */
export const SOLO_BAY = 20

export const solo = {
  /** True once this player has clicked the solo bay's Tee Off screen, until they pick another bay or walk away. */
  joined: false,
  /** Wallets of everyone in the solo bay, by the server's list (lower case). */
  players: [] as string[]
}

/** Leave the solo bay without picking another one (walked away). */
export function leaveSoloBay(): void {
  if (!solo.joined) return
  solo.joined = false
  void room.send('leaveSolo', { n: 1 })
}

export const tutorial = {
  /** True while this player is playing their tutorial round in the tutorial bay. */
  active: false,
  /** True once this visit's tutorial has begun, so a later ledger update can't restart it. */
  started: false,
  /**
   * True while this tutorial is a replay (the Replay Tutorial button in the Pixel Golf menu) by a
   * player who's already done it: a practice run on their screen only, nothing sent to the server.
   */
  replay: false
}

/**
 * Why this player can't use a bay right now, or '' if they can. During the tutorial
 * only the tutorial bay is playable. After it, the tutorial bay is closed.
 */
export function bayLockReason(bay: number): string {
  if (tutorial.active && bay !== TUTORIAL_BAY) return 'Finish your tutorial round first'
  if (!tutorial.active && bay === TUTORIAL_BAY) return `Bay ${TUTORIAL_BAY} is reserved for the tutorial`
  return ''
}

/** Tell the server this player finished the tutorial, so it's saved on their ledger. */
export function sendTutorialDone(): void {
  void room.send('tutorialDone', { n: 1 })
}

export type RoundResult = {
  trueScore: number
  roll: number
  players: number
  multiScore: number
  hotHits: number
  xp: number
  points: number
  personalBest: boolean
  counted: boolean
  reason: string
}

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------

type Fn<T> = (v: T) => void
const profileFns: Fn<typeof profile>[] = []
const resultFns: Fn<RoundResult>[] = []
const levelFns: Fn<{ level: number; gained: number; unlocked: string[] }>[] = []
const awardFns: Fn<{ xp: number; points: number; reason: string }>[] = []
const rolledFns: Fn<{ name: string; roll: number; score: number }>[] = []
const refusedFns: Fn<string>[] = []
const settingsFns: Fn<Record<string, boolean>>[] = []
const resetFns: Fn<string>[] = []
const tutorialRewardFns: Fn<{ xp: number; level: number; unlocked: string[] }>[] = []
/** A shot the server simulated: which bay, my request id if it's mine, and its keyframes. */
export type ServerShot = { bay: number; id: number; mine: boolean; path: ShotPath }
export type BayScore = { bay: number; score: number; shot: number; last: number; zone: string; hot: boolean }
const serverShotFns: Fn<ServerShot>[] = []
const shotRefusedFns: Fn<{ bay: number; id: number }>[] = []
const bayScoreFns: Fn<BayScore>[] = []
/** A shared shot, simulated once on the server: mine (to play) or someone else's (to watch). */
export const onServerShot = (fn: Fn<ServerShot>) => serverShotFns.push(fn)
/** The server wouldn't simulate my shot. The scene plays it on this screen only. */
export const onShotRefused = (fn: Fn<{ bay: number; id: number }>) => shotRefusedFns.push(fn)
/** Another player's bay numbers after their shot. */
export const onBayScore = (fn: Fn<BayScore>) => bayScoreFns.push(fn)

let shotSeq = 0
/**
 * Asks the server to simulate my shot in a shared bay. It sends the keyframes to everyone,
 * me included, so every screen plays the same ball. Returns the request id to match the reply.
 */
export function askShot(bay: number, start: Vec3, launch: Vec3): number {
  shotSeq = (shotSeq % 1000000) + 1
  void room.send('shotAsk', {
    bay,
    id: shotSeq,
    sx: start.x,
    sy: start.y,
    sz: start.z,
    vx: launch.x,
    vy: launch.y,
    vz: launch.z
  })
  return shotSeq
}

/** Tell everyone my bay's numbers after the ball settles. */
export function sendShotDone(d: BayScore): void {
  if (d.bay > 0 && d.bay !== TUTORIAL_BAY && d.bay !== SOLO_BAY) void room.send('shotDone', d)
}

/** Whenever XP, points or cosmetics change. */
export const onProfile = (fn: Fn<typeof profile>) => profileFns.push(fn)
/** The server's answer to a posted round. */
export const onRoundResult = (fn: Fn<RoundResult>) => resultFns.push(fn)
export const onLevelUp = (fn: Fn<{ level: number; gained: number; unlocked: string[] }>) => levelFns.push(fn)
export const onAward = (fn: Fn<{ xp: number; points: number; reason: string }>) => awardFns.push(fn)
/** Someone on the range rolled a big multiplier. */
export const onBigRoll = (fn: Fn<{ name: string; roll: number; score: number }>) => rolledFns.push(fn)
export const onRefused = (fn: Fn<string>) => refusedFns.push(fn)
/** The Settings switches this player saved last time. */
export const onSavedSettings = (fn: Fn<Record<string, boolean>>) => settingsFns.push(fn)
/** An admin reset the ledger. Gets the admin's name. Fires before the fresh ledger arrives. */
export const onLedgerReset = (fn: Fn<string>) => resetFns.push(fn)
/** The server's reward for finishing the tutorial: the XP given and the level it took them to. */
export const onTutorialReward = (fn: Fn<{ xp: number; level: number; unlocked: string[] }>) => tutorialRewardFns.push(fn)

// ---------------------------------------------------------------------------
// Asking the server
// ---------------------------------------------------------------------------

export type BallResult = { zone: string; points: number; hot: boolean }

/** Posts a finished round. points are base points, before the hot target doubles them. */
export function submitRound(balls: BallResult[]): void {
  const json = JSON.stringify(balls.map((b) => ({ z: b.zone, p: b.points, h: b.hot ? 1 : 0 })))
  void room.send('round', { balls: json })
}

export function buyCosmetic(id: string): void {
  void room.send('buy', { id })
}

export function equipCosmetic(id: string): void {
  void room.send('equip', { id })
}

function myId(): string {
  return getPlayer()?.userId ?? ''
}

/** The name of whoever else has this bay, or '' if it's free or yours. */
export function bayTakenBy(bay: number): string {
  // Nobody owns the solo bay, so it's never taken
  if (bay === SOLO_BAY) return ''
  const o = bays.owners[String(bay)]
  return o && o.u !== myId() ? o.n || 'another player' : ''
}

/** The bay this player plays in, or 0 if they haven't picked one. */
export function myBay(): number {
  if (tutorial.active) return TUTORIAL_BAY
  if (solo.joined) return SOLO_BAY
  const me = myId()
  if (me) {
    for (const k in bays.owners) if (bays.owners[k].u === me) return Number(k)
  }
  if (bays.pending && !bayTakenBy(bays.pending)) return bays.pending
  return 0
}

/**
 * Lets this player's bay go (they walked away), so anyone can use it: off this screen's list at
 * once, and the server frees it for everyone. The solo bay is left the same way. Their round in
 * progress stays with them (game.ts) for the next bay they play in.
 */
export function leaveBay(): void {
  const bay = myBay()
  bays.pending = 0
  if (!bay || bay === TUTORIAL_BAY) return
  if (bay === SOLO_BAY) {
    leaveSoloBay()
    return
  }
  const me = myId()
  if (me) delete bays.owners[String(bay)]
  void room.send('leaveBay', { bay })
}

/**
 * Asks for a bay. Returns false straight away if someone else has it. Otherwise
 * it's yours at once on this screen, and the server confirms it (or, if someone
 * beat you to it, says so and it's taken back).
 */
export function claimBay(bay: number): boolean {
  if (bayLockReason(bay) || bayTakenBy(bay)) return false
  // The tutorial bay is never claimed on the server, so any number of newcomers can use it at once
  if (bay === TUTORIAL_BAY) return true
  // The solo bay takes anyone. The server adds them to its list (and lets their old bay go).
  if (bay === SOLO_BAY) {
    solo.joined = true
    bays.pending = 0
    void room.send('claimBay', { bay })
    return true
  }
  // Any other bay: leaving the solo bay for it
  solo.joined = false
  bays.pending = bay
  void room.send('claimBay', { bay })
  return true
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/**
 * Whether to show this player the admin tools. By wallet or by name (ADMIN in rules.ts).
 * Only decides what's drawn: the server checks the wallet before it does anything.
 */
export function amIAdmin(): boolean {
  return isAdminWallet(myId()) || isAdminName(myName())
}

/** The dev panel's switches as the server last said (ui/DevPanel.tsx shows them) */
export const dev = { extra: 0, hotHold: false, windHold: false }

/** Admin only: make this target hot now ('' = back to the random rotation). hold: keep it there. */
export function sendAdminHot(zone: string, hold: boolean): void {
  void room.send('adminHot', { zone, hold })
}

/** Admin only: count this many pretend extra players in the space. */
export function sendAdminPlayers(extra: number): void {
  void room.send('adminPlayers', { extra: Math.max(0, Math.round(extra)) })
}

/** Admin only: set the wind (dir degrees, speed m/s; speed below 0 = random change). hold: keep it. */
export function sendAdminWind(dir: number, speed: number, hold: boolean): void {
  void room.send('adminWind', { dir, speed, hold })
}

/** Admin only: ask the server to wipe every player's progress and all the leaderboards. */
export function sendAdminReset(): void {
  void room.send('adminReset', { confirm: RESET_CONFIRM })
}

export function saveSetting(key: string, on: boolean): void {
  void room.send('settings', { key, on })
}

/**
 * Call once a minute while the player is on the AFK practice range. The server
 * pays XP for it, never Pixel Points, and ignores calls that come too fast.
 */
export function afkMinute(): void {
  void room.send('afk', { n: 1 })
}

// ---------------------------------------------------------------------------
// Reading the range
// ---------------------------------------------------------------------------

/** Whether a zone is the hot target right now. In the tutorial, only its lesson target. */
export function isHot(zone: string): boolean {
  if (tutorial.active) return zone !== '' && zone === tutorialLesson.hot
  return range.hot !== '' && zone === range.hot && Date.now() < range.hotEndsAt + 1500
}

/** Seconds until the hot target moves on. */
export function hotSecondsLeft(): number {
  return Math.max(0, Math.ceil((range.hotEndsAt - Date.now()) / 1000))
}

/** The biggest multiplier a round can roll right now. */
export function currentCeiling(): number {
  return multiplierCeiling(range.players)
}

/** The lowest multiplier a round can roll right now (2x, then 5x at 5+ players, 10x at 10+, ...). */
export function currentFloor(): number {
  return multiplierFloor(range.players)
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function myName(): string {
  const p = getPlayer()
  return p && p.name ? p.name : ''
}

function greet(): void {
  void room.send('hello', { version: 1, name: myName() })
}

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

/** How often to tell the server we're still here. */
const HERE_SECONDS = 20

export function setupLedgerClient(): void {
  room.onMessage('ledger', (d) => {
    const lp = levelProgress(d.xp)
    profile.ready = true
    profile.durable = d.durable
    profile.xp = d.xp
    profile.level = lp.level
    profile.levelXp = lp.into
    profile.levelNeed = lp.need
    profile.points = d.points
    profile.pointsEarned = d.pointsEarned
    profile.best = d.best
    profile.bestMulti = d.bestMulti
    profile.rounds = d.rounds
    profile.owned = parse<string[]>(d.owned, [])
    profile.equipped = parse<Record<string, string>>(d.equipped, profile.equipped)
    profile.dailyIn = d.dailyIn
    for (const fn of profileFns) fn(profile)
  })

  // Sent by the server right after every ledger. Only the first `false` starts the tutorial.
  room.onMessage('tutorial', (d) => {
    profile.tutorialDone = d.done
    for (const fn of profileFns) fn(profile)
  })

  room.onMessage('tutorialReward', (d) => {
    const v = { xp: d.xp, level: d.level, unlocked: parse<string[]>(d.unlocked, []) }
    for (const fn of tutorialRewardFns) fn(v)
  })

  room.onMessage('myStats', (d) => {
    const s = parse<Partial<typeof stats>>(d.json, {})
    Object.assign(stats, s, { ready: true, hits: s.hits ?? {}, clubs: s.clubs ?? {} })
  })

  room.onMessage('devState', (d) => {
    const s = parse<{ extra?: number; hotHold?: boolean; windHold?: boolean }>(d.json, {})
    dev.extra = s.extra ?? 0
    dev.hotHold = !!s.hotHold
    dev.windHold = !!s.windHold
  })

  room.onMessage('mySettings', (d) => {
    const s = parse<Record<string, boolean>>(d.json, {})
    for (const fn of settingsFns) fn(s)
  })

  room.onMessage('wind', (d) => {
    wind.dir = d.dir
    wind.speed = d.speed
    wind.changesAt = Date.now() + d.seconds * 1000
    wind.ready = true
  })

  room.onMessage('range', (d) => {
    range.hot = d.hot
    range.hotEndsAt = Date.now() + d.seconds * 1000
    range.players = Math.max(1, d.players)
  })

  room.onMessage('leaders', (d) => {
    const t = parse<Partial<Record<Period, Board>>>(d.json, {})
    for (const p of PERIODS) if (t[p]) boards.tables[p] = t[p] as Board
    boards.ready = true
  })

  room.onMessage('myRanks', (d) => {
    const m = parse<Partial<Record<Period, MyRank>>>(d.json, {})
    for (const p of PERIODS) if (m[p]) boards.mine[p] = m[p] as MyRank
  })

  room.onMessage('ballLooks', (d) => {
    const looks = parse<Record<string, string>>(d.json, {})
    for (const k of Object.keys(ballLooks)) delete ballLooks[k]
    for (const k in looks) ballLooks[k.toLowerCase()] = looks[k]
  })

  room.onMessage('bays', (d) => {
    bays.owners = parse<Record<string, { u: string; n: string }>>(d.json, {})
    // The server has answered the claim one way or the other once that bay has an owner
    if (bays.pending && bays.owners[String(bays.pending)]) bays.pending = 0
  })

  room.onMessage('soloPlayers', (d) => {
    solo.players = parse<string[]>(d.json, []).map((a) => String(a).toLowerCase())
  })

  // Shared shots, simulated on the server. Mine plays in my bay; other players' play on their
  // bay's ball. Players in the tutorial don't see anyone else's, and the solo bay is never shared.
  // (shotSeen, the old relay of a launch velocity, is no longer listened to.)
  room.onMessage('shotPath', (d) => {
    const mine = d.u.toLowerCase() === myId().toLowerCase()
    if (!mine && (tutorial.active || d.bay === myBay() || d.bay === SOLO_BAY)) return
    const path = decodePath(d.data)
    if (!path) {
      console.log(`[ledger] could not read the shot for bay ${d.bay}`)
      if (mine) for (const fn of shotRefusedFns) fn({ bay: d.bay, id: d.id })
      return
    }
    for (const fn of serverShotFns) fn({ bay: d.bay, id: d.id, mine, path })
  })
  room.onMessage('shotNo', (d) => {
    for (const fn of shotRefusedFns) fn({ bay: d.bay, id: d.id })
  })
  room.onMessage('bayScore', (d) => {
    if (tutorial.active || d.bay === myBay() || d.bay === SOLO_BAY) return
    for (const fn of bayScoreFns) fn({ ...d })
  })

  room.onMessage('roundResult', (d) => {
    for (const fn of resultFns) fn({ ...d })
  })

  room.onMessage('levelUp', (d) => {
    const v = { level: d.level, gained: d.gained, unlocked: parse<string[]>(d.unlocked, []) }
    for (const fn of levelFns) fn(v)
  })

  room.onMessage('awarded', (d) => {
    for (const fn of awardFns) fn({ ...d })
  })

  room.onMessage('rolled', (d) => {
    for (const fn of rolledFns) fn({ ...d })
  })

  room.onMessage('refused', (d) => {
    for (const fn of refusedFns) fn(d.reason)
  })

  // An admin wiped the ledger. Forget everything the server told us, let the scene clear
  // itself, then say hello again: the answer is the fresh, empty ledger, and with it the
  // tutorial for everyone.
  room.onMessage('ledgerReset', (d) => {
    profile.ready = false
    profile.xp = 0
    profile.level = 1
    profile.levelXp = 0
    profile.levelNeed = 0
    profile.points = 0
    profile.pointsEarned = 0
    profile.best = 0
    profile.bestMulti = 0
    profile.rounds = 0
    profile.owned = []
    profile.dailyIn = 0
    // Back to "wait for the server", so only its explicit `false` starts the tutorial
    profile.tutorialDone = true
    tutorial.active = false
    tutorial.started = false
    bays.pending = 0
    solo.joined = false
    for (const p of PERIODS) boards.mine[p] = { true: 0, trueV: 0, multi: 0, multiV: 0 }
    for (const fn of resetFns) fn(d.by)
    greet()
  })

  // Messages sent before the room connects are queued, so hello can go now
  greet()

  // The profile often loads after the scene starts, so the first hello can go
  // out without a name. Say hello again once it's known.
  let greetedAs = myName()
  let hereClock = 0
  let dailyClock = 0
  let waited = 0
  engine.addSystem((dt) => {
    if (greetedAs === '') {
      const name = myName()
      if (name !== '') {
        greetedAs = name
        greet()
      }
    }

    hereClock += dt
    if (hereClock >= HERE_SECONDS) {
      hereClock = 0
      void room.send('here', { n: 1 })
    }

    // Count the daily bonus down, and say hello again when it's due so it pays
    if (profile.ready && profile.dailyIn > 0) {
      dailyClock += dt
      if (dailyClock >= 1) {
        profile.dailyIn = Math.max(0, profile.dailyIn - Math.floor(dailyClock))
        dailyClock -= Math.floor(dailyClock)
        if (profile.dailyIn === 0) greet()
      }
    }

    if (!profile.ready && waited >= 0) {
      waited += dt
      if (waited > 12) {
        waited = -1
        console.log(
          '[ledger] No answer from the Multiplayer Server after 12s. XP, Pixel Points, the hot target and the ' +
            'leaderboards all need it. Check scene.json has "authoritativeMultiplayer": true.'
        )
      }
    }
  })
}

/** Exposed for the HUD: the hot target length, so a bar can show how long is left. */
export const HOT_SECONDS = HOT.seconds
