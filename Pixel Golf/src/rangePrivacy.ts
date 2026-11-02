import { engine, Entity, Transform, AvatarModifierArea, AvatarModifierType, PlayerIdentityData } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { FRAMES, PAD_TOP } from './bayBarriers'
import { bays, solo } from './ledger/client'
import { SHOP_NPC_IDS } from './shop'

// Hides other players who are out in front of the bays, so nobody running about down the range
// gets in the way of your shot. Players at the bays themselves (standing at or behind the ball)
// stay visible, so you can still watch people taking their shots.
//
// Each of bays 1 to 18 has a box over its lane (AvatarModifierArea), starting a little in front of
// its ball and running out down the range; anyone inside one is hidden from you, nametag and all.
// The lanes are worked out from the bay positions in bayBarriers.ts (FRAMES), the same way as the
// lane barriers. Bays 19 (tutorial) and 20 (solo) already hide their players (tutorialVisuals.ts).
//
// Never hidden: you (from your own view), the shopkeepers, and anyone holding a bay or in the solo
// bay, in case their stance or aim puts them a touch over the line.
//
// Client only: each player sees their own version.

/** Where the box starts, in metres in front of the ball (the golfer stands 0.37 m behind it) */
const START_AHEAD = 2.5
/** How far down the range it runs */
const LENGTH = 320
/** How far below the pad and above it the box reaches (the range is ~30 m below the bays) */
const BELOW = 40
const ABOVE = 40
/** Taken off the gap between bays for each box's width, so it never reaches into the next bay */
const MARGIN = 0.3
/** Every this often the areas are nudged so the explorer re-checks who is inside (phones missed some) */
const REFRESH_SECONDS = 2
const NUDGE = 0.01

const MODIFIERS = [AvatarModifierType.AMT_HIDE_AVATARS, AvatarModifierType.AMT_HIDE_NAMETAGS, AvatarModifierType.AMT_DISABLE_PASSPORTS]

type Lane = { entity: Entity; size: Vector3 }

/** Bay `bay`'s box: in front of its ball, square to the line of bays, facing down the range (+x) */
function laneBox(bay: number): Lane | null {
  const here = FRAMES[bay]
  if (!here) return null
  const before = FRAMES[bay - 1] ?? here
  const after = FRAMES[bay + 1] ?? here
  const ax = after.x - before.x
  const az = after.z - before.z
  const len = Math.hypot(ax, az)
  if (len < 0.01) return null
  let dx = az / len
  let dz = -ax / len
  if (dx < 0) {
    dx = -dx
    dz = -dz
  }
  let gap = Infinity
  for (const n of [bay - 1, bay + 1]) {
    const f = FRAMES[n]
    if (f) gap = Math.min(gap, Math.hypot(f.x - here.x, f.z - here.z))
  }
  if (!isFinite(gap)) return null
  const mid = START_AHEAD + LENGTH / 2
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(here.x + dx * mid, PAD_TOP + (ABOVE - BELOW) / 2, here.z + dz * mid),
    rotation: Quaternion.fromEulerDegrees(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0)
  })
  // The area's z runs down the range, its x across the lane
  const size = Vector3.create(gap - MARGIN, BELOW + ABOVE, LENGTH)
  AvatarModifierArea.create(entity, { area: size, excludeIds: [], modifiers: MODIFIERS })
  return { entity, size }
}

export function setupRangePrivacy(): void {
  const lanes: Lane[] = []
  for (let bay = 1; bay <= 18; bay++) {
    const l = laneBox(bay)
    if (l) lanes.push(l)
  }

  let shownKey = ''
  let refreshClock = 0
  let nudged = false
  let wait = 0

  engine.addSystem((dt) => {
    // Who's never hidden: me, the shopkeepers, and everyone at a bay
    wait -= dt
    if (wait <= 0) {
      wait = 0.5
      const ids = new Set<string>(SHOP_NPC_IDS)
      const me = getPlayer()?.userId ?? ''
      if (me) ids.add(me).add(me.toLowerCase())
      for (const k in bays.owners) {
        const u = bays.owners[k].u
        if (u) ids.add(u).add(u.toLowerCase())
      }
      for (const u of solo.players) ids.add(u).add(u.toLowerCase())
      // Owners are listed lower case; add each player's address as the scene has it too
      for (const [, who] of engine.getEntitiesWith(PlayerIdentityData)) {
        const a = who.address
        if (a && ids.has(a.toLowerCase())) ids.add(a)
      }
      const list = Array.from(ids).sort()
      const key = list.join(',')
      if (key !== shownKey) {
        shownKey = key
        for (const l of lanes) AvatarModifierArea.getMutable(l.entity).excludeIds = list
      }
    }

    // Nudge every area now and then so the explorer checks again who's inside
    refreshClock += dt
    if (refreshClock >= REFRESH_SECONDS) {
      refreshClock = 0
      nudged = !nudged
      const d = nudged ? NUDGE : 0
      for (const l of lanes) AvatarModifierArea.getMutable(l.entity).area = Vector3.create(l.size.x + d, l.size.y, l.size.z)
    }
  })
}
