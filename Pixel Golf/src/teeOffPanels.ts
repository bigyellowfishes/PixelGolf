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
  Material,
  PointerEvents,
  raycastSystem,
  RaycastQueryType
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { openPixelGolfMenu, state as pixelGolfMenu } from './ui/GameModeMenu'
import { state as clubMenu } from './ui/ClubSelectMenu'
import { isShotInProgress, GameState, getAllGames, playerBusy, roundInProgress, requestShotStart, stepOutForMenu, menuKeyAllowed } from './game'
import { onMenuKey } from './menuGuard'
import { ROUND_BALLS } from './ledger/rules'
import { bayTakenBy, claimBay, bayLockReason, tutorial, myBay, leaveBay, TUTORIAL_BAY, TUTORIAL_BALLS } from './ledger/client'
import { onPhone } from './mobile'
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
    // The end panel past bay 18, measured from the model the same way as the others
    ball: 20,
    box: { x: -220.14, y: 30.542, z: -84.25, yaw: -102.23 },
    screen: { x: -220.14, y: 30.678, z: -84.26, nx: -0.158, ny: 0.707, nz: 0.691 }
  },
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
    box: { x: -221.141, y: 30.542, z: 79.782, yaw: -77.23 },
    screen: { x: -221.115, y: 30.678, z: 79.903, nx: 0.157, ny: 0.707, nz: 0.69 }
  }
]

// The bay whose panel opened the menu, or 0 if none. Ball N sits by bay N.
let activeBay = 0

export function getActiveBay(): number {
  return tutorial.active ? TUTORIAL_BAY : activeBay
}

/**
 * What tapping a bay's Tee Off screen does: join that bay and open the Pixel Golf menu. Used by
 * the screens' click boxes, and on phones by walking up to a bay's ball (setupAutoTeeOff).
 * quiet: no sound or message when it can't, for the walk-in (which tries every bay you pass).
 */
/** The bay's menus (the Pixel Golf menu and the club picker) close when you walk off. */
function closeBayMenus(): void {
  if (pixelGolfMenu.display === 'flex' || clubMenu.display === 'flex') playUi('ui_close')
  pixelGolfMenu.display = 'none'
  clubMenu.display = 'none'
}

// Walking into a bay only opens the Pixel Golf menu until the player has seen it once. After
// that a walk-in just takes the bay, and the menu opens when they click a Tee Off screen.
let menuSeen = false

// The click that closes a menu (its X, Tee off, Continue) also lands on the Tee Off screen
// behind it, which opened the menu straight back up. The screens ignore clicks while any menu
// is open and for this long after.
const MENU_CLICK_GUARD_MS = 1000
let menuOpenFn: () => boolean = () => false
let menuOpenAt = 0
function menuJustOpen(): boolean {
  return menuOpenFn() || Date.now() - menuOpenAt < MENU_CLICK_GUARD_MS
}


/**
 * Takes a bay. quiet: no sounds or callouts when it can't (walking past). menu: open the Pixel
 * Golf menu ('auto' = only if the player hasn't seen it yet this visit).
 */
export function teeOff(bay: number, quiet = false, menu: boolean | 'auto' = true): boolean {
  // Don't interrupt a swing or a ball that's still rolling
  if (isShotInProgress()) return false
  // Tutorial rules: your own bay is already picked, and the tutorial bay is closed afterwards
  if (tutorial.active && bay === TUTORIAL_BAY) {
    if (!quiet) showToast('This is your tutorial bay. Walk to the ball and press E to take your shot.', 4)
    return false
  }
  const locked = bayLockReason(bay)
  if (locked) {
    if (!quiet) {
      playUi('score_miss')
      showToast(locked, 4)
    }
    return false
  }
  // One player per bay (the solo bay takes anyone). Joining a free bay lets your old one go.
  const takenBy = bayTakenBy(bay)
  if (takenBy || !claimBay(bay)) {
    if (!quiet) {
      playUi('score_miss')
      showToast(`Bay ${bay} is in use by ${takenBy || 'another player'}. Pick a free bay.`, 4)
    }
    return false
  }
  activeBay = bay
  if (menu === true || (menu === 'auto' && !menuSeen)) {
    menuSeen = true
    // Walking in (quiet) isn't held up by the second's wait after a menu closes: that wait is
    // for clicks, which could land on the screen behind the menu just closed
    openPixelGolfMenu(quiet)
  }
  return true
}

