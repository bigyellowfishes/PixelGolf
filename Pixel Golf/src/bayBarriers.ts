import { engine, Entity, Transform, MeshCollider, MeshRenderer, Material, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { getAllGames } from './game'
import { bays, TUTORIAL_BAY, SOLO_BAY } from './ledger/client'

/**
 * Bay barriers.
 *
 * Every real bay (1 to 18) gets a status model on its pad: Bay_Free while nobody holds the bay,
 * Bay_Busy while someone does (including you).
 *
 * While ANOTHER player holds a bay, an invisible wall-less box also covers that bay's whole lane,
 * so nobody else can walk into the bay or out in front of it while its player is taking shots:
 * as wide as the lane (just short of the next bay, so it never reaches into a neighbour's bay),
 * from just behind the pad to LANE.ahead metres down the range. It's added and removed from the
 * server's bay list (bays.owners, ledger/client.ts), so one sync covers every case: the list
 * arriving at the start of the game, a bay being claimed, a bay being let go (walked away, left
 * the scene, admin reset), and your own claim.
 *
 *  - You never get a box on the bay you hold, nor on one you've just walked into but the server
 *    hasn't confirmed yet (bays.pending), so walking into a free bay can't lock you out of it.
 *  - The tutorial bay (19) and the solo bay (20) get neither the model nor the box.
 *  - Client only. The server run of the scene never calls this (index.ts returns early for it).
 *  - The box only hits players (CL_PLAYER). The ball, raycasts and pointer clicks pass through,
 *    so shots and the Tee Off clicks are unaffected. Nobody is hidden: other players stay visible.
 */

// --- Tuning ----------------------------------------------------------------------------------
/** Set true to see the boxes (and to force them on for every bay), then set it back to false. */
const DEBUG_SHOW_BARRIERS = false

// GLTF Models
const Busy_MODEL = 'assets/Models/Bay_Busy/Bay_Busy.glb'
const Open_MODEL = 'assets/Models/Bay_Free/Bay_Free.glb'

/**
 * The box over a held bay's lane, in metres, measured from the middle of the bay's pad (FRAMES).
 *   margin  taken off the gap to the nearest bay for the box's width (the bays are ~9 m apart,
 *           so the box is ~8.5 m wide, and two held bays side by side leave a narrow gap)
 *   behind  how far it reaches back from the pad's middle, towards the building (the pad is 3 m
 *           deep, so this covers the pad and a little of the walkway behind it)
 *   ahead   how far it reaches down the range, in front of the player
 *   below / above  how far under and over the pad top it reaches, so there's no way under or over
 */
const LANE = { margin: 0.5, behind: 2.5, ahead: 40, below: 6, above: 8 }
/** How often (s) the bay list is compared with the entities that exist. */
const SYNC_SECONDS = 0.2
// ---------------------------------------------------------------------------------------------

/**
 * Where each bay's Free/Busy frame goes (scene coordinates) and its turn (degrees, as
 * Quaternion.fromEulerDegrees about Y). Measured from the models: every putting pad is 3.75 m by
 * 3 m (Tee Off Panels.glb), and the frame model is drawn round a pad that size at full size, so it
 * sits on the pad's middle at scale 1. The turn is the bay's angle (bayYaw) plus the frame model's
 * own built-in tilt taken back out (about 3.7 degrees), which squares it to the pad. The "BAY FREE" /
 * "BAY BUSY" sign stays at the back of the pad, reading towards the building, as before.
 * Bays 19 and 20 never get a frame. If a bay is moved in the scene, its line here needs updating.
 */
const FRAMES: Record<number, { x: number; z: number; yaw: number }> = {
  1: { x: 95.42, z: 175.924, yaw: -15.23 },
  2: { x: 91.932, z: 184.2, yaw: -13.88 },
  3: { x: 88.924, z: 192.641, yaw: -12.54 },
  4: { x: 86.373, z: 201.231, yaw: -11.2 },
  5: { x: 84.266, z: 209.94, yaw: -9.85 },
  6: { x: 82.596, z: 218.744, yaw: -8.5 },
  7: { x: 81.348, z: 227.612, yaw: -7.16 },
  8: { x: 80.522, z: 236.541, yaw: -5.81 },
  9: { x: 80.108, z: 245.492, yaw: -4.47 },
  10: { x: 80.107, z: 254.456, yaw: -3.12 },
  11: { x: 80.519, z: 263.41, yaw: -1.7 },
  12: { x: 81.342, z: 272.33, yaw: -0.43 },
  13: { x: 82.588, z: 281.204, yaw: 0.92 },
  14: { x: 84.254, z: 290.02, yaw: 2.26 },
  15: { x: 86.359, z: 298.733, yaw: 3.6 },
  16: { x: 88.907, z: 307.326, yaw: 4.95 },
  17: { x: 91.913, z: 315.75, yaw: 6.29 },
  18: { x: 95.398, z: 324.005, yaw: 7.63 }
}
/** The top of the putting pads (scene height): the frame sits on it */
const PAD_TOP = 33.146
/** An extra turn on every frame, in degrees: + is clockwise seen from above */
const FRAME_EXTRA_TURN = 4
/** The frames' size (1 = the model's full size) */
const FRAME_SCALE = 0.95
/** How far the frames sit below the pad top (metres): 5% of the model's 0.5 m height */
const FRAME_DROP = 0.025

type BayMarker = { anchor: Entity | null; visual: Entity }
const markers = new Map<number, BayMarker>()

/** Bays that get a marker: every real bay, never the tutorial or solo bay. */
function isBarrierBay(bay: number): boolean {
  return bay > 0 && bay !== TUTORIAL_BAY && bay !== SOLO_BAY
}

/**
 * The lane of a bay, from the pads either side of it: where its box goes, which way it faces
 * (down the range, at right angles to the line of bays, towards +x), and how wide it can be.
 */
function laneOf(bay: number): { x: number; z: number; yaw: number; width: number; down: { x: number; z: number } } | null {
  const here = FRAMES[bay]
  if (!here) return null
  const before = FRAMES[bay - 1] ?? here
  const after = FRAMES[bay + 1] ?? here
  // Along the line of bays, then turned a quarter: the range is on the +x side of every bay
  const ax = after.x - before.x
  const az = after.z - before.z
  const len = Math.hypot(ax, az)
  if (len < 0.01) return null
  let dx = az / len
  let dz = -ax / len
  if (dx < 0) {
    dx = -dx
    dz = -dz
  }
  let gap = Infinity
  for (const n of [bay - 1, bay + 1]) {
    const f = FRAMES[n]
    if (f) gap = Math.min(gap, Math.hypot(f.x - here.x, f.z - here.z))
  }
  if (!isFinite(gap)) return null
  const mid = (LANE.ahead - LANE.behind) / 2
  return {
    x: here.x + dx * mid,
    z: here.z + dz * mid,
    yaw: (Math.atan2(dx, dz) * 180) / Math.PI,
    width: gap - LANE.margin,
    down: { x: dx, z: dz }
  }
}

/** True when someone, anyone, holds the bay (or I've just asked for it). */
function isOccupied(bay: number): boolean {
  const owner = bays.owners[String(bay)]
  return (!!owner && !!owner.u) || bays.pending === bay
}

/** True when the server says someone other than this player holds the bay. */
function heldByAnother(bay: number, me: string): boolean {
  const owner = bays.owners[String(bay)]
  if (!owner || !owner.u) return false
  if (owner.u.toLowerCase() === me) return false
  // A bay I've just asked for is mine, whatever the list says until the server answers
  if (bays.pending === bay) return false
  return true
}

/** Creates the bay's lane box (off until needed) and its status model (starts as Free; sync sets the real state). */
function spawn(bay: number): BayMarker | undefined {
  const frame = FRAMES[bay]
  if (!frame) return undefined

  // The box over the lane, stretched to size: a unit box collider on it is the whole lane
  const lane = laneOf(bay)
  let anchor: Entity | null = null
  if (lane) {
    anchor = engine.addEntity()
    Transform.create(anchor, {
      position: Vector3.create(lane.x, PAD_TOP - LANE.below + (LANE.below + LANE.above) / 2, lane.z),
      rotation: Quaternion.fromEulerDegrees(0, lane.yaw, 0),
      scale: Vector3.create(lane.width, LANE.below + LANE.above, LANE.behind + LANE.ahead)
    })
  } else {
    console.log(`[barrier] bay ${bay} has no neighbouring pad to line its lane up with, so it has no barrier`)
  }

  // The status model: its own entity on the bay's pad, at full size. It keeps the same place
  // whether the box is on or off.
  const visual = engine.addEntity()
  Transform.create(visual, {
    position: Vector3.create(frame.x, PAD_TOP - FRAME_DROP, frame.z),
    rotation: Quaternion.fromEulerDegrees(0, frame.yaw + FRAME_EXTRA_TURN, 0),
    scale: Vector3.create(FRAME_SCALE, FRAME_SCALE, FRAME_SCALE)
  })
  GltfContainer.create(visual, {
    src: Open_MODEL,
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })

  const m = { anchor, visual }
  markers.set(bay, m)
  return m
}

/** Swaps the model between Free and Busy. Only touches the component when it changes. */
function setModel(m: BayMarker, occupied: boolean): void {
  const src = occupied ? Busy_MODEL : Open_MODEL
  const g = GltfContainer.getOrNull(m.visual)
  if (g && g.src !== src) GltfContainer.getMutable(m.visual).src = src
}

/** Puts the player-blocking box over the lane, or takes it away. */
function setCollider(m: BayMarker, on: boolean): void {
  const box = m.anchor
  if (!box) return
  const has = MeshCollider.has(box)
  if (on && !has) {
    // Players only: the ball, raycasts and pointer clicks pass straight through
    MeshCollider.setBox(box, ColliderLayer.CL_PLAYER)
    if (DEBUG_SHOW_BARRIERS) {
      MeshRenderer.setBox(box)
      Material.setPbrMaterial(box, { albedoColor: Color4.create(1, 0.2, 0.2, 0.35) })
    }
  } else if (!on && has) {
    MeshCollider.deleteFrom(box)
    MeshRenderer.deleteFrom(box)
    Material.deleteFrom(box)
  }
}

/** Makes the models and colliders match the bay list. Cheap, and safe to run as often as you like. */
function sync(): void {
  // Without our own id we can't tell which bay is ours, so we could box ourselves in. The models
  // don't need it, but the colliders wait for it.
  const me = (getPlayer()?.userId ?? '').toLowerCase()

  for (const g of getAllGames()) {
    if (!isBarrierBay(g.bay)) continue
    const m = markers.get(g.bay) ?? spawn(g.bay)
    if (!m) continue
    setModel(m, isOccupied(g.bay))
    setCollider(m, DEBUG_SHOW_BARRIERS || (me !== '' && heldByAnother(g.bay, me)))
  }
}

/**
 * Call once from main() after the games exist (index.ts). Checks straight away, so every bay shows
 * its Free model from the start and one already taken when the player arrives is blocked as soon
 * as the server's list is in, then keeps everything in step with it.
 */
export function setupBayBarriers(): void {
  sync()
  let clock = 0
  engine.addSystem((dt: number) => {
    clock += dt
    if (clock < SYNC_SECONDS) return
    clock = 0
    sync()
  }, undefined, 'bay-barriers')
}
