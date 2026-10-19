import * as CANNON from 'cannon-es'
import { courseData } from './collisionData/course_collision'

/**
 * The ball's physics, run ahead of time.
 *
 * Nothing here runs live against the render frame. A shot is simulated from start to
 * finish on a fixed clock (30 outer steps a second, 5 cannon-es substeps in each, so the
 * ball is really stepped at 150 Hz and doesn't slip through the course on a bounce), and
 * the ball's position and rotation are recorded after every outer step. That recording
 * (a ShotPath) is what everyone then plays back, with timestamps and interpolation, so the
 * flight looks the same at any frame rate and always ends on a known resting spot for scoring.
 *
 * Used by both ends:
 *   - the scene, for shots only the player sees (the tutorial bay and the solo bay)
 *   - the Multiplayer Server, for shots everyone watches (ledger/server.ts): it simulates
 *     once and sends the same keyframes to every player, the shooter included
 *
 * No scene imports (no engine, no entities), so the server can run it headless.
 */

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
export const BALL_RADIUS = 0.1
/** Outer steps a second. One keyframe is recorded after each. */
export const SIM_HZ = 40
/** cannon-es steps inside each outer step (150 Hz in all). */
export const SUBSTEPS = 5
const OUTER_DT = 1 / SIM_HZ
const SUB_DT = OUTER_DT / SUBSTEPS
/** Squared speed (m/s) below which the ball counts as still. */
const REST_SPEED_SQ = 0.01
/** Outer steps the ball must stay still for before the shot ends (about a third of a second). */
const REST_SAMPLES = 10
/** Hard cap on a shot's length. */
const MAX_SECONDS = 10
const MAX_STEPS = MAX_SECONDS * SIM_HZ
/** Hard cap on ball speed at any moment. */
const MAX_BALL_SPEED = 400
/**
 * Fastest launch the server accepts. The driver's 170 with the chip on top is about 175 m/s.
 * Keep above the fastest club in CLUB_TYPES (club.ts).
 */
export const MAX_LAUNCH_SPEED = 180
/** Values are stored as whole thousandths: 3 decimal places is plenty for a golf ball. */
const QUANT = 1000
/**
 * Fastest the model's roll turns, in radians a second (about 3 turns a second). A ball
 * really rolling at driver speed would turn hundreds of times a second, which on screen just
 * flickers (the wheel-spoke effect) and can't be interpolated between keyframes. Capped, it
 * reads as a fast spin, plays back smoothly, and keeps the recording small.
 */
const MAX_SPIN_RATE = 20
/** Bounces softer than this (m/s into the surface) make no sound. */
const HIT_MIN_SPEED = 2
/** Outer steps between recorded bounces, so a skidding ball doesn't thud every step. */
const HIT_GAP = 5

const LINEAR_DAMPING = 0.35
const ANGULAR_DAMPING = 0.35
const RESTITUTION = 0.2
/** Where the course collision mesh sits in the scene. */
const COURSE_OFFSET = { x: 320, y: 3, z: 250 }

/** Off the range: the shot ends here. Same bounds as game.ts. */
export function outOfRange(x: number, y: number, z: number): boolean {
  return z > 400 || z < 100 || y < 0
}

export type Vec3 = { x: number; y: number; z: number }
export type Quat = { x: number; y: number; z: number; w: number }

/**
 * A recorded shot, decoded and ready to play.
 * keys: 8 numbers per keyframe, [step, px, py, pz, qx, qy, qz, qw]. step / SIM_HZ is its time.
 * hits: 2 numbers per bounce, [step, impact speed in m/s].
 */
export type ShotPath = { keys: number[]; hits: number[] }

export const KEY_STRIDE = 8

// ---------------------------------------------------------------------------
// The physics world, built once on first use
// ---------------------------------------------------------------------------
const GROUP_COURSE = 1
const GROUP_BALL = 2
const GROUP_PATCH = 4

