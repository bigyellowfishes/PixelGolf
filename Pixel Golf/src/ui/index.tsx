/** @jsx ReactEcs.createElement */
import ReactEcs, { UiEntity, ReactEcsRenderer, ScreenInsetArea } from '@dcl/sdk/react-ecs'
import { BallCamToggle } from './BallCamToggle'
import { ClubSelectMenu } from './ClubSelectMenu'
import { GameModeMenu } from './GameModeMenu'
import { MainUI } from './MainUI'
import { PowerBar } from './PowerBar'
import { RotateBar } from './RotateBar'
import { Score } from './Score'
import { SettingsMenu } from './SettingsMenu'
import { ShotPrompt } from './ShotPrompt'

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(() => (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      <ScreenInsetArea>
        <BallCamToggle />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <ClubSelectMenu />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <GameModeMenu />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <MainUI />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <PowerBar />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <RotateBar />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <Score />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <SettingsMenu />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <ShotPrompt />
      </ScreenInsetArea>
    </UiEntity>
  ))
}
