import { engine, Entity, Transform, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import { setBayBoxesVisible } from './rangePrivacy'

/**
 * Show barriers (Settings, Developer tab: developers and admins): draws every invisible wall so you can
 * check it's where it should be. Nothing about how anything collides changes.
 *
 *  - The scene's models: each model's invisible collider mesh (a mesh named *_collider inside the
 *    .glb) has a see-through copy in assets/Debug/Colliders/, made from the model. When on, a copy
 *    is put on each model in the scene (as its child, so it lines up exactly), coloured by kind:
 *      red     the Training Area barriers and frame
 *      blue    the building, stairs and steps
 *      orange  the Tee Off panels
 *      yellow  the shop and the Wall of Honor
 *      purple  everything else (podiums, chairs, planters, the golf cart...)
 *      green   the ground (grass and the target holes), faint
 *  - The bay boxes (rangePrivacy.ts), in red: anyone inside one goes invisible, except the player
 *    who holds that bay. They don't block anyone.
 *
 * The copies were made from the models as they were on 2026-11-03. If a model's collider is
 * changed in Blender, its copy needs making again (ask Claude), or it will show the old shape.
 */

const DIR = 'assets/Debug/Colliders/'
/** Each scene model with a collider, and its see-through copy */
const COPIES: Record<string, string> = {
  'assets/Building/Golf Bags.glb': 'Golf Bags.glb',
  'assets/Building/Main Building.glb': 'Main Building.glb',
  'assets/Building/Stairs.glb': 'Stairs.glb',
  'assets/Course/grass.glb': 'grass.glb',
  'assets/Course/holes.glb': 'holes.glb',
  'assets/Podium/Golf Cart Turnstile.glb': 'Golf Cart Turnstile.glb',
  'assets/Podium/Golf Cart.glb': 'Golf Cart.glb',
  'assets/Podium/Podium Frame.glb': 'Podium Frame.glb',
  'assets/Podium/Podiums.glb': 'Podiums.glb',
  'assets/Seating Area/Chairs.glb': 'Chairs.glb',
  'assets/Seating Area/Planters.glb': 'Planters.glb',
  'assets/Seating Area/Plants.glb': 'Plants.glb',
  'assets/Shop/Golf Club Podiums.glb': 'Golf Club Podiums.glb',
  'assets/Shop/Hook Railing.glb': 'Hook Railing.glb',
  'assets/Shop/Shelves.glb': 'Shelves.glb',
  'assets/Shop/Shop Counter.glb': 'Shop Counter.glb',
  'assets/Shop/Shop Light.glb': 'Shop Light.glb',
  'assets/Shop/Steps.glb': 'Steps.glb',
  'assets/Tee Off Panels/Tee Off Panels.glb': 'Tee Off Panels.glb',
  'assets/Training Area/Barriers.glb': 'Barriers.glb',
  'assets/Training Area/Training Area Frame.glb': 'Training Area Frame.glb',
  'assets/Wall of Honor/Wall of Honor.glb': 'Wall of Honor.glb'
}

export const barrierView = { on: false }
let copies: Entity[] = []

/** Turns the barrier view on or off */
export function setShowBarriers(on: boolean): void {
  if (on === barrierView.on) return
  barrierView.on = on
  setBayBoxesVisible(on)
  for (const e of copies) engine.removeEntity(e)
  copies = []
  if (!on) return
  for (const [entity, gltf] of engine.getEntitiesWith(GltfContainer)) {
    const copy = COPIES[gltf.src]
    if (!copy) continue
    const e = engine.addEntity()
    Transform.create(e, { parent: entity })
    GltfContainer.create(e, {
      src: DIR + copy,
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
    })
    copies.push(e)
  }
  console.log(`[barriers] showing ${copies.length} model colliders and the bay hiding boxes`)
}

export function toggleShowBarriers(): void {
  setShowBarriers(!barrierView.on)
}
