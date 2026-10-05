import {
  AvatarAnchorPointType,
  AvatarAttach,
  AvatarMask,
  engine,
  Entity,
  GltfContainer,
  ColliderLayer,
  Transform,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { stopEmote, triggerEmote, triggerSceneEmote } from '~system/RestrictedActions'
import { ghostShot } from './index'

/**
 * Carried in the hand, addressed off the player, and on the strike the
 * avatar's swing emote plays with the club back in the fist riding along.
 *
 *   handAnchor / playAnchor   the two places the club can hang from
 *   grip                      re-parented between them; how the club is held
 *   pivot                     all swing rotation, about the grip
 *   model                     the .glb and its model-space correction
 */

export const CLUB = {
  /** 'hand' carries it in the right hand while walking; 'player' uses the fixed carry pose below. */
  carryAnchor: 'hand' as 'hand' | 'player',

  /**
   * How the club sits in the right hand while carried: hanging down out of the
   * fist along the fingers.
   */
  gripOffset: { x: 0.02, y: -0.02, z: 0.06 },
  gripRotation: { x: 180, y: 180, z: 0 },
  scale: 1,

  /**
   * How the club sits in the right hand during the swing animations. Measured
   * from the Golf Drive animation: the club runs through both palms, butt just
   * above the left hand, face square to the target at impact. It's a driver
   * swing, so the iron is scaled up to reach the ball (about 1.4m long).
   * Set swingGrip to null to keep the carry grip for the swing too.
   */
  swingGrip: {
    offset: { x: 0.131, y: 0.042, z: -0.078 },
    rotation: { x: -0.4789, y: -0.2299, z: -0.5772, w: 0.6202 },
    scale: 1.45
  } as { offset: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number }; scale: number } | null,

  /** Where the club sits relative to the player, carried and at address. */
  carry: { position: { x: 0.3, y: 0.95, z: -0.05 }, tilt: 22, yaw: -18 },
  address: { position: { x: 0.16, y: 1.02, z: 0.26 }, tilt: 4, yaw: 0 },

  /** Flip if the backswing draws forwards instead of back. */
  swingSign: 1,

  /**
   * Emote fired on the avatar at the strike, so the body actually swings rather
   * than the club moving on its own beside a statue. 'swingWeaponTwoHands' is a
   * bigger, wilder swing. 'none' falls back to the club arc with the body still.
   */
  emote: 'swingWeaponOneHand' as 'swingWeaponOneHand' | 'swingWeaponTwoHands' | 'none',

  /**
   * Upper body only would keep the legs out of it. Off: the golf swing turns the
   * whole body side-on to the ball and pivots the hips, so it needs the legs.
   */
  emoteUpperBodyOnly: false,

  /**
   * Keep the club in the hand while setting power and curve, rather than moving
   * it to the fixed address point in front of the player as Mini Golf did.
   * In the hand it stays connected to the avatar the whole time.
   */
  addressInHand: true,

  /**
   * Custom avatar animations (scene emotes) for a proper golf swing, built on
   * the Decentraland avatar rig. A scene cannot pose the avatar's arms itself,
   * so the swing has to come from these. Each file must end in _emote.glb. Set a
   * path to '' to skip that slot; an empty swingEmote falls back to the
   * built-in `emote` above.
   *
   * The animations turn the avatar 90 degrees to its right to stand side-on to
   * the ball, so the player is first moved into a stance beside the ball,
   * facing the target (see stance below).
   *
   *   takeBackEmote  plays once on the first E press: address up to the top of the backswing
   *   topHoldEmote   then loops, holding the top, while power and curve are set
   *   swingEmote     plays on the third press: top of the backswing, down through the ball, follow-through
   */
  // Built from the Golf Drive (Mixamo) animation, retargeted onto the Decentraland avatar
  takeBackEmote: 'assets/Emotes/Golf_TakeBack_emote.glb', // 1.3s: idle, blend to address, take the club back to the top
  topHoldEmote: 'assets/Emotes/Golf_TopHold_emote.glb', //   2.0s loop: held at the top with a slight settle
  swingEmote: 'assets/Emotes/Golf_Swing_emote.glb', //       1.8s: downswing, impact at 0.3s, follow-through, finish, back to idle
  /** When the hold loop takes over from the take-back (the take-back clip is 1.3s, so this overlaps slightly). */
  takeBackSeconds: 1.25,

  /**
   * Where the player stands for the shot, relative to the ball, so the club
   * meets the ball once the animation turns them side-on. Metres: the ball ends
   * up this far to the player's right and this far ahead of them.
   */
  stance: { right: 1.11, ahead: -0.37 },
  /** Seconds after moving into the stance before the take-back starts. */
  stanceSettle: 0.15,

  /** Seconds between the third E press and the swing emote firing. */
  emoteDelay: 0.1,

  /**
   * Seconds after the swing emote fires before the ball leaves: the swing
   * animation reaches the ball at frame 9 of 30fps.
   */
  strikeDelay: 9 / 30,

  /** Seconds after the swing emote fires that the camera stays on the player, so the swing can be seen. */
  watchSwingTime: 1.4,

  /**
   * Seconds after the swing emote fires to stop it. The clip is 1.8s and ends
   * back at idle; stopping it just before the end stops the client replaying
   * the swing or falling back to the looping top-of-backswing hold.
   */
  swingEmoteSeconds: 1.75,

  /** The swing, in degrees about the grip. The backswing follows the power meter. */
  backswingBase: 14,
  backswingRange: 62,
  throughBase: -20,
  throughRange: -40,

  /** Seconds. Sharp down through the ball, longer float back to address. */
  downswingTime: 0.16,
  followTime: 0.28,
  recoverTime: 0.5
}

