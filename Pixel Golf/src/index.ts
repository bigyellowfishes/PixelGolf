import {
  engine,
  InputAction,
  Transform,
  Name,
  Entity,
  Material,
  MeshRenderer,
  TouchScreenControls
} from '@dcl/sdk/ecs'
import { Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'

import * as CANNON from 'cannon-es'
import { courseData } from './collisionData/course_collision'

import { Game, Physics, updateSettingsInput } from './game'
import { getLaunchPower } from './clubSelect'
import { spawnClubRacks } from './clubRack'

import { setupUi } from './ui/index'

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const BALL_RADIUS = 0.1               // Size of the Players Ball
const REST_SPEED = 0.1                // The speed at which the ball is counted as stopped
const FIXED_TIME_STEP = 1 / 120       // The amount of times per second to calc physics steps
const MAX_STEPS_PER_FRAME = 12        // The Max Substeps of Physics Based On Frames
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

// ---------------------------------------------------------------------------
// State, resolved from the authored scene at startup
// ---------------------------------------------------------------------------
// Every playable ball in the scene, matched by entity name
const BALL_NAMES = ['Ball_1', 'Ball_2', 'Ball_3', 'Ball_4', 'Ball_5', 'Ball_6',
                    'Ball_7', 'Ball_8','Ball_9', 'Ball_10', 'Ball_11', 'Ball_12',
                    'Ball_13', 'Ball_14', 'Ball_15', 'Ball_16', 'Ball_17', 'Ball_18']

type BallRig = { name: string; entity: Entity; body: CANNON.Body }
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
      collisionFilterMask: GROUP_COURSE // balls only hit the course, never each other
    })
    body.allowSleep = true
    body.sleepSpeedLimit = REST_SPEED
    body.sleepTimeLimit = 0.3
    world.addBody(body)
    balls.push({ name: found.name, entity: found.entity, body })
  }
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

// Value used in detecting physics drift
let accumulator = 0

// Tick Through Physics Calculations
function physicsSystem(dt: number) {
  if (balls.length === 0) return
  if (worldIsIdle()) return

  // Step size follows the fastest ball so none of them tunnel through the course
  let fastest = 0
  for (const b of balls) fastest = Math.max(fastest, ballSpeed(b.body))

  const step = stepFor(fastest)
  accumulator += dt
  if (accumulator > MAX_DEBT_SECONDS) accumulator = MAX_DEBT_SECONDS

  let steps = 0
  while (accumulator >= step && steps < MAX_STEPS_PER_FRAME) {
    world.step(step)
    accumulator -= step
    steps++
  }

  for (const b of balls) {
    // Sleeping balls haven't moved, so leave their transforms alone
    if (b.body.sleepState === CANNON.Body.SLEEPING) continue

    clampBallSpeed(b.body) // catch speed gained from steep ramps too, not just strikes

    // Update Ball Positions
    const t = Transform.getMutable(b.entity)
    t.position = {
      x: b.body.position.x,
      y: b.body.position.y,
      z: b.body.position.z
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
    },
    strike(dirX, dirZ, power) {
      // Horizontal Strike, applied at the centre so it imparts no spin
      const p = Math.max(0, Math.min(1, power)) * getLaunchPower()
      body.wakeUp()
      body.applyImpulse(new CANNON.Vec3(dirX * p, 0, dirZ * p), body.position)
      clampBallSpeed(body)
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
  
  buildWorldFromScene()

  // A rack of the three clubs beside every ball's pad. Each ball body is still
  // at its authored start position here, and the ground sits one radius below it.
  spawnClubRacks(
    balls.map((b) => ({ x: b.body.position.x, y: b.body.position.y - BALL_RADIUS, z: b.body.position.z }))
  )

  SpawnCamera()
  setupUi()

  engine.addSystem(() => {
    applyTouchControls()
  })

  engine.addSystem(physicsSystem)

  if (balls.length === 0) {
    console.log('[golf] no entity named "Ball" in the scene, the game cannot start')
    return
  }

  // One game per ball, each with its own physics body. They share the arrows and camera.
  const games = balls.map((b) => new Game(makePhysicsBridge(b.body), b.entity))
  Game.InitCamera()
  Game.InitClub()

  // Run the Update for the Main Game Loop In Game.ts
  engine.addSystem((dt: number) => {
    for (const game of games) game.update(dt)
    Game.UpdateClubFrame(dt)
    Game.UpdateCameraFrame(dt)
    updateSettingsInput()
  })
}