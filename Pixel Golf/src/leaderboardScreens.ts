import { engine, Entity, Transform, MeshRenderer, Material, TextShape, Font, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { boards, BoardRow } from './ledger/client'
import { Period, secondsToReset } from './ledger/rules'
import { FONT_BOLD, FONT_REGULAR } from './fonts'

// The leaderboards on the plaza's screens (Screens.glb), in the Leaderboards menu's style: the
// card, the title tab, the period and the two column headings are a picture
// (assets/images/boards/), and the rows, the countdown and your own place are live text on top,
// like the bays' Tee Off screens.
//
// Each screen is one period, with True Score's top 5 on the left and Multiplier's top 5 on the right:
//   - left (looking at the podium from the plaza): Today
//   - middle, behind the podium: All time. It's one screen made of two panels meeting at a slight
//     angle, so the board stands just in front of where they meet and spans both
//   - right: This month
//
// Where the screens are was read from Screens.glb (its front faces, the side facing the plaza).

type Layout = {
  /** The picture's size in pixels, which the slots below are measured in */
  px: { w: number; h: number }
  /** The board's size in metres */
  m: { w: number; h: number }
  /** Each column's left and right edge: True Score, then Multiplier */
  cols: { x0: number; x1: number }[]
  /** The first row's top and each row's height (5 rows) */
  top: number
  rowH: number
  /** Capital letter height of the rows, in metres */
  cap: number
  /** The line under the list: your place (left) and the reset countdown (right) */
  footY: number
  footCap: number
}

const ROWS = 5
/** In a column: where the rank and the name start (from the left), and the score ends (from the right) */
const RANK_X = 40
const NAME_X = 120
const VALUE_X = 30
/** Names longer than this are cut short so they don't run into the score */
const MAX_NAME = 11
const COLS = [
  { x0: 60, x1: 790 },
  { x0: 810, x1: 1540 }
]

const WIDE: Layout = { px: { w: 1600, h: 990 }, m: { w: 6.3, h: 3.9 }, cols: COLS, top: 238, rowH: 129, cap: 0.14, footY: 942, footCap: 0.1 }
const MIDDLE: Layout = { px: { w: 1600, h: 745 }, m: { w: 7.7, h: 3.6 }, cols: COLS, top: 198, rowH: 97, cap: 0.14, footY: 718, footCap: 0.1 }

type ScreenDef = {
  /** The middle of the screen's front face, and the way it faces (scene coordinates) */
  centre: Vector3
  normal: Vector3
  /** How far in front of the face the board stands (metres) */
  lift: number
  layout: Layout
  image: string
  period: Period
}

const SCREENS: ScreenDef[] = [
  // Left: Today
  { centre: Vector3.create(60.3, 37.98, 323.47), normal: Vector3.create(0.96, 0, -0.29), lift: 0.03, layout: WIDE, image: 'board-left-today', period: 'day' },
  // Middle, behind the podium: All time. Its two panels' outer edges come 0.18 m further forward
  // than where they meet, so the board stands a little further out to clear them.
  { centre: Vector3.create(64.215, 38.37, 333.195), normal: Vector3.create(0.7071, 0, -0.7071), lift: 0.22, layout: MIDDLE, image: 'board-middle-alltime', period: 'all' },
  // Right: This month
  { centre: Vector3.create(73.95, 37.98, 337.11), normal: Vector3.create(0.29, 0, -0.96), lift: 0.03, layout: WIDE, image: 'board-right-month', period: 'month' }
]

/** Lit like a display, the same as the Tee Off screens */
const GLOW = 0.6

const BLUE = Color4.create(0.075, 0.533, 0.722, 1)
const NAVY = Color4.create(0.118, 0.204, 0.259, 1)
const GREY = Color4.create(0.337, 0.388, 0.435, 1)
const PALE_BLUE = Color4.create(0.839, 0.949, 0.988, 1)

function fmt(n: number): string {
  const s = String(Math.abs(Math.round(n)))
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ','
    out += s[i]
  }
  return (n < 0 ? '-' : '') + out
}

function countdown(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const two = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  if (d > 0) return `${d}d ${h}h ${two(m)}m`
  return `${two(h)}:${two(m)}:${two(s)}`
}

function shortName(name: string): string {
  return name.length > MAX_NAME ? name.slice(0, MAX_NAME - 1) + '…' : name
}

/** A point on the picture (pixels) as a position on the board (metres, from its middle) */
function at(L: Layout, x: number, y: number, z: number): Vector3 {
  return Vector3.create((x / L.px.w - 0.5) * L.m.w, (0.5 - y / L.px.h) * L.m.h, z)
}

// TextShape sizes are roughly a tenth of a metre per point, with capitals about 0.72 of that
function fontSize(cap: number): number {
  return cap / 0.072
}

function text(parent: Entity, pos: Vector3, cap: number, colour: Color4, align: TextAlignMode, bold: boolean): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position: pos })
  TextShape.create(e, {
    text: '',
    fontSize: fontSize(cap),
    font: Font.F_SANS_SERIF,
    fontSrc: bold ? FONT_BOLD : FONT_REGULAR,
    textColor: colour,
    textAlign: align,
    textWrapping: false
  })
  return e
}

type Row = { rank: Entity; name: Entity; value: Entity; at: Vector3 }
/** One column: its board, its rows, and the pale blue bar behind your own row */
type Column = { board: 'true' | 'multi'; rows: Row[]; highlight: Entity; size: Vector3; empty: Entity }
type Live = { def: ScreenDef; columns: Column[]; you: Entity; reset: Entity; key: string; resetText: string }

