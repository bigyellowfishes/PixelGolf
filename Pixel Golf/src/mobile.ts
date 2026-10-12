import { engine, InputAction, TouchScreenControls } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'

/**
 * Phones. The scene's UI reads onPhone() to move things clear of the phone's own buttons and
 * forTouch() to swap keyboard words for touch ones. setupMobileControls() sets the phone's
 * on-screen buttons for golf. On desktop all of this does nothing.
 *
 * What a phone has that a PC doesn't (Decentraland mobile, SDK 7.26+):
 *   - a 1600 x 720 UI canvas (desktop is 1920 x 1080), so a third less height
 *   - a joystick bottom left and a cluster of round buttons bottom right (jump, the pointer,
 *     E, F, 1 to 4) that sit on top of scene UI
 *   - no keyboard and no hover; rounded corners draw square
 */

let phone: boolean | undefined

/** True on the Decentraland mobile app. Read once: the platform doesn't change mid-visit. */
export function onPhone(): boolean {
  if (phone === undefined) {
    try {
      phone = isMobile()
    } catch {
      phone = false
    }
  }
  return phone
}

// Keyboard wording -> touch wording. Whole phrases first, then single words.
const TOUCH_WORDS: [RegExp, string][] = [
  [/Drag or A \/ D to orbit\s+W \/ S to zoom/, 'Joystick left / right to orbit, up / down to zoom'],
  [/drag or A \/ D to orbit, W \/ S to zoom/, 'joystick left / right to orbit, up / down to zoom'],
  [/press and drag/g, 'drag the screen'],
  [/Key 1 also switches it/g, 'The 1 button also switches it'],
  [/\bPress E\b/g, 'Tap E'],
  [/\bpress E\b/g, 'tap E'],
  [/\bPress again\b/g, 'Tap again'],
  [/\bClick\b/g, 'Tap'],
  [/\bclick\b/g, 'tap']
]

/** The same instruction with touch words on a phone, unchanged on desktop. */
export function forTouch(text: string): string {
  if (!text || !onPhone()) return text
  let out = text
  for (const [from, to] of TOUCH_WORDS) out = out.replace(from, to)
  return out
}

/**
 * The phone's on-screen buttons.
 *
 * While playing: E (swing) is the big central button, since it's the one golf uses most.
 * Jump, the pointer and 1 (ball cam) stay; F and 2 to 4 aren't used, so they're hidden,
 * which keeps all four on screen with no "+" overflow button.
 *
 * While a menu or card is open: every button and the joystick are hidden, because they sit
 * on top of the menu's own buttons (the bottom corners of the big menus are under them).
 */
export function setupMobileControls(menuOpen: () => boolean): void {
  if (!onPhone()) return
  let shown: boolean | null = null
  engine.addSystem(() => {
    const open = menuOpen()
    if (open === shown) return
    shown = open
    if (open) {
      TouchScreenControls.createOrReplace(engine.RootEntity, {
        hideJoystick: true,
        hideCrosshair: true,
        mainAction: InputAction.IA_PRIMARY,
        touchInputs: [
          InputAction.IA_JUMP,
          InputAction.IA_POINTER,
          InputAction.IA_PRIMARY,
          InputAction.IA_SECONDARY,
          InputAction.IA_ACTION_3,
          InputAction.IA_ACTION_4,
          InputAction.IA_ACTION_5,
          InputAction.IA_ACTION_6
        ].map((inputAction) => ({ inputAction, hide: true }))
      })
    } else {
      TouchScreenControls.createOrReplace(engine.RootEntity, {
        hideJoystick: false,
        hideCrosshair: false,
        mainAction: InputAction.IA_PRIMARY,
        touchInputs: [
          InputAction.IA_SECONDARY,
          InputAction.IA_ACTION_4,
          InputAction.IA_ACTION_5,
          InputAction.IA_ACTION_6
        ].map((inputAction) => ({ inputAction, hide: true }))
      })
    }
  })
}
