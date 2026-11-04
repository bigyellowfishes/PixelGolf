import {
  engine,
  Entity,
  Transform,
  Billboard,
  BillboardMode,
  MeshRenderer,
  Material,
  MaterialTransparencyMode,
  AvatarModifierArea,
  AvatarModifierType,
  PlayerIdentityData
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'

import { Game } from './game'
import { tutorial, solo, leaveSoloBay, tutorialLesson } from './ledger/client'
import { SHOP_NPC_IDS } from './shop'

/**
 * What the tutorial looks like, as opposed to how it runs (tutorial.ts).
 *
 * Players don't see each other while one of them is in the tutorial, both ways round:
 *   - a player in the tutorial has every other avatar in the scene hidden from them
 *   - everyone else has bay 19 hidden from them, so tutorial players are invisible to the range
 * Both are AvatarModifierAreas on this player's own screen, which always leave this player out
 * (excludeIds), so you never vanish from your own view: a fixed box round bay 19 all the time,
 * and a whole-scene area added while you're in the tutorial or the solo bay. Every couple of
 * seconds each area is nudged so the explorer re-checks who is inside (phones missed some).
 *
 * And a floating "SHOOT HERE" over the orange target, the first thing the tutorial asks for. The
 * hot target's 2X is hidden during the tutorial (hotTarget.ts), so this is the only marker.
 */

// The scene's parcels run -5..32 on both axes (scene.json), so -80..528 m in scene coordinates.
// The area is a little bigger than that, so nobody at the edge is missed.
const SCENE_CENTRE = Vector3.create(224, 60, 224)
const SCENE_SIZE = Vector3.create(640, 320, 640)

// Every this often each privacy area is nudged (its size changes by a hair and back), which makes
// the explorer check again who is inside it. Phones in particular didn't always hide avatars that
// were already standing inside an area when it appeared, moved or changed.
const REFRESH_SECONDS = 2
const NUDGE = 0.01

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

// The words are a picture (2026-11-03), so they can glow: white Lato Bold with a Pixel Golf blue
// outline and a soft halo, on a plane that turns to face you. 1024 x 256, the letters 44% of its
// height, their foot 28% up from its bottom.
const MARKER_IMAGE = 'assets/images/tutorial/shoot-here.png'
const MARKER_ASPECT = 4
const MARKER_LETTERS = 0.44
const MARKER_FOOT = 0.28
/** The glow pulses between these, once every MARKER_PULSE_SECONDS (like the hot target's ring) */
const MARKER_GLOW_MIN = 1.2
const MARKER_GLOW_MAX = 3
const MARKER_PULSE_SECONDS = 1.2

const HIDDEN = Vector3.create(0, -100, 0)

// Where the tutorial and solo bays' private boxes are, for rangePrivacy.ts. The range's own hiding
// area overlaps both bays, and it shows anyone at or behind the line of balls: where two areas
// overlapped, that let players in the tutorial bay be seen (2026-11-04). The range area now asks
// here first and keeps hidden anyone these boxes hide.
type Box = { centre: Vector3; rotation: Quaternion; size: Vector3 }
let tutorialBox: Box | null = null
let soloBox: Box | null = null

function inBox(b: Box, p: Vector3): boolean {
  const rel = Vector3.create(p.x - b.centre.x, p.y - b.centre.y, p.z - b.centre.z)
  const local = Vector3.rotate(rel, Quaternion.create(-b.rotation.x, -b.rotation.y, -b.rotation.z, b.rotation.w))
  return Math.abs(local.x) <= b.size.x / 2 && Math.abs(local.y) <= b.size.y / 2 && Math.abs(local.z) <= b.size.z / 2
}

/** Whether the tutorial or solo bay's box hides this player standing here (everyone in the tutorial bay; the solo bay's own players) */
export function hiddenInPrivateBay(address: string, p: Vector3): boolean {
  if (tutorialBox && inBox(tutorialBox, p)) return true
  if (soloBox && inBox(soloBox, p) && solo.players.indexOf(address.toLowerCase()) >= 0) return true
  return false
}

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
  tutorialBox = { centre: bayCentre, rotation: bayRotation, size: baySize }

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
    soloBox = { centre: Vector3.create(t20.x - BAY_BACK, t20.y + BAY_HEIGHT / 2 - 1, t20.z), rotation: Quaternion.fromEulerDegrees(0, yaw20, 0), size: baySize }
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

  // While you're in the tutorial or the solo bay: everyone else in the whole scene is hidden from
  // you. Its own fixed entity, added and removed whole, rather than the bay 19 box being moved and
  // resized (phones didn't always pick that up).
  const widePrivacy = engine.addEntity()
  Transform.create(widePrivacy, { position: SCENE_CENTRE })
  const wideModifiers = [
    AvatarModifierType.AMT_HIDE_AVATARS,
    AvatarModifierType.AMT_HIDE_NAMETAGS,
    AvatarModifierType.AMT_DISABLE_PASSPORTS
  ]
  let myIds: string[] = [...SHOP_NPC_IDS]

  let shownWide: boolean | null = null
  let shownMe = ''
  let refreshClock = 0
  let nudged = false

  // --- The marker -----------------------------------------------------------
  const marker = engine.addEntity()
  Transform.create(marker, { position: HIDDEN })
  Billboard.create(marker, { billboardMode: BillboardMode.BM_Y })
  // The glowing words, sized once the target is known (below)
  const words = engine.addEntity()
  Transform.create(words, { parent: marker, scale: Vector3.Zero() })
  MeshRenderer.setPlane(words)
  const wordsTex = Material.Texture.Common({ src: MARKER_IMAGE })
  const wordsGlow = (glow: number) =>
    Material.setPbrMaterial(words, {
      texture: wordsTex,
      alphaTexture: wordsTex,
      emissiveTexture: wordsTex,
      emissiveColor: Color4.White(),
      emissiveIntensity: glow,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      castShadows: false,
      metallic: 0,
      roughness: 1,
      specularIntensity: 0
    })
  wordsGlow(MARKER_GLOW_MIN)
  let wordsScale = Vector3.Zero()
  let wordsLift = 0
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
      myIds = me ? [me, me.toLowerCase(), ...SHOP_NPC_IDS] : [...SHOP_NPC_IDS]
      AvatarModifierArea.getMutable(privacy).excludeIds = myIds
      if (AvatarModifierArea.has(widePrivacy)) AvatarModifierArea.getMutable(widePrivacy).excludeIds = myIds
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

    // The whole scene while you're in the tutorial or the solo bay; bay 19's box is always there
    if (wide !== shownWide) {
      shownWide = wide
      if (wide) AvatarModifierArea.createOrReplace(widePrivacy, { area: SCENE_SIZE, excludeIds: myIds, modifiers: wideModifiers })
      else AvatarModifierArea.deleteFrom(widePrivacy)
    }

    // Every couple of seconds, nudge each area so the explorer checks again who's inside
    refreshClock += dt
    if (refreshClock >= REFRESH_SECONDS) {
      refreshClock = 0
      nudged = !nudged
      const d = nudged ? NUDGE : 0
      AvatarModifierArea.getMutable(privacy).area = Vector3.create(baySize.x + d, baySize.y, baySize.z)
      if (soloPrivacy) AvatarModifierArea.getMutable(soloPrivacy).area = Vector3.create(baySize.x + d, baySize.y, baySize.z)
      if (AvatarModifierArea.has(widePrivacy)) AvatarModifierArea.getMutable(widePrivacy).area = Vector3.create(SCENE_SIZE.x + d, SCENE_SIZE.y, SCENE_SIZE.z)
    }

    // SHOOT HERE: tutorial only, not solo
    if (inTutorial && !markerBase) {
      const ent = zoneEntity(TARGET_ZONE)
      const t = ent ? Transform.getOrNull(ent) : null
      if (t) {
        const width = Math.max(Math.abs(t.scale.x), Math.abs(t.scale.z))
        const height = Math.min(MARKER_MAX, Math.max(MARKER_MIN, width * MARKER_SIZE))
        // The picture's size for letters this tall, its letters' foot at the marker
        const planeH = height / MARKER_LETTERS
        wordsScale = Vector3.create(planeH * MARKER_ASPECT, planeH, 1)
        wordsLift = planeH / 2 - planeH * MARKER_FOOT
        markerBase = Vector3.create(t.position.x, FLAG_TOP + MARKER_CLEARANCE + BOB_HEIGHT, t.position.z)
      }
    }
    // On the hot target lesson the 2X marker floats over the orange target instead
    const showMarker = inTutorial && !tutorialLesson.hot
    if (showMarker !== markerShown) {
      markerShown = showMarker
      const wt = Transform.getMutable(words)
      wt.scale = showMarker ? wordsScale : Vector3.Zero()
      wt.position = Vector3.create(0, wordsLift, 0)
    }
    if (showMarker && markerBase) {
      const bob = Math.sin((clock / BOB_SECONDS) * Math.PI * 2) * BOB_HEIGHT
      Transform.getMutable(marker).position = Vector3.create(markerBase.x, markerBase.y + bob, markerBase.z)
      const wt = Transform.getMutable(words)
      wt.scale = wordsScale
      wt.position = Vector3.create(0, wordsLift, 0)
      const wave = 0.5 + 0.5 * Math.sin((clock / MARKER_PULSE_SECONDS) * Math.PI * 2)
      wordsGlow(MARKER_GLOW_MIN + (MARKER_GLOW_MAX - MARKER_GLOW_MIN) * wave)
    } else if (Transform.get(marker).position.y !== HIDDEN.y) {
      Transform.getMutable(marker).position = HIDDEN
    }
  })
}
