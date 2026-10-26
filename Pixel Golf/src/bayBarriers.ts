import { engine, Entity, Transform, MeshCollider, MeshRenderer, Material, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { getAllGames } from './game'
import { bayYaw, bayAnchor } from './teeOffPanels'
import { bays, TUTORIAL_BAY, SOLO_BAY } from './ledger/client'
import { BALL_RADIUS } from './ballSim'

/**
 * Bay barriers.
 *
 * Every real bay gets one anchor entity, spawned once, that carries the bay's status model:
 * Bay_Free while nobody holds the bay, Bay_Busy while someone does (including you). The model
 * sits in exactly the same place either way, because only its src changes.
 *
 * While ANOTHER player holds the bay, the same anchor also carries an invisible collider that
 * blocks everyone else from walking in. It's added and removed from the server's bay list
 * (bays.owners, ledger/client.ts), so one sync covers every case: the list arriving at the start
 * of the game, a bay being claimed, a bay being let go (walked away, left the scene, admin
 * reset), and your own claim.
 *
 *  - You never get a collider on the bay you hold, nor on one you've just clicked but the server
 *    hasn't confirmed yet (bays.pending), so walking into a free bay can't lock you out of it.
 *  - The tutorial bay (19) and the solo bay (20) get neither the model nor the collider.
 *  - Client only. The server run of the scene never calls this (index.ts returns early for it).
 *  - The collider only hits players (CL_PLAYER, see setupCollider). The ball, raycasts and
 *    pointer clicks pass through, so shots and the tee-off clicks are unaffected.
 */

// --- Tuning ----------------------------------------------------------------------------------
/** Set true to see the colliders (and to force them on for every bay), then set it back to false. */
const DEBUG_SHOW_BARRIERS = false

// GLTF Models
const Busy_MODEL = 'assets/Models/Bay_Busy/Bay_Busy.glb'
const Open_MODEL = 'assets/Models/Bay_Free/Bay_Free.glb'

/**
 * The collider in the bay's own space, in metres, centred on its tee. width is across the bay
 * (neighbouring bays are ~9 m apart), depth is along the range, height is how tall a wall.
 * At a bay yaw of 0 the range is assumed to run along local +z, and bayYaw() turns it from there.
 */
const BARRIER = { width: 10, depth: 10, height: 8 }
/**
 * Where the anchor (collider and model) sits from the tee, in the bay's own space (m). Tune this
 * on REFERENCE_BAY: every other bay copies that bay's spot relative to its Tee Off panel (see
 * barrierPlacement), the same way the club racks do (clubRack.ts).
 */
const BARRIER_OFFSET = { x: 2, z: 0 }
/** The bay the others copy. Tune BARRIER_OFFSET, BARRIER and the model's spot on this one. */
const REFERENCE_BAY = 12
/** A panel further than this from its own tee is a bad reading: that bay goes by its tee instead. */
const ANCHOR_SANITY = 15
/**
 * Lining a bay up with the reference bay only nudges it. If any bay would move further than this
 * (m), the panel readings can't be trusted and every bay goes by its tee, as before.
 */
const MAX_NUDGE = 1.5
/** How far the collider reaches below the floor, so there's no gap to squeeze under. */
const BARRIER_BELOW_FLOOR = 0.5
/** How often (s) the bay list is compared with the entities that exist. */
const SYNC_SECONDS = 0.2

const TopRadius = 0.5
const BotRadius = 0.5
// ---------------------------------------------------------------------------------------------

type BayMarker = { anchor: Entity; visual: Entity }
const markers = new Map<number, BayMarker>()

/** Bays that get a marker: every real bay, never the tutorial or solo bay. */
function isBarrierBay(bay: number): boolean {
  return bay > 0 && bay !== TUTORIAL_BAY && bay !== SOLO_BAY
}

type Flat = { x: number; z: number }

/** The bay's Tee Off panel position, or null if unknown or too far from its tee to be right. */
function panelOf(bay: number, tee: Flat): Flat | null {
  const a = bayAnchor(bay)
  if (!a || Math.hypot(a.x - tee.x, a.z - tee.z) > ANCHOR_SANITY) return null
  return a
}

/**
 * Where a bay's anchor sits (x, z). With fromPanel (the reference bay's spot relative to its
 * panel, in the bay's own frame) it's that distance from this bay's panel, turned to this bay's
 * angle, so the bend of the bays is followed. Otherwise it's BARRIER_OFFSET from the tee.
 */
function barrierPlacement(bay: number, tee: Flat, fromPanel: Flat | null): Flat {
  const turn = Quaternion.fromEulerDegrees(0, bayYaw(bay), 0)
  const panel = panelOf(bay, tee)
  if (fromPanel && panel) {
    const d = Vector3.rotate(Vector3.create(fromPanel.x, 0, fromPanel.z), turn)
    return { x: panel.x + d.x, z: panel.z + d.z }
  }
  const o = Vector3.rotate(Vector3.create(BARRIER_OFFSET.x, 0, BARRIER_OFFSET.z), turn)
  return { x: tee.x + o.x, z: tee.z + o.z }
}

// Worked out once, on the first spawn (undefined until then). null = go by each bay's tee.
let fromPanelCache: Flat | null | undefined

function referenceFromPanel(): Flat | null {
  if (fromPanelCache !== undefined) return fromPanelCache
  fromPanelCache = null
  const games = getAllGames().filter((g) => isBarrierBay(g.bay))
  const ref = games.find((g) => g.bay === REFERENCE_BAY)
  if (!ref) return null
  const refTee = ref.teePosition()
  const refPanel = panelOf(REFERENCE_BAY, refTee)
  if (!refPanel) return null
  // The reference bay's spot from its panel, in that bay's own frame
  const at = barrierPlacement(REFERENCE_BAY, refTee, null)
  const back = Quaternion.fromEulerDegrees(0, -bayYaw(REFERENCE_BAY), 0)
  const d = Vector3.rotate(Vector3.create(at.x - refPanel.x, 0, at.z - refPanel.z), back)
  const candidate = { x: d.x, z: d.z }
  // Lining up should only nudge each bay; a big move means the panel readings are off
  for (const g of games) {
    const t = g.teePosition()
    const a = barrierPlacement(g.bay, t, candidate)
    const b = barrierPlacement(g.bay, t, null)
    const moved = Math.hypot(a.x - b.x, a.z - b.z)
    if (moved > MAX_NUDGE) {
      console.log(`[barrier] bay ${g.bay} would move ${moved.toFixed(1)} m to line up with bay ${REFERENCE_BAY}; placing every barrier by its tee`)
      return null
    }
  }
  fromPanelCache = candidate
  return candidate
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

/** Creates the bay's anchor and its status model (starts as Free; sync sets the real state). */
function spawn(bay: number): BayMarker | undefined {
  const game = getAllGames().find((g) => g.bay === bay)
  if (!game) return undefined
  const tee = game.teePosition()
  const yaw = bayYaw(bay)
  const rotation = Quaternion.fromEulerDegrees(0, yaw, 0)

  // The tee's y is the ball's centre, so the floor is one radius below it
  const floorY = tee.y - BALL_RADIUS
  const centreY = floorY - BARRIER_BELOW_FLOOR + (BARRIER.height + BARRIER_BELOW_FLOOR) / 2
  const at = barrierPlacement(bay, tee, referenceFromPanel())

  const anchor = engine.addEntity()
  Transform.create(anchor, {
    position: Vector3.create(at.x, centreY, at.z),
    rotation,
    scale: Vector3.create(BARRIER.width, BARRIER.height + BARRIER_BELOW_FLOOR, BARRIER.depth)
  })

  // The status model: a child of the anchor, so it keeps the same place whether the collider is on or off
  const visual = engine.addEntity()
  Transform.create(visual, {
    parent: anchor,
    position: Vector3.create(-0.215, -0.445, 0.005),
    // No turn of its own: the anchor it's parented to already carries the bay's angle
    rotation: Quaternion.Identity(),
    scale: Vector3.create(0.091, 0.091, 0.091)
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

/** Adds or removes the player-blocking collider on the anchor. */
function setCollider(m: BayMarker, on: boolean): void {
  const has = MeshCollider.has(m.anchor)
  if (on && !has) {
    // Players only: the ball, raycasts and pointer clicks pass straight through
    MeshCollider.setCylinder(m.anchor, BotRadius, TopRadius, ColliderLayer.CL_PLAYER)
    if (DEBUG_SHOW_BARRIERS) {
      MeshRenderer.setCylinder(m.anchor, BotRadius, TopRadius)
      Material.setPbrMaterial(m.anchor, { albedoColor: Color4.create(1, 0.2, 0.2, 0.35) })
    }
  } else if (!on && has) {
    MeshCollider.deleteFrom(m.anchor)
    MeshRenderer.deleteFrom(m.anchor)
    Material.deleteFrom(m.anchor)
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
