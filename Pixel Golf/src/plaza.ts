import {
  engine,
  Entity,
  Transform,
  GltfContainer,
  AvatarShape,
  MeshCollider,
  ColliderLayer,
  pointerEventsSystem,
  InputAction,
  executeTask,
  AudioSource,
  PlayerIdentityData
} from '@dcl/sdk/ecs'
import { MessageBus } from '@dcl/sdk/message-bus'
import { Color3, Quaternion, Vector3 } from '@dcl/sdk/math'
import { movePlayerTo, triggerEmote } from '~system/RestrictedActions'
import { boards, BoardRow } from './ledger/client'
import { Period } from './ledger/rules'

// The plaza by the podium:
//   - the golf cart and its turntable turn slowly, round the turntable's centre. You can get in
//     the cart (it holds still while you're in it) and honk its horn
//   - the top three players stand on the podium
//   - any seat on the sofas and armchairs can be sat on
//
// The models (Golf Cart Turnstile.glb, Golf Cart.glb, Podiums.glb, Chairs.glb) are placed in the
// Creator Hub under Environment at its origin, with their positions built into the models
// themselves. The positions below were read from the models' geometry (a model's x appears
// mirrored in the scene: scene x = Environment x - model x).

// ---------------------------------------------------------------------------
// Turntable
// ---------------------------------------------------------------------------

const TURNTABLE = 'Golf Cart Turnstile.glb'
const CART = 'Golf Cart.glb'
/** The turntable's centre, inside Environment (the cart sits on it, within a few centimetres) */
const TURNTABLE_CENTRE = Vector3.create(-243.62, 0, 71.04)
/** The same point in scene coordinates (Environment sits at 320, 3, 250) */
const TURNTABLE_SCENE = Vector3.create(76.38, 3, 321.04)
/** Degrees a second: a full turn every 40 seconds */
const TURN_SPEED = 9
/** After it's been held still, it turns this many times faster until it's back in step */
const CATCH_UP = 3

// The cart, measured from Golf Cart.glb. "Along" is towards the cart's front, "across" to its side,
// both in metres from the turntable's centre; heights are scene heights. The cart faces diagonally
// across the turntable: at the turntable's starting angle its front points at +x / -z.
const CART_FORWARD = { x: 0.7071, z: -0.7071 }
const CART_ACROSS = { x: -0.7071, z: -0.7071 }
/** The cart faces this way (degrees, 0 = +z) at the turntable's starting angle */
const CART_YAW = 135
/** The cart's floor, which the driver stands on to sit (the bench is 0.4 m above it) */
const CART_FLOOR_Y = 35.3
/** Where the driver's feet go: just in front of the bench, under the steering wheel (fine-tune here) */
const DRIVER_ALONG = 0.065
/** The steering wheel's middle (it's in the middle of the cart) */
const WHEEL_ALONG = 0.27
const WHEEL_Y = 36.2
/** Moving this far from the driver's spot counts as getting out */
const LEAVE_DISTANCE = 0.35
/** Anyone within this of the driver's spot counts as in the cart, and the turntable holds still */
const OCCUPIED_DISTANCE = 0.5
/** Seconds between honks, so the horn can't be machine-gunned */
const HONK_GAP = 0.7
const HORN_SOUND = 'assets/sounds/horn.mp3'

/** A point on the cart, as turntable coordinates (relative to its centre, turning with it) */
function onCart(along: number, across: number, y: number): Vector3 {
  return Vector3.create(
    along * CART_FORWARD.x + across * CART_ACROSS.x,
    y - TURNTABLE_SCENE.y,
    along * CART_FORWARD.z + across * CART_ACROSS.z
  )
}

/** The turntable's angle right now, the same on everyone's screen: it's worked out from the clock */
function clockYaw(): number {
  return ((Date.now() / 1000) * TURN_SPEED) % 360
}