let world: CANNON.World | undefined
let ball: CANNON.Body
let patch: CANNON.Body
let patchKey = ''
/** The sim the ball body belongs to right now (for its bounce sounds). */
let current: ShotSim | null = null

function ensureWorld(): CANNON.World {
  if (world) return world
  const w = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) })
  // Only one body ever moves, so the cheapest broadphase is the right one
  w.broadphase = new CANNON.NaiveBroadphase()
  w.allowSleep = false

  const groundMat = new CANNON.Material('ground')
  const ballMat = new CANNON.Material('ball')
  w.addContactMaterial(
    new CANNON.ContactMaterial(groundMat, ballMat, {
      friction: 0.0,
      restitution: RESTITUTION, // a little bounce, not a pinball
      contactEquationStiffness: 1e8, // stiffer contacts resolve penetration faster and more consistently
      contactEquationRelaxation: 3 // fewer "soft" steps of settling into the surface
    })
  )

  // The whole course: only rays use it (aiming, the surface probe). The ball collides with
  // the small patch of it under its path instead (see fitPatch).
  const course = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.STATIC,
    shape: new CANNON.Trimesh(courseData.vertices, courseData.indices),
    material: groundMat,
    collisionFilterGroup: GROUP_COURSE
  })
  course.position.set(COURSE_OFFSET.x, COURSE_OFFSET.y, COURSE_OFFSET.z)
  w.addBody(course)
  buildClearanceGrid(courseData.vertices, courseData.indices)

  patch = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: groundMat, collisionFilterGroup: GROUP_PATCH })
  patch.position.set(COURSE_OFFSET.x, COURSE_OFFSET.y, COURSE_OFFSET.z)

  ball = new CANNON.Body({
    mass: 1,
    material: ballMat,
    shape: new CANNON.Sphere(BALL_RADIUS),
    linearDamping: LINEAR_DAMPING, // rolling resistance so the ball settles
    angularDamping: ANGULAR_DAMPING,
    collisionFilterGroup: GROUP_BALL,
    collisionFilterMask: GROUP_PATCH
  })
  ball.allowSleep = false
  ball.addEventListener('collide', (e: { contact: CANNON.ContactEquation }) => {
    if (current) current.noteHit(Math.abs(e.contact.getImpactVelocityAlongNormal()))
  })
  w.addBody(ball)

  world = w
  return w
}

// ---------------------------------------------------------------------------
// Skipping collision while the ball is clear of the course
// ---------------------------------------------------------------------------
// The course collision has some very large triangles, so checking the ball against all of
// it costs about the same wherever the ball is. So: a coarse grid of the course's highest
// point in each 4 m square, built once. While the ball's path for the next outer step is
// well above everything under it, it isn't checked against the course at all.
const CLEAR_CELL = 4 // metres per grid square
const CLEAR_MARGIN = 1 // metres the ball must be above the highest point to skip
let clearGrid: Float32Array | undefined
let cellTris: number[][] = []
// Each triangle's bounding box in course space: minx, miny, minz, maxx, maxy, maxz
let triBox: Float32Array = new Float32Array(0)
let courseVerts: number[] = []
let courseIdx: number[] = []
let clearMinX = 0, clearMinZ = 0, clearNX = 0, clearNZ = 0