export type ClubType = 'wedge' | 'iron' | 'driver'

/**
 * The clubs the player can pick from (see clubSelect.ts and clubRack.ts).
 *
 *   model        the .glb carried in the hand and shown on the rack
 *   launchPower  the strike's base power, used by the physics bridge in index.ts
 *   scaleMul     multiplies the grip scale, carried and swinging. 1 = same size as the iron.
 *                The swing animation is fixed, so if a club falls short of the ball or
 *                overshoots it at impact, nudge this (e.g. shorter wedge -> a bit above 1).
 */
export const CLUB_TYPES: Record<ClubType, { label: string; model: string; launchPower: number; scaleMul: number, ghostSize: number }> = {
  wedge:  { label: 'Wedge',   model: 'assets/Models/Golf_Wedge/Golf_Wedge.glb',   launchPower: 75,  scaleMul: 1, ghostSize: 60 },
  iron:   { label: 'Iron',    model: 'assets/Models/Golf_Iron/Golf_Iron.glb',     launchPower: 125, scaleMul: 1, ghostSize: 115 },
  driver: { label: 'Driver',  model: 'assets/Models/Golf_Driver/Golf_Driver.glb', launchPower: 175, scaleMul: 1, ghostSize: 150 }
}

const v3 = (p: { x: number; y: number; z: number }) => Vector3.create(p.x, p.y, p.z)

export type Club = {
  handAnchor: Entity
  playAnchor: Entity
  grip: Entity
  pivot: Entity
  model: Entity
  /** Which club is being carried (see CLUB_TYPES). */
  type: ClubType
  /** Which anchor the grip is currently parented to. */
  held: 'hand' | 'play'
  strikeTimer: number
  strikePower: number
  /** Angle the club was at when the strike began, so the downswing starts there. */
  strikeFrom: number
  /** True while the avatar's own emote is driving the swing. */
  emoting: boolean
  visible: boolean
  /** Seconds since the take-back started, or -1 when no backswing is playing. */
  backswingTimer: number
  /** True once the top-of-backswing hold loop has started. */
  holding: boolean
  /** True while the grip is in its swing position (see CLUB.swingGrip). */
  swingGripOn: boolean
}

