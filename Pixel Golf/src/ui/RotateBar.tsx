/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity } from '@dcl/sdk/react-ecs'
import {progressValue, viewRotate} from '../game'
import { Color4 } from '@dcl/sdk/math'

export interface State {}
export const state: State = {}

export function RotateBar(props: {}) {

  let barVisable: 'none' | 'flex'
  barVisable = viewRotate ? 'flex' : 'none'

  return(
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        margin: { left: 150 },
        display: barVisable,
      }}
    >
      {/* Progress Bar Background / Track */}
      <UiEntity
        uiTransform={{
          width: 300,
          height: 30,
          padding: { top: 4, bottom: 4, left: 4, right: 4 },
        }}
        uiBackground={{
          color: Color4.Gray(),
        }}
      >
        {/* Inner Progress Fill */}
        <UiEntity
          uiTransform={{
            height: '100%',
            width: '5%',
            position: {left: `${progressValue}%`}
          }}
          uiBackground={{
            color: Color4.Green(),
          }}
        />
      </UiEntity>
    </UiEntity>
  )
}