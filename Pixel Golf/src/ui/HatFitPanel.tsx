/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { HatFit, itemById, NO_HAT } from '../ledger/rules'
import { profile } from '../ledger/client'
import { myFit, nudgeHat, resetHatFit } from '../clothes'
import { playUi } from '../sfx'
import { onPhone } from '../mobile'
import { FONT_BOLD, FONT_REGULAR } from '../fonts'
import { state as backpack } from './BackpackMenu'

// Adjust fit: moving and sizing your hat (clothes.ts), opened from the backpack's Hat tab. It sits
// on the right of the screen with nothing dimmed, so you can see your avatar while you change it.
// Closing it takes you back to the backpack's Hat tab.

export const state = { display: 'none' as 'flex' | 'none' }

const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const GREY = { r: 0.337, g: 0.388, b: 0.435, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const PANEL = { r: 0.957, g: 0.969, b: 0.976, a: 0.97 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const RIM = { r: 0.788, g: 0.827, b: 0.859, a: 1 }

const WIDTH = 360
const RIGHT = 24

/** From the backpack: hide it and show this */
export function openHatFit(): void {
  backpack.display = 'none'
  state.display = 'flex'
  playUi('ui_open')
}

/** Done: back to the backpack, on the Hat tab */
export function closeHatFit(): void {
  state.display = 'none'
  backpack.tab = 'hat'
  backpack.display = 'flex'
  playUi('ui_close')
}

/** One control: what it is, how it's set now, and - / + */
function fitRow(label: string, value: string, key: keyof HatFit, step: number) {
  const small = (text: string, by: number) => (
    <UiEntity
      uiTransform={{ width: 46, height: 38, margin: { left: 6 }, justifyContent: 'center', alignItems: 'center', borderRadius: 19, borderWidth: 2, borderColor: BLUE }}
      uiBackground={{ color: WHITE }}
      onMouseDown={() => {
        nudgeHat(key, by)
        playUi('ui_click')
      }}
    >
      <Label font="sans-serif" fontSrc={FONT_BOLD} value={text} fontSize={18} color={BLUE} textAlign="middle-center" uiTransform={{ width: 40, height: 30 }} />
    </UiEntity>
  )
  return (
    <UiEntity key={`fit-${key}`} uiTransform={{ width: '100%', height: 54, flexDirection: 'row', alignItems: 'center', padding: { left: 14, right: 8 }, margin: { bottom: 6 }, borderRadius: 14 }} uiBackground={{ color: WHITE }}>
      <Label font="sans-serif" fontSrc={FONT_REGULAR} value={label} fontSize={15} color={NAVY} textAlign="middle-left" uiTransform={{ width: 90, height: 30 }} />
      <Label font="sans-serif" fontSrc={FONT_BOLD} value={value} fontSize={15} color={BLUE} textAlign="middle-right" uiTransform={{ width: 64, height: 30 }} />
      <UiEntity uiTransform={{ flexGrow: 1 }} />
      {small('-', -step)}
      {small('+', step)}
    </UiEntity>
  )
}

export function HatFitPanel(props: {}) {
  const item = itemById(profile.equipped.hat || NO_HAT)
  const wearing = !!item && item.id !== NO_HAT
  const cm = (m: number) => `${m > 0 ? '+' : ''}${Math.round(m * 100)} cm`
  const phone = onPhone()
  return (
    <UiEntity
      uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', pointerFilter: 'none', zIndex: 10 }}
    >
      <UiEntity
        uiTransform={{
          width: WIDTH,
          flexDirection: 'column',
          margin: { right: phone ? 12 : RIGHT },
          padding: { top: 14, right: 16, bottom: 16, left: 16 },
          borderRadius: 24,
          borderWidth: 3,
          borderColor: WHITE,
          pointerFilter: 'block'
        }}
        uiBackground={{ color: PANEL }}
      >
        {/* Header */}
        <UiEntity uiTransform={{ width: '100%', height: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: { bottom: 4 } }}>
          <Label font="sans-serif" fontSrc={FONT_BOLD} value="Adjust fit" fontSize={20} color={NAVY} textAlign="middle-left" uiTransform={{ width: 200, height: 34 }} />
          <UiEntity
            uiTransform={{ width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 18, borderWidth: 2, borderColor: RIM }}
            uiBackground={{ color: WHITE }}
            onMouseDown={() => closeHatFit()}
          >
            <UiEntity uiTransform={{ width: 14, height: 14 }} uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-close.png' } }} />
          </UiEntity>
        </UiEntity>
        <Label
          font="sans-serif"
          fontSrc={FONT_REGULAR}
          value={wearing ? `${item!.name}` : 'No hat on: pick one in the backpack first'}
          fontSize={13}
          color={GREY}
          textAlign="middle-left"
          uiTransform={{ width: WIDTH - 32, height: 22, margin: { bottom: 10 } }}
        />

        {fitRow('Height', cm(myFit.up), 'up', 0.01)}
        {fitRow('Forward', cm(myFit.forward), 'forward', 0.01)}
        {fitRow('Tilt', `${myFit.tilt > 0 ? '+' : ''}${myFit.tilt}°`, 'tilt', 2)}
        {fitRow('Size', `${Math.round(myFit.size * 100)}%`, 'size', 0.02)}

        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { top: 6 } }}>
          <UiEntity
            uiTransform={{ width: (WIDTH - 44) / 2, height: 38, justifyContent: 'center', alignItems: 'center', borderRadius: 19, borderWidth: 2, borderColor: BLUE }}
            uiBackground={{ color: WHITE }}
            onMouseDown={() => {
              resetHatFit()
              playUi('ui_click')
            }}
          >
            <Label font="sans-serif" fontSrc={FONT_REGULAR} value="Reset" fontSize={14} color={BLUE} textAlign="middle-center" uiTransform={{ width: 120, height: 28 }} />
          </UiEntity>
          <UiEntity
            uiTransform={{ width: (WIDTH - 44) / 2, height: 38, justifyContent: 'center', alignItems: 'center', borderRadius: 19 }}
            uiBackground={{ color: BLUE }}
            onMouseDown={() => closeHatFit()}
          >
            <Label font="sans-serif" fontSrc={FONT_BOLD} value="Done" fontSize={14} color={WHITE} textAlign="middle-center" uiTransform={{ width: 120, height: 28 }} />
          </UiEntity>
        </UiEntity>
        <Label font="sans-serif" fontSrc={FONT_REGULAR} value="Everyone sees your hat the way you set it." fontSize={12} color={GREY} textAlign="middle-center" uiTransform={{ width: WIDTH - 32, height: 22, margin: { top: 10 } }} />
      </UiEntity>
    </UiEntity>
  )
}