/** Grip scale for the carried club: carry or swing scale, times the club's own multiplier. */
function gripScale(club: Club): number {
  const base = club.swingGripOn && CLUB.swingGrip ? CLUB.swingGrip.scale : CLUB.scale
  return base * CLUB_TYPES[club.type].scaleMul
}

const STRIKE_TIME = CLUB.downswingTime + CLUB.followTime + CLUB.recoverTime

const HAND_GRIP_POS = v3(CLUB.gripOffset)
const HAND_GRIP_ROT = Quaternion.fromEulerDegrees(CLUB.gripRotation.x, CLUB.gripRotation.y, CLUB.gripRotation.z)
const PLAY_GRIP_POS = Vector3.Zero()
const PLAY_GRIP_ROT = Quaternion.fromEulerDegrees(CLUB.address.tilt, CLUB.address.yaw, 0)

export function createClub(type: ClubType = 'iron'): Club {
  // Hand anchor. No avatarId: attaches to the local player.
  const handAnchor = engine.addEntity()
  if (CLUB.carryAnchor === 'hand') {
    AvatarAttach.create(handAnchor, { anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })
  } else {
    Transform.create(handAnchor, {
      position: v3(CLUB.carry.position),
      rotation: Quaternion.fromEulerDegrees(CLUB.carry.tilt, CLUB.carry.yaw, 0),
      parent: engine.PlayerEntity
    })
  }

  // Player anchor, out in front at address height.
  const playAnchor = engine.addEntity()
  Transform.create(playAnchor, {
    position: v3(CLUB.address.position),
    parent: engine.PlayerEntity
  })

  const grip = engine.addEntity()
  Transform.create(grip, {
    position: CLUB.carryAnchor === 'hand' ? HAND_GRIP_POS : PLAY_GRIP_POS,
    rotation: CLUB.carryAnchor === 'hand' ? HAND_GRIP_ROT : PLAY_GRIP_ROT,
    scale: Vector3.create(CLUB.scale * CLUB_TYPES[type].scaleMul, CLUB.scale * CLUB_TYPES[type].scaleMul, CLUB.scale * CLUB_TYPES[type].scaleMul),
    parent: handAnchor
  })

  const pivot = engine.addEntity()
  Transform.create(pivot, { parent: grip })

  const model = engine.addEntity()
  Transform.create(model, {
    // The .glb models the face on -Z with the head extending along +X, so it
    // gets turned to face the way the player is looking.
    rotation: Quaternion.fromEulerDegrees(0, 180, 0),
    parent: pivot
  })
  GltfContainer.create(model, {
    src: CLUB_TYPES[type].model,
    // Purely visual: don't block the player, the pointer or the ball
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  // Created visible: a GltfContainer created hidden does not reliably come back.
  // setClubVisible() hides it afterwards.
  VisibilityComponent.create(model, { visible: true })

  return {
    handAnchor,
    playAnchor,
    grip,
    pivot,
    model,
    type,
    held: 'hand',
    strikeTimer: 0,
    strikePower: 0,
    strikeFrom: 0,
    emoting: false,
    visible: true,
    backswingTimer: -1,
    holding: false,
    swingGripOn: false
  }
}

export function setClubVisible(club: Club, visible: boolean): void {
  if (club.visible === visible) return
  club.visible = visible
  const v = VisibilityComponent.getMutableOrNull(club.model)
  if (v) v.visible = visible
}

/** Swaps the carried club to another model. Selection is locked mid-shot, so this runs between shots. */
export function applyClubType(club: Club, type: ClubType): void {
  if (club.type === type) return
  club.type = type
  const gltf = GltfContainer.getMutableOrNull(club.model)
  if (gltf) gltf.src = CLUB_TYPES[type].model
  // Clubs differ in length, so the grip scale follows the club
  const t = Transform.getMutableOrNull(club.grip)
  if (t) {
    const sc = gripScale(club)
    t.scale = Vector3.create(sc, sc, sc)
  }
  // Update Ghost Size
  if(!ghostShot) return
  let ghostTrans = Transform.getMutable(ghostShot)
  let ghostScale = CLUB_TYPES[type].ghostSize
  ghostTrans.scale = Vector3.create(ghostScale, ghostScale, ghostScale)
}

/** In the hand: the carry grip normally, the swing grip while a swing animation plays. */
function applyHandGrip(club: Club, swinging: boolean): void {
  if (club.held !== 'hand' || CLUB.carryAnchor !== 'hand') return
  const g = swinging ? CLUB.swingGrip : null
  if (club.swingGripOn === !!g) return
  club.swingGripOn = !!g
  const t = Transform.getMutableOrNull(club.grip)
  if (!t) return
  if (g) {
    t.position = Vector3.create(g.offset.x, g.offset.y, g.offset.z)
    t.rotation = Quaternion.create(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w)
    const sc = gripScale(club)
    t.scale = Vector3.create(sc, sc, sc)
  } else {
    t.position = Vector3.create(HAND_GRIP_POS.x, HAND_GRIP_POS.y, HAND_GRIP_POS.z)
    t.rotation = Quaternion.create(HAND_GRIP_ROT.x, HAND_GRIP_ROT.y, HAND_GRIP_ROT.z, HAND_GRIP_ROT.w)
    const sc = gripScale(club)
    t.scale = Vector3.create(sc, sc, sc)
  }
}

/** Moves the club between the hand and the address position. */
function hold(club: Club, where: 'hand' | 'play'): void {
  if (club.held === where) return
  club.held = where

  const t = Transform.getMutableOrNull(club.grip)
  if (!t) return

  const toHand = where === 'hand'
  t.parent = toHand ? club.handAnchor : club.playAnchor
  club.swingGripOn = false
  const sc = gripScale(club)
  t.scale = Vector3.create(sc, sc, sc)

  // The carried grip offset only applies to the hand bone; on the player anchor
  // the address pose is already baked into the anchor's own position.
  const useHandPose = toHand && CLUB.carryAnchor === 'hand'
  const pos = useHandPose ? HAND_GRIP_POS : PLAY_GRIP_POS
  const rot = useHandPose
    ? HAND_GRIP_ROT
    : toHand
    ? Quaternion.fromEulerDegrees(CLUB.carry.tilt, CLUB.carry.yaw, 0)
    : PLAY_GRIP_ROT

  t.position = Vector3.create(pos.x, pos.y, pos.z)
  t.rotation = Quaternion.create(rot.x, rot.y, rot.z, rot.w)
}

/**
 * Called on the third E press. With an emote configured, the avatar swings and
 * the club rides its hand through the motion. With emotes off it falls back to
 * the club arc: downswing, contact, follow-through, back to address.
 */
export function playStrike(club: Club, power: number): void {
  // The custom swing runs for its own length; the built-in emote uses the club arc timing
  club.strikeTimer = CLUB.swingEmote ? CLUB.swingEmoteSeconds : STRIKE_TIME
  club.strikePower = Math.max(0.2, power)
  club.strikeFrom = backswingAngle(club.strikePower)

  club.backswingTimer = -1 // the swing replaces any backswing still playing
  const mask = CLUB.emoteUpperBodyOnly ? { mask: AvatarMask.AM_UPPER_BODY } : {}

  if (CLUB.swingEmote) {
    club.emoting = true
    void triggerSceneEmote({ src: CLUB.swingEmote, loop: false, ...mask })
  } else if (CLUB.emote !== 'none') {
    club.emoting = true
    void triggerEmote({ predefinedEmote: CLUB.emote, ...mask })
  }
}

/** Called on the first E press: take the club back, then hold at the top. */
export function startBackswing(club: Club): void {
  if (!CLUB.takeBackEmote && !CLUB.topHoldEmote) return
  club.backswingTimer = 0
  club.holding = false
  const mask = CLUB.emoteUpperBodyOnly ? { mask: AvatarMask.AM_UPPER_BODY } : {}
  if (CLUB.takeBackEmote) void triggerSceneEmote({ src: CLUB.takeBackEmote, loop: false, ...mask })
  else startHold(club)
}

function startHold(club: Club): void {
  club.holding = true
  if (!CLUB.topHoldEmote) return
  const mask = CLUB.emoteUpperBodyOnly ? { mask: AvatarMask.AM_UPPER_BODY } : {}
  void triggerSceneEmote({ src: CLUB.topHoldEmote, loop: true, ...mask })
}

/** Called if the shot is abandoned before the swing, so the avatar doesn't stay frozen at the top. */
export function cancelBackswing(club: Club): void {
  if (club.backswingTimer < 0) return
  club.backswingTimer = -1
  void stopEmote({})
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Slow at the ends, quick through the middle. */
const smooth = (t: number) => t * t * (3 - 2 * t)

function backswingAngle(charge: number): number {
  return charge * (CLUB.backswingBase + charge * CLUB.backswingRange)
}

/**
 * `charge` is 0..1 and drives the backswing, so the club is literally showing
 * how hard the shot is going to be hit.
 */
export function updateClub(club: Club, dt: number, addressing: boolean, charge: number): void {
  // While the avatar is emoting, the club belongs in the fist so it travels
  // with the arm. Otherwise stay on the swinging anchor until the
  // follow-through has finished, so the club does not snap away mid-strike.
  // Take-back, then hand over to the hold loop at the top
  if (club.backswingTimer >= 0) {
    club.backswingTimer += dt
    if (!club.holding && club.backswingTimer >= CLUB.takeBackSeconds) startHold(club)
  }

  if (CLUB.addressInHand) addressing = false
  const onPlayAnchor = club.emoting ? addressing : addressing || club.strikeTimer > 0
  hold(club, onPlayAnchor ? 'play' : 'hand')
  applyHandGrip(club, club.backswingTimer >= 0 || club.emoting)

  let swingDeg: number
  if (club.emoting) {
    // The emote owns the motion. Relax the club back to neutral in the fist.
    club.strikeTimer = Math.max(0, club.strikeTimer - dt)
    if (club.strikeTimer === 0) {
      club.emoting = false
      // Finished: stop the emote so it doesn't loop, and the avatar returns to idle
      if (CLUB.swingEmote) void stopEmote({})
    }
    swingDeg = 0
  } else if (club.strikeTimer > 0) {
    club.strikeTimer = Math.max(0, club.strikeTimer - dt)
    const elapsed = STRIKE_TIME - club.strikeTimer
    const through = CLUB.throughBase + club.strikePower * CLUB.throughRange

    if (elapsed < CLUB.downswingTime) {
      // Accelerating down out of the top of the backswing into the ball.
      const k = elapsed / CLUB.downswingTime
      swingDeg = lerp(club.strikeFrom, through, k * k)
    } else if (elapsed < CLUB.downswingTime + CLUB.followTime) {
      // Carrying on past the ball, slowing as it goes.
      const k = (elapsed - CLUB.downswingTime) / CLUB.followTime
      swingDeg = lerp(through, through * 1.2, smooth(k))
    } else {
      // Floating back to address.
      const k = Math.min(1, (elapsed - CLUB.downswingTime - CLUB.followTime) / CLUB.recoverTime)
      swingDeg = lerp(through * 1.2, 0, smooth(k))
    }
  } else {
    // Not swinging: the club sits back exactly as far as the meter is charged.
    swingDeg = club.held === 'play' ? backswingAngle(charge) : 0
  }

  const pivot = Transform.getMutableOrNull(club.pivot)
  if (pivot) pivot.rotation = Quaternion.fromEulerDegrees(swingDeg * CLUB.swingSign, 0, 0)
}