function buildClearanceGrid(V: number[], I: number[]): void {
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity
  for (let i = 0; i < V.length; i += 3) {
    if (V[i] < minx) minx = V[i]
    if (V[i] > maxx) maxx = V[i]
    if (V[i + 2] < minz) minz = V[i + 2]
    if (V[i + 2] > maxz) maxz = V[i + 2]
  }
  clearMinX = minx
  clearMinZ = minz
  clearNX = Math.ceil((maxx - minx) / CLEAR_CELL) + 1
  clearNZ = Math.ceil((maxz - minz) / CLEAR_CELL) + 1
  const top = new Float32Array(clearNX * clearNZ).fill(-1e9)
  courseVerts = V
  courseIdx = I
  cellTris = []
  triBox = new Float32Array((I.length / 3) * 6)
  for (let n = 0; n < clearNX * clearNZ; n++) cellTris.push([])
  for (let t = 0; t < I.length; t += 3) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (let k = 0; k < 3; k++) {
      const p = I[t + k] * 3
      if (V[p] < x0) x0 = V[p]
      if (V[p] > x1) x1 = V[p]
      if (V[p + 1] < y0) y0 = V[p + 1]
      if (V[p + 1] > y1) y1 = V[p + 1]
      if (V[p + 2] < z0) z0 = V[p + 2]
      if (V[p + 2] > z1) z1 = V[p + 2]
    }
    const tb = (t / 3) * 6
    triBox[tb] = x0; triBox[tb + 1] = y0; triBox[tb + 2] = z0
    triBox[tb + 3] = x1; triBox[tb + 4] = y1; triBox[tb + 5] = z1
    const a = Math.floor((x0 - minx) / CLEAR_CELL), b = Math.floor((x1 - minx) / CLEAR_CELL)
    const c = Math.floor((z0 - minz) / CLEAR_CELL), d = Math.floor((z1 - minz) / CLEAR_CELL)
    for (let ix = a; ix <= b; ix++) {
      for (let iz = c; iz <= d; iz++) {
        const n = ix * clearNZ + iz
        if (y1 > top[n]) top[n] = y1
        cellTris[n].push(t / 3)
      }
    }
  }
  clearGrid = top
}

/** Highest point of the course in the square around a world x, z (very low outside the course). */
function courseTop(x: number, z: number): number {
  if (!clearGrid) return Infinity
  const ix = Math.floor((x - COURSE_OFFSET.x - clearMinX) / CLEAR_CELL)
  const iz = Math.floor((z - COURSE_OFFSET.z - clearMinZ) / CLEAR_CELL)
  if (ix < 0 || iz < 0 || ix >= clearNX || iz >= clearNZ) return -1e9
  return clearGrid[ix * clearNZ + iz] + COURSE_OFFSET.y
}

const NEIGHBOURS = [[0, 0], [CLEAR_CELL, 0], [-CLEAR_CELL, 0], [0, CLEAR_CELL], [0, -CLEAR_CELL]]

