/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { engine, Entity, Transform, AudioSource, PrimaryPointerInfo } from '@dcl/sdk/ecs'
import { feed, FeedItem } from '../shotFeed'
import { FONT_BOLD, FONT_REGULAR } from '../fonts'
import { screenRoom, screenTopLift } from './screenRoom'
import { onPhone } from '../mobile'

// "Cooer": the shot feed's notifications (shotFeed.ts), built from the Cooer design
// (cooer-notifications: ChirpFeed.ts and chirp.css), redrawn here in the scene's UI. Like Chirper
// from Cities: Skylines, with an iOS-style pull-down history.
//
//  - Pop-up: drops in just below the bell tab with a pigeon "coo", stays HOLD_MS, then slides back
//    up. Notices that arrive together queue and show one at a time. A blue bar along its bottom
//    runs down while it's up.
//  - History panel: drag the pop-up or the bell tab down to pull the panel open. The newest message
//    is at the bottom, so it's revealed first. The panel is only as tall as its messages, up to
//    MAX_PANEL; past that the older ones are a page back ("Older"). On release it snaps open or
//    shut, and a quick flick counts. A tap on the tab opens or closes it, a tap on the pop-up opens
//    it, and the X, the dimmed area behind it or F close it.
//  - Bell tab: hangs off the bottom of the panel and moves with it. A red count of unread notices
//    overlaps the bell.
//
// Colours and sizes are the design's (chirp.css), in its pixels. The design's system font is
// Lato here, the scene's font. Things the scene's UI can't draw are left out: the drop shadows,
// the background blur and highlighted #hashtags.
//
// The drag follows the pointer's screen position (PrimaryPointerInfo). If pulling up ever opens it,
// set POINTER_DOWN to -1.

export const state = {
  /** Open, or going there. F (the menu guard) sets it to 'none' to close it, like the other menus. */
  display: 'none' as 'flex' | 'none'
}

// ---- The design's colours (chirp.css) ----
const BLUE = { r: 0.184, g: 0.608, b: 0.918, a: 1 } // #2f9bea
/** Half way down the design's gradient: under the gradient picture, so the tab and header are blue even before it loads */
const BLUE_MID = { r: 0.145, g: 0.539, b: 0.843, a: 1 }
const INK = { r: 0.09, g: 0.137, b: 0.184, a: 1 } // #17232f
const MUTED = { r: 0.424, g: 0.478, b: 0.537, a: 1 } // #6c7a89
const CARD = { r: 1, g: 1, b: 1, a: 0.96 }
const PANEL = { r: 0.933, g: 0.957, b: 0.98, a: 1 } // #eef4fa
const BADGE = { r: 1, g: 0.302, b: 0.31, a: 1 } // #ff4d4f
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const GRABBER = { r: 0.09, g: 0.137, b: 0.184, a: 0.18 }
const BACKDROP = { r: 0.024, g: 0.063, b: 0.11 }
const BACKDROP_ALPHA = 0.55

// ---- Pictures and sound ----
const IMG = 'assets/images/cooer/'
const PIGEON = IMG + 'pigeon.png'
const BELL = IMG + 'bell.png'
/** The design's blue gradient (#2f9bea to #1b78c4), stretched over the tab and the panel header */
const GRADIENT = IMG + 'blue-gradient.png'
const DEFAULT_AVATAR = IMG + 'avatar-default.png'
const CLOSE = IMG + 'close.png'
/** The bell tab's gradient, with its rounded bottom corners */
const TAB_IMAGE = IMG + 'tab.png'
const COO = 'assets/sounds/coo.mp3'
const COO_VOLUME = 0.7
const TITLE = 'Cooer'

// ---- Timings (ms), as the design ----
const ENTER_MS = 550
const HOLD_MS = 3000
const EXIT_MS = 340
const GAP_MS = 120
const HOP_MS = 500
const PANEL_MS = 450

