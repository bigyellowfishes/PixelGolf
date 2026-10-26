import { engine, Entity, Transform, MeshCollider, MeshRenderer, Material, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { getAllGames } from './game'
import { bayYaw } from './teeOffPanels'
import { bays, TUTORIAL_BAY, SOLO_BAY } from './ledger/client'
import { BALL_RADIUS } from './ballSim'

/**
 * Bay barriers.
 *
 * While another player holds a bay, an invisible box blocks everyone else from walking into it.
 * It is spawned and removed purely from the server's bay list (bays.owners, ledger/client.ts), so
 * one sync covers every case: the list arriving at the start of the game, a bay being claimed,
 * a bay being let go (walked away, left the scene, admin reset), and your own claim.
 *
 *  - You never get a barrier on the bay you hold, nor on one you've just clicked but the server
 *    hasn't confirmed yet (bays.pending), so walking into a free bay can't lock you out of it.
 *  - The tutorial bay (19) and the solo bay (20) never get one. They're private to each player's
 *    screen and never owned on the server.
 *  - Client only. The server run of the scene never calls this (index.ts returns early for it).
 *  - The box only collides with players (CL_PLAYER). It doesn't touch the ball, raycasts or
 *    pointer clicks, so shots and the tee-off clicks are unaffected.
 */

// --- Tuning ----------------------------------------------------------------------------------
/** Set true to see the boxes while lining them up with the pads, then set it back to false. */
const DEBUG_SHOW_BARRIERS = false

const MODEL = 'assets/Models/BayRing/BayRing.glb'
/**
 * The box in the bay's own space, in metres, centred on its tee. width is across the bay
 * (neighbouring bays are ~9 m apart), depth is along the range, height is how tall a wall.
 * At a bay yaw of 0 the range is assumed to run along local +z, and bayYaw() turns it from there.
 * If the box comes out sideways in DEBUG mode, swap width and depth.
 */
const BARRIER = { width: 7.5, depth: 6, height: 4 }
/** Shifts the box along the range (m) from the tee: negative pulls it back towards the panel. */
const BARRIER_OFFSET = 0
/** How far the box reaches below the floor, so there's no gap to squeeze under. */
const BARRIER_BELOW_FLOOR = 0.5
/** How often (s) the bay list is compared with the boxes that exist. */
const SYNC_SECONDS = 0.2
// ---------------------------------------------------------------------------------------------

const barriers = new Map<number, Entity>()

/** Bays that can ever get a barrier: every real bay, never the tutorial or solo bay. */
function isBarrierBay(bay: number): boolean {
  return bay > 0 && bay !== TUTORIAL_BAY && bay !== SOLO_BAY
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

function spawn(bay: number): void {
  const game = getAllGames().find((g) => g.bay === bay)
  if (!game) return
  const tee = game.teePosition()
  const yaw = bayYaw(bay)
  const rotation = Quaternion.fromEulerDegrees(0, yaw, 0)

  // The tee's y is the ball's centre, so the floor is one radius below it
  const floorY = tee.y - BALL_RADIUS
  const centreY = floorY - BARRIER_BELOW_FLOOR + (BARRIER.height + BARRIER_BELOW_FLOOR) / 2
  const along = Vector3.rotate(Vector3.create(0, 0, BARRIER_OFFSET), rotation)

  const e = engine.addEntity()
  Transform.create(e, {
    position: Vector3.create(tee.x + along.x, centreY, tee.z + along.z),
    rotation,
    scale: Vector3.create(BARRIER.width, BARRIER.height + BARRIER_BELOW_FLOOR, BARRIER.depth)
  })
  const eVis = engine.addEntity()
  Transform.create(eVis, {
    parent: e,
    position: Vector3.create(0, 0, 0),
    rotation,
    scale: Vector3.create(0.1, 0.1, 0.1)
  })
  GltfContainer.create(eVis, {
      src: MODEL,
      // Looks only: the ball passes straight through it
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
    })
  // Players only: the ball, raycasts and pointer clicks pass straight through
  MeshCollider.setCylinder(e, ColliderLayer.CL_PLAYER)
  if (DEBUG_SHOW_BARRIERS) {
    MeshRenderer.setCylinder(e)
    Material.setPbrMaterial(e, { albedoColor: Color4.create(1, 0.2, 0.2, 0.35) })
  }
  barriers.set(bay, e)
}

function remove(bay: number): void {
  const e = barriers.get(bay)
  if (e === undefined) return
  engine.removeEntity(e)
  barriers.delete(bay)
}

/** Makes the boxes match the bay list. Cheap, and safe to run as often as you like. */
function sync(): void {
  // Without our own id we can't tell which bay is ours, so we could box ourselves in. Wait.
  const me = (getPlayer()?.userId ?? '').toLowerCase()
  if (me === '') return

  for (const g of getAllGames()) {
    if (!isBarrierBay(g.bay)) continue
    const want = heldByAnother(g.bay, me)
    const have = barriers.has(g.bay)
    if ((want || DEBUG_SHOW_BARRIERS) && !have) spawn(g.bay)
    else if (!want && have) remove(g.bay)
  }
}

/**
 * Call once from main() after the games exist (index.ts). Checks straight away, so a bay already
 * taken when the player arrives is blocked as soon as the server's list is in, then keeps the
 * boxes in step with it.
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