// Walking up to a bay's ball (this close, in metres) joins it as if its Tee Off screen was
// clicked, and opens the Pixel Golf menu
const AUTO_TEE_OFF_RANGE = 3
// Walking this far (metres) from your own bay's ball lets the bay go, so anyone can use it.
// Your round in progress goes with you to the next bay you walk into (game.ts).
const LEAVE_BAY_RANGE = 10
// Leaving a bay's walk-in zone takes this much further (metres) than entering it
const EDGE_LEEWAY = 1.5

// --- On the putting area or on the wood --------------------------------------
// The bay menus only stay open while you're standing on a putting area. The putting areas are
// part of Tee Off Panels.glb and the wood between and behind them isn't, so a ray straight down
// from the player says which you're on: any hit on the Tee Off Panels model is a putting area.
// Until the ray has found that model under you once, nothing is held back (so if the model ever
// stops having floor colliders, the bays work by distance alone as they did before).
/** Seconds off a putting area before the menus close, so a seam or a hop doesn't shut them */
const OFF_PAD_SECONDS = 0.25
/** The ray starts this far above the player's position and reaches this far down (metres) */
const PAD_RAY_LIFT = 1
const PAD_RAY_LENGTH = 4
let padSeen = false
let onPadNow = false
let offPadFor = 0
let lastPadMesh = ''

function setupPadCheck(): void {
  const panels = engine.getEntityOrNullByName(PANEL_ENTITY_NAME)
  if (!panels) return
  const probe = engine.addEntity()
  Transform.create(probe, { position: Vector3.create(0, -100, 0) })
  // Follows the player; the continuous ray goes with it. Only moved when the player has moved a
  // little, so standing still doesn't send it to the renderer every frame.
  let at = Vector3.create(0, -100, 0)
  engine.addSystem(() => {
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (!me) return
    const p = me.position
    if (Math.abs(p.x - at.x) < 0.05 && Math.abs(p.z - at.z) < 0.05 && Math.abs(p.y + PAD_RAY_LIFT - at.y) < 0.05) return
    at = Vector3.create(p.x, p.y + PAD_RAY_LIFT, p.z)
    Transform.getMutable(probe).position = at
  })
  raycastSystem.registerGlobalDirectionRaycast(
    {
      entity: probe,
      opts: {
        direction: Vector3.create(0, -1, 0),
        maxDistance: PAD_RAY_LENGTH,
        queryType: RaycastQueryType.RQT_QUERY_ALL,
        continuous: true,
        collisionMask: ColliderLayer.CL_PHYSICS
      }
    },
    (result) => {
      let pad = false
      let mesh = ''
      for (const hit of result.hits) {
        if (hit.entityId === panels) {
          pad = true
          mesh = hit.meshName ?? ''
          break
        }
        if (!mesh) mesh = `${hit.meshName ?? '?'} (entity ${hit.entityId})`
      }
      if (pad) padSeen = true
      onPadNow = pad
      if (mesh !== lastPadMesh) {
        lastPadMesh = mesh
        console.log(`[tee-off] standing on ${pad ? 'a putting area' : 'something else'}: ${mesh || 'nothing'}`)
      }
    }
  )
}

/** On a putting area (or not known yet). Held true for a moment after stepping off. */
function onPuttingArea(dt: number): boolean {
  if (!padSeen) return true
  offPadFor = onPadNow ? 0 : offPadFor + dt
  return offPadFor < OFF_PAD_SECONDS
}