// ---- Sizes (px), as chirp.css ----
const TAB = { w: 64, h: 34 }
/** The bell tab is this many times bigger on a phone, to be easy to tap */
const TAB_PHONE_SCALE = 2
/** The open panel is this many times bigger on a phone */
const PANEL_PHONE_SCALE = 2
const BANNER_TOP = 44
const BANNER_W = 420
const CARD_PAD = { top: 10, right: 14, bottom: 16, left: 54 }
const CARD_MIN_H = 64
const LINE_H = 19 // 14px text at line-height 1.35
const SHADE_W = 440
const HEADER_H = 60
const FOOTER_H = 26
const LIST_PAD = 6
const ITEM_MARGIN = 8
const ITEM_PAD = { top: 10, right: 14, bottom: 10, left: 10 }
const AVATAR = 40
/** The tallest the panel gets before older messages go to the page behind */
const MAX_PANEL = 600
/** Screen y grows downwards: 1. Flip to -1 if pulling up opens the panel. */
const POINTER_DOWN = 1
/** Moved less than this (px) between press and release: a tap, not a drag */
const TAP_PX = 6
/** px per ms: a release moving faster than this snaps open (down) or shut (up) */
const FLICK = 0.45
/** Roughly how wide a character of 14px Lato is, for working out where lines wrap */
const CHAR_W = 7.4

// ---- Easing (the design's cubic-beziers) ----
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) * (1 - s) + 3 * b * s * s * (1 - s) + s * s * s
  return (t: number) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    let lo = 0
    let hi = 1
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      if (at(x1, x2, mid) < t) lo = mid
      else hi = mid
    }
    return at(y1, y2, (lo + hi) / 2)
  }
}
const easeEnter = bezier(0.18, 1.3, 0.4, 1)
const easeExit = bezier(0.55, 0, 0.8, 0.2)
const easeHop = bezier(0.3, 1.6, 0.5, 1)
const easePanel = bezier(0.2, 0.9, 0.3, 1)

// ---- Text ----
function handleOf(name: string): string {
  return '@' + name.replace(/\s+/g, '')
}

/** How many lines a text takes at a width (an estimate: the scene's UI can't measure text) */
function linesFor(text: string, width: number): number {
  return Math.max(1, Math.ceil((text.length * CHAR_W) / width))
}

/** Cut to two lines with an ellipsis, as the pop-up does */
function clampTwoLines(text: string, width: number): string {
  const max = Math.floor((width / CHAR_W) * 2) - 1
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
}

function timeAgo(time: number): string {
  const s = Math.floor((Date.now() - time) / 1000)
  if (s < 45) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}

// ---- The pop-up ----
type Phase = 'none' | 'enter' | 'hold' | 'exit' | 'gap'
let current: FeedItem | null = null
let phase: Phase = 'none'
/** ms into the phase */
let phaseT = 0

const BANNER_TEXT_W = BANNER_W - CARD_PAD.left - CARD_PAD.right
function bannerHeight(): number {
  if (!current) return CARD_MIN_H
  const lines = Math.min(2, linesFor(current.text, BANNER_TEXT_W))
  return Math.max(CARD_MIN_H, CARD_PAD.top + 18 + 2 + lines * LINE_H + CARD_PAD.bottom)
}

// ---- The panel ----
/** 0 shut to 1 open */
let progress = 0
let animFrom = 0
let animTo = 0
let animT = -1
/** Which page of the history is showing: 0 is the newest */
let page = 0

type Drag = { source: 'banner' | 'tab' | 'shade'; startY: number; startProgress: number; lastY: number; velocity: number; moved: boolean }
let drag: Drag | null = null

const ITEM_TEXT_W = SHADE_W - 2 * 12 - ITEM_PAD.left - ITEM_PAD.right - AVATAR - 10

/** The open panel's scale (1 on desktop, PANEL_PHONE_SCALE on a phone): every size in it goes through P() */
let S = 1
const P = (n: number) => n * S
/** The tallest the panel can be right now (MAX_PANEL, or less to fit a phone's screen) */
let maxPanel = MAX_PANEL

/** Line wrapping is worked out at the design size (text and widths scale together), then scaled */
function itemHeight(i: FeedItem): number {
  return P(ITEM_PAD.top + Math.max(AVATAR, 18 + 2 + linesFor(i.text, ITEM_TEXT_W) * LINE_H) + ITEM_PAD.bottom)
}

/** The pages of the history, newest page first; each page is oldest-first so its newest is at the bottom */
function pages(): FeedItem[][] {
  const out: FeedItem[][] = []
  let cur: FeedItem[] = []
  let h = P(HEADER_H + FOOTER_H + 2 * LIST_PAD)
  for (const i of feed.history) {
    const ih = itemHeight(i) + P(2 * ITEM_MARGIN)
    if (cur.length && h + ih > maxPanel) {
      out.push(cur.reverse())
      cur = []
      h = P(HEADER_H + FOOTER_H + 2 * LIST_PAD)
    }
    cur.push(i)
    h += ih
  }
  if (cur.length || !out.length) out.push(cur.reverse())
  return out
}

