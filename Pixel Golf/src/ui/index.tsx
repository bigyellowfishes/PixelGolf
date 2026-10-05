/** @jsx ReactEcs.createElement */
import ReactEcs, { UiEntity, ReactEcsRenderer, ScreenInsetArea } from '@dcl/sdk/react-ecs'
import { BallCamToggle } from './BallCamToggle'
import { PowerBar } from './PowerBar'
import { RotateBar } from './RotateBar'
import { MainUI } from './MainUI'
import { Score } from './Score'
import { ShotPrompt } from './ShotPrompt'

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(() => (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      <ScreenInsetArea>
        <BallCamToggle />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <PowerBar />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <RotateBar />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <MainUI />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <Score />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <ShotPrompt />
      </ScreenInsetArea>
    </UiEntity>
  ))
}