function build(def: ScreenDef): Live {
  const L = def.layout
  // root: on the screen, -Z towards the player (the side planes and text read correctly from)
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.add(def.centre, Vector3.scale(def.normal, def.lift)),
    rotation: Quaternion.lookRotation(Vector3.scale(def.normal, -1), Vector3.Up())
  })
  const bg = engine.addEntity()
  Transform.create(bg, { parent: root, scale: Vector3.create(L.m.w, L.m.h, 1) })
  MeshRenderer.setPlane(bg)
  const tex = Material.Texture.Common({ src: `assets/images/boards/${def.image}.png` })
  Material.setPbrMaterial(bg, {
    texture: tex,
    emissiveTexture: tex,
    emissiveColor: Color4.White(),
    emissiveIntensity: GLOW,
    metallic: 0,
    roughness: 1,
    specularIntensity: 0
  })

  const boardsInOrder: ('true' | 'multi')[] = ['true', 'multi']
  const columns: Column[] = L.cols.map((c, ci) => {
    const highlight = engine.addEntity()
    Transform.create(highlight, { parent: root, scale: Vector3.Zero() })
    MeshRenderer.setPlane(highlight)
    Material.setPbrMaterial(highlight, { albedoColor: PALE_BLUE, emissiveColor: PALE_BLUE, emissiveIntensity: GLOW, metallic: 0, roughness: 1, specularIntensity: 0 })
    const rows: Row[] = []
    for (let i = 0; i < ROWS; i++) {
      const y = L.top + L.rowH * (i + 0.5)
      rows.push({
        rank: text(root, at(L, c.x0 + RANK_X, y, -0.006), L.cap, BLUE, TextAlignMode.TAM_MIDDLE_LEFT, true),
        name: text(root, at(L, c.x0 + NAME_X, y, -0.006), L.cap, NAVY, TextAlignMode.TAM_MIDDLE_LEFT, false),
        value: text(root, at(L, c.x1 - VALUE_X, y, -0.006), L.cap, NAVY, TextAlignMode.TAM_MIDDLE_RIGHT, true),
        at: at(L, (c.x0 + c.x1) / 2, y, -0.003)
      })
    }
    return {
      board: boardsInOrder[ci],
      rows,
      highlight,
      size: Vector3.create(((c.x1 - c.x0) / L.px.w) * L.m.w, ((L.rowH - 10) / L.px.h) * L.m.h, 1),
      empty: text(root, at(L, (c.x0 + c.x1) / 2, L.top + L.rowH * 2.5, -0.006), L.footCap, GREY, TextAlignMode.TAM_MIDDLE_CENTER, false)
    }
  })

  return {
    def,
    columns,
    you: text(root, at(L, L.cols[0].x0, L.footY, -0.006), L.footCap, NAVY, TextAlignMode.TAM_MIDDLE_LEFT, false),
    reset: text(root, at(L, L.cols[L.cols.length - 1].x1, L.footY, -0.006), L.footCap, GREY, TextAlignMode.TAM_MIDDLE_RIGHT, false),
    key: '',
    resetText: ''
  }
}

export function setupLeaderboardScreens(): void {
  const live = SCREENS.map(build)
  let wait = 0
  engine.addSystem((dt) => {
    wait -= dt
    if (wait > 0) return
    wait = 0.5
    const me = (getPlayer()?.userId ?? '').toLowerCase()
    for (const s of live) {
      const period = s.def.period

      // The countdown ticks every second, on its own
      const reset = period === 'all' ? 'Never resets' : `Resets in ${countdown(secondsToReset(period))}`
      if (reset !== s.resetText) {
        s.resetText = reset
        TextShape.getMutable(s.reset).text = reset
      }

      // The rows, only rewritten when something's changed
      const table = boards.ready ? boards.tables[period] : undefined
      const lists: BoardRow[][] = s.columns.map((c) => (table ? table[c.board] : []))
      const mine = boards.mine[period]
      const you =
        mine.true > 0 || mine.multi > 0
          ? `You: True Score ${mine.true > 0 ? '#' + mine.true : '-'}  ·  Multiplier ${mine.multi > 0 ? '#' + mine.multi : '-'}`
          : 'You: finish a round to post'
      const key = `${lists.map((l) => l.slice(0, ROWS).map((r) => r.u + r.n + r.v).join(',')).join('|')}|${you}|${me}`
      if (key === s.key) continue
      s.key = key

      s.columns.forEach((col, ci) => {
        const list = lists[ci]
        let mineAt = -1
        col.rows.forEach((row, i) => {
          const r = list[i]
          TextShape.getMutable(row.rank).text = r ? `${i + 1}` : ''
          TextShape.getMutable(row.name).text = r ? shortName(r.n) : ''
          TextShape.getMutable(row.value).text = r ? fmt(r.v) : ''
          if (r && me && r.u.toLowerCase() === me) mineAt = i
        })
        // Your row picked out in pale blue, or the highlight shrunk away
        const h = Transform.getMutable(col.highlight)
        if (mineAt >= 0) {
          h.position = col.rows[mineAt].at
          h.scale = col.size
        } else h.scale = Vector3.Zero()
        TextShape.getMutable(col.empty).text = list.length ? '' : 'No rounds posted yet'
      })
      TextShape.getMutable(s.you).text = you
    }
  })
}
