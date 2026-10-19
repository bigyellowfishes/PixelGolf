/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { tutorial } from '../ledger/client'
import { skipTutorial } from '../tutorial'
import { onPhone, forTouch } from '../mobile'

// Pixel Golf colours, as used across the menus
const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const PALE = { r: 0.957, g: 0.969, b: 0.976, a: 0.92 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }

// How long the button waits for its second press before it goes back to "Skip tutorial"
const CONFIRM_SECONDS = 4
// Distance down from the top of the screen: under the score panel on desktop (phones don't show it)
const TOP_DESKTOP = 110
const TOP_PHONE = 56

let armedUntil = 0

function press(): void {
  if (!tutorial.active) return
  if (Date.now() < armedUntil) {
    armedUntil = 0
    skipTutorial()
    return
  }
  armedUntil = Date.now() + CONFIRM_SECONDS * 1000
}

/**
 * A small Skip tutorial button, top middle, only while the tutorial is running. It takes two
 * presses: the first turns it blue and asks again, so it can't be hit by accident mid-swing.
 */
export function SkipTutorial(props: {}) {
  const armed = Date.now() < armedUntil
  const text = armed ? forTouch('Click again to skip') : 'Skip tutorial'
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        flexDirection: 'column',
        alignItems: 'center',
        padding: { top: onPhone() ? TOP_PHONE : TOP_DESKTOP },
        pointerFilter: 'none',
        display: tutorial.active ? 'flex' : 'none'
      }}
    >
      <UiEntity
        uiTransform={{
          width: 170,
          height: 34,
          justifyContent: 'center',
          alignItems: 'center',
          borderRadius: 17,
          borderWidth: 2,
          borderColor: armed ? WHITE : BLUE,
          pointerFilter: 'block'
        }}
        uiBackground={{ color: armed ? BLUE : PALE }}
        onMouseDown={press}
      >
        <Label value={text} fontSize={14} color={armed ? WHITE : NAVY} textAlign="middle-center" uiTransform={{ width: 166, height: 30 }} />
      </UiEntity>
    </UiEntity>
  )
}
