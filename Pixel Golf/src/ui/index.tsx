/** @jsx ReactEcs.createElement */
import ReactEcs, { UiEntity, ReactEcsRenderer, ScreenInsetArea } from '@dcl/sdk/react-ecs'
import { ClubSelectMenu, state as clubMenu } from './ClubSelectMenu'
import { GameModeMenu, state as gameModeMenu } from './GameModeMenu'
import { LeaderboardMenu, state as boardsMenu } from './LeaderboardMenu'
import { PowerBar } from './PowerBar'
import { RangeHud } from './RangeHud'
import { RoundResult, state as roundCard } from './RoundResult'
import { SettingsMenu, state as settingsMenu } from './SettingsMenu'
import { ShotPrompt } from './ShotPrompt'
import { ShopMenu } from './ShopMenu'
import { SkipTutorial } from './SkipTutorial'
import { SpeedToggle } from './SpeedToggle'
import { DevPanel, devPanel } from './DevPanel'
import { ReplayTutorialPrompt, state as replayPrompt } from './ReplayTutorialPrompt'
import { BackpackMenu, state as backpack } from './BackpackMenu'
import { HatFitPanel, state as hatFit } from './HatFitPanel'
import { AfkPrompt } from './AfkPrompt'
import { AfkHud } from './AfkHud'
import { afk } from '../afk'
import { ShotFeed } from './ShotFeed'
import { feed } from '../shotFeed'
import { shop } from '../shop'
import { tutorial } from '../ledger/client'
import { meters, shotSpeedShown } from '../game'

// Speed: the UI is rebuilt every frame, so a menu that's closed is left out altogether rather
// than built in full and hidden. Before this, every menu (club picker, Pixel Golf menu,
// leaderboards, settings, shop, round card) was laid out every frame even with all of them shut.
// Each slot stays in the same place (null when closed), so the menus keep their hover states.
// Leaving a menu out only skips drawing it: opening and closing still work the same way.
// (BallCamToggle, RotateBar and MainUI drew nothing, so they're no longer added at all.)
export function setupUi() {
  ReactEcsRenderer.setUiRenderer(() => (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      <ScreenInsetArea>{clubMenu.display === 'flex' ? <ClubSelectMenu /> : null}</ScreenInsetArea>
      <ScreenInsetArea>{gameModeMenu.display === 'flex' ? <GameModeMenu /> : null}</ScreenInsetArea>
      <ScreenInsetArea>{boardsMenu.display === 'flex' ? <LeaderboardMenu /> : null}</ScreenInsetArea>
      <ScreenInsetArea>{meters.showPower || meters.showCurve ? <PowerBar /> : null}</ScreenInsetArea>
      <ScreenInsetArea>
        <RangeHud />
      </ScreenInsetArea>
      <ScreenInsetArea>{roundCard.display === 'flex' ? <RoundResult /> : null}</ScreenInsetArea>
      <ScreenInsetArea>{settingsMenu.display === 'flex' ? <SettingsMenu /> : null}</ScreenInsetArea>
      <ScreenInsetArea>
        <ShotPrompt />
      </ScreenInsetArea>
      <ScreenInsetArea>{shop.open ? <ShopMenu /> : null}</ScreenInsetArea>
      <ScreenInsetArea>{tutorial.active ? <SkipTutorial /> : null}</ScreenInsetArea>
      <ScreenInsetArea>{replayPrompt.display === 'flex' ? <ReplayTutorialPrompt /> : null}</ScreenInsetArea>
      <ScreenInsetArea>{backpack.display === 'flex' ? <BackpackMenu /> : null}</ScreenInsetArea>
      <ScreenInsetArea>{hatFit.display === 'flex' ? <HatFitPanel /> : null}</ScreenInsetArea>
      <ScreenInsetArea>{afk.active ? <AfkHud /> : null}</ScreenInsetArea>
      <ScreenInsetArea>{afk.prompt ? <AfkPrompt /> : null}</ScreenInsetArea>
      <ScreenInsetArea>{feed.items.length ? <ShotFeed /> : null}</ScreenInsetArea>
      <ScreenInsetArea>{shotSpeedShown() ? <SpeedToggle /> : null}</ScreenInsetArea>
      {/* Admin only, opened from Settings. Not a menu: the game carries on with it open */}
      <ScreenInsetArea>{devPanel.open ? <DevPanel /> : null}</ScreenInsetArea>
    </UiEntity>
  ))
}