function panelHeight(list: FeedItem[]): number {
  const items = list.length ? list.reduce((t, i) => t + itemHeight(i) + P(2 * ITEM_MARGIN), 0) : P(110)
  return P(HEADER_H + 2 * LIST_PAD + FOOTER_H) + items
}

function pointerY(): number | null {
  const p = PrimaryPointerInfo.getOrNull(engine.RootEntity)?.screenCoordinates
  const y = p ? p.y * POINTER_DOWN : NaN
  return Number.isFinite(y) ? y : null
}

function animateTo(p: number): void {
  animFrom = progress
  animTo = p
  animT = 0
}

export function openFeed(): void {
  state.display = 'flex'
  page = 0
  feed.unread = 0
  // The pop-up gives way to the panel, and everything queued is in the list already
  current = null
  phase = 'none'
  feed.queue = []
  animateTo(1)
}

export function closeFeed(): void {
  state.display = 'none'
  animateTo(0)
}

function startDrag(source: Drag['source']): void {
  if (drag) return
  if (source === 'shade' && state.display !== 'flex') return
  if (source === 'banner' && (state.display === 'flex' || !current)) return
  const y = pointerY() ?? 0
  drag = { source, startY: y, startProgress: progress, lastY: y, velocity: 0, moved: false }
  animT = -1
}

function endDrag(): void {
  const d = drag
  if (!d) return
  drag = null
  let open: boolean
  if (!d.moved) open = d.source === 'banner' ? true : d.source === 'tab' ? state.display !== 'flex' : state.display === 'flex'
  else if (d.velocity > FLICK) open = true
  else if (d.velocity < -FLICK) open = false
  else open = progress > (d.startProgress > 0.5 ? 0.7 : 0.3)
  if (open) openFeed()
  else if (state.display === 'flex') closeFeed()
  else animateTo(0)
}

/** Whether any of the panel is showing (the pop-up stays away while it is) */
export function drawerShowing(): boolean {
  return progress > 0.001 || drag !== null || state.display === 'flex'
}

let cooEntity: Entity | null = null
function coo(): void {
  if (!cooEntity) {
    cooEntity = engine.addEntity()
    Transform.create(cooEntity, {})
  }
  AudioSource.createOrReplace(cooEntity, { audioClipUrl: COO, playing: true, loop: false, global: true, volume: COO_VOLUME, currentTime: 0 })
}

/** Runs the pop-ups, the drag and the panel's slide. Call once (index.ts). */
export function setupNotificationsDrawer(): void {
  let lastDisplay = state.display
  engine.addSystem((dt) => {
    const ms = dt * 1000

    // Closed from outside (F): slide shut
    if (lastDisplay === 'flex' && state.display !== 'flex' && animTo !== 0) animateTo(0)
    lastDisplay = state.display

    // ---- The drag ----
    if (drag) {
      const y = pointerY()
      if (y !== null) {
        const dy = y - drag.startY
        if (Math.abs(dy) > TAP_PX) drag.moved = true
        if (ms > 0) drag.velocity = 0.7 * ((y - drag.lastY) / ms) + 0.3 * drag.velocity
        drag.lastY = y
        const travel = panelHeight(pages()[0])
        progress = Math.max(0, Math.min(1, drag.startProgress + dy / travel))
      }
    } else if (animT >= 0) {
      animT += ms
      const t = Math.min(1, animT / PANEL_MS)
      progress = animFrom + (animTo - animFrom) * easePanel(t)
      if (t >= 1) animT = -1
    }

    // ---- The pop-up ----
    if (phase !== 'none' && !(drag && phase === 'hold')) phaseT += ms
    if (phase === 'enter' && phaseT >= ENTER_MS) {
      phase = 'hold'
      phaseT = 0
    } else if (phase === 'hold' && phaseT >= HOLD_MS) {
      phase = 'exit'
      phaseT = 0
    } else if (phase === 'exit' && phaseT >= EXIT_MS) {
      phase = 'gap'
      phaseT = 0
    } else if (phase === 'gap' && phaseT >= GAP_MS) {
      phase = 'none'
      current = null
    }
    // The next one, when there's room for it
    if (phase === 'none' && !drawerShowing() && feed.queue.length && !feed.ignore) {
      current = feed.queue.shift()!
      phase = 'enter'
      phaseT = 0
      coo()
    }
    if (feed.ignore) feed.queue = []
  })
}

