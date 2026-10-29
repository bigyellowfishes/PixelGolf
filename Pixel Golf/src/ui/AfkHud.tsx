/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { getPlayer } from '@dcl/sdk/players'
import { afk, stopAfk } from '../afk'
import { range } from '../ledger/client'
import { onPhone } from '../mobile'
import { FONT_BOLD, FONT_REGULAR } from '../fonts'

// While you're on AFK practice (afk.ts): a small card at the bottom of the screen with how long
// you've been practising, the XP it's paid, and a Stop button. Clicks around it go through.

const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const GREY = { r: 0.337, g: 0.388, b: 0.435, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const PANEL = { r: 0.957, g: 0.969, b: 0.976, a: 0.97 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const RIM = { r: 0.788, g: 0.827, b: 0.859, a: 1 }

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

export function AfkHud(props: {}) {
  const guest = getPlayer()?.isGuest === true
  const phone = onPhone()
  const earned = guest ? 'Connect a wallet to earn XP' : `+${afk.xp} XP so far`
  return (
    <UiEntity
      uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', pointerFilter: 'none' }}
    >
      <UiEntity
        uiTransform={{
          width: 420,
          height: 76,
          flexDirection: 'row',
          alignItems: 'center',
          margin: { bottom: phone ? 150 : 110 },
          padding: { left: 18, right: 12 },
          borderRadius: 24,
          borderWidth: 3,
          borderColor: WHITE,
          pointerFilter: 'block'
        }}
        uiBackground={{ color: PANEL }}
      >
        <UiEntity uiTransform={{ flexDirection: 'column', flexGrow: 1 }}>
          <Label font="sans-serif" fontSrc={FONT_BOLD} value={`AFK PRACTICE  ${clock(afk.seconds)}`} fontSize={13} color={BLUE} textAlign="middle-left" uiTransform={{ width: 280, height: 20 }} />
          <Label font="sans-serif" fontSrc={FONT_REGULAR} value={earned} fontSize={15} color={NAVY} textAlign="middle-left" uiTransform={{ width: 280, height: 22 }} />
          <Label
            font="sans-serif"
            fontSrc={FONT_REGULAR}
            value={`Counting towards the multiplier for ${Math.max(1, range.players)} in the space`}
            fontSize={11}
            color={GREY}
            textAlign="middle-left"
            uiTransform={{ width: 280, height: 16 }}
          />
        </UiEntity>
        <UiEntity
          uiTransform={{ width: 96, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 20, borderWidth: 2, borderColor: RIM }}
          uiBackground={{ color: WHITE }}
          onMouseDown={() => stopAfk()}
        >
          <Label font="sans-serif" fontSrc={FONT_BOLD} value="Stop" fontSize={15} color={NAVY} textAlign="middle-center" uiTransform={{ width: 90, height: 30 }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