function setupTurntable(): void {
  const turntable = engine.getEntityOrNullByName(TURNTABLE)
  const cart = engine.getEntityOrNullByName(CART)
  const models = [turntable, cart].filter((e): e is Entity => !!e)
  if (!models.length) {
    console.log('[plaza] no turntable or cart in the scene')
    return
  }
  // A pivot at the turntable's centre, in the models' parent. The models hang off it, moved back
  // by the same amount, so they stay exactly where they were and turn round the centre.
  const parent = Transform.get(models[0]).parent
  const pivot = engine.addEntity()
  Transform.create(pivot, { parent, position: TURNTABLE_CENTRE })
  for (const m of models) {
    const t = Transform.getMutable(m)
    t.parent = pivot
    t.position = Vector3.subtract(t.position, TURNTABLE_CENTRE)
  }
  // An invisible floor in the cart to sit on (the cart's own collision is one solid box)
  const floor = engine.addEntity()
  Transform.create(floor, {
    parent: pivot,
    position: onCart(0.1, 0, CART_FLOOR_Y - 0.1),
    rotation: Quaternion.fromEulerDegrees(0, CART_YAW - 90, 0),
    scale: Vector3.create(0.8, 0.2, 0.9)
  })
  MeshCollider.setBox(floor, ColliderLayer.CL_PHYSICS)

  // Click the bench to get in; click the steering wheel to honk
  const seatBox = engine.addEntity()
  Transform.create(seatBox, {
    parent: pivot,
    position: onCart(-0.5, 0, CART_FLOOR_Y + 0.8),
    rotation: Quaternion.fromEulerDegrees(0, CART_YAW - 90, 0),
    scale: Vector3.create(0.95, 1.6, 1.4)
  })
  MeshCollider.setBox(seatBox, ColliderLayer.CL_POINTER)
  const wheel = engine.addEntity()
  Transform.create(wheel, {
    parent: pivot,
    position: onCart(WHEEL_ALONG, 0, WHEEL_Y),
    rotation: Quaternion.fromEulerDegrees(0, CART_YAW - 90, 0),
    scale: Vector3.create(0.4, 0.4, 0.6)
  })
  MeshCollider.setBox(wheel, ColliderLayer.CL_POINTER)

  // The horn: heard by everyone nearby, from the cart. Sent player to player, not via the server.
  const horn = engine.addEntity()
  Transform.create(horn, { parent: pivot, position: onCart(WHEEL_ALONG, 0, WHEEL_Y) })
  const bus = new MessageBus()
  bus.on('pg-honk', () => {
    AudioSource.createOrReplace(horn, {
      audioClipUrl: HORN_SOUND,
      playing: true,
      loop: false,
      global: false,
      volume: 1,
      currentTime: 0
    })
  })
  let lastHonk = 0
  pointerEventsSystem.onPointerDown(
    { entity: wheel, opts: { button: InputAction.IA_POINTER, hoverText: 'Honk', maxDistance: 5 } },
    () => {
      const now = Date.now()
      if (now - lastHonk < HONK_GAP * 1000) return
      lastHonk = now
      bus.emit('pg-honk', {})
    }
  )

  // The turntable: in step with the clock, held still while anyone's in the driver's seat, and
  // turning a little faster afterwards until it's back in step
  let yaw = clockYaw()
  let seated: { x: number; z: number } | null = null
  let settle = 0
  const driverSpot = () => {
    const local = onCart(DRIVER_ALONG, 0, CART_FLOOR_Y)
    const r = Vector3.rotate(Vector3.create(local.x, 0, local.z), Quaternion.fromEulerDegrees(0, yaw, 0))
    return Vector3.create(TURNTABLE_SCENE.x + r.x, CART_FLOOR_Y, TURNTABLE_SCENE.z + r.z)
  }
  const occupied = () => {
    if (seated) return true
    const spot = driverSpot()
    for (const [, , t] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
      const p = t.position
      if (Math.abs(p.y - spot.y) < 1.2 && Math.hypot(p.x - spot.x, p.z - spot.z) < OCCUPIED_DISTANCE) return true
    }
    return false
  }
  // The cart's collision is one box round the whole cabin. It only stops people walking through:
  // left on for clicks too, it caught them before they reached the seat and the steering wheel.
  const setCartCollision = (on: boolean) => {
    if (!cart || !GltfContainer.has(cart)) return
    GltfContainer.getMutable(cart).invisibleMeshesCollisionMask = on ? ColliderLayer.CL_PHYSICS : ColliderLayer.CL_NONE
  }
  setCartCollision(true)

  pointerEventsSystem.onPointerDown(
    {
      entity: seatBox,
      opts: { button: InputAction.IA_POINTER, hoverText: 'Click to enter golf cart', maxDistance: 5 }
    },
    () => {
      if (seated) return
      const spot = driverSpot()
      seated = { x: spot.x, z: spot.z }
      settle = 0
      // The cart's solid box would keep you out: off on your screen while you're in it
      setCartCollision(false)
      const face = ((CART_YAW + yaw) * Math.PI) / 180
      const ahead = Vector3.create(spot.x + Math.sin(face) * 3, spot.y + 1, spot.z + Math.cos(face) * 3)
      executeTask(async () => {
        await movePlayerTo({ newRelativePosition: spot, avatarTarget: ahead, cameraTarget: ahead })
        await triggerEmote({ predefinedEmote: 'sittingChair1' })
      })
    }
  )

  engine.addSystem((dt) => {
    // Getting out: once you've moved off the seat, the cart is solid again
    if (seated) {
      settle += dt
      const p = Transform.getOrNull(engine.PlayerEntity)?.position
      if (settle > 1 && p && Math.hypot(p.x - seated.x, p.z - seated.z) > LEAVE_DISTANCE) {
        seated = null
        setCartCollision(true)
      }
    }
    if (!occupied()) {
      const behind = (clockYaw() - yaw + 360) % 360
      yaw = behind < 0.5 ? clockYaw() : (yaw + Math.min(behind, TURN_SPEED * CATCH_UP * dt)) % 360
    }
    Transform.getMutable(pivot).rotation = Quaternion.fromEulerDegrees(0, yaw, 0)
  })
}

