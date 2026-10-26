/** @jsx ReactEcs.createElement */
import ReactEcs from '@dcl/sdk/react-ecs'
import { UiEntity } from '@dcl/sdk/react-ecs'
import {curScore, curRound} from '../game'
import { Color4 } from '@dcl/sdk/math'
import { onPhone } from '../mobile'
import { FONT_BOLD } from '../fonts'

export interface State {}
export const state: State = {}

export function Score(props: {}) {
  return(
    // Root Full-Screen Overlay Container
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'flex-start',
        margin: { top: 50 },
        // Not on phones: the range card already shows the ball count and score
        display: onPhone() ? 'none' : 'flex',
      }}
    >
      {/* 2. Progress Bar Background / Track */}
      <UiEntity
        uiTransform={{
          width: 300,
          height: 50,
          padding: { top: 4, bottom: 4, left: 4, right: 4 },
          justifyContent: 'center',
          alignItems: 'center',
        }}
        uiBackground={{
          color: Color4.Gray(),
        }}
      >
        {/* Round Text */}
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
          }}
          uiText={{
            value: `Score: ${curScore}`,
            fontSize: 14,
            font: 'sans-serif',
            fontSrc: FONT_BOLD,
            textAlign: 'middle-center', // 'top-left', 'middle-center', 'bottom-right', etc.
            color: Color4.White(),
          }}
        />
        {/* Score Text */}
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
          }}
          uiText={{
            value: `Shot: ${curRound}`,
            fontSize: 14,
            font: 'sans-serif',
            fontSrc: FONT_BOLD,
            textAlign: 'middle-center', // 'top-left', 'middle-center', 'bottom-right', etc.
            color: Color4.White(),
          }}
        />
      </UiEntity>
    </UiEntity>
  )
}