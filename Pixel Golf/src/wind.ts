import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { wind, tutorial } from './ledger/client'

/**
 * Turns every target flag in the scene (any entity showing assets/Course/Flag.glb, 11 of them)
 * so its cloth points the way the wind is blowing, swinging round smoothly when it changes.
 * In a calm (or in the tutorial, which is always calm) they're left as they were placed.
 *
 * Each flag turns about its own origin, which should be the bottom of its pole.
 *
 * FLAG_CLOTH_YAW: which way the cloth points in the flag model itself, in degrees (0 = the
 * model's +z, 90 = its +x). If the flags point into the wind instead of with it, add 180; if
 * they're a quarter turn out, add or take 90.
 */
const FLAG_CLOTH_YAW = 90
const FLAG_MODEL = /(^|\/)Flag\.glb$/i
/** Below this the wind counts as calm (m/s) */
const CALM = 0.3
/** How fast a flag swings round to a new wind (degrees a second) */
const TURN_SPEED = 45

type Flag = { entity: Entity; placedYaw: number; yaw: number; parentYaw: number }
let flags: Flag[] | null = null
let lookedFor = 0

/** The total turn about Y of an entity's parents */
function parentsYaw(e: Entity): number {
  let yaw = 0
  let p = Transform.getOrNull(e)?.parent
  for (let depth = 0; p !== undefined && p !== engine.RootEntity && depth < 16; depth++) {
    const t = Transform.getOrNull(p)
    if (!t) break
    yaw += Quaternion.toEulerAngles(t.rotation).y
    p = t.parent
  }
  return yaw
}

function findFlags(): Flag[] {
  const found: Flag[] = []
  for (const [entity, gltf] of engine.getEntitiesWith(GltfContainer, Transform)) {
    if (!FLAG_MODEL.test(gltf.src)) continue
    const yaw = Quaternion.toEulerAngles(Transform.get(entity).rotation).y
    found.push({ entity, placedYaw: yaw, yaw, parentYaw: parentsYaw(entity) })
  }
  return found
}

function angleDelta(from: number, to: number): number {
  let d = (to - from) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

function windFlagsSystem(dt: number): void {
  // The scene's entities can take a moment to load: look for a few seconds, then stop
  if (!flags || (flags.length === 0 && lookedFor < 10)) {
    lookedFor += dt
    flags = findFlags()
    if (flags.length) console.log(`[wind] ${flags.length} flags found`)
    if (!flags.length) return
  }
  const calm = !wind.ready || wind.speed < CALM || tutorial.active
  for (const f of flags) {
    // The flag's own (local) turn that points its cloth downwind
    const target = calm ? f.placedYaw : wind.dir - FLAG_CLOTH_YAW - f.parentYaw
    const d = angleDelta(f.yaw, target)
    if (Math.abs(d) < 0.2) continue
    const step = TURN_SPEED * dt
    f.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step
    Transform.getMutable(f.entity).rotation = Quaternion.fromEulerDegrees(0, f.yaw, 0)
  }
}

export function setupWindFlags(): void {
  engine.addSystem(windFlagsSystem, undefined, 'wind-flags')
}

// ---------------------------------------------------------------------------
// For the range card: the wind as you see it from where you're looking
// ---------------------------------------------------------------------------

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']

/**
 * The wind relative to the camera: an arrow (up = blowing away from you, the way you're
 * looking), its strength in mph, and a word or two for what it'll do to a shot hit that way.
 */
export function windReadout(): { arrow: string; mph: string; words: string; calm: boolean } {
  if (tutorial.active || !wind.ready || wind.speed < CALM) return { arrow: '', mph: 'Calm', words: '', calm: true }
  const cam = Transform.getOrNull(engine.CameraEntity)
  const camYaw = cam ? Quaternion.toEulerAngles(cam.rotation).y : 0
  const rel = ((wind.dir - camYaw) % 360 + 360) % 360
  const arrow = ARROWS[Math.round(rel / 45) % 8]
  const r = (rel * Math.PI) / 180
  const along = Math.cos(r) // + blowing the way you're looking
  const cross = Math.sin(r) // + blowing to your right
  const parts: string[] = []
  if (along > 0.38) parts.push('Helping')
  else if (along < -0.38) parts.push('Against')
  if (cross > 0.38) parts.push('left to right')
  else if (cross < -0.38) parts.push('right to left')
  let words = parts.join(', ')
  words = words.charAt(0).toUpperCase() + words.slice(1)
  return { arrow, mph: `${Math.round(wind.speed * 2.237)} mph`, words, calm: false }
}