// ---------------------------------------------------------------------------
// Podium: the top three players
// ---------------------------------------------------------------------------

/** Which board the podium shows: the same one the Leaderboards menu opens on */
const PODIUM_PERIOD: Period = 'day'
const PODIUM_BOARD: 'true' | 'multi' = 'true'
/** The tops of the three steps (scene coordinates): 1st, 2nd, 3rd */
const PODIUM_SPOTS = [
  Vector3.create(65.06, 35.81, 332.35),
  Vector3.create(63.46, 35.59, 330.76),
  Vector3.create(66.65, 35.29, 333.94)
]
/** They face out across the plaza */
const PODIUM_YAW = 135
const CATALYST_PROFILE = 'https://peer.decentraland.org/lambdas/profile/'

type Look = { bodyShape?: string; wearables: string[]; skinColor?: Color3; hairColor?: Color3; eyeColor?: Color3 }
const looks: Record<string, Look | null> = {}

function colour(c: any): Color3 | undefined {
  return c && typeof c.r === 'number' ? Color3.create(c.r, c.g, c.b) : undefined
}

async function fetchLook(address: string): Promise<Look | null> {
  try {
    const res = await fetch(CATALYST_PROFILE + address)
    if (!res.ok) return null
    const json: any = await res.json()
    const a = json?.avatars?.[0]?.avatar
    if (!a) return null
    return {
      bodyShape: a.bodyShape,
      wearables: Array.isArray(a.wearables) ? a.wearables : [],
      skinColor: colour(a.skin?.color),
      hairColor: colour(a.hair?.color),
      eyeColor: colour(a.eyes?.color)
    }
  } catch (e) {
    console.log('[plaza] could not load the avatar for', address, e)
    return null
  }
}