/** Whether the ball's path over the next `seconds` is clear of everything under it. */
function clearOfCourse(seconds: number): boolean {
  const p = ball.position
  const v = ball.velocity
  const ex = p.x + v.x * seconds, ey = p.y + v.y * seconds, ez = p.z + v.z * seconds
  const low = Math.min(p.y, ey) - BALL_RADIUS - CLEAR_MARGIN
  const n = Math.ceil(Math.hypot(ex - p.x, ez - p.z) / CLEAR_CELL) + 1
  for (let i = 0; i <= n; i++) {
    const f = i / n
    const x = p.x + (ex - p.x) * f
    const z = p.z + (ez - p.z) * f
    for (const [dx, dz] of NEIGHBOURS) if (courseTop(x + dx, z + dz) >= low) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Near the ground: collide with a small patch of course, not all of it
// ---------------------------------------------------------------------------
// The ball gets one small static body holding only the triangles whose bounds touch the
// box it can sweep through in the next outer step (plus a margin for a bounce). cannon-es
// tests the sphere against every triangle its tree hands back, and on this mesh the tree
// prunes very little, so keeping the patch to a handful of triangles is what keeps a step
// cheap. Rebuilt only when that set of triangles changes.
const PATCH_MARGIN = 0.5 // metres around the swept box
const patchTris: number[] = []
const seenTri = new Set<number>()

function fitPatch(seconds: number): void {
  const w = ensureWorld()
  const p = ball.position
  const v = ball.velocity
  const m = BALL_RADIUS + PATCH_MARGIN
  // The swept box, in course space
  const ex = p.x + v.x * seconds, ey = p.y + v.y * seconds - 4.91 * seconds * seconds, ez = p.z + v.z * seconds
  const x0 = Math.min(p.x, ex) - m - COURSE_OFFSET.x, x1 = Math.max(p.x, ex) + m - COURSE_OFFSET.x
  const y0 = Math.min(p.y, ey) - m - COURSE_OFFSET.y, y1 = Math.max(p.y, ey) + m - COURSE_OFFSET.y
  const z0 = Math.min(p.z, ez) - m - COURSE_OFFSET.z, z1 = Math.max(p.z, ez) + m - COURSE_OFFSET.z
  const a = Math.max(0, Math.floor((x0 - clearMinX) / CLEAR_CELL))
  const d2 = Math.min(clearNX - 1, Math.floor((x1 - clearMinX) / CLEAR_CELL))
  const c = Math.max(0, Math.floor((z0 - clearMinZ) / CLEAR_CELL))
  const e2 = Math.min(clearNZ - 1, Math.floor((z1 - clearMinZ) / CLEAR_CELL))

  patchTris.length = 0
  seenTri.clear()
  for (let ix = a; ix <= d2; ix++) {
    for (let iz = c; iz <= e2; iz++) {
      for (const t of cellTris[ix * clearNZ + iz]) {
        if (seenTri.has(t)) continue
        seenTri.add(t)
        const b = t * 6
        if (triBox[b] > x1 || triBox[b + 3] < x0 || triBox[b + 1] > y1 || triBox[b + 4] < y0 || triBox[b + 2] > z1 || triBox[b + 5] < z0) continue
        patchTris.push(t)
      }
    }
  }
  patchTris.sort((i, j) => i - j)
  const key = patchTris.join(',')
  if (key === patchKey) return
  patchKey = key

  const verts: number[] = []
  const idx: number[] = []
  for (const t of patchTris) {
    for (let k = 0; k < 3; k++) {
      const q = courseIdx[t * 3 + k] * 3
      idx.push(verts.length / 3)
      verts.push(courseVerts[q], courseVerts[q + 1], courseVerts[q + 2])
    }
  }
  if (patch.world) w.removeBody(patch)
  patch.shapes.length = 0
  patch.shapeOffsets.length = 0
  patch.shapeOrientations.length = 0
  if (idx.length === 0) return
  patch.addShape(new CANNON.Trimesh(verts, idx))
  w.addBody(patch)
}

// ---------------------------------------------------------------------------
// Never through the course
// ---------------------------------------------------------------------------
// A ray from where the ball was before a substep to where it is after. If that crosses
// the course, the ball is put back on the surface and bounced, as the contact would have.
//
// The ray is two-sided. The course mesh's triangles are wound so that cannon-es sees their
// normals pointing down (it was exported with x mirrored), so a ray that skipped back faces
// never hit anything and the ball could pass straight through a thin floor (the white target
// was where it showed most: the furthest target, so the fastest landings). The normal is turned
// to face the side the ball came from instead.
const passRay = new CANNON.RaycastResult()
const passDir = new CANNON.Vec3()

function keepOutOfCourse(from: CANNON.Vec3): void {
  const to = ball.position
  if (from.distanceTo(to) < BALL_RADIUS) return // too short a move to have gone through
  passRay.reset()
  ensureWorld().raycastClosest(from, to, { collisionFilterMask: GROUP_PATCH, skipBackfaces: false }, passRay)
  if (!passRay.hasHit) return
  const n = passRay.hitNormalWorld
  to.vsub(from, passDir)
  if (n.dot(passDir) > 0) n.negate(n)
  const p = passRay.hitPointWorld
  ball.position.set(p.x + n.x * BALL_RADIUS * 1.05, p.y + n.y * BALL_RADIUS * 1.05, p.z + n.z * BALL_RADIUS * 1.05)
  const v = ball.velocity
  const into = v.x * n.x + v.y * n.y + v.z * n.z
  if (into < 0) {
    const k = (1 + RESTITUTION) * into
    v.set(v.x - k * n.x, v.y - k * n.y, v.z - k * n.z)
    if (current) current.noteHit(-into)
  }
}

function clampSpeed(v: CANNON.Vec3, ceiling: number): void {
  const s2 = v.x * v.x + v.y * v.y + v.z * v.z
  if (s2 > ceiling * ceiling) v.scale(ceiling / Math.sqrt(s2), v)
}

// ---------------------------------------------------------------------------
// One shot
// ---------------------------------------------------------------------------
const q = (v: number) => Math.round(v * QUANT)
const fromPrev = new CANNON.Vec3()
const spinStep = new CANNON.Quaternion()
const spinAxis = new CANNON.Vec3()

/**
 * Simulates one shot. Run it to the end in one go (the server: simulateShot) or a few
 * steps a frame (the scene, so a phone doesn't stall: run(n) until it returns true).
 * The world has a single ball body; each ShotSim keeps its own state and loads it into
 * that body while it runs, so two sims never mix.
 */
export class ShotSim {
  done = false
  private step = 0
  private still = 0
  private lastHit = -HIT_GAP
  private readonly pos = new CANNON.Vec3()
  private readonly vel = new CANNON.Vec3()
  // The ball's roll. The physics ball slides (no friction on the course), so the turn a
  // rolling ball would have is worked out from how far it moved: distance / radius,
  // about (up x direction). Recorded with the keyframes so every screen rolls it the same.
  private readonly spin = new CANNON.Quaternion()
  /** Quantised keyframes, KEY_STRIDE ints each. */
  private readonly raw: number[] = []
  private readonly hits: number[] = []

  constructor(start: Vec3, launch: Vec3, spin?: Quat) {
    this.pos.set(start.x, start.y, start.z)
    this.vel.set(launch.x, launch.y, launch.z)
    clampSpeed(this.vel, MAX_BALL_SPEED)
    if (spin) this.spin.set(spin.x, spin.y, spin.z, spin.w).normalize()
    this.record()
  }

  /** A bounce, for the landing sound. Called by the ball's collide event and the ray guard. */
  noteHit(speed: number): void {
    if (speed < HIT_MIN_SPEED || this.step - this.lastHit < HIT_GAP) return
    this.lastHit = this.step
    this.hits.push(this.step + 1, Math.round(speed * 10) / 10)
  }

  /** Runs up to `maxSteps` outer steps. True once the shot has ended. */
  run(maxSteps: number): boolean {
    if (this.done) return true
    ensureWorld()
    ball.position.copy(this.pos)
    ball.previousPosition.copy(this.pos)
    ball.interpolatedPosition.copy(this.pos)
    ball.velocity.copy(this.vel)
    ball.angularVelocity.set(0, 0, 0)
    ball.quaternion.set(0, 0, 0, 1)
    ball.force.set(0, 0, 0)
    ball.torque.set(0, 0, 0)
    current = this

    for (let i = 0; i < maxSteps && !this.done; i++) this.outerStep()

    this.pos.copy(ball.position)
    this.vel.copy(ball.velocity)
    current = null
    return this.done
  }

  private outerStep(): void {
    // Collide with nothing while the next 1/30 s is clear of the course, else with the patch under it
    const clear = clearOfCourse(OUTER_DT)
    ball.collisionFilterMask = clear ? 0 : GROUP_PATCH
    if (!clear) fitPatch(OUTER_DT)

    for (let s = 0; s < SUBSTEPS; s++) {
      fromPrev.copy(ball.position)
      world!.step(SUB_DT)
      if (!clear) keepOutOfCourse(fromPrev)
      clampSpeed(ball.velocity, MAX_BALL_SPEED)
      this.roll(ball.position.x - fromPrev.x, ball.position.z - fromPrev.z)
    }
    this.step++

    const p = ball.position
    const v = ball.velocity
    if (v.x * v.x + v.y * v.y + v.z * v.z < REST_SPEED_SQ) this.still++
    else this.still = 0

    if (this.still >= REST_SAMPLES) {
      ball.velocity.set(0, 0, 0)
      this.done = true
    } else if (outOfRange(p.x, p.y, p.z) || this.step >= MAX_STEPS) {
      this.done = true
    }
    this.record()
  }

  private roll(dx: number, dz: number): void {
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d < 1e-5) return
    spinAxis.set(dz / d, 0, -dx / d)
    spinStep.setFromAxisAngle(spinAxis, Math.min(d / BALL_RADIUS, MAX_SPIN_RATE * SUB_DT))
    spinStep.mult(this.spin, this.spin)
    this.spin.normalize()
  }

  private record(): void {
    const p = this.step === 0 ? this.pos : ball.position
    const r = this.spin
    this.raw.push(this.step, q(p.x), q(p.y), q(p.z), q(r.x), q(r.y), q(r.z), q(r.w))
  }

  /** The finished shot: quantised, with the redundant keyframes taken out. */
  result(): ShotPath {
    const kept = trimRedundant(this.raw)
    const keys: number[] = new Array(kept.length)
    for (let i = 0; i < kept.length; i++) keys[i] = i % KEY_STRIDE === 0 ? kept[i] : kept[i] / QUANT
    return { keys, hits: this.hits.slice() }
  }
}

/** A keyframe's transform matches its neighbour's (step aside). */
function sameTransform(k: number[], a: number, b: number): boolean {
  for (let j = 1; j < KEY_STRIDE; j++) if (k[a * KEY_STRIDE + j] !== k[b * KEY_STRIDE + j]) return false
  return true
}

/**
 * Drops every keyframe whose quantised transform matches both the one before and the one
 * after it. A run of identical keyframes keeps only its first and last, which interpolate
 * to the same thing, so playback is unchanged.
 */
function trimRedundant(raw: number[]): number[] {
  const n = raw.length / KEY_STRIDE
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const inner = i > 0 && i < n - 1
    if (inner && sameTransform(raw, i, i - 1) && sameTransform(raw, i, i + 1)) continue
    for (let j = 0; j < KEY_STRIDE; j++) out.push(raw[i * KEY_STRIDE + j])
  }
  return out
}

