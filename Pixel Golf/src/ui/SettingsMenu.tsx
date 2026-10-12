/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { useInteraction } from './interaction'
import { ballCamEnabled, orbitCamEnabled, toggleBallCam, toggleOrbitCam } from '../game'
import { playUi } from '../sfx'

// Settings button (top of the screen, under the score) and the Settings panel it opens.
// Holds the Ball cam on/off switch (key 1 still toggles it too) and the Orbit camera switch.

export interface State {
  display: 'flex' | 'none'
  ballCamOn: boolean
  orbitCamOn: boolean
  ballCamLabel: string
  orbitCamLabel: string
}

export const state: State = {
  display: 'none',
  ballCamOn: true,
  orbitCamOn: false,
  ballCamLabel: 'On',
  orbitCamLabel: 'Off'
}

type UiAction = { state: State; props: Parameters<typeof SettingsMenu>[0]; value?: unknown }

// @ui-action
function openSettings({ state, props }: UiAction) {
  state.display = state.display === 'flex' ? 'none' : 'flex'
  playUi(state.display === 'flex' ? 'ui_open' : 'ui_close')
}

// @ui-action
function closeSettings({ state, props }: UiAction) {
  state.display = 'none'
  playUi('ui_close')
}

// @ui-action
function switchBallCam({ state, props }: UiAction) {
  toggleBallCam()
  playUi('ui_click')
}

// @ui-action
function switchOrbitCam({ state, props }: UiAction) {
  toggleOrbitCam()
  playUi('ui_click')
}

