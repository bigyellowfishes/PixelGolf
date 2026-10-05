/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity, Label } from '@dcl/sdk/react-ecs'

export interface State {}
export const state: State = {}

export function MainUI(props: {}) {
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: 0, right: 0, bottom: 0, left: 0 } }}
    >
      <Label
        font="sans-serif"
        /* @ui-name Label */ value="TEST"
        fontSize={24}
        uiTransform={{
          positionType: 'absolute',
          position: { top: 0, left: 0 },
          width: 200,
          height: 36,
        }}
      />
    </UiEntity>
  )
}
