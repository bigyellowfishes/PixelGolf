/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { ballCamEnabled, toggleBallCam } from '../game'
import { Color4 } from '@dcl/sdk/math'

export function BallCamToggle(props: {}) {
  return (
    <UiEntity
    uiTransform={{
      width: '100%',
      height: '100%',
      positionType: 'absolute',
      justifyContent: 'center',
      alignItems: 'flex-start',
      margin: { top: 108 }
    }}
  >
    <UiEntity
      uiTransform={{ width: 200, height: 34 }}
      uiBackground={{ color: ballCamEnabled ? Color4.create(0.1, 0.45, 0.2, 0.85) : Color4.create(0, 0, 0, 0.65) }}
      uiText={{
        value: `Ball cam: ${ballCamEnabled ? 'ON' : 'OFF'}  [1]`,
        fontSize: 15,
        textAlign: 'middle-center',
        color: Color4.White()
      }}
      onMouseDown={() => toggleBallCam()}
    />
  </UiEntity>
  )
}