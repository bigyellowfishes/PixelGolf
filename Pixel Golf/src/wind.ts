import { engine, Entity, GltfContainer, Name, Transform, ParticleSystem, PBParticleSystem_BlendMode, PBParticleSystem_SimulationSpace } from '@dcl/sdk/ecs'
import { Quaternion, Vector3, Color4 } from '@dcl/sdk/math'
import { effectiveWind, myBay } from './ledger/client'

/**
 * Turns every target flag in the scene (any entity showing assets/Course/Flag.glb, 11 of them)
 * so its cloth points the way the wind is blowing, swinging round smoothly when it changes.
 * In a calm (the tutorial is calm except for its wind lesson) they're left as they were placed.
 *
 * Each flag turns about its own origin, which should be the bottom of its pole.
 *
 * FLAG_CLOTH_YAW: which way the cloth points in the flag model itself, in degrees (0 = the
 * model's +z, 90 = its +x). If the flags point into the wind instead of with it, add 180; if
 * they're a quarter turn out, add or take 90.
 */
// Measured from Flag.glb: the pole is on the model's origin and the cloth reaches out along the
// model's -z (to 4.25 m behind it), so the cloth points at 180
const FLAG_CLOTH_YAW = 180
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
  const wind = effectiveWind()
  const calm = !wind.ready || wind.speed < CALM
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
// Wind you can see: wavy gusts blowing over the course while you play
// ---------------------------------------------------------------------------

/*
 * While you're playing (in a bay: your own, the solo bay or the tutorial), soft wavy streaks of
 * air blow over the course, the way the wind is going, more and faster the stronger it is. None in
 * a calm, and none at all when you're not in a bay.
 *
 * They belong to the course, not to the player: two emitters, each a box fixed over the front of
 * the course (from COURSE_NEAR to COURSE_FAR down the range from the tees, and the width of the
 * bays plus COURSE_SIDE either side). The box is worked out once from the scene: the tees
 * (Ball_1 to Ball_20) and the targets (Red1 ... Black) say where the course is and which way is
 * down the range. The streaks start anywhere in the box, still, and the wind takes them: a push
 * along the wind (additionalForce) gets them going within a moment, and limitVelocity holds them
 * at the wind's flying speed. They fade out over their life, so the few that drift towards the
 * bays are gone before they reach them. They never start in the building.
 *
 * Each emitter has its own streak flipbook (assets/images/wind/wind-streak-a.png and -b.png: a
 * few thin wavy lines with a soft glow, across the middle of each square frame, as particles are
 * square, that flow as it plays; see FLIPBOOK). Particles always face the camera, so a streak is
 * always drawn level on screen; it's mirrored when the wind blows right to left as you look, so
 * its waves lead the right way. Every number below is for tuning to taste.
 */
/** How fast the streaks fly (m/s): this much, plus SPEED_PER_WIND for each m/s of wind */
const SPEED_BASE = 0.8
const SPEED_PER_WIND = 0.4
/** How hard the wind gets them going: their flying speed is reached in about 1 / this seconds */
const PICKUP = 3
/** The course box: from this far down the range from the tees to this far (m) */
const COURSE_NEAR = 10
const COURSE_FAR = 90
/** and this much wider than the line of bays, each side (m) */
const COURSE_SIDE = 10
/** Its height, and how high its middle is above the tees (m): from just off the grass to well up */
const COURSE_HIGH = 35
const COURSE_Y = 6.5
const TARGET_NAMES = /^(Red\d|Yellow\d|Green|Orange|Blue|White|Black)$/
const TEE_NAMES = /^Ball_\d+$/

/**
 * The streak pictures are flipbooks: 16 frames in a 4 x 4 grid (left to right, top to bottom),
 * each 256 px square, where the bright parts of the lines flow along the waves and the waves roll
 * on. The last frame leads back into the first, so it loops.
 */
const FLIPBOOK = { tilesX: 4, tilesY: 4 }

type Layer = {
  texture: string
  /** Flipbook frames a second (16 = one flow a second) */
  fps: number
  /** Per second over the whole course at no wind, and added per m/s of wind (a steady trickle) */
  rate: number
  ratePerWind: number
  /**
   * Gusts on top, so they come in fits and starts: every gustEvery seconds there's a gustChance
   * of a gust of gustCount streaks, plus one more for every gustPerWind m/s of wind
   */
  gustEvery: number
  gustChance: number
  gustCount: number
  gustPerWind: number
  lifetime: number
  max: number
  /** Width of a streak (m, a range) */
  size: { start: number; end: number }
  /** Size at the start and end of its life, as a share (they grow as they go) */
  grow: { start: number; end: number }
  /** Opacity at the start (a range): they fade out from there */
  alpha: { start: number; end: number }
  /** Their top speed, as a share of the flying speed */
  speed: number
}
const STREAKS_A: Layer = {
  texture: 'assets/images/wind/wind-streak-a.png',
  fps: 14,
  rate: 0.3,
  ratePerWind: 0.15,
  gustEvery: 1.7,
  gustChance: 0.3,
  gustCount: 2,
  gustPerWind: 2,
  lifetime: 3,
  max: 24,
  size: { start: 12, end: 22 },
  grow: { start: 0, end: 1 },
  alpha: { start: 1, end: 1 },
  speed: 1
}
const STREAKS_B: Layer = {
  texture: 'assets/images/wind/wind-streak-b.png',
  fps: 18,
  rate: 0.2,
  ratePerWind: 0.1,
  gustEvery: 2.3,
  gustChance: 0.25,
  gustCount: 1,
  gustPerWind: 3,
  lifetime: 3.2,
  max: 16,
  size: { start: 10, end: 18 },
  grow: { start: 0, end: 0.6 },
  alpha: { start: 1, end: 1 },
  speed: 0.85
}

