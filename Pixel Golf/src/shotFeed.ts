import { HOT } from './ledger/rules'
import { onSavedSettings, saveSetting } from './ledger/client'

// The shot feed: "Cooer", little tweet-style notices that pop up at the top of the screen when
// anyone in the range plays a great shot or a bad one (ui/NotificationsMenu.tsx draws them).
//
//   great: the hot target (2X), or the hardest targets, White and Black
//   bad:   a bunker, or a third (and fifth, seventh...) miss in a row
//
// Each notice waits its turn in feed.queue, drops in one at a time with a coo, stays a few
// seconds and slides back up. Every notice is also kept in feed.history for the pull-down list.
// "Ignore notifications" in Settings stops them popping up (they still go in the list).
//
// Other players' shots come from the server's bay scores (index.ts), yours from your own game
// (game.ts), so everyone sees everyone's. Nothing from the tutorial. Plain single misses and the
// easier targets aren't posted, so the feed stays worth reading.
//
// The words are tweets: the player posting about their own shot, with their points, in the style
// of the Cooer design (pixelgolfChirps.ts): first person, a nod to @pixelgolf and a #hashtag or
// two (ui/NotificationsMenu.tsx shows #tags and @mentions in blue). Picked at random from the
// lists below, never the same line twice in a row, and only from lines whose {placeholders} all
// have a value: {colour}, {x} (the hot factor), {pts} (the shot's points, with its sign) and {n}
// (misses in a row).

export type FeedItem = {
  id: number
  good: boolean
  /** The player's wallet (for their profile picture), or something else that stays the same for them */
  who: string
  name: string
  text: string
  /** When it was posted (ms) */
  born: number
}

type LineKind = 'hot' | 'big' | 'bunker' | 'misses'

const LINES: Record<LineKind, string[]> = {
  hot: [
    'Just hit the {x}X on {colour} for {pts}! Drinks are on me @pixelgolf #hottarget',
    'Called it. {x}X on {colour}, {pts} in the bag @pixelgolf #nailedit',
    'Did that just happen?! {x}X on {colour} for {pts} #hottarget #pixelgolf',
    '{pts} off the {x}X on {colour}. Somebody frame this @pixelgolf #legend',
    'Hot target? More like MY target. {x}X on {colour}, {pts} @pixelgolf #onfire'
  ],
  big: [
    'Landed it on {colour} for {pts}! Feeling like a pro today @pixelgolf #whatashot',
    '{colour} for {pts}. I\'d like to thank my club and nobody else #pixelgolf',
    'One swing. {colour}. {pts}. Zero regrets @pixelgolf #nailedit',
    '{pts} on {colour}! Who even am I? @pixelgolf #bigshot'
  ],
  bunker: [
    'Spent more time in the sand than on my last holiday @pixelgolf #bunker',
    'That bunker just cost me {pts}. Building a sandcastle to cope @pixelgolf #sandtrap',
    'Stuck in the bunker. Send help, or a shovel @pixelgolf #sandtrap',
    'Not a bad beach, this. {pts} for the view though @pixelgolf #bunker'
  ],
  misses: [
    'I just missed {n} shots in a row at @pixelgolf, anyone got any advice for an amateur? #help #golflife',
    '{n} misses in a row. The targets are definitely smaller than regulation size @pixelgolf #rigged',
    'Missed {n} on the trot. I\'m not angry, I\'m just disappointed in myself #pixelgolf #golfstruggles',
    'Is there a refund policy for {n} missed shots in a row @pixelgolf? Asking for a friend #mondaymood'
  ]
}
const lastLine: Partial<Record<LineKind, number>> = {}

/** One of the tweets for this kind of shot, with the details filled in (only lines it can fill) */
function line(kind: LineKind, fill: Record<string, string>): string {
  const all = LINES[kind]
  const usable = all.filter((t) => (t.match(/\{(\w+)\}/g) ?? []).every((k) => !!fill[k.slice(1, -1)]))
  let pool = usable.length ? usable : all.filter((t) => t.indexOf('{') < 0)
  const last = lastLine[kind]
  if (pool.length > 1 && last !== undefined) pool = pool.filter((t) => t !== all[last])
  const pick = pool[Math.floor(Math.random() * pool.length)]
  lastLine[kind] = all.indexOf(pick)
  let out = pick
  for (const k in fill) out = out.split(`{${k}}`).join(fill[k])
  return out
}

/** The most waiting to pop up: older ones are skipped (they're still in the list) */
const MAX_QUEUED = 5
/** Misses in a row before it's posted, then every this many more */
const MISS_STREAK = 3
const MISS_STREAK_EVERY = 2
/** The hardest targets: landing on these is always posted */
const BIG_TARGETS = ['White', 'Black']

/** How many past notices the pull-down list keeps (ui/NotificationsMenu.tsx) */
const HISTORY = 100

export const feed: {
  /** Waiting to pop up, oldest first */
  queue: FeedItem[]
  /** Every notice this visit (up to HISTORY), newest first, for the pull-down list */
  history: FeedItem[]
  /** Posted since the pull-down list was last opened */
  unread: number
  /** "Ignore notifications" in Settings: none pop up (saved with the player's settings, as 'feedOff') */
  ignore: boolean
} = { queue: [], history: [], unread: 0, ignore: false }

export function toggleIgnoreFeed(): void {
  feed.ignore = !feed.ignore
  if (feed.ignore) feed.queue = []
  saveSetting('feedOff', feed.ignore)
}

onSavedSettings((saved) => {
  if (typeof saved.feedOff === 'boolean') feed.ignore = saved.feedOff
})

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

function post(good: boolean, who: string, name: string, text: string): void {
  const item: FeedItem = { id: nextId++, good, who, name, text, born: Date.now() }
  if (!feed.ignore) {
    feed.queue.push(item)
    if (feed.queue.length > MAX_QUEUED) feed.queue.shift()
  }
  feed.history.unshift(item)
  if (feed.history.length > HISTORY) feed.history.length = HISTORY
  feed.unread++
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
    if (colour === 'Bunker') post(false, who, shown, line('bunker', points < 0 ? { pts: fmt(points) } : {}))
    else if (misses >= MISS_STREAK && (misses - MISS_STREAK) % MISS_STREAK_EVERY === 0) post(false, who, shown, line('misses', { n: String(misses) }))
    return
  }
  missStreaks.set(who, 0)
  const fill = { colour, x: String(HOT.factor), pts: '+' + fmt(points) }
  if (hot) post(true, who, shown, line('hot', fill))
  else if (BIG_TARGETS.indexOf(colour) >= 0) post(true, who, shown, line('big', fill))
}
