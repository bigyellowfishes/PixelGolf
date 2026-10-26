import { engine, Name, Transform } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'

import { room } from './room'
import {
  CATALOGUE,
  DEFAULT_EQUIPPED,
  HOT,
  MULTIPLIER,
  POINTS,
  ROUND_BALLS,
  BAY_COUNT,
  XP,
  ballXp,
  itemById,
  levelFor,
  multiplierCeiling,
  multiplierFloor,
  validBall,
  isAdminWallet,
  RESET_CONFIRM,
  TUTORIAL_LEVEL,
  xpToReach
} from './rules'
import { WIND, windVector } from './rules'
import {
  leaderJson,
  leadersChanged,
  loadLeaders,
  noteRound,
  ranksFor,
  renameEverywhere,
  resetLeaders,
  saveLeaders,
  tidyName
} from './leaders'
import { bumpEpoch, currentEpoch, epochKey, epochReady } from './epoch'
import { encodePath, sanitiseLaunch, simulateShot, outOfRange, warmUpBallSim, pathEnd, Vec3 } from '../ballSim'

/**
 * The Pixel Golf ledger. Runs only on the Multiplayer Server (see main() in
 * index.ts), never in a player's client.
 *
 * It keeps, per wallet, in Storage.player:
 *   XP and level, Pixel Points, best rounds, rounds played, the daily login
 *   bonus clock, owned and equipped cosmetics, and the Settings switches.
 * And for everyone, in scene Storage:
 *   the eight leaderboards (leaders.ts).
 * And it runs the range for everyone:
 *   the hot target rotation, the player count, and the multiplier rolls.
 *
 * What it can and can't promise: the server owns every number that is paid.
 * The scene sends a round's results, never a payment. The golf runs in the
 * player's client, so the server can't see the ball fly; it checks every ball
 * is a possible result, that hot hits were on a target that was really hot,
 * and that rounds can't be posted faster than they can be played.
 *
 * Shots in the shared bays are simulated here, once (shotAsk below, ballSim.ts),
 * and the keyframes go to everyone, so every screen sees the same ball.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const LEDGER = {
  /**
   * Whether a guest (no wallet) can earn. On so the whole loop works in a
   * preview. Their progress is marked not durable and they never go on the
   * boards, since a guest's address changes between visits.
   */
  allowGuests: true,
  /** A round can't be posted sooner than this after the last one. */
  roundCooldownSeconds: 60,
  /** A hot hit counts if that target was hot within this long. */
  hotGraceSeconds: 15 * 60,
  /** A player counts as in the space for this long after their last 'here'. */
  presenceSeconds: 50,
  /** AFK minutes are paid no faster than this. */
  afkMinSeconds: 55
}

// ---------------------------------------------------------------------------
// Wallets
// ---------------------------------------------------------------------------

type Wallet = {
  name: string
  /** Total XP ever. The level is read off this. */
  xp: number
  /** The level they were last told about, to spot a level-up. -1 = not seeded. */
  level: number
  /** Pixel Points to spend. */
  points: number
  /** Pixel Points ever earned. Never goes down. */
  pointsEarned: number
  best: number
  bestMulti: number
  rounds: number
  // Tutorial Complete
  tutorial: boolean
  /** Epoch seconds of the last posted round, for the cooldown. */
  lastRound: number
  /** Epoch seconds the daily login bonus was last collected. */
  lastDaily: number
  /** Epoch seconds of the last paid AFK minute. */
  lastAfk: number
  /** Cosmetics bought. Free ones aren't listed; they come with the level. */
  owned: string[]
  equipped: Record<string, string>
  settings: Record<string, boolean>
  /** The Player Stats page (added 2026-10-26). Counted from then on: older rounds aren't in it. */
  stats?: Stats
}

/**
 * A player's running stats for the Player Stats page in the Pixel Golf menu. Worked out here from
 * what the server already checks, never sent in by the player's screen:
 *   - from each posted round: balls, target hits by colour, misses, bunkers, hot hits, best
 *     single shot, total score (for the average), perfect rounds, the multiplier rolls
 *   - from each shot the server simulates (the shared bays, not the tutorial or the solo bay,
 *     which play on the player's own screen): the longest shot and how often each club is used
 *   - from hello: the daily login streak
 *   - from the 20 second 'here' heartbeat: time on the range
 *   - from the AFK practice payouts: AFK minutes
 */
type Stats = {
  /** Epoch seconds these stats started counting */
  since: number
  rounds: number
  balls: number
  misses: number
  bunkers: number
  /** Target hits by colour: Red, Yellow, Green, Orange, Blue, White, Black */
  hits: Record<string, number>
  hotHits: number
  /** Best single ball's points (with the hot target doubling) and where it landed */
  bestShot: number
  bestShotZone: string
  /** True Score of every round counted, for the average */
  totalScore: number
  /** Rounds with all ten balls on a target */
  perfect: number
  biggestRoll: number
  /** Multiplier rolls of 5x or more */
  bigRolls: number
  /** Longest shot, tee to where the ball stopped (metres), and the club */
  longest: number
  longestClub: string
  /** Shots by club */
  clubs: Record<string, number>
  /** Daily login streak (days in a row), the best one, and the UTC day number last seen */
  streak: number
  bestStreak: number
  lastDay: number
  playSeconds: number
  afkMinutes: number
}

