import { engine, Entity, Transform, AvatarModifierArea, AvatarModifierType, PlayerIdentityData, MeshRenderer, MeshCollider, ColliderLayer, Material, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { FRAMES, PAD_TOP } from './bayBarriers'
import { bays, tutorial, solo } from './ledger/client'
import { SHOP_NPC_IDS } from './shop'
import { hiddenInPrivateBay } from './tutorialVisuals'

// Hides other players who'd get in the way of your shot:
//  - anyone out in front of the bays, running about down the range (the range area, below)
//  - anyone standing in a bay that isn't theirs (the bay boxes, below)
// Players at their own bay, or in the walkways between bays and behind them, stay visible, so you
// can still watch people taking their shots. There are no walls: nobody is ever blocked.
//
// The bay boxes (2026-11-03): each of bays 1 to 18 has a box over just the bay itself, the pad
// with its club rack on one side and its screen on the other (BAY_BOX, measured from the models),
// leaving a walkable gap of about 2 m between bays. Only while a bay is busy (someone holds it),
// anyone inside is hidden except the player who holds that bay. A free bay hides nobody.
//
// The same box is also a barrier while the bay is busy (2026-11-03): solid to everyone but the
// player holding it, so nobody can walk into someone else's bay mid-round. It only turns solid
// for you once you're outside it, so it never traps anyone already standing in the bay when it
// was taken. It only stops players: balls, clicks and the camera go straight through.
//
// One hiding area (AvatarModifierArea) covers the whole range in front of the bays, from just
// behind the line of bays out to the far end, and a little wider than the outermost bays, with no
// gaps in it. (It used to be one box per bay, which left thin gaps between the lanes that people
// could walk down without being hidden, and nothing past the end bays.)
//
// Who is hidden is decided by where each player stands, checked several times a second: anyone
// more than IN_FRONT metres in front of the line of balls (measured from the nearest bay, square
// to the line) is hidden, bay holder or not; anyone at or behind it is left visible, by putting
// them on the area's exclude list. The line follows the curve of the bays (FRAMES in
// bayBarriers.ts). Bays 19 (tutorial) and 20 (solo) already hide their players (tutorialVisuals.ts).
//
// Never hidden: you (from your own view) and the shopkeepers.
//
// Client only: each player sees their own version.

/** Hidden once this far in front of the line of balls (m). The golfer stands 0.37 m behind the ball. */
const IN_FRONT = 2.5
/** The area: from this far behind the line's nearest point to the building, out to this far down the range (m) */
const BEHIND = 8
const LENGTH = 330
/** and this much wider than the outermost bays, each side (m) */
const SIDES = 12
/** How far below the pads and above them it reaches (the range is ~30 m below the bays) */
const BELOW = 40
const ABOVE = 40
/** How often who's in front is checked (s) */
const CHECK_SECONDS = 1 / 15
/** Every this often the area is nudged so the explorer re-checks who is inside (phones missed some) */
const REFRESH_SECONDS = 2
const NUDGE = 0.01

/**
 * A bay box, measured from the ball (the middle of the pad), square to the line of bays: across
 * the line (+ is the club rack's side, - the screen's) and down the range (+ towards the range),
 * and from a little under the pad to well over head height. The pad is 3.75 m across, the screen
 * reaches 3.3 m out on its side and the rack about 3.2 m on the other.
 */
const BAY_BOX = { acrossMin: -3.6, acrossMax: 3.5, downMin: -2.5, downMax: 2.6, below: 1, above: 4 }
/** How the bay boxes look while Show barriers is on (showBarriers.ts) */
const BAY_BOX_LOOK = Color4.create(1, 0.15, 0.15, 0.4)

const MODIFIERS = [AvatarModifierType.AMT_HIDE_AVATARS, AvatarModifierType.AMT_HIDE_NAMETAGS, AvatarModifierType.AMT_DISABLE_PASSPORTS]

/** Each bay's ball spot on the line and which way is down the range from it (square to the line, towards +x) */
type Spot = { bay: number; x: number; z: number; dx: number; dz: number }
function lineSpots(): Spot[] {
  const out: Spot[] = []
  for (let bay = 1; bay <= 18; bay++) {
    const here = FRAMES[bay]
    if (!here) continue
    const before = FRAMES[bay - 1] ?? here
    const after = FRAMES[bay + 1] ?? here
    const ax = after.x - before.x
    const az = after.z - before.z
    const len = Math.hypot(ax, az)
    if (len < 0.01) continue
    let dx = az / len
    let dz = -ax / len
    if (dx < 0) {
      dx = -dx
      dz = -dz
    }
    out.push({ bay, x: here.x, z: here.z, dx, dz })
  }
  return out
}

/** How far in front of the line of balls a point is (m): + is down the range, - is back towards the building */
function inFrontBy(spots: Spot[], x: number, z: number): number {
  let best = Infinity
  let ahead = 0
  for (const s of spots) {
    const d = Math.hypot(x - s.x, z - s.z)
    if (d < best) {
      best = d
      ahead = (x - s.x) * s.dx + (z - s.z) * s.dz
    }
  }
  return ahead
}

type BayBox = { bay: number; entity: Entity; size: Vector3; look: Entity | null; busy: boolean; wall: Entity; solid: boolean }
const bayBoxes: BayBox[] = []

/** Show barriers (showBarriers.ts): draw the bay boxes, or stop drawing them */
export function setBayBoxesVisible(on: boolean): void {
  for (const b of bayBoxes) {
    if (on && !b.look) {
      const look = engine.addEntity()
      // Drawn only while the bay is busy (a free bay hides nobody)
      Transform.create(look, { parent: b.entity, scale: b.busy ? b.size : Vector3.Zero() })
      MeshRenderer.setBox(look)
      Material.setPbrMaterial(look, {
        albedoColor: BAY_BOX_LOOK,
        emissiveColor: BAY_BOX_LOOK,
        emissiveIntensity: 1,
        transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
        metallic: 0,
        roughness: 1
      })
      b.look = look
    } else if (!on && b.look) {
      engine.removeEntity(b.look)
      b.look = null
    }
  }
}

/** Bay `bay`'s box over the bay itself (BAY_BOX), hiding anyone in it but the bay's holder */
function makeBayBox(bay: number, spot: Spot): BayBox {
  // Across the line: square to down the range, + towards the club rack (the +z side of the ball)
  let ax = -spot.dz
  let az = spot.dx
  if (az < 0) {
    ax = -ax
    az = -az
  }
  const across = (BAY_BOX.acrossMin + BAY_BOX.acrossMax) / 2
  const down = (BAY_BOX.downMin + BAY_BOX.downMax) / 2
  const size = Vector3.create(BAY_BOX.acrossMax - BAY_BOX.acrossMin, BAY_BOX.below + BAY_BOX.above, BAY_BOX.downMax - BAY_BOX.downMin)
  const entity = engine.addEntity()
  // Turned so the box's z runs down the range and its x across the line
  const yaw = (Math.atan2(spot.dx, spot.dz) * 180) / Math.PI
  Transform.create(entity, {
    position: Vector3.create(spot.x + spot.dx * down + ax * across, PAD_TOP + (BAY_BOX.above - BAY_BOX.below) / 2, spot.z + spot.dz * down + az * across),
    rotation: Quaternion.fromEulerDegrees(0, yaw, 0)
  })
  AvatarModifierArea.create(entity, { area: size, excludeIds: [], modifiers: MODIFIERS })
  // The barrier: the same box, solid only while it's switched on (setWall)
  const wall = engine.addEntity()
  Transform.create(wall, { parent: entity, scale: size })
  return { bay, entity, size, look: null, busy: false, wall, solid: false }
}

/** A player only bumps into it (not balls, clicks or the camera) */
function setWall(b: BayBox, solid: boolean): void {
  if (solid === b.solid) return
  b.solid = solid
  if (solid) MeshCollider.setBox(b.wall, ColliderLayer.CL_PHYSICS)
  else MeshCollider.deleteFrom(b.wall)
}

/** Whether a point is inside a bay's box, or within `margin` metres of it */
function insideBox(b: BayBox, p: Vector3, margin: number): boolean {
  const t = Transform.get(b.entity)
  const rel = Vector3.create(p.x - t.position.x, p.y - t.position.y, p.z - t.position.z)
  const local = Vector3.rotate(rel, Quaternion.create(-t.rotation.x, -t.rotation.y, -t.rotation.z, t.rotation.w))
  return Math.abs(local.x) <= b.size.x / 2 + margin && Math.abs(local.y) <= b.size.y / 2 + margin && Math.abs(local.z) <= b.size.z / 2 + margin
}
/** Counts as inside (so the barrier stays off) this close to the box: about an avatar's width */
const WALL_MARGIN = 0.4

export function setupRangePrivacy(): void {
  const spots = lineSpots()
  if (!spots.length) return

  // The bay boxes, one over each of bays 1 to 18
  for (const s of spots) bayBoxes.push(makeBayBox(s.bay, s))

  // The area, square to the range (+x): from just behind the nearest bay to the far end, and
  // across every bay with room to spare. Anyone in it who isn't in front of the line is excluded.
  let minX = Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const s of spots) {
    minX = Math.min(minX, s.x)
    minZ = Math.min(minZ, s.z)
    maxZ = Math.max(maxZ, s.z)
  }
  const x0 = minX - BEHIND
  const size = Vector3.create(LENGTH + BEHIND, BELOW + ABOVE, maxZ - minZ + 2 * SIDES)
  const area: Entity = engine.addEntity()
  Transform.create(area, {
    position: Vector3.create(x0 + size.x / 2, PAD_TOP + (ABOVE - BELOW) / 2, (minZ + maxZ) / 2)
  })
  AvatarModifierArea.create(area, { area: size, excludeIds: [], modifiers: MODIFIERS })

  let shownKey = ''
  const bayKeys = new Map<number, string>()
  let wait = 0
  let refreshClock = 0
  let nudged = false

  engine.addSystem((dt) => {
    wait -= dt
    if (wait <= 0) {
      wait = CHECK_SECONDS
      // Left visible: me, the shopkeepers, and everyone at or behind the line of balls
      const base = new Set<string>(SHOP_NPC_IDS)
      const me = getPlayer()?.userId ?? ''
      if (me) base.add(me).add(me.toLowerCase())
      const ids = new Set<string>(base)
      // While I'm in the tutorial or the solo bay, everyone else is hidden from me (tutorialVisuals.ts):
      // these areas then show nobody but me and the shopkeepers, or they'd let others back into view
      const privateMode = tutorial.active || solo.joined
      for (const [entity, who] of engine.getEntitiesWith(PlayerIdentityData)) {
        if (privateMode) break
        const a = who.address
        if (!a) continue
        const t = Transform.getOrNull(entity)
        // Not anyone the tutorial or solo bay's box hides: where the areas overlap, showing them
        // here let them be seen (tutorialVisuals.ts)
        if (t && hiddenInPrivateBay(a, t.position)) continue
        if (!t || inFrontBy(spots, t.position.x, t.position.z) <= IN_FRONT) ids.add(a).add(a.toLowerCase())
      }
      const list = Array.from(ids).sort()
      const key = list.join(',')
      if (key !== shownKey) {
        shownKey = key
        AvatarModifierArea.getMutable(area).excludeIds = list
      }

      // Each busy bay's box leaves out me, the shopkeepers and that bay's holder. A free bay's box
      // leaves out everyone, so it hides nobody.
      const mePos = Transform.getOrNull(engine.PlayerEntity)?.position
      for (const b of bayBoxes) {
        const keep = new Set<string>(base)
        const u = bays.owners[String(b.bay)]?.u
        const busy = !!u
        if (privateMode) {
          // Nobody else shown (see privateMode above)
        } else if (u) {
          keep.add(u).add(u.toLowerCase())
          for (const [, who] of engine.getEntitiesWith(PlayerIdentityData)) if (who.address && who.address.toLowerCase() === u.toLowerCase()) keep.add(who.address)
        } else {
          for (const [, who] of engine.getEntitiesWith(PlayerIdentityData)) if (who.address) keep.add(who.address).add(who.address.toLowerCase())
        }
        // The barrier: solid while someone else holds the bay and I'm outside it
        const mine = !!u && !!me && u.toLowerCase() === me.toLowerCase()
        setWall(b, busy && !mine && !!mePos && !insideBox(b, mePos, WALL_MARGIN))
        if (busy !== b.busy) {
          b.busy = busy
          if (b.look) Transform.getMutable(b.look).scale = busy ? b.size : Vector3.Zero()
        }
        const bl = Array.from(keep).sort()
        const bk = bl.join(',')
        if (bayKeys.get(b.bay) !== bk) {
          bayKeys.set(b.bay, bk)
          AvatarModifierArea.getMutable(b.entity).excludeIds = bl
        }
      }
    }

    // Nudge the area now and then so the explorer checks again who's inside
    refreshClock += dt
    if (refreshClock >= REFRESH_SECONDS) {
      refreshClock = 0
      nudged = !nudged
      AvatarModifierArea.getMutable(area).area = Vector3.create(size.x + (nudged ? NUDGE : 0), size.y, size.z)
      for (const b of bayBoxes) AvatarModifierArea.getMutable(b.entity).area = Vector3.create(b.size.x + (nudged ? NUDGE : 0), b.size.y, b.size.z)
    }
  })
}
