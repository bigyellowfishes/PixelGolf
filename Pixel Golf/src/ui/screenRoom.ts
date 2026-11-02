import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'

// How much room the scene's UI has, in UI pixels: the canvas less the device's safe margins
// (a phone's notch, rounded corners and home bar). Desktop is usually 1920 x 1080, a phone
// held sideways about 1600 x 720, and a phone held upright is taller than it is wide.
// Menus use this to shrink to fit instead of running off the screen.

export function screenRoom(): { w: number; h: number } {
  const c = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (!c || !c.width || !c.height) return { w: 1920, h: 1080 }
  const inset = c.screenInsetArea
  const w = c.width - (inset ? inset.left + inset.right : 0)
  const h = c.height - (inset ? inset.top + inset.bottom : 0)
  return { w: Math.max(320, w), h: Math.max(320, h) }
}

/**
 * The device's safe margin at the top of the screen, in UI pixels (0 on desktop). On a phone the
 * scene's UI starts below it, so something meant to sit flush with the very top of the screen
 * (the Cooer bell) moves up by this much.
 */
export function topInset(): number {
  const c = UiCanvasInformation.getOrNull(engine.RootEntity)
  return Math.max(0, c?.screenInsetArea?.top ?? 0)
}

/**
 * On a phone the scene's UI starts this far below the top of the screen (UI pixels, measured from
 * a phone screenshot), under the phone's own top buttons (profile and chat). Things meant to sit
 * at the very top (the Cooer bell, the range card's buttons) move up by this much, or by what the
 * phone reports if that's more.
 */
export const PHONE_TOP_GAP = 62

/** How far above the scene UI's top the real top of the screen is: on a phone, at least PHONE_TOP_GAP */
export function screenTopLift(phone: boolean): number {
  return phone ? Math.max(PHONE_TOP_GAP, topInset()) : topInset()
}
