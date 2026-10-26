import { engine, Entity, GltfContainer, ColliderLayer, Transform, MeshRenderer, Material, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { effectiveHot, hotSecondsLeft, tutorial } from './ledger/client'
import { courseSurfaceAt } from './ballSim'

// The hot target marker: a glowing gold ring lying flat round the hot target's edge, pulsing
// brighter and dimmer, so the target itself looks lit up from anywhere on the range. It sits on
// the grass at the rim, so it never covers other targets, the flag or the ground. In the last
// few seconds before the hot target moves on it flashes faster and harder, as a warning.
// The countdown itself is on the range card. The server picks the target and rotates it every
// 30 seconds for everyone (ledger/server.ts); in the tutorial it's the lesson target on its last
// shot (effectiveHot). Hidden while nothing is hot.
//
// Earlier markers are kept: the ring with the floating 2X badge (src/hotTarget.rimbadge.ts.bak),
// the coin (src/hotTarget.coin.ts.bak, assets/hot/Multiplierv3.glb), the Multiplier band
// (src/hotTarget.ring.ts.bak, assets/hot/Multiplier.glb) and the first 2X badge (src/hotTarget.ts.bak).

const RIM_TEXTURE = 'assets/hot/rim.png'

//
const MODEL = 'assets/Models/Ring/Ring.glb'


/**
 * Custom glow for some targets, by colour. Black is a long strip (20 x 150 m) seen almost edge-on
 * from the bays, where a ring shrinks to a thin line: it gets the whole strip lit up instead, a
 * soft fill with a bright band round its edge (drawn for a 20 x 150 strip, at RIM_SPAN).
 */
const RIM_TEXTURE_FOR: { [colour: string]: string } = { Black: 'assets/hot/rim-black.png' }
/** The glow's colour (gold). Any colour works: it's tinted in code. */
const RIM_COLOUR = Color3.create(1, 0.76, 0.1)
/**
 * The texture is a ring whose solid band sits at 81 to 90% of its half-width and fades out to
 * the edge. RIM_SPAN sets how far past the target's edge the texture reaches (1.2 = 20% wider),
 * which puts the solid band from 97% to 108% of the target's radius: right on its lip.
 */
const RIM_SPAN = 1.2
/** Glow strength: pulses between these, once every RIM_PULSE_SECONDS */
const RIM_GLOW_MIN = 1.5
const RIM_GLOW_MAX = 5
const RIM_PULSE_SECONDS = 1.2
/** The warning: for the last WARN_SECONDS it flashes this fast, between these strengths */
const WARN_SECONDS = 5
const WARN_PULSE_SECONDS = 0.35
const WARN_GLOW_MIN = 0.3
const WARN_GLOW_MAX = 8
/** Just above the grass at the rim, so it never flickers into it (metres) */
const RIM_LIFT = 0.06
/** Ground more than this above the hole counts as a wall, not the rim (the cliff by Black) */
const CLIFF_SKIP = 10

//
const ZONE_OVERRIDE = null
const SIZE = 0.05
const SIZE_MIN = 0.5
const SIZE_MAX = 1.5
const FLAG_TOP = 13
const FLAG_CLEARANCE = -5
const BOB_HEIGHT = 0.5
const BOB_SECONDS = 5
const SPIN_SPEED = 10

const HIDDEN = Vector3.create(0, -100, 0)

let rimTexture = RIM_TEXTURE

function rimMaterial(rim: Entity, glow: number): void {
  Material.setPbrMaterial(rim, {
    texture: Material.Texture.Common({ src: rimTexture }),
    albedoColor: Color4.create(RIM_COLOUR.r, RIM_COLOUR.g, RIM_COLOUR.b, 1),
    emissiveColor: RIM_COLOUR,
    emissiveTexture: Material.Texture.Common({ src: rimTexture }),
    emissiveIntensity: glow,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
    metallic: 0,
    roughness: 1
  })
}

export function setupHotTargetMarker(zoneEntity: (zone: string) => Entity | undefined): void {
  // A flat plane with the ring texture, laid on the ground
  const rim = engine.addEntity()
  Transform.create(rim, { position: HIDDEN })
  MeshRenderer.setPlane(rim)
  rimMaterial(rim, RIM_GLOW_MIN)

  //
  const Ring = engine.addEntity()
  Transform.create(Ring, { position: HIDDEN })
  GltfContainer.create(Ring, {
    src: MODEL,
    // Looks only: the ball passes straight through it
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })

  let shownZone = ''
  let showing = false
  let clock = 0
  let yaw = 0
  let base = HIDDEN
  let scale = Vector3.One()

  engine.addSystem((dt) => {
    const zone = effectiveHot()
    if (zone !== shownZone) {
      shownZone = zone
      const ent = zone ? zoneEntity(zone) : undefined
      const t = ent ? Transform.getOrNull(ent) : null
      if (!t) {
        showing = false
        Transform.getMutable(rim).position = HIDDEN
        if (zone) console.log(`[hot] no target entity named ${zone}, the marker is hidden`)
      } else {
        //
        const x = t.position.x
        const z = t.position.z
        const rx = Math.abs(t.scale.x) / 2
        const rz = Math.abs(t.scale.z) / 2
        //
        const targetRadius = Math.min(Math.abs(t.scale.x), Math.abs(t.scale.z)) / 2
        const r = Math.min(SIZE_MAX, Math.max(SIZE_MIN, targetRadius * SIZE))
        scale = Vector3.create(r, r, r)
        base = Vector3.create(t.position.x, FLAG_TOP + FLAG_CLEARANCE + r, t.position.z)
        // The rim's height: the highest real grass just outside the target's edge, round it
        const hole = courseSurfaceAt(x, z) ?? t.position.y
        let grass = hole
        for (const f of [1, 1.1]) {
          for (let i = 0; i < 48; i++) {
            const a = (i / 48) * Math.PI * 2
            const local = Vector3.rotate(Vector3.create(Math.sin(a) * rx * f, 0, Math.cos(a) * rz * f), t.rotation)
            const h = courseSurfaceAt(x + local.x, z + local.z)
            if (h !== null && h > grass && h <= hole + CLIFF_SKIP) grass = h
          }
        }
        rimTexture = RIM_TEXTURE_FOR[zone.replace(/\d+$/, '')] ?? RIM_TEXTURE
        // Flat on the ground, the target's own shape and turn (the long Black strip gets its own glow)
        const rt = Transform.getMutable(rim)
        rt.position = Vector3.create(x, grass + RIM_LIFT, z)
        rt.rotation = Quaternion.multiply(t.rotation, Quaternion.fromEulerDegrees(90, 0, 0))
        rt.scale = Vector3.create(rx * 2 * RIM_SPAN, rz * 2 * RIM_SPAN, 1)
        showing = true
        console.log(`[hot] rim on ${zone} at ${(grass + RIM_LIFT).toFixed(1)} m`)
      }
    }
    if (!showing) return

    // The pulse: gentle normally, fast and hard in the last few seconds (not in the tutorial's
    // lesson, which has no countdown)
    clock += dt
    const left = hotSecondsLeft()
    const warn = !tutorial.active && left > 0 && left <= WARN_SECONDS
    const period = warn ? WARN_PULSE_SECONDS : RIM_PULSE_SECONDS
    const low = warn ? WARN_GLOW_MIN : RIM_GLOW_MIN
    const high = warn ? WARN_GLOW_MAX : RIM_GLOW_MAX
    const wave = 0.5 + 0.5 * Math.sin((clock / period) * Math.PI * 2)
    rimMaterial(rim, low + (high - low) * wave)
    
    //
    yaw = (((yaw + SPIN_SPEED * dt) % 360) + 360) % 360
    const bob = Math.sin((clock / BOB_SECONDS) * Math.PI * 2) * BOB_HEIGHT
    const tr = Transform.getMutable(Ring)
    tr.position = Vector3.create(base.x, base.y + BOB_HEIGHT + bob, base.z)
    tr.rotation = Quaternion.fromEulerDegrees(0, yaw, 0)
    const XZScale = (0.2 * bob) + 0.8
    tr.scale = Vector3.create(scale.x * XZScale, scale.y, scale.z * XZScale)
  })
}
