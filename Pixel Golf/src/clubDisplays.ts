import { engine, Transform, GltfContainer, ColliderLayer, Tween, TweenSequence, TweenLoop, EasingFunction, MeshRenderer, Material, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

// Spinning clubs on the shop's podiums (Shop/Golf Club Podiums.glb). There are six podiums, three
// on each side of the shop, and each side gets one of each club: the Skull Spirit, the Glass and
// the Ruby (assets/Shop/Display Clubs/). Each club stands upright, head down, floating just over
// its podium, turning slowly and bobbing gently. The motion is done by the explorer (Tween), so it
// costs the scene nothing per frame. Decoration only: nothing to click.
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
/** Degrees a second it turns */
const SPIN_SPEED = 45
/** The bob: how far up and down (m) and how long one way takes (ms) */
const BOB = 0.08
const BOB_MS = 1600

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
  })
}
