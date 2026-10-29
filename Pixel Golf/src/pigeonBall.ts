import { engine, Entity, Transform, Animator } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { BALL_RADIUS } from './ballSim'

// The pigeon ball (assets/Balls/Ball_Pigeon.glb, 'ball-pigeon' in ledger/rules.ts CATALOGUE).
//
// The model has two animations: Idle (pecking about, from the original model) and Fly (a wingbeat
// loop made for this: both wings opened and beating four times a second). The flight itself is
// done here in code: while the ball moves, the pigeon plays Fly, faces the way it's going,
// pitches up and down with the shot's arc, banks into curves and bobs with each wingbeat. Once the
// ball stops it settles level on the ground, keeps facing the way it flew, and goes back to Idle.
//
// index.ts calls pigeonLook() when a bay's ball model is switched to or from the pigeon, and
// pigeonFollow() wherever it moves the ball (drawBall). Everything else happens in the system here.

export const PIGEON_MODEL = 'assets/Balls/Ball_Pigeon.glb'

/** How tall the pigeon stands, in ball widths (the model is 0.58 m from feet to head top) */
const PIGEON_HEIGHT_BALLS = 2.6
const MODEL_HEIGHT = 0.58
const SCALE = (BALL_RADIUS * 2 * PIGEON_HEIGHT_BALLS) / MODEL_HEIGHT
/** In the model: its feet are 0.08 m below its origin, and its body's middle 0.13 m above */
const FEET = 0.08
const BODY = 0.13
/** Turning towards where it's heading: higher snaps round faster (per second) */
const TURN_RATE = 8
/** The steepest it pitches up or down with the arc (degrees) */
const MAX_PITCH = 35
/** Banking: degrees of lean per degree a second of turning, and the most it leans */
const BANK_PER_TURN = 0.35
const MAX_BANK = 35
/** The bob with each wingbeat in flight (metres, at this size) and the beats a second (matches Fly) */
const BOB = 0.035 * SCALE
const BEATS = 4
/** No new position for this long means the ball has stopped (seconds) */
const STILL_AFTER = 0.15
/** A jump further than this between two positions is the ball being put back, not flying (metres) */
const TELEPORT = 5
/** Facing at rest when the ball's been put back on the tee: down the range (+x) */
const HOME_YAW = 0

type Pigeon = {
  pos: Vector3
  prev: Vector3 | null
  movedAt: number
  yaw: number
  pitch: number
  bank: number
  flying: boolean
  clock: number
}

const pigeons = new Map<Entity, Pigeon>()
let now = 0
let running = false

/** Switches a ball model to the pigeon or back to a normal ball. */
export function pigeonLook(model: Entity, on: boolean, ballScale: number): void {
  const had = pigeons.has(model)
  if (on && !running) {
    // Only on a screen that has a pigeon to fly (not the game server, which loads this too)
    running = true
    engine.addSystem(update, undefined, 'pigeon-ball')
  }
  if (on && !had) {
    const t = Transform.getMutable(model)
    t.scale = Vector3.create(SCALE, SCALE, SCALE)
    pigeons.set(model, { pos: Vector3.clone(t.position), prev: null, movedAt: -1, yaw: HOME_YAW, pitch: 0, bank: 0, flying: false, clock: 0 })
    Animator.createOrReplace(model, {
      states: [
        { clip: 'Idle', playing: true, loop: true, speed: 1, weight: 1, shouldReset: false },
        { clip: 'Fly', playing: false, loop: true, speed: 1, weight: 1, shouldReset: false }
      ]
    })
    place(model, pigeons.get(model)!)
  } else if (!on && had) {
    pigeons.delete(model)
    Animator.deleteFrom(model)
    const t = Transform.getMutable(model)
    t.scale = Vector3.create(ballScale, ballScale, ballScale)
  }
}

/** True if this ball model is showing the pigeon (index.ts leaves its rotation alone then). */
export function isPigeon(model: Entity): boolean {
  return pigeons.has(model)
}

/** The ball moved: where its centre is now. */
export function pigeonFollow(model: Entity, x: number, y: number, z: number): void {
  const p = pigeons.get(model)
  if (!p) return
  const next = Vector3.create(x, y, z)
  if (Vector3.distance(next, p.pos) > TELEPORT) {
    // Put back on the tee: no flight, facing down the range
    p.prev = null
    p.yaw = HOME_YAW
    p.pos = next
    p.movedAt = -1
    return
  }
  if (Vector3.distance(next, p.pos) < 0.0005) return
  p.prev = p.pos
  p.pos = next
  p.movedAt = now
}

/** Part of the way from one heading to another (step 0 to 1), round the short way */
function angleTowards(from: number, to: number, step: number): number {
  const d = ((to - from + 540) % 360) - 180
  return from + d * step
}

function place(model: Entity, p: Pigeon): void {
  const t = Transform.getMutable(model)
  // Standing: feet on the ground under the ball. Flying: the body on the ball's path, bobbing.
  const lift = p.flying ? -BODY * SCALE + Math.sin(p.clock * BEATS * Math.PI * 2) * BOB : -BALL_RADIUS + FEET * SCALE
  t.position = Vector3.create(p.pos.x, p.pos.y + lift, p.pos.z)
  // The model faces +x: turn it to face along the yaw, then pitch its nose up (about its side,
  // z) and lean it into the turn (about its length, x)
  const yawQ = Quaternion.fromEulerDegrees(0, p.yaw, 0)
  const pitchQ = Quaternion.fromEulerDegrees(0, 0, p.pitch)
  const bankQ = Quaternion.fromEulerDegrees(p.bank, 0, 0)
  t.rotation = Quaternion.multiply(yawQ, Quaternion.multiply(pitchQ, bankQ))
}

function update(dt: number): void {
  now += dt
  for (const [model, p] of pigeons) {
    if (!Transform.has(model)) {
      pigeons.delete(model)
      continue
    }
    const flying = p.movedAt >= 0 && now - p.movedAt < STILL_AFTER
    if (flying !== p.flying) {
      p.flying = flying
      Animator.playSingleAnimation(model, flying ? 'Fly' : 'Idle', false)
    }
    if (flying && p.prev) {
      p.clock += dt
      const vx = p.pos.x - p.prev.x
      const vy = p.pos.y - p.prev.y
      const vz = p.pos.z - p.prev.z
      const flat = Math.hypot(vx, vz)
      const ease = Math.min(1, TURN_RATE * dt)
      if (flat > 0.0005) {
        // Facing: the model's +x along the way it's going
        const want = (Math.atan2(-vz, vx) * 180) / Math.PI
        const before = p.yaw
        p.yaw = angleTowards(p.yaw, want, ease)
        const turnRate = (((p.yaw - before + 540) % 360) - 180) / Math.max(dt, 1e-3)
        const wantBank = Math.max(-MAX_BANK, Math.min(MAX_BANK, -turnRate * BANK_PER_TURN))
        p.bank += (wantBank - p.bank) * ease
      }
      const wantPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, (Math.atan2(vy, Math.max(flat, 1e-4)) * 180) / Math.PI))
      p.pitch += (wantPitch - p.pitch) * ease
    } else {
      // Landed: level out, keep facing the way it flew
      const ease = Math.min(1, 6 * dt)
      p.pitch += (0 - p.pitch) * ease
      p.bank += (0 - p.bank) * ease
      p.clock = 0
    }
    place(model, p)
  }
}
