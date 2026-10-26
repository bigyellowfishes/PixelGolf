/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { range, wind, dev, amIAdmin, sendAdminHot, sendAdminPlayers, sendAdminWind, hotSecondsLeft, currentFloor, currentCeiling } from '../ledger/client'
import { HOT } from '../ledger/rules'
import { playUi } from '../sfx'
import { FONT_BOLD, FONT_REGULAR } from '../fonts'

// The dev panel: admin only (ADMIN in ledger/rules.ts), opened from the Dev panel row in
// Settings. Everything it changes is done by the server, which checks the wallet first, and
// applies to everyone in the space:
//   - HOT TARGET: make any target hot now. It stays hot until you pick another or press Random
//     (back to the normal 30 second rotation).
//   - PLAYERS: pretend extra players are in the space, so the multiplier rolls as if they were.
//   - WIND: point it relative to the bays (looking down the range) and set its strength; it stays
//     until you change it or press Random (back to changing by itself every 2 minutes).
// It isn't a menu: the game carries on with it open, so you can play a shot and see the effect.

export const devPanel = { open: false }

export function toggleDevPanel(): void {
  if (!amIAdmin()) return
  devPanel.open = !devPanel.open
  playUi(devPanel.open ? 'ui_open' : 'ui_close')
}

const NAVY = { r: 0.118, g: 0.204, b: 0.259, a: 1 }
const GREY = { r: 0.337, g: 0.388, b: 0.435, a: 1 }
const BLUE = { r: 0.075, g: 0.533, b: 0.722, a: 1 }
const PALE = { r: 0.957, g: 0.969, b: 0.976, a: 0.97 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const RIM = { r: 0.788, g: 0.827, b: 0.859, a: 1 }
const RED = { r: 0.773, g: 0.192, b: 0.192, a: 1 }

const WIDTH = 400
const MPH = 2.237
/** Wind strength step for the - / + buttons (m/s, about 2 mph) */
const WIND_STEP = 0.894
/**
 * Wind directions as seen from the bays, looking down the range (+x). dir is where the wind
 * blows to: 90 = down the range (+x), 270 = back at you, 180 = towards your right (-z),
 * 0 = towards your left (+z).
 */
const WIND_DIRS: { label: string; dir: number }[] = [
  { label: 'Helping', dir: 90 },
  { label: 'Against', dir: 270 },
  { label: 'Left to right', dir: 180 },
  { label: 'Right to left', dir: 0 }
]

function button(key: string, label: string, width: number, on: boolean, onPress: () => void) {
  return (
    <UiEntity
      key={key}
      uiTransform={{
        width,
        height: 34,
        margin: { right: 6, bottom: 6 },
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 17,
        borderWidth: 2,
        borderColor: on ? BLUE : RIM
      }}
      uiBackground={{ color: on ? BLUE : WHITE }}
      onMouseDown={() => {
        playUi('ui_click')
        onPress()
      }}
    >
      <Label font="sans-serif" fontSrc={FONT_REGULAR} value={label} fontSize={13} color={on ? WHITE : NAVY} textAlign="middle-center" uiTransform={{ width: width - 6, height: 28 }} />
    </UiEntity>
  )
}

function heading(text: string, detail: string) {
  return (
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: 10, bottom: 6 } }}>
      <Label font="sans-serif" fontSrc={FONT_BOLD} value={text} fontSize={12} color={BLUE} textAlign="middle-left" uiTransform={{ width: WIDTH - 32, height: 16 }} />
      <Label font="sans-serif" fontSrc={FONT_REGULAR} value={detail} fontSize={14} color={NAVY} textAlign="middle-left" uiTransform={{ width: WIDTH - 32, height: 20 }} />
    </UiEntity>
  )
}

function row(key: string, children: any) {
  return (
    <UiEntity key={key} uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap' }}>
      {children}
    </UiEntity>
  )
}

