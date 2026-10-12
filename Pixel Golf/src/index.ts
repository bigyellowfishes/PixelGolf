import { setupUi } from './ui'
import {
  engine,
  InputAction,
  Transform,
  Name,
  Entity,
  Material,
  MeshRenderer,
  TouchScreenControls,
  VisibilityComponent,
  GltfContainer,
  ColliderLayer
} from '@dcl/sdk/ecs'
import { Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'

import * as CANNON from 'cannon-es'
import { courseData } from './collisionData/course_collision'

import { Game, Physics, updateSettingsInput, applySavedSettings, onSettingChanged, onRoundFinished } from './game'
import { getLaunchPower } from './clubSelect'
import { spawnClubRacks } from './clubRack'
import { setupTeeOffPanels, setupTeeOffScreens } from './teeOffPanels'
import { playAt, playUi } from './sfx'
import { isServer } from '@dcl/sdk/network'
import { isMobile } from '@dcl/sdk/platform'
import { runLedger } from './ledger/server'
import {
  setupLedgerClient,
  onProfile,
  onSavedSettings,
  onRoundResult,
  onLevelUp,
  onAward,
  onBigRoll,
  onRefused,
  saveSetting,
  onRemoteShot,
  onBayScore
} from './ledger/client'
import { setupHotTargetMarker } from './hotTarget'
import { setPlayerProgress } from './ui/GameModeMenu'
import { showRoundFinished, showRoundCounted } from './ui/RoundResult'
import { showToast } from './ui/RangeHud'

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const BALL_RADIUS = 0.1               // Size of the Players Ball
const REST_SPEED = 0.1                // The speed at which the ball is counted as stopped
const FIXED_TIME_STEP = 1 / 120       // The amount of times per second to calc physics steps
const MAX_STEPS_PER_FRAME = 12        // The most physics steps in one frame. Past this, steps get longer rather than time being dropped
const STEP_TRAVEL = 0.08              // The physics Step Of Travel
const MAX_DEBT_SECONDS = 0.5          // Point at which physics snaps forward
const MAX_BALL_SPEED = 400            // Hard cap on ball speed. Prevents Travelling Through Objs

// ---------------------------------------------------------------------------
// Physics world
// ---------------------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) })

const groundMat = new CANNON.Material('ground')
const ballMat = new CANNON.Material('ball')

// Add material Values Between ground and ball as well as Hole 9 Ramp and Ball
const groundBallCont = new CANNON.ContactMaterial(groundMat, ballMat, {
    friction: 0.0,
    restitution: 0.2, // a little bounce, not a pinball
    contactEquationStiffness: 1e8, // stiffer contacts resolve penetration faster/more consistently
    contactEquationRelaxation: 3 // fewer "soft" frames of settling into the surface
  })
world.addContactMaterial(groundBallCont)

// Collision groups
const GROUP_COURSE = 1
const GROUP_BALL = 2
// The small piece of course each moving ball collides with (see fitPatch)
const GROUP_PATCH = 4

// ---------------------------------------------------------------------------
// State, resolved from the authored scene at startup
// ---------------------------------------------------------------------------
// Every playable ball in the scene, matched by entity name
const BALL_NAMES = ['Ball_1', 'Ball_2', 'Ball_3', 'Ball_4', 'Ball_5', 'Ball_6',
                    'Ball_7', 'Ball_8','Ball_9', 'Ball_10', 'Ball_11', 'Ball_12',
                    'Ball_13', 'Ball_14', 'Ball_15', 'Ball_16', 'Ball_17', 'Ball_18']

type BallRig = {
  name: string
  entity: Entity
  body: CANNON.Body
  // Where the ball was at the start of this frame (for the through-the-ground check)
  lastPos: CANNON.Vec3
  // Where it was before the latest physics step, and where it's drawn (see physicsSystem)
  prevStep: CANNON.Vec3
  renderPos: CANNON.Vec3
  // True while the ball is clear of the course and not being checked against it
  clear: boolean
  // The piece of course under this ball's path, and which grid squares it covers
  patch: CANNON.Body
  patchKey: string
}
const balls: BallRig[] = []

// Arrow Entities
export let ArwHeightEnt: Entity | undefined
export let ArwTurnEnt: Entity | undefined
export let ghostShot: Entity | undefined

export type ScoreZonesType = {
  Bunker1: Entity | undefined
  Bunker2: Entity | undefined
  Bunker3: Entity | undefined
  Bunker4: Entity | undefined
  Red1: Entity | undefined
  Red2: Entity | undefined
  Red3: Entity | undefined
  Red4: Entity | undefined
  Yellow1: Entity | undefined
  Yellow2: Entity | undefined
  Green: Entity | undefined
  Orange: Entity | undefined
  Blue: Entity | undefined
  White: Entity | undefined
  Black: Entity | undefined
}

export let ScoreZones: ScoreZonesType = {
    Bunker1: undefined,
    Bunker2: undefined,
    Bunker3: undefined,
    Bunker4: undefined,
    Red1: undefined,
    Red2: undefined,
    Red3: undefined,
    Red4: undefined,
    Yellow1: undefined,
    Yellow2: undefined,
    Green: undefined,
    Orange: undefined,
    Blue: undefined,
    White: undefined,
    Black: undefined
  }

// Build static bodies from every entity named col_* and grab the ball
function buildWorldFromScene() {
  const foundBalls: { name: string; entity: Entity; start: CANNON.Vec3 }[] = []

  for (const [entity, name, transform] of engine.getEntitiesWith(Name, Transform)) {
    const n = name.value

    // Find Ball Entities (Ball, Ball_2, Ball_3, Ball_4)
    if (BALL_NAMES.includes(n)) {
      const p = transform.position
      foundBalls.push({ name: n, entity, start: new CANNON.Vec3(p.x, p.y, p.z) })
      continue
    }

    // Find Arrow Entities
    if(n === 'Arrow_Height') ArwHeightEnt = entity
    if(n === 'Arrow_Turn') ArwTurnEnt = entity
    if(n === 'Ghost_Shot') ghostShot = entity

    // Find Score Zones
    if(n === 'Bunker1') ScoreZones.Bunker1 = entity
    if(n === 'Bunker2') ScoreZones.Bunker2 = entity
    if(n === 'Bunker3') ScoreZones.Bunker3 = entity
    if(n === 'Bunker4') ScoreZones.Bunker4 = entity
    if(n === 'Red1') ScoreZones.Red1 = entity
    if(n === 'Red2') ScoreZones.Red2 = entity
    if(n === 'Red3') ScoreZones.Red3 = entity
    if(n === 'Red4') ScoreZones.Red4 = entity
    if(n === 'Yellow1') ScoreZones.Yellow1 = entity
    if(n === 'Yellow2') ScoreZones.Yellow2 = entity
    if(n === 'Green') ScoreZones.Green = entity
    if(n === 'Orange') ScoreZones.Orange = entity
    if(n === 'Blue') ScoreZones.Blue = entity
    if(n === 'White') ScoreZones.White = entity
    if(n === 'Black') ScoreZones.Black = entity

  }

  //--------
  // Adding the custom physics from the imported collision data
  //--------

  const courseBody = new CANNON.Body({
    mass: 0, // Static environment
    type: CANNON.Body.STATIC,
    shape: new CANNON.Trimesh(courseData.vertices, courseData.indices),
    material: groundMat,
    collisionFilterGroup: GROUP_COURSE
  })
  courseBody.position.set(320, 3, 250)
  buildClearanceGrid(courseData.vertices, courseData.indices, courseBody.position)
  //debugShowPhysBB(courseBody)
  world.addBody(courseBody)

  //--------
  // Adding the ball physics
  //--------

  // Keep them in Ball, Ball_2, Ball_3, Ball_4 order
  foundBalls.sort((a, b) => BALL_NAMES.indexOf(a.name) - BALL_NAMES.indexOf(b.name))

  for (const found of foundBalls) {
    const body = new CANNON.Body({
      mass: 1,
      material: ballMat,
      shape: new CANNON.Sphere(BALL_RADIUS),
      position: found.start.clone(),
      linearDamping: 0.35, // rolling resistance so the ball settles
      angularDamping: 0.35,
      collisionFilterGroup: GROUP_BALL,
      collisionFilterMask: GROUP_PATCH // balls only hit the course (the piece near them), never each other
    })
    body.allowSleep = true
    body.sleepSpeedLimit = REST_SPEED
    body.sleepTimeLimit = 0.3
    world.addBody(body)
    balls.push({ name: found.name, entity: found.entity, body, lastPos: body.position.clone(), prevStep: body.position.clone(), renderPos: body.position.clone(), clear: false, patch: makePatchBody(), patchKey: '' })
  }
}

// ---------------------------------------------------------------------------
// The ledger, from the player's side: what the server sends goes to the UI, and
// finished rounds and settings go to the server (src/ledger/client.ts)
// ---------------------------------------------------------------------------
function setupLedger(): void {
  setupLedgerClient()

  // The level card on the Pixel Golf menu
  onProfile((p) => setPlayerProgress(p.level, p.levelXp, p.levelNeed))

  // Camera settings follow the player between visits and devices
  onSavedSettings(applySavedSettings)
  onSettingChanged(saveSetting)

  // The round card: the score straight away, the multiplier and rewards when the server answers
  onRoundFinished((r) => showRoundFinished(r.score, r.hotHits))
  onRoundResult(showRoundCounted)

  onLevelUp((l) => {
    playUi('score_great')
    const unlocked = l.unlocked.length ? `\nUnlocked: ${l.unlocked.join(', ')}` : ''
    showToast(`Level ${l.level}!${unlocked}`, 6)
  })
  onAward((a) => {
    const parts = [a.xp > 0 ? `+${a.xp} XP` : '', a.points > 0 ? `+${a.points} Pixel Points` : ''].filter((x) => x)
    showToast(`${a.reason}  ${parts.join('  ')}`, 5)
  })
  onBigRoll((r) => showToast(`${r.name} rolled x${r.roll}!`, 5))
  onRefused((reason) => showToast(reason, 5))

  // The floating 2X over whichever target is hot
  setupHotTargetMarker((zone) => (ScoreZones as Record<string, Entity | undefined>)[zone])
}

let deleteNextDegub: Entity | null = null

export function debugShowPhysBB(body: CANNON.Body): Entity {
  // Delete This From Last Frame
  if(deleteNextDegub != null)
  {
    engine.removeEntity(deleteNextDegub)
  }

  // 1. Force Cannon to calculate the AABB if it hasn't yet
  const aabb = body.aabb

  // 2. Calculate center position and size
  const width = aabb.upperBound.x - aabb.lowerBound.x
  const height = aabb.upperBound.y - aabb.lowerBound.y
  const depth = aabb.upperBound.z - aabb.lowerBound.z

  const centerX = body.position.x + (aabb.lowerBound.x + aabb.upperBound.x) / 2
  const centerY = body.position.y + (aabb.lowerBound.y + aabb.upperBound.y) / 2
  const centerZ = body.position.z + (aabb.lowerBound.z + aabb.upperBound.z) / 2

  // 3. Create Debug Box Entity in Decentraland
  const debugBox = engine.addEntity()

  MeshRenderer.setBox(debugBox)

  Transform.create(debugBox, {
    position: { x: centerX, y: centerY, z: centerZ },
    scale: { x: width, y: height, z: depth }
  })

  // 4. Make it semi-transparent red
  Material.setPbrMaterial(debugBox, {
    albedoColor: Color4.create(1, 0, 0, 0.3), // Red with 30% opacity
    transparencyMode: 2 // Alpha blend
  })
  deleteNextDegub = debugBox

  return debugBox
}

export function telePlayerToPhysBB(body: CANNON.Body) {
  const aabb = body.aabb

  const centerX = body.position.x + (aabb.lowerBound.x + aabb.upperBound.x) / 2
  const centerY = body.position.y + (aabb.lowerBound.y + aabb.upperBound.y) / 2
  const centerZ = body.position.z + (aabb.lowerBound.z + aabb.upperBound.z) / 2

  movePlayerTo({
  newRelativePosition: Vector3.create(centerX, centerY , centerZ),
  cameraTarget: Vector3.create(0, 0, 0) // Optional: direction the player faces
})
}

// The physics step to run at, given how fast the ball is going
function stepFor(speed: number): number {
  if (speed * FIXED_TIME_STEP <= STEP_TRAVEL) return FIXED_TIME_STEP
  return Math.max(1 / 960, STEP_TRAVEL / speed)
}

// ---------------------------------------------------------------------------
// The on-screen buttons a phone gets
// ---------------------------------------------------------------------------

const ICON_DIR = 'assets/scene/ui/icons'
const icon = (file: string) => ({
  tex: { $case: 'texture' as const, texture: { src: `${ICON_DIR}/${file}` } }
})

// What the client draws down the right-hand side on a phone
function applyTouchControls(): void {
  TouchScreenControls.createOrReplace(engine.RootEntity, {
    hideJoystick: false,
    hideCrosshair: true,
    // `hide` is spelled out on every row. The docs show it as optional and the
    // generated type has it required, so an entry without it does not compile.
    touchInputs: [
      { inputAction: InputAction.IA_PRIMARY, hide: false, icon: icon('swing.png') },
      { inputAction: InputAction.IA_SECONDARY, hide: false, icon: icon('close.png') },
      { inputAction: InputAction.IA_ACTION_3, hide: true },
      { inputAction: InputAction.IA_ACTION_4, hide: true },
      { inputAction: InputAction.IA_ACTION_6, hide: false, icon: icon('club.png') }
    ]
  })
}

// ---------------------------------------------------------------------------
// Physics Calcs basics Step Method
// ---------------------------------------------------------------------------

// Determines a ball's current speed
function ballSpeed(body: CANNON.Body): number {
  const v = body.velocity
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

// Hard speed cap for a ball, MAX_POWER should already keep us under this
function clampBallSpeed(body: CANNON.Body) {
  const ceiling = MAX_BALL_SPEED
  const v = body.velocity
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  if (speed > ceiling) {
    const scale = ceiling / speed
    v.x *= scale
    v.y *= scale
    v.z *= scale
  }
}

// Test whether every ball is idle in the world
function worldIsIdle(): boolean {
  for (const b of balls) {
    if (b.body.sleepState !== CANNON.Body.SLEEPING) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Skipping collision while the ball is clear of the course
// ---------------------------------------------------------------------------
// The course collision has some very large triangles, so checking the ball against
// it costs about the same wherever the ball is, even high in the air. That made
// every physics step expensive, and on a phone a driver shot ran at a few frames a
// second. So: a coarse grid of the course's highest point in each 4 m square, built
// once at load. While the ball's path for the next moment is well above everything
// under it, it isn't checked against the course at all (nothing there to hit).
const CLEAR_CELL = 4      // metres per grid square
const CLEAR_MARGIN = 1    // metres the ball must be above the highest point to skip
let clearGrid: Float32Array | undefined
// Which course triangles touch each grid square
let cellTris: number[][] = []
let courseVerts: number[] = []
let courseIdx: number[] = []
let clearMinX = 0, clearMinZ = 0, clearNX = 0, clearNZ = 0, clearOX = 0, clearOY = 0, clearOZ = 0

function buildClearanceGrid(V: number[], I: number[], offset: CANNON.Vec3): void {
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity
  for (let i = 0; i < V.length; i += 3) {
    if (V[i] < minx) minx = V[i]
    if (V[i] > maxx) maxx = V[i]
    if (V[i + 2] < minz) minz = V[i + 2]
    if (V[i + 2] > maxz) maxz = V[i + 2]
  }
  clearMinX = minx; clearMinZ = minz
  clearNX = Math.ceil((maxx - minx) / CLEAR_CELL) + 1
  clearNZ = Math.ceil((maxz - minz) / CLEAR_CELL) + 1
  clearOX = offset.x; clearOY = offset.y; clearOZ = offset.z
  const top = new Float32Array(clearNX * clearNZ).fill(-1e9)
  courseVerts = V
  courseIdx = I
  cellTris = []
  for (let n = 0; n < clearNX * clearNZ; n++) cellTris.push([])
  for (let t = 0; t < I.length; t += 3) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = -Infinity
    for (let k = 0; k < 3; k++) {
      const p = I[t + k] * 3
      if (V[p] < x0) x0 = V[p]
      if (V[p] > x1) x1 = V[p]
      if (V[p + 1] > y1) y1 = V[p + 1]
      if (V[p + 2] < z0) z0 = V[p + 2]
      if (V[p + 2] > z1) z1 = V[p + 2]
    }
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

// Highest point of the course in the square around a world x, z (very low outside the course)
function courseTop(x: number, z: number): number {
  if (!clearGrid) return Infinity
  const ix = Math.floor((x - clearOX - clearMinX) / CLEAR_CELL)
  const iz = Math.floor((z - clearOZ - clearMinZ) / CLEAR_CELL)
  if (ix < 0 || iz < 0 || ix >= clearNX || iz >= clearNZ) return -1e9
  return clearGrid[ix * clearNZ + iz] + clearOY
}

const NEIGHBOURS = [[0, 0], [CLEAR_CELL, 0], [-CLEAR_CELL, 0], [0, CLEAR_CELL], [0, -CLEAR_CELL]]

// Whether the ball's path over the next `seconds` is clear of everything under it
function clearOfCourse(body: CANNON.Body, seconds: number): boolean {
  const p = body.position
  const v = body.velocity
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
// Checking a ball against the whole course meant about 2,000 triangles every step,
// which is what made landings stutter on phones. Each moving ball instead gets its
// own small static body holding only the triangles in the grid squares around its
// path for the next moment. It's rebuilt only when the ball moves into new squares.
// The whole course body is still there for the ray checks (aiming, landing guard).
function makePatchBody(): CANNON.Body {
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: groundMat, collisionFilterGroup: GROUP_PATCH })
  body.position.set(clearOX, clearOY, clearOZ)
  return body
}

function fitPatch(b: BallRig, seconds: number): void {
  const p = b.body.position
  const v = b.body.velocity
  const ex = p.x + v.x * seconds
  const ez = p.z + v.z * seconds
  const cell = (w: number, o: number, min: number) => Math.floor((w - o - min) / CLEAR_CELL)
  const a = Math.max(0, cell(Math.min(p.x, ex), clearOX, clearMinX) - 1)
  const c = Math.max(0, cell(Math.min(p.z, ez), clearOZ, clearMinZ) - 1)
  const d2 = Math.min(clearNX - 1, cell(Math.max(p.x, ex), clearOX, clearMinX) + 1)
  const e2 = Math.min(clearNZ - 1, cell(Math.max(p.z, ez), clearOZ, clearMinZ) + 1)
  const key = `${a},${d2},${c},${e2}`
  if (key === b.patchKey) return
  b.patchKey = key

  const tris = new Set<number>()
  for (let ix = a; ix <= d2; ix++) for (let iz = c; iz <= e2; iz++) for (const t of cellTris[ix * clearNZ + iz]) tris.add(t)
  const verts: number[] = []
  const idx: number[] = []
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const q = courseIdx[t * 3 + k] * 3
      idx.push(verts.length / 3)
      verts.push(courseVerts[q], courseVerts[q + 1], courseVerts[q + 2])
    }
  }
  const body = b.patch
  if (body.world) world.removeBody(body)
  body.shapes.length = 0
  body.shapeOffsets.length = 0
  body.shapeOrientations.length = 0
  if (idx.length === 0) return
  body.position.set(clearOX, clearOY, clearOZ)
  body.addShape(new CANNON.Trimesh(verts, idx))
  world.addBody(body)
}

// Before stepping: balls clear of the course stop checking against it, and the rest
// get the patch of course under their path. Undone after.
function skipCollisionWhenClear(seconds: number): void {
  for (const b of balls) {
    if (b.body.sleepState === CANNON.Body.SLEEPING) continue
    b.clear = clearOfCourse(b.body, seconds)
    b.body.collisionFilterMask = b.clear ? 0 : GROUP_PATCH
    if (!b.clear) fitPatch(b, seconds)
  }
}

function restoreCollision(): void {
  for (const b of balls) b.body.collisionFilterMask = GROUP_PATCH
}

const passRay = new CANNON.RaycastResult()
const BOUNCE = 0.2 // matches the ground contact's restitution

function keepOutOfCourse(b: BallRig): boolean {
  if (b.clear) return false // nothing under it to go through
  const from = b.lastPos
  const to = b.body.position
  if (from.distanceTo(to) < BALL_RADIUS) return false // too short a move to have gone through
  passRay.reset()
  // Against the ball's own small patch of course, not the whole course (far cheaper)
  world.raycastClosest(from, to, { collisionFilterMask: GROUP_PATCH, skipBackfaces: true }, passRay)
  if (!passRay.hasHit) return false
  const n = passRay.hitNormalWorld
  const p = passRay.hitPointWorld
  b.body.position.set(p.x + n.x * BALL_RADIUS * 1.05, p.y + n.y * BALL_RADIUS * 1.05, p.z + n.z * BALL_RADIUS * 1.05)
  const v = b.body.velocity
  const into = v.x * n.x + v.y * n.y + v.z * n.z
  if (into < 0) {
    const k = (1 + BOUNCE) * into
    v.set(v.x - k * n.x, v.y - k * n.y, v.z - k * n.z)
  }
  return true
}

// A ball moved by the game (back to the tee) is drawn there at once, not slid there
function snapDrawnBall(body: CANNON.Body): void {
  for (const b of balls) {
    if (b.body !== body) continue
    b.prevStep.copy(body.position)
    b.renderPos.copy(body.position)
    b.lastPos.copy(body.position)
  }
}

// Value used in detecting physics drift
let accumulator = 0

// Tick Through Physics Calculations
// Frame rate and physics time, for the readout on the range card (PERF_READOUT in ui/RangeHud.tsx)
export const perfStats = { fps: 0, physicsMs: 0 }
let perfClock = 0, perfFrames = 0, perfPhysics = 0

function physicsSystem(dt: number) {
  const started = Date.now()
  physicsSystemInner(dt)
  perfPhysics += Date.now() - started
  perfFrames++
  perfClock += dt
  if (perfClock >= 1) {
    perfStats.fps = Math.round(perfFrames / perfClock)
    perfStats.physicsMs = Math.round(perfPhysics / perfFrames)
    perfClock = 0
    perfFrames = 0
    perfPhysics = 0
  }
}

function physicsSystemInner(dt: number) {
  if (balls.length === 0) return
  if (worldIsIdle()) {
    physicsAdvanced = 0
    return
  }
  if (onPhone()) {
    phonePhysics(dt)
    return
  }
  physicsAdvanced = dt

  // Step size follows the fastest ball so none of them tunnel through the course
  let fastest = 0
  for (const b of balls) fastest = Math.max(fastest, ballSpeed(b.body))

  let step = stepFor(fastest)
  accumulator += dt
  if (accumulator > MAX_DEBT_SECONDS) accumulator = MAX_DEBT_SECONDS

  // Always simulate the whole frame. A fast ball wants more small steps than a frame
  // can afford, and the time left over used to be thrown away, which made the ball fly
  // in slow motion on phones. Now the step count stays capped (more steps cost frame
  // rate) and each step gets longer instead, so the ball always moves at real speed.
  if (accumulator / step > MAX_STEPS_PER_FRAME) step = accumulator / MAX_STEPS_PER_FRAME

  // Where each moving ball starts this frame, to catch one that goes through the ground
  for (const b of balls) {
    if (b.body.sleepState !== CANNON.Body.SLEEPING) b.lastPos.copy(b.body.position)
  }

  skipCollisionWhenClear(accumulator)
  let steps = 0
  while (accumulator >= step - 1e-9 && steps < MAX_STEPS_PER_FRAME) {
    for (const b of balls) {
      if (b.body.sleepState !== CANNON.Body.SLEEPING) b.prevStep.copy(b.body.position)
    }
    world.step(step)
    accumulator -= step
    steps++
  }
  restoreCollision()

  // Longer steps can carry a fast ball through the course. One ray per moving ball
  // from where it was to where it is: if that crosses the course, put the ball back
  // on the surface and bounce it, as the contact would have.
  for (const b of balls) {
    if (b.body.sleepState !== CANNON.Body.SLEEPING && keepOutOfCourse(b)) b.prevStep.copy(b.body.position)
  }

  // Smooth drawing. A frame rarely lines up with whole physics steps, and on a phone
  // the frame time jumps about, so drawing the ball exactly where the physics left it
  // makes it move unevenly from frame to frame. That judder was most visible with the
  // ball cam, which is attached to the ball. Instead, draw it the leftover fraction of
  // the way between the last two physics positions, so it moves the same distance for
  // the same time whatever the frame rate (at most one physics step behind).
  const alpha = Math.min(1, Math.max(0, accumulator / step))

  for (const b of balls) {
    // Sleeping balls haven't moved, so leave their transforms alone
    if (b.body.sleepState === CANNON.Body.SLEEPING) continue

    clampBallSpeed(b.body) // catch speed gained from steep ramps too, not just strikes

    // Update Ball Positions (smoothed, see above)
    const cur = b.body.position
    const prev = b.prevStep
    b.renderPos.set(prev.x + (cur.x - prev.x) * alpha, prev.y + (cur.y - prev.y) * alpha, prev.z + (cur.z - prev.z) * alpha)
    const t = Transform.getMutable(b.entity)
    t.position = {
      x: b.renderPos.x,
      y: b.renderPos.y,
      z: b.renderPos.z
    }
    t.rotation = {
      x: b.body.quaternion.x,
      y: b.body.quaternion.y,
      z: b.body.quaternion.z,
      w: b.body.quaternion.w
    }
  }
}

// ---------------------------------------------------------------------------
// Phones: the ball runs on a steady 30 updates a second
// ---------------------------------------------------------------------------
// A scene can't set the phone's frame rate (that's the Decentraland app's own
// setting), and on a phone the frame times the scene is given jump about. So on
// mobile the ball doesn't follow those times. It moves in fixed 1/30 s slices: each
// update moves it exactly one slice of physics, the same distance for the same
// speed every time, and the ball cam moves with it. Desktop keeps the smoothed path.
const PHONE_TICKS_PER_SECOND = 30
const PHONE_TICK = 1 / PHONE_TICKS_PER_SECOND
// Most slices in one frame, to catch up after a slow frame without a long stall
const PHONE_MAX_TICKS_PER_FRAME = 2

let phone: boolean | undefined
function onPhone(): boolean {
  if (phone === undefined) phone = isMobile()
  return phone
}

let phoneClock = 0
// How much physics time passed this frame, for the ball models' spin
let physicsAdvanced = 0

function phonePhysics(dt: number): void {
  phoneClock = Math.min(phoneClock + dt, 0.25)
  let ticks = 0
  // A little slack (three-quarters of a slice) so frame-time noise near 1/30 s
  // still gives one slice per frame rather than alternating none and two
  while (phoneClock >= PHONE_TICK * 0.75 && ticks < PHONE_MAX_TICKS_PER_FRAME) {
    advanceExactly(PHONE_TICK)
    phoneClock -= PHONE_TICK
    ticks++
  }
  if (phoneClock < -PHONE_TICK * 0.5) phoneClock = -PHONE_TICK * 0.5
  physicsAdvanced = ticks * PHONE_TICK
  if (ticks === 0) return

  for (const b of balls) {
    if (b.body.sleepState === CANNON.Body.SLEEPING) continue
    clampBallSpeed(b.body)
    b.renderPos.copy(b.body.position)
    b.prevStep.copy(b.body.position)
    const t = Transform.getMutable(b.entity)
    t.position = { x: b.body.position.x, y: b.body.position.y, z: b.body.position.z }
    t.rotation = { x: b.body.quaternion.x, y: b.body.quaternion.y, z: b.body.quaternion.z, w: b.body.quaternion.w }
  }
}

// Simulates exactly this much time, in equal steps small enough not to tunnel
function advanceExactly(seconds: number): void {
  let fastest = 0
  for (const b of balls) fastest = Math.max(fastest, ballSpeed(b.body))
  const n = Math.max(1, Math.min(MAX_STEPS_PER_FRAME, Math.ceil(seconds / stepFor(fastest))))
  const h = seconds / n
  for (const b of balls) {
    if (b.body.sleepState !== CANNON.Body.SLEEPING) b.lastPos.copy(b.body.position)
  }
  skipCollisionWhenClear(seconds)
  for (let i = 0; i < n; i++) world.step(h)
  restoreCollision()
  for (const b of balls) {
    if (b.body.sleepState !== CANNON.Body.SLEEPING) keepOutOfCourse(b)
  }
}

// ---------------------------------------------------------------------------
// Bridge to the game layer (src/golf)
// ---------------------------------------------------------------------------

const probeRay = new CANNON.RaycastResult()
const probeFrom = new CANNON.Vec3()
const probeTo = new CANNON.Vec3()

// Height and normal of the course under a point
function probeSurface(x: number, z: number, aroundY: number) {
  probeFrom.set(x, aroundY + 0.6, z)
  probeTo.set(x, aroundY - 2, z)
  probeRay.reset()
  world.raycastClosest(
    probeFrom,
    probeTo,
    { collisionFilterMask: GROUP_COURSE, skipBackfaces: false },
    probeRay
  )
  if (!probeRay.hasHit) return null
  return {
    y: probeRay.hitPointWorld.y,
    nx: probeRay.hitNormalWorld.x,
    ny: probeRay.hitNormalWorld.y,
    nz: probeRay.hitNormalWorld.z
  }
}

// Launch power now comes from the selected club (wedge 80 / iron 130 / driver 170),
// see CLUB_TYPES in club.ts and getLaunchPower() in clubSelect.ts

// How far the ball will roll for a given charge, on the flat
function predictRoll(power: number): number {
  const launch = Math.max(0, Math.min(1, power)) * getLaunchPower()
  const decay = -Math.log(1 - 0.5) // linearDamping 0.5 -> ln 2 per second
  return Math.max(0, (launch - REST_SPEED) / decay)
}

// Push Ball Physics Updates
function makePhysicsBridge(body: CANNON.Body): Physics {
  return {
    ballRadius: BALL_RADIUS,
    position: () => ({ x: body.position.x, y: body.position.y, z: body.position.z }),
    speed: () => ballSpeed(body),
    // Horizontal speed only
    flatSpeed: () => {
      const v = body.velocity
      return Math.sqrt(v.x * v.x + v.z * v.z)
    },
    settled: () => body.sleepState === CANNON.Body.SLEEPING || ballSpeed(body) < REST_SPEED,
    place(x, y, z) {
      body.velocity.set(0, 0, 0)
      body.angularVelocity.set(0, 0, 0)
      body.position.set(x, y, z)
      body.quaternion.set(0, 0, 0, 1)
      body.wakeUp()
      snapDrawnBall(body)
    },
    strike(dirX, dirZ, power) {
      // Horizontal Strike, applied at the centre so it imparts no spin
      const p = Math.max(0, Math.min(1, power)) * getLaunchPower()
      body.wakeUp()
      body.applyImpulse(new CANNON.Vec3(dirX * p, 0, dirZ * p), body.position)
      clampBallSpeed(body)
    },
    velocity() {
      return { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z }
    },
    launch(vx, vy, vz) {
      body.wakeUp()
      body.velocity.set(vx, vy, vz)
      body.angularVelocity.set(0, 0, 0)
    },
    chipshot(power) {
        const p = Math.max(0, Math.min(1,  power)) * getLaunchPower() / 4
        body.applyImpulse(new CANNON.Vec3(0, p, 0), body.position)
    },
    freeze() {
      body.velocity.set(0, 0, 0)
      body.angularVelocity.set(0, 0, 0)
      body.sleep()
    },
    probe: probeSurface,
    predictRoll
  }
}

//
export let cameraEntity: Entity | undefined

// ---------------------------------------------------------------------------
// Ball model: every playable ball shows this model instead of the editor's sphere
// ---------------------------------------------------------------------------
const BALL_MODEL = 'assets/Models/Golf_Ball/Golf_Ball_Single.glb'
// The model is 0.1285 m across; this scales it to the physics ball's size (BALL_RADIUS)
const BALL_MODEL_SCALE = (BALL_RADIUS * 2) / 0.1285

// The physics ball slides rather than rolls (zero friction against the course), and
// the ball cam steers the ball entity's rotation, so the model is a separate entity
// that follows the ball and works out its own spin from how fast it is moving.
const ballModels: { ball: BallRig; model: Entity; spin: Quaternion.MutableQuaternion }[] = []

function swapBallModels() {
  for (const b of balls) {
    // Hide the placeholder sphere; the physics body is unaffected
    MeshRenderer.deleteFrom(b.entity)
    const model = engine.addEntity()
    const p = b.body.position
    Transform.create(model, {
      position: Vector3.create(p.x, p.y, p.z),
      scale: Vector3.create(BALL_MODEL_SCALE, BALL_MODEL_SCALE, BALL_MODEL_SCALE)
    })
    // Visual only: cannon-es handles the ball's collisions
    GltfContainer.create(model, {
      src: BALL_MODEL,
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
    })
    ballModels.push({ ball: b, model, spin: Quaternion.Identity() })

    // A thud when the ball lands or bounces hard enough to hear
    let lastThud = -1
    b.body.addEventListener('collide', (e: { contact: CANNON.ContactEquation }) => {
      const impact = Math.abs(e.contact.getImpactVelocityAlongNormal())
      if (impact < LAND_SOUND_MIN_SPEED || sceneClock - lastThud < 0.15) return
      lastThud = sceneClock
      const p = b.body.position
      playAt('ball_land', { x: p.x, y: p.y, z: p.z }, Math.min(1, impact / 12))
    })
  }
}

// Landings slower than this (m/s) are silent, so a resting ball doesn't keep thudding
const LAND_SOUND_MIN_SPEED = 2
let sceneClock = 0

// Keep each model on its ball and roll it: a ball rolling without slipping turns
// about the axis (up x velocity) by distance / radius
function spinBallModels(frameDt: number) {
  sceneClock += frameDt
  // Spin by the physics time that actually passed, so the roll matches the movement
  const dt = physicsAdvanced
  for (const m of ballModels) {
    const body = m.ball.body
    const t = Transform.getMutable(m.model)
    // Moving: the smoothed position. At rest: exactly where the physics has it.
    const p = body.sleepState === CANNON.Body.SLEEPING ? body.position : m.ball.renderPos
    t.position = Vector3.create(p.x, p.y, p.z)

    const vx = body.velocity.x
    const vz = body.velocity.z
    const speed = Math.sqrt(vx * vx + vz * vz)
    if (speed < 0.01) continue
    // up x v = (vz, 0, -vx)
    const axis = Vector3.create(vz / speed, 0, -vx / speed)
    const degrees = ((speed * dt) / BALL_RADIUS) * (180 / Math.PI)
    m.spin = Quaternion.multiply(Quaternion.fromAngleAxis(degrees, axis), m.spin)
    t.rotation = m.spin
  }
}

function SpawnCamera() {
  // Create the camera entity attached to the first ball.
  // Game.beginSwing re-parents it to whichever ball is being played.
  cameraEntity = engine.addEntity()
  Transform.create(cameraEntity, {
    // Offset relative to the target (3 units behind, 2 units above)
    position: Vector3.create(0, 0, -100),
    // Rotate camera to look slightly down toward the target
    rotation: Quaternion.fromEulerDegrees(0, 0, 0),
    // Parent it to the target so it automatically follows translation & rotation
    parent: balls[0]?.entity
  })
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
export function main() {
  // This code also runs once on the Multiplayer Server, which has no screen and no
  // player. There it only keeps the ledger: XP, Pixel Points, cosmetics, settings,
  // the leaderboards, the hot target and the multiplier rolls (src/ledger/server.ts).
  if (isServer()) {
    runLedger()
    return
  }

  buildWorldFromScene()
  swapBallModels()

  // The bunker zones are only used for scoring: keep them in the scene, but don't draw them
  for (const zone of [ScoreZones.Bunker1, ScoreZones.Bunker2, ScoreZones.Bunker3, ScoreZones.Bunker4]) {
    if (zone) VisibilityComponent.createOrReplace(zone, { visible: false })
  }

  // A rack of the three clubs beside every ball's pad. Each ball body is still
  // at its authored start position here, and the ground sits one radius below it.
  spawnClubRacks(
    balls.map((b) => ({ x: b.body.position.x, y: b.body.position.y - BALL_RADIUS, z: b.body.position.z }))
  )

  // Clicking a Tee Off panel opens the Pixel Golf menu
  setupTeeOffPanels()

  SpawnCamera()
  setupUi()
  setupLedger()

  engine.addSystem(() => {
    applyTouchControls()
  })

  engine.addSystem(physicsSystem)
  engine.addSystem(spinBallModels)

  if (balls.length === 0) {
    console.log('[golf] no entity named "Ball" in the scene, the game cannot start')
    return
  }

  // One game per ball, each with its own physics body. They share the arrows and camera.
  // Ball_N sits in bay N
  const games = balls.map((b) => new Game(makePhysicsBridge(b.body), b.entity, Number(b.name.replace('Ball_', '')) || 0))
  // Each bay's score on its Tee Off panel screen
  setupTeeOffScreens(balls.map((b, i) => ({ name: b.name, state: games[i].state })))
  Game.InitCamera()
  Game.InitClub()

  // Other players' shots play out on their bay's ball here too, and their bay screens update
  onRemoteShot((s) => games.find((g) => g.bay === s.bay)?.watchShot(s))
  onBayScore((d) => games.find((g) => g.bay === d.bay)?.showBayScore(d))

  // Run the Update for the Main Game Loop In Game.ts
  engine.addSystem((dt: number) => {
    for (const game of games) game.update(dt)
    Game.UpdateClubFrame(dt)
    Game.UpdateCameraFrame(dt)
    updateSettingsInput()
  })
}