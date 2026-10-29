import { HOT } from './ledger/rules'

// The shot feed: little notices that pop up at the top of the screen when anyone in the range
// plays a great shot or a bad one (ui/ShotFeed.tsx draws them).
//
//   great: the hot target (2X), or the hardest targets, White and Black
//   bad:   a bunker, or a third (and fifth, seventh...) miss in a row
//
// Each notice drops in from the top and fades out at the end (ui/ShotFeed.tsx).
//
// Other players' shots come from the server's bay scores (index.ts), yours from your own game
// (game.ts), so everyone sees everyone's. Nothing from the tutorial. Plain single misses and the
// easier targets aren't posted, so the feed stays worth reading.
//
// The words are the commentator's (the same cheeky voice as voice.ts), picked at random from the
// lists below and never the same line twice in a row. Each line follows the player's name, so it
// starts with what they did. {colour}, {x} (the hot factor), {pts} and {n} (misses) are filled in.

export type FeedItem = { id: number; good: boolean; name: string; text: string; born: number; until: number }

type LineKind = 'hot' | 'big' | 'bunker' | 'misses'

const LINES: Record<LineKind, string[]> = {
  hot: [
    'cashes in the {x}X on {colour}. Unbelievable! +{pts}',
    'with the {x}X on {colour}. Bet you couldn\'t. +{pts}',
    'bags the {x}X on {colour}. Somebody check their clubs. +{pts}',
    'smashes the {x}X on {colour}. Absolute scenes! +{pts}',
    'finds the {x}X on {colour}. Show off. +{pts}'
  ],
  big: [
    'lands it on {colour}. What a shot! +{pts}',
    'drops one on {colour}. Didn\'t know they had it in them. +{pts}',
    'puts it on {colour}. Frame that one. +{pts}',
    'hits {colour}. Somebody\'s been practising. +{pts}'
  ],
  bunker: [
    'found the bunker. Enjoy the beach.',
    'is building sandcastles.',
    'has gone to the seaside. Bring a bucket and spade.',
    'is in the sand. Lovely day for it.'
  ],
  misses: [
    'has missed {n} in a row. Maybe try getting it in the hole.',
    'is {n} misses deep. The targets are the coloured bits.',
    'has missed {n} on the bounce. It\'s not the wind.',
    'has now missed {n}. Have you tried aiming?'
  ]
}
const lastLine: Partial<Record<LineKind, number>> = {}

/** One of the commentator's lines for this kind of shot, with the details filled in */
function line(kind: LineKind, fill: Record<string, string>): string {
  const pool = LINES[kind]
  let i = Math.floor(Math.random() * pool.length)
  if (pool.length > 1 && i === lastLine[kind]) i = (i + 1) % pool.length
  lastLine[kind] = i
  let out = pool[i]
  for (const k in fill) out = out.split(`{${k}}`).join(fill[k])
  return out
}

/** How long a notice stays up (seconds), and the most on screen at once */
const SHOW_SECONDS = 6
const MAX_SHOWN = 3
/** Misses in a row before it's posted, then every this many more */
const MISS_STREAK = 3
const MISS_STREAK_EVERY = 2
/** The hardest targets: landing on these is always posted */
const BIG_TARGETS = ['White', 'Black']

export const feed: { items: FeedItem[] } = { items: [] }

let nextId = 1
const missStreaks = new Map<string, number>()

function fmt(n: number): string {
  const s = String(Math.abs(Math.round(n)))
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ','
    out += s[i]
  }
  return (n < 0 ? '-' : '') + out
}

function post(good: boolean, name: string, text: string): void {
  const now = Date.now()
  feed.items.unshift({ id: nextId++, good, name, text, born: now, until: now + SHOW_SECONDS * 1000 })
  if (feed.items.length > MAX_SHOWN) feed.items.length = MAX_SHOWN
}

/**
 * A finished shot. who: something that stays the same for the player (wallet or bay), name: what
 * to show, zone: where it landed ('' for nothing, 'Red1', 'Bunker2'...), points: what it scored
 * (with the hot target already doubled), hot: whether it hit the hot target.
 */
export function noteShot(who: string, name: string, zone: string, points: number, hot: boolean): void {
  const colour = zone.replace(/\d+$/, '')
  const shown = name || 'Someone'
  if (colour === 'Bunker' || points <= 0) {
    const misses = (missStreaks.get(who) ?? 0) + 1
    missStreaks.set(who, misses)
    if (colour === 'Bunker') post(false, shown, line('bunker', {}))
    else if (misses >= MISS_STREAK && (misses - MISS_STREAK) % MISS_STREAK_EVERY === 0) post(false, shown, line('misses', { n: String(misses) }))
    return
  }
  missStreaks.set(who, 0)
  const fill = { colour, x: String(HOT.factor), pts: fmt(points) }
  if (hot) post(true, shown, line('hot', fill))
  else if (BIG_TARGETS.indexOf(colour) >= 0) post(true, shown, line('big', fill))
}

/** The notices still up, newest first (drops the ones whose time is up). */
export function feedShowing(): FeedItem[] {
  const now = Date.now()
  if (feed.items.length && feed.items[feed.items.length - 1].until <= now) feed.items = feed.items.filter((i) => i.until > now)
  return feed.items
}
