import {
  engine,
  Entity,
  InputAction,
  inputSystem,
  PointerEventType,
  Transform,
  Animator,
  VisibilityComponent,
  MainCamera,
  VirtualCamera,
  InputModifier
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { ArwHeightEnt, ArwTurnEnt, cameraEntity, ScoreZones } from './index'

//The rules layer
type SurfaceProbe = (
  x: number,
  z: number,
  aroundY: number
) => { y: number; ny: number } | null

export type Physics = {
  ballRadius: number
  position(): { x: number; y: number; z: number }
  speed(): number
  // Horizontal speed alone, which is what decides a lip-out
  flatSpeed(): number
  settled(): boolean
  place(x: number, y: number, z: number): void
  strike(dirX: number, dirZ: number, power: number): void
  chipshot(power: number): void
  freeze(): void
  probe: SurfaceProbe
  // How far the ball rolls on the flat for a given charge, in metre
  predictRoll(power: number): number
}

type ballStats = {
  ballpowerMod: number
  ballAngleMod: number
}

export let curball: ballStats = {
  ballAngleMod: 0,
  ballpowerMod: 1
}

// Score at the very edge of a zone ("Outside") and at its exact centre ("Inside")
const ZONE_SCORES: Record<string, { outside: number; inside: number }> = {
  Red:    { outside: 500,   inside: 1000 },
  Yellow: { outside: 750,   inside: 2000 },
  Green:  { outside: 750,   inside: 4000 },
  Orange: { outside: 1250,  inside: 8000 },
  Blue:   { outside: 2000,  inside: 10000 },
  White:  { outside: 2000,  inside: 12500 },
  Black:  { outside: 20000, inside: 20000 },
}

// How close (metres) the player needs to be to the ball to hit it
const HIT_RANGE = 3

// How long the ball needs to sit still before we count it as "stopped"
const SETTLE_HOLD = 0.5

// ---------------------------------------------------------------------------
// Swing tunables
// ---------------------------------------------------------------------------
const HEIGHT_ANIM_SECONDS = 0.975
const TURN_ANIM_SECONDS = 0.975

const PowerTimeMulti = 0.6
const BendTimeMulti = 0.3

// Bend at full left/right, in degrees. Positive = right.
const MAX_BEND_DEG = -15

export type Phase =
  | 'walking'
  | 'Swing_Height'
  | 'Swing_Turn'
  | 'rolling'

export type GameState = {
  // Current Phase of Players Swing Actions
  phase: Phase
  // Current Shots Taken
  shot: number
  // Running total
  score: number
  // Points from the most recent shot, and the zone that gave them
  lastShotScore: number
  lastZone: string
  //Distance from Player To Ball
  distanceToBall: number
  // How far the shot at the meter's current reading would travel
  shotDistance: number
  // How the last strike came off the face, e.g. PERFECT or SLICED
  lastStrike: string
  penalties: number
  // Signed up at the board
  joined: boolean
}

export class Game {
  readonly state: GameState = {
    phase: 'walking',
    shot: 0,
    score: 0,
    lastShotScore: 0,
    lastZone: '',
    distanceToBall: 99,
    shotDistance: 0,
    lastStrike: '',
    penalties: 0,
    joined: false,
  }

  private physics: Physics

  // Aim direction as a compass yaw in radians, taken from where you look
  private aimYaw = 0
  private settleTimer = 0

  // Ignore input briefly after a state change so one press can't do two jobs
  private inputLock = 0

  // Where the ball began, so a stopped ball has somewhere to reset to
  private startPos: { x: number; y: number; z: number }

  // --- swing state ---------------------------------------------------------
  // Aim captured when the swing began (camera is ignored until the hit)
  private lockedYaw = 0
  // Seconds since the current arrow's animation started
  private swingTime = 0
  // 0..1 power captured on the first E press
  private storedPower = 0

  constructor(physics: Physics) {
    this.physics = physics
    this.startPos = physics.position()
    this.setArrow(ArwHeightEnt, false)
    this.setArrow(ArwTurnEnt, false)
  }

  // -------------------------------------------------------------------------

  update(dt: number): void {
    if (this.inputLock > 0) this.inputLock -= dt

    //
    UpdateScore(this.state.score, this.state.shot)

    // Only follow the camera while walking. Once the swing starts the aim is locked.
    if (this.state.phase === 'walking' || this.state.phase === 'Swing_Height') this.readAimFromCamera()

    // Refresh distanceToBall against the player's current position
    this.measure()

    switch (this.state.phase) {
      case 'walking':
        this.UpdateCamera(false)
        this.physics.freeze()
        if (this.state.distanceToBall <= HIT_RANGE && this.clicked()) {
          this.beginSwing()
          this.freezePlayer(true)
        }
        break

      case 'Swing_Height':
        this.swingTime += dt
        this.state.shotDistance = this.physics.predictRoll(this.heightMeter())
        if (this.clicked()) this.lockHeight()
        break

      case 'Swing_Turn':
        this.swingTime += dt
        
        const f = (this.swingTime * BendTimeMulti / TURN_ANIM_SECONDS) % 1
        const p = Math.sin(2 * Math.PI * f)
        setProgress(50 + (p * 50))

        //
        if (this.clicked()) this.lockTurnAndHit()
        break

      case 'rolling':
        this.UpdateCamera(true)
        this.updateRolling(dt)
        break
    }
  }

  // --- swing stages --------------------------------------------------------

  // Stage 0: E pressed by the ball. Remember where the player faces, show height arrow.
  private beginSwing(): void {
    this.lockedYaw = this.aimYaw
    this.storedPower = 0
    this.state.phase = 'Swing_Height'
    this.inputLock = 0.2
    this.startArrow(ArwHeightEnt)
  }

  // Stage 1: E pressed. Keep the power, swap to the turn arrow.
  private lockHeight(): void {
    this.storedPower = this.heightMeter()
    this.stopArrow(ArwHeightEnt)
    this.state.phase = 'Swing_Turn'
    this.inputLock = 0.2
    this.startArrow(ArwTurnEnt)
  }

  // Stage 2: E pressed. Read the bend and fire.
  private lockTurnAndHit(): void {
    const bendDeg = this.turnMeter() * MAX_BEND_DEG
    this.stopArrow(ArwTurnEnt)
    this.hit(this.storedPower, bendDeg)
    this.state.shot++
    this.state.phase = 'rolling'
    this.settleTimer = 0
    this.inputLock = 0.2
  }

  // Power 0..1: 0% at start, 100% at 50% through the animation, 0% at the end
  private heightMeter(): number {
    const f = (this.swingTime * PowerTimeMulti / HEIGHT_ANIM_SECONDS) % 1
    const p = 1 - Math.abs(2 * f - 1)
    setProgress(p * 100)
    return p
  }

  // Bend -1..1: 0 at start, +1 (right) at 25%, 0 at 50%, -1 (left) at 75%, 0 at end
  private turnMeter(): number {
    const f = (this.swingTime * BendTimeMulti / TURN_ANIM_SECONDS) % 1
    const turn = Math.sin(2 * Math.PI * f)
    return turn
  }

  // --- arrow helpers -------------------------------------------------------

  private setArrow(ent: Entity | undefined, visible: boolean): void {
    if (!ent) return
    VisibilityComponent.createOrReplace(ent, { visible })
  }

  private startArrow(ent: Entity | undefined): void {
    this.swingTime = 0
    if (!ent) return

    // Put the arrow on the ball, pointing along the locked aim
    const b = this.physics.position()
    const t = Transform.getMutable(ent)
    t.position = Vector3.create(b.x, b.y, b.z)
    t.rotation = Quaternion.fromEulerDegrees(0, ((this.lockedYaw * 180)) / Math.PI, 0)

    this.setArrow(ent, true)

    // Restart every clip on the arrow from the beginning, looping
    if (Animator.has(ent)) {
      for (const s of Animator.getMutable(ent).states) {
        s.playing = true
        s.loop = true
        s.shouldReset = true
        s.speed = this.state.phase == 'Swing_Height' ? PowerTimeMulti : BendTimeMulti
      }
    }
  }

  private stopArrow(ent: Entity | undefined): void {
    if (!ent) return
    if (Animator.has(ent)) {
      for (const s of Animator.getMutable(ent).states) s.playing = false
    }
    this.setArrow(ent, false)
  }

  // --- input / hit ---------------------------------------------------------

  // The action button
  private clicked(): boolean {
    if (this.inputLock > 0) return false
    return inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)
  }

  // When The Ball Is Hit: power 0..1, bendDeg positive = right
  private hit(power: number, bendDeg: number) {
    const aim = this.aimVector()
    const bend = (bendDeg * Math.PI) / 180
    const cos = Math.cos(bend)
    const sin = Math.sin(bend)
    const dirX = aim.x * cos + aim.z * sin
    const dirZ = -aim.x * sin + aim.z * cos

    this.physics.strike(dirX, dirZ, 0.25 + (power * 0.75))
    this.physics.chipshot(1)
  }

  // Decides what is in your hand this frame
  private measure(): { x: number; y: number; z: number } {
    const ball = this.physics.position()
    const player = Transform.getOrNull(engine.PlayerEntity)
    if (player) {
      const dx = ball.x - player.position.x
      const dz = ball.z - player.position.z
      const dy = Math.max(0, Math.abs(ball.y - player.position.y) - 1.2)
      this.state.distanceToBall = Math.sqrt(dx * dx + dz * dz + dy * dy)
    }
    return ball
  }

  // Tests the ball against every score zone and returns the best result
  private scoreBall(): { points: number; zone: string } {
    const ball = this.physics.position()
    let best = { points: 0, zone: '' }

    for (const [key, ent] of Object.entries(ScoreZones)) {
      if (!ent) continue
      const t = Transform.getOrNull(ent)
      if (!t) continue

      // Ball position relative to the cube, un-rotated into the cube's own axes
      const rel = { x: ball.x - t.position.x, y: ball.y - t.position.y, z: ball.z - t.position.z }
      const local = rotateByQuat(rel, { x: -t.rotation.x, y: -t.rotation.y, z: -t.rotation.z, w: t.rotation.w })

      const hx = Math.abs(t.scale.x) / 2
      const hy = Math.abs(t.scale.y) / 2 + this.physics.ballRadius // ball sits on the surface, so allow its radius
      const hz = Math.abs(t.scale.z) / 2
      if (Math.abs(local.x) > hx || Math.abs(local.y) > hy || Math.abs(local.z) > hz) continue

      // 0 at the centre, 1 at the edge (measured on the ground plane)
      const edge = Math.min(1, Math.max(Math.abs(local.x) / hx, Math.abs(local.z) / hz))

      const colour = key.replace(/\d+$/, '') // Red1 -> Red
      const s = ZONE_SCORES[colour]
      if (!s) continue

      const points = Math.round(s.outside + (s.inside - s.outside) * (1 - edge))
      if (points > best.points) best = { points, zone: key }
    }
    return best
  }

  // Horizontal facing of the player camera
  private readAimFromCamera(): void {
    const cam = Transform.getOrNull(engine.CameraEntity)
    if (!cam) return
    const q = cam.rotation
    const fx = 2 * (q.x * q.z + q.w * q.y)
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y)
    if (Math.abs(fx) < 1e-6 && Math.abs(fz) < 1e-6) return
    this.aimYaw = Math.atan2(fx, fz)
  }

  // Uses the yaw stored at swing start, not the live camera
  private aimVector(): { x: number; z: number } {
    return { x: Math.sin(this.lockedYaw), z: Math.cos(this.lockedYaw) }
  }

  // --- ball in motion ------------------------------------------------------
  private updateRolling(dt: number): void {
    const ball = this.measure()

    if (this.physics.settled()) {
      this.physics.freeze()
      this.settleTimer += dt
      if (this.settleTimer >= SETTLE_HOLD) {
        // Handle Scoring
        const result = this.scoreBall()
        this.state.lastShotScore = result.points
        this.state.lastZone = result.zone
        this.state.score += result.points
        console.log(result.zone)

        // Reset Player and Physics
        this.physics.place(this.startPos.x, this.startPos.y, this.startPos.z)
        this.settleTimer = 0
        this.state.phase = 'walking'
        this.freezePlayer(false)
      }
    } else {
      this.settleTimer = 0
    }
  }

  // --- Camera Settings
  InitCamera() {
    // Test the Camera Obj Exists
    if(!cameraEntity) return

    // Attach the VirtualCamera component to the camera entity
    VirtualCamera.create(cameraEntity, {
    })
  }

  private UpdateCamera(State: boolean) {
    // Test the Camera Obj Exists
    if(!cameraEntity) return

    if(State)
    {
      // Force the player's MainCamera to use this VirtualCamera
      MainCamera.createOrReplace(engine.CameraEntity, {
        virtualCameraEntity: cameraEntity
      })

      // Set Rotation
      const CamTrns = Transform.getMutable(cameraEntity)
      const Prnt = CamTrns.parent
      if(!Prnt) return
      const PrntTrns = Transform.getMutable(Prnt)
      PrntTrns.rotation = Quaternion.fromEulerDegrees(70, 90, 0)
    } else {
      // Revert back to the default player camera
      MainCamera.createOrReplace(engine.CameraEntity, {
        virtualCameraEntity: undefined
      })
    }
  }

  private freezePlayer(state: boolean) {
    if(state)
    {
      InputModifier.createOrReplace(engine.PlayerEntity, {
	      mode: {
		      $case: 'standard',
		      standard: {
			      disableAll: true,
		  },},})
    } else {
      InputModifier.deleteFrom(engine.PlayerEntity)
    }
  }
}

export let progressValue = 50 // Value between 0 and 100

export function setProgress(val: number) {
  progressValue = Math.min(Math.max(val, 0), 100) // Clamp between 0 and 100
}

export let curScore = 0
export let curRound = 0
export function UpdateScore(score: number, round: number) {
  curScore = score
  curRound = round
}

// Rotate a vector by a quaternion
function rotateByQuat(v: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }) {
  // t = 2 * cross(q.xyz, v);  v' = v + w*t + cross(q.xyz, t)
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  }
}