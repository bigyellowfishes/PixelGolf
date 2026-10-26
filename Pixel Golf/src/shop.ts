import {
  engine,
  Entity,
  Transform,
  AvatarShape,
  MeshCollider,
  ColliderLayer,
  InputAction,
  pointerEventsSystem
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3, Color3 } from '@dcl/sdk/math'
import { forTouch } from './mobile'
import { playUi } from './sfx'
import { menuReopenBlocked } from './menuGuard'
import { CosmeticKind } from './ledger/rules'
import { tutorial, onRefused } from './ledger/client'

/**
 * The two shopkeepers, behind the shop counter at fixed spots (SHOP_NPCS position and facing).
 * They turn to face you when you come near and wave when you walk up.
 *
 * Walking within OPEN_RANGE of either opens the shop (ui/ShopMenu.tsx) and walking past
 * CLOSE_RANGE closes it. Closing it with the X keeps it shut until you've walked away and come
 * back, or click a shopkeeper. Each shopkeeper opens it on their own aisle (SHOP_NPCS aisle).
 *
 * Names, looks, greetings and spots are all set here. Positions are scene coordinates (the
 * same numbers Creator Hub shows), with y the floor they stand on. facing is the way they look
 * when nobody's near, in degrees (0 = +z, 90 = +x). Wearables are Decentraland base-avatar URNs
 * (free, always loadable); any collection wearable URN works too.
 */
export const SHOP_NPCS: ShopNpc[] = [
  {
    name: 'Caddie Cass',
    position: { x: 60.5, y: 35, z: 246.25 },
    facing: 90,
    bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseFemale',
    // Only base-avatar wearables checked to exist: one that doesn't can stop the avatar loading.
    // Face, eyes and mouth are left to the defaults.
    wearables: [
      'urn:decentraland:off-chain:base-avatars:standard_hair',
      'urn:decentraland:off-chain:base-avatars:f_simple_yellow_tshirt',
      'urn:decentraland:off-chain:base-avatars:f_brown_trousers',
      'urn:decentraland:off-chain:base-avatars:bun_shoes',
      'urn:decentraland:off-chain:base-avatars:blue_bandana'
    ],
    skinColor: { r: 0.8, g: 0.6, b: 0.46 },
    hairColor: { r: 0.36, g: 0.19, b: 0.06 },
    aisle: 'ball',
    greeting: 'Welcome to the pro shop! Fancy a new ball?'
  },
  {
    name: 'Pro Pete',
    position: { x: 60.5, y: 35, z: 254 },
    facing: 90,
    bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseMale',
    wearables: [
      'urn:decentraland:off-chain:base-avatars:casual_hair_01',
      'urn:decentraland:off-chain:base-avatars:blue_tshirt',
      'urn:decentraland:off-chain:base-avatars:brown_pants',
      'urn:decentraland:off-chain:base-avatars:classic_shoes'
    ],
    skinColor: { r: 0.6, g: 0.46, b: 0.36 },
    hairColor: { r: 0.1, g: 0.07, b: 0.05 },
    // Clubs are hidden for now (SHOW_CLUBS), so Pete sells balls too
    aisle: 'ball',
    greeting: 'Alright! Fancy a new ball?'
  }
]

export type ShopNpc = {
  name: string
  /** Where they stand: scene coordinates, y = the floor */
  position: { x: number; y: number; z: number }
  /** Which way they look when nobody's near, degrees (0 = +z, 90 = +x) */
  facing: number
  bodyShape: string
  wearables: string[]
  skinColor?: { r: number; g: number; b: number }
  hairColor?: { r: number; g: number; b: number }
  /** Which tab the shop opens on when it's this shopkeeper you walked up to */
  aisle: CosmeticKind
  /** Shown at the top of the shop when they open it */
  greeting: string
}

/** Close enough for them to turn to you (metres) */
const LOOK_RANGE = 10
/** Walk this close to a shopkeeper (metres) and the shop opens */
const OPEN_RANGE = 3.5
/** and this far away and it closes. A little further than OPEN_RANGE so it doesn't flicker at the edge. */
const CLOSE_RANGE = 4.5
/** How far away a shopkeeper can be clicked */
const CLICK_RANGE = 8
/** How fast they turn to face you (degrees a second) */
const TURN_SPEED = 180
/** Before a shopkeeper waves at you again after you've walked off */
const WAVE_AGAIN_SECONDS = 30

/** The Clubs tab. Off for now: club cosmetics have no models yet. true brings the tab back. */
export const SHOW_CLUBS = false

// --- what the shop shows (ui/ShopMenu.tsx reads this) ---------------------
export const shop = {
  open: false,
  /** The tab showing */
  aisle: 'ball' as CosmeticKind,
  /** The shopkeeper who opened it, and what they said */
  keeper: '',
  greeting: '',
  /** Why the last buy didn't go through (the server's words), shown until noticeUntil */
  notice: '',
  noticeUntil: 0
}

/** Closed with the X: stays shut until you walk out of range (or click a shopkeeper) */
let dismissed = false

function openShop(k: Keeper): void {
  if (!shop.open && menuReopenBlocked()) return
  if (!shop.open) playUi('ui_open')
  shop.open = true
  shop.aisle = SHOW_CLUBS ? k.npc.aisle : 'ball'
  shop.keeper = k.npc.name
  shop.greeting = k.npc.greeting
  dismissed = false
}