/**
 * Bays by walking, on every platform:
 *   - walk up to a free bay's ball and it's yours (once per visit: walk away and back to do it
 *     again; never for the bay that's already yours, mid-shot or with a menu open; quietly
 *     nothing for a bay that's in use or closed). With a round in progress the next shot starts
 *     straight away; otherwise the Pixel Golf menu opens (Tee off in the club picker then starts
 *     the shot). Clicking a Tee Off screen always opens the menu.
 *   - walk away from your bay's ball and the bay is freed for everyone, and the menus close
 * The Tee Off screens still work as before.
 */
/**
 * F (with no menu open): the Pixel Golf menu for the bay you're standing in, the same as clicking
 * its Tee Off screen used to. Free bay: it becomes yours. Mid-shot it works while you're setting
 * power or curve; the shot is put on hold and you're back at the power meter when the menu
 * closes. Not in the tutorial, and nothing if you're not in a bay.
 */
function openBayMenuByKey(): void {
  if (tutorial.active || !menuKeyAllowed()) return
  // Mid-shot the walk-in check is paused, so the bay is the one you're playing
  const bay = playerBusy() ? myBay() : bayHere
  if (!bay || bay === TUTORIAL_BAY) return
  stepOutForMenu()
  teeOff(bay, false, true)
}

/** The bay you're standing in (on its putting area, near its ball), or 0 */
let bayHere = 0

export function setupAutoTeeOff(menuOpen: () => boolean): void {
  let lastBay = 0
  onMenuKey(openBayMenuByKey)
  // A bay is only let go once you've been near its ball since it became yours, so clicking a
  // Tee Off screen from a little way off doesn't lose the bay before you've walked up to it
  let armedFor = 0
  menuOpenFn = menuOpen
  setupPadCheck()
  engine.addSystem((dt) => {
    if (menuOpen()) menuOpenAt = Date.now()
    const onPad = onPuttingArea(dt)
    // Stepped off the putting area onto the wood: the bay's menus close (the bay stays yours
    // until you walk 10 m away; step back on and the menu opens again)
    if (!onPad && !tutorial.active && (pixelGolfMenu.display === 'flex' || clubMenu.display === 'flex')) closeBayMenus()
    if (playerBusy()) return
    let near = 0
    let nearest = AUTO_TEE_OFF_RANGE
    let mineDistance = -1
    let stillIn = false
    const mine = myBay()
    // Distances from each bay's tee, not its ball: the ball is out on the range during a shot,
    // and for a frame after it's put back its distance is still the old one, which once read as
    // the player walking away and let their bay go
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (!me) return
    for (const g of getAllGames()) {
      const t = g.teePosition()
      const dx = t.x - me.position.x
      const dz = t.z - me.position.z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (g.bay > 0 && d <= nearest) {
        nearest = d
        near = g.bay
      }
      if (g.bay === mine) mineDistance = d
      // Still counts as in the last bay until you're a little further out than you came in,
      // so standing on the edge doesn't keep opening the menu
      if (near === 0 && g.bay === lastBay && d <= AUTO_TEE_OFF_RANGE + EDGE_LEEWAY) stillIn = true
    }
    if (near === 0 && stillIn) near = lastBay
    // Only on a putting area counts as in a bay
    if (!onPad) near = 0

    // Walked away from your bay: free it (not the tutorial bay, which is never claimed)
    if (mine && mine !== TUTORIAL_BAY && mineDistance >= 0) {
      if (mineDistance <= LEAVE_BAY_RANGE) armedFor = mine
      else if (armedFor === mine) {
        armedFor = 0
        leaveBay()
        closeBayMenus()
      }
    }

    bayHere = near
    if (near !== lastBay) {
      // Left the last bay (or walked into a new one): this one gets its turn
      lastBay = near
      if (near === 0 || menuOpen()) return
      // Walked back into your own bay after stepping out of it: the menu opens again
      if (near === myBay()) {
        if (near !== TUTORIAL_BAY && !tutorial.active) openPixelGolfMenu(true)
        return
      }
      // With a round in progress you carry straight on with your next shot; otherwise the menu
      // opens to pick a club, and Tee off puts you into the shot
      const continuing = roundInProgress() !== null
      if (teeOff(near, true, !continuing)) {
        armedFor = near
        if (continuing) requestShotStart(0, true)
      }
    }
  })
}

