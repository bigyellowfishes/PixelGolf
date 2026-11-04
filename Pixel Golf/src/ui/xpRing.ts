import { profile } from '../ledger/client'

// The XP ring: a blue outline filling clockwise from the top round a level badge, as you earn XP
// towards the next level. Two shapes:
//   badge: the square LV badge in the Pixel Golf menu (58 x 58, corners 18)
//   pill:  the LV pill on the range card (72 x 34 round the 64 x 26 pill, ends fully round)
// Each is drawn as XP_RING_FRAMES frames, empty to full, split over a few picture strips no wider
// than 1024 pixels (bigger pictures get shrunk by the explorer, which made the first one blurry):
// assets/images/menus/xp-ring-0.png .. and xp-pill-0.png ..

export const XP_RING_FRAMES = 40
const SHAPES = {
  badge: { file: 'assets/images/menus/xp-ring-', perStrip: 8 },
  pill: { file: 'assets/images/menus/xp-pill-', perStrip: 7 }
}
export type RingShape = keyof typeof SHAPES

/** How far into the current level you are, 0 to 1 (0 at the top level or before the ledger arrives) */
export function xpFraction(): number {
  return profile.ready && profile.levelNeed > 0 ? Math.max(0, Math.min(1, profile.levelXp / profile.levelNeed)) : 0
}

/** The background that shows this much of the ring (0 to 1) */
export function ringBackground(shape: RingShape, f: number) {
  const s = SHAPES[shape]
  const frame = Math.round(Math.max(0, Math.min(1, f)) * (XP_RING_FRAMES - 1))
  const strip = Math.floor(frame / s.perStrip)
  const i = frame % s.perStrip
  const u0 = i / s.perStrip
  const u1 = (i + 1) / s.perStrip
  return { textureMode: 'stretch' as const, texture: { src: `${s.file}${strip}.png` }, uvs: [u0, 0, u0, 1, u1, 1, u1, 0] }
}
