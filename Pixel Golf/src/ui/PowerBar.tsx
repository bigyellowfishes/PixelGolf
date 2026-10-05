/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity } from '@dcl/sdk/react-ecs'
import {progressValue, viewPower} from '../game'
import { Color4 } from '@dcl/sdk/math'

export interface State {}
export const state: State = {}

export function PowerBar(props: {}) {
  let barVisable: 'none' | 'flex' = viewPower ? 'flex' : 'none'

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        margin: { left: -100, top: 200 },
        display: barVisable,
      }}
    >
      {/* Progress Bar Background / Track */}
      <UiEntity
        uiTransform={{
          width: 30,
          height: 300,
          padding: { top: 4, bottom: 4, left: 4, right: 4 },
          flexDirection: 'column',
          justifyContent: 'flex-end',
        }}
        uiBackground={{
          color: Color4.Gray(),
        }}
      >
        {/* Inner Progress Fill */}
        <UiEntity
          uiTransform={{
            height: `${progressValue}%`,
            width: '100%',
          }}
          uiBackground={{
            color: Color4.Green(),
          }}
        />
      </UiEntity>
    </UiEntity>
  )
}