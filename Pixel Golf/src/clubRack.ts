import {
  ColliderLayer,
  engine,
  Entity,
  GltfContainer,
  InputAction,
  MeshCollider,
  pointerEventsSystem,
  Transform,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { CLUB_TYPES, ClubType } from './club'
import { getSelectedClubType, onClubSelected, selectClub } from './clubSelect'
import { playUi } from './sfx'
import { isShotInProgress } from './game'
import { tutorial } from './ledger/client'

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
  offset: { x: 0, y: -0.20, z: 2.6 },
  /** Gap between the three clubs, along X. */
  slotSpacing: 1.1,
  /** Height of the model's origin (the grip end) above the ground. */
  clubHeight: 1.15,
  /** Rotation of the model on the rack. If a club shows upside down, try { x: 180, y: 0, z: 0 }. */
  clubRotation: { x: 0, y: 0, z: 0 },
  clubScale: 1,
  /** Size of the invisible click box over each club's button. */
  plateSize: 0.8,
  clickDistance: 8
}

/**
 * The stand under the clubs (assets/Club Rack): a green base with a button under each club.
 * The selected club's button is the green Selected model, the others the blue Deselected one.
 *
 * The models are built small (buttons 0.2675 apart along the model's Z), so they're scaled up
 * to the rack's slotSpacing. Each button model has its spot on the base built into its node
 * (Selected in the middle, Deselected at +Z), so BUTTON_BAKED_Z is taken back off to put every
 * button under its own club.
 */
const STAND = {
  base: 'assets/Club Rack/Base.glb',
  selected: 'assets/Club Rack/Selected.glb',
  deselected: 'assets/Club Rack/Deselected.glb',
  modelSpacing: 0.2675,
  /** Lifts the base so its underside sits on the ground (its lowest point is 0.0075 below its origin). */
  baseLift: 0.0075
}
// Where each button model sits along Z in its own file, before scaling
const BUTTON_BAKED_Z = { selected: -0.00035, deselected: 0.26552 }

const ORDER: ClubType[] = ['wedge', 'iron', 'driver']

const buttons: Array<{ type: ClubType; on: Entity; off: Entity }> = []

// Shows the green button under the selected club on every rack, blue under the others
function paintPlates(): void {
  const selected = getSelectedClubType()
  for (const b of buttons) {
    VisibilityComponent.createOrReplace(b.on, { visible: b.type === selected })
    VisibilityComponent.createOrReplace(b.off, { visible: b.type !== selected })
  }
}

// A visual-only model on the rack (clicks go to the invisible boxes and the clubs)
function standModel(rack: Entity, src: string, position: Vector3, rotationY: number, scale: number): Entity {
  const e = engine.addEntity()
  Transform.create(e, {
    position,
    rotation: Quaternion.fromEulerDegrees(0, rotationY, 0),
    scale: Vector3.create(scale, scale, scale),
    parent: rack
  })
  GltfContainer.create(e, {
    src,
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  return e
}

function spawnRack(spot: { x: number; y: number; z: number }): void {
  const rack = engine.addEntity()
  Transform.create(rack, {
    position: Vector3.create(spot.x + RACK.offset.x, spot.y + RACK.offset.y, spot.z + RACK.offset.z)
  })

  // The base, turned so its long side runs along the row of clubs
  const scale = RACK.slotSpacing / STAND.modelSpacing
  const lift = STAND.baseLift * scale
  standModel(rack, STAND.base, Vector3.create(0, lift, 0), 90, scale)

  ORDER.forEach((type, i) => {
    const def = CLUB_TYPES[type]
    const x = (i - (ORDER.length - 1) / 2) * RACK.slotSpacing

    // This club's button, green when selected and blue when not. Round, so no turning needed:
    // just move each one back by the offset built into its model.
    const on = standModel(rack, STAND.selected, Vector3.create(x, lift, -BUTTON_BAKED_Z.selected * scale), 0, scale)
    const off = standModel(rack, STAND.deselected, Vector3.create(x, lift, -BUTTON_BAKED_Z.deselected * scale), 0, scale)
    buttons.push({ type, on, off })

    // An invisible box over the button: a generous click target
    const plate = engine.addEntity()
    Transform.create(plate, {
      position: Vector3.create(x, 0.05, 0),
      scale: Vector3.create(RACK.plateSize, 0.1, RACK.plateSize),
      parent: rack
    })
    MeshCollider.setBox(plate, ColliderLayer.CL_POINTER)

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
      if (isShotInProgress() || tutorial.active) return
      selectClub(type)
      playUi('ui_select')
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