/**
 * How far a bay is turned from facing straight down the range, in degrees (+ turns the same
 * way as Quaternion.fromEulerDegrees about Y). The bays sit on a curve and each pad is built at
 * the same angle as its Tee Off panel, which faces straight down the range at a box yaw of -90.
 * Includes any turn on the panels model itself. 0 if the bay isn't in PANELS.
 */
export function bayYaw(ball: number): number {
  const p = PANELS.find((x) => x.ball === ball)
  if (!p) return 0
  // Any turn on the panels model and the groups it sits in
  let parentYaw = 0
  let e: Entity | undefined = engine.getEntityOrNullByName(PANEL_ENTITY_NAME) ?? undefined
  for (let depth = 0; e !== undefined && depth < 16; depth++) {
    const t = Transform.getOrNull(e)
    if (!t) break
    parentYaw += Quaternion.toEulerAngles(t.rotation).y
    e = t.parent && t.parent !== engine.RootEntity ? t.parent : undefined
  }
  return parentYaw + p.box.yaw + 90
}

/**
 * Where a bay's Tee Off panel sits in the scene (its click box centre). The panel is part of the
 * bay's model, so it's a fixed point on the pad, which the ball isn't quite. null if unknown.
 */
export function bayAnchor(ball: number): { x: number; z: number } | null {
  const p = PANELS.find((x) => x.ball === ball)
  const panels = engine.getEntityOrNullByName(PANEL_ENTITY_NAME)
  if (!p || !panels) return null
  // Up through every parent: the panels model can sit inside a group in the scene, and each
  // Transform is relative to its own parent
  let point = Vector3.create(p.box.x, p.box.y, p.box.z)
  let e: Entity | undefined = panels
  for (let depth = 0; e !== undefined && depth < 16; depth++) {
    const t = Transform.getOrNull(e)
    if (!t) break
    const scaled = Vector3.create(point.x * t.scale.x, point.y * t.scale.y, point.z * t.scale.z)
    point = Vector3.add(t.position, Vector3.rotate(scaled, t.rotation))
    e = t.parent && t.parent !== engine.RootEntity ? t.parent : undefined
  }
  return { x: point.x, z: point.z }
}

export function setupTeeOffPanels(): void {
  const panels = engine.getEntityOrNullByName(PANEL_ENTITY_NAME)
  if (!panels) {
    console.log(`[tee-off] no entity named "${PANEL_ENTITY_NAME}" in the scene, panels are not clickable`)
    return
  }

  // The screens aren't clickable any more: F opens the bay's menu instead (openBayMenuByKey)
}

// --- Score screens -------------------------------------------------------------

type Screen = { state: GameState; balls: number; score: Entity; shots: Entity; last: Entity; zone: Entity; key: string }

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
 * ball's entity name (Ball_1 to Ball_19), as index.ts does after creating the games.
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

    // Dray Bay Text
    if(ball == 20) {
      addText(card, SLOTS.bay, Color4.White(), `SOLO BAY`)
    } else if(ball == 19) {
      addText(card, SLOTS.bay, Color4.White(), `TUTORIAL`)
    } else {
      addText(card, SLOTS.bay, Color4.White(), `BAY ${ball}`)
    }

    // Display Round Text
    screens.push({
      state: g.state,
      balls: ball === TUTORIAL_BAY ? TUTORIAL_BALLS : ROUND_BALLS,
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
      TextShape.getMutable(sc.shots).text = `${st.shot}/${sc.balls}`
      TextShape.getMutable(sc.last).text = last
      TextShape.getMutable(sc.zone).text = zone
    }
  })
}