/** The X: closes the shop until you walk off and come back */
export function closeShop(): void {
  if (!shop.open) return
  shop.open = false
  dismissed = true
  playUi('ui_close')
}

type Keeper = {
  npc: ShopNpc
  entity: Entity
  /** Which way they face when nobody's near (SHOP_NPCS facing), so they settle back to it */
  homeYaw: number
  yaw: number
  /** Seconds since you were last in look range; a wave is due when you come back after long enough */
  awayFor: number
  waveCount: number
}

const keepers: Keeper[] = []

/** The shopkeepers' avatar ids, so the privacy areas (tutorialVisuals.ts) never hide them */
// A nametag shows the last 4 characters of the id after the name, in grey. Ending the id with 4
// spaces hides that suffix (the ids stay different from each other before the spaces).
export const SHOP_NPC_IDS = SHOP_NPCS.map((_, i) => `pixel-golf-shop-${i}    `)

function spawnKeeper(npc: ShopNpc, index: number): void {
  const homeYaw = npc.facing
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(npc.position.x, npc.position.y, npc.position.z),
    rotation: Quaternion.fromEulerDegrees(0, homeYaw, 0)
  })
  AvatarShape.create(entity, {
    id: SHOP_NPC_IDS[index],
    name: npc.name,
    bodyShape: npc.bodyShape,
    wearables: npc.wearables,
    emotes: [],
    skinColor: npc.skinColor ? Color3.create(npc.skinColor.r, npc.skinColor.g, npc.skinColor.b) : undefined,
    hairColor: npc.hairColor ? Color3.create(npc.hairColor.r, npc.hairColor.g, npc.hairColor.b) : undefined
  })

  // Avatars can't be clicked on their own, so an invisible box the size of one takes the click.
  // Pointer only: you don't bump into it.
  const hit = engine.addEntity()
  Transform.create(hit, { parent: entity, position: Vector3.create(0, 0.9, 0), scale: Vector3.create(0.7, 1.8, 0.7) })
  MeshCollider.setBox(hit, ColliderLayer.CL_POINTER)

  const keeper: Keeper = { npc, entity, homeYaw, yaw: homeYaw, awayFor: WAVE_AGAIN_SECONDS, waveCount: 0 }
  keepers.push(keeper)

  pointerEventsSystem.onPointerDown(
    { entity: hit, opts: { button: InputAction.IA_POINTER, hoverText: forTouch(`Shop with ${npc.name}`), maxDistance: CLICK_RANGE } },
    () => openShop(keeper)
  )
}

function wave(k: Keeper): void {
  k.waveCount++
  const shape = AvatarShape.getMutable(k.entity)
  shape.expressionTriggerId = 'wave'
  // A new timestamp is what makes the avatar play the emote again
  shape.expressionTriggerTimestamp = k.waveCount
}

// Shortest way round from one angle to another, in degrees
function angleDelta(from: number, to: number): number {
  let d = (to - from) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

function updateKeepers(dt: number): void {
  const me = Transform.getOrNull(engine.PlayerEntity)
  if (!me) return
  let nearest: Keeper | null = null
  let nearestDist = Infinity
  for (const k of keepers) {
    // Read only: getMutable marks it changed, which sent both shopkeepers to the renderer every frame
    const t = Transform.get(k.entity)
    const dx = me.position.x - t.position.x
    const dz = me.position.z - t.position.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    // Face you while you're near, otherwise back to their resting direction
    const near = dist < LOOK_RANGE
    const target = near ? (Math.atan2(dx, dz) * 180) / Math.PI : k.homeYaw
    const d = angleDelta(k.yaw, target)
    const step = TURN_SPEED * dt
    if (Math.abs(d) > 0.5) {
      k.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step
      Transform.getMutable(k.entity).rotation = Quaternion.fromEulerDegrees(0, k.yaw, 0)
    }

    // A wave when you walk up, if you've been away a while
    if (near) {
      if (k.awayFor >= WAVE_AGAIN_SECONDS) wave(k)
      k.awayFor = 0
    } else {
      k.awayFor += dt
    }

    if (dist < nearestDist) {
      nearest = k
      nearestDist = dist
    }
  }

  // The shop trigger: open when you walk up to either shopkeeper, close when you walk off.
  // Not during the tutorial (you're kept in bay 19 then anyway).
  if (!nearest) return
  if (nearestDist > CLOSE_RANGE) {
    if (shop.open) {
      shop.open = false
      playUi('ui_close')
    }
    dismissed = false
  } else if (nearestDist < OPEN_RANGE && !shop.open && !dismissed && !tutorial.active) {
    openShop(nearest)
  }
}

/** Puts the shopkeepers in the shop and runs them (turning, waving, the shop trigger). */
export function setupShop(): void {
  // A buy the server turned down (not enough points, level too low, no wallet): say why in the shop
  onRefused((reason) => {
    if (!shop.open) return
    shop.notice = reason
    shop.noticeUntil = Date.now() + 5000
  })
  SHOP_NPCS.forEach((npc, i) => spawnKeeper(npc, i))
  engine.addSystem(updateKeepers, undefined, 'shop-keepers')
}
