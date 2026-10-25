/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { useInteraction } from './interaction'
import { tutorial } from '../ledger/client'
import { skipTutorial } from '../tutorial'
import { onPhone, forTouch } from '../mobile'
import { playUi } from '../sfx'

// Pixel Golf colours, as used across the menus (the Leaderboards and Settings buttons)
const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const RIM = { r: 0.788, g: 0.827, b: 0.859, a: 1 }
const HOVER_RIM = { r: 0.161, g: 0.694, b: 0.898, a: 1 }
const PALE_BLUE = { r: 0.839, g: 0.949, b: 0.988, a: 1 }
// Armed (asking again): the same red as Abandon round
const RED = { r: 0.851, g: 0.341, b: 0.239, a: 1 }

// How long the button waits for its second press before it goes back to "Skip tutorial"
const CONFIRM_SECONDS = 4
// Distance down from the top of the screen
const TOP_DESKTOP = 110
const TOP_PHONE = 56

let armedUntil = 0

function press(): void {
  if (!tutorial.active) return
  if (Date.now() < armedUntil) {
    armedUntil = 0
    playUi('ui_close')
    skipTutorial()
    return
  }
  armedUntil = Date.now() + CONFIRM_SECONDS * 1000
  playUi('ui_click')
}

/**
 * Skip tutorial, top middle, only while the tutorial is running. Styled like the range card's
 * buttons: white pill, grey rim, navy text, blue on hover. It takes two presses: the first turns
 * it red and asks again, so it can't be hit by accident mid-swing.
 */
export function SkipTutorial(props: {}) {
  const armed = Date.now() < armedUntil
  const text = armed ? forTouch('Click again to skip') : 'Skip tutorial'
  const phone = onPhone()

  const button = useInteraction(
    {
      base: {
        uiTransform: {
          height: phone ? 44 : 38,
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          padding: { left: 18, right: 16 },
          borderRadius: phone ? 22 : 19,
          borderWidth: 2,
          borderColor: RIM,
          pointerFilter: 'block'
        },
        uiBackground: { color: WHITE },
        onMouseDown: press
      },
      hover: {
        uiTransform: { borderColor: HOVER_RIM },
        uiBackground: { color: PALE_BLUE }
      },
      active: {
        uiTransform: { borderColor: RED },
        uiBackground: { color: RED }
      }
    },
    armed
  )

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        flexDirection: 'column',
        alignItems: 'center',
        padding: { top: phone ? TOP_PHONE : TOP_DESKTOP },
        pointerFilter: 'none',
        display: tutorial.active ? 'flex' : 'none'
      }}
    >
      <UiEntity {...button}>
        <Label
          value={text}
          fontSize={phone ? 17 : 15}
          color={armed ? WHITE : NAVY}
          textAlign="middle-center"
          uiTransform={{ width: armed ? (phone ? 150 : 140) : phone ? 112 : 100, height: 30 }}
        />
        <UiEntity
          uiTransform={{ width: 16, height: 16, margin: { left: 6 }, display: armed ? 'none' : 'flex' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-arrow.png' }, color: NAVY }}
        />
      </UiEntity>
    </UiEntity>
  )
}