const emptyStats = (): Stats => ({
  since: Math.floor(Date.now() / 1000),
  rounds: 0,
  balls: 0,
  misses: 0,
  bunkers: 0,
  hits: {},
  hotHits: 0,
  bestShot: 0,
  bestShotZone: '',
  totalScore: 0,
  perfect: 0,
  biggestRoll: 0,
  bigRolls: 0,
  longest: 0,
  longestClub: '',
  clubs: {},
  streak: 0,
  bestStreak: 0,
  lastDay: 0,
  playSeconds: 0,
  afkMinutes: 0
})

/** A wallet's stats, created (or filled out with any newer fields) the first time they're needed */
function statsOf(wallet: Wallet): Stats {
  wallet.stats = { ...emptyStats(), ...(wallet.stats ?? {}) }
  return wallet.stats
}

function sendStats(address: string, wallet: Wallet): void {
  void room.send('myStats', { json: JSON.stringify(statsOf(wallet)) }, { to: [address] })
}

/** Wallet records. Bumped from 'pg' on 2026-10-12 to give everyone a fresh ledger for tutorial testing. */
const STORAGE_KEY = 'pg2'

/** The bay reserved for the tutorial. Keep equal to TUTORIAL_BAY in ledger/client.ts. */
const TUTORIAL_BAY = 19
/** The solo bay: any number of players at once, never owned by one. Keep equal to SOLO_BAY in ledger/client.ts. */
const SOLO_BAY = 20

const empty = (): Wallet => ({
  name: '',
  xp: 0,
  level: -1,
  points: 0,
  pointsEarned: 0,
  best: 0,
  bestMulti: 0,
  rounds: 0,
  tutorial: false,
  lastRound: 0,
  lastDaily: 0,
  lastAfk: 0,
  owned: [],
  equipped: { ...DEFAULT_EQUIPPED },
  settings: {}
})

const now = () => Math.floor(Date.now() / 1000)

function isWallet(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address)
}

function canEarn(address: string): boolean {
  return isWallet(address) || LEDGER.allowGuests
}

/** The only thing that adds Pixel Points. Earned points always move both totals. */
function pay(wallet: Wallet, points: number): void {
  if (points <= 0) return
  wallet.points += points
  wallet.pointsEarned += points
}

/** The only thing that adds XP. */
function giveXp(wallet: Wallet, xp: number): void {
  if (xp > 0) wallet.xp += xp
}

// ---------------------------------------------------------------------------
// Cache and writes
// ---------------------------------------------------------------------------

const cache = new Map<string, Wallet>()
const dirty = new Set<string>()

async function load(address: string): Promise<Wallet> {
  const held = cache.get(address)
  if (held) return held
  await epochReady()
  const epochAtRead = currentEpoch()
  let stored: Wallet | null | undefined
  try {
    // Each reset (epoch.ts) reads and writes under its own key, so records from before it are never seen
    stored = await Storage.player.get<Wallet>(address, epochKey(STORAGE_KEY))
  } catch (e) {
    console.log(`[ledger] read failed for ${address}: ${e}`)
  }
  // An admin reset happened while we were reading: what came back is from before it
  if (currentEpoch() !== epochAtRead) return load(address)
  // A second message may have loaded it while we waited
  const raced = cache.get(address)
  if (raced) return raced
  const wallet: Wallet = stored ? { ...empty(), ...stored } : empty()
  if (!wallet.equipped) wallet.equipped = { ...DEFAULT_EQUIPPED }
  // Where they stand before anything changes, so their first level-up isn't swallowed
  if (wallet.level < 0) wallet.level = levelFor(wallet.xp)
  cache.set(address, wallet)
  return wallet
}

/** Marks a wallet to be written on the next flush, and checks for a level-up. */
function touch(address: string, wallet: Wallet): void {
  dirty.add(address)
  checkLevel(address, wallet)
}

function checkLevel(address: string, wallet: Wallet): void {
  const level = levelFor(wallet.xp)
  if (level <= wallet.level) return
  const from = wallet.level
  wallet.level = level
  const unlocked = CATALOGUE.filter((i) => i.level > from && i.level <= level).map((i) => i.name)
  void room.send('levelUp', { level, gained: level - from, unlocked: JSON.stringify(unlocked) }, { to: [address] })
}

// ---------------------------------------------------------------------------
// The range: presence, hot target, multiplier
// ---------------------------------------------------------------------------

/** Wallet -> epoch seconds last heard from. */
const seen = new Map<string, number>()
let lastPlayers = 0

function present(): number {
  const cutoff = now() - LEDGER.presenceSeconds
  let n = 0
  for (const [who, at] of seen) {
    if (at >= cutoff) n++
    else seen.delete(who)
  }
  return n
}

