import {
  ColliderLayer,
  engine,
  Entity,
  GltfContainer,
  InputAction,
  Material,
  MeshCollider,
  MeshRenderer,
  pointerEventsSystem,
  Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CLUB_TYPES, ClubType } from './club'
import { getSelectedClubType, onClubSelected, selectClub } from './clubSelect'
import { isShotInProgress } from './game'

/**
 * A rack of the three clubs beside each pad. Click (or tap) one to pick it: the club
 * in the player's hand changes and so does the launch power (see CLUB_TYPES in club.ts).
 */
const RACK = {
  /**
   * Where the rack sits relative to the ball's start position, in metres. The player
   * stands on the +Z side of the ball (CLUB.stance in club.ts), so +Z puts the rack
   * beside them. Raise or lower z if it crowds the next pad.
   */
  offset: { x: 0, z: 2.4 },
  /** Gap between the three clubs, along X. */
  slotSpacing: 0.55,
  /** Height of the model's origin (the grip end) above the ground. */
  clubHeight: 1.15,
  /** Rotation of the model on the rack. If a club shows upside down, try { x: 180, y: 0, z: 0 }. */
  clubRotation: { x: 0, y: 0, z: 0 },
  clubScale: 1,
  /** Size of the base plate under each club. It is also a click target. */
  plateSize: 0.45,
  clickDistance: 8
}

const ORDER: ClubType[] = ['wedge', 'iron', 'driver']

const PLATE_IDLE = { albedoColor: Color4.create(0.12, 0.12, 0.12, 1) }
const PLATE_SELECTED = {
  albedoColor: Color4.create(0.1, 0.8, 0.2, 1),
  emissiveColor: Color3.create(0.1, 0.8, 0.2),
  emissiveIntensity: 1.5
}

const plates: Array<{ type: ClubType; entity: Entity }> = []

// Lights the plate under the selected club on every rack
function paintPlates(): void {
  const selected = getSelectedClubType()
  for (const p of plates) Material.setPbrMaterial(p.entity, p.type === selected ? PLATE_SELECTED : PLATE_IDLE)
}

function spawnRack(spot: { x: number; y: number; z: number }): void {
  const rack = engine.addEntity()
  Transform.create(rack, {
    position: Vector3.create(spot.x + RACK.offset.x, spot.y, spot.z + RACK.offset.z)
  })

  ORDER.forEach((type, i) => {
    const def = CLUB_TYPES[type]
    const x = (i - (ORDER.length - 1) / 2) * RACK.slotSpacing

    // Base plate: shows which club is selected, and is a generous click target
    const plate = engine.addEntity()
    Transform.create(plate, {
      position: Vector3.create(x, 0.02, 0),
      scale: Vector3.create(RACK.plateSize, 0.04, RACK.plateSize),
      parent: rack
    })
    MeshRenderer.setBox(plate)
    MeshCollider.setBox(plate, ColliderLayer.CL_POINTER)
    plates.push({ type, entity: plate })

    // The club itself. Pointer layer only, so it never blocks the player or the ball.
    const model = engine.addEntity()
    Transform.create(model, {
      position: Vector3.create(x, RACK.clubHeight, 0),
      rotation: Quaternion.fromEulerDegrees(RACK.clubRotation.x, RACK.clubRotation.y, RACK.clubRotation.z),
      scale: Vector3.create(RACK.clubScale, RACK.clubScale, RACK.clubScale),
      parent: rack
    })
    GltfContainer.create(model, {
      src: def.model,
      visibleMeshesCollisionMask: ColliderLayer.CL_POINTER,
      invisibleMeshesCollisionMask: ColliderLayer.CL_POINTER
    })

    const opts = {
      button: InputAction.IA_POINTER,
      hoverText: `${def.label} (power ${def.launchPower})`,
      maxDistance: RACK.clickDistance
    }
    // Swapping mid-shot would change the power under a swing that is already under way
    const pick = () => {
      if (!isShotInProgress()) selectClub(type)
    }
    pointerEventsSystem.onPointerDown({ entity: plate, opts }, pick)
    pointerEventsSystem.onPointerDown({ entity: model, opts }, pick)
  })
}

/** Builds a rack at each spot. Spots are ground-level positions, one per ball. */
export function spawnClubRacks(spots: Array<{ x: number; y: number; z: number }>): void {
  for (const spot of spots) spawnRack(spot)
  paintPlates()
  onClubSelected(paintPlates)
}
