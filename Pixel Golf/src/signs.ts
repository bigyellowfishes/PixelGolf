import { engine, Entity, Transform, TextShape, Font, TextAlignMode, MeshRenderer, Material } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { XP } from './ledger/rules'
import { FONT_BOLD, FONT_REGULAR } from './fonts'

/**
 * Signs. Client only (index.ts calls setupSigns after the games exist).
 *   AFK AREA   a board in the leaderboards' style (leaderboardScreens.ts) across the low white
 *              wall and the glass at the AFK practice area (afk.ts), between the posts in the middle
 *              of its curve. The blue title half and the card are pictures
 *              (assets/images/boards/afk-sign-left.png and -right.png); the lines on the card are
 *              live text, so the XP rate always matches ledger/rules.ts.
 *   SOLO BAY   the same style, flat on the wall behind bay 20 above the Pixel Golf logo, saying it
 *              always has room, even when every other bay is full (assets/images/boards/solo-sign.png).
 */

// ---------------------------------------------------------------- AFK board

/** The AFK area's centre (afk.ts CENTRE) */
const AFK_CENTRE = { x: 79.74, z: 182.33 }
/**
 * The low wall in front of the grass isn't round: it's flat sections with corners every 11.4
 * degrees, 11.687 m out (read from Training Area Frame.glb), and the barrier posts stand at those
 * corners. The board fills the gap between the posts either side of the middle (225 degrees), so it
 * is two halves, each flat against one section, meeting at the middle corner.
 */
const AFK_CORNER_RADIUS = 11.687
const AFK_MIDDLE = 225
const AFK_SECTION = 11.4
/** How far in front of the wall the board stands (m) */
const AFK_LIFT = 0.03
/** Each half's width along its section (stopping short of the posts) and the board's height (m) */
const AFK_HALF_W = 2.1
const AFK_BOTTOM = 34.5
const AFK_TOP = 36.28
/** Each half's picture is 1200 x 1017 px; the live lines go on the right half's white card */
const AFK_PX = { w: 1200, h: 1017 }
const AFK_TEXT_X = 130
const AFK_LINES: { y: number; cap: number; colour: 'navy' | 'blue' | 'grey'; bold: boolean; text: () => string }[] = [
  { y: 300, cap: 0.13, colour: 'navy', bold: true, text: () => 'Stand on the grass' },
  { y: 470, cap: 0.085, colour: 'navy', bold: false, text: () => 'Your golfer practises on a loop' },
  { y: 600, cap: 0.085, colour: 'blue', bold: true, text: () => `Earn ${XP.afkPerTick} XP every ${XP.afkTickSeconds} seconds` },
  { y: 740, cap: 0.07, colour: 'grey', bold: false, text: () => 'Walk off or press Stop to finish' }
]

/** Lit like a display, the same as the leaderboards */
const GLOW = 0.6
const COLOURS = {
  blue: Color4.create(0.075, 0.533, 0.722, 1),
  navy: Color4.create(0.118, 0.204, 0.259, 1),
  grey: Color4.create(0.337, 0.388, 0.435, 1)
}

/** A point on the wall's corner ring at an angle (degrees), on the floor plane */
function corner(deg: number): Vector3 {
  const r = (deg * Math.PI) / 180
  return Vector3.create(AFK_CENTRE.x + Math.cos(r) * AFK_CORNER_RADIUS, 0, AFK_CENTRE.z + Math.sin(r) * AFK_CORNER_RADIUS)
}

/**
 * One half of the board, flat along the wall section from the middle corner towards `towards`.
 * Its root has -Z towards the player and +X to the player's right, like the leaderboards.
 */
function afkHalf(towards: number, image: string): Entity {
  const mid = corner(AFK_MIDDLE)
  const end = corner(towards)
  const along = Vector3.normalize(Vector3.subtract(end, mid))
  // Out of the area, away from the player: the section's normal pointing away from the centre
  let out = Vector3.create(-along.z, 0, along.x)
  const toCentre = Vector3.create(AFK_CENTRE.x - mid.x, 0, AFK_CENTRE.z - mid.z)
  if (Vector3.dot(out, toCentre) > 0) out = Vector3.scale(out, -1)
  const centre = Vector3.add(Vector3.add(mid, Vector3.scale(along, AFK_HALF_W / 2)), Vector3.scale(out, -AFK_LIFT))
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(centre.x, (AFK_BOTTOM + AFK_TOP) / 2, centre.z),
    rotation: Quaternion.lookRotation(out, Vector3.Up())
  })
  const bg = engine.addEntity()
  Transform.create(bg, { parent: root, scale: Vector3.create(AFK_HALF_W, AFK_TOP - AFK_BOTTOM, 1) })
  MeshRenderer.setPlane(bg)
  const tex = Material.Texture.Common({ src: `assets/images/boards/${image}.png` })
  Material.setPbrMaterial(bg, {
    texture: tex,
    emissiveTexture: tex,
    emissiveColor: Color4.White(),
    emissiveIntensity: GLOW,
    metallic: 0,
    roughness: 1,
    specularIntensity: 0
  })
  return root
}

