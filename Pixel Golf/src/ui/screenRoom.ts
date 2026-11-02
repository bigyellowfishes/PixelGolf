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