// ---- Drawing ----

/** #hashtags and @mentions, as the design's .chirp-tag: bold, in the darker blue (#1b78c4) */
const TAG_MARKUP = ['<b><color=#1B78C4>', '</color></b>']

/**
 * Message text with its #hashtags and @mentions picked out, Chirper-style: one wrapping label,
 * using the text's own markup for the coloured words (the scene's labels take simple markup).
 */
function richText(key: string, text: string, width: number, height: number, fontSize = 14) {
  // Anything that looks like markup in the message itself is left as plain text
  const safe = text.split('<').join('‹')
  const marked = safe.replace(/[#@]\w+/g, (m) => TAG_MARKUP[0] + m + TAG_MARKUP[1])
  return (
    <Label
      key={key}
      font="sans-serif"
      fontSrc={FONT_REGULAR}
      value={marked}
      fontSize={fontSize}
      color={INK}
      textWrap="wrap"
      textAlign="top-left"
      uiTransform={{ width, height, margin: { top: 2 * (fontSize / 14) } }}
    />
  )
}

/** The design's blue gradient over a solid blue box, filling it (the solid blue shows until the picture loads) */
function gradient(key: string, radius?: { bottomLeft: number; bottomRight: number }) {
  return (
    <UiEntity
      key={key}
      uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', borderRadius: radius, pointerFilter: 'none' }}
      uiBackground={{ textureMode: 'stretch', texture: { src: GRADIENT } }}
    />
  )
}

function grabber(key: string, top: number, k = 1) {
  return (
    <UiEntity
      key={key}
      uiTransform={{ positionType: 'absolute', position: { top, left: 0 }, width: '100%', height: 4 * k, justifyContent: 'center', pointerFilter: 'none' }}
    >
      <UiEntity uiTransform={{ width: 36 * k, height: 4 * k, borderRadius: 2 * k }} uiBackground={{ color: GRABBER }} />
    </UiEntity>
  )
}

function banner() {
  if (!current || phase === 'none' || phase === 'gap') return null
  const h = bannerHeight()
  // How far down it is: 0 hidden above the screen, 1 in place
  const hidden = -(h + 70) - BANNER_TOP
  let k = 1
  if (phase === 'enter') k = easeEnter(phaseT / ENTER_MS)
  else if (phase === 'exit') k = 1 - easeExit(phaseT / EXIT_MS)
  let y = hidden * (1 - k)
  let alpha = 1
  // Dragging it down: it follows a little and fades as the panel takes over
  if (drag && drag.source === 'banner') {
    const dy = (pointerY() ?? drag.startY) - drag.startY
    y += Math.max(0, Math.min(dy, 40)) * 0.6
    alpha = Math.max(0, 1 - progress * 2.5)
  }
  // The timer bar runs down while it's up
  const timer = phase === 'enter' ? 1 : phase === 'hold' ? Math.max(0, 1 - phaseT / HOLD_MS) : 0
  // The pigeon hops in a little after the card lands
  const hopStart = ENTER_MS * 0.6
  const hopT = phase === 'enter' ? Math.max(0, (phaseT - hopStart) / HOP_MS) : phase === 'hold' ? Math.min(1, (phaseT + ENTER_MS - hopStart) / HOP_MS) : 1
  const hop = easeHop(Math.min(1, hopT))
  const hopScale = 0.85 + 0.15 * hop
  const hopY = 10 * (1 - hop)
  const pigeonSize = 80 * hopScale
  const text = clampTwoLines(current.text, BANNER_TEXT_W)

  return (
    <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', pointerFilter: 'none', zIndex: 3 }}>
      <UiEntity
        uiTransform={{ width: BANNER_W, height: h, flexShrink: 0, margin: { top: BANNER_TOP + y }, opacity: alpha, pointerFilter: 'block' }}
        onMouseDown={() => startDrag('banner')}
        onMouseUp={() => endDrag()}
      >
        {/* The card */}
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: CARD_PAD,
            borderRadius: 18,
            overflow: 'hidden'
          }}
          uiBackground={{ color: CARD }}
        >
          <UiEntity uiTransform={{ width: '100%', height: 18, flexDirection: 'row', alignItems: 'flex-end' }}>
            <Label font="sans-serif" fontSrc={FONT_BOLD} value={current.name} fontSize={14} color={INK} textAlign="bottom-left" uiTransform={{ width: 'auto', height: 18 }} />
            <Label font="sans-serif" fontSrc={FONT_REGULAR} value={handleOf(current.name)} fontSize={13} color={MUTED} textAlign="bottom-left" uiTransform={{ width: 'auto', height: 18, margin: { left: 6 } }} />
          </UiEntity>
          {richText(`card-${current.id}`, text, BANNER_TEXT_W, Math.min(2, linesFor(text, BANNER_TEXT_W)) * LINE_H)}
          {grabber('card-grab', h - 9)}
          {/* The timer bar */}
          <UiEntity
            uiTransform={{ positionType: 'absolute', position: { left: 0, top: h - 3 }, width: BANNER_W * timer, height: 3, pointerFilter: 'none' }}
            uiBackground={{ color: BLUE }}
          />
        </UiEntity>
        {/* The pigeon: head on the card's left edge, body on its bottom-left corner */}
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { left: -20 + (80 - pigeonSize) / 2, top: h + 24 - pigeonSize + hopY },
            width: pigeonSize,
            height: pigeonSize,
            pointerFilter: 'none'
          }}
          uiBackground={{ textureMode: 'stretch', texture: { src: PIGEON } }}
        />
      </UiEntity>
    </UiEntity>
  )
}

