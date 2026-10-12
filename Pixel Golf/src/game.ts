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
  InputModifier,
  PrimaryPointerInfo
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { ArwHeightEnt, ArwTurnEnt, ghostShot, cameraEntity, ScoreZones } from './index'
import { Club, CLUB, applyClubType, cancelBackswing, createClub, playStrike, setClubVisible, startBackswing, updateClub } from './club'
import { getSelectedClubType, onClubSelected } from './clubSelect'
import { movePlayerTo } from '~system/RestrictedActions'
import { playAt, playUi } from './sfx'
import { HOT, ROUND_BALLS, ZONE_SCORES } from './ledger/rules'
import { BallResult, isHot, submitRound, myBay, bayTakenBy, bayLockReason, sendShot, sendShotDone, RemoteShot, BayScore, tutorial, TUTORIAL_BAY, TUTORIAL_BALLS } from './ledger/client'

// The club in the player's hand, shared by every ball like the arrows
let club: Club | undefined

// Which camera has the view: the player's own, the ball cam, or the brief
// instant-cut camera used on the way back (see Game.InitCamera)
let camMode: 'player' | 'ball' | 'returning' = 'player'
let returnCam: Entity | undefined
let returnTimer = 0
// How long the return camera holds before handing the view back to the player
const RETURN_HOLD_SECONDS = 0.15

// ---------------------------------------------------------------------------
// Ball cam orbit (Settings > Orbit camera, off by default): while the ball cam
// follows a shot, hold the left mouse button (or touch) and drag to orbit around
// the ball, or use A / D. W / S zoom in and out. Every shot starts from the default view.
// ---------------------------------------------------------------------------
const ORBIT_DEFAULT = { pitch: 70, yaw: 90, distance: 20 } // degrees, degrees, metres
const ORBIT_DRAG_SPEED = 0.25   // degrees per pixel dragged
const ORBIT_KEY_SPEED = 90      // degrees per second with A / D
const ORBIT_ZOOM_SPEED = 15     // metres per second with W / S
const ORBIT_PITCH_LIMITS = { min: 8, max: 88 } // 8 = almost level with the ball, 88 = straight down
const ORBIT_ZOOM_LIMITS = { min: 3, max: 40 }

let orbitPitch = ORBIT_DEFAULT.pitch
let orbitYaw = ORBIT_DEFAULT.yaw
let orbitDistance = ORBIT_DEFAULT.distance

