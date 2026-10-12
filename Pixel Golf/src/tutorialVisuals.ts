import {
  engine,
  Entity,
  Transform,
  TextShape,
  Billboard,
  BillboardMode,
  Font,
  TextAlignMode,
  AvatarModifierArea,
  AvatarModifierType
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'

import { Game } from './game'
import { tutorial } from './ledger/client'

/**
 * What the tutorial looks like, as opposed to how it runs (tutorial.ts).
 *
 * Players don't see each other while one of them is in the tutorial, both ways round:
 *   - a player in the tutorial has every other avatar in the scene hidden from them
 *   - everyone else has bay 19 hidden from them, so tutorial players are invisible to the range
 * Both are one AvatarModifierArea on this player's own screen, which always leaves this player
 * out (excludeIds), so you never vanish from your own view. It covers the whole scene while the
 * tutorial runs and just bay 19 the rest of the time.
 *
 * And a floating "SHOOT HERE" over the orange target, the first thing the tutorial asks for. The
 * hot target's 2X is hidden during the tutorial (hotTarget.ts), so this is the only marker.
 */

// The scene's parcels run -5..32 on both axes (scene.json), so -80..528 m in scene coordinates.
// The area is a little bigger than that, so nobody at the edge is missed.
const SCENE_CENTRE = Vector3.create(224, 60, 224)
const SCENE_SIZE = Vector3.create(640, 320, 640)

// Bay 19's private box: wide along the line of bays (they're about 9 m apart, so it stops short
// of bay 18), deep enough for the player standing behind the ball, and tall enough for a jump.
const BAY_WIDTH = 7
const BAY_DEPTH = 10
const BAY_HEIGHT = 10
// How far the box sits behind the ball (the range faces +X), since the player stands back from it
const BAY_BACK = 2

// The target the tutorial aims at, and its marker
const TARGET_ZONE = 'Orange'
const MARKER_TEXT = 'SHOOT HERE'
// Letter height as a share of the target's width, and its limits in metres (the 2X uses the same idea)
const MARKER_SIZE = 0.12
const MARKER_MIN = 2
const MARKER_MAX = 5
// It floats above the target's flag: the flag (assets/Course/Flag.glb) stands 13.3 m tall from
// the ground, and the bottom of the letters sits this far above its top, plus a gentle bob
const FLAG_TOP = 13.3
const MARKER_CLEARANCE = 1.5
const BOB_HEIGHT = 0.5
const BOB_SECONDS = 2

// Pixel Golf blue with a white outline, like the menus' header tabs
const MARKER_COLOUR = Color4.create(1, 1, 1, 1)
const MARKER_OUTLINE = Color4.create(0.075, 0.533, 0.722, 1)

const HIDDEN = Vector3.create(0, -100, 0)

export function setupTutorialVisuals(
  bay19: Game | undefined,
  bay18: Game | undefined,
  zoneEntity: (zone: string) => Entity | undefined
): void {
  if (!bay19) return

  // --- Hiding players -------------------------------------------------------
  const tee = bay19.teePosition()
  // The line of bays bends, so line the box up with the way bay 18 -> 19 runs
  let yaw = 0
  if (bay18) {
    const prev = bay18.teePosition()
    yaw = (Math.atan2(tee.x - prev.x, tee.z - prev.z) * 180) / Math.PI
  }
  const bayRotation = Quaternion.fromEulerDegrees(0, yaw, 0)
  const bayCentre = Vector3.create(tee.x - BAY_BACK, tee.y + BAY_HEIGHT / 2 - 1, tee.z)
  const baySize = Vector3.create(BAY_DEPTH, BAY_HEIGHT, BAY_WIDTH)

  const privacy = engine.addEntity()
  Transform.create(privacy, { position: bayCentre, rotation: bayRotation })
  AvatarModifierArea.create(privacy, {
    area: baySize,
    excludeIds: [],
    modifiers: [
      AvatarModifierType.AMT_HIDE_AVATARS,
      AvatarModifierType.AMT_HIDE_NAMETAGS,
      AvatarModifierType.AMT_DISABLE_PASSPORTS
    ]
  })

  let shownWide: boolean | null = null
  let shownMe = ''

  // --- The marker -----------------------------------------------------------
  const marker = engine.addEntity()
  Transform.create(marker, { position: HIDDEN })
  Billboard.create(marker, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(marker, {
    text: '',
    fontSize: 30,
    font: Font.F_SANS_SERIF,
    textColor: MARKER_COLOUR,
    outlineColor: MARKER_OUTLINE,
    outlineWidth: 0.2,
    textAlign: TextAlignMode.TAM_BOTTOM_CENTER,
    textWrapping: false
  })
  let markerBase: Vector3 | null = null
  let markerShown = false
  let clock = 0

  engine.addSystem((dt) => {
    clock += dt
    const wide = tutorial.active

    // Never hide yourself. Your id may only be known a moment after the scene starts.
    const me = getPlayer()?.userId ?? ''
    if (me !== shownMe) {
      shownMe = me
      AvatarModifierArea.getMutable(privacy).excludeIds = me ? [me, me.toLowerCase()] : []
    }

    // The whole scene while you're in the tutorial, otherwise just bay 19
    if (wide !== shownWide) {
      shownWide = wide
      const t = Transform.getMutable(privacy)
      t.position = wide ? SCENE_CENTRE : bayCentre
      t.rotation = wide ? Quaternion.Identity() : bayRotation
      AvatarModifierArea.getMutable(privacy).area = wide ? SCENE_SIZE : baySize
    }

    // SHOOT HERE over the orange target, only during the tutorial
    if (wide && !markerBase) {
      const ent = zoneEntity(TARGET_ZONE)
      const t = ent ? Transform.getOrNull(ent) : null
      if (t) {
        const width = Math.max(Math.abs(t.scale.x), Math.abs(t.scale.z))
        const height = Math.min(MARKER_MAX, Math.max(MARKER_MIN, width * MARKER_SIZE))
        // Letters are about 0.072 m tall per font size unit
        TextShape.getMutable(marker).fontSize = height / 0.072
        markerBase = Vector3.create(t.position.x, FLAG_TOP + MARKER_CLEARANCE + BOB_HEIGHT, t.position.z)
      }
    }
    if (wide !== markerShown) {
      markerShown = wide
      TextShape.getMutable(marker).text = wide ? MARKER_TEXT : ''
    }
    if (wide && markerBase) {
      const bob = Math.sin((clock / BOB_SECONDS) * Math.PI * 2) * BOB_HEIGHT
      Transform.getMutable(marker).position = Vector3.create(markerBase.x, markerBase.y + bob, markerBase.z)
    } else if (Transform.get(marker).position.y !== HIDDEN.y) {
      Transform.getMutable(marker).position = HIDDEN
    }
  })
}
