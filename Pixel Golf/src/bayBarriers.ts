import { engine, Entity, Transform, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { getAllGames } from './game'
import { bays, TUTORIAL_BAY, SOLO_BAY } from './ledger/client'

/**
 * Bay status models.
 *
 * Every real bay (1 to 18) gets a status model on its pad: Bay_Free while nobody holds the bay,
 * Bay_Busy while someone does (including you). Bays 19 (tutorial) and 20 (solo) get none.
 *
 * There are no walls (since 2026-11-03): instead, anyone stepping into a bay that isn't theirs goes
 * invisible (rangePrivacy.ts). The lane boxes that used to block a held bay's lane were taken out.
 * Client only. The server run of the scene never calls this (index.ts returns early for it).
 */

// --- Tuning ----------------------------------------------------------------------------------
// GLTF Models
const Busy_MODEL = 'assets/Models/Bay_Busy/Bay_Busy.glb'
const Open_MODEL = 'assets/Models/Bay_Free/Bay_Free.glb'

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
export const FRAMES: Record<number, { x: number; z: number; yaw: number }> = {
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
export const PAD_TOP = 33.146
/** An extra turn on every frame, in degrees: + is clockwise seen from above */
const FRAME_EXTRA_TURN = 4
/** The frames' size (1 = the model's full size) */
const FRAME_SCALE = 0.95
/** How far the frames sit below the pad top (metres): 5% of the model's 0.5 m height */
const FRAME_DROP = 0.025

type BayMarker = { visual: Entity }
const markers = new Map<number, BayMarker>()

/** Bays that get a marker: every real bay, never the tutorial or solo bay. */
function isBarrierBay(bay: number): boolean {
  return bay > 0 && bay !== TUTORIAL_BAY && bay !== SOLO_BAY
}

/** True when someone, anyone, holds the bay (or I've just asked for it). */
function isOccupied(bay: number): boolean {
  const owner = bays.owners[String(bay)]
  return (!!owner && !!owner.u) || bays.pending === bay
}

/** Creates the bay's status model (starts as Free; sync sets the real state). */
function spawn(bay: number): BayMarker | undefined {
  const frame = FRAMES[bay]
  if (!frame) return undefined

  // The status model: its own entity on the bay's pad, at full size
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

  const m = { visual }
  markers.set(bay, m)
  return m
}

/** Swaps the model between Free and Busy. Only touches the component when it changes. */
function setModel(m: BayMarker, occupied: boolean): void {
  const src = occupied ? Busy_MODEL : Open_MODEL
  const g = GltfContainer.getOrNull(m.visual)
  if (g && g.src !== src) GltfContainer.getMutable(m.visual).src = src
}

/** Makes the models match the bay list. Cheap, and safe to run as often as you like. */
function sync(): void {
  for (const g of getAllGames()) {
    if (!isBarrierBay(g.bay)) continue
    const m = markers.get(g.bay) ?? spawn(g.bay)
    if (!m) continue
    setModel(m, isOccupied(g.bay))
  }
}

/**
 * Call once from main() after the games exist (index.ts). Checks straight away, so every bay shows
 * its Free model from the start, then keeps the models in step with the server's bay list.
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