function resetOrbit(): void {
  orbitPitch = ORBIT_DEFAULT.pitch
  orbitYaw = ORBIT_DEFAULT.yaw
  orbitDistance = ORBIT_DEFAULT.distance
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

// Read the player's orbit and zoom input for this frame
function readOrbitInput(dt: number): void {
  if (!orbitCamEnabled) return
  if (inputSystem.isPressed(InputAction.IA_POINTER)) {
    const delta = PrimaryPointerInfo.getOrNull(engine.RootEntity)?.screenDelta
    if (delta) {
      orbitYaw += delta.x * ORBIT_DRAG_SPEED
      orbitPitch += delta.y * ORBIT_DRAG_SPEED
    }
  }
  if (inputSystem.isPressed(InputAction.IA_LEFT)) orbitYaw -= ORBIT_KEY_SPEED * dt
  if (inputSystem.isPressed(InputAction.IA_RIGHT)) orbitYaw += ORBIT_KEY_SPEED * dt
  if (inputSystem.isPressed(InputAction.IA_FORWARD)) orbitDistance -= ORBIT_ZOOM_SPEED * dt
  if (inputSystem.isPressed(InputAction.IA_BACKWARD)) orbitDistance += ORBIT_ZOOM_SPEED * dt
  orbitPitch = clamp(orbitPitch, ORBIT_PITCH_LIMITS.min, ORBIT_PITCH_LIMITS.max)
  orbitDistance = clamp(orbitDistance, ORBIT_ZOOM_LIMITS.min, ORBIT_ZOOM_LIMITS.max)
}

// Place the ball cam. It's parented to the ball, so turning the ball's transform
// swings the camera around it, and its local distance is divided by the ball's scale.
function applyOrbit(): void {
  if (!cameraEntity) return
  const cam = Transform.getMutable(cameraEntity)
  if (!cam.parent) return
  const ball = Transform.getMutable(cam.parent)
  ball.rotation = Quaternion.fromEulerDegrees(orbitPitch, orbitYaw, 0)
  const scale = ball.scale.x || 1
  cam.position = Vector3.create(0, 0, -orbitDistance / scale)
}

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
  // The ball's velocity, and launching it at a given velocity (for watching others' shots)
  velocity(): { x: number; y: number; z: number }
  launch(vx: number, vy: number, vz: number): void
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

// What each zone is worth (edge and centre) now lives in ledger/rules.ts as
// ZONE_SCORES, so the server checks every ball against the same table.

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
  // Another player's shot from this bay, playing out so everyone can watch it
  | 'watching'

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
  // Whether the last ball landed on the hot target (its points were doubled)
  lastHot: boolean
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

// Tutorial Value Where
// 0: Tell Player To Line Up First Shot
// 1: Tell Player To 
let TUTORIAL_STEP = 0
// True after a tutorial shot missed, until the player starts that shot again
let TUTORIAL_RETRY = false
// Each tutorial shot's in-flight step, and the step that shot started from. A miss goes back to the start.
const TUTORIAL_SHOT_STARTS: Record<number, number> = { 4: 0, 9: 5, 13: 10, 17: 14, 19: 18 }

// Back to the first tutorial step, so the tutorial can run again in the same visit (after an admin ledger reset)
export function resetTutorialSteps(): void {
  TUTORIAL_STEP = 0
  TUTORIAL_RETRY = false
}


// True from the first E press until the ball has come to rest and reset.
// The club rack uses it to lock club selection mid-shot.
export function isShotInProgress(): boolean {
  return activeGame !== null
}

// The instruction to show the player right now, or '' for none
export function getPrompt(): string {
  if(tutorial.active && TUTORIAL_RETRY && !activeGame) return 'Missed! That one doesn\'t count. Press E to try again.'
  if(tutorial.active && TUTORIAL_STEP <= 18)
  {
    if(TUTORIAL_STEP == 0) return 'Welcome to Pixel Golf! Press E to begin.'
    if(TUTORIAL_STEP == 1) return 'Let\'s aim for the orange target.'
    if(TUTORIAL_STEP == 2) return 'The first bar is power. Let\'s give it some beans!'
    if(TUTORIAL_STEP == 3) return 'The second bar is aim. Try to hit the centre.'
    if(TUTORIAL_STEP == 4) return ''
    if(TUTORIAL_STEP == 5) return 'Wow, nice shot! Press E to keep shooting.'
    if(TUTORIAL_STEP == 6) return 'Now try aiming yourself: press and drag.'
    if(TUTORIAL_STEP == 7) return 'Press E to lock in power.'
    if(TUTORIAL_STEP == 8) return 'Press E to lock in aim.'
    if(TUTORIAL_STEP == 9) return ''
    if(TUTORIAL_STEP == 10) return 'Now try setting the power yourself.'
    if(TUTORIAL_STEP == 11) return 'Press E to lock in power.'
    if(TUTORIAL_STEP == 12) return 'Press E to lock in aim.'
    if(TUTORIAL_STEP == 13) return ''
    if(TUTORIAL_STEP == 14) return 'Now try setting the aim bar yourself.'
    if(TUTORIAL_STEP == 15) return 'Press E to lock in power.'
    if(TUTORIAL_STEP == 16) return 'Press E to lock in aim.'
    if(TUTORIAL_STEP == 17) return ''
    if(TUTORIAL_STEP == 18) return 'Last shot! Land it on a target to finish.'
  }
  if (activeGame) {
    if (activeGame.state.phase === 'Swing_Height') return 'Press E to set your power'
    if (activeGame.state.phase === 'Swing_Turn') return 'Press E to set your curve and hit'
    if (activeGame.state.phase === 'rolling' && camMode === 'ball' && orbitCamEnabled) return 'Drag or A / D to orbit    W / S to zoom'
    return ''
  }
  for (const g of allGames) {
    if (g.state.phase === 'walking' && g.state.distanceToBall <= HIT_RANGE) {
      if (!g.isMine()) {
        // The tutorial bay is closed after the tutorial, and every other bay is closed during it
        const locked = bayLockReason(g.bay)
        if (locked) return locked
        // One player, one bay
        const takenBy = bayTakenBy(g.bay)
        if (takenBy) return `Bay ${g.bay} is in use by ${takenBy}`
        let mBay = g.bay
        if(mBay != 20)
        {
          return myBay() === 0
            ? `Click Bay ${mBay}'s Tee Off screen to play here`
            : `Your bay is Bay ${myBay()}. Click this Tee Off screen to move here`
        } else {
          return myBay() === 0
            ? `Click Solo Bays's Tee Off screen to play here`
            : `Your bay is Bay ${myBay()}. Click this Tee Off screen to move here`
        }
      }
      return g.state.shot >= g.roundBalls() ? 'Press E to start a new round' : 'Press E to take your shot'
    }
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
    lastHot: false,
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

  // Every ball of the round so far, posted to the ledger when the last one lands
  private roundLog: BallResult[] = []

  // The bay this ball sits in (Ball_N is in bay N)
  readonly bay: number

  constructor(physics: Physics, ballEntity: Entity, bay = 0) {
    this.physics = physics
    this.ballEntity = ballEntity
    this.bay = bay
    this.startPos = physics.position()
    allGames.push(this)
    this.setArrow(ArwHeightEnt, false)
    this.setArrow(ArwTurnEnt, false)
    this.setArrow(ghostShot, false)
  }

  // -------------------------------------------------------------------------
  update(dt: number): void {

    // Do Tutorial Stuff
    if(tutorial.active)
    {
      if(TUTORIAL_STEP == 0) this.freezePlayer(true)
      // Lock Power In Tutorial 1
      if(TUTORIAL_STEP == 1 || TUTORIAL_STEP == 2) this.swingTime = 0.757
      if(TUTORIAL_STEP == 6 || TUTORIAL_STEP == 7) this.swingTime = 0.757
      // Lock Bend In Tutorial 1
      if(TUTORIAL_STEP == 3) this.swingTime = 1.62
      if(TUTORIAL_STEP == 8) this.swingTime = 0.0
      if(TUTORIAL_STEP == 12) this.swingTime = 0.0
    }

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
        playAt('swing_whoosh', this.physics.position(), 0.6 + this.storedPower * 0.4)
      }
    }

    switch (this.state.phase) {
      case 'walking':
        // Don't reset the camera while another ball is mid-shot
        if (activeGame === null) this.UpdateCamera(false)
        this.physics.freeze()
        // Only the ball in your own bay (picked by clicking its Tee Off screen)
        if (activeGame === null && this.isMine() && this.state.distanceToBall <= HIT_RANGE && this.clicked()) {
          // No movement lock while addressing: it stops the swing animations playing.
          // Walking away cancels the shot instead (see below).
          this.beginSwing()
        }
        break

      case 'Swing_Height':
        if (tutorial.active) TUTORIAL_RETRY = false
        if (TUTORIAL_STEP == 0) TUTORIAL_STEP = 1
        if (TUTORIAL_STEP == 5) TUTORIAL_STEP = 6
        if (TUTORIAL_STEP == 10) TUTORIAL_STEP = 11
        if (TUTORIAL_STEP == 14) TUTORIAL_STEP = 15
        if (TUTORIAL_STEP == 18) TUTORIAL_STEP = 19

        if (this.walkedAway()) break
        this.setArrow(ghostShot, true)
        this.UpdateArrowDir(ghostShot)
        if(!tutorial.active || TUTORIAL_STEP > 8) this.swingTime += dt
        this.charge = this.heightMeter()
        this.state.shotDistance = this.physics.predictRoll(this.charge)

        if (!tutorial.active && this.clicked()) this.lockHeight()
        if (tutorial.active && TUTORIAL_STEP == 4 && this.clicked()) this.lockHeight()
        if (tutorial.active && TUTORIAL_STEP == 2 && this.clicked()) this.lockHeight()
        if (tutorial.active && TUTORIAL_STEP == 1 && this.clicked()) TUTORIAL_STEP = 2
        if (tutorial.active && TUTORIAL_STEP == 7 && this.clicked()) this.lockHeight()
        if (tutorial.active && TUTORIAL_STEP == 6 && this.clicked()) TUTORIAL_STEP = 7
        if (tutorial.active && TUTORIAL_STEP > 8 && this.clicked()) this.lockHeight()
        break

      case 'Swing_Turn':
        if (TUTORIAL_STEP == 2) TUTORIAL_STEP = 3
        if (TUTORIAL_STEP == 7) TUTORIAL_STEP = 8
        if (TUTORIAL_STEP == 11) TUTORIAL_STEP = 12
        if (TUTORIAL_STEP == 15) TUTORIAL_STEP = 16
        if (this.walkedAway()) break
        if(!tutorial.active || TUTORIAL_STEP > 12) this.swingTime += dt
        const f = (this.swingTime * BendTimeMulti / TURN_ANIM_SECONDS) % 1
        const p = Math.sin(2 * Math.PI * f)
        setProgress(50 - (p * 50))

        // When Turn / Bend Meter Is selected
        if (this.clicked()) {
          this.lockTurnAndSwing()
          if (TUTORIAL_STEP == 3) TUTORIAL_STEP = 4
          if (TUTORIAL_STEP == 8) TUTORIAL_STEP = 9
          if (TUTORIAL_STEP == 12) TUTORIAL_STEP = 13
          if (TUTORIAL_STEP == 16) TUTORIAL_STEP = 17
        }
        break

      case 'Swinging':
        // The avatar is mid-swing. Launch at the swing's contact.
        if (this.emoteFired && this.swingClock >= CLUB.emoteDelay + CLUB.strikeDelay) this.strikeBall()
        break

      case 'watching':
        // While Player is watching the ball
        this.updateWatching(dt)
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
          //this.freezePlayer(useBallCam)
        }
        this.updateRolling(dt)
        break
    }
  }

  // Shots in a round at this ball: the tutorial's short round in the tutorial bay, otherwise ROUND_BALLS
  roundBalls(): number {
    return this.bay === TUTORIAL_BAY ? TUTORIAL_BALLS : ROUND_BALLS
  }

  // Whether this ball is in the bay the player has picked
  isMine(): boolean {
    return this.bay !== 0 && this.bay === myBay()
  }

  // --- swing stages --------------------------------------------------------

  // Stage 0: E pressed by the ball. Remember where the player faces, show height arrow.
  private beginSwing(): void {
    // The last round is finished: this ball starts a fresh one
    if (this.state.shot >= this.roundBalls()) this.newRound()

    // Lock The players first shot in the tutorial
    if(TUTORIAL_STEP == 0 && tutorial.active) {
      ScoreZones.Orange
      let lookAtTarget: Entity | undefined
      lookAtTarget = ScoreZones.Orange
      if(lookAtTarget)
      {
        const myVirtualCam = engine.addEntity()
        Transform.create(myVirtualCam, {
          position: Vector3.create(97.27, 35.55, 334.03) // Where the camera itself is placed in the scene
        })
        
        VirtualCamera.create(myVirtualCam, {
          lookAtEntity: lookAtTarget,
        })

        MainCamera.createOrReplace(engine.CameraEntity, {
          virtualCameraEntity: myVirtualCam,
        })
      }
    }

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
    playUi('ui_click')
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
    playUi('meter_lock', 1, 0.9 + this.storedPower * 0.4) // higher blip for more power
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
    playUi('meter_lock', 1, 1.3)

    // Change BarVis
    viewPower = false
    viewRotate = false

    // Lift the movement lock before the emote fires, so nothing can block it.
    // It goes back on when the camera moves to the ball.
    //this.freezePlayer(false)
    this.addressClock = -1
    this.swingClock = 0
    this.emoteFired = false
    this.state.phase = 'Swinging'
    this.inputLock = 0.2
  }

  // Stage 3: the ball leaves.
  private strikeBall(): void {
    // Driver lowest, wedge highest; harder swings are louder
    const clubPitch = { driver: 0.92, iron: 1.04, wedge: 1.16 }[getSelectedClubType()]
    playAt('club_hit', this.physics.position(), 0.55 + this.storedPower * 0.45, clubPitch)
    this.hit(this.storedPower, this.storedBend)
    // Everyone else plays the same shot on this bay's ball
    const v = this.physics.velocity()
    sendShot(this.bay, v.x, v.y, v.z)
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
    const nearBall = allGames.some((x) => x.isMine() && x.state.phase === 'walking' && x.state.distanceToBall <= HIT_RANGE)
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

    // Handle Scoring. The hot target doubles a ball's points (see ledger/rules.ts).
    const result = this.scoreBall()

    // In the tutorial a miss (no target, a bunker, or off the range) doesn't count: the ball
    // comes back and the player takes that shot again from the same tutorial step
    if (tutorial.active && this.bay === TUTORIAL_BAY && result.points <= 0) {
      playResultSound(result.zone, result.points, false)
      this.state.shot = Math.max(0, this.state.shot - 1)
      this.state.lastShotScore = 0
      this.state.lastZone = 'Missed'
      this.state.lastHot = false
      const start = TUTORIAL_SHOT_STARTS[TUTORIAL_STEP]
      if (start !== undefined) TUTORIAL_STEP = start
      TUTORIAL_RETRY = true
      this.physics.place(this.startPos.x, this.startPos.y, this.startPos.z)
      this.settleTimer = 0
      this.state.phase = 'walking'
      activeGame = null
      this.swingClock = -1
      this.rollLock = false
      return
    }

    const hot = result.zone !== '' && isHot(result.zone)
    const points = hot ? result.points * HOT.factor : result.points
    this.state.lastShotScore = points
    this.state.lastZone = result.zone
    this.state.lastHot = hot
    this.state.score += points
    playResultSound(result.zone, points, hot)

    // Update Tutorial States
    if (TUTORIAL_STEP == 4) TUTORIAL_STEP = 5
    if (TUTORIAL_STEP == 9) TUTORIAL_STEP = 10
    if (TUTORIAL_STEP == 13) TUTORIAL_STEP = 14
    if (TUTORIAL_STEP == 17) TUTORIAL_STEP = 18

    // Ten balls make a round. The ledger is sent base points and which balls were
    // hot, and does the doubling itself. The tutorial's short round isn't sent: the server
    // only takes full rounds, and the tutorial is ticked off by its own message (tutorial.ts).
    this.roundLog.push({ zone: result.zone, points: result.points, hot })
    if (this.roundLog.length >= this.roundBalls()) {
      const balls = this.roundLog.slice(0, this.roundBalls())
      this.roundLog = []
      if (this.bay !== TUTORIAL_BAY) submitRound(balls)
      for (const fn of roundFinishedFns) fn({ score: this.state.score, hotHits: balls.filter((b) => b.hot).length })
    }

    // Reset Player and Physics
    this.physics.place(this.startPos.x, this.startPos.y, this.startPos.z)
    this.settleTimer = 0
    this.state.phase = 'walking'
    activeGame = null
    this.swingClock = -1
    this.rollLock = false
    if(!tutorial.active) this.freezePlayer(false)

    // Everyone else's screen for this bay shows the same numbers
    sendShotDone({
      bay: this.bay,
      score: this.state.score,
      shot: this.state.shot,
      last: this.state.lastShotScore,
      zone: this.state.lastZone,
      hot: this.state.lastHot
    })
  }

  // --- other players' shots ----------------------------------------------------

  private watchClock = 0

  // Another player hit the ball in this bay: play the same shot here
  watchShot(s: RemoteShot): void {
    if (this.isMine() || activeGame === this) return
    this.physics.place(this.startPos.x, this.startPos.y, this.startPos.z)
    this.physics.launch(s.vx, s.vy, s.vz)
    this.state.phase = 'watching'
    this.settleTimer = 0
    this.watchClock = 0
  }

  // Their bay's numbers after the shot, for this bay's screen
  showBayScore(d: BayScore): void {
    if (this.isMine()) return
    this.state.score = d.score
    this.state.shot = d.shot
    this.state.lastShotScore = d.last
    this.state.lastZone = d.zone
    this.state.lastHot = d.hot
  }

  // A watched ball goes back on its tee once it stops, leaves the range or takes too long
  private updateWatching(dt: number): void {
    this.watchClock += dt
    const ball = this.physics.position()
    const out = ball.z > 400 || ball.z < 100 || ball.y < 0
    if (this.physics.settled()) this.settleTimer += dt
    else this.settleTimer = 0
    if (out || this.settleTimer >= SETTLE_HOLD || this.watchClock > 20) {
      this.physics.place(this.startPos.x, this.startPos.y, this.startPos.z)
      this.physics.freeze()
      this.state.phase = 'walking'
    }
  }

  // Where this ball sits on its tee
  teePosition(): { x: number; y: number; z: number } {
    return { ...this.startPos }
  }

  // Clear the bay for a fresh round of ten
  newRound(): void {
    this.state.shot = 0
    this.state.score = 0
    this.state.lastShotScore = 0
    this.state.lastZone = ''
    this.state.lastHot = false
    this.roundLog = []
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
    if (camMode === 'ball') {
      readOrbitInput(dt)
      return
    }
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
        // Each shot starts from the default view
        resetOrbit()
      }

      // Orbit and zoom from the player's input (see readOrbitInput)
      applyOrbit()
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
  for (const fn of settingFns) fn('ballCam', ballCamEnabled)
}

