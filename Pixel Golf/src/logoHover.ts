import { engine, Entity, GltfContainer, Transform, Tween, TweenSequence, TweenLoop, EasingFunction } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

// The big Pixel Golf logo by the seating area (assets/Seating Area/Logo.glb) bobs gently up and
// down. It's placed in the Creator Hub, so it's found by its model. The tween runs in the
// explorer itself (a there-and-back loop), so it costs the scene nothing each frame.

const LOGO_SRC = 'assets/Seating Area/Logo.glb'
/** How far it rises above where it was placed (m) */
const RISE = 0.25
/** How long one way takes (s): up, then the same back down */
const SECONDS = 2.5

export function setupLogoHover(): void {
  let done = false
  // Creator Hub entities are there from the start, but look again for a moment in case they're late
  let tries = 0
  engine.addSystem(function logoHoverSystem() {
    if (done) return
    if (++tries > 300) {
      done = true
      engine.removeSystem(logoHoverSystem)
      return
    }
    let logo: Entity | undefined
    for (const [entity, g] of engine.getEntitiesWith(GltfContainer)) {
      if (g.src.toLowerCase() === LOGO_SRC.toLowerCase()) logo = entity
    }
    if (logo === undefined) return
    done = true
    engine.removeSystem(logoHoverSystem)
    const start = Transform.getOrNull(logo)?.position ?? Vector3.Zero()
    Tween.createOrReplace(logo, {
      mode: Tween.Mode.Move({ start, end: Vector3.create(start.x, start.y + RISE, start.z) }),
      duration: SECONDS * 1000,
      easingFunction: EasingFunction.EF_EASESINE
    })
    TweenSequence.createOrReplace(logo, { sequence: [], loop: TweenLoop.TL_YOYO })
  })
}