/** The whole shot at once. What the server runs. */
export function simulateShot(start: Vec3, launch: Vec3, spin?: Quat): ShotPath {
  const sim = new ShotSim(start, launch, spin)
  sim.run(MAX_STEPS + 1)
  return sim.result()
}

/**
 * The launch velocity for a strike: `power` (0..1, already eased by the swing) along the
 * flat direction, plus the chip that lifts every shot (a quarter of the club's power).
 * The same sum the old live physics did with its two impulses on a 1 kg ball.
 */
export function launchVelocity(dirX: number, dirZ: number, power: number, clubPower: number): Vec3 {
  const p = Math.max(0, Math.min(1, power)) * clubPower
  const v = new CANNON.Vec3(dirX * p, 0, dirZ * p)
  clampSpeed(v, MAX_BALL_SPEED)
  v.y += clubPower / 4
  return { x: v.x, y: v.y, z: v.z }
}

/** A launch the server will simulate: finite, and no faster than any club can hit. */
export function sanitiseLaunch(v: Vec3): Vec3 | null {
  if (![v.x, v.y, v.z].every((n) => Number.isFinite(n))) return null
  const out = new CANNON.Vec3(v.x, v.y, v.z)
  clampSpeed(out, MAX_LAUNCH_SPEED)
  return { x: out.x, y: out.y, z: out.z }
}