// Whether the player can orbit and zoom the ball cam. Toggled in the Settings panel.
export let orbitCamEnabled = false

export function toggleOrbitCam(): void {
  orbitCamEnabled = !orbitCamEnabled
  // Back to the standard view straight away when it's turned off
  if (!orbitCamEnabled) resetOrbit()
  for (const fn of settingFns) fn('orbitCam', orbitCamEnabled)
}

// Called whenever a camera setting is switched, so it can be saved on the ledger
const settingFns: ((key: string, on: boolean) => void)[] = []
export function onSettingChanged(fn: (key: string, on: boolean) => void): void {
  settingFns.push(fn)
}

// The switches saved on the ledger from last time. Sets them without saving them again.
export function applySavedSettings(saved: Record<string, boolean>): void {
  if (typeof saved.ballCam === 'boolean') ballCamEnabled = saved.ballCam
  if (typeof saved.orbitCam === 'boolean') {
    orbitCamEnabled = saved.orbitCam
    if (!orbitCamEnabled) resetOrbit()
  }
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

// Called on the player's own client the moment their tenth ball lands, before the
// ledger answers. The ledger's answer (multiplier, XP, Pixel Points) comes after.
type RoundFinished = { score: number; hotHits: number }
const roundFinishedFns: ((r: RoundFinished) => void)[] = []
export function onRoundFinished(fn: (r: RoundFinished) => void): void {
  roundFinishedFns.push(fn)
}

// The ball count and round total of the bay last played, for the HUD
export function getRoundProgress(): { ball: number; balls: number; score: number } {
  const g = shownGame
  return { ball: g ? g.state.shot : 0, balls: g ? g.roundBalls() : ROUND_BALLS, score: g ? g.state.score : 0 }
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

// The jingle for where a shot finished: sand for a bunker, a miss for no zone,
// and bigger jingles for the harder targets
function playResultSound(zone: string, points: number, hot = false): void {
  const colour = zone.replace(/\d+$/, '')
  if (colour === 'Bunker') playUi('bunker_sand')
  else if (hot) playUi('score_great')
  else if (points <= 0) playUi('score_miss')
  else if (colour === 'Blue' || colour === 'White' || colour === 'Black') playUi('score_great')
  else if (colour === 'Green' || colour === 'Orange') playUi('score_good')
  else playUi('score_small')
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
