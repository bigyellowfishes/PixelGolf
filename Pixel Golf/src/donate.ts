import { engine, Transform } from '@dcl/sdk/ecs'
import { openExternalUrl } from '~system/RestrictedActions'
import { tutorial } from './ledger/client'
import { isShotInProgress } from './game'
import { playUi } from './sfx'
import { earn } from './achievements'

// The Wall of Honour (Wall of Honor/Wall of Honor.glb, on the plaza): walk up to it and a box asks
// if you'd like to support Pixel Golf with a donation through PayPal (ui/DonatePrompt.tsx, in the
// same style as the AFK practice box). Donate opens the PayPal page; Decentraland asks the player
// to confirm before it leaves the game. It asks once per visit: walk away and back to see it again.
//
// The area in front of the wall was read from the model: the wall stands along x 57.4 to 61.9,
// z 194 to 206, facing +x, so the area is the strip of floor in front of it.

/** The donation page. PayPal "Donate" button links look like https://www.paypal.com/donate/?hosted_button_id=... */
export const PAYPAL_URL = 'https://www.paypal.com/paypalme/bigyellowfishes'

const AREA = { x0: 61.9, x1: 67, z0: 193.5, z1: 206.5, y0: 33.5, y1: 39 }

export const donate = {
  /** In front of the wall now */
  inside: false,
  /** Asked already this visit */
  asked: false,
  /** The box is showing */
  prompt: false
}

/** Donate: off to PayPal (Decentraland shows its own "leaving" check first) */
export function acceptDonate(): void {
  donate.prompt = false
  playUi('ui_select')
  earn('supporter')
  if (PAYPAL_URL) void openExternalUrl({ url: PAYPAL_URL })
  else console.log('[donate] PAYPAL_URL is not set in donate.ts')
}

export function declineDonate(): void {
  donate.prompt = false
  playUi('ui_close')
}

export function setupDonate(anyMenuOpen: () => boolean): void {
  engine.addSystem(() => {
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    if (!p) return
    const inside = p.x >= AREA.x0 && p.x <= AREA.x1 && p.z >= AREA.z0 && p.z <= AREA.z1 && p.y >= AREA.y0 && p.y <= AREA.y1
    if (inside !== donate.inside) {
      donate.inside = inside
      if (!inside) {
        donate.asked = false
        donate.prompt = false
      }
    }
    if (inside && !donate.asked && !tutorial.active && !isShotInProgress() && !anyMenuOpen()) {
      donate.asked = true
      donate.prompt = true
      playUi('ui_open')
    }
  })
}