// ---------------------------------------------------------------------------
// On the wire
// ---------------------------------------------------------------------------
// JSON { k, h }. k is the keyframes as whole numbers (thousandths). The step is stored as
// its difference from the keyframe before. Position and rotation are stored as the change
// in that difference (a second difference): in flight the ball's velocity only changes by
// gravity, and rolling it changes slowly, so nearly every number is one or two digits.
// It's exact: decoding gives back the same thousandths. h is [step, impact speed x10] pairs.
//
// The numbers are packed into one string, a few characters each instead of JSON digits and
// commas: zigzag (so small negatives stay small), then base 32, low digits first. The last
// character of a number comes from END and any before it from MORE, so they need no
// separator. -16 to 15 take one character, -512 to 511 two.
const END = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'
const MORE = 'ghijklmnopqrstuvwxyz0123456789-_'

function packInts(values: number[]): string {
  let out = ''
  for (const v of values) {
    let z = v >= 0 ? v * 2 : -v * 2 - 1 // zigzag, kept to plain arithmetic so it can't overflow
    while (z >= 32) {
      out += MORE[z % 32]
      z = Math.floor(z / 32)
    }
    out += END[z]
  }
  return out
}

function unpackInts(text: string): number[] | null {
  const out: number[] = []
  let z = 0
  let scale = 1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const more = MORE.indexOf(ch)
    if (more >= 0) {
      z += more * scale
      scale *= 32
      continue
    }
    const end = END.indexOf(ch)
    if (end < 0) return null
    z += end * scale
    out.push(z % 2 === 0 ? z / 2 : -(z + 1) / 2)
    z = 0
    scale = 1
  }
  return scale === 1 ? out : null
}