function item(i: FeedItem) {
  const lines = linesFor(i.text, ITEM_TEXT_W)
  const wallet = i.who.startsWith('0x')
  return (
    <UiEntity
      key={`coo-${i.id}`}
      uiTransform={{
        width: P(SHADE_W - 24),
        height: itemHeight(i),
        flexShrink: 0,
        flexDirection: 'row',
        margin: { top: P(ITEM_MARGIN), bottom: P(ITEM_MARGIN) },
        padding: { top: P(ITEM_PAD.top), right: P(ITEM_PAD.right), bottom: P(ITEM_PAD.bottom), left: P(ITEM_PAD.left) },
        borderRadius: P(14)
      }}
      uiBackground={{ color: WHITE }}
    >
      {/* Profile picture: the player's own, over the default silhouette */}
      <UiEntity uiTransform={{ width: P(AVATAR), height: P(AVATAR), flexShrink: 0, borderRadius: P(AVATAR / 2), overflow: 'hidden' }} uiBackground={{ textureMode: 'stretch', texture: { src: DEFAULT_AVATAR } }}>
        {wallet ? <UiEntity uiTransform={{ width: P(AVATAR), height: P(AVATAR), borderRadius: P(AVATAR / 2) }} uiBackground={{ textureMode: 'stretch', avatarTexture: { userId: i.who } }} /> : null}
      </UiEntity>
      <UiEntity uiTransform={{ width: P(ITEM_TEXT_W), flexDirection: 'column', margin: { left: P(10) } }}>
        <UiEntity uiTransform={{ width: '100%', height: P(18), flexDirection: 'row', alignItems: 'flex-end' }}>
          <Label font="sans-serif" fontSrc={FONT_BOLD} value={i.name} fontSize={P(14)} color={INK} textAlign="bottom-left" uiTransform={{ width: 'auto', height: P(18) }} />
          <Label font="sans-serif" fontSrc={FONT_REGULAR} value={handleOf(i.name)} fontSize={P(13)} color={MUTED} textAlign="bottom-left" uiTransform={{ width: 'auto', height: P(18), margin: { left: P(6) } }} />
          <UiEntity uiTransform={{ flexGrow: 1 }} />
          <Label font="sans-serif" fontSrc={FONT_REGULAR} value={timeAgo(i.born)} fontSize={P(12)} color={MUTED} textAlign="bottom-right" uiTransform={{ width: 'auto', height: P(18) }} />
        </UiEntity>
        {richText(`item-${i.id}`, i.text, P(ITEM_TEXT_W), P(lines * LINE_H), P(14))}
      </UiEntity>
    </UiEntity>
  )
}

function smallButton(key: string, label: string, onPress: () => void) {
  return (
    <UiEntity key={key} uiTransform={{ width: P(70), height: P(22), justifyContent: 'center', alignItems: 'center' }} onMouseDown={onPress}>
      <Label font="sans-serif" fontSrc={FONT_BOLD} value={label} fontSize={P(12)} color={BLUE} textAlign="middle-center" uiTransform={{ width: P(70), height: P(20) }} />
    </UiEntity>
  )
}

