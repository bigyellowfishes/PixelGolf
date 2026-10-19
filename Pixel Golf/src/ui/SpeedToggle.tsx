/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { SHOT_SPEEDS, shotSpeed, setShotSpeed, shotSpeedShown } from '../game'
import { onPhone } from '../mobile'

// Pixel Golf colours, as used across the menus
const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const GREY = { r: 0.337, g: 0.388, b: 0.435, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const PALE = { r: 0.957, g: 0.969, b: 0.976, a: 0.92 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }

// Same spot as the swing meters (ui/PowerBar.tsx), which are gone by the time a shot is playing
const BOTTOM_DESKTOP = 110
const BOTTOM_PHONE = 40

/**
 * 1x 2x 3x, low in the middle while one of your shots is playing. The chosen speed is blue.
 * Click (or tap) one, or press E to step through them. It stays on that speed for every shot
 * after, and it's saved on the ledger with the other settings.
 */
export function SpeedToggle(props: {}) {
  const phone = onPhone()
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'center',
        padding: { bottom: phone ? BOTTOM_PHONE : BOTTOM_DESKTOP },
        pointerFilter: 'none',
        display: shotSpeedShown() ? 'flex' : 'none'
      }}
    >
      <UiEntity
        uiTransform={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: { top: 5, bottom: 5, left: 12, right: 6 },
          borderRadius: 20,
          borderWidth: 2,
          borderColor: WHITE
        }}
        uiBackground={{ color: PALE }}
      >
        <Label
          value={phone ? 'SPEED' : 'SPEED (E)'}
          fontSize={13}
          color={GREY}
          textAlign="middle-left"
          uiTransform={{ width: phone ? 54 : 78, height: 28 }}
        />
        {SHOT_SPEEDS.map((s) => (
          <UiEntity
            key={`speed-${s}`}
            uiTransform={{
              width: 44,
              height: 30,
              margin: { left: 4 },
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 15,
              pointerFilter: 'block'
            }}
            uiBackground={{ color: s === shotSpeed ? BLUE : { r: 1, g: 1, b: 1, a: 0 } }}
            onMouseDown={() => setShotSpeed(s)}
          >
            <Label value={`${s}x`} fontSize={15} color={s === shotSpeed ? WHITE : NAVY} textAlign="middle-center" uiTransform={{ width: 42, height: 28 }} />
          </UiEntity>
        ))}
      </UiEntity>
    </UiEntity>
  )
}