export function DevPanel(props: {}) {
  if (!amIAdmin()) return <UiEntity uiTransform={{ display: 'none' }} />

  const real = Math.max(1, range.players - dev.extra)
  const floor = currentFloor()
  const ceiling = currentCeiling()
  const left = hotSecondsLeft()
  const hotText = range.hot
    ? `${range.hot}  ${dev.hotHold ? '(held)' : `(moves in ${left}s)`}`
    : 'none yet (is the server running?)'
  const windText = wind.ready
    ? `${Math.round(wind.speed * MPH)} mph to ${Math.round(wind.dir)}°  ${dev.windHold ? '(held)' : '(changes by itself)'}`
    : 'none yet'
  const heldDir = WIND_DIRS.find((d) => Math.abs(((wind.dir - d.dir + 540) % 360) - 180) < 1)

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { left: 16, top: 120 },
        width: WIDTH,
        flexDirection: 'column',
        padding: { top: 12, right: 16, bottom: 12, left: 16 },
        borderRadius: 20,
        borderWidth: 3,
        borderColor: RED,
        pointerFilter: 'block'
      }}
      uiBackground={{ color: PALE }}
    >
      {/* Title */}
      <UiEntity uiTransform={{ width: '100%', height: 36, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label font="sans-serif" fontSrc={FONT_BOLD} value="Dev panel (admin)" fontSize={18} color={RED} textAlign="middle-left" uiTransform={{ width: 220, height: 30 }} />
        <UiEntity
          uiTransform={{ width: 34, height: 34, justifyContent: 'center', alignItems: 'center', borderRadius: 17, borderWidth: 2, borderColor: RIM }}
          uiBackground={{ color: WHITE }}
          onMouseDown={() => toggleDevPanel()}
        >
          <Label font="sans-serif" fontSrc={FONT_BOLD} value="X" fontSize={15} color={NAVY} textAlign="middle-center" uiTransform={{ width: 28, height: 28 }} />
        </UiEntity>
      </UiEntity>
      <Label font="sans-serif" fontSrc={FONT_REGULAR} value="Changes apply to everyone in the space." fontSize={11} color={GREY} textAlign="middle-left" uiTransform={{ width: WIDTH - 32, height: 16 }} />

      {/* Hot target */}
      {heading('HOT TARGET', hotText)}
      {row(
        'hot',
        HOT.targets.map((z) => button(`hot-${z}`, z, 84, range.hot === z, () => sendAdminHot(z, true)))
      )}
      {row('hot-random', [button('hot-rnd', 'Random (normal)', 176, !dev.hotHold, () => sendAdminHot('', false))])}

      {/* Players */}
      {heading('PLAYERS', `${real} real + ${dev.extra} pretend = ${range.players}   multiplier ${floor === ceiling ? `${floor}x` : `${floor}x to ${ceiling}x`}`)}
      {row('players', [
        button('p-5', '-5', 60, false, () => sendAdminPlayers(dev.extra - 5)),
        button('p-1', '-1', 60, false, () => sendAdminPlayers(dev.extra - 1)),
        button('p+1', '+1', 60, false, () => sendAdminPlayers(dev.extra + 1)),
        button('p+5', '+5', 60, false, () => sendAdminPlayers(dev.extra + 5)),
        button('p0', 'None', 88, dev.extra === 0, () => sendAdminPlayers(0))
      ])}

      {/* Wind */}
      {heading('WIND', windText)}
      {row(
        'wind-dirs',
        WIND_DIRS.map((d) =>
          button(`w-${d.dir}`, d.label, 176, !!heldDir && heldDir.dir === d.dir && wind.speed > 0.1, () =>
            sendAdminWind(d.dir, Math.max(wind.speed, WIND_STEP * 2), true)
          )
        )
      )}
      {row('wind-speed', [
        button('w-less', '- 2 mph', 84, false, () => sendAdminWind(wind.dir, Math.max(0, wind.speed - WIND_STEP), true)),
        button('w-more', '+ 2 mph', 84, false, () => sendAdminWind(wind.dir, wind.speed + WIND_STEP, true)),
        button('w-calm', 'Calm', 84, wind.ready && wind.speed < 0.1, () => sendAdminWind(wind.dir, 0, true)),
        button('w-rnd', 'Random', 84, !dev.windHold, () => sendAdminWind(0, -1, false))
      ])}
    </UiEntity>
  )
}
