import { engine, Entity, Transform, GltfContainer, AvatarAttach, AvatarAnchorPointType, ColliderLayer, PlayerIdentityData, CameraMode, CameraType, VisibilityComponent } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { itemById, NO_HAT, HatFit, HAT_FIT_DEFAULT, HAT_FIT_LIMITS, cleanHatFit } from './ledger/rules'
import { outfits, profile, sendHatFit } from './ledger/client'

// Pixel Golf hats on the players (the caps, visors and bucket hats in the shop's Hats tab).
//
// A scene can't give anyone a real wearable, so the hat rides the avatar's head bone instead
// (AvatarAttach, AAPT_HEAD). Hats suit this well: the head doesn't bend, so a rigid model sits as
// well as a real wearable would. They were modelled around the Decentraland head with room for
// hair, and each model is already in the head bone's frame, so it needs no offset here.
//
// Each player can move and size their own hat in the backpack's Hat tab; that's saved with their
// profile and everyone sees it the same way.
//
// The models are assets/hats/<style>-<colour>.glb. Everyone's hat comes from the server
// ('outfits'), yours straight from what you have equipped so it changes the moment you pick one.
//
// Notes:
//   - It goes over whatever the player has on their head. Big hair or another hat can poke through.
//   - Only players inside the scene can wear one: it comes off when they leave.
//   - In first person your own hat is hidden on your screen (it would sit over the camera);
//     everyone else still sees it on you.

const DIR = 'assets/hats/'

/**
 * Where my hat sits: set in the backpack's Hat tab (ui/BackpackMenu.tsx), saved on the server and
 * shown to everyone. Starts from what the server saved, once that arrives.
 */
export const myFit: HatFit = { ...HAT_FIT_DEFAULT }
let myFitLoaded = false
let sendIn = -1

/** Nudges my hat (the backpack's buttons) and saves it shortly after the last press */
export function nudgeHat(key: keyof HatFit, by: number): void {
  const [lo, hi] = HAT_FIT_LIMITS[key]
  myFit[key] = Math.round(Math.min(hi, Math.max(lo, myFit[key] + by)) * 1000) / 1000
  myFitLoaded = true
  sendIn = 0.8
  refitMine()
}

/** Back to where the hat sits by default */
export function resetHatFit(): void {
  Object.assign(myFit, HAT_FIT_DEFAULT)
  myFitLoaded = true
  sendIn = 0.8
  refitMine()
}

/** Moves my hat to myFit straight away, so the buttons feel instant */
function refitMine(): void {
  const w = worn.get((getPlayer()?.userId ?? '').toLowerCase())
  if (!w) return
  Transform.createOrReplace(w.model, fitTransform(w.entity, myFit))
  w.fit = fitKey(myFit)
}

/** 'hatId|up,forward,tilt,size' (the server's list) into the hat and its fit */
function parseOutfit(value: string): { hat: string; fit: HatFit } {
  const [hat, f] = value.split('|')
  const n = (f ?? '').split(',').map(Number)
  return { hat, fit: cleanHatFit(n.length === 4 ? { up: n[0], forward: n[1], tilt: n[2], size: n[3] } : undefined) }
}

function fitKey(f: HatFit): string {
  return `${f.up},${f.forward},${f.tilt},${f.size}`
}

/** The model for a hat id ('' for none) */
function modelOf(id: string): string {
  const item = itemById(id)
  if (!item || !item.style || !item.colour) return ''
  return `${DIR}${item.style}-${item.colour}.glb`
}

type Worn = { src: string; fit: string; entity: Entity; model: Entity }
/** Who has a hat on now (wallet, lower case), and which */
const worn = new Map<string, Worn>()

function takeOff(who: string): void {
  const w = worn.get(who)
  if (!w) return
  engine.removeEntity(w.model)
  engine.removeEntity(w.entity)
  worn.delete(who)
}

/** Puts a hat on a player. avatarId: blank for yourself. */
function putOn(who: string, src: string, fit: HatFit, avatarId: string): void {
  takeOff(who)
  // The attached entity follows the head; the model is its child, moved by the player's fit
  const e = engine.addEntity()
  Transform.create(e, {})
  AvatarAttach.create(e, avatarId ? { avatarId, anchorPointId: AvatarAnchorPointType.AAPT_HEAD } : { anchorPointId: AvatarAnchorPointType.AAPT_HEAD })
  const model = engine.addEntity()
  Transform.create(model, fitTransform(e, fit))
  GltfContainer.create(model, { src, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  worn.set(who, { src, fit: fitKey(fit), entity: e, model })
}

function fitTransform(parent: Entity, f: HatFit) {
  return {
    parent,
    position: Vector3.create(0, f.up, f.forward),
    rotation: Quaternion.fromEulerDegrees(-f.tilt, 0, 0),
    scale: Vector3.create(f.size, f.size, f.size)
  }
}

let wait = 0
let myHatHidden = false

/** Hides my own hat while I'm in first person (checked every frame, so it's instant) */
function firstPersonCheck(): void {
  const w = worn.get((getPlayer()?.userId ?? '').toLowerCase())
  const hide = !!w && CameraMode.getOrNull(engine.CameraEntity)?.mode === CameraType.CT_FIRST_PERSON
  if (!w) {
    myHatHidden = false
    return
  }
  if (hide === myHatHidden && VisibilityComponent.has(w.model) === hide) return
  myHatHidden = hide
  if (hide) VisibilityComponent.createOrReplace(w.model, { visible: false })
  else VisibilityComponent.deleteFrom(w.model)
}

export function setupClothes(): void {
  engine.addSystem(firstPersonCheck)
  engine.addSystem((dt) => {
    wait -= dt
    if (wait > 0) return
    wait = 0.3
    const me = (getPlayer()?.userId ?? '').toLowerCase()
    // My saved fit, the first time the server's list has me in it
    if (!myFitLoaded && me && outfits[me]) {
      Object.assign(myFit, parseOutfit(outfits[me]).fit)
      myFitLoaded = true
    }
    // Save my fit a moment after the last nudge (not on every press)
    if (sendIn > 0) {
      sendIn -= 0.3
      if (sendIn <= 0) sendHatFit(myFit)
    }
    const want = new Map<string, { src: string; fit: HatFit; avatarId: string }>()
    // Yours, from what you have equipped and your fit
    if (me) {
      const src = modelOf(profile.equipped.hat || NO_HAT)
      if (src) want.set(me, { src, fit: myFit, avatarId: '' })
    }
    // Everyone else in the scene, from the server's list
    for (const [, id] of engine.getEntitiesWith(PlayerIdentityData)) {
      const who = id.address.toLowerCase()
      if (!who || who === me || !outfits[who]) continue
      const o = parseOutfit(outfits[who])
      const src = modelOf(o.hat)
      if (src) want.set(who, { src, fit: o.fit, avatarId: id.address })
    }
    for (const who of Array.from(worn.keys())) if (!want.has(who)) takeOff(who)
    for (const [who, w] of want) {
      const now = worn.get(who)
      if (!now || now.src !== w.src) putOn(who, w.src, w.fit, w.avatarId)
      else if (now.fit !== fitKey(w.fit)) {
        // Same hat, moved: just move it
        Transform.createOrReplace(now.model, fitTransform(now.entity, w.fit))
        now.fit = fitKey(w.fit)
      }
    }
  })
}
