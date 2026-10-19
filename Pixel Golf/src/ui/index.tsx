/** @jsx ReactEcs.createElement */
import ReactEcs, { UiEntity, ReactEcsRenderer, ScreenInsetArea } from '@dcl/sdk/react-ecs'
import { BallCamToggle } from './BallCamToggle'
import { ClubSelectMenu } from './ClubSelectMenu'
import { GameModeMenu } from './GameModeMenu'
import { LeaderboardMenu } from './LeaderboardMenu'
import { MainUI } from './MainUI'
import { PowerBar } from './PowerBar'
import { RangeHud } from './RangeHud'
import { RotateBar } from './RotateBar'
import { RoundResult } from './RoundResult'
import { SettingsMenu } from './SettingsMenu'
import { ShotPrompt } from './ShotPrompt'
import { ShopMenu } from './ShopMenu'
import { SkipTutorial } from './SkipTutorial'
import { SpeedToggle } from './SpeedToggle'

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
        <LeaderboardMenu />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <MainUI />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <PowerBar />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <RangeHud />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <RotateBar />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <RoundResult />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <SettingsMenu />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <ShotPrompt />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <ShopMenu />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <SkipTutorial />
      </ScreenInsetArea>
      <ScreenInsetArea>
        <SpeedToggle />
      </ScreenInsetArea>
    </UiEntity>
  ))
}
