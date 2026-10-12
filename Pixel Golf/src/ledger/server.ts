import { engine } from '@dcl/sdk/ecs'
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
  validBall,
  isAdminWallet,
  RESET_CONFIRM,
  TUTORIAL_LEVEL,
  xpToReach
} from './rules'
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
}

/** Wallet records. Bumped from 'pg' on 2026-10-12 to give everyone a fresh ledger for tutorial testing. */
const STORAGE_KEY = 'pg2'

/** The bay reserved for the tutorial. Keep equal to TUTORIAL_BAY in ledger/client.ts. */
const TUTORIAL_BAY = 19

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

function sendRange(to?: string): void {
  const data = { hot, seconds: Math.max(0, Math.ceil(hotLeft)), players: present() }
  if (to) void room.send('range', data, { to: [to] })
  else void room.send('range', data)
}

// ---------------------------------------------------------------------------
// Bays: one player per bay
// ---------------------------------------------------------------------------

/** Bay number -> wallet of the player in it. */
const bayOwners = new Map<number, string>()

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

/** Lets go of the bays of anyone who has left the space. True if any changed. */
function releaseAbsentBays(): boolean {
  let changed = false
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
  // Hot target
  hotLeft -= dt
  if (hotLeft <= 0) {
    rotateHot()
    sendRange()
  }

  // Player count: tell everyone when it changes, so the multiplier ceiling on screen is right
  sincePresence += dt
  if (sincePresence >= 5) {
    sincePresence = 0
    const players = present()
    if (players !== lastPlayers) {
      lastPlayers = players
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
      players: present(),
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

    sendLedger(address, wallet)
    sendRange(address)
    sendBays(address)
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
    // One bay each: claiming this one lets any other go
    for (const [b, who] of bayOwners) if (who === address) bayOwners.delete(b)
    bayOwners.set(bay, address)
    sendBays()
  })

  // Shots are passed on to everyone so they can watch them, but only from the player in that bay
  room.onMessage('shot', (data, context) => {
    const address = context?.from
    if (!address || bayOwners.get(data.bay) !== address) return
    const ok = (n: number) => Number.isFinite(n) && Math.abs(n) < 500
    if (!ok(data.vx) || !ok(data.vy) || !ok(data.vz)) return
    void room.send('shotSeen', { bay: data.bay, vx: data.vx, vy: data.vy, vz: data.vz })
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

  room.onMessage('here', (_data, context) => {
    const address = context?.from
    if (address) seen.set(address, now())
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

    // The shared multiplier: a roll from 2x to the number of players in the space
    const players = Math.max(1, present())
    const r = roll(MULTIPLIER.floor, multiplierCeiling(players))
    const multiScore = trueScore > 0 ? trueScore * r : trueScore

    let points = POINTS.roundComplete + Math.floor(Math.max(0, trueScore) / POINTS.perScore)
    const personalBest = trueScore > 0 && trueScore > wallet.best
    if (personalBest) {
      wallet.best = trueScore
      xp += XP.personalBest
      points += POINTS.personalBest
    }
    if (multiScore > wallet.bestMulti) wallet.bestMulti = multiScore

    giveXp(wallet, xp)
    pay(wallet, points)
    wallet.rounds++
    wallet.lastRound = t
    if (isWallet(address)) noteRound(address, wallet.name || tidyName('', address), trueScore, multiScore)
    touch(address, wallet)

    void room.send(
      'roundResult',
      { trueScore, roll: r, players, multiScore, hotHits, xp, points, personalBest, counted: true, reason: '' },
      { to: [address] }
    )
    if (r >= MULTIPLIER.shoutAt) {
      void room.send('rolled', { name: wallet.name || tidyName('', address), roll: r, score: multiScore })
    }
    sendLedger(address, wallet)
    sendRanks(address)
    console.log(`[ledger] round ${address}: ${trueScore} x${r} (${players} here), +${xp} XP, +${points} PP`)
  })

  room.onMessage('afk', async (_data, context) => {
    const address = context?.from
    if (!address || !canEarn(address)) return
    seen.set(address, now())
    const wallet = await load(address)
    const t = now()
    if (t - wallet.lastAfk < LEDGER.afkMinSeconds) return
    wallet.lastAfk = t
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
