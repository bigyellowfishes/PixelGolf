import { engine, Entity, Transform, AudioSource } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { PathPlayer, Vec3 } from './ballSim'
import { playAt } from './sfx'
import { sfxLevel } from './audio'

// The ball's own sounds as a shot plays back (index.ts playShots calls these):
//  - every bounce: a thud, quieter for smaller bounces (ball_land)
//  - hitting a flag's pole: a metal clank instead (flag_clank)
//  - the first time it comes down inside a target's ring: a little chime (ring_chime), before
//    the score jingle
//  - rolling along the ground after its last bounce: a soft rumble that fades as it slows
//    (ball_roll.wav, looped)
//
// The flag poles are solid in the course collision: their boxes were read from
// collisionData/course_collision.ts (2026-11-03). A bounce inside one, above the grass, is a pole hit.

const FLAGS = [
  { x: 181.7, z: 300.85 },
  { x: 179.15, z: 266.35 },
  { x: 179.15, z: 233.05 },
  { x: 181.65, z: 198.41 },
  { x: 223.1, z: 278.65 },
  { x: 223.1, z: 220.75 },
  { x: 273.2, z: 249.85 },
  { x: 330.8, z: 218.35 },
  { x: 371.3, z: 281.35 },
  { x: 413.37, z: 218.27 }
]
/** The poles' boxes reach about this far from the flag (m), from the grass (FLAG_GROUND) to FLAG_TOP */
const FLAG_REACH = 1.05
const FLAG_GROUND = 0.94
const FLAG_TOP = 3.1
/** A bounce this far above the grass, inside a pole's box, is a pole hit (m) */
const FLAG_ABOVE = 0.2

/** The rolling sound: loudest at this speed (m/s), and silent below ROLL_MIN */
const ROLL_FULL = 6
const ROLL_MIN = 0.15
const ROLL_VOLUME = 0.55
const ROLL_CLIP = 'assets/sounds/ball_roll.wav'

/** The targets' scoring boxes (ScoreZones in index.ts, bunkers left out), passed in by index.ts */
let zones: () => Entity[] = () => []
export function setBallSoundZones(fn: () => Entity[]): void {
  zones = fn
}

function inRing(p: Vec3): boolean {
  for (const e of zones()) {
    const t = Transform.getOrNull(e)
    if (!t) continue
    const rel = Vector3.create(p.x - t.position.x, p.y - t.position.y, p.z - t.position.z)
    const local = Vector3.rotate(rel, Quaternion.create(-t.rotation.x, -t.rotation.y, -t.rotation.z, t.rotation.w))
    if (Math.abs(local.x) <= Math.abs(t.scale.x) / 2 && Math.abs(local.z) <= Math.abs(t.scale.z) / 2 && Math.abs(local.y) <= Math.abs(t.scale.y) / 2 + 0.3) return true
  }
  return false
}

function onPole(p: Vec3): boolean {
  if (p.y < FLAG_GROUND + FLAG_ABOVE || p.y > FLAG_TOP + 0.3) return false
  for (const f of FLAGS) if (Math.hypot(p.x - f.x, p.z - f.z) <= FLAG_REACH) return true
  return false
}

type Track = { chimed: boolean; last: Vec3 | null; roll: Entity | null; rolling: boolean }
const tracks = new Map<string, Track>()
const players = new WeakMap<PathPlayer, true>()

function trackFor(ball: string, player: PathPlayer): Track {
  let t = tracks.get(ball)
  if (!t) {
    t = { chimed: false, last: null, roll: null, rolling: false }
    tracks.set(ball, t)
  }
  // A new shot on this ball: start afresh
  if (!players.has(player)) {
    players.set(player, true)
    t.chimed = false
    t.last = null
    stopRoll(t)
  }
  return t
}

/** A bounce at `pos` with this impact speed (m/s) */
export function ballBounce(ball: string, player: PathPlayer, pos: Vec3, impact: number): void {
  const t = trackFor(ball, player)
  const at = { x: pos.x, y: pos.y, z: pos.z }
  if (onPole(at)) {
    playAt('flag_clank', at, Math.min(1, 0.4 + impact / 15))
    return
  }
  playAt('ball_land', at, Math.min(1, impact / 12))
  if (!t.chimed && inRing(at)) {
    t.chimed = true
    playAt('ring_chime', at)
  }
}

function stopRoll(t: Track): void {
  if (t.roll && t.rolling) AudioSource.getMutable(t.roll).playing = false
  t.rolling = false
}

/**
 * Each frame of a shot's playback: keeps the rolling sound going while the ball rolls along the
 * ground after its last bounce. `secs` is how much of the shot played this frame (s).
 */
export function ballRoll(ball: string, player: PathPlayer, pos: Vec3, secs: number): void {
  const t = trackFor(ball, player)
  const last = t.last
  t.last = { x: pos.x, y: pos.y, z: pos.z }
  if (!last || secs <= 0) return
  const speed = Math.hypot(pos.x - last.x, pos.z - last.z) / secs
  const climb = Math.abs(pos.y - last.y) / secs
  const level = sfxLevel()
  const rolling = player.bounced && !player.bouncesLeft && speed > ROLL_MIN && climb < 1.5 && level > 0
  if (!rolling) {
    stopRoll(t)
    return
  }
  if (!t.roll) {
    t.roll = engine.addEntity()
    Transform.create(t.roll, {})
  }
  Transform.getMutable(t.roll).position = Vector3.create(pos.x, pos.y, pos.z)
  const volume = ROLL_VOLUME * level * Math.min(1, speed / ROLL_FULL)
  if (!t.rolling) {
    t.rolling = true
    AudioSource.createOrReplace(t.roll, { audioClipUrl: ROLL_CLIP, playing: true, loop: true, global: false, volume, pitch: 0.9 + Math.min(0.3, speed / 20), currentTime: 0 })
  } else {
    AudioSource.getMutable(t.roll).volume = volume
  }
}

/** The shot on this ball has finished (or was stopped): silence its roll */
export function ballStopped(ball: string): void {
  const t = tracks.get(ball)
  if (t) stopRoll(t)
}