// Dev panel (admin only): pretend extra players, and holds on the hot target and the wind
let fakePlayers = 0
let hotHold = false
let windHold = false

/** Players in the space for the multiplier: the real ones plus any pretend ones from the dev panel. */
function players(): number {
  return present() + fakePlayers
}

function sendDevState(to?: string): void {
  const data = { json: JSON.stringify({ extra: fakePlayers, hotHold, windHold }) }
  if (to) void room.send('devState', data, { to: [to] })
  else void room.send('devState', data)
}

let hot = HOT.targets[Math.floor(Math.random() * HOT.targets.length)]
let hotLeft = HOT.seconds
/** Every target that has been hot recently, and until when. */
const hotHistory: { zone: string; until: number }[] = []

function rotateHot(): void {
  hotHistory.push({ zone: hot, until: now() + 2 })
  const cutoff = now() - LEDGER.hotGraceSeconds
  while (hotHistory.length && hotHistory[0].until < cutoff) hotHistory.shift()
  let next = hot
  while (next === hot && HOT.targets.length > 1) next = HOT.targets[Math.floor(Math.random() * HOT.targets.length)]
  hot = next
  hotLeft = HOT.seconds
}

function wasHot(zone: string): boolean {
  if (zone === hot) return true
  const cutoff = now() - LEDGER.hotGraceSeconds
  return hotHistory.some((h) => h.zone === zone && h.until >= cutoff)
}

// The wind: one for the whole range, so every shot simulated here uses it (WIND in rules.ts)
let windDir = Math.random() * 360
let windSpeed = WIND.minSpeed + Math.random() * (WIND.maxSpeed - WIND.minSpeed)
let windLeft = WIND.seconds

function changeWind(): void {
  windDir = (windDir + (Math.random() * 2 - 1) * WIND.maxTurn + 360) % 360
  windSpeed = WIND.minSpeed + Math.random() * (WIND.maxSpeed - WIND.minSpeed)
  windLeft = WIND.seconds
}

function sendWind(to?: string): void {
  const data = { dir: Math.round(windDir * 10) / 10, speed: Math.round(windSpeed * 10) / 10, seconds: Math.max(0, Math.ceil(windLeft)) }
  if (to) void room.send('wind', data, { to: [to] })
  else void room.send('wind', data)
}

// Each player's equipped ball (wallet -> ball id), so everyone sees it in that player's bay.
// Only players with something other than the standard ball are listed.
const ballLooks = new Map<string, string>()

/** Notes a player's equipped ball. True if that changed what everyone should see. */
function noteBall(address: string, wallet: Wallet): boolean {
  const id = wallet.equipped?.ball || DEFAULT_EQUIPPED.ball
  const before = ballLooks.get(address)
  if (id === DEFAULT_EQUIPPED.ball) {
    if (before === undefined) return false
    ballLooks.delete(address)
    return true
  }
  if (before === id) return false
  ballLooks.set(address, id)
  return true
}

function sendBallLooks(to?: string): void {
  const looks: Record<string, string> = {}
  for (const [who, id] of ballLooks) looks[who] = id
  const data = { json: JSON.stringify(looks) }
  if (to) void room.send('ballLooks', data, { to: [to] })
  else void room.send('ballLooks', data)
}

function sendRange(to?: string): void {
  const data = { hot, seconds: Math.max(0, Math.ceil(hotLeft)), players: players() }
  if (to) void room.send('range', data, { to: [to] })
  else void room.send('range', data)
}

// ---------------------------------------------------------------------------
// Bays: one player per bay
// ---------------------------------------------------------------------------

/** Bay number -> wallet of the player in it. */
const bayOwners = new Map<number, string>()
/** Everyone playing in the solo bay. Not in bayOwners: it has no one owner. */
const soloPlayers = new Set<string>()

/** Everyone's club, as they last said (clubState), so a newcomer sees the clubs already out. */
type ClubShown = { type: string; show: boolean; swing: boolean }
const clubs = new Map<string, ClubShown>()
const CLUB_IDS = ['wedge', 'iron', 'driver']

function sendClub(u: string, c: ClubShown, to?: string): void {
  const data = { u, type: c.type, show: c.show, swing: c.swing }
  if (to) void room.send('clubSeen', data, { to: [to] })
  else void room.send('clubSeen', data)
}

function sendSolo(to?: string): void {
  const json = JSON.stringify(Array.from(soloPlayers))
  if (to) void room.send('soloPlayers', { json }, { to: [to] })
  else void room.send('soloPlayers', { json })
}

/** Takes a player out of the solo bay. True if they were in it. */
function leaveSoloBay(address: string): boolean {
  return soloPlayers.delete(address)
}

function isPresent(address: string): boolean {
  return (seen.get(address) ?? 0) >= now() - LEDGER.presenceSeconds
}

function baysJson(): string {
  const out: Record<string, { u: string; n: string }> = {}
  for (const [bay, who] of bayOwners) out[String(bay)] = { u: who, n: cache.get(who)?.name || tidyName('', who) }
  return JSON.stringify(out)
}