export function SettingsMenu(props: {}) {
  // The settings live in game.ts; mirror them here for the switches and labels
  state.ballCamOn = ballCamEnabled
  state.orbitCamOn = orbitCamEnabled
  state.ballCamLabel = ballCamEnabled ? 'On' : 'Off'
  state.orbitCamLabel = orbitCamEnabled ? 'On' : 'Off'

  const settingsButton = useInteraction({
    base: {
      uiTransform: {
        width: 150,
        height: 38,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 19,
        borderWidth: 2,
        borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
      },
      uiBackground: { color: { r: 1, g: 1, b: 1, a: 0.95 } },
      onMouseDown: () => openSettings({ state, props })
    },
    hover: {
      uiTransform: { borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } },
      uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }
    }
  })

  const closeButton = useInteraction({
    base: {
      uiTransform: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 20,
        borderWidth: 2,
        borderColor: { r: 0.788, g: 0.827, b: 0.859, a: 1 }
      },
      uiBackground: { color: { r: 1, g: 1, b: 1, a: 1 } },
      onMouseDown: () => closeSettings({ state, props })
    },
    hover: {
      uiTransform: { borderColor: { r: 0.161, g: 0.694, b: 0.898, a: 1 } },
      uiBackground: { color: { r: 0.839, g: 0.949, b: 0.988, a: 1 } }
    }
  })

  const ballCamSwitch = useInteraction(
    {
      base: {
        uiTransform: {
          width: 76,
          height: 38,
          flexDirection: 'row',
          justifyContent: 'flex-start',
          alignItems: 'center',
          padding: { left: 4, right: 4 },
          borderRadius: 19
        },
        uiBackground: { color: { r: 0.765, g: 0.804, b: 0.835, a: 1 } },
        onMouseDown: () => switchBallCam({ state, props })
      },
      active: {
        uiTransform: { justifyContent: 'flex-end' },
        uiBackground: { color: { r: 0.165, g: 0.525, b: 0.106, a: 1 } }
      }
    },
    state.ballCamOn
  )

  const orbitCamSwitch = useInteraction(
    {
      base: {
        uiTransform: {
          width: 76,
          height: 38,
          flexDirection: 'row',
          justifyContent: 'flex-start',
          alignItems: 'center',
          padding: { left: 4, right: 4 },
          borderRadius: 19
        },
        uiBackground: { color: { r: 0.765, g: 0.804, b: 0.835, a: 1 } },
        onMouseDown: () => switchOrbitCam({ state, props })
      },
      active: {
        uiTransform: { justifyContent: 'flex-end' },
        uiBackground: { color: { r: 0.165, g: 0.525, b: 0.106, a: 1 } }
      }
    },
    state.orbitCamOn
  )

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        flexDirection: 'column',
        alignItems: 'center',
        pointerFilter: 'none',
        zIndex: 10
      }}
    >
      {/* Settings button, where the Ball cam button used to be */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          positionType: 'absolute',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: { top: 108 },
          pointerFilter: 'none'
        }}
      >
        <UiEntity {...settingsButton}>
          <UiEntity
            uiTransform={{ width: 20, height: 20 }}
            uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-settings.png' } }}
          />
          <Label
            value="Settings"
            fontSize={15}
            color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
            textAlign="middle-left"
            uiTransform={{ width: 80, height: 30, margin: { left: 8 } }}
          />
        </UiEntity>
      </UiEntity>

      {/* Settings panel */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          positionType: 'absolute',
          justifyContent: 'center',
          alignItems: 'center',
          pointerFilter: 'block',
          display: state.display
        }}
        uiBackground={{ color: { r: 0, g: 0, b: 0, a: 0.35 } }}
      >
        <UiEntity
          uiTransform={{
            width: 560,
            height: 330,
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
              height: 64,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              padding: { right: 14 },
              borderRadius: { topLeft: 24, topRight: 24 },
              borderWidth: { top: 0, right: 0, bottom: 2, left: 0 },
              borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
            }}
            uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.85 } }}
          >
            <UiEntity
              uiTransform={{
                width: 210,
                height: 44,
                alignItems: 'center',
                padding: { left: 26 },
                borderRadius: { topLeft: 24, bottomRight: 22 }
              }}
              uiBackground={{ color: { r: 0.075, g: 0.533, b: 0.722, a: 1 } }}
            >
              <Label
                value="Settings"
                fontSize={19}
                color={{ r: 1, g: 1, b: 1, a: 1 }}
                textAlign="middle-left"
                uiTransform={{ width: 160, height: 30 }}
              />
            </UiEntity>
            <UiEntity uiTransform={{ height: 62, alignItems: 'center' }}>
              <UiEntity {...closeButton}>
                <UiEntity
                  uiTransform={{ width: 16, height: 16 }}
                  uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/menus/icon-close.png' } }}
                />
              </UiEntity>
            </UiEntity>
          </UiEntity>

          {/* Rows */}
          <UiEntity uiTransform={{ width: '100%', flexGrow: 1, flexDirection: 'column', padding: { top: 18, right: 24, bottom: 20, left: 24 } }}>
            {/* Ball cam */}
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 106,
                flexDirection: 'row',
                alignItems: 'center',
                padding: { left: 20, right: 18 },
                borderRadius: 20,
                borderWidth: 2,
                borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column' }}>
                <Label
                  value="Ball cam"
                  fontSize={20}
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 28 }}
                />
                <Label
                  value="Follow the ball after each shot. Key 1 also switches it."
                  fontSize={13}
                  textWrap="wrap"
                  color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                  textAlign="top-left"
                  uiTransform={{ width: 330, height: 40, margin: { top: 4 } }}
                />
              </UiEntity>
              <Label
                value={state.ballCamLabel}
                fontSize={14}
                color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                textAlign="middle-right"
                uiTransform={{ width: 36, height: 38, margin: { right: 10 } }}
              />
              <UiEntity {...ballCamSwitch}>
                <UiEntity
                  uiTransform={{ width: 30, height: 30, borderRadius: 15 }}
                  uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
                />
              </UiEntity>
            </UiEntity>

            {/* Orbit camera */}
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 106,
                flexDirection: 'row',
                alignItems: 'center',
                margin: { top: 14 },
                padding: { left: 20, right: 18 },
                borderRadius: 20,
                borderWidth: 2,
                borderColor: { r: 0.835, g: 0.863, b: 0.886, a: 1 }
              }}
              uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
            >
              <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column' }}>
                <Label
                  value="Orbit camera"
                  fontSize={20}
                  color={{ r: 0.118, g: 0.204, b: 0.259, a: 1 }}
                  textAlign="middle-left"
                  uiTransform={{ width: '100%', height: 28 }}
                />
                <Label
                  value="While the ball cam follows a shot: drag or A / D to orbit, W / S to zoom."
                  fontSize={13}
                  textWrap="wrap"
                  color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                  textAlign="top-left"
                  uiTransform={{ width: 330, height: 40, margin: { top: 4 } }}
                />
              </UiEntity>
              <Label
                value={state.orbitCamLabel}
                fontSize={14}
                color={{ r: 0.337, g: 0.388, b: 0.435, a: 1 }}
                textAlign="middle-right"
                uiTransform={{ width: 36, height: 38, margin: { right: 10 } }}
              />
              <UiEntity {...orbitCamSwitch}>
                <UiEntity
                  uiTransform={{ width: 30, height: 30, borderRadius: 15 }}
                  uiBackground={{ color: { r: 1, g: 1, b: 1, a: 1 } }}
                />
              </UiEntity>
            </UiEntity>
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
