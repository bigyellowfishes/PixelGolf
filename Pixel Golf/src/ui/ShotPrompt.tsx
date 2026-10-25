/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { getPrompt, getRoundProgress, promptsEnabled } from '../game'
import { tutorial } from '../ledger/client'
import { onPhone, forTouch } from '../mobile'

// The instruction card: what to press next, and the tutorial's coaching.
// Styled like the rest of the menus (SettingsMenu, the range card): a pale card with a white
// rim, navy text, and a blue tab. During the tutorial it says TUTORIAL, counts the shots and
// sits right of the player, over the range (TUTORIAL_AREA). The everyday prompts sit there too
// (ALL_PROMPTS_IN_AREA), just without the tab.
// When the line asks for the E key, the key is drawn beside it as a blue chip.

export interface State {
  display: 'flex' | 'none'
  text: string
  isTutorial: boolean
  tabText: string
  shotText: string
  keyDisplay: 'flex' | 'none'
}

export const state: State = {
  display: 'none',
  text: '',
  isTutorial: false,
  tabText: 'TUTORIAL',
  shotText: '',
  keyDisplay: 'none'
}

// Pixel Golf colours, as used across the menus
const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const GREY = { r: 0.337, g: 0.388, b: 0.435, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const PALE = { r: 0.957, g: 0.969, b: 0.976, a: 0.96 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }

// About this many pixels per character at the body size, to size the card to its line
const CHAR_PX = 9.5
const LINE_PX = 24

// The tutorial card: centred in the open sky and range to the right of the player, between the
// player and the range card. The area is a share of the screen so it lands in the same place at
// any size: left edge, top edge, width and height, as percentages of the screen.
const TUTORIAL_AREA = { left: '52%', top: '29%', width: '24%', height: '41%' } as const
// Then nudged from the middle of that area, in pixels: + is right and down
const TUTORIAL_NUDGE = { x: 100, y: 100 }
// On a phone the desktop spot is under the phone's round buttons (bottom right), so the card
// goes in the open sky above the range instead: centred a little right of middle, near the top,
// below the Settings button
const TUTORIAL_AREA_PHONE = { left: '40%', top: '17%', width: '36%', height: '24%' } as const
const TUTORIAL_NUDGE_PHONE = { x: 0, y: 0 }
const TUTORIAL_TEXT_W = 400
const TUTORIAL_FONT = 22
const TUTORIAL_CHAR_PX = 11.5
const TUTORIAL_LINE_PX = 30
// Phones: a smaller card (UI is already drawn larger on a phone), and no E chip, since the
// phone's own E button is on screen
const PHONE_TEXT_W = 320
const PHONE_FONT = 18
const PHONE_CHAR_PX = 9.5
const PHONE_LINE_PX = 24
// Whether the everyday prompts use the tutorial's place and size too
const ALL_PROMPTS_IN_AREA = true
// Otherwise the everyday prompt is one line, centred above the power bar
const PROMPT_MAX_W = 440
const PROMPT_BOTTOM = 160

export function ShotPrompt(props: {}) {
  // Prompts can be switched off in Settings; the tutorial's always show
  const text = tutorial.active || promptsEnabled ? forTouch(getPrompt()) : ''
  state.text = text
  state.display = text ? 'flex' : 'none'
  state.isTutorial = tutorial.active
  const round = getRoundProgress()
  state.shotText = `Shot ${Math.min(round.ball + 1, round.balls)} of ${round.balls}`
  state.keyDisplay = /\bE\b/.test(text) && !onPhone() ? 'flex' : 'none'

  const hasKey = state.keyDisplay === 'flex'
  // Every prompt (Press E to take your shot, power, curve, bay messages) sits where the tutorial's
  // does and at its size, so the instructions are always in one place. Set ALL_PROMPTS_IN_AREA
  // to false to put the everyday prompts back in the middle above the power bar.
  const inArea = state.isTutorial || ALL_PROMPTS_IN_AREA
  const area = onPhone() ? TUTORIAL_AREA_PHONE : TUTORIAL_AREA
  const nudge = onPhone() ? TUTORIAL_NUDGE_PHONE : TUTORIAL_NUDGE
  const phone = onPhone()
  const charPx = phone ? PHONE_CHAR_PX : inArea ? TUTORIAL_CHAR_PX : CHAR_PX
  const maxW = phone ? PHONE_TEXT_W : inArea ? TUTORIAL_TEXT_W : PROMPT_MAX_W
  const textWidth = Math.min(maxW, Math.max(inArea ? 200 : 160, text.length * charPx))
  const lines = Math.max(1, Math.ceil((text.length * charPx) / textWidth))
  const lineHeight = phone ? PHONE_LINE_PX : inArea ? TUTORIAL_LINE_PX : LINE_PX
  const textHeight = Math.max(32, lines * lineHeight)
  const fontSize = phone ? PHONE_FONT : inArea ? TUTORIAL_FONT : 18
  const cardWidth = textWidth + 44 + (hasKey ? 52 : 0)

  return (
    <UiEntity
      uiTransform={
        inArea
          ? {
              // Tutorial: centred in TUTORIAL_AREA, right of the player
              positionType: 'absolute',
              position: { left: area.left, top: area.top },
              width: area.width,
              height: area.height,
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              // Padding on one side moves the centred card by half of it
              padding: { left: nudge.x * 2, top: nudge.y * 2 },
              pointerFilter: 'none',
              display: state.display
            }
          : {
              // Otherwise: centred, above the power bar
              width: '100%',
              height: '100%',
              positionType: 'absolute',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: { bottom: PROMPT_BOTTOM },
              pointerFilter: 'none',
              display: state.display
            }
      }
    >
      <UiEntity
        uiTransform={{
          width: cardWidth,
          flexDirection: 'column',
          alignItems: 'center',
          borderRadius: 22,
          borderWidth: 3,
          borderColor: WHITE,
          overflow: 'hidden'
        }}
        uiBackground={{ color: PALE }}
      >
        {/* Tutorial header: blue tab on the left, shot count on the right */}
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 30,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: { right: 16 },
            borderWidth: { top: 0, right: 0, bottom: 2, left: 0 },
            borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 },
            display: state.isTutorial ? 'flex' : 'none'
          }}
          uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.85 } }}
        >
          <UiEntity
            uiTransform={{
              width: 118,
              height: 26,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: { bottomRight: 16 }
            }}
            uiBackground={{ color: BLUE }}
          >
            <Label value={state.tabText} fontSize={13} color={WHITE} textAlign="middle-center" uiTransform={{ width: 110, height: 24 }} />
          </UiEntity>
          <Label value={state.shotText} fontSize={13} color={GREY} textAlign="middle-right" uiTransform={{ width: 110, height: 26 }} />
        </UiEntity>

        {/* The line, with the E key beside it when it asks for it */}
        <UiEntity
          uiTransform={{
            width: '100%',
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            padding: { top: 12, right: 22, bottom: 12, left: 22 }
          }}
        >
          <UiEntity
            uiTransform={{
              width: 40,
              height: 40,
              justifyContent: 'center',
              alignItems: 'center',
              margin: { right: 12 },
              borderRadius: 12,
              borderWidth: 2,
              borderColor: WHITE,
              display: state.keyDisplay
            }}
            uiBackground={{ color: BLUE }}
          >
            <Label value="E" fontSize={20} color={WHITE} textAlign="middle-center" uiTransform={{ width: 36, height: 36 }} />
          </UiEntity>
          <Label
            value={state.text}
            fontSize={fontSize}
            textWrap="wrap"
            color={NAVY}
            textAlign={inArea ? 'middle-left' : 'middle-center'}
            uiTransform={{ width: textWidth, height: textHeight }}
          />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
