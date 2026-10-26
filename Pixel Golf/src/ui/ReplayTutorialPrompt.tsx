/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { useInteraction } from './interaction'
import { replayTutorial } from '../tutorial'
import { showToast } from './RangeHud'
import { onPhone } from '../mobile'
import { playUi } from '../sfx'
import { menuReopenBlocked } from '../menuGuard'
import { FONT_BOLD, FONT_REGULAR } from '../fonts'

// "Would you like to redo the tutorial?" with Yes and No. Pops up when a player who has done the
// tutorial walks onto the tutorial bay's pad (teeOffPanels.ts), and again if they press F there.
// Yes plays it again as practice (tutorial.ts: nothing is saved, no second reward). It counts as a
// menu, so F closes it too (index.ts).

const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const PANEL = { r: 0.957, g: 0.969, b: 0.976, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const BLUE_HOVER = { r: 0.161, g: 0.694, b: 0.898, a: 1 }
const RIM = { r: 0.788, g: 0.827, b: 0.859, a: 1 }
const PALE_BLUE = { r: 0.839, g: 0.949, b: 0.988, a: 1 }

export const state = { display: 'none' as 'flex' | 'none' }

/** Shows the question. */
export function openReplayPrompt(): void {
  if (state.display === 'flex' || menuReopenBlocked()) return
  state.display = 'flex'
  playUi('ui_open')
}

function pressYes(): void {
  state.display = 'none'
  const why = replayTutorial()
  if (why) {
    playUi('ui_close')
    showToast(why, 4)
    return
  }
  playUi('ui_select')
}

function pressNo(): void {
  state.display = 'none'
  playUi('ui_close')
}

export function ReplayTutorialPrompt(props: {}) {
  const phone = onPhone()
  const buttonHeight = phone ? 52 : 46

  const yes = useInteraction({
    base: {
      uiTransform: { width: 150, height: buttonHeight, justifyContent: 'center', alignItems: 'center', borderRadius: buttonHeight / 2, margin: { right: 14 } },
      uiBackground: { color: BLUE },
      onMouseDown: pressYes
    },
    hover: { uiBackground: { color: BLUE_HOVER } }
  })

  const no = useInteraction({
    base: {
      uiTransform: { width: 150, height: buttonHeight, justifyContent: 'center', alignItems: 'center', borderRadius: buttonHeight / 2, borderWidth: 2, borderColor: RIM },
      uiBackground: { color: WHITE },
      onMouseDown: pressNo
    },
    hover: { uiTransform: { borderColor: BLUE_HOVER }, uiBackground: { color: PALE_BLUE } }
  })

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        justifyContent: 'center',
        alignItems: 'center',
        pointerFilter: 'block',
        zIndex: 10
      }}
    >
      {/* The dim behind it, oversized like the other menus' so it covers a phone's whole screen */}
      <UiEntity
        uiTransform={{ positionType: 'absolute', position: { top: -1500, left: -2000 }, width: 6000, height: 4000, pointerFilter: 'block' }}
        uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.35 } }}
      />
      <UiEntity
        uiTransform={{
          width: 440,
          flexDirection: 'column',
          alignItems: 'center',
          padding: { top: 28, right: 28, bottom: 26, left: 28 },
          borderRadius: 28,
          borderWidth: 4,
          borderColor: WHITE
        }}
        uiBackground={{ color: PANEL }}
      >
        <Label
          font="sans-serif"
          fontSrc={FONT_BOLD}
          value="Would you like to redo the tutorial?"
          fontSize={22}
          textWrap="wrap"
          color={NAVY}
          textAlign="middle-center"
          uiTransform={{ width: 380, height: 60 }}
        />
        <Label
          font="sans-serif"
          fontSrc={FONT_REGULAR}
          value="It's practice: nothing is saved, and a round you've started waits for you."
          fontSize={14}
          textWrap="wrap"
          color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
          textAlign="middle-center"
          uiTransform={{ width: 380, height: 40, margin: { top: 4, bottom: 18 } }}
        />
        <UiEntity uiTransform={{ flexDirection: 'row', justifyContent: 'center' }}>
          <UiEntity {...yes}>
            <Label font="sans-serif" fontSrc={FONT_BOLD} value="Yes" fontSize={18} color={WHITE} textAlign="middle-center" uiTransform={{ width: 140, height: 30 }} />
          </UiEntity>
          <UiEntity {...no}>
            <Label font="sans-serif" fontSrc={FONT_BOLD} value="No" fontSize={18} color={NAVY} textAlign="middle-center" uiTransform={{ width: 140, height: 30 }} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