function setupPodium(): void {
  const stands = PODIUM_SPOTS.map((p) => {
    const e = engine.addEntity()
    Transform.create(e, { position: p, rotation: Quaternion.fromEulerDegrees(0, PODIUM_YAW, 0) })
    return e
  })
  const shown: string[] = ['', '', '']

  const show = (i: number, row: BoardRow | undefined) => {
    const who = row ? row.u.toLowerCase() : ''
    const key = row ? who + '|' + row.n : ''
    if (shown[i] === key) return
    shown[i] = key
    if (!row) {
      AvatarShape.deleteFrom(stands[i])
      return
    }
    const dress = (look: Look | null) => {
      if (shown[i] !== key) return // the board changed while it loaded
      AvatarShape.createOrReplace(stands[i], {
        // 4 spaces on the end hide the grey wallet suffix after the name on the nametag
        id: who + '    ',
        name: row.n,
        bodyShape: look?.bodyShape,
        wearables: look?.wearables ?? [],
        emotes: [],
        skinColor: look?.skinColor,
        hairColor: look?.hairColor,
        eyeColor: look?.eyeColor
      })
    }
    if (who in looks) dress(looks[who])
    else
      executeTask(async () => {
        const look = await fetchLook(who)
        looks[who] = look
        dress(look)
      })
  }

  let wait = 0
  engine.addSystem((dt) => {
    wait -= dt
    if (wait > 0) return
    wait = 1
    if (!boards.ready) return
    const table = boards.tables[PODIUM_PERIOD]
    const rows = table ? table[PODIUM_BOARD] : []
    for (let i = 0; i < 3; i++) show(i, rows[i])
  })
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

const CHAIRS = 'Chairs.glb'
/**
 * Every seat on the sofas (three each) and the two armchairs: where the player's feet go, on the
 * floor in front of the cushion's middle, and which way they face (degrees, 0 = +z).
 */
const SEATS: { x: number; y: number; z: number; yaw: number }[] = [
  { x: 66.41, y: 34.46, z: 191.15, yaw: 270 },
  { x: 69.24, y: 34.46, z: 191.15, yaw: 90 },
  { x: 66.41, y: 34.46, z: 191.98, yaw: 270 },
  { x: 69.24, y: 34.46, z: 191.98, yaw: 90 },
  { x: 66.41, y: 34.46, z: 192.81, yaw: 270 },
  { x: 69.24, y: 34.46, z: 192.81, yaw: 90 },
  { x: 66.41, y: 34.46, z: 199.15, yaw: 270 },
  { x: 69.24, y: 34.46, z: 199.15, yaw: 90 },
  { x: 66.41, y: 34.46, z: 199.98, yaw: 270 },
  { x: 69.24, y: 34.46, z: 199.98, yaw: 90 },
  { x: 66.41, y: 34.46, z: 200.81, yaw: 270 },
  { x: 69.24, y: 34.46, z: 200.81, yaw: 90 },
  { x: 66.41, y: 34.46, z: 207.15, yaw: 270 },
  { x: 69.24, y: 34.46, z: 207.15, yaw: 90 },
  { x: 66.41, y: 34.46, z: 207.98, yaw: 270 },
  { x: 69.24, y: 34.46, z: 207.98, yaw: 90 },
  { x: 66.41, y: 34.46, z: 208.81, yaw: 270 },
  { x: 69.24, y: 34.46, z: 208.81, yaw: 90 },
  { x: 60.18, y: 34.46, z: 291.32, yaw: 0 },
  { x: 58.23, y: 34.46, z: 293.04, yaw: 90 },
  { x: 58.23, y: 34.46, z: 293.87, yaw: 90 },
  { x: 58.23, y: 34.46, z: 294.7, yaw: 90 },
  { x: 60.18, y: 34.46, z: 296.48, yaw: 180 },
  { x: 58.18, y: 34.41, z: 308.33, yaw: 90 },
  { x: 58.18, y: 34.41, z: 309.16, yaw: 90 },
  { x: 58.18, y: 34.41, z: 309.99, yaw: 90 },
  { x: 58.19, y: 34.41, z: 312.83, yaw: 90 },
  { x: 58.19, y: 34.41, z: 313.66, yaw: 90 },
  { x: 58.19, y: 34.41, z: 314.49, yaw: 90 },
  { x: 66.44, y: 34.41, z: 315.81, yaw: 186 },
  { x: 65.61, y: 34.41, z: 315.89, yaw: 186 },
  { x: 64.79, y: 34.41, z: 315.97, yaw: 186 },
  { x: 61.96, y: 34.41, z: 316.25, yaw: 186 },
  { x: 61.13, y: 34.41, z: 316.33, yaw: 186 },
  { x: 60.31, y: 34.41, z: 316.41, yaw: 186 },
  { x: 81.46, y: 34.46, z: 331.92, yaw: 85 },
  { x: 81.38, y: 34.46, z: 332.75, yaw: 85 },
  { x: 81.3, y: 34.46, z: 333.57, yaw: 85 },
  { x: 81.03, y: 34.46, z: 336.4, yaw: 85 },
  { x: 80.95, y: 34.46, z: 337.23, yaw: 85 },
  { x: 80.87, y: 34.46, z: 338.05, yaw: 85 }
]
/**
 * Fine-tuning for the sitting pose, in metres, for every seat: how far forward of the seat point
 * the player is placed (towards the front edge of the cushion), and how far below the floor.
 * Bigger SEAT_FORWARD sits further forward; bigger SEAT_DROP sits lower.
 */
const SEAT_FORWARD = 0.7
const SEAT_DROP = 0.4
/** How far the player can be from a seat to sit on it (metres) */
const SIT_REACH = 5
/** Moving this far from the seat counts as getting up */
const STAND_DISTANCE = 0.35

function setupSeats(): void {
  const chairs = engine.getEntityOrNullByName(CHAIRS)
  // While you sit, the sofas' own collision is off on your screen only: otherwise you'd stand on
  // the cushion and the sitting pose would float you above it. Back on as soon as you get up.
  let collisionBefore: number | undefined
  let seated: { x: number; z: number } | null = null
  let settle = 0

  const setSofaCollision = (on: boolean) => {
    if (!chairs || !GltfContainer.has(chairs)) return
    const g = GltfContainer.getMutable(chairs)
    if (!on) {
      collisionBefore = g.invisibleMeshesCollisionMask
      g.invisibleMeshesCollisionMask = ColliderLayer.CL_NONE
    } else g.invisibleMeshesCollisionMask = collisionBefore
  }

  const sit = (s: { x: number; y: number; z: number; yaw: number }) => {
    if (seated) return
    const fx = Math.sin((s.yaw * Math.PI) / 180)
    const fz = Math.cos((s.yaw * Math.PI) / 180)
    const x = s.x + fx * SEAT_FORWARD
    const z = s.z + fz * SEAT_FORWARD
    const y = s.y - SEAT_DROP
    seated = { x, z }
    settle = 0
    setSofaCollision(false)
    executeTask(async () => {
      await movePlayerTo({
        newRelativePosition: Vector3.create(x, y, z),
        avatarTarget: Vector3.create(x + fx * 3, y + 1, z + fz * 3),
        cameraTarget: Vector3.create(x + fx * 3, y + 1, z + fz * 3)
      })
      // Loops on its own until the player moves
      await triggerEmote({ predefinedEmote: 'sittingChair1' })
    })
  }

  for (const s of SEATS) {
    // An invisible box over the cushion to click (pointer only: nothing bumps into it)
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(s.x, s.y + 0.6, s.z), scale: Vector3.create(0.75, 0.5, 0.75) })
    MeshCollider.setBox(e, ColliderLayer.CL_POINTER)
    pointerEventsSystem.onPointerDown(
      { entity: e, opts: { button: InputAction.IA_POINTER, hoverText: 'Sit', maxDistance: SIT_REACH } },
      () => sit(s)
    )
  }

  // Getting up: once the player has moved off the seat, the sofas are solid again
  engine.addSystem((dt) => {
    if (!seated) return
    // Give the move a moment to land before checking
    settle += dt
    if (settle < 1) return
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (!p) return
    if (Math.hypot(p.x - seated.x, p.z - seated.z) > STAND_DISTANCE) {
      seated = null
      settle = 0
      setSofaCollision(true)
    }
  })
}

export function setupPlaza(): void {
  setupTurntable()
  setupPodium()
  setupSeats()
}
