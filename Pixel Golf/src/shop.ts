import {
  engine,
  Entity,
  Name,
  Transform,
  GltfContainer,
  AvatarShape,
  MeshCollider,
  ColliderLayer,
  InputAction,
  pointerEventsSystem
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3, Color3 } from '@dcl/sdk/math'
import { forTouch } from './mobile'
import { playUi } from './sfx'
import { CosmeticKind } from './ledger/rules'
import { tutorial, onRefused } from './ledger/client'

/**
 * The two shopkeepers. Each stands where one of the placeholder crates is in the scene
 * ("Long Opened Wooden Crate" and its copy), facing the same way, and the crate is hidden.
 * They turn to face you when you come near and wave when you walk up.
 *
 * Walking within OPEN_RANGE of either opens the shop (ui/ShopMenu.tsx) and walking past
 * CLOSE_RANGE closes it. Closing it with the X keeps it shut until you've walked away and come
 * back, or click a shopkeeper. Each shopkeeper opens it on their own aisle (SHOP_NPCS aisle).
 *
 * The first crate (by name) gets SHOP_NPCS[0], the second SHOP_NPCS[1]. Names, looks and
 * greetings are placeholders: change them here. Wearables are Decentraland base-avatar URNs
 * (free, always loadable); any collection wearable URN works too.
 */
export const SHOP_NPCS: ShopNpc[] = [
  {
    name: 'Caddie Cass',
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
    bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseMale',
    wearables: [
      'urn:decentraland:off-chain:base-avatars:casual_hair_01',
      'urn:decentraland:off-chain:base-avatars:blue_tshirt',
      'urn:decentraland:off-chain:base-avatars:brown_pants',
      'urn:decentraland:off-chain:base-avatars:classic_shoes'
    ],
    skinColor: { r: 0.6, g: 0.46, b: 0.36 },
    hairColor: { r: 0.1, g: 0.07, b: 0.05 },
    aisle: 'club',
    greeting: 'Alright! Looking for a new set of clubs?'
  }
]

export type ShopNpc = {
  name: string
  bodyShape: string
  wearables: string[]
  skinColor?: { r: number; g: number; b: number }
  hairColor?: { r: number; g: number; b: number }
  /** Which tab the shop opens on when it's this shopkeeper you walked up to */
  aisle: CosmeticKind
  /** Shown at the top of the shop when they open it */
  greeting: string
}

/** Every entity whose name starts with this is a shopkeeper's spot, in name order. */
const PLACEHOLDER_PREFIX = 'Long Opened Wooden Crate'
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
/** Give up looking for the crates after this long (the scene's entities load with it) */
const FIND_TIMEOUT_SECONDS = 10

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
  if (!shop.open) playUi('ui_open')
  shop.open = true
  shop.aisle = k.npc.aisle
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
  /** Which way the crate faced, so they settle back to it when you walk away */
  homeYaw: number
  yaw: number
  /** Seconds since you were last in look range; a wave is due when you come back after long enough */
  awayFor: number
  waveCount: number
}

const keepers: Keeper[] = []

/** The shopkeepers' avatar ids, so the privacy areas (tutorialVisuals.ts) never hide them */
export const SHOP_NPC_IDS = SHOP_NPCS.map((_, i) => `pixel-golf-shop-${i}`)

/** The world position and turn of an entity, through every parent (crates can sit in groups). */
function worldTransform(e: Entity): { position: Vector3; rotation: Quaternion } | null {
  let t = Transform.getOrNull(e)
  if (!t) return null
  let position = Vector3.clone(t.position)
  let rotation = Quaternion.create(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w)
  let parent = t.parent
  for (let depth = 0; parent !== undefined && parent !== engine.RootEntity && depth < 16; depth++) {
    const p = Transform.getOrNull(parent)
    if (!p) break
    const scaled = Vector3.create(position.x * p.scale.x, position.y * p.scale.y, position.z * p.scale.z)
    position = Vector3.add(p.position, Vector3.rotate(scaled, p.rotation))
    rotation = Quaternion.multiply(p.rotation, rotation)
    parent = p.parent
  }
  return { position, rotation }
}

const squash = (s: string) => s.toLowerCase().replace(/[\s_\-]+/g, '')

function findPlaceholders(): Entity[] {
  const found: { name: string; entity: Entity }[] = []
  for (const [entity, name] of engine.getEntitiesWith(Name)) {
    // Any copy of the crate: capitals, spaces and underscores don't matter ("Long Opened Wooden Crate_2" and so on)
    if (squash(name.value).startsWith(squash(PLACEHOLDER_PREFIX))) found.push({ name: name.value, entity })
  }
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return found.map((f) => f.entity)
}

function spawnKeeper(spot: Entity, npc: ShopNpc, index: number): void {
  const where = worldTransform(spot)
  if (!where) return
  const homeYaw = Quaternion.toEulerAngles(where.rotation).y

  // The crate was only marking the spot
  GltfContainer.deleteFrom(spot)

  const entity = engine.addEntity()
  Transform.create(entity, {
    position: where.position,
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
    const t = Transform.getMutable(k.entity)
    const dx = me.position.x - t.position.x
    const dz = me.position.z - t.position.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    // Face you while you're near, otherwise back to how the crate faced
    const near = dist < LOOK_RANGE
    const target = near ? (Math.atan2(dx, dz) * 180) / Math.PI : k.homeYaw
    const d = angleDelta(k.yaw, target)
    const step = TURN_SPEED * dt
    if (Math.abs(d) > 0.5) {
      k.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step
      t.rotation = Quaternion.fromEulerDegrees(0, k.yaw, 0)
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

/** Finds the placeholder crates (waiting for the scene to load if need be) and puts a shopkeeper on each. */
export function setupShop(): void {
  // A buy the server turned down (not enough points, level too low, no wallet): say why in the shop
  onRefused((reason) => {
    if (!shop.open) return
    shop.notice = reason
    shop.noticeUntil = Date.now() + 5000
  })
  let waited = 0
  let placed = false
  engine.addSystem((dt: number) => {
    if (!placed) {
      waited += dt
      const spots = findPlaceholders()
      if (spots.length >= SHOP_NPCS.length || (spots.length > 0 && waited > 1)) {
        spots.slice(0, SHOP_NPCS.length).forEach((spot, i) => spawnKeeper(spot, SHOP_NPCS[i], i))
        placed = true
        console.log(`[shop] ${keepers.length} shopkeeper(s) placed`)
      } else if (waited > FIND_TIMEOUT_SECONDS) {
        console.log(`[shop] no "${PLACEHOLDER_PREFIX}" in the scene, so no shopkeepers`)
        placed = true
      }
      return
    }
    updateKeepers(dt)
  }, undefined, 'shop-keepers')
}
