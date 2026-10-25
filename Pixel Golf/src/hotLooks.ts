/**
 * The colours of each hot target, shared by the range card's hot box (ui/RangeHud.tsx) and the
 * marker floating over the target (hotTarget.ts), so they always match the target itself.
 *
 * fill: the box. text: the words on it (navy on the light ones so they stay readable).
 * rim: the box's edge on the range card, and the edge of the floating marker for the White
 * target, which would otherwise vanish into the sky (the others get a white rim in the world).
 * A target name not listed here stays orange.
 */
export type HotColour = { r: number; g: number; b: number; a: number }
export type HotLook = { fill: HotColour; text: HotColour; rim: HotColour }

export const HOT_WHITE_TEXT: HotColour = { r: 1, g: 1, b: 1, a: 1 }
export const HOT_NAVY_TEXT: HotColour = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
/** The grey rim the menus use */
export const HOT_GREY_RIM: HotColour = { r: 0.788, g: 0.827, b: 0.859, a: 1 }

const RED = { r: 0.886, g: 0.169, b: 0.169, a: 1 }
const ORANGE = { r: 1, g: 0.549, b: 0.102, a: 1 }
const YELLOW = { r: 1, g: 0.851, b: 0.18, a: 1 }
const GREEN = { r: 0.212, g: 0.663, b: 0.247, a: 1 }
const BLUE = { r: 0.098, g: 0.451, b: 0.902, a: 1 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const BLACK = { r: 0.106, g: 0.118, b: 0.133, a: 1 }

export const HOT_LOOKS: { [name: string]: HotLook } = {
  Red: { fill: RED, text: HOT_WHITE_TEXT, rim: RED },
  Orange: { fill: ORANGE, text: HOT_WHITE_TEXT, rim: ORANGE },
  Yellow: { fill: YELLOW, text: HOT_NAVY_TEXT, rim: YELLOW },
  Green: { fill: GREEN, text: HOT_WHITE_TEXT, rim: GREEN },
  Blue: { fill: BLUE, text: HOT_WHITE_TEXT, rim: BLUE },
  White: { fill: WHITE, text: HOT_NAVY_TEXT, rim: HOT_GREY_RIM },
  Black: { fill: BLACK, text: HOT_WHITE_TEXT, rim: BLACK }
}

/** The look for a hot zone, by its colour name ("Red") or zone name ("Red2") */
export function hotLook(name: string): HotLook {
  return HOT_LOOKS[name.replace(/\d+$/, '')] ?? HOT_LOOKS.Orange
}

/** The same colour, slightly see-through: for the small "HOT TARGET" label */
export function faded(c: HotColour): HotColour {
  return { r: c.r, g: c.g, b: c.b, a: 0.8 }
}
