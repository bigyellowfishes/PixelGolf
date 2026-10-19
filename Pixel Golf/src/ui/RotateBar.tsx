/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity } from '@dcl/sdk/react-ecs'

export interface State {}
export const state: State = {}

// The curve meter is now a row of the swing meters panel in PowerBar.tsx, so both meters sit
// together low in the middle of the screen. This draws nothing and is kept so ui/index.tsx
// doesn't need to change.
export function RotateBar(props: {}) {
  return <UiEntity uiTransform={{ display: 'none' }} />
}
