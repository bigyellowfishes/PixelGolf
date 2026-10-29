import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { afkTick, tutorial } from './ledger/client'
import { XP } from './ledger/rules'
import { isShotInProgress, setAfkPractice } from './game'
import { playUi } from './sfx'

// The AFK practice area: the curved practice range with the big course screen (Training Area
// Frame.glb, beside bays 1 and 20). Walk onto its grass and a box asks if you'd like to practise
// (ui/AfkPrompt.tsx). Say yes and you're moved to a practice spot facing the screen, and your
// avatar plays the full drive (Golf_Drive_emote.glb) on a loop, club in hand, until you walk off or press Stop
// (ui/AfkHud.tsx).
//
//   - Every XP.afkTickSeconds there pays XP.afkPerTick (ledger/rules.ts: 1 XP every 10 seconds; the server checks the
//     timing and never pays Pixel Points).
//   - The bonus for everyone else: you still count as a player in the space, so you raise the
//     shared multiplier's ceiling for everyone playing rounds.
//
// The area's shape was read from the model: its grass is a quarter ring around CENTRE, between
// INNER and OUTER, from ANGLE_FROM to ANGLE_TO, with the screen standing on the outer edge.

const CENTRE = { x: 79.74, z: 182.33 }
const INNER = 12.2
const OUTER = 22.2
/** Degrees round from +x (towards +z) */
const ANGLE_FROM = 180
const ANGLE_TO = 270
const FLOOR_Y = 35.06
/** Practice spots: this far out from the centre, facing the screen */
const SPOT_RADIUS = 15
const SPOTS = 6
/** Walk this far from your spot and practice stops */
const WANDER = 1.5

export const afk = {
  /** On the practice grass now */
  inside: false,
  /** Practising now */
  active: false,
  /** Asked already this visit, so the box doesn't pop up again until you walk off and back */
  asked: false,
  /** The prompt is showing */
  prompt: false,
  /** This session: minutes paid and the XP they came to */
  minutes: 0,
  xp: 0,
  /** Seconds into this session */
  seconds: 0
}

let spot = Vector3.Zero()
let sinceMinute = 0
let settle = 0

function angleOf(x: number, z: number): number {
  const a = (Math.atan2(z - CENTRE.z, x - CENTRE.x) * 180) / Math.PI
  return (a + 360) % 360
}

function onGrass(p: Vector3): boolean {
  const r = Math.hypot(p.x - CENTRE.x, p.z - CENTRE.z)
  const a = angleOf(p.x, p.z)
  return r >= INNER && r <= OUTER && a >= ANGLE_FROM && a <= ANGLE_TO && p.y > FLOOR_Y - 2 && p.y < FLOOR_Y + 4
}

/** The practice spot nearest the player, spread evenly along the ring */
function nearestSpot(p: Vector3): { at: Vector3; facing: Vector3 } {
  let best = { at: Vector3.Zero(), facing: Vector3.Zero(), d: Infinity }
  for (let i = 0; i < SPOTS; i++) {
    const deg = ANGLE_FROM + ((ANGLE_TO - ANGLE_FROM) * (i + 0.5)) / SPOTS
    const rad = (deg * Math.PI) / 180
    const at = Vector3.create(CENTRE.x + Math.cos(rad) * SPOT_RADIUS, FLOOR_Y, CENTRE.z + Math.sin(rad) * SPOT_RADIUS)
    // Looking out at the screen
    const facing = Vector3.create(CENTRE.x + Math.cos(rad) * (OUTER - 1), FLOOR_Y + 1.6, CENTRE.z + Math.sin(rad) * (OUTER - 1))
    const d = Vector3.distance(at, p)
    if (d < best.d) best = { at, facing, d }
  }
  return best
}

/** Yes on the prompt: take a spot and start swinging */
export function startAfk(): void {
  afk.prompt = false
  if (!Transform.has(engine.PlayerEntity)) return
  const s = nearestSpot(Transform.get(engine.PlayerEntity).position)
  spot = s.at
  void movePlayerTo({ newRelativePosition: s.at, avatarTarget: s.facing, cameraTarget: s.facing })
  afk.active = true
  afk.minutes = 0
  afk.xp = 0
  afk.seconds = 0
  sinceMinute = 0
  settle = 1.5
  setAfkPractice(true)
  playUi('ui_select')
}

/** Stop on the panel, or walking off */
export function stopAfk(): void {
  if (!afk.active) return
  afk.active = false
  setAfkPractice(false)
  playUi('ui_close')
}

/** No on the prompt */
export function declineAfk(): void {
  afk.prompt = false
  playUi('ui_close')
}

export function setupAfk(anyMenuOpen: () => boolean): void {
  engine.addSystem((dt) => {
    if (!Transform.has(engine.PlayerEntity)) return
    const p = Transform.get(engine.PlayerEntity).position
    const inside = onGrass(p)

    if (inside !== afk.inside) {
      afk.inside = inside
      if (!inside) {
        afk.asked = false
        afk.prompt = false
      }
    }

    // Walked onto the grass: ask once per visit (not in the tutorial, mid-shot or over a menu)
    if (inside && !afk.active && !afk.asked && !tutorial.active && !isShotInProgress() && !anyMenuOpen()) {
      afk.asked = true
      afk.prompt = true
      playUi('ui_open')
    }

    if (!afk.active) return
    // Walking away ends it (after a moment to land on the spot)
    if (settle > 0) settle -= dt
    else if (Vector3.distance(Vector3.create(p.x, spot.y, p.z), spot) > WANDER || !inside) {
      stopAfk()
      return
    }
    afk.seconds += dt
    sinceMinute += dt
    if (sinceMinute >= XP.afkTickSeconds) {
      sinceMinute -= XP.afkTickSeconds
      afkTick()
      afk.xp += XP.afkPerTick
    }
  })
}