type Emitter = { entity: Entity; layer: Layer }
let emitters: Emitter[] = []
/** What the particles were last set up for (they're only re-sent when this changes) */
let shown = { on: false, dir: NaN, speed: -1, mirror: false }
/** The course box (found from the scene), and how long it's been looked for */
type Course = { x: number; y: number; z: number; yaw: number; across: number; deep: number }
let course: Course | null = null
let courseLookedFor = 0

function inPlay(): boolean {
  return myBay() > 0
}

/** The course box from the tees and targets in the scene, or null if they aren't there (yet) */
function findCourse(): Course | null {
  const tees: { x: number; y: number; z: number }[] = []
  const targets: { x: number; z: number }[] = []
  for (const [, name, t] of engine.getEntitiesWith(Name, Transform)) {
    if (TEE_NAMES.test(name.value)) tees.push(t.position)
    else if (TARGET_NAMES.test(name.value)) targets.push(t.position)
  }
  if (tees.length < 2 || !targets.length) return null
  const mean = (a: { x: number; z: number }[]) => ({ x: a.reduce((t, p) => t + p.x, 0) / a.length, z: a.reduce((t, p) => t + p.z, 0) / a.length })
  const tc = mean(tees)
  const gc = mean(targets)
  // Down the range: from the middle of the tees to the middle of the targets
  let fx = gc.x - tc.x
  let fz = gc.z - tc.z
  const len = Math.sqrt(fx * fx + fz * fz) || 1
  fx /= len
  fz /= len
  // If the targets are somewhere odd (say, placed inside a parent), fall back to the range's own
  // direction (RANGE_YAW, down the range from the bays)
  const ry = (RANGE_YAW * Math.PI) / 180
  if (fx * Math.sin(ry) + fz * Math.cos(ry) < 0.7) {
    fx = Math.sin(ry)
    fz = Math.cos(ry)
  }
  // Across: to the right, looking down the range
  const ax = fz
  const az = -fx
  // The line of bays: the furthest any tee is down the range, and how wide they spread across
  let front = -Infinity
  let left = Infinity
  let right = -Infinity
  for (const p of tees) {
    const dx = p.x - tc.x
    const dz = p.z - tc.z
    front = Math.max(front, dx * fx + dz * fz)
    const a = dx * ax + dz * az
    left = Math.min(left, a)
    right = Math.max(right, a)
  }
  const across = right - left + 2 * COURSE_SIDE
  const deep = COURSE_FAR - COURSE_NEAR
  const midDown = front + (COURSE_NEAR + COURSE_FAR) / 2
  const midAcross = (left + right) / 2
  const y = tees.reduce((t, p) => t + p.y, 0) / tees.length + COURSE_Y
  return {
    x: tc.x + fx * midDown + ax * midAcross,
    y,
    z: tc.z + fz * midDown + az * midAcross,
    yaw: (Math.atan2(fx, fz) * 180) / Math.PI,
    across,
    deep
  }
}

function particlesFor(layer: Layer, on: boolean, windSpeed: number, dx: number, dz: number, mirror: boolean) {
  const fly = (SPEED_BASE + SPEED_PER_WIND * windSpeed) * layer.speed
  return {
    active: on,
    rate: layer.rate + layer.ratePerWind * windSpeed,
    bursts: {
      values: [
        {
          time: 0,
          count: layer.gustCount + Math.floor(windSpeed / layer.gustPerWind),
          cycles: 0, // forever
          interval: layer.gustEvery,
          probability: layer.gustChance
        }
      ]
    },
    lifetime: layer.lifetime,
    maxParticles: layer.max,
    loop: true,
    gravity: 0,
    // They start still, and the wind gets them going (world-space push), up to their flying speed
    initialVelocitySpeed: { start: 0, end: 0 },
    additionalForce: Vector3.create(dx * fly * PICKUP, 0, dz * fly * PICKUP),
    limitVelocity: { speed: fly, dampen: 1 },
    initialSize: layer.size,
    sizeOverTime: layer.grow,
    // Mirrored (turned half round on screen) when the wind blows right to left as you look
    initialRotation: mirror ? Quaternion.fromEulerDegrees(0, 0, 180) : Quaternion.Identity(),
    initialColor: { start: Color4.create(1, 1, 1, layer.alpha.start), end: Color4.create(1, 1, 1, layer.alpha.end) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 1, 1, 0) },
    billboard: true,
    blendMode: PBParticleSystem_BlendMode.PSB_ALPHA,
    simulationSpace: PBParticleSystem_SimulationSpace.PSS_WORLD,
    texture: { src: layer.texture },
    spriteSheet: { tilesX: FLIPBOOK.tilesX, tilesY: FLIPBOOK.tilesY, framesPerSecond: layer.fps },
    shape: ParticleSystem.Shape.Box({ size: Vector3.create(course ? course.across : 1, COURSE_HIGH, course ? course.deep : 1) })
  }
}

