import { engine, InputAction, TouchScreenControls, inputSystem, PointerEventType } from '@dcl/sdk/ecs'
import { tutorial } from './ledger/client'
import { playUi } from './sfx'
import { getSelectedClubType, onClubSelected } from './clubSelect'
import type { ClubType } from './club'
import { getPlatform } from '@dcl/sdk/platform'

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

/**
 * True on the Decentraland mobile app. The explorer only says which platform it is a moment
 * after the scene starts (getPlatform() is null until then), so this keeps asking until it
 * knows, and only then remembers the answer. Before that it says false.
 */
export function onPhone(): boolean {
  if (phone !== undefined) return phone
  let p: string | null = null
  try {
    p = getPlatform()
  } catch {
    p = null
  }
  if (p) phone = p === 'mobile'
  return phone ?? false
}

/**
 * How far the right-hand HUD (the range card and the Settings cog) is pushed past the right
 * edge of the phone's safe area, in UI pixels. The safe area leaves a wide empty margin on the
 * right of a phone, so this moves them out towards the edge. 0 keeps them inside it.
 */
export const PHONE_RIGHT_SHIFT = 180

// Keyboard wording -> touch wording. Whole phrases first, then single words.
const TOUCH_WORDS: [RegExp, string][] = [
  [/Drag or A \/ D to orbit\s+W \/ S to zoom/, 'Joystick left / right to orbit, up / down to zoom'],
  [/drag or A \/ D to orbit, W \/ S to zoom/, 'joystick left / right to orbit, up / down to zoom'],
  [/press and drag/g, 'drag the screen'],
  [/Press F\b/g, 'Tap F'],
  [/press F\b/g, 'tap F'],
  [/1, 2, 3 to change club/g, '1, 2, 3 buttons change club'],
  [/1, 2 or 3/g, 'the 1, 2 or 3 button'],
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
 * The phone's on-screen buttons, in Pixel Golf's own style: round icons in the menus' colours
 * (assets/touch), drawn edge to edge so they fill the app's button circles.
 *
 * The phone app shows a big button plus four round it; any more and it adds its own grey "+"
 * that scenes can't restyle. So we never show more than five, and have our own "+" instead
 * (button 4, which nothing else uses):
 *   - normally:      E (big: swing, speed)  F (bay menu)  jump  our +
 *   - after our +:   E  1 wedge  2 iron  3 driver  close
 * Picking a club (or close) folds the clubs away again. The club you have selected is green,
 * like "Equipped" in the shop. No + in the tutorial, where the club is fixed. The pointer
 * button isn't used, so it's always hidden.
 *
 * While a menu or card is open: every button and the joystick are hidden, because they sit
 * on top of the menu's own buttons (the bottom corners of the big menus are under them).
 * The previous version is in mobile.ts.bak.
 */
const TOUCH_ICONS = 'assets/touch'
const CLUB_BUTTONS: { action: InputAction; number: number; type: ClubType }[] = [
  { action: InputAction.IA_ACTION_3, number: 1, type: 'wedge' },
  { action: InputAction.IA_ACTION_4, number: 2, type: 'iron' },
  { action: InputAction.IA_ACTION_5, number: 3, type: 'driver' }
]
/** Our own "+" (and close): button 4 */
const PLUS_BUTTON = InputAction.IA_ACTION_6

export function setupMobileControls(menuOpen: () => boolean): void {
  // Written straight away and on every platform, as Decentraland's docs advise: desktop ignores
  // it, and waiting until the scene knows it's on a phone (onPhone) can be too late for the
  // phone app to pick it up.
  // E is made the big button with mainAction and given its icon the way Decentraland's docs show.
  const chip = (file: string) => ({ tex: { $case: 'texture' as const, texture: { src: `${TOUCH_ICONS}/${file}` } } })
  let clubsOut = false
  const playing = () => {
    const selected = getSelectedClubType()
    const clubs = clubsOut && !tutorial.active
    TouchScreenControls.createOrReplace(engine.RootEntity, {
      hideJoystick: false,
      hideCrosshair: false,
      mainAction: InputAction.IA_PRIMARY,
      touchInputs: [
        { inputAction: InputAction.IA_PRIMARY, hide: false, icon: chip('key-e.png') },
        { inputAction: InputAction.IA_SECONDARY, hide: clubs, icon: chip('key-f.png') },
        { inputAction: InputAction.IA_JUMP, hide: clubs, icon: chip('jump.png') },
        ...CLUB_BUTTONS.map((c) => ({
          inputAction: c.action,
          hide: !clubs,
          icon: chip(`club-${c.number}${c.type === selected ? '-on' : ''}.png`)
        })),
        { inputAction: PLUS_BUTTON, hide: tutorial.active, icon: chip(clubs ? 'close.png' : 'plus.png') },
        { inputAction: InputAction.IA_POINTER, hide: true }
      ]
    })
  }
  const inMenu = () =>
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

  // A new club lights its button and folds the clubs away (only while the buttons are showing)
  onClubSelected(() => {
    clubsOut = false
    if (!shown) playing()
  })

  // Our "+": open or close the clubs. Phones only (on desktop key 4 does nothing).
  let shownTutorial = tutorial.active
  engine.addSystem(() => {
    if (shown) return
    if (tutorial.active !== shownTutorial) {
      shownTutorial = tutorial.active
      clubsOut = false
      playing()
    }
    if (!onPhone()) return
    // Any club tapped folds them away, even the one already selected (or one that can't be
    // picked right now, mid-shot); game.ts does the picking
    if (clubsOut && CLUB_BUTTONS.some((c) => inputSystem.isTriggered(c.action, PointerEventType.PET_DOWN))) {
      clubsOut = false
      playing()
      return
    }
    if (!inputSystem.isTriggered(PLUS_BUTTON, PointerEventType.PET_DOWN)) return
    clubsOut = !clubsOut
    playUi(clubsOut ? 'ui_open' : 'ui_close')
    playing()
  })

  playing()
  let shown = false
  engine.addSystem(() => {
    const open = menuOpen()
    if (open === shown) return
    shown = open
    if (open) inMenu()
    else playing()
  })
}
