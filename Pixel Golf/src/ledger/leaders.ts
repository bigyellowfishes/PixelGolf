import { Storage } from '@dcl/sdk/server'

import { Period, PERIODS, periodKey } from './rules'
import { currentEpoch, epochKey, epochReady } from './epoch'

/**
 * The leaderboards, on the server.
 *
 * Four periods (daily, weekly, monthly, all-time), each with two boards:
 *   true   ranked by True Score: base points with hot targets doubled, no multiplier
 *   multi  ranked by Multiplier score: the True Score times the round's roll
 *
 * Each row is a player's best single round in that period. A player holds one
 * row per board however many rounds they play.
 *
 * Kept in scene storage as one document, because player storage is addressed
 * by wallet and the server has no list of every wallet to sort. So the boards
 * are maintained rather than computed: each finished round is offered to every
 * board and a board keeps the best it has seen. A period that has moved on (a
 * new UTC day, a new Monday, a new month) is emptied the next time anything
 * touches the boards, so nothing has to run at midnight.
 *
 * Scores are the server's own. A client can only send a round, which the
 * ledger checks; it can't post a figure here. The name beside a score is the
 * client's word for itself, tidied but not verified.
 */

export type Entry = {
  /** Wallet, so a player replaces their own row. */
  who: string
  /** Display name. */
  n: string
  /** The score being ranked. */
  v: number
}

type Board = { key: string; true: Entry[]; multi: Entry[] }
type Tables = Record<Period, Board>

/** Rows kept per board. More than are shown, so a player can see their rank. */
const MAX_ROWS = 100
/** Rows broadcast per board. */
const SHOW_ROWS = 10
/** Longest name that fits on a board. */
const MAX_NAME = 18

// Bumped from 'pg-leaders' on 2026-10-12 to give everyone a fresh ledger for tutorial testing
const KEY = 'pg-leaders2'

const blankBoard = (period: Period): Board => ({ key: periodKey(period), true: [], multi: [] })
const blank = (): Tables => ({
  day: blankBoard('day'),
  week: blankBoard('week'),
  month: blankBoard('month'),
  all: blankBoard('all')
})

let tables: Tables = blank()
let loaded = false
let dirty = false

/** A client-supplied name made safe to draw on a board. */
export function tidyName(raw: string, address: string): string {
  let name = (raw || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (name.length > MAX_NAME) name = name.slice(0, MAX_NAME - 1).trimEnd() + '…'
  if (name.length === 0) name = address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
  return name
}

/** Empties any board whose period has moved on. */
function freshen(): void {
  for (const p of PERIODS) {
    const key = periodKey(p)
    if (tables[p].key === key) continue
    tables[p] = { key, true: [], multi: [] }
    dirty = true
  }
}

/** Puts one score on one board, replacing the player's own row if it's better. */
function offer(rows: Entry[], who: string, name: string, value: number): boolean {
  const at = rows.findIndex((e) => e.who === who)
  if (at >= 0) {
    const row = rows[at]
    if (value <= row.v && row.n === name) return false
    if (value > row.v) row.v = value
    row.n = name
    sort(rows)
    return true
  }
  // Not on the board yet. They may still not be once it's cut to length.
  if (rows.length >= MAX_ROWS && value <= rows[rows.length - 1].v) return false
  rows.push({ who, n: name, v: value })
  sort(rows)
  return true
}

function sort(rows: Entry[]): void {
  rows.sort((a, b) => b.v - a.v)
  if (rows.length > MAX_ROWS) rows.length = MAX_ROWS
}

/** A finished round, offered to all eight boards. */
export function noteRound(who: string, name: string, trueScore: number, multiScore: number): void {
  freshen()
  for (const p of PERIODS) {
    if (trueScore > 0 && offer(tables[p].true, who, name, trueScore)) dirty = true
    if (multiScore > 0 && offer(tables[p].multi, who, name, multiScore)) dirty = true
  }
}

/** A player changed their name: rename their rows wherever they are. */
export function renameEverywhere(who: string, name: string): void {
  for (const p of PERIODS) {
    for (const rows of [tables[p].true, tables[p].multi]) {
      const row = rows.find((e) => e.who === who)
      if (row && row.n !== name) {
        row.n = name
        dirty = true
      }
    }
  }
}

/**
 * The boards as sent to everyone: the top rows of each, with the wallet so the
 * scene can mark the player's own row.
 * { day: { key, true: [{n, v, u}], multi: [...] }, week: ..., month: ..., all: ... }
 */
export function leaderJson(): string {
  freshen()
  const out: Record<string, unknown> = {}
  const rows = (t: Entry[]) => t.slice(0, SHOW_ROWS).map((e) => ({ n: e.n, v: e.v, u: e.who }))
  for (const p of PERIODS) out[p] = { key: tables[p].key, true: rows(tables[p].true), multi: rows(tables[p].multi) }
  return JSON.stringify(out)
}

/**
 * Where one player sits on every board: 0 means not on it (yet).
 * { day: { true: rank, trueV: score, multi: rank, multiV: score }, ... }
 */
export function ranksFor(who: string): string {
  freshen()
  const out: Record<string, unknown> = {}
  for (const p of PERIODS) {
    const t = tables[p].true.findIndex((e) => e.who === who)
    const m = tables[p].multi.findIndex((e) => e.who === who)
    out[p] = {
      true: t + 1,
      trueV: t >= 0 ? tables[p].true[t].v : 0,
      multi: m + 1,
      multiV: m >= 0 ? tables[p].multi[m].v : 0
    }
  }
  return JSON.stringify(out)
}

export function leadersChanged(): boolean {
  freshen()
  return dirty
}

/** Writes the boards out if they've changed. Called on a timer, not per round. */
export async function saveLeaders(): Promise<void> {
  if (!loaded || !dirty) return
  dirty = false
  try {
    // Each reset (epoch.ts) has its own key, so a save still in flight from before one can't bring old boards back
    await Storage.set(epochKey(KEY), tables)
  } catch (e) {
    console.log(`[ledger] leaderboard save failed: ${e}`)
    dirty = true
  }
}

/** Empties all eight boards (an admin reset). Saved on the next save. */
export function resetLeaders(): void {
  tables = blank()
  loaded = true
  dirty = true
}

/** Reads the boards from the last run. Called once at startup. */
export async function loadLeaders(): Promise<void> {
  try {
    await epochReady()
    const epochAtRead = currentEpoch()
    const stored = await Storage.get<Tables>(epochKey(KEY))
    // Skipped if an admin reset happened while we were reading: the boards are already blank
    if (stored && currentEpoch() === epochAtRead) {
      const fresh = blank()
      for (const p of PERIODS) {
        const b = stored[p]
        if (b && typeof b.key === 'string') {
          fresh[p] = { key: b.key, true: Array.isArray(b.true) ? b.true : [], multi: Array.isArray(b.multi) ? b.multi : [] }
        }
      }
      // Rounds finished while the read was in flight go on top of what was stored
      const early = tables
      tables = fresh
      freshen()
      for (const p of PERIODS) {
        if (early[p].key !== tables[p].key) continue
        for (const e of early[p].true) offer(tables[p].true, e.who, e.n, e.v)
        for (const e of early[p].multi) offer(tables[p].multi, e.who, e.n, e.v)
      }
    }
  } catch (e) {
    console.log(`[ledger] leaderboard load failed, starting empty: ${e}`)
    tables = blank()
  }
  loaded = true
  freshen()
  console.log(`[ledger] leaderboards loaded: ${tables.all.true.length} on the all-time board`)
}