function afkBoard(): void {
  // Seen from the floor, the section towards the bigger angle is on the left
  afkHalf(AFK_MIDDLE + AFK_SECTION, 'afk-sign-left')
  const right = afkHalf(AFK_MIDDLE - AFK_SECTION, 'afk-sign-right')
  const h = AFK_TOP - AFK_BOTTOM
  for (const line of AFK_LINES) {
    const e = engine.addEntity()
    Transform.create(e, {
      parent: right,
      position: Vector3.create((AFK_TEXT_X / AFK_PX.w - 0.5) * AFK_HALF_W, (0.5 - line.y / AFK_PX.h) * h, -0.006)
    })
    TextShape.create(e, {
      text: line.text(),
      // TextShape sizes are roughly a tenth of a metre per point, with capitals about 0.72 of that
      fontSize: line.cap / 0.072,
      font: Font.F_SANS_SERIF,
      fontSrc: line.bold ? FONT_BOLD : FONT_REGULAR,
      textColor: COLOURS[line.colour],
      textAlign: TextAlignMode.TAM_MIDDLE_LEFT,
      textWrapping: false
    })
  }
}

// ---------------------------------------------------------------- Solo bay board

/**
 * On the building's wall behind bay 20, just above the Pixel Golf logo and centred on it. The wall
 * faces +z at z = 160 and the logo spans x 101.33 to 105.36, y 34.07 to 38.06 (read from
 * Building/Main Building.glb and Logos.glb).
 */
const SOLO_WALL_Z = 160
const SOLO_LIFT = 0.03
const SOLO_CENTRE = { x: 103.345, y: 39.25 }
/** Board size (m), the same shape as the picture (2400 x 700 px) */
const SOLO_BOARD = { w: 4.8, h: 1.4, px: { w: 2400, h: 700 } }
const SOLO_TEXT_X = 1200
const SOLO_LINES: { y: number; cap: number; bold: boolean; text: string }[] = [
  { y: 290, cap: 0.17, bold: true, text: 'Always open' },
  { y: 440, cap: 0.1, bold: false, text: 'Even when every other bay is full' }
]

function soloBoard(): void {
  const root = engine.addEntity()
  // -Z towards the player, who stands in front of the wall (on its +z side)
  Transform.create(root, {
    position: Vector3.create(SOLO_CENTRE.x, SOLO_CENTRE.y, SOLO_WALL_Z + SOLO_LIFT),
    rotation: Quaternion.lookRotation(Vector3.create(0, 0, -1), Vector3.Up())
  })
  const bg = engine.addEntity()
  Transform.create(bg, { parent: root, scale: Vector3.create(SOLO_BOARD.w, SOLO_BOARD.h, 1) })
  MeshRenderer.setPlane(bg)
  const tex = Material.Texture.Common({ src: 'assets/images/boards/solo-sign.png' })
  Material.setPbrMaterial(bg, {
    texture: tex,
    emissiveTexture: tex,
    emissiveColor: Color4.White(),
    emissiveIntensity: GLOW,
    metallic: 0,
    roughness: 1,
    specularIntensity: 0
  })
  for (const line of SOLO_LINES) {
    const e = engine.addEntity()
    Transform.create(e, {
      parent: root,
      position: Vector3.create((SOLO_TEXT_X / SOLO_BOARD.px.w - 0.5) * SOLO_BOARD.w, (0.5 - line.y / SOLO_BOARD.px.h) * SOLO_BOARD.h, -0.006)
    })
    TextShape.create(e, {
      text: line.text,
      fontSize: line.cap / 0.072,
      font: Font.F_SANS_SERIF,
      fontSrc: line.bold ? FONT_BOLD : FONT_REGULAR,
      textColor: COLOURS.navy,
      textAlign: TextAlignMode.TAM_MIDDLE_LEFT,
      textWrapping: false
    })
  }
}

export function setupSigns(): void {
  afkBoard()
  soloBoard()
}