export function encodePath(path: ShotPath): string {
  const k: number[] = []
  const prev = new Array(KEY_STRIDE).fill(0)
  const prevD = new Array(KEY_STRIDE).fill(0)
  for (let i = 0; i < path.keys.length; i += KEY_STRIDE) {
    for (let j = 0; j < KEY_STRIDE; j++) {
      const v = j === 0 ? path.keys[i] : Math.round(path.keys[i + j] * QUANT)
      const d = v - prev[j]
      k.push(j === 0 ? d : d - prevD[j])
      prev[j] = v
      prevD[j] = d
    }
  }
  const h: number[] = []
  for (let i = 0; i < path.hits.length; i += 2) h.push(path.hits[i], Math.round(path.hits[i + 1] * 10))
  return JSON.stringify({ k: packInts(k), h })
}

export function decodePath(data: string): ShotPath | null {
  let o: { k?: unknown; h?: unknown }
  try {
    o = JSON.parse(data)
  } catch {
    return null
  }
  const k = typeof o.k === 'string' ? unpackInts(o.k) : null
  if (!k || k.length < KEY_STRIDE || k.length % KEY_STRIDE !== 0) return null
  const keys: number[] = new Array(k.length)
  const acc = new Array(KEY_STRIDE).fill(0)
  const accD = new Array(KEY_STRIDE).fill(0)
  for (let i = 0; i < k.length; i++) {
    const j = i % KEY_STRIDE
    const n = Number(k[i])
    if (!Number.isFinite(n)) return null
    if (j === 0) acc[j] += n
    else {
      accD[j] += n
      acc[j] += accD[j]
    }
    keys[i] = j === 0 ? acc[j] : acc[j] / QUANT
  }
  const hits: number[] = []
  if (Array.isArray(o.h)) for (let i = 0; i + 1 < o.h.length; i += 2) hits.push(Number(o.h[i]), Number(o.h[i + 1]) / 10)
  return { keys, hits }
}

// ---------------------------------------------------------------------------
// Playing a shot back
// ---------------------------------------------------------------------------

/** How long a shot lasts, in seconds. */
export function pathDuration(path: ShotPath): number {
  return path.keys[path.keys.length - KEY_STRIDE] / SIM_HZ
}

/** Where a shot finishes. */
export function pathEnd(path: ShotPath): Vec3 {
  const i = path.keys.length - KEY_STRIDE
  return { x: path.keys[i + 1], y: path.keys[i + 2], z: path.keys[i + 3] }
}

/**
 * Plays a ShotPath by time. sample(t) gives the ball's position and roll t seconds in,
 * interpolated between the two keyframes either side. Times only go forward in normal
 * play, so it keeps its place instead of searching from the start each frame.
 */
