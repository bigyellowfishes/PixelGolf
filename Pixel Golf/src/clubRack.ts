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
  /**
   * Where each club's head hangs relative to its grip (the model's origin), in metres on the rack:
   * x along the row (raise it to move that club's head left as you face the pad), z towards the player (+) or the pad (-). The
   * club is moved back by this so its head sits over the middle of its button. Measured by eye
   * from a screenshot, so nudge these if a head still sits off its button.
   */
  headOffset: {
    wedge: { x: 0.2, z: 0.03 },
    iron: { x: 0.21, z: 0.03 },
    driver: { x: 0.18, z: 0.03 }
  } as Record<string, { x: number; z: number }>,
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

type RackSpot = {
  bay: number
  x: number
  y: number
  z: number
  yaw: number
  anchor: { x: number; z: number } | null
}

/**
 * The bay whose rack placement the others copy. Its rack sits RACK.offset from its ball; every
 * other rack sits the same distance from its own bay's Tee Off panel (a fixed point on the pad;
 * the balls aren't all in quite the same spot on their pads), turned to its bay's angle, so they
 * all line up front to back the same way.
 */
const REFERENCE_BAY = 12
/** A panel further than this from its own ball is a bad reading: that rack goes by its ball instead. */
const ANCHOR_SANITY = 15
/**
 * Lining a rack up with the reference bay only nudges it (the balls sit within a metre or so of
 * the same spot on their pads). If any rack would move further than this, the panel readings
 * aren't to be trusted, and every rack goes by its ball as before.
 */
const MAX_NUDGE = 1.5

function rackPlacement(spot: RackSpot, fromAnchor: { x: number; z: number } | null): { x: number; z: number } {
  const turn = Quaternion.fromEulerDegrees(0, spot.yaw, 0)
  if (fromAnchor && spot.anchor) {
    const d = Vector3.rotate(Vector3.create(fromAnchor.x, 0, fromAnchor.z), turn)
    return { x: spot.anchor.x + d.x, z: spot.anchor.z + d.z }
  }
  // No panel for this bay: from the ball, as before
  const o = Vector3.rotate(Vector3.create(RACK.offset.x, 0, RACK.offset.z), turn)
  return { x: spot.x + o.x, z: spot.z + o.z }
}

function spawnRack(spot: RackSpot, fromAnchor: { x: number; z: number } | null): void {
  // Turned to the bay's angle, so every rack sits the same way relative to its own pad
  const turn = Quaternion.fromEulerDegrees(0, spot.yaw, 0)
  const at = rackPlacement(spot, fromAnchor)
  const rack = engine.addEntity()
  Transform.create(rack, {
    position: Vector3.create(at.x, spot.y + RACK.offset.y, at.z),
    rotation: turn
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
    const head = RACK.headOffset[type] ?? { x: 0, z: 0 }
    Transform.create(model, {
      position: Vector3.create(x + head.x, RACK.clubHeight, -head.z),
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

/** Builds a rack at each spot. Spots are ground-level ball positions with the bay's angle and panel. */
export function spawnClubRacks(spots: RackSpot[]): void {
  for (const s of spots) {
    if (s.anchor && Math.hypot(s.anchor.x - s.x, s.anchor.z - s.z) > ANCHOR_SANITY) {
      console.log(`[rack] bay ${s.bay}: panel reads ${Math.round(Math.hypot(s.anchor.x - s.x, s.anchor.z - s.z))} m from its ball, placing that rack by its ball`)
      s.anchor = null
    }
  }
  // Where the reference bay's rack sits from its panel, in that bay's own frame
  let fromAnchor: { x: number; z: number } | null = null
  const ref = spots.find((s) => s.bay === REFERENCE_BAY)
  if (ref && ref.anchor) {
    const at = rackPlacement(ref, null)
    const back = Quaternion.fromEulerDegrees(0, -ref.yaw, 0)
    const d = Vector3.rotate(Vector3.create(at.x - ref.anchor.x, 0, at.z - ref.anchor.z), back)
    fromAnchor = { x: d.x, z: d.z }
  }
  if (fromAnchor) {
    for (const s of spots) {
      const a = rackPlacement(s, fromAnchor)
      const b = rackPlacement(s, null)
      const moved = Math.hypot(a.x - b.x, a.z - b.z)
      if (moved > MAX_NUDGE) {
        console.log(`[rack] bay ${s.bay} would move ${moved.toFixed(1)} m to line up with bay ${REFERENCE_BAY}; not lining up any racks`)
        fromAnchor = null
        break
      }
    }
  }
  for (const spot of spots) spawnRack(spot, fromAnchor)
  paintPlates()
  onClubSelected(paintPlates)
}