function sendBays(to?: string): void {
  if (to) void room.send('bays', { json: baysJson() }, { to: [to] })
  else void room.send('bays', { json: baysJson() })
}

// ---------------------------------------------------------------------------
// Shots: simulated here for the shared bays (see shotAsk)
// ---------------------------------------------------------------------------

/** A swing takes well over a second, so asks closer together than this are refused. */
const SHOT_MIN_GAP_MS = 1000
const lastShotAsk = new Map<string, number>()
let simCount = 0
let simMs = 0

/** Each bay's tee, from the scene's Ball_N entities, read the first time a shot is asked for. */
let tees: Map<number, Vec3> | undefined

/**
 * Where a bay's ball sits. The server's own copy of the scene when it has one, else the
 * position the player sent, as long as it's a real number inside the range.
 */
function teeFor(bay: number, sent: Vec3): Vec3 | null {
  if (!tees) {
    tees = new Map()
    for (const [, name, t] of engine.getEntitiesWith(Name, Transform)) {
      const m = /^Ball_(\d+)$/.exec(name.value)
      if (m) tees.set(Number(m[1]), { x: t.position.x, y: t.position.y, z: t.position.z })
    }
    console.log(`[ledger] ${tees.size} tees found in the scene for shot simulation`)
  }
  const own = tees.get(bay)
  if (own) return own
  if (![sent.x, sent.y, sent.z].every((n) => Number.isFinite(n))) return null
  if (outOfRange(sent.x, sent.y, sent.z)) return null
  return sent
}

/** Lets go of the bays of anyone who has left the space. True if any changed. */
function releaseAbsentBays(): boolean {
  let changed = false
  let soloChanged = false
  for (const who of soloPlayers) {
    if (!isPresent(who)) {
      soloPlayers.delete(who)
      soloChanged = true
    }
  }
  if (soloChanged) sendSolo()
  // Players who've left put their club away for everyone
  for (const [who, c] of clubs) {
    if (!isPresent(who)) {
      clubs.delete(who)
      if (c.show) sendClub(who, { ...c, show: false, swing: false })
    }
  }
  for (const [bay, who] of bayOwners) {
    if (!isPresent(who)) {
      bayOwners.delete(bay)
      changed = true
    }
  }
  return changed
}

