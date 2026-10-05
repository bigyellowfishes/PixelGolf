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
import { ArwHeightEnt, ArwTurnEnt, ghostShot, cameraEntity, ScoreZones } from './index'
import { Club, CLUB, applyClubType, cancelBackswing, createClub, playStrike, setClubVisible, startBackswing, updateClub } from './club'
import { getSelectedClubType, onClubSelected } from './clubSelect'
import { movePlayerTo } from '~system/RestrictedActions'

// The club in the player's hand, shared by every ball like the arrows
let club: Club | undefined

// Which camera has the view: the player's own, the ball cam, or the brief
// instant-cut camera used on the way back (see Game.InitCamera)
let camMode: 'player' | 'ball' | 'returning' = 'player'
let returnCam: Entity | undefined
let returnTimer = 0
// How long the return camera holds before handing the view back to the player
const RETURN_HOLD_SECONDS = 0.15

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
  Bunker: { outside: -1000, inside: -1000 },
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
  | 'Swinging'
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

// The ball currently being swung at or rolling. Only one at a time, since the
// arrows, camera and power bar are shared between all balls.
let activeGame: Game | null = null
// The ball whose score is shown in the UI (the last one played)
let shownGame: Game | null = null
// Every ball's game, so the UI can work out which prompt to show
const allGames: Game[] = []

// True from the first E press until the ball has come to rest and reset.
// The club rack uses it to lock club selection mid-shot.
export function isShotInProgress(): boolean {
  return activeGame !== null
}

