import {
  engine,
  Entity,
  Transform,
  MeshCollider,
  ColliderLayer,
  pointerEventsSystem,
  InputAction,
  TextShape,
  Font,
  TextAlignMode,
  MeshRenderer,
  Material
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { openPixelGolfMenu } from './ui/GameModeMenu'
import { isShotInProgress, GameState } from './game'
import { ROUND_BALLS } from './ledger/rules'
import { bayTakenBy, claimBay, bayLockReason, tutorial, TUTORIAL_BAY } from './ledger/client'
import { showToast } from './ui/RangeHud'
import { playUi } from './sfx'

// The Tee Off panels: clicking one opens the Pixel Golf menu, and its screen shows
// that bay's score in the same style as the menu.
//
// The panels are one merged model ("Tee Off Panels.glb"), so each panel gets its own
// invisible click box and its own score screen here. Both are parented to that entity,
// so they follow it if the Environment is moved in the editor. Positions are in the
// model's local space and were measured from the model itself; the two end panels
// have no ball and are left out.
//
// Click (left mouse / tap) is used rather than E, because E by the ball takes the shot
// and every panel is within the ball's hit range.

const PANEL_ENTITY_NAME = 'Tee Off Panels.glb'
const HOVER_TEXT = 'Tee Off'
// How far away the player can click from, in metres
const MAX_DISTANCE = 6
// Slightly larger than the panel so the box sits outside the model's own collider
const BOX_SIZE = { x: 1.45, y: 1.26, z: 2.98 }

// --- Score screen look --------------------------------------------------------
// The screen is a picture in the same style as the menu (bay-screen.png), laid over the
// model's flat black screen (measured from the model: 2.78 x 1.18 m), with the live
// numbers as text on top.
const SCREEN_IMAGE = 'assets/images/menus/bay-screen.png'
// Size in metres, and how far the centre sits up the slope from the black screen's centre
const SCREEN_SIZE = { x: 2.78, y: 1.18 }
const SCREEN_SHIFT_UP = 0
// Nudges the picture towards (+) or away from (-) the player, in metres. At -0.008 it
// sits 2 mm in front of the black screen. If it flickers up close, set this to -0.005.
const SCREEN_LIFT = -0.008
// Text is drawn on its readable side; set to -1 if the screen shows mirrored in the preview
const FACE_DIRECTION = 1
// How much the screen glows, so it reads like a lit display. 0 is none, 1 is full brightness.
const SCREEN_GLOW = 0.6
// Multiplies every text size; nudge this if the numbers look too big or small for their boxes
const TEXT_SCALE = 1
// Where each live value sits on the picture (metres from its centre) and its letter height
const SLOTS = {
  bay: { x: -1.0462, y: 0.515, cap: 0.08 },
  score: { x: -0.69, y: -0.0762, cap: 0.225 },
  shots: { x: 0.3475, y: -0.0762, cap: 0.15 }, // smaller than the score so "10/10" fits its box
  last: { x: 1.0375, y: -0.045, cap: 0.09 },
  zone: { x: 1.0375, y: -0.2075, cap: 0.0625 }
}
const INK = Color4.create(0.118, 0.204, 0.259, 1)
const GREY = Color4.create(0.337, 0.388, 0.435, 1)

// box: the click box. screen: the centre of the sloped screen face and the direction
// it faces (towards the bay's ball, where the player stands).
const PANELS: {
  ball: number
  box: { x: number; y: number; z: number; yaw: number }
  screen: { x: number; y: number; z: number; nx: number; ny: number; nz: number }
}[] = [
  {
    ball: 1,
    box: { x: -224.133, y: 30.552, z: -76.366, yaw: -101.33 },
    screen: { x: -224.157, y: 30.687, z: -76.244, nx: -0.138, ny: 0.707, nz: 0.693 }
  },
  {
    ball: 2,
    box: { x: -227.674, y: 30.549, z: -68.101, yaw: -100.18 },
    screen: { x: -227.696, y: 30.684, z: -67.978, nx: -0.124, ny: 0.707, nz: 0.696 }
  },
  {
    ball: 3,
    box: { x: -230.738, y: 30.541, z: -59.667, yaw: -98.92 },
    screen: { x: -230.757, y: 30.677, z: -59.543, nx: -0.109, ny: 0.707, nz: 0.699 }
  },
  {
    ball: 4,
    box: { x: -233.343, y: 30.544, z: -51.088, yaw: -97.43 },
    screen: { x: -233.359, y: 30.679, z: -50.964, nx: -0.091, ny: 0.707, nz: 0.701 }
  },
  {
    ball: 5,
    box: { x: -235.504, y: 30.542, z: -42.384, yaw: -96.10 },
    screen: { x: -235.517, y: 30.678, z: -42.260, nx: -0.075, ny: 0.707, nz: 0.703 }
  },
  {
    ball: 6,
    box: { x: -237.229, y: 30.545, z: -33.583, yaw: -94.82 },
    screen: { x: -237.239, y: 30.680, z: -33.458, nx: -0.059, ny: 0.707, nz: 0.705 }
  },
  {
    ball: 7,
    box: { x: -238.531, y: 30.543, z: -24.717, yaw: -93.40 },
    screen: { x: -238.538, y: 30.678, z: -24.592, nx: -0.042, ny: 0.707, nz: 0.706 }
  },
  {
    ball: 8,
    box: { x: -239.413, y: 30.545, z: -15.791, yaw: -92.16 },
    screen: { x: -239.417, y: 30.681, z: -15.666, nx: -0.026, ny: 0.707, nz: 0.707 }
  },
  {
    ball: 9,
    box: { x: -239.881, y: 30.544, z: -6.844, yaw: -90.71 },
    screen: { x: -239.883, y: 30.679, z: -6.719, nx: -0.008, ny: 0.707, nz: 0.707 }
  },
  {
    ball: 10,
    box: { x: -240.034, y: 30.546, z: 2.122, yaw: -89.37 },
    screen: { x: -240.033, y: 30.681, z: 2.247, nx: 0.008, ny: 0.707, nz: 0.707 }
  },
  {
    ball: 11,
    box: { x: -239.579, y: 30.542, z: 11.084, yaw: -87.87 },
    screen: { x: -239.575, y: 30.678, z: 11.209, nx: 0.027, ny: 0.707, nz: 0.707 }
  },
  {
    ball: 12,
    box: { x: -238.812, y: 30.543, z: 20.010, yaw: -86.87 },
    screen: { x: -238.805, y: 30.678, z: 20.135, nx: 0.039, ny: 0.707, nz: 0.706 }
  },
  {
    ball: 13,
    box: { x: -237.619, y: 30.544, z: 28.879, yaw: -85.29 },
    screen: { x: -237.608, y: 30.679, z: 29.004, nx: 0.059, ny: 0.707, nz: 0.705 }
  },
  {
    ball: 14,
    box: { x: -236.010, y: 30.547, z: 37.704, yaw: -84.15 },
    screen: { x: -235.997, y: 30.682, z: 37.828, nx: 0.073, ny: 0.707, nz: 0.703 }
  },
  {
    ball: 15,
    box: { x: -233.956, y: 30.543, z: 46.430, yaw: -82.51 },
    screen: { x: -233.939, y: 30.678, z: 46.553, nx: 0.093, ny: 0.707, nz: 0.701 }
  },
  {
    ball: 16,
    box: { x: -231.463, y: 30.539, z: 55.037, yaw: -81.35 },
    screen: { x: -231.444, y: 30.674, z: 55.161, nx: 0.107, ny: 0.707, nz: 0.699 }
  },
  {
    ball: 17,
    box: { x: -228.510, y: 30.538, z: 63.465, yaw: -79.87 },
    screen: { x: -228.487, y: 30.673, z: 63.588, nx: 0.125, ny: 0.707, nz: 0.696 }
  },
  {
    ball: 18,
    box: { x: -225.168, y: 30.534, z: 71.754, yaw: -78.68 },
    screen: { x: -225.144, y: 30.670, z: 71.876, nx: 0.139, ny: 0.707, nz: 0.693 }
  },
  {
    ball: 19,
    box: { x: -221.12, y: 30.534, z: 79.88, yaw: -77.6 },
    screen: { x: -221.12, y: 30.670, z: 79.92, nx: 0.139, ny: 0.707, nz: 0.693 }
  }
]

// The bay whose panel opened the menu, or 0 if none. Ball N sits by bay N.
let activeBay = 0

export function getActiveBay(): number {
  return tutorial.active ? TUTORIAL_BAY : activeBay
}

export function setupTeeOffPanels(): void {
  const panels = engine.getEntityOrNullByName(PANEL_ENTITY_NAME)
  if (!panels) {
    console.log(`[tee-off] no entity named "${PANEL_ENTITY_NAME}" in the scene, panels are not clickable`)
    return
  }

  for (const p of PANELS) {
    const box: Entity = engine.addEntity()
    Transform.create(box, {
      parent: panels,
      position: Vector3.create(p.box.x, p.box.y, p.box.z),
      rotation: Quaternion.fromEulerDegrees(0, p.box.yaw, 0),
      scale: Vector3.create(BOX_SIZE.x, BOX_SIZE.y, BOX_SIZE.z)
    })
    MeshCollider.setBox(box, ColliderLayer.CL_POINTER)
    pointerEventsSystem.onPointerDown(
      { entity: box, opts: { button: InputAction.IA_POINTER, hoverText: HOVER_TEXT, maxDistance: MAX_DISTANCE } },
      () => {
        // Don't interrupt a swing or a ball that's still rolling
        if (isShotInProgress()) return
        // Tutorial rules: your own bay is already picked, and the tutorial bay is closed afterwards
        if (tutorial.active && p.ball === TUTORIAL_BAY) {
          showToast('This is your tutorial bay. Walk to the ball and press E to take your shot.', 4)
          return
        }
        const locked = bayLockReason(p.ball)
        if (locked) {
          playUi('score_miss')
          showToast(locked, 4)
          return
        }
        // One player per bay. Clicking a free bay's screen makes it yours (and lets your old one go).
        const takenBy = bayTakenBy(p.ball)
        if (takenBy || !claimBay(p.ball)) {
          playUi('score_miss')
          showToast(`Bay ${p.ball} is in use by ${takenBy || 'another player'}. Pick a free bay.`, 4)
          return
        }
        activeBay = p.ball
        openPixelGolfMenu()
      }
    )
  }
}

// --- Score screens -------------------------------------------------------------

type Screen = { state: GameState; score: Entity; shots: Entity; last: Entity; zone: Entity; key: string }

function formatNumber(n: number): string {
  const sign = n < 0 ? '-' : ''
  const digits = String(Math.abs(Math.round(n)))
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return sign + out
}

// TextShape sizes are roughly a tenth of a metre per point, with capitals about 0.72 of that
function fontSizeFor(cap: number): number {
  return (cap / 0.072) * TEXT_SCALE
}

function addText(parent: Entity, slot: { x: number; y: number; cap: number }, color: Color4, text = ''): Entity {
  const e = engine.addEntity()
  // A few millimetres in front of the picture, towards the player
  Transform.create(e, { parent, position: Vector3.create(slot.x, slot.y, -0.006) })
  TextShape.create(e, {
    text,
    fontSize: fontSizeFor(slot.cap),
    font: Font.F_SANS_SERIF,
    textColor: color,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    textWrapping: false
  })
  return e
}

/**
 * Puts each bay's score on its panel screen. Pass every ball's game state with the
 * ball's entity name (Ball_1 to Ball_18), as index.ts does after creating the games.
 */
export function setupTeeOffScreens(games: { name: string; state: GameState }[]): void {
  const panels = engine.getEntityOrNullByName(PANEL_ENTITY_NAME)
  if (!panels) return

  const screens: Screen[] = []
  for (const g of games) {
    const ball = Number(g.name.replace('Ball_', ''))
    const p = PANELS.find((x) => x.ball === ball)
    if (!p) continue

    const s = p.screen
    const normal = Vector3.create(s.nx, s.ny, s.nz)
    // "Up" on the screen is straight up, flattened onto the sloped face
    const worldUp = Vector3.Up()
    const up = Vector3.normalize(Vector3.subtract(worldUp, Vector3.scale(normal, Vector3.dot(worldUp, normal))))
    // The root's -Z side faces the player, which is the side planes and text read correctly from
    const forward = Vector3.scale(normal, -FACE_DIRECTION)
    const centre = Vector3.add(Vector3.create(s.x, s.y, s.z), Vector3.scale(normal, SCREEN_LIFT))

    // root: on the screen, -Z towards the player, +Y up the slope
    const root = engine.addEntity()
    Transform.create(root, { parent: panels, position: centre, rotation: Quaternion.lookRotation(forward, up) })

    // The picture, and the live text on it
    const card = engine.addEntity()
    Transform.create(card, { parent: root, position: Vector3.create(0, SCREEN_SHIFT_UP, 0) })
    const bg = engine.addEntity()
    Transform.create(bg, { parent: card, scale: Vector3.create(SCREEN_SIZE.x, SCREEN_SIZE.y, 1) })
    MeshRenderer.setPlane(bg)
    // Lit like a display: the picture is its own glow, so it reads in shade and at a distance
    const screenTexture = Material.Texture.Common({ src: SCREEN_IMAGE })
    Material.setPbrMaterial(bg, {
      texture: screenTexture,
      emissiveTexture: screenTexture,
      emissiveColor: Color4.White(),
      emissiveIntensity: SCREEN_GLOW,
      metallic: 0,
      roughness: 1,
      specularIntensity: 0
    })

    addText(card, SLOTS.bay, Color4.White(), `BAY ${ball}`)
    screens.push({
      state: g.state,
      score: addText(card, SLOTS.score, INK),
      shots: addText(card, SLOTS.shots, INK),
      last: addText(card, SLOTS.last, INK),
      zone: addText(card, SLOTS.zone, GREY),
      key: ''
    })
  }

  // Only touch the text when something has changed
  engine.addSystem(() => {
    for (const sc of screens) {
      const st = sc.state
      const played = st.shot > 0
      const last = played ? `${st.lastShotScore >= 0 ? '+' : ''}${formatNumber(st.lastShotScore)}` : '-'
      // Red1 -> Red
      const zone = played ? st.lastZone.replace(/\d+$/, '') + (st.lastHot ? ' 2X' : '') : ''
      const key = `${st.score}|${st.shot}|${last}|${zone}`
      if (key === sc.key) continue
      sc.key = key
      TextShape.getMutable(sc.score).text = formatNumber(st.score)
      TextShape.getMutable(sc.shots).text = `${st.shot}/${ROUND_BALLS}`
      TextShape.getMutable(sc.last).text = last
      TextShape.getMutable(sc.zone).text = zone
    }
  })
}