function windParticlesSystem(dt: number): void {
  // The course box, from the scene (its entities can take a moment to load: look for a while)
  if (!course) {
    if (courseLookedFor > 30) return
    courseLookedFor += dt
    course = findCourse()
    if (!course) return
    console.log(`[wind] course box ${Math.round(course.across)} x ${Math.round(course.deep)} m`)
    for (const e of emitters) {
      Transform.createOrReplace(e.entity, {
        position: Vector3.create(course.x, course.y, course.z),
        rotation: Quaternion.fromEulerDegrees(0, course.yaw, 0)
      })
    }
  }

  
  const camera = Transform.getOrNull(engine.CameraEntity)
  const wind = effectiveWind()
  const speed = wind.ready ? wind.speed : 0
  const on = speed >= CALM && inPlay()
  const r = (wind.dir * Math.PI) / 180
  const dx = Math.sin(r)
  const dz = Math.cos(r)
  // Whether the wind blows to the camera's left
  const camYaw = camera ? Quaternion.toEulerAngles(camera.rotation).y : course.yaw
  const mirror = Math.sin(((wind.dir - camYaw) * Math.PI) / 180) < 0

  // The particles: only re-sent when something they show changes
  const changed =
    on !== shown.on ||
    (on && (Math.abs(speed - shown.speed) > 0.1 || Math.abs(angleDelta(shown.dir, wind.dir)) > 1 || Number.isNaN(shown.dir) || mirror !== shown.mirror))
  if (!changed) return
  shown = { on, dir: wind.dir, speed, mirror }
  for (const e of emitters) ParticleSystem.createOrReplace(e.entity, particlesFor(e.layer, on, speed, dx, dz, mirror))
}

/** Wind you can see while playing: wavy streaks blowing over the course with the wind (none in a calm) */
export function setupWindParticles(): void {
  emitters = [STREAKS_A, STREAKS_B].map((layer) => {
    const entity = engine.addEntity()
    Transform.create(entity, { position: Vector3.create(0, -50, 0) })
    return { entity, layer }
  })
  engine.addSystem(windParticlesSystem, undefined, 'wind-particles')
}

// ---------------------------------------------------------------------------
// For the range card: the wind as you see it from where you're looking
// ---------------------------------------------------------------------------

// The arrow is a picture, one per direction (up, then clockwise in 45 degree steps). The diagonal
// arrow characters aren't in the font, so the explorer drew them as emoji.
const ARROW_IMAGE = 'assets/images/menus/wind-arrow-'
/** Looking down the range from the bays (towards +x) */
const RANGE_YAW = 90

/**
 * The wind on the course, as seen from the bays looking down the range: an arrow (up = blowing
 * down the range, away from the bays), its strength in mph, and a word or two for what it does to
 * a shot. It doesn't turn with the camera: it's the course's wind, whichever way you're facing.
 */
export function windReadout(): { arrow: string; mph: string; words: string; calm: boolean } {
  // arrow: the picture to show (assets/images/menus/wind-arrow-0.png to -7.png), '' when calm
  const wind = effectiveWind()
  if (!wind.ready || wind.speed < CALM) return { arrow: '', mph: 'Calm', words: '', calm: true }
  // The range runs down +x, which is a direction of 90 (see wind.dir): relative to that
  const rel = ((wind.dir - RANGE_YAW) % 360 + 360) % 360
  const arrow = `${ARROW_IMAGE}${Math.round(rel / 45) % 8}.png`
  const r = (rel * Math.PI) / 180
  const along = Math.cos(r) // + blowing down the range
  const cross = Math.sin(r) // + blowing to your right, looking down the range
  const parts: string[] = []
  if (along > 0.38) parts.push('Helping')
  else if (along < -0.38) parts.push('Against')
  if (cross > 0.38) parts.push('left to right')
  else if (cross < -0.38) parts.push('right to left')
  let words = parts.join(', ')
  words = words.charAt(0).toUpperCase() + words.slice(1)
  return { arrow, mph: `${Math.round(wind.speed * 2.237)} mph`, words, calm: false }
}
