/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { feedShowing, FeedItem } from '../shotFeed'
import { onPhone } from '../mobile'
import { FONT_BOLD, FONT_REGULAR } from '../fonts'

// The shot feed (shotFeed.ts): a short stack of pills at the top middle of the screen, newest at
// the top. Each one drops down into place (pushing the others down with it) and fades away at the
// end. Clicks go straight through it.

const NAVY = { r: 0.118, g: 0.204, b: 0.259 }
const WHITE = { r: 1, g: 1, b: 1 }
/** The blue the menus use */
const BLUE = { r: 0.075, g: 0.533, b: 0.722 }

const TOP_DESKTOP = 24
const TOP_PHONE = 12
const PILL_H = 36
const GAP = 6
/** Roughly how wide a character of 15 px Lato is, to size each label to its text */
/** Names longer than this are cut short with "..." so one long name can't fill the screen */
const MAX_NAME = 20
/** The drop in and the fade out (seconds) */
const DROP_SECONDS = 0.35
const FADE_SECONDS = 0.5

/** Overshoots a little and settles, so it lands with a small bounce */
function easeOutBack(t: number): number {
  const c = 1.4
  const u = t - 1
  return 1 + (c + 1) * u * u * u + c * u * u
}

function pill(i: FeedItem, now: number) {
  const age = Math.max(0, (now - i.born) / 1000)
  const drop = Math.min(1, age / DROP_SECONDS)
  // The slot opens smoothly (so the pills below slide down), the pill itself drops in with a bounce
  const open = 1 - Math.pow(1 - drop, 3)
  const fall = easeOutBack(drop)
  const alpha = Math.max(0, Math.min(1, drop * 2, (i.until - now) / 1000 / FADE_SECONDS))
  const name = i.name.length > MAX_NAME ? i.name.slice(0, MAX_NAME - 1) + '…' : i.name
  // The pill grows to fit its words: the labels size to their own text ('auto'), and so does the
  // pill around them. It drops in by sliding up out of its slot (a negative top margin), while the
  // slot opens smoothly so the pills below slide down.
  return (
    <UiEntity
      key={`feed-${i.id}`}
      uiTransform={{ width: 'auto', height: (PILL_H + GAP) * open, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}
    >
      <UiEntity
        uiTransform={{
          width: 'auto',
          height: PILL_H,
          flexShrink: 0,
          margin: { top: (fall - 1) * (PILL_H + GAP) },
          flexDirection: 'row',
          alignItems: 'center',
          padding: { right: 18 },
          borderRadius: PILL_H / 2,
          overflow: 'hidden',
          pointerFilter: 'none'
        }}
        uiBackground={{ color: { ...WHITE, a: 0.96 * alpha } }}
      >
        <UiEntity uiTransform={{ width: 8, height: PILL_H, flexShrink: 0 }} uiBackground={{ color: { ...BLUE, a: alpha } }} />
        <Label font="sans-serif" fontSrc={FONT_BOLD} value={name} fontSize={15} color={{ ...BLUE, a: alpha }} textAlign="middle-left" uiTransform={{ width: 'auto', height: 30, margin: { left: 12 } }} />
        <Label font="sans-serif" fontSrc={FONT_REGULAR} value={i.text} fontSize={15} color={{ ...NAVY, a: alpha }} textAlign="middle-left" uiTransform={{ width: 'auto', height: 30, margin: { left: 6 } }} />
      </UiEntity>
    </UiEntity>
  )
}

export function ShotFeed(props: {}) {
  const items = feedShowing()
  const now = Date.now()
  const phone = onPhone()
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        flexDirection: 'column',
        alignItems: 'center',
        padding: { top: phone ? TOP_PHONE : TOP_DESKTOP },
        pointerFilter: 'none'
      }}
    >
      {items.map((i) => pill(i, now))}
    </UiEntity>
  )
}