/** A random whole number from lo to hi, both included. */
function roll(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

let sinceFlush = 0
const FLUSH_SECONDS = 10
let sinceBoard = 0
const BOARD_SECONDS = 15
let sincePresence = 0

function ledgerSystem(dt: number): void {
  // Wind (held still from the dev panel: no countdown)
  if (!windHold) windLeft -= dt
  if (windLeft <= 0) {
    changeWind()
    sendWind()
  }

  // Hot target (held from the dev panel: no countdown)
  if (!hotHold) hotLeft -= dt
  if (hotLeft <= 0) {
    rotateHot()
    sendRange()
  }

  // Player count: tell everyone when it changes, so the multiplier ceiling on screen is right
  sincePresence += dt
  if (sincePresence >= 5) {
    sincePresence = 0
    const count = players()
    if (count !== lastPlayers) {
      lastPlayers = count
      sendRange()
    }
    if (releaseAbsentBays()) sendBays()
  }

  // Leaderboards
  sinceBoard += dt
  if (sinceBoard >= BOARD_SECONDS) {
    sinceBoard = 0
    if (leadersChanged()) {
      void saveLeaders()
      void room.send('leaders', { json: leaderJson() })
    }
  }

  // Wallets
  sinceFlush += dt
  if (sinceFlush < FLUSH_SECONDS || dirty.size === 0) return
  sinceFlush = 0
  for (const address of dirty) {
    const wallet = cache.get(address)
    if (wallet) void Storage.player.set(address, epochKey(STORAGE_KEY), wallet)
  }
  dirty.clear()
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Bought, plus everything free that their level has unlocked. */
function ownedIds(wallet: Wallet): string[] {
  const level = levelFor(wallet.xp)
  const free = CATALOGUE.filter((i) => i.price <= 0 && i.level <= level).map((i) => i.id)
  return Array.from(new Set([...free, ...wallet.owned]))
}

function dailyIn(wallet: Wallet): number {
  return Math.max(0, wallet.lastDaily + XP.dailyHours * 3600 - now())
}

function sendLedger(address: string, wallet: Wallet): void {
  void room.send(
    'ledger',
    {
      xp: wallet.xp,
      points: wallet.points,
      pointsEarned: wallet.pointsEarned,
      best: wallet.best,
      bestMulti: wallet.bestMulti,
      rounds: wallet.rounds,
      owned: JSON.stringify(ownedIds(wallet)),
      equipped: JSON.stringify(wallet.equipped),
      dailyIn: dailyIn(wallet),
      durable: isWallet(address)
    },
    { to: [address] }
  )
  void room.send('mySettings', { json: JSON.stringify(wallet.settings) }, { to: [address] })
  void room.send('tutorial', { done: wallet.tutorial }, { to: [address] })
}

function sendRanks(address: string): void {
  if (isWallet(address)) void room.send('myRanks', { json: ranksFor(address) }, { to: [address] })
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

type Ball = { z: string; p: number; h: number }

function readBalls(json: string): Ball[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!Array.isArray(raw) || raw.length !== ROUND_BALLS) return null
  const balls: Ball[] = []
  for (const b of raw) {
    if (!b || typeof b !== 'object') return null
    const z = typeof b.z === 'string' ? b.z : ''
    const p = Number(b.p)
    const h = b.h ? 1 : 0
    if (!validBall(z, p)) return null
    // Only a target that can light up, and was lit, can be a hot hit
    if (h && (HOT.targets.indexOf(z) < 0 || !wasHot(z))) return null
    balls.push({ z, p, h })
  }
  return balls
}

function notCounted(address: string, reason: string): void {
  void room.send(
    'roundResult',
    {
      trueScore: 0,
      roll: 0,
      players: players(),
      multiScore: 0,
      hotHits: 0,
      xp: 0,
      points: 0,
      personalBest: false,
      counted: false,
      reason
    },
    { to: [address] }
  )
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Starts the ledger. Called from main() only on the Multiplayer Server. */
export function runLedger(): void {
  engine.addSystem(ledgerSystem)
  void loadLeaders()
  // Build the course collision now, so the first shot isn't kept waiting for it
  warmUpBallSim()
  console.log('[ledger] running')

  room.onMessage('hello', async (data, context) => {
    const address = context?.from
    if (!address) return
    seen.set(address, now())
    const wallet = await load(address)

    const name = tidyName(data.name ?? '', address)
    if (name !== wallet.name) {
      wallet.name = name
      renameEverywhere(address, name)
      touch(address, wallet)
    }

    // Anyone who played before the tutorial existed has already learned the game
    if (!wallet.tutorial && wallet.rounds > 0) {
      wallet.tutorial = true
      touch(address, wallet)
    }

    // The daily login bonus, 24 hours after it was last collected
    if (canEarn(address) && dailyIn(wallet) <= 0) {
      wallet.lastDaily = now()
      giveXp(wallet, XP.dailyLogin)
      pay(wallet, POINTS.dailyLogin)
      touch(address, wallet)
      void room.send('awarded', { xp: XP.dailyLogin, points: POINTS.dailyLogin, reason: 'Daily login bonus' }, { to: [address] })
    }

    // The daily login streak: days in a row they've been here (UTC days)
    if (canEarn(address)) {
      const s = statsOf(wallet)
      const day = Math.floor(now() / 86400)
      if (s.lastDay !== day) {
        s.streak = s.lastDay === day - 1 ? s.streak + 1 : 1
        s.bestStreak = Math.max(s.bestStreak, s.streak)
        s.lastDay = day
        touch(address, wallet)
      }
    }

    sendLedger(address, wallet)
    sendStats(address, wallet)
    sendRange(address)
    sendWind(address)
    sendDevState(address)
    // Everyone's balls for the newcomer, and the newcomer's ball for everyone
    if (noteBall(address, wallet)) sendBallLooks()
    else sendBallLooks(address)
    sendBays(address)
    sendSolo(address)
    for (const [u, c] of clubs) if (c.show) sendClub(u, c, address)
    void room.send('leaders', { json: leaderJson() }, { to: [address] })
    sendRanks(address)
  })

  room.onMessage('claimBay', async (data, context) => {
    const address = context?.from
    if (!address) return
    seen.set(address, now())
    const bay = Math.floor(Number(data.bay))
    if (!(bay >= 1 && bay <= BAY_COUNT)) return
    // The tutorial bay is played privately on each player's own screen, never claimed
    if (bay === TUTORIAL_BAY) {
      void room.send('refused', { reason: `Bay ${bay} is reserved for the tutorial.` }, { to: [address] })
      return
    }
    await load(address) // for their name on the bay list

    // The solo bay takes anyone: joining it lets their own bay go, and nobody is refused
    if (bay === SOLO_BAY) {
      let released = false
      for (const [b, who] of bayOwners) {
        if (who === address) {
          bayOwners.delete(b)
          released = true
        }
      }
      if (released) sendBays()
      if (!soloPlayers.has(address)) {
        soloPlayers.add(address)
        sendSolo()
      }
      return
    }

    const owner = bayOwners.get(bay)
    if (owner === address) {
      sendBays(address)
      return
    }
    if (owner && isPresent(owner)) {
      const name = cache.get(owner)?.name || 'another player'
      void room.send('refused', { reason: `Bay ${bay} is in use by ${name}. Pick a free bay.` }, { to: [address] })
      sendBays(address)
      return
    }
    // One bay each: claiming this one lets any other go, the solo bay included
    for (const [b, who] of bayOwners) if (who === address) bayOwners.delete(b)
    bayOwners.set(bay, address)
    sendBays()
    if (leaveSoloBay(address)) sendSolo()
  })

  // A player's club came out, went away, changed, or moved between carry and swing grip: pass it on
  room.onMessage('clubState', (data, context) => {
    const address = context?.from
    if (!address) return
    seen.set(address, now())
    const type = CLUB_IDS.indexOf(String(data.type)) >= 0 ? String(data.type) : 'iron'
    const c: ClubShown = { type, show: !!data.show, swing: !!data.swing }
    const was = clubs.get(address)
    if (was && was.type === c.type && was.show === c.show && was.swing === c.swing) return
    clubs.set(address, c)
    sendClub(address, c)
  })

  // Walked away from their bay: it's free for anyone straight away
  room.onMessage('leaveBay', (data, context) => {
    const address = context?.from
    if (!address) return
    seen.set(address, now())
    const bay = Math.floor(Number(data.bay))
    if (bayOwners.get(bay) !== address) return
    bayOwners.delete(bay)
    sendBays()
  })

  room.onMessage('leaveSolo', (_data, context) => {
    const address = context?.from
    if (!address) return
    seen.set(address, now())
    if (leaveSoloBay(address)) sendSolo()
  })

  // Shots are passed on to everyone so they can watch them, but only from the player in that bay
  room.onMessage('shot', (data, context) => {
    const address = context?.from
    if (!address || bayOwners.get(data.bay) !== address) return
    const ok = (n: number) => Number.isFinite(n) && Math.abs(n) < 500
    if (!ok(data.vx) || !ok(data.vy) || !ok(data.vz)) return
    void room.send('shotSeen', { bay: data.bay, vx: data.vx, vy: data.vy, vz: data.vz })
  })

  // A shared bay's shot: simulate it once and send the same keyframes to everyone, the
  // shooter included. Only from the player in that bay, and no faster than a swing takes.
  room.onMessage('shotAsk', (data, context) => {
    const address = context?.from
    if (!address) return
    seen.set(address, now())
    const bay = Math.floor(Number(data.bay))
    const id = Math.floor(Number(data.id))
    const no = (reason: string) => void room.send('shotNo', { bay, id, reason }, { to: [address] })

    if (bay === TUTORIAL_BAY || bay === SOLO_BAY) return no('That bay plays on your own screen.')
    if (bayOwners.get(bay) !== address) return no(`Bay ${bay} isn't yours.`)
    const at = Date.now()
    if (at - (lastShotAsk.get(address) ?? 0) < SHOT_MIN_GAP_MS) return no('Too soon after your last shot.')
    const launch = sanitiseLaunch({ x: data.vx, y: data.vy, z: data.vz })
    const start = teeFor(bay, { x: data.sx, y: data.sy, z: data.sz })
    if (!launch || !start) return no('That shot could not be simulated.')
    lastShotAsk.set(address, at)

    // The same rounded wind every screen was sent, so a shot played locally would match
    const path = simulateShot(start, launch, undefined, windVector(Math.round(windDir * 10) / 10, Math.round(windSpeed * 10) / 10))
    const payload = encodePath(path)
    void room.send('shotPath', { bay, id, u: address, data: payload })

    // Player stats: the club used, and the longest shot (tee to where it stopped, on the range)
    if (canEarn(address)) {
      const club = clubs.get(address)?.type ?? 'iron'
      const end = pathEnd(path)
      const far = Math.round(Math.hypot(end.x - start.x, end.z - start.z))
      void load(address).then((wallet) => {
        const s = statsOf(wallet)
        s.clubs[club] = (s.clubs[club] ?? 0) + 1
        const longer = !outOfRange(end.x, end.y, end.z) && far > s.longest
        if (longer) {
          s.longest = far
          s.longestClub = club
        }
        touch(address, wallet)
        if (longer) sendStats(address, wallet)
      })
    }
    simCount++
    simMs += Date.now() - at
    if (simCount % 25 === 1) {
      console.log(`[ledger] shot simulated: bay ${bay}, ${Date.now() - at} ms, ${payload.length} bytes (avg ${Math.round(simMs / simCount)} ms over ${simCount})`)
    }
  })

  room.onMessage('shotDone', (data, context) => {
    const address = context?.from
    if (!address || bayOwners.get(data.bay) !== address) return
    void room.send('bayScore', {
      bay: data.bay,
      score: Math.floor(data.score),
      shot: Math.floor(data.shot),
      last: Math.floor(data.last),
      zone: String(data.zone).slice(0, 16),
      hot: !!data.hot
    })
  })

  // The tutorial round is finished: tick it off so it isn't shown again, and level them up to
  // TUTORIAL_LEVEL as the reward (only ever once, since the flag is checked first)
  room.onMessage('tutorialDone', async (_data, context) => {
    const address = context?.from
    if (!address) return
    seen.set(address, now())
    const wallet = await load(address)
    if (wallet.tutorial) return
    wallet.tutorial = true
    const from = levelFor(wallet.xp)
    const xp = canEarn(address) ? Math.max(0, xpToReach(TUTORIAL_LEVEL) - wallet.xp) : 0
    giveXp(wallet, xp)
    touch(address, wallet)
    const level = levelFor(wallet.xp)
    const unlocked = CATALOGUE.filter((i) => i.level > from && i.level <= level).map((i) => i.name)
    void room.send('tutorialReward', { xp, level, unlocked: JSON.stringify(unlocked) }, { to: [address] })
    sendLedger(address, wallet)
  })

  // Dev panel (admin only): the hot target, pretend players, the wind
  const adminOnly = (address: string | undefined): address is string => {
    if (!address) return false
    if (isAdminWallet(address)) return true
    void room.send('refused', { reason: 'Only admins can use the dev panel. Your wallet is not on the admin list.' }, { to: [address] })
    return false
  }
  room.onMessage('adminHot', (data, context) => {
    if (!adminOnly(context?.from)) return
    if (data.zone === '') {
      hotHold = false
      rotateHot()
    } else if (HOT.targets.indexOf(data.zone) >= 0) {
      // Like a normal change, so a ball landing on the old one in the next moment still counts
      hotHistory.push({ zone: hot, until: now() + 2 })
      hot = data.zone
      hotLeft = HOT.seconds
      hotHold = data.hold
    } else return
    console.log(`[ledger] dev: hot target ${hot}${hotHold ? ' (held)' : ''}`)
    sendRange()
    sendDevState()
  })
  room.onMessage('adminPlayers', (data, context) => {
    if (!adminOnly(context?.from)) return
    fakePlayers = Math.max(0, Math.min(100, Math.round(data.extra)))
    lastPlayers = players()
    console.log(`[ledger] dev: ${fakePlayers} pretend players (${lastPlayers} in all)`)
    sendRange()
    sendDevState()
  })
  room.onMessage('adminWind', (data, context) => {
    if (!adminOnly(context?.from)) return
    if (data.speed < 0) {
      windHold = false
      changeWind()
    } else {
      windDir = ((data.dir % 360) + 360) % 360
      windSpeed = Math.min(15, data.speed)
      windLeft = WIND.seconds
      windHold = data.hold
    }
    console.log(`[ledger] dev: wind ${windSpeed.toFixed(1)} m/s to ${windDir.toFixed(0)}${windHold ? ' (held)' : ''}`)
    sendWind()
    sendDevState()
  })

  // Admin only: wipe everyone's progress and the boards (the Reset ledger button in Settings)
  let resetting = false
  room.onMessage('adminReset', async (data, context) => {
    const address = context?.from
    if (!address) return
    if (!isAdminWallet(address)) {
      console.log(`[ledger] reset refused for ${address}: not in ADMIN.wallets`)
      void room.send('refused', { reason: 'Only admins can reset the ledger. Your wallet is not on the admin list.' }, { to: [address] })
      return
    }
    if (data.confirm !== RESET_CONFIRM || resetting) return
    resetting = true
    try {
      if (!(await bumpEpoch())) {
        void room.send('refused', { reason: 'The reset could not be saved. Nothing was changed, try again.' }, { to: [address] })
        return
      }
      // Everything held in memory belongs to the old epoch now
      const by = cache.get(address)?.name || tidyName('', address)
      cache.clear()
      dirty.clear()
      bayOwners.clear()
      soloPlayers.clear()
      sendSolo()
      // Everyone's back to the standard ball
      ballLooks.clear()
      sendBallLooks()
      resetLeaders()
      await saveLeaders()
      console.log(`[ledger] reset by ${by} (${address}), now epoch ${currentEpoch()}`)
      // Every scene clears itself and says hello again, which loads the fresh, empty ledger
      void room.send('ledgerReset', { by })
      void room.send('leaders', { json: leaderJson() })
      sendBays()
    } finally {
      resetting = false
    }
  })

  // Time on the range for Player Stats: the time between heartbeats (every 20 seconds), as long
  // as they came close enough together to mean the player stayed
  const lastHere = new Map<string, number>()
  room.onMessage('here', async (_data, context) => {
    const address = context?.from
    if (!address) return
    const t = now()
    seen.set(address, t)
    const before = lastHere.get(address)
    lastHere.set(address, t)
    if (before === undefined || !canEarn(address)) return
    const gap = t - before
    if (gap <= 0 || gap > 60) return
    const wallet = await load(address)
    statsOf(wallet).playSeconds += gap
    dirty.add(address)
  })

  room.onMessage('round', async (data, context) => {
    const address = context?.from
    if (!address) return
    seen.set(address, now())
    const wallet = await load(address)

    if (!canEarn(address)) return notCounted(address, 'Connect a wallet to keep your progress.')
    const balls = readBalls(data.balls ?? '')
    if (!balls) return notCounted(address, 'That round could not be read.')
    const t = now()
    if (wallet.lastRound && t - wallet.lastRound < LEDGER.roundCooldownSeconds) {
      return notCounted(address, 'Rounds can only be posted once a minute.')
    }

    // True Score: base points, with hot targets doubled
    let trueScore = 0
    let hotHits = 0
    let xp = XP.roundComplete
    for (const b of balls) {
      trueScore += b.h ? b.p * HOT.factor : b.p
      if (b.h) hotHits++
      xp += ballXp(b.z, b.h === 1)
    }

    // The shared multiplier: a whole-number roll from the crowd's minimum (2x, or 5x at 5+
    // players, 10x at 10+, ...) up to the number of players in the space
    const here = Math.max(1, players())
    const lowest = multiplierFloor(here)
    const r = roll(lowest, multiplierCeiling(here))
    const multiScore = trueScore > 0 ? trueScore * r : trueScore

    let points = POINTS.roundComplete + Math.floor(Math.max(0, trueScore) / POINTS.perScore)
    const personalBest = trueScore > 0 && trueScore > wallet.best
    if (personalBest) {
      wallet.best = trueScore
      xp += XP.personalBest
      points += POINTS.personalBest
    }
    if (multiScore > wallet.bestMulti) wallet.bestMulti = multiScore

    // Player stats from the ten balls
    const s = statsOf(wallet)
    s.rounds++
    s.totalScore += Math.max(0, trueScore)
    let onTarget = 0
    for (const b of balls) {
      s.balls++
      const colour = b.z.replace(/\d+$/, '')
      if (b.z === '') s.misses++
      else if (colour === 'Bunker') s.bunkers++
      else {
        s.hits[colour] = (s.hits[colour] ?? 0) + 1
        onTarget++
      }
      if (b.h) s.hotHits++
      const value = b.h ? b.p * HOT.factor : b.p
      if (value > s.bestShot) {
        s.bestShot = value
        s.bestShotZone = colour
      }
    }
    if (onTarget === balls.length) s.perfect++
    s.biggestRoll = Math.max(s.biggestRoll, r)
    if (r >= MULTIPLIER.shoutAt) s.bigRolls++

    giveXp(wallet, xp)
    pay(wallet, points)
    wallet.rounds++
    wallet.lastRound = t
    if (isWallet(address)) noteRound(address, wallet.name || tidyName('', address), trueScore, multiScore)
    touch(address, wallet)

    void room.send(
      'roundResult',
      { trueScore, roll: r, players: here, multiScore, hotHits, xp, points, personalBest, counted: true, reason: '' },
      { to: [address] }
    )
    // Only a lucky roll is news: the crowd's guaranteed minimum would announce every round
    if (r >= MULTIPLIER.shoutAt && r > lowest) {
      void room.send('rolled', { name: wallet.name || tidyName('', address), roll: r, score: multiScore })
    }
    sendLedger(address, wallet)
    sendStats(address, wallet)
    sendRanks(address)
    console.log(`[ledger] round ${address}: ${trueScore} x${r} (${here} here), +${xp} XP, +${points} PP`)
  })

  room.onMessage('afk', async (_data, context) => {
    const address = context?.from
    if (!address || !canEarn(address)) return
    seen.set(address, now())
    const wallet = await load(address)
    const t = now()
    if (t - wallet.lastAfk < LEDGER.afkMinSeconds) return
    wallet.lastAfk = t
    statsOf(wallet).afkMinutes++
    giveXp(wallet, XP.afkPerMinute)
    touch(address, wallet)
    sendLedger(address, wallet)
  })

  room.onMessage('buy', async (data, context) => {
    const address = context?.from
    if (!address) return
    const wallet = await load(address)
    const item = itemById(data.id)
    if (!item) return
    if (ownedIds(wallet).indexOf(item.id) >= 0) return
    if (!canEarn(address)) {
      void room.send('refused', { reason: 'Connect a wallet to keep anything you buy.' }, { to: [address] })
      return
    }
    if (levelFor(wallet.xp) < item.level) {
      void room.send('refused', { reason: `${item.name} unlocks at level ${item.level}.` }, { to: [address] })
      return
    }
    if (wallet.points < item.price) {
      void room.send('refused', { reason: `${item.name} is ${item.price} Pixel Points. You have ${wallet.points}.` }, { to: [address] })
      return
    }
    wallet.points -= item.price
    wallet.owned.push(item.id)
    wallet.equipped[item.kind] = item.id
    touch(address, wallet)
    sendLedger(address, wallet)
    if (noteBall(address, wallet)) sendBallLooks()
  })

  room.onMessage('equip', async (data, context) => {
    const address = context?.from
    if (!address) return
    const wallet = await load(address)
    const item = itemById(data.id)
    if (!item || ownedIds(wallet).indexOf(item.id) < 0) return
    if (wallet.equipped[item.kind] === item.id) return
    wallet.equipped[item.kind] = item.id
    touch(address, wallet)
    sendLedger(address, wallet)
    if (noteBall(address, wallet)) sendBallLooks()
  })

  room.onMessage('settings', async (data, context) => {
    const address = context?.from
    if (!address || !data.key) return
    const wallet = await load(address)
    if (wallet.settings[data.key] === data.on) return
    wallet.settings[data.key] = data.on
    touch(address, wallet)
  })
}