export function NotificationsDrawer(props: {}) {
  if (state.display === 'flex') feed.unread = 0
  const phone = onPhone()
  // On a phone the UI starts below the screen's top safe margin: lift the panel and the bell by
  // that much so they hang from the very top of the screen (0 on desktop)
  const liftBy = screenTopLift(phone)
  // The bell tab's size: bigger on a phone
  const k = phone ? TAB_PHONE_SCALE : 1
  const tw = TAB.w * k
  const th = TAB.h * k
  const bell = 26 * k
  // The open panel: bigger on a phone, and never taller than the screen leaves room for (with the tab under it)
  S = phone ? PANEL_PHONE_SCALE : 1
  maxPanel = Math.min(P(MAX_PANEL), screenRoom().h + liftBy - th - 8)
  const all = pages()
  if (page >= all.length) page = all.length - 1
  const list = all[page]
  const H = panelHeight(drag ? all[0] : list)
  if (!Number.isFinite(progress)) progress = state.display === 'flex' ? 1 : 0
  const shown = Math.max(0, Math.min(1, progress))
  const panelTop = -H * (1 - shown) - liftBy
  const tabTop = H * shown - liftBy
  const count = feed.history.length
  const unread = feed.unread > 99 ? '99+' : String(feed.unread)

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', pointerFilter: 'none', zIndex: 9 }}>
      {/* The dim behind the open panel: a click on it closes the panel */}
      {shown > 0.001 ? (
        <UiEntity
          uiTransform={{ positionType: 'absolute', position: { top: -1500, left: -2000 }, width: 6000, height: 4000, pointerFilter: state.display === 'flex' ? 'block' : 'none' }}
          uiBackground={{ color: { ...BACKDROP, a: BACKDROP_ALPHA * shown } }}
          onMouseDown={() => {
            if (!drag && state.display === 'flex') closeFeed()
          }}
        />
      ) : null}

      {/* While dragging: a clear layer over everything, so letting go anywhere ends the drag */}
      {drag ? (
        <UiEntity
          uiTransform={{ positionType: 'absolute', position: { top: -1500, left: -2000 }, width: 6000, height: 4000, pointerFilter: 'block', zIndex: 5 }}
          onMouseUp={() => endDrag()}
        />
      ) : null}

      {/* The panel */}
      {shown > 0.001 ? (
        <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
          <UiEntity
            uiTransform={{ width: P(SHADE_W), height: H, flexShrink: 0, margin: { top: panelTop }, flexDirection: 'column', borderRadius: { bottomLeft: P(24), bottomRight: P(24) }, overflow: 'hidden', pointerFilter: 'block' }}
            uiBackground={{ color: PANEL }}
          >
            {/* Header */}
            <UiEntity
              uiTransform={{ width: '100%', height: P(HEADER_H), flexShrink: 0, flexDirection: 'row', alignItems: 'center', padding: { left: P(10), right: P(14) } }}
              uiBackground={{ color: BLUE_MID }}
              onMouseDown={() => startDrag('shade')}
              onMouseUp={() => endDrag()}
            >
              {gradient('header-grad')}
              <UiEntity uiTransform={{ width: P(44), height: P(44), flexShrink: 0 }} uiBackground={{ textureMode: 'stretch', texture: { src: PIGEON } }} />
              <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column', margin: { left: P(10) } }}>
                <Label font="sans-serif" fontSrc={FONT_BOLD} value={TITLE} fontSize={P(17)} color={WHITE} textAlign="middle-left" uiTransform={{ width: P(200), height: P(21) }} />
                <Label
                  font="sans-serif"
                  fontSrc={FONT_REGULAR}
                  value={`${count} ${count === 1 ? 'message' : 'messages'}`}
                  fontSize={P(12)}
                  color={{ r: 1, g: 1, b: 1, a: 0.85 }}
                  textAlign="middle-left"
                  uiTransform={{ width: P(200), height: P(15) }}
                />
              </UiEntity>
              <UiEntity
                uiTransform={{ width: P(32), height: P(32), flexShrink: 0, justifyContent: 'center', alignItems: 'center', borderRadius: P(16) }}
                uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.2 } }}
                onMouseDown={() => closeFeed()}
              >
                {/* A drawn cross, so it sits dead centre (the × character sat off to one side) */}
                <UiEntity uiTransform={{ width: P(14), height: P(14) }} uiBackground={{ textureMode: 'stretch', texture: { src: CLOSE } }} />
              </UiEntity>
            </UiEntity>

            {/* The list: oldest at the top, newest at the bottom by the tab */}
            <UiEntity uiTransform={{ width: '100%', flexGrow: 1, flexDirection: 'column', alignItems: 'center', padding: { top: P(LIST_PAD), bottom: P(LIST_PAD) } }}>
              {list.length ? (
                list.map((i) => item(i))
              ) : (
                <UiEntity uiTransform={{ width: '100%', height: P(110), flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                  <Label font="sans-serif" fontSrc={FONT_BOLD} value="No messages yet" fontSize={P(15)} color={INK} textAlign="middle-center" uiTransform={{ width: P(300), height: P(22) }} />
                  <Label font="sans-serif" fontSrc={FONT_REGULAR} value="Activity will be displayed here." fontSize={P(14)} color={MUTED} textAlign="middle-center" uiTransform={{ width: P(300), height: P(22), margin: { top: P(4) } }} />
                </UiEntity>
              )}
            </UiEntity>

            {/* Footer: the grabber, and older or newer pages when there are more than fit */}
            <UiEntity
              uiTransform={{ width: '100%', height: P(FOOTER_H), flexShrink: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: { left: P(8), right: P(8) } }}
              onMouseDown={() => startDrag('shade')}
              onMouseUp={() => endDrag()}
            >
              {page < all.length - 1 ? smallButton('older', 'Older', () => (page += 1)) : <UiEntity uiTransform={{ width: P(70) }} />}
              {grabber('foot-grab', P(11), S)}
              {page > 0 ? smallButton('newer', 'Newer', () => (page -= 1)) : <UiEntity uiTransform={{ width: P(70) }} />}
            </UiEntity>
          </UiEntity>
        </UiEntity>
      ) : null}

      {/* The bell tab, hanging off the panel's bottom edge (the top of the screen when it's shut) */}
      <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', pointerFilter: 'none', zIndex: 2 }}>
        <UiEntity
          uiTransform={{
            width: tw,
            height: th,
            flexShrink: 0,
            margin: { top: tabTop },
            overflow: 'hidden',
            pointerFilter: 'block'
          }}
          onMouseDown={() => startDrag('tab')}
          onMouseUp={() => endDrag()}
        >
          {/* Its blue, as pieces placed exactly (like the badge, which always showed): a solid blue
              rounded box with its top corners pushed up off the top, the gradient over it, then the bell */}
          <UiEntity
            uiTransform={{ positionType: 'absolute', position: { top: -18 * k, left: 0 }, width: tw, height: th + 18 * k, borderRadius: 18 * k, pointerFilter: 'none' }}
            uiBackground={{ color: BLUE_MID }}
          />
          {/* The gradient with the rounded bottom corners drawn into the picture (a picture isn't rounded by borderRadius) */}
          <UiEntity
            uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: tw, height: th, pointerFilter: 'none' }}
            uiBackground={{ textureMode: 'stretch', texture: { src: TAB_IMAGE } }}
          />
          <UiEntity
            uiTransform={{ positionType: 'absolute', position: { top: (th - bell) / 2, left: (tw - bell) / 2 }, width: bell, height: bell, pointerFilter: 'none' }}
            uiBackground={{ textureMode: 'stretch', texture: { src: BELL } }}
          />
          {/* Unread count, overlapping the bell's top right */}
          <UiEntity
            uiTransform={{
              positionType: 'absolute',
              position: { top: 2 * k, left: 37 * k },
              width: (unread.length > 1 ? 17 + (unread.length - 1) * 6 : 17) * k,
              height: 17 * k,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 9 * k,
              borderWidth: 2,
              borderColor: BLUE,
              display: feed.unread > 0 && state.display !== 'flex' ? 'flex' : 'none',
              pointerFilter: 'none'
            }}
            uiBackground={{ color: BADGE }}
          >
            <Label font="sans-serif" fontSrc={FONT_BOLD} value={unread} fontSize={10 * k} color={WHITE} textAlign="middle-center" uiTransform={{ width: 'auto', height: 15 * k }} />
          </UiEntity>
        </UiEntity>
      </UiEntity>

      {/* The pop-up */}
      {banner()}
    </UiEntity>
  )
}