// The instruction to show the player right now, or '' for none
export function getPrompt(): string {
  if (activeGame) {
    if (activeGame.state.phase === 'Swing_Height') return 'Press E to set your power'
    if (activeGame.state.phase === 'Swing_Turn') return 'Press E to set your curve and hit'
    return ''
  }
  for (const g of allGames) {
    if (g.state.phase === 'walking' && g.state.distanceToBall <= HIT_RANGE) return 'Press E to take your shot'
  }
  return ''
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
  private ballEntity: Entity

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
  // Bend in degrees captured on the third E press, used when the ball is struck
  private storedBend = 0
  // Seconds since the third E press, or -1 when no swing is under way
  private swingClock = -1
  private emoteFired = false
  // Whether the movement lock is on while the ball cam follows the ball
  private rollLock = false
  // Seconds since the first E press (stance and take-back), or -1 when not addressing
  private addressClock = -1
  private backswingStarted = false
  // 0..1, how far the club is drawn back while addressing. Follows the power meter.
  charge = 0

  constructor(physics: Physics, ballEntity: Entity) {
    this.physics = physics
    this.ballEntity = ballEntity
    this.startPos = physics.position()
    allGames.push(this)
    this.setArrow(ArwHeightEnt, false)
    this.setArrow(ArwTurnEnt, false)
    this.setArrow(ghostShot, false)
  }

  // -------------------------------------------------------------------------

  update(dt: number): void {
    if (this.inputLock > 0) this.inputLock -= dt

    // Only the ball last played drives the score UI
    if (shownGame === this || shownGame === null) UpdateScore(this.state.score, this.state.shot)

    // Only follow the camera while walking. Once the swing starts the aim is locked.
    if (this.state.phase === 'walking' || this.state.phase === 'Swing_Height') this.readAimFromCamera()

    // Refresh distanceToBall against the player's current position
    this.measure()

    // The swing runs on its own clock from the third press: emote, then the
    // ball leaves, then the camera goes to the ball. See CLUB in club.ts.
    // After stepping into the stance, take the club back to the top
    if (this.addressClock >= 0) {
      this.addressClock += dt
      if (!this.backswingStarted && this.addressClock >= CLUB.stanceSettle) {
        this.backswingStarted = true
        if (club) startBackswing(club)
      }
    }

    if (this.swingClock >= 0) {
      this.swingClock += dt
      if (!this.emoteFired && this.swingClock >= CLUB.emoteDelay) {
        this.emoteFired = true
        if (club) playStrike(club, this.storedPower)
      }
    }

    switch (this.state.phase) {
      case 'walking':
        // Don't reset the camera while another ball is mid-shot
        if (activeGame === null) this.UpdateCamera(false)
        this.physics.freeze()
        if (activeGame === null && this.state.distanceToBall <= HIT_RANGE && this.clicked()) {
          // No movement lock while addressing: it stops the swing animations playing.
          // Walking away cancels the shot instead (see below).
          this.beginSwing()
        }
        break

      case 'Swing_Height':
        if (this.walkedAway()) break
        this.setArrow(ghostShot, true)
        this.UpdateArrowDir(ghostShot)
        this.swingTime += dt
        this.charge = this.heightMeter()
        this.state.shotDistance = this.physics.predictRoll(this.charge)
        if (this.clicked()) this.lockHeight()
        break

      case 'Swing_Turn':
        if (this.walkedAway()) break
        this.swingTime += dt
        const f = (this.swingTime * BendTimeMulti / TURN_ANIM_SECONDS) % 1
        const p = Math.sin(2 * Math.PI * f)
        setProgress(50 - (p * 50))

        //
        if (this.clicked()) this.lockTurnAndSwing()
        break

      case 'Swinging':
        // The avatar is mid-swing. Launch at the swing's contact.
        if (this.emoteFired && this.swingClock >= CLUB.emoteDelay + CLUB.strikeDelay) this.strikeBall()
        break

      case 'rolling':
        // Stay on the player until the swing has been seen, then follow the ball,
        // unless the player has turned the ball cam off (key 1 or the on-screen button)
        this.setArrow(ghostShot, false)
        const swingSeen = this.swingClock < 0 || this.swingClock >= CLUB.emoteDelay + CLUB.watchSwingTime
        const useBallCam = ballCamEnabled && swingSeen
        if (swingSeen) this.UpdateCamera(useBallCam)
        // Movement is only locked while the ball cam has the view
        if (useBallCam !== this.rollLock) {
          this.rollLock = useBallCam
          this.freezePlayer(useBallCam)
        }
        this.updateRolling(dt)
        break
    }
  }

  // --- swing stages --------------------------------------------------------

  // Stage 0: E pressed by the ball. Remember where the player faces, show height arrow.
  private beginSwing(): void {
    activeGame = this
    shownGame = this

    // Move the shared follow camera onto this ball
    if (cameraEntity) Transform.getMutable(cameraEntity).parent = this.ballEntity

    // Change BarVis
    viewPower = true
    viewRotate = false

    // Update Player
    this.lockedYaw = this.aimYaw
    this.storedPower = 0
    this.state.phase = 'Swing_Height'
    this.inputLock = 0.2
    this.takeStance()
    this.addressClock = 0
    this.backswingStarted = false
  }

  // Step the player in beside the ball, facing the target. The swing animation
  // then turns them side-on so the club meets the ball (CLUB.stance in club.ts).
  private takeStance(): void {
    const b = this.physics.position()
    const fx = Math.sin(this.lockedYaw), fz = Math.cos(this.lockedYaw) // towards the target
    const rx = fz, rz = -fx // the player's right
    const ground = b.y - this.physics.ballRadius
    const x = b.x - rx * CLUB.stance.right - fx * CLUB.stance.ahead
    const z = b.z - rz * CLUB.stance.right - fz * CLUB.stance.ahead
    void movePlayerTo({
      newRelativePosition: Vector3.create(x, ground, z),
      avatarTarget: Vector3.create(x + fx * 10, ground + 1, z + fz * 10),
      cameraTarget: Vector3.create(x + fx * 20, ground, z + fz * 20)
    })
  }

  // The player walked off mid-shot: drop the shot and let them play again
  private walkedAway(): boolean {
    if (this.state.distanceToBall <= HIT_RANGE + 1) return false
    // Change BarVis
    viewPower = false
    viewRotate = false

    if (club) cancelBackswing(club)
    this.addressClock = -1
    this.charge = 0
    this.state.phase = 'walking'
    activeGame = null
    return true
  }

  // Stage 1: E pressed. Keep the power, swap to the turn arrow.
  private lockHeight(): void {
    this.storedPower = this.heightMeter()
    this.charge = this.storedPower // the club holds its backswing while you set the curve
    this.state.phase = 'Swing_Turn'
    this.inputLock = 0.2

    // Change BarVis
    viewPower = false
    viewRotate = true
  }

  // Stage 2: E pressed. Read the bend and swing.
  private lockTurnAndSwing(): void {
    this.storedBend = this.turnMeter() * MAX_BEND_DEG

    // Change BarVis
    viewPower = false
    viewRotate = false

    // Lift the movement lock before the emote fires, so nothing can block it.
    // It goes back on when the camera moves to the ball.
    this.freezePlayer(false)
    this.addressClock = -1
    this.swingClock = 0
    this.emoteFired = false
    this.state.phase = 'Swinging'
    this.inputLock = 0.2
  }

  // Stage 3: the ball leaves.
  private strikeBall(): void {
    this.hit(this.storedPower, this.storedBend)
    this.state.shot++
    this.state.phase = 'rolling'
    this.settleTimer = 0
    this.charge = 0
  }

  // --- club ----------------------------------------------------------------

  // Build the shared club once at startup (see club.ts)
  static InitClub(): void {
    club = createClub(getSelectedClubType())
    setClubVisible(club, false)
    // Picking a club on the rack swaps the model in the hand
    onClubSelected((type) => {
      if (club) applyClubType(club, type)
    })
  }

  // Runs once per frame after every ball has updated. One club, so one place drives it.
  static UpdateClubFrame(dt: number): void {
    if (!club) return
    const g = activeGame
    // At address while setting power and curve; in the hand otherwise
    const addressing = g !== null && (g.state.phase === 'Swing_Height' || g.state.phase === 'Swing_Turn')
    updateClub(club, dt, addressing, g ? g.charge : 0)

    // In hand as you walk up to a ball, and for the whole shot
    const nearBall = allGames.some((x) => x.state.phase === 'walking' && x.state.distanceToBall <= HIT_RANGE)
    setClubVisible(club, g !== null || nearBall || club.strikeTimer > 0)
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

    this.UpdateArrowDir(ent)
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

  // Value For Locking Arrow Dir
  pi: number = Math.PI 
  pio2: number = this.pi / 2
  aimAllow: number = this.pi / 4

  // Update the arrow to allow aiming while Arrow Hieght is Playing
  private UpdateArrowDir(ent: Entity | undefined): void {
    // Grab Current Player Yaw, Locked to a specific rotation range
    this.lockedYaw = Math.max(Math.min(this.aimYaw, this.pio2 + this.aimAllow), this.pio2 - this.aimAllow)
    
    if (!ent) return

    // Put the arrow on the ball, pointing along the locked aim
    const b = this.physics.position()
    const t = Transform.getMutable(ent)
    t.position = Vector3.create(b.x, b.y, b.z)
    t.rotation = Quaternion.fromEulerDegrees(0, ((this.lockedYaw * 180)) / Math.PI, 0)
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

  // How Much To Clamp The Score
  scoreClamp: number = 10

  // Tests the ball against every score zone
  private scoreBall(): { points: number; zone: string } {
    const ball = this.physics.position()
    let Zone = { points: 0, zone: '' }

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
      console.log(key)

      const sInRange = Math.round(s.outside + (s.inside - s.outside) * (1 - edge))
      const points = Math.ceil(sInRange / this.scoreClamp) * this.scoreClamp
      Zone = { points, zone: key }
    }
    return Zone
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

    // Check if Ball Is OOB
    if(ball.z > 400 || ball.z < 100 || ball.y < 0) this.ResetBall()
    
    // Count Down Ball Settled For Shot Done
    if (this.physics.settled()) {
      this.physics.freeze()
      this.settleTimer += dt
      if (this.settleTimer >= SETTLE_HOLD) {
        this.ResetBall()
      }
    } else {
      this.settleTimer = 0
    }
  }

  private ResetBall() {
    // Freeze Physics
    this.physics.freeze()

    // Handle Scoring
    const result = this.scoreBall()
    this.state.lastShotScore = result.points
    this.state.lastZone = result.zone
    this.state.score += result.points

    // Reset Player and Physics
    this.physics.place(this.startPos.x, this.startPos.y, this.startPos.z)
    this.settleTimer = 0
    this.state.phase = 'walking'
    activeGame = null
    this.swingClock = -1
    this.rollLock = false
    this.freezePlayer(false)
  }

  // --- Camera Settings
  static InitCamera() {
    // Test the Camera Obj Exists
    if(!cameraEntity) return

    // Attach the VirtualCamera component to the camera entity.
    // A zero-second transition makes the cut to the ball cam instant rather than a blend.
    VirtualCamera.create(cameraEntity, {
      defaultTransition: { transitionMode: { $case: 'time', time: 0 } }
    })

    // The "return" camera. The client always blends when it hands the view back
    // to the player's own camera, and a scene can't change that. So before
    // cutting to the ball cam we note where the player's camera is, and on the
    // way back we cut instantly to this camera parked at that spot, then hand
    // back. The client's blend then goes from a point to the same point, so it
    // can't be seen.
    returnCam = engine.addEntity()
    Transform.create(returnCam, {})
    VirtualCamera.create(returnCam, {
      defaultTransition: { transitionMode: { $case: 'time', time: 0 } }
    })
  }

  // Runs once per frame from index.ts: finishes the hand-back to the player camera
  static UpdateCameraFrame(dt: number): void {
    if (camMode !== 'returning') return
    returnTimer -= dt
    if (returnTimer <= 0) {
      MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
      camMode = 'player'
    }
  }

  private UpdateCamera(State: boolean) {
    // Test the Camera Obj Exists
    if(!cameraEntity) return

    if(State)
    {
      if (camMode !== 'ball') {
        // Remember where the player's own camera is, for the instant cut back.
        // (Only from the player camera: while a scene camera is active, the
        // camera transform the scene reads is the scene camera's.)
        if (camMode === 'player' && returnCam) {
          const cam = Transform.getOrNull(engine.CameraEntity)
          if (cam) {
            const r = Transform.getMutable(returnCam)
            r.position = Vector3.create(cam.position.x, cam.position.y, cam.position.z)
            r.rotation = Quaternion.create(cam.rotation.x, cam.rotation.y, cam.rotation.z, cam.rotation.w)
          }
        }
        // Force the player's MainCamera to use this VirtualCamera
        MainCamera.createOrReplace(engine.CameraEntity, {
          virtualCameraEntity: cameraEntity
        })
        camMode = 'ball'
      }

      // Set Rotation
      const CamTrns = Transform.getMutable(cameraEntity)
      const Prnt = CamTrns.parent
      if(!Prnt) return
      const PrntTrns = Transform.getMutable(Prnt)
      PrntTrns.rotation = Quaternion.fromEulerDegrees(70, 90, 0)
    } else if (camMode === 'ball') {
      // Back to the player camera: cut instantly to the return camera first,
      // then UpdateCameraFrame hands the view back once it has taken effect
      if (returnCam) {
        MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: returnCam })
        camMode = 'returning'
        returnTimer = RETURN_HOLD_SECONDS
      } else {
        MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
        camMode = 'player'
      }
    }
  }

  private freezePlayer(state: boolean) {
    if(state)
    {
      // Lock movement only. disableAll also blocks emotes, which stopped the
      // avatar's swing animation (club.ts) from playing.
      InputModifier.createOrReplace(engine.PlayerEntity, {
        mode: {
          $case: 'standard',
          standard: {
            disableWalk: true,
            disableJog: true,
            disableRun: true,
            disableJump: true,
            disableDoubleJump: true,
            disableGliding: true,
            disableEmote: false
          }
        }
      })
    } else {
      InputModifier.deleteFrom(engine.PlayerEntity)
    }
  }
}

// ---------------------------------------------------------------------------
// Player settings
// ---------------------------------------------------------------------------

// Whether the camera follows the ball after a shot. Toggled with key 1 or the on-screen button.
export let ballCamEnabled = true

export function toggleBallCam(): void {
  ballCamEnabled = !ballCamEnabled
}

// Key 1 toggles the ball cam. Runs once per frame from index.ts.
export function updateSettingsInput(): void {
  if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) toggleBallCam()
}

export let progressValue = 50 // Value between 0 and 100
export let viewPower: boolean
export let viewRotate: boolean

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