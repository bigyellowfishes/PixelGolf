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
  AvatarModifierType,
  PlayerIdentityData
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'

import { Game } from './game'
import { tutorial, solo, leaveSoloBay } from './ledger/client'
import { SHOP_NPC_IDS } from './shop'

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

// Walking further than this from the solo bay's ball leaves the solo bay, so you're visible again
// and can see everyone again
const SOLO_LEAVE_DISTANCE = 12

// Pixel Golf blue with a white outline, like the menus' header tabs
const MARKER_COLOUR = Color4.create(1, 1, 1, 1)
const MARKER_OUTLINE = Color4.create(0.075, 0.533, 0.722, 1)

const HIDDEN = Vector3.create(0, -100, 0)

export function setupTutorialVisuals(
  bay19: Game | undefined,
  bay18: Game | undefined,
  zoneEntity: (zone: string) => Entity | undefined,
  bay20?: Game,
  bay1?: Game
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

  // Bay 20 (solo): a private box around the bay. It hides only the players who have joined the
  // solo bay (the server's list); everyone else in the scene is put in its excludeIds, so someone
  // just walking through stays visible.
  let soloPrivacy: Entity | undefined
  let soloTee: { x: number; y: number; z: number } | undefined
  let shownSoloKey = ''
  if (bay20) {
    const t20 = bay20.teePosition()
    soloTee = t20
    let yaw20 = 0
    if (bay1) {
      const next = bay1.teePosition()
      yaw20 = (Math.atan2(next.x - t20.x, next.z - t20.z) * 180) / Math.PI
    }
    soloPrivacy = engine.addEntity()
    Transform.create(soloPrivacy, {
      position: Vector3.create(t20.x - BAY_BACK, t20.y + BAY_HEIGHT / 2 - 1, t20.z),
      rotation: Quaternion.fromEulerDegrees(0, yaw20, 0)
    })
    AvatarModifierArea.create(soloPrivacy, {
      area: baySize,
      excludeIds: [],
      modifiers: [
        AvatarModifierType.AMT_HIDE_AVATARS,
        AvatarModifierType.AMT_HIDE_NAMETAGS,
        AvatarModifierType.AMT_DISABLE_PASSPORTS
      ]
    })
  }

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
    const inTutorial = tutorial.active

    // Walked away from the solo bay without picking another: you've left it
    if (solo.joined && soloTee) {
      const p = Transform.getOrNull(engine.PlayerEntity)?.position
      if (p) {
        const dx = p.x - soloTee.x
        const dz = p.z - soloTee.z
        if (dx * dx + dz * dz > SOLO_LEAVE_DISTANCE * SOLO_LEAVE_DISTANCE) leaveSoloBay()
      }
    }

    // Hide everyone else from you in the tutorial, and while you're playing in the solo bay
    const wide = inTutorial || solo.joined

    const me = getPlayer()?.userId ?? ''
    if (me !== shownMe) {
      shownMe = me
      // The shopkeepers are avatars too: never hide them
      AvatarModifierArea.getMutable(privacy).excludeIds = me ? [me, me.toLowerCase(), ...SHOP_NPC_IDS] : [...SHOP_NPC_IDS]
    }

    // The solo bay's box leaves out you and everyone who hasn't joined it
    if (soloPrivacy) {
      const inSolo = new Set(solo.players)
      const ids: string[] = []
      if (me) ids.push(me, me.toLowerCase())
      ids.push(...SHOP_NPC_IDS)
      for (const [, who] of engine.getEntitiesWith(PlayerIdentityData)) {
        const a = who.address
        if (a && !inSolo.has(a.toLowerCase())) ids.push(a, a.toLowerCase())
      }
      ids.sort()
      const key = ids.join(',')
      if (key !== shownSoloKey) {
        shownSoloKey = key
        AvatarModifierArea.getMutable(soloPrivacy).excludeIds = ids
      }
    }

    // The whole scene while you're in the tutorial, otherwise just bay 19
    if (wide !== shownWide) {
      shownWide = wide
      const t = Transform.getMutable(privacy)
      t.position = wide ? SCENE_CENTRE : bayCentre
      t.rotation = wide ? Quaternion.Identity() : bayRotation
      AvatarModifierArea.getMutable(privacy).area = wide ? SCENE_SIZE : baySize
    }

    // SHOOT HERE: tutorial only, not solo
    if (inTutorial && !markerBase) {
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
    if (inTutorial !== markerShown) {
      markerShown = inTutorial
      TextShape.getMutable(marker).text = inTutorial ? MARKER_TEXT : ''
    }
    if (inTutorial && markerBase) {
      const bob = Math.sin((clock / BOB_SECONDS) * Math.PI * 2) * BOB_HEIGHT
      Transform.getMutable(marker).position = Vector3.create(markerBase.x, markerBase.y + bob, markerBase.z)
    } else if (Transform.get(marker).position.y !== HIDDEN.y) {
      Transform.getMutable(marker).position = HIDDEN
    }
  })
}
