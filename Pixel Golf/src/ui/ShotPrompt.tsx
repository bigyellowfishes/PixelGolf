/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity } from '@dcl/sdk/react-ecs'
import {getPrompt} from '../game'
import { Color4 } from '@dcl/sdk/math'

export interface State {}
export const state: State = {}

export function ShotPrompt(props: {}) {
  const text = getPrompt()
    return (
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          positionType: 'absolute',
          justifyContent: 'center',
          alignItems: 'center',
          padding: { bottom: 160 },
          display: text ? 'flex' : 'none',
        }}
      >
        <UiEntity
          uiTransform={{
            width: 440,
            height: 56,
          }}
          uiBackground={{
            color: Color4.create(0, 0, 0, 0.65),
          }}
          uiText={{
            value: text,
            fontSize: 22,
            textAlign: 'middle-center',
            color: Color4.White(),
          }}
        />
      </UiEntity>
    )
}