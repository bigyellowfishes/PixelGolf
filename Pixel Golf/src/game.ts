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
import { Club, CLUB, applyClubType, cancelBackswing, createClub, playStrike, setClubVisible, startBackswing, updateClub, isSwingGrip } from './club'
import { reportMyClub } from './clubSync'
import { getSelectedClubType, getLaunchPower, onClubSelected, selectClub, getClubScale } from './clubSelect'
import { movePlayerTo } from '~system/RestrictedActions'
import { playAt, playUi } from './sfx'
import { HOT, ROUND_BALLS, ZONE_SCORES } from './ledger/rules'
import { BallResult, isHot, submitRound, myBay, bayTakenBy, bayLockReason, askShot, sendShotDone, ServerShot, BayScore, tutorial, TUTORIAL_BAY, TUTORIAL_BALLS, SOLO_BAY } from './ledger/client'
import { ShotPath, Vec3, launchVelocity } from './ballSim'

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
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

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

// The ball, as the game sees it. Shots aren't simulated live: a shot is simulated from
// start to finish first (on the server for shared bays, here for the tutorial and solo
// bay), then played back from its keyframes. See ballSim.ts.
export type Physics = {
  ballRadius: number
  position(): { x: number; y: number; z: number }
  // True when no shot is playing back (the ball is where the last shot left it)
  settled(): boolean
  // Puts the ball here at once, cancelling any shot
  place(x: number, y: number, z: number): void
  // Stops a shot's playback where it is
  freeze(): void
  // Simulates a shot on this screen, a few steps a frame, then calls done with its path
  simulate(launch: Vec3, done: (path: ShotPath) => void): void
  // Plays a simulated shot from its start
  play(path: ShotPath): void
  // Jumps a playing shot forward so only its last `lead` seconds are left to play
  skip(lead: number): void
  // Seconds of the playing shot still to go (0 when none is playing)
  remaining(): number
  // Playback speed of the shot playing now (1, 2 or 3). play() starts every shot at 1.
  setSpeed(speed: number): void
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

// How long the ball sits at rest after its shot has played, before it's scored and reset.
// The shot itself already ends with about a third of a second of the ball standing still.
const SETTLE_HOLD = 0.25

// How long to wait for the server's simulation of a shared shot (from the curve being locked)
// before playing it on this screen only instead. Normally it arrives during the swing.
const SERVER_WAIT_SECONDS = 4

// Skipping a shot: E jumps ahead so only the last SKIP_SHOW_LAST seconds play, so the player
// still sees the ball come in and settle. Only after the shot has been playing SKIP_AFTER_SECONDS,
// so the E press that hit the ball (or a double tap) can't skip it, and only while there's more
// than a moment left to skip.
const SKIP_AFTER_SECONDS = 0.6
const SKIP_SHOW_LAST = 1.5
const SKIP_MIN_SAVING = 0.75

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
// The tutorial (bay 19, see tutorial.ts). Its first shot is a guided one: the camera is lined
// up on the orange target and every step of the swing is explained. After that the player aims
// themselves, and each step still says what it's for and which button to press. The meters are
// always live: nothing is pre-set or frozen, so the game never looks stuck.
// True after a tutorial shot missed, until the player starts that shot again
let TUTORIAL_RETRY = false
// The camera that points the guided first shot at the orange target (made once, reused)
let tutorialCam: Entity | undefined
// Whether the tutorial has the player's movement locked (they aim by turning the camera instead)
let tutorialFrozen = false

// Right after the tutorial ends (finished or skipped) the player is still standing at bay 19, which
// is now closed to them. Its "reserved for the tutorial" notice waits until they've walked away
// from where they were standing, so it doesn't pop up over the end of the tutorial.
let bayNoticeFrom: { x: number; z: number } | null = null
const BAY_NOTICE_WALK = 1.5 // metres

export function holdTutorialBayNotice(): void {
  const p = Transform.getOrNull(engine.PlayerEntity)?.position
  bayNoticeFrom = p ? { x: p.x, z: p.z } : null
}

function tutorialBayNoticeHeld(): boolean {
  if (!bayNoticeFrom) return false
  const p = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!p) return true
  if (Math.hypot(p.x - bayNoticeFrom.x, p.z - bayNoticeFrom.z) < BAY_NOTICE_WALK) return true
  bayNoticeFrom = null // they've moved: from now on the notice shows as normal
  return false
}

// Back to the start of the tutorial, so it can run again in the same visit (after an admin ledger reset)
export function resetTutorialSteps(): void {
  TUTORIAL_RETRY = false
}

// The tutorial teaches one thing per shot, once:
//   shot 1  POWER  (lined up on the orange target for them, and hit straight: no curve yet)
//   shot 2  CURVE  (still lined up for them)
//   shot 3  AIM    (they turn the camera themselves)
//   shots 4 and 5  just play, with the everyday prompts
// A lesson is picked by how many shots of the round are already counted.
const LESSON_POWER = 0
const LESSON_CURVE = 1
const LESSON_AIM = 2
// Where the power bar's target line sits on the first two shots. With the ball hit straight, this
// much power lands on the orange target from bay 19.
const TUTORIAL_POWER_TARGET = 93

// Whether this tutorial shot is lined up on the orange target for the player (aim not taught yet)
function tutorialAutoAim(g: Game): boolean {
  return tutorial.active && g.bay === TUTORIAL_BAY && g.state.shot < LESSON_AIM
}

// Whether this tutorial shot skips the curve (it hasn't been taught yet) and goes straight
function tutorialPowerOnly(g: Game): boolean {
  return tutorial.active && g.bay === TUTORIAL_BAY && g.state.shot === LESSON_POWER
}

// The tutorial's coaching for the bay 19 ball, or '' to fall through to the everyday prompts.
function tutorialPrompt(g: Game): string {
  const n = g.state.shot
  const last = n === g.roundBalls() - 1
  switch (g.state.phase) {
    case 'walking':
      if (TUTORIAL_RETRY) return 'Missed! That one doesn\'t count. Press E to try again.'
      if (n === LESSON_POWER) return 'Welcome to Pixel Golf! Press E to start.'
      if (n === LESSON_AIM) return 'Now aim yourself: turn the camera towards a target, then press E.'
      if (last) return 'Last shot! Press E to take it.'
      return 'Nice! Press E to take your next shot.'
    case 'Swing_Height':
      if (n === LESSON_POWER) return 'This is your POWER. Press E when the bar reaches the line.'
      if (n === LESSON_CURVE) return 'Press E at the line to lock your power.'
      if (n === LESSON_AIM) return 'The arrow shows your aim. Turn the camera to adjust, then press E for power.'
      return ''
    case 'Swing_Turn':
      if (n === LESSON_CURVE) return 'New: CURVE. The middle hits straight, either side bends the ball. Press E in the middle.'
      return ''
    default:
      return ''
  }
}

// True from the first E press until the ball has come to rest and reset, for any ball in the
// player's own bay. The club rack and the Tee Off screens use it to stay shut mid-shot.
export function isShotInProgress(): boolean {
  let a1 = activeGame == null
  let a2 = allGames.some((g) => g.isMine() && g.state.phase !== 'walking')
  let a3 = allGames.some((g) => g.isMine() && g.state.phase !== 'Swing_Height')
  return a1 && a2 && a3
}

// Whether a menu or card is open (set by index.ts). No shot can start while one is, so the
// bay menu can't be left open over a swing.
let menuOpenCheck: () => boolean = () => false
export function setMenuOpenCheck(fn: () => boolean): void {
  menuOpenCheck = fn
}

// Every ball's game, for the Tee Off screens' auto-join on phones
export function getAllGames(): Game[] {
  return allGames
}

// The instruction to show the player right now, or '' for none
export function getPrompt(): string {
  // A shot of yours is in the air or rolling: E skips to where it stops
  if (activeGame && activeGame.canSkip()) {
    return camMode === 'ball' && orbitCamEnabled
      ? 'Press E to skip    Drag or A / D to orbit    W / S to zoom'
      : 'Press E to skip'
  }
  if (tutorial.active) {
    const g = activeGame ?? allGames.find((x) => x.bay === TUTORIAL_BAY)
    const line = g && g.bay === TUTORIAL_BAY ? tutorialPrompt(g) : ''
    if (line) return line
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
        if (locked) return g.bay === TUTORIAL_BAY && tutorialBayNoticeHeld() ? '' : locked
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
            ? `Click the Solo Bay's Tee Off screen to play here`
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

  // --- the shot's path -----------------------------------------------------
  // The shot is worked out when the curve is locked, so it's (nearly always) ready by
  // the time the club meets the ball. Waiting: from then until it starts playing.
  private shotWaiting = false
  // The simulated shot, once it's here and until it starts playing
  private pendingPath: ShotPath | null = null
  // The server request this ball is waiting on (0: none), and how long it has waited
  private askedId = 0
  private askedClock = 0
  // The launch, kept in case the server doesn't answer and this screen has to simulate it
  private launch: Vec3 = { x: 0, y: 0, z: 0 }
  // How long the shot has been playing, and whether the player skipped it
  private playClock = 0
  private skipped = false

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

  private OneSTest = 1

  // -------------------------------------------------------------------------
  update(dt: number): void {

    //  this.OneSTest -= dt
    //  if(this.OneSTest < 0)
    //  {
    //    this.OneSTest = 1
    //  }

    // The tutorial keeps the player at the tee: they aim by turning the camera, not by walking
    if (tutorial.active !== tutorialFrozen && this.bay === TUTORIAL_BAY) {
      tutorialFrozen = tutorial.active
      this.freezePlayer(tutorialFrozen)
      selectClub('iron')
    }

    if (this.inputLock > 0) this.inputLock -= dt

    // The locked meters stay on screen a moment after the curve is locked, then go
    if (activeGame === this && meters.hold > 0) {
      meters.hold -= dt
      if (meters.hold <= 0) showMeters(false, false)
    }

    // Waiting on the server for a shared shot: past SERVER_WAIT_SECONDS, play it here only
    if (this.askedId !== 0) {
      this.askedClock += dt
      if (this.askedClock > SERVER_WAIT_SECONDS) {
        console.log(`[golf] no shot from the server for bay ${this.bay} after ${SERVER_WAIT_SECONDS}s, simulating it here`)
        this.simulateHere()
      }
    }

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
        if (activeGame === null && !menuOpenCheck() && this.isMine() && this.state.distanceToBall <= HIT_RANGE && this.clicked()) {
          // No movement lock while addressing: it stops the swing animations playing.
          // Walking away cancels the shot instead (see below).
          this.beginSwing()
        }
        break

      case 'Swing_Height':
        if (tutorial.active) TUTORIAL_RETRY = false
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
        meters.curve = curveFromTurn(this.turnMeter())

        // When Turn / Bend Meter Is selected
        if (this.clicked()) this.lockTurnAndSwing()
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
        // ...and not until the ball has actually left: while its shot is still on the way from
        // the server it sits on the tee, and the ball cam would just hover over it
        const useBallCam = ballCamEnabled && swingSeen && !this.shotWaiting
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

  // The player skipped the tutorial: stop whatever this ball was doing, put it back on its tee,
  // and give the player back their movement and camera
  cancelForTutorialSkip(): void {
    if (club) cancelBackswing(club)
    this.physics.freeze()
    this.dropShot()
    this.physics.place(this.startPos.x, this.startPos.y, this.startPos.z)
    showMeters(false, false)
    releaseTutorialCam()
    if (camMode === 'ball') this.UpdateCamera(false)
    this.addressClock = -1
    this.swingClock = -1
    this.charge = 0
    this.settleTimer = 0
    this.rollLock = false
    this.state.phase = 'walking'
    if (activeGame === this) activeGame = null
    TUTORIAL_RETRY = false
    if (tutorialFrozen) {
      tutorialFrozen = false
      this.freezePlayer(false)
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

    // The tutorial's first shots: point the camera at the orange target, which also sets the aim
    if (tutorialAutoAim(this) && ScoreZones.Orange) {
      if (!tutorialCam) {
        tutorialCam = engine.addEntity()
        Transform.create(tutorialCam, {
          position: Vector3.create(97.27, 35.55, 334.03) // Where the camera itself is placed in the scene
        })
        VirtualCamera.create(tutorialCam, { lookAtEntity: ScoreZones.Orange })
      }
      MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: tutorialCam })
    }

    activeGame = this
    shownGame = this

    // Move the shared follow camera onto this ball
    if (cameraEntity) Transform.getMutable(cameraEntity).parent = this.ballEntity

    // The power meter, live
    showMeters(true, false)
    meters.powerLocked = false
    meters.curveLocked = false
    meters.hold = 0
    // The tutorial's target line on the power bar, while power is being taught
    meters.powerTarget = tutorialAutoAim(this) ? TUTORIAL_POWER_TARGET : -1

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
    showMeters(false, false)
    releaseTutorialCam()

    if (club) cancelBackswing(club)
    this.dropShot()
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

    // The power bar stays up, marked LOCKED at what was chosen, and the curve meter starts
    meters.power = this.storedPower * 100
    meters.powerLocked = true
    showMeters(true, true)

    // The tutorial's first shot is about power alone: no curve step, it goes straight
    if (tutorialPowerOnly(this)) {
      showMeters(true, false)
      this.lockTurnAndSwing(true)
    }
  }

  // Stage 2: E pressed. Read the bend and swing.
  private lockTurnAndSwing(straight = false): void {
    const turn = straight ? 0 : this.turnMeter()
    this.storedBend = turn * MAX_BEND_DEG
    if (!straight) playUi('meter_lock', 1, 1.3)

    // The bars stay up, marked LOCKED, through the swing and a moment after, then go
    meters.curve = curveFromTurn(turn)
    meters.curveLocked = true
    meters.hold = METERS_HOLD_SECONDS

    // Lift the movement lock before the emote fires, so nothing can block it.
    // It goes back on when the camera moves to the ball.
    //this.freezePlayer(false)
    this.addressClock = -1
    this.swingClock = 0
    this.emoteFired = false
    this.state.phase = 'Swinging'
    this.inputLock = 0.2

    // Power, curve and aim are all fixed now, so the shot can be worked out while the swing plays
    this.prepareShot()
  }

  // Whether everyone sees this bay's shots, so the server simulates them once for all.
  // The tutorial and solo bays are private to each player's screen and simulate here.
  private sharedBay(): boolean {
    return this.bay > 0 && this.bay !== TUTORIAL_BAY && this.bay !== SOLO_BAY && !tutorial.active
  }

  // The launch velocity from the stored power and curve: the aim turned by the bend
  private launchFromSwing(): Vec3 {
    const aim = this.aimVector()
    const bend = (this.storedBend * Math.PI) / 180
    const cos = Math.cos(bend)
    const sin = Math.sin(bend)
    const dirX = aim.x * cos + aim.z * sin
    const dirZ = -aim.x * sin + aim.z * cos
    return launchVelocity(dirX, dirZ, 0.5 + this.storedPower * 0.5, getLaunchPower())
  }

  private prepareShot(): void {
    this.launch = this.launchFromSwing()
    this.pendingPath = null
    this.shotWaiting = true
    if (this.sharedBay()) {
      // Simulated once on the server and sent to everyone, this player included
      this.askedId = askShot(this.bay, this.startPos, this.launch)
      this.askedClock = 0
    } else {
      this.simulateHere()
    }
  }

  // Simulate the shot on this screen (private bays, or the server didn't answer)
  private simulateHere(): void {
    this.askedId = 0
    this.physics.simulate(this.launch, (path) => {
      if (this.shotWaiting) this.pendingPath = path
    })
  }

  // A shot the server simulated for this bay: mine if I asked for it, otherwise someone else's to watch
  receiveShot(s: ServerShot): void {
    if (s.mine) {
      if (this.askedId !== 0 && s.id === this.askedId && this.shotWaiting) {
        this.askedId = 0
        this.pendingPath = s.path
      }
      return
    }
    this.watchShot(s.path)
  }

  // The server won't simulate this shot (e.g. it doesn't have me in this bay yet): play it here only
  shotRefused(id: number): void {
    if (this.askedId !== 0 && id === this.askedId) this.simulateHere()
  }

  // Stage 3: the ball leaves.
  private strikeBall(): void {
    // Driver lowest, wedge highest; harder swings are louder
    const clubPitch = { driver: 0.92, iron: 1.04, wedge: 1.16 }[getSelectedClubType()]
    playAt('club_hit', this.physics.position(), 0.55 + this.storedPower * 0.45, clubPitch)
    // The ball leaves as soon as its path is here (normally already, see prepareShot)
    this.startPendingShot()
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

    // Everyone else sees this club in your hand (clubSync.ts). Sent only when it changes.
    reportMyClub(club.type, club.visible, isSwingGrip(club))
  }

  // Power 0..1: 0% at start, 100% at 50% through the animation, 0% at the end
  private heightMeter(): number {
    const f = (this.swingTime * PowerTimeMulti / HEIGHT_ANIM_SECONDS) % 1
    const p = 1 - Math.abs(2 * f - 1)
    meters.power = p * 100
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
    //const s = getClubScale() * (0.5 + 0.5 * this.heightMeter())
    const s = lerp(getClubScale(false), getClubScale(true), this.heightMeter())
    t.scale = Vector3.create(s, s, s)
    console.log(s)
    t.rotation = Quaternion.fromEulerDegrees(0, ((this.lockedYaw * 180)) / Math.PI, 0)
  }

  // --- input / hit ---------------------------------------------------------

  // The action button
  private clicked(): boolean {
    if (this.inputLock > 0) return false
    return inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)
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
  // Plays the shot's path if it has arrived. True once it's playing.
  private startPendingShot(): boolean {
    if (!this.shotWaiting) return true
    if (!this.pendingPath) return false
    this.physics.play(this.pendingPath)
    // Your own shots play at the speed you left it on (watched shots always play at 1x)
    this.physics.setSpeed(shotSpeed)
    // The ball's away: the locked meters make way for the speed buttons
    showMeters(false, false)
    this.pendingPath = null
    this.shotWaiting = false
    this.playClock = 0
    this.skipped = false
    return true
  }

  // Your shot is playing, so its speed can be changed
  shotPlaying(): boolean {
    return this.state.phase === 'rolling' && !this.shotWaiting && !this.physics.settled()
  }

  applySpeed(): void {
    if (this.shotPlaying()) this.physics.setSpeed(shotSpeed)
  }

  // Whether E would skip this shot right now: it's playing, and has been for a moment
  canSkip(): boolean {
    return (
      this.state.phase === 'rolling' &&
      !this.shotWaiting &&
      !this.skipped &&
      !this.physics.settled() &&
      this.playClock >= SKIP_AFTER_SECONDS &&
      // Times here are shot time; at 2x or 3x more of it goes by per second
      this.physics.remaining() > (SKIP_SHOW_LAST + SKIP_MIN_SAVING) * shotSpeed
    )
  }

  // Forget the shot being prepared (the ball is going back on its tee)
  private dropShot(): void {
    this.shotWaiting = false
    this.pendingPath = null
    this.askedId = 0
  }

  private updateRolling(dt: number): void {
    const ball = this.measure()

    // The club has hit but the shot's path isn't here yet: the ball waits on the tee
    if (!this.startPendingShot()) return
    this.playClock += dt

    // E skips ahead to the last moment or so of the shot. The path already holds where the ball
    // stops, so this is exact: it scores the same as watching it all, and anyone watching still
    // sees the whole shot.
    if (this.canSkip() && this.clicked()) {
      this.physics.skip(SKIP_SHOW_LAST * shotSpeed)
      this.skipped = true
      this.settleTimer = 0
      playUi('ui_click')
      return
    }

    // Check if Ball Is OOB
    if (ball.z > 400 || ball.z < 100 || ball.y < 0) {
      this.ResetBall()
      return
    }

    // The path ends with the ball at rest: hold it there a moment, then score it
    if (this.physics.settled()) {
      this.settleTimer += dt
      if (this.settleTimer >= SETTLE_HOLD) this.ResetBall()
    } else {
      this.settleTimer = 0
    }
  }

  private ResetBall() {
    // Freeze Physics
    this.physics.freeze()
    this.dropShot()
    showMeters(false, false)
    releaseTutorialCam()

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
    if (!tutorial.active && tutorialFrozen) {
      tutorialFrozen = false
      this.freezePlayer(false)
    }

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

  // Another player hit the ball in this bay: play the server's path for it here, the same
  // keyframes every screen gets, so everyone sees the ball land in the same place
  private watchShot(path: ShotPath): void {
    if (this.isMine() || activeGame === this) return
    this.physics.place(this.startPos.x, this.startPos.y, this.startPos.z)
    this.physics.play(path)
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
    // The path has finished playing: the ball is at rest where the server said
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

// How fast your own shots play back: 1x, 2x or 3x. Changed with the buttons that show while
// a shot is playing (ui/SpeedToggle.tsx) or key 2, and kept for every shot after. Saved on the
// ledger with the other settings (as speed2 / speed3), so it's the same next visit too.
export const SHOT_SPEEDS = [1, 2, 3]
export let shotSpeed = 1

export function setShotSpeed(speed: number): void {
  if (SHOT_SPEEDS.indexOf(speed) < 0 || speed === shotSpeed) return
  shotSpeed = speed
  if (activeGame) activeGame.applySpeed()
  for (const fn of settingFns) {
    fn('speed2', speed === 2)
    fn('speed3', speed === 3)
  }
}

// Whether the speed buttons should show: one of your shots is in the air or rolling
export function shotSpeedShown(): boolean {
  return activeGame !== null && activeGame.shotPlaying()
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
  if (saved.speed3 === true) shotSpeed = 3
  else if (saved.speed2 === true) shotSpeed = 2
  else if (typeof saved.speed2 === 'boolean' || typeof saved.speed3 === 'boolean') shotSpeed = 1
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
  // Key 2 steps the shot speed 1x, 2x, 3x, 1x... while one of your shots is playing
  if (shotSpeedShown() && inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) {
    setShotSpeed(shotSpeed >= 3 ? 1 : shotSpeed + 1)
  }
}

// ---------------------------------------------------------------------------
// The swing meters (ui/PowerBar.tsx and ui/RotateBar.tsx draw them)
// ---------------------------------------------------------------------------
// power: 0..100. curve: 0..100, 50 is straight. Each is marked LOCKED once its E press is in,
// and stays on screen showing the locked value until the shot is away.
export const meters = {
  showPower: false,
  showCurve: false,
  power: 0,
  curve: 50,
  powerLocked: false,
  curveLocked: false,
  // A target line on the power bar (0..100), or -1 for none. The tutorial uses it.
  powerTarget: -1,
  // Seconds the locked meters stay up after the curve is locked
  hold: 0
}
// How long both locked meters stay on screen after the curve is locked (the swing takes about 0.4 s)
const METERS_HOLD_SECONDS = 1.5

function showMeters(power: boolean, curve: boolean): void {
  meters.showPower = power
  meters.showCurve = curve
  if (!power && !curve) meters.hold = 0
}

// The curve meter's reading (-1 left .. +1 right) as a bar position, 0..100
function curveFromTurn(turn: number): number {
  return Math.min(100, Math.max(0, 50 - turn * 50))
}

// Hands the view back from the tutorial's guided camera, if it still has it (e.g. with the ball cam off)
function releaseTutorialCam(): void {
  if (!tutorialCam) return
  const main = MainCamera.getOrNull(engine.CameraEntity)
  if (main && main.virtualCameraEntity === tutorialCam) {
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
  }
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
