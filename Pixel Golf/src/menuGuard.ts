import { engine, inputSystem, InputAction, PointerEventType } from '@dcl/sdk/ecs'

/**
 * Shared rules for the menus (Pixel Golf, clubs, leaderboards, settings, shop, round card):
 *   - F closes whichever is open (Decentraland keeps Escape for its own menu, so scenes can't
 *     use it); with nothing open, F runs the open action (onMenuKey: the bay's Pixel Golf menu,
 *     which replaced clicking the Tee Off screens). One press only ever does one of the two.
 *   - once every menu is closed, none can open again for MENU_REOPEN_MS, so the click or key
 *     that closed one can't open another straight back up
 * Moving from one menu straight to another (Choose Club, Back) isn't a close, so it's never held up.
 */
export const MENU_REOPEN_MS = 1000

let anyOpen: () => boolean = () => false
let closeAll: () => void = () => {}
let openAction: () => void = () => {}

/** What F does when no menu is open (set by teeOffPanels.ts: open the bay's menu). */
export function onMenuKey(fn: () => void): void {
  openAction = fn
}
let wasOpen = false
let closedAt = 0

/** True for a moment after the last menu closed: open functions skip opening while it is. */
export function menuReopenBlocked(): boolean {
  return !anyOpen() && Date.now() - closedAt < MENU_REOPEN_MS
}

/**
 * isOpen: whether any menu is showing. close: shuts every menu (called by F).
 * Run once from main(), on the scene only.
 */
export function setupMenuGuard(isOpen: () => boolean, close: () => void): void {
  anyOpen = isOpen
  closeAll = close
  engine.addSystem(() => {
    const open = anyOpen()
    if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) {
      if (open) closeAll()
      else openAction()
    }
    const now = anyOpen()
    if (wasOpen && !now) closedAt = Date.now()
    wasOpen = now
  }, undefined, 'menu-guard')
}
