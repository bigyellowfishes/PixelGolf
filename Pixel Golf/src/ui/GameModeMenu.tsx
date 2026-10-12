/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { getPlayer } from '@dcl/sdk/players'
import { useInteraction } from './interaction'
import { openClubSelect } from './ClubSelectMenu'
import { playUi } from '../sfx'

// Pixel Golf game mode menu. Hidden until the player clicks a Tee Off panel
// (see src/teeOffPanels.ts), which calls openPixelGolfMenu().

export interface State {
  display: 'flex' | 'none'
  playerName: string
  level: number
  xp: number
  xpNext: number
  xpWidth: `${number}%`
}

export const state: State = {
  display: 'none',
  playerName: 'Player',
  level: 1,
  xp: 0,
  xpNext: 100,
  xpWidth: '0%'
}

type UiAction = { state: State; props: Parameters<typeof GameModeMenu>[0]; value?: unknown }

export function openPixelGolfMenu() {
  state.display = 'flex'
  playUi('ui_open')
}

/** Sets the level card. Call it from your levelling code whenever XP changes. */
export function setPlayerProgress(level: number, xp: number, xpNext: number) {
  state.level = level
  state.xp = xp
  state.xpNext = xpNext
  const pct = xpNext > 0 ? Math.max(0, Math.min(100, Math.round((xp / xpNext) * 100))) : 0
  state.xpWidth = `${pct}%`
}

// @ui-action
function closeMenu({ state, props }: UiAction) {
  state.display = 'none'
  playUi('ui_close')
}

// @ui-action
function chooseClub({ state, props }: UiAction) {
  state.display = 'none'
  playUi('ui_select')
  openClubSelect(state.playerName, state.level)
}

