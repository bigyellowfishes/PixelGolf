/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

export interface State {}
export const state: State = {}

export function MainUI(props: {}) {
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        width: '100%',
        height: '100%',
      }}
      uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.0 } }}
    >
    </UiEntity>
  )
}