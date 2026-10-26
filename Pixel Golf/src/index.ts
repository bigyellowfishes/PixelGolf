import { setupUi } from './ui'
import {
  engine,
  InputAction,
  Transform,
  Name,
  Entity,
  MeshRenderer,
  TouchScreenControls,
  VisibilityComponent,
  GltfContainer,
  ColliderLayer
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

import { BALL_RADIUS, ShotPath, ShotSim, PathPlayer, probeSurface, warmUpBallSim, Vec3, Quat } from './ballSim'

import { Game, Physics, forgetCarriedRound, updateSettingsInput, applySavedSettings, onSettingChanged, onRoundFinished, setMenuOpenCheck } from './game'
import { getLaunchPower } from './clubSelect'
import { spawnClubRacks } from './clubRack'
import { setupTeeOffPanels, setupTeeOffScreens, setupAutoTeeOff, bayYaw, bayAnchor } from './teeOffPanels'
import { setupTutorial } from './tutorial'
import { setupShop, shop, closeShop } from './shop'
import { setupMenuGuard } from './menuGuard'
import { setupWindFlags } from './wind'
import { setupTutorialVisuals } from './tutorialVisuals'
import { playAt, playUi } from './sfx'
import { setupMusic, applySavedAudio, onAudioSettingChanged } from './audio'
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
  onLedgerReset,
  onTutorialReward,
  saveSetting,
  onServerShot,
  onShotRefused,
  onBayScore,
  tutorial,
  TUTORIAL_BAY,
  profile,
  myBay,
  shotWind,
  bayBallLook,
  SOLO_BAY
} from './ledger/client'
import { itemById } from './ledger/rules'
import { setupHotTargetMarker } from './hotTarget'
import { setPlayerProgress } from './ui/GameModeMenu'
import { showRoundFinished, showRoundCounted, showTutorialReward, state as roundCard } from './ui/RoundResult'
import { state as gameModeMenu } from './ui/GameModeMenu'
import { state as clubMenu } from './ui/ClubSelectMenu'
import { state as boardsMenu } from './ui/LeaderboardMenu'
import { state as settingsMenu } from './ui/SettingsMenu'
import { setupMobileControls } from './mobile'
import { setupClubSync } from './clubSync'
import { showToast } from './ui/RangeHud'

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
// The ball's physics no longer runs here frame by frame. Every shot is simulated ahead
// of time on a fixed clock and then played back from its keyframes (src/ballSim.ts).
const REST_SPEED = 0.1 // speed at which the ball counts as stopped (for predictRoll)
// A local shot (tutorial and solo bay) is simulated a slice at a time, so a phone doesn't
// stall on one long frame. It's started when the curve is locked, so it is finished long
// before the club meets the ball. Milliseconds of simulation allowed per frame:
const SIM_BUDGET_MS_DESKTOP = 8
const SIM_BUDGET_MS_PHONE = 6
// Outer steps between clock checks while simulating (each is 5 cannon-es steps)
const SIM_CHUNK = 6

// ---------------------------------------------------------------------------
// State, resolved from the authored scene at startup
// ---------------------------------------------------------------------------
// Every playable ball in the scene, matched by entity name
const BALL_NAMES = ['Ball_1', 'Ball_2', 'Ball_3', 'Ball_4', 'Ball_5', 'Ball_6',
                    'Ball_7', 'Ball_8','Ball_9', 'Ball_10', 'Ball_11', 'Ball_12',
                    'Ball_13', 'Ball_14', 'Ball_15', 'Ball_16', 'Ball_17', 'Ball_18',
                    'Ball_19', 'Ball_20']

type BallRig = {
  name: string
  entity: Entity
  // Where the ball is drawn, and its roll (the model's rotation)
  pos: Vec3
  rot: Quat
  // The shot being played back, how far into it we are, and how fast it plays (1, 2 or 3)
  player: PathPlayer | null
  clock: number
  speed: number
  // A local shot being simulated, and who to tell when it's ready
  sim: ShotSim | null
  onSimmed: ((path: ShotPath) => void) | null
  // The ball model drawn in place of the editor's sphere
  model: Entity | undefined
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

// Find the balls, arrows and score zones in the authored scene, and build the physics world
function buildWorldFromScene() {
  const foundBalls: { name: string; entity: Entity; start: Vec3 }[] = []

  for (const [entity, name, transform] of engine.getEntitiesWith(Name, Transform)) {
    const n = name.value

    // Find Ball Entities (Ball_1 to Ball_20)
    if (BALL_NAMES.includes(n)) {
      const p = transform.position
      foundBalls.push({ name: n, entity, start: { x: p.x, y: p.y, z: p.z } })
      continue
    }

    // Find Arrow Entities
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

  // The course collision and the ball body live in ballSim.ts. Build them now rather
  // than on the first shot or the first aiming ray.
  warmUpBallSim()

  // Keep them in Ball_1 .. Ball_20 order
  foundBalls.sort((a, b) => BALL_NAMES.indexOf(a.name) - BALL_NAMES.indexOf(b.name))

  for (const found of foundBalls) {
    balls.push({
      name: found.name,
      entity: found.entity,
      pos: { ...found.start },
      rot: { x: 0, y: 0, z: 0, w: 1 },
      player: null,
      clock: 0,
      speed: 1,
      sim: null,
      onSimmed: null,
      model: undefined
    })
  }
}

// ---------------------------------------------------------------------------
// The ledger, from the player's side: what the server sends goes to the UI, and
// finished rounds and settings go to the server (src/ledger/client.ts)
// ---------------------------------------------------------------------------
function setupLedger(): void {
  setupLedgerClient()
  // Other players' clubs in their hands, and yours in theirs
  setupClubSync()

  // The level card on the Pixel Golf menu
  onProfile((p) => setPlayerProgress(p.level, p.levelXp, p.levelNeed))

  // Camera settings follow the player between visits and devices
  onSavedSettings(applySavedSettings)
  onSettingChanged(saveSetting)
  // Music and commentary volume (audio.ts), saved the same way
  onSavedSettings(applySavedAudio)
  onAudioSettingChanged(saveSetting)

  // The round card: the score straight away, the multiplier and rewards when the server answers
  // Not for the tutorial's practice round, which isn't sent to the ledger (tutorial.ts says well done instead)
  onRoundFinished((r) => {
    if (!tutorial.active) showRoundFinished(r.score, r.hotHits)
  })
  onRoundResult(showRoundCounted)
  // The tutorial's card shows the level it took the player to
  onTutorialReward(showTutorialReward)

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
  onLedgerReset((by) => showToast(`The ledger has been reset by ${by}. Everyone starts again from the tutorial.`, 8))

  // The floating 2X over whichever target is hot
  setupHotTargetMarker((zone) => (ScoreZones as Record<string, Entity | undefined>)[zone])
}

// ---------------------------------------------------------------------------
// The on-screen buttons a phone gets
// ---------------------------------------------------------------------------

// The phone's on-screen buttons are set in mobile.ts (setupMobileControls). They used to be
// written here as well, every frame, which overrode mobile.ts (the buttons never hid behind
// menus). The old version is in index.ts.bak.

// ---------------------------------------------------------------------------
// Each frame: finish any local simulation, then play shots back by time
// ---------------------------------------------------------------------------

let phone: boolean | undefined
function onPhone(): boolean {
  if (phone === undefined) phone = isMobile()
  return phone
}

// Frame rate and physics time, for the readout on the range card (PERF_READOUT in ui/RangeHud.tsx)
export const perfStats = { fps: 0, physicsMs: 0 }
let perfClock = 0, perfFrames = 0, perfPhysics = 0

function physicsSystem(dt: number) {
  const started = Date.now()
  runLocalSims(started)
  playShots(dt)
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

// Local shots (tutorial, solo bay, or a server that didn't answer): a few steps a frame
function runLocalSims(started: number): void {
  const budget = onPhone() ? SIM_BUDGET_MS_PHONE : SIM_BUDGET_MS_DESKTOP
  for (const b of balls) {
    const sim = b.sim
    if (!sim) continue
    // Always some progress, even on a slow frame
    let done = sim.run(SIM_CHUNK)
    while (!done && Date.now() - started < budget) done = sim.run(SIM_CHUNK)
    if (!done) return // out of time this frame
    b.sim = null
    const fn = b.onSimmed
    b.onSimmed = null
    if (fn) fn(sim.result())
  }
}

// Shots play back by time from their keyframes, so the ball covers the same ground in the
// same time at any frame rate, and finishes exactly where the simulation said it would.
function playShots(dt: number): void {
  for (const b of balls) {
    const p = b.player
    if (!p) continue
    b.clock += dt * b.speed
    p.sample(b.clock)
    b.pos.x = p.position.x
    b.pos.y = p.position.y
    b.pos.z = p.position.z
    b.rot.x = p.rotation.x
    b.rot.y = p.rotation.y
    b.rot.z = p.rotation.z
    b.rot.w = p.rotation.w
    for (const impact of p.hitsUntil(b.clock)) {
      playAt('ball_land', { x: b.pos.x, y: b.pos.y, z: b.pos.z }, Math.min(1, impact / 12))
    }
    drawBall(b)
    // At the end the ball stays put on its last keyframe until the game moves it
    if (b.clock >= p.duration) b.player = null
  }
}

// The ball entity follows the shot (the ball cam is parented to it, and the orbit cam steers
// its rotation, so that is left alone). The model carries the roll.
function drawBall(b: BallRig): void {
  const t = Transform.getMutable(b.entity)
  t.position = Vector3.create(b.pos.x, b.pos.y, b.pos.z)
  if (b.model) {
    const m = Transform.getMutable(b.model)
    m.position = Vector3.create(b.pos.x, b.pos.y, b.pos.z)
    m.rotation = Quaternion.create(b.rot.x, b.rot.y, b.rot.z, b.rot.w)
  }
}

// ---------------------------------------------------------------------------
// Bridge to the game layer (game.ts)
// ---------------------------------------------------------------------------

// Launch power comes from the selected club (wedge 80 / iron 130 / driver 170),
// see CLUB_TYPES in club.ts and getLaunchPower() in clubSelect.ts

// How far the ball will roll for a given charge, on the flat
function predictRoll(power: number): number {
  const launch = Math.max(0, Math.min(1, power)) * getLaunchPower()
  const decay = -Math.log(1 - 0.5) // linearDamping 0.5 -> ln 2 per second
  return Math.max(0, (launch - REST_SPEED) / decay)
}

function makePhysicsBridge(b: BallRig): Physics {
  const stop = () => {
    b.player = null
    b.sim = null
    b.onSimmed = null
  }
  return {
    ballRadius: BALL_RADIUS,
    position: () => ({ x: b.pos.x, y: b.pos.y, z: b.pos.z }),
    settled: () => b.player === null,
    place(x, y, z) {
      stop()
      b.pos.x = x
      b.pos.y = y
      b.pos.z = z
      drawBall(b)
    },
    freeze() {
      b.player = null
    },
    simulate(launch, done) {
      // Start the roll from where the model is now, so the ball doesn't snap round
      // In the range's wind (calm in the tutorial), the same one the server uses for shared shots
      b.sim = new ShotSim(b.pos, launch, b.rot, shotWind())
      b.onSimmed = done
    },
    play(path) {
      b.sim = null
      b.onSimmed = null
      b.player = new PathPlayer(path)
      b.clock = 0
      b.speed = 1
      b.player.sample(0)
      b.pos.x = b.player.position.x
      b.pos.y = b.player.position.y
      b.pos.z = b.player.position.z
      drawBall(b)
    },
    setSpeed(speed) {
      b.speed = Math.max(1, Math.min(3, speed))
    },
    remaining: () => (b.player ? Math.max(0, b.player.duration - b.clock) : 0),
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

// The ball cam steers the ball entity's rotation, so the model is a separate entity that
// follows the ball and takes its roll from the shot's keyframes.
/**
 * Each bay's ball shows the ball its player has equipped in the shop (ledger/rules.ts CATALOGUE):
 * yours from your own profile (straight away when you equip), everyone else's from the server's
 * list (ballLooks). The tutorial and solo bays are private, so only yours shows there.
 */
function ballModel(id: string): string {
  const item = itemById(id)
  return item && item.model ? item.model : BALL_MODEL
}

function myBallModel(): string {
  return ballModel(profile.equipped.ball ?? '')
}

function showEquippedBall() {
  const mine = myBay()
  const want = myBallModel()
  for (const b of balls) {
    if (!b.model) continue
    const bay = Number((/^Ball_(\d+)$/.exec(b.name) ?? [])[1] ?? 0)
    const src =
      bay !== 0 && bay === mine
        ? want
        : bay !== 0 && bay !== TUTORIAL_BAY && bay !== SOLO_BAY
          ? ballModel(bayBallLook(bay))
          : BALL_MODEL
    const g = GltfContainer.getOrNull(b.model)
    if (g && g.src !== src) GltfContainer.getMutable(b.model).src = src
  }
}

function swapBallModels() {
  for (const b of balls) {
    // Hide the placeholder sphere
    MeshRenderer.deleteFrom(b.entity)
    const model = engine.addEntity()
    Transform.create(model, {
      position: Vector3.create(b.pos.x, b.pos.y, b.pos.z),
      scale: Vector3.create(BALL_MODEL_SCALE, BALL_MODEL_SCALE, BALL_MODEL_SCALE)
    })
    // Visual only: the shot's path decides where the ball goes
    GltfContainer.create(model, {
      src: BALL_MODEL,
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
    })
    b.model = model
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
  // player. There it keeps the ledger (XP, Pixel Points, cosmetics, settings, the
  // leaderboards, the hot target and the multiplier rolls) and simulates every shared
  // shot once for everyone (src/ledger/server.ts).
  if (isServer()) {
    runLedger()
    return
  }

  buildWorldFromScene()
  swapBallModels()
  // Your bay's ball wears the ball you've equipped in the shop
  engine.addSystem(showEquippedBall, undefined, 'equipped-ball')

  // The bunker zones are only used for scoring: keep them in the scene, but don't draw them
  for (const zone of [ScoreZones.Bunker1, ScoreZones.Bunker2, ScoreZones.Bunker3, ScoreZones.Bunker4]) {
    if (zone) VisibilityComponent.createOrReplace(zone, { visible: false })
  }

  // A rack of the three clubs beside every ball's pad, turned to the pad's angle (the bays sit on
  // a curve). The ground sits one radius below each ball.
  spawnClubRacks(
    balls.map((b) => {
      const bay = Number(b.name.replace('Ball_', '')) || 0
      return { bay, x: b.pos.x, y: b.pos.y - BALL_RADIUS, z: b.pos.z, yaw: bayYaw(bay), anchor: bayAnchor(bay) }
    })
  )

  // Clicking a Tee Off panel opens the Pixel Golf menu
  setupTeeOffPanels()
  // The two shopkeepers, behind the shop counter (spots in SHOP_NPCS, shop.ts)
  setupShop()
  // The target flags turn to show the wind
  setupWindFlags()

  SpawnCamera()
  setupUi()
  setupLedger()
  // Background music, at the player's saved volume once the ledger sends it
  setupMusic()

  engine.addSystem(physicsSystem)

  if (balls.length === 0) {
    console.log('[golf] no entity named "Ball" in the scene, the game cannot start')
    return
  }

  // One game per ball. They share the arrows and camera. Ball_N sits in bay N
  const games = balls.map((b) => new Game(makePhysicsBridge(b), b.entity, Number(b.name.replace('Ball_', '')) || 0))
  // Each bay's score on its Tee Off panel screen
  setupTeeOffScreens(balls.map((b, i) => ({ name: b.name, state: games[i].state })))
  Game.InitCamera()
  Game.InitClub()

  // Shots the server simulated: mine play in my bay, everyone else's on their bay's ball
  onServerShot((s) => games.find((g) => g.bay === s.bay)?.receiveShot(s))
  onShotRefused((r) => games.find((g) => g.bay === r.bay)?.shotRefused(r.id))
  onBayScore((d) => games.find((g) => g.bay === d.bay)?.showBayScore(d))

  // Phones: E is the big button while playing; all the phone's buttons hide while a menu is open
  const anyMenuOpen = () =>
    gameModeMenu.display === 'flex' ||
    clubMenu.display === 'flex' ||
    boardsMenu.display === 'flex' ||
    settingsMenu.display === 'flex' ||
    roundCard.display === 'flex' ||
    shop.open
  setupMobileControls(anyMenuOpen)
  // No shot starts while a menu is open (so the bay menu can't sit over a swing)
  setMenuOpenCheck(anyMenuOpen)
  // Phones: walking up to a free bay's ball joins it and opens the Pixel Golf menu
  setupAutoTeeOff(anyMenuOpen)
  // F closes any menu (scenes can't use Escape), and a closed menu can't reopen for a second
  setupMenuGuard(anyMenuOpen, () => {
    if (anyMenuOpen()) playUi('ui_close')
    gameModeMenu.display = 'none'
    clubMenu.display = 'none'
    boardsMenu.display = 'none'
    settingsMenu.display = 'none'
    roundCard.display = 'none'
    if (shop.open) closeShop()
  })

  // An admin reset the ledger: every bay starts a fresh round (the tutorial follows when the new ledger arrives)
  onLedgerReset(() => {
    for (const game of games) game.newRound()
    forgetCarriedRound()
  })

  // New players start in the tutorial bay (Ball_19) with a first round of ten
  setupTutorial(games.find((g) => g.bay === TUTORIAL_BAY))
  // Players hidden from each other during it, and SHOOT HERE over the orange target
  setupTutorialVisuals(
  games.find((g) => g.bay === TUTORIAL_BAY),
  games.find((g) => g.bay === TUTORIAL_BAY - 1),
  (zone) => (ScoreZones as Record<string, Entity | undefined>)[zone],
  games.find((g) => g.bay === 20), // solo bay
  games.find((g) => g.bay === 1)   // its neighbour, used to line the box up
)

  // Run the Update for the Main Game Loop In Game.ts
  engine.addSystem((dt: number) => {
    for (const game of games) game.update(dt)
    Game.UpdateClubFrame(dt)
    Game.UpdateCameraFrame(dt)
    updateSettingsInput()
  })
}
