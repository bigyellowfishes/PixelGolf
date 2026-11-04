import { playAt } from './sfx'
import { engine, Entity, Transform, GltfContainer, ColliderLayer, Tween, TweenSequence, TweenLoop, EasingFunction, MeshRenderer, Material, MaterialTransparencyMode, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

// Spinning clubs on the shop's podiums (Shop/Golf Club Podiums.glb). There are six podiums, three
// on each side of the shop, and each side gets one of each club: the Skull Spirit, the Glass and
// the Ruby (assets/Shop/Display Clubs/). Each club stands upright, head down, floating just over
// its podium, turning slowly and bobbing gently. The motion is done by the explorer (Tween), so it
// costs the scene nothing per frame. Decoration only: nothing to click.
//
// Coming soon: walk up to a podium and a small "COMING SOON" sign pops up over its club (turned to
// face you), and shrinks away again when you walk off (SIGN_* below).
//
// The glow: each club's materials light themselves (emissive, set in the models: the Skull's
// spirit green, the Ruby's red, the Glass a pale blue), and a soft disc of the same colour glows
// on the podium under it (glow.png, a round fade).
//
// The podium tops were measured from the model (scene coordinates, the middle of each top).

const DIR = 'assets/Shop/Display Clubs/'
const CLUBS = ['Skull_Spirit_Club.glb', 'Glass_Club.glb', 'Ruby_Club.glb']
/** Each club's glow colour, in the same order */
const GLOWS = [Color4.create(0.1, 1, 0.45, 1), Color4.create(0.6, 0.85, 1, 1), Color4.create(1, 0.1, 0.12, 1)]
/** The disc on the podium: its width (m) and how bright it is */
const GLOW_SIZE = 1.4
const GLOW_STRENGTH = 2

/** The six podium tops: one side (z 223 to 235), then the other (z 265 to 277) */
const PODIUMS: { x: number; z: number }[] = [
  { x: 59.84, z: 223 },
  { x: 62.84, z: 227.5 },
  { x: 61.34, z: 235 },
  { x: 61.34, z: 265 },
  { x: 62.84, z: 272.5 },
  { x: 59.84, z: 277 }
]
const PODIUM_TOP = 35.51

/** The clubs' origin is the top of the grip and they're about 0.9 m long, so this floats the head just over the top */
const CLUB_LENGTH = 0.9
const FLOAT = 0.2
/** 1.5 = half as big again as the models */
const SCALE = 1.5
/** The Coming soon sign: its picture, width (m), how far above the top of the club it floats */
const SIGN_IMAGE = DIR + 'coming-soon.png'
const SIGN_WIDTH = 1.1
const SIGN_ABOVE = 0.45
/** It pops up within SIGN_SHOW of the podium (m, along the ground) and goes past SIGN_HIDE */
const SIGN_SHOW = 4
const SIGN_HIDE = 5
const SIGN_POP_MS = 260

/** Degrees a second it turns */
const SPIN_SPEED = 45
/** The bob: how far up and down (m) and how long one way takes (ms) */
const BOB = 0.08
const BOB_MS = 1600

type Sign = { entity: Entity; x: number; z: number; shown: boolean }
const signs: Sign[] = []

/** A sign growing in (or shrinking away), from where its size is now */
function popSign(sign: Sign, show: boolean): void {
  sign.shown = show
  const t = Transform.getMutable(sign.entity)
  // A soft pop from the sign as it appears
  if (show) playAt('ui_open', t.position, 0.6)
  const from = t.scale
  const to = show ? Vector3.create(SIGN_WIDTH, SIGN_WIDTH * (160 / 512), 1) : Vector3.create(0, 0, 0)
  Tween.createOrReplace(sign.entity, {
    mode: Tween.Mode.Scale({ start: from, end: to }),
    duration: show ? SIGN_POP_MS : SIGN_POP_MS * 0.7,
    easingFunction: show ? EasingFunction.EF_EASEOUTBACK : EasingFunction.EF_EASEINQUAD
  })
}

let signWait = 0
function comingSoonSystem(dt: number): void {
  signWait -= dt
  if (signWait > 0) return
  signWait = 0.2
  const me = Transform.getOrNull(engine.PlayerEntity)
  if (!me) return
  for (const sign of signs) {
    const d = Math.hypot(me.position.x - sign.x, me.position.z - sign.z)
    if (!sign.shown && d < SIGN_SHOW) popSign(sign, true)
    else if (sign.shown && d > SIGN_HIDE) popSign(sign, false)
  }
}

export function setupClubDisplays(): void {
  PODIUMS.forEach((p, i) => {
    const base = Vector3.create(p.x, PODIUM_TOP + FLOAT + CLUB_LENGTH * SCALE, p.z)
    // The bob moves this one up and down...
    const bob = engine.addEntity()
    Transform.create(bob, { position: base })
    Tween.create(bob, {
      mode: Tween.Mode.Move({ start: base, end: Vector3.add(base, Vector3.create(0, BOB, 0)) }),
      duration: BOB_MS,
      easingFunction: EasingFunction.EF_EASESINE
    })
    TweenSequence.create(bob, { sequence: [], loop: TweenLoop.TL_YOYO })

    // ...and the club inside it spins. Each side's three start at different angles so they don't turn in step.
    const club = engine.addEntity()
    Transform.create(club, {
      parent: bob,
      rotation: Quaternion.fromEulerDegrees(0, (i % 3) * 120, 0),
      scale: Vector3.create(SCALE, SCALE, SCALE)
    })
    GltfContainer.create(club, {
      src: DIR + CLUBS[i % 3],
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
    })
    Tween.setRotateContinuous(club, Quaternion.fromEulerDegrees(0, 1, 0), SPIN_SPEED)

    // The glow on the podium top, lying flat just above it
    const glow = engine.addEntity()
    Transform.create(glow, {
      position: Vector3.create(p.x, PODIUM_TOP + 0.01, p.z),
      rotation: Quaternion.fromEulerDegrees(90, 0, 0),
      scale: Vector3.create(GLOW_SIZE, GLOW_SIZE, 1)
    })
    MeshRenderer.setPlane(glow)
    const tex = Material.Texture.Common({ src: DIR + 'glow.png' })
    const colour = GLOWS[i % 3]
    Material.setPbrMaterial(glow, {
      texture: tex,
      alphaTexture: tex,
      albedoColor: colour,
      emissiveTexture: tex,
      emissiveColor: colour,
      emissiveIntensity: GLOW_STRENGTH,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      metallic: 0,
      roughness: 1,
      specularIntensity: 0
    })

    // The Coming soon sign over the club: starts shrunk to nothing, turns to face the camera
    const sign = engine.addEntity()
    Transform.create(sign, {
      position: Vector3.create(p.x, PODIUM_TOP + FLOAT + CLUB_LENGTH * SCALE + BOB + SIGN_ABOVE, p.z),
      scale: Vector3.create(0, 0, 0)
    })
    MeshRenderer.setPlane(sign)
    Billboard.create(sign, { billboardMode: BillboardMode.BM_Y })
    const signTex = Material.Texture.Common({ src: SIGN_IMAGE })
    Material.setPbrMaterial(sign, {
      texture: signTex,
      alphaTexture: signTex,
      emissiveTexture: signTex,
      emissiveColor: Color4.White(),
      emissiveIntensity: 1,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      metallic: 0,
      roughness: 1,
      specularIntensity: 0
    })
    signs.push({ entity: sign, x: p.x, z: p.z, shown: false })
  })
  engine.addSystem(comingSoonSystem, undefined, 'coming-soon-signs')
}