export class PathPlayer {
  readonly position: Vec3 = { x: 0, y: 0, z: 0 }
  readonly rotation: Quat = { x: 0, y: 0, z: 0, w: 1 }
  private seg = 0
  private hitAt = 0

  constructor(readonly path: ShotPath) {
    this.sample(0)
  }

  get duration(): number {
    return pathDuration(this.path)
  }

  sample(t: number): void {
    const k = this.path.keys
    const last = k.length / KEY_STRIDE - 1
    const step = t * SIM_HZ
    if (this.seg > 0 && k[this.seg * KEY_STRIDE] > step) this.seg = 0
    while (this.seg < last && k[(this.seg + 1) * KEY_STRIDE] <= step) this.seg++
    const a = this.seg * KEY_STRIDE
    if (this.seg >= last) {
      this.set(a, a, 0)
      return
    }
    const b = a + KEY_STRIDE
    const span = k[b] - k[a]
    const f = span > 0 ? Math.min(1, Math.max(0, (step - k[a]) / span)) : 0
    this.set(a, b, f)
  }

  /** Jumps to t seconds in without sounding the bounces passed on the way. */
  seek(t: number): void {
    this.hitsUntil(t)
    this.sample(t)
  }

  /** Bounces passed since the last call, as impact speeds (for the landing sound). */
  hitsUntil(t: number): number[] {
    const out: number[] = []
    const h = this.path.hits
    const step = t * SIM_HZ
    while (this.hitAt + 1 < h.length && h[this.hitAt] <= step) {
      out.push(h[this.hitAt + 1])
      this.hitAt += 2
    }
    return out
  }

  private set(a: number, b: number, f: number): void {
    const k = this.path.keys
    this.position.x = k[a + 1] + (k[b + 1] - k[a + 1]) * f
    this.position.y = k[a + 2] + (k[b + 2] - k[a + 2]) * f
    this.position.z = k[a + 3] + (k[b + 3] - k[a + 3]) * f
    // Normalised lerp, taking the short way round. Keyframes are 1/30 s apart, so nlerp
    // and slerp are indistinguishable here, and quantising already moved them off unit length.
    let bx = k[b + 4], by = k[b + 5], bz = k[b + 6], bw = k[b + 7]
    const ax = k[a + 4], ay = k[a + 5], az = k[a + 6], aw = k[a + 7]
    if (ax * bx + ay * by + az * bz + aw * bw < 0) {
      bx = -bx; by = -by; bz = -bz; bw = -bw
    }
    const x = ax + (bx - ax) * f, y = ay + (by - ay) * f, z = az + (bz - az) * f, w = aw + (bw - aw) * f
    const len = Math.sqrt(x * x + y * y + z * z + w * w) || 1
    this.rotation.x = x / len
    this.rotation.y = y / len
    this.rotation.z = z / len
    this.rotation.w = w / len
  }
}

// ---------------------------------------------------------------------------
// Rays against the course, for the game layer
// ---------------------------------------------------------------------------
const probeRay = new CANNON.RaycastResult()
const probeFrom = new CANNON.Vec3()
const probeTo = new CANNON.Vec3()

/** Height and normal of the course under a point. */
export function probeSurface(x: number, z: number, aroundY: number): { y: number; nx: number; ny: number; nz: number } | null {
  const w = ensureWorld()
  probeFrom.set(x, aroundY + 0.6, z)
  probeTo.set(x, aroundY - 2, z)
  probeRay.reset()
  w.raycastClosest(probeFrom, probeTo, { collisionFilterMask: GROUP_COURSE, skipBackfaces: false }, probeRay)
  if (!probeRay.hasHit) return null
  return {
    y: probeRay.hitPointWorld.y,
    nx: probeRay.hitNormalWorld.x,
    ny: probeRay.hitNormalWorld.y,
    nz: probeRay.hitNormalWorld.z
  }
}

/** Builds the physics world now rather than on the first shot (it takes a moment). */
export function warmUpBallSim(): void {
  ensureWorld()
}