export function GameModeMenu(props: {}) {
  const player = getPlayer()
  if (player && player.name) state.playerName = player.name

  const closeButton = useInteraction({
    base: {
      uiTransform: {
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 22,
        borderWidth: 2,
        borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
      },
      uiBackground: { color: { r: 1, g: 1, b: 1, a: 1 } },
      onMouseDown: () => closeMenu({ state, props })
    },
    hover: {
      uiTransform: { borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } },
      uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }
    }
  })

  const chooseClubButton = useInteraction({
    base: {
      uiTransform: {
        width: 236,
        height: 56,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 28,
        borderWidth: 3,
        borderColor: { r: 0.11, g: 0.369, b: 0.078, a: 1 }
      },
      uiBackground: { color: { r: 0.165, g: 0.525, b: 0.106, a: 1 } },
      onMouseDown: () => chooseClub({ state, props })
    },
    hover: {
      uiBackground: { color: { r: 0.239, g: 0.659, b: 0.169, a: 1 } }
    },
    press: {
      uiBackground: { color: { r: 0.137, g: 0.451, b: 0.102, a: 1 } }
    }
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
        zIndex: 10,
        display: state.display
      }}
      uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.45 } }}
    >
      {/* Panel */}
      <UiEntity
        uiTransform={{
          width: 1120,
          height: 630,
          flexDirection: 'column',
          borderRadius: 28,
          borderWidth: 4,
          borderColor: { r: 1, g: 1, b: 1, a: 1 },
          overflow: 'hidden'
        }}
        uiBackground={{ color: { r: 0.957, g: 0.969, b: 0.976, a: 1 } }}
      >
        {/* Header */}
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 76,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: { right: 24 },
            borderRadius: { topLeft: 24, topRight: 24 },
            borderWidth: { top: 0, right: 0, bottom: 2, left: 0 },
            borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
          }}
          uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.85 } }}
        >
          <UiEntity
            uiTransform={{
              width: 290,
              height: 48,
              alignItems: 'center',
              padding: { left: 32 },
              borderRadius: { topLeft: 24, bottomRight: 24 }
            }}
            uiBackground={{ color: { r: 0.075, g: 0.533, b: 0.722, a: 1 } }}
          >
            <Label
              value="Choose a Mode"
              fontSize={20}
              color={{ r: 1, g: 1, b: 1, a: 1 }}
              textAlign="middle-left"
              uiTransform={{ width: 240, height: 30 }}
            />
          </UiEntity>
          <UiEntity uiTransform={{ height: 74, flexDirection: 'row', alignItems: 'center' }}>
            <UiEntity
              uiTransform={{ width: 42, height: 56 }}
              uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/logo.png' } }}
            />
            <UiEntity
              uiTransform={{ width: 193, height: 28, margin: { left: 12 } }}
              uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/wordmark.png' } }}
            />
            <UiEntity
              uiTransform={{ width: 2, height: 36, margin: { left: 18, right: 18 } }}
              uiBackground={{ color: { r: 0.835, g: 0.863, b: 0.886, a: 1 } }}
            />
            <UiEntity {...closeButton}>
              <UiEntity
                uiTransform={{ width: 18, height: 18 }}
                uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-close.png' } }}
              />
            </UiEntity>
          </UiEntity>
        </UiEntity>

        {/* Body */}
        <UiEntity
          uiTransform={{
            width: '100%',
            flexGrow: 1,
            flexDirection: 'row',
            padding: { top: 24, right: 32, bottom: 20, left: 32 }
          }}
        >
          {/* Mode list and level card */}
          <UiEntity
            uiTransform={{ width: 360, height: '100%', flexDirection: 'column', justifyContent: 'space-between' }}
          >
            <UiEntity uiTransform={{ width: '100%', flexDirection: 'column' }}>
              {/* Pixel Golf, the selected mode */}
              <UiEntity
                uiTransform={{
                  width: '100%',
                  height: 70,
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: { left: 16, right: 18 },
                  borderRadius: 22,
                  borderWidth: 3,
                  borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 }
                }}
                uiBackground={{ color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }}
              >
                <UiEntity
                  uiTransform={{ width: 40, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 12 }}
                  uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
                >
                  <UiEntity
                    uiTransform={{ width: 28, height: 28 }}
                    uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-flag.png' } }}
                  />
                </UiEntity>
                <Label
                  value="Pixel Golf"
                  fontSize={26}
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ height: 40, flexGrow: 1, margin: { left: 14 } }}
                />
                <UiEntity
                  uiTransform={{ width: 52, height: 24, justifyContent: 'center', alignItems: 'center', borderRadius: 7 }}
                  uiBackground={{ color: { r: 0.137, g: 0.478, b: 0.094, a: 1 } }}
                >
                  <Label
                    value="NEW"
                    fontSize={12}
                    font="monospace"
                    color={{ r: 1, g: 1, b: 1, a: 1 }}
                    textAlign="middle-center"
                    uiTransform={{ width: 52, height: 24 }}
                  />
                </UiEntity>
              </UiEntity>

              {/* Locked slots */}
              <UiEntity
                uiTransform={{
                  width: '100%',
                  height: 62,
                  flexDirection: 'row',
                  alignItems: 'center',
                  margin: { top: 12 },
                  padding: { left: 22 },
                  borderRadius: 20,
                  borderWidth: 2,
                  borderColor: { r: 0.765, g: 0.804, b: 0.835, a: 1 }
                }}
                uiBackground={{ color: { r: 0.933, g: 0.945, b: 0.957, a: 1 } }}
              >
                <UiEntity
                  uiTransform={{ width: 20, height: 20 }}
                  uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-lock.png' } }}
                />
                <Label
                  value="Coming soon"
                  fontSize={19}
                  color={{ r: 0.431, g: 0.482, b: 0.533, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: 220, height: 30, margin: { left: 12 } }}
                />
              </UiEntity>
              <UiEntity
                uiTransform={{
                  width: '100%',
                  height: 62,
                  flexDirection: 'row',
                  alignItems: 'center',
                  margin: { top: 12 },
                  padding: { left: 22 },
                  borderRadius: 20,
                  borderWidth: 2,
                  borderColor: { r: 0.765, g: 0.804, b: 0.835, a: 1 }
                }}
                uiBackground={{ color: { r: 0.933, g: 0.945, b: 0.957, a: 1 } }}
              >
                <UiEntity
                  uiTransform={{ width: 20, height: 20 }}
                  uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-lock.png' } }}
                />
                <Label
                  value="Coming soon"
                  fontSize={19}
                  color={{ r: 0.431, g: 0.482, b: 0.533, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: 220, height: 30, margin: { left: 12 } }}
                />
              </UiEntity>
              <UiEntity
                uiTransform={{
                  width: '100%',
                  height: 62,
                  flexDirection: 'row',
                  alignItems: 'center',
                  margin: { top: 12 },
                  padding: { left: 22 },
                  borderRadius: 20,
                  borderWidth: 2,
                  borderColor: { r: 0.765, g: 0.804, b: 0.835, a: 1 }
                }}
                uiBackground={{ color: { r: 0.933, g: 0.945, b: 0.957, a: 1 } }}
              >
                <UiEntity
                  uiTransform={{ width: 20, height: 20 }}
                  uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-lock.png' } }}
                />
                <Label
                  value="Coming soon"
                  fontSize={19}
                  color={{ r: 0.431, g: 0.482, b: 0.533, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: 220, height: 30, margin: { left: 12 } }}
                />
              </UiEntity>
            </UiEntity>

            {/* Player level card */}
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 104,
                flexDirection: 'row',
                alignItems: 'center',
                padding: { left: 16, right: 18 },
                borderRadius: 22,
                borderWidth: 2,
                borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <UiEntity
                uiTransform={{
                  width: 58,
                  height: 58,
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: 18,
                  borderWidth: 3,
                  borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 }
                }}
                uiBackground={{ color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }}
              >
                <Label
                  value="LV"
                  fontSize={10}
                  color={{ r: 0.051, g: 0.416, b: 0.565, a: 1 }}
                  textAlign="middle-center"
                  uiTransform={{ width: 40, height: 14 }}
                />
                <Label
                  value={`${state.level}`}
                  fontSize={24}
                  font="monospace"
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-center"
                  uiTransform={{ width: 50, height: 28 }}
                />
              </UiEntity>
              <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column', margin: { left: 14 } }}>
                <UiEntity uiTransform={{ width: '100%', height: 24, flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Label
                    value={state.playerName}
                    fontSize={18}
                    color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                    textAlign="middle-left"
                    uiTransform={{ width: 150, height: 24 }}
                  />
                  <Label
                    value={`${state.xp} / ${state.xpNext} XP`}
                    fontSize={13}
                    font="monospace"
                    color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                    textAlign="middle-right"
                    uiTransform={{ width: 110, height: 24 }}
                  />
                </UiEntity>
                <UiEntity
                  uiTransform={{ width: '100%', height: 10, margin: { top: 8 }, borderRadius: 5 }}
                  uiBackground={{ color: { r: 0.882, g: 0.91, b: 0.929, a: 1 } }}
                >
                  <UiEntity
                    uiTransform={{ width: state.xpWidth, height: '100%', borderRadius: 5 }}
                    uiBackground={{ color: { r: 0.161, g: 0.694, b: 0.898, a: 1 } }}
                  />
                </UiEntity>
                <Label
                  value="Level up to unlock new clubs and balls"
                  fontSize={13}
                  color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 20, margin: { top: 6 } }}
                />
              </UiEntity>
            </UiEntity>
          </UiEntity>

          {/* Preview and description */}
          <UiEntity uiTransform={{ flexGrow: 1, height: '100%', flexDirection: 'column', margin: { left: 28 } }}>
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 300,
                padding: 6,
                borderRadius: 28,
                borderWidth: 3,
                borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 }
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <UiEntity
                uiTransform={{ width: '100%', height: '100%', borderRadius: 22 }}
                uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/range-preview.jpg' } }}
              >
                <UiEntity
                  uiTransform={{
                    width: 132,
                    height: 30,
                    positionType: 'absolute',
                    position: { top: 14, left: 14 },
                    justifyContent: 'center',
                    alignItems: 'center',
                    borderRadius: 15
                  }}
                  uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.94 } }}
                >
                  <Label
                    value="Driving Range"
                    fontSize={14}
                    color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                    textAlign="middle-center"
                    uiTransform={{ width: 132, height: 30 }}
                  />
                </UiEntity>
              </UiEntity>
            </UiEntity>
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 110,
                flexDirection: 'column',
                margin: { top: 16 },
                padding: { top: 14, right: 22, bottom: 14, left: 22 },
                borderRadius: 22,
                borderWidth: 2,
                borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <Label
                value="Pixel Golf"
                fontSize={21}
                color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                textAlign="middle-left"
                uiTransform={{ width: '100%', height: 28 }}
              />
              <Label
                value="Step into the bay and land your shot on the target greens. The closer to the pin, the bigger the points. Level up to unlock new clubs and balls."
                fontSize={14}
                textWrap="wrap"
                color={{ r: 0.29, g: 0.341, b: 0.388, a: 1 }}
                textAlign="top-left"
                uiTransform={{ width: '100%', height: 50, margin: { top: 4 } }}
              />
            </UiEntity>
          </UiEntity>
        </UiEntity>

        {/* Footer */}
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 84,
            flexDirection: 'row',
            justifyContent: 'flex-end',
            alignItems: 'center',
            padding: { right: 32 },
            borderRadius: { bottomLeft: 24, bottomRight: 24 },
            borderWidth: { top: 2, right: 0, bottom: 0, left: 0 },
            borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
          }}
          uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.85 } }}
        >
          <UiEntity {...chooseClubButton}>
            <Label
              value="Choose Club"
              fontSize={22}
              color={{ r: 1, g: 1, b: 1, a: 1 }}
              textAlign="middle-center"
              uiTransform={{ width: 150, height: 30 }}
            />
            <UiEntity
              uiTransform={{ width: 20, height: 20, margin: { left: 6 } }}
              uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-arrow.png' } }}
            />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
