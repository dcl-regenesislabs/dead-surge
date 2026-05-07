import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { getExplorerInformation } from '~system/Runtime'
import { getWaveUiState, getWaveCountdownLabel } from './waveManager'
import {
  getPlayerDamageOverlayAlpha,
  getPlayerHp,
  getPlayerLives,
  isPlayerDead,
  MAX_HP,
  MAX_LIVES,
  getRespawnAtMs,
  getRespawnDelay,
  shouldShowDeathOverlay
} from './playerHealth'
import { getZombieCoins } from './zombieCoins'
import { getSweepWarning } from './lavaHazard'
import { getGameTime } from './zombie'
import { isSpeedActive, getSpeedTimeLeft, SPEED_DURATION_SEC } from './speedEffect'
import { isRaging, getRageTimeLeft, RAGE_DURATION_SEC } from './rageEffect'
import { getHealthPickupFeedback } from './potions'
import { beginUiPointerCapture, endUiPointerCapture, isAutoFireEnabled, isTopViewEnabled, isIsoViewEnabled } from './gameplayInput'
import {
  getCurrentWeapon,
  getWeaponUnlockCost,
  isShotgunUnlocked,
  isMinigunUnlocked,
  isWeaponPurchasedInMatch,
  purchaseWeapon,
  switchTo,
  type WeaponType
} from './weaponManager'
import {
  getMiniGunHeatRatio,
  getMiniGunOverheatCooldownRemaining,
  isMiniGunOverheated
} from './miniGun'
import {
  getBrickCost,
  activateBrickTargetMode,
  confirmBrickPlacementFromTargetMode,
  isBrickTargetModeActive
} from './brick'
import { getPlayerGold } from './loadoutState'
import { OutlinedText } from './outlineComponent'
import { LobbyStoreUi, isLobbyStoreOpen, openLobbyStore } from './lobbyStoreUi'
import { isLocalPlayerInsideLobbyTrigger } from './lobbyWorldPanel'
import {
  getLobbyState,
  getMatchRuntimeState,
  getServerLoadingState,
  getPlayerArenaWeapon,
  getPlayerCombatSnapshot,
  getPlayerZcSnapshot,
  getPlayerMatchStatsSnapshot,
  shouldSuppressDeathOverlayForTeamWipe,
  shouldShowGameOverOverlay,
  getLocalAddress,
  isLocalReadyForMatch,
  sendLeaveLobby,
  sendStartGameManual
} from './multiplayer/lobbyClient'
import { LobbyPhase } from './shared/lobbySchemas'
import { LOBBY_RETURN_POSITION } from './shared/roomConfig'
import { MATCH_MAX_PLAYERS, START_GAME_COUNTDOWN_SECONDS } from './shared/matchConfig'
import { getServerTime } from './shared/timeSync'

const PLAYER_HP_FRAME_WIDTH = 581
const PLAYER_HP_FRAME_HEIGHT = 86
const PLAYER_HP_FRAME_UVS = [0.033237, 0.704231, 0.033237, 0.935231, 0.732659, 0.935231, 0.732659, 0.704231]
const PLAYER_HP_FILL_SOURCE_W = 770
const PLAYER_HP_FILL_SOURCE_H = 76
const PLAYER_HP_FILL_OFFSET_X = 177
const PLAYER_HP_FILL_OFFSET_Y = 37
const PLAYER_HP_FILL_UVS = [0.290462, 0.238462, 0.290462, 0.355385, 0.846821, 0.355385, 0.846821, 0.238462]
const PLAYER_HEALTH_FEEDBACK_TOP_GAP = 6
const PLAYER_HEALTH_FEEDBACK_HEIGHT = 28
const PLAYER_LIVES_HEART_HEIGHT = 62
const PLAYER_LIVES_HEART_WIDTH = 68
const PLAYER_LIVES_HEART_GAP = 3
const PLAYER_LIVES_TOP_MARGIN = 24
const PLAYER_HUD_LEFT = 64
const PLAYER_HUD_TOP = 206
const WAVE_ZOMBIES_PANEL_WIDTH = 992
const WAVE_ZOMBIES_PANEL_HEIGHT = 152
const WAVE_ZOMBIES_PANEL_UVS = [0.032514, 0.358462, 0.032514, 0.650769, 0.928468, 0.650769, 0.928468, 0.358462]
const BACK_TO_LOBBY_BUTTON_WIDTH = 127
const BACK_TO_LOBBY_BUTTON_HEIGHT = 94
const BACK_TO_LOBBY_BUTTON_UVS = [0.03396, 0.046154, 0.03396, 0.252308, 0.16474, 0.252308, 0.16474, 0.046154]
const WEAPONS_SHEET_SRC = 'assets/images/WEAPONS2.png'
const WEAPONS_LOCK_SHEET_SRC = 'assets/images/WEAPONS_LOCK2.png'
const WEAPONS_UNLOCK_SHEET_SRC = 'assets/images/WEAPONS_UNLOCK2.png'
const GUN_BUTTON_WIDTH = 184
const GUN_BUTTON_HEIGHT = 143
const GUN_BUTTON_UVS = [0.007813, 0.412109, 0.007813, 0.691406, 0.246745, 0.691406, 0.246745, 0.412109]
const SHOTGUN_BUTTON_WIDTH = 188
const SHOTGUN_BUTTON_HEIGHT = 142
const SHOTGUN_BUTTON_UVS = [0.255209, 0.415039, 0.255209, 0.691406, 0.5, 0.691406, 0.5, 0.415039]
const MINIGUN_BUTTON_WIDTH = 191
const MINIGUN_BUTTON_HEIGHT = 143
const MINIGUN_BUTTON_UVS = [0.746094, 0.413086, 0.746094, 0.691406, 0.994792, 0.691406, 0.994792, 0.413086]
const BRICK_BUTTON_WIDTH = 184
const BRICK_BUTTON_HEIGHT = 141
const BRICK_BUTTON_UVS = [0.501302, 0.415039, 0.501302, 0.690429, 0.740234, 0.690429, 0.740234, 0.415039]
const BRICK_TARGET_RETICLE_WIDTH = 106
const BRICK_TARGET_RETICLE_HEIGHT = 98
const WEAPON_SELECTION_BAR_WIDTH = 92
const WEAPON_SELECTION_BAR_HEIGHT = 6
const WEAPON_BUY_HIGHLIGHT_COLOR = Color4.create(1, 0.84, 0.18, 1)
const MOBILE_WEAPON_BAR_SCALE = 1.1
// WEAPONS_LOCK2.png region: x=853, y=92, w=213, h=196 (1536x1024 atlas, V axis bottom-up in UI UVs)
const BRICK_TARGET_RETICLE_UVS = [0.555339, 0.71875, 0.555339, 0.910156, 0.69401, 0.910156, 0.69401, 0.71875]
const HUD_LOBBY_SHEET_SRC = 'assets/images/HUD_LOBBY2.png'
const HUD_LOBBY_SHEET_WIDTH = 1536
const HUD_LOBBY_SHEET_HEIGHT = 1024
const BLOOD_DAMAGE_FRAME_TEXTURE_SRC = 'assets/images/blood_frame.png'
const DEATH_DAMAGE_FRAME_ALPHA = 1
const DEATH_BACKDROP_ALPHA = 0.42
const GAME_OVER_BACKDROP_ALPHA = 0.58
const DEBUG_SHOW_GAMEPLAY_HUD_IN_LOBBY = false
const DEBUG_LOBBY_MATCH_WAVE = 9
const DEBUG_LOBBY_MATCH_ZOMBIES_LEFT = 23
const DEBUG_LOBBY_MATCH_PHASE_SECONDS = 18
const DEBUG_LOBBY_FAKE_TEAMMATES: Array<{
  address: string
  displayName: string
  hp: number
  isDead: boolean
  respawnSeconds: number
  weaponLabel: string
  kills: number
  gold: number
}> = [
  {
    address: 'debug-teammate-1',
    displayName: 'Mili',
    hp: 6,
    isDead: false,
    respawnSeconds: 0,
    weaponLabel: 'SG',
    kills: 12,
    gold: 18
  },
  {
    address: 'debug-teammate-2',
    displayName: 'Nico',
    hp: 4,
    isDead: false,
    respawnSeconds: 0,
    weaponLabel: 'MG',
    kills: 19,
    gold: 7
  },
  {
    address: 'debug-teammate-3',
    displayName: 'Tomi',
    hp: 0,
    isDead: true,
    respawnSeconds: 5,
    weaponLabel: 'AR',
    kills: 8,
    gold: 24
  },
  {
    address: 'debug-teammate-4',
    displayName: 'Lula',
    hp: 7,
    isDead: false,
    respawnSeconds: 0,
    weaponLabel: 'SG',
    kills: 15,
    gold: 13
  }
]
const LOBBY_HUD_LEFT_MARGIN = 48
const LOBBY_HUD_ITEM_MARGIN_BOTTOM = 28
const LOBBY_HUD_TOP_MARGIN = 32
const LOBBY_HUD_GOLD_SOURCE_WIDTH = 661
const LOBBY_HUD_GOLD_SOURCE_HEIGHT = 174
const LOBBY_HUD_GOLD_WIDTH = Math.round(LOBBY_HUD_GOLD_SOURCE_WIDTH * 0.5)
const LOBBY_HUD_GOLD_HEIGHT = Math.round(LOBBY_HUD_GOLD_SOURCE_HEIGHT * 0.5)
const LOBBY_HUD_GOLD_UVS = createAtlasUvs(425, 335, LOBBY_HUD_GOLD_SOURCE_WIDTH, LOBBY_HUD_GOLD_SOURCE_HEIGHT)
const LOBBY_HUD_SHOP_SOURCE_WIDTH = 814
const LOBBY_HUD_SHOP_SOURCE_HEIGHT = 178
const LOBBY_HUD_SHOP_WIDTH = Math.round(LOBBY_HUD_SHOP_SOURCE_WIDTH * 0.5)
const LOBBY_HUD_SHOP_HEIGHT = Math.round(LOBBY_HUD_SHOP_SOURCE_HEIGHT * 0.5)
const LOBBY_HUD_SHOP_UVS = createAtlasUvs(346, 80, LOBBY_HUD_SHOP_SOURCE_WIDTH, LOBBY_HUD_SHOP_SOURCE_HEIGHT)
const START_GAME_BUTTON_SOURCE_WIDTH = 691
const START_GAME_BUTTON_SOURCE_HEIGHT = 150
const START_GAME_BUTTON_SOURCE_X = 73
const START_GAME_BUTTON_SOURCE_Y = 820
const START_GAME_BUTTON_WIDTH = Math.round(START_GAME_BUTTON_SOURCE_WIDTH * 0.5)
const START_GAME_BUTTON_HEIGHT = Math.round(START_GAME_BUTTON_SOURCE_HEIGHT * 0.5)
const START_GAME_BUTTON_UVS = createAtlasUvs(
  START_GAME_BUTTON_SOURCE_X,
  START_GAME_BUTTON_SOURCE_Y,
  START_GAME_BUTTON_SOURCE_WIDTH,
  START_GAME_BUTTON_SOURCE_HEIGHT
)
const STARTING_GAME_BUTTON_SOURCE_WIDTH = 688
const STARTING_GAME_BUTTON_SOURCE_HEIGHT = 145
const STARTING_GAME_BUTTON_SOURCE_X = 789
const STARTING_GAME_BUTTON_SOURCE_Y = 821
const STARTING_GAME_BUTTON_WIDTH = Math.round(STARTING_GAME_BUTTON_SOURCE_WIDTH * 0.5)
const STARTING_GAME_BUTTON_HEIGHT = Math.round(STARTING_GAME_BUTTON_SOURCE_HEIGHT * 0.5)
const STARTING_GAME_BUTTON_UVS = createAtlasUvs(
  STARTING_GAME_BUTTON_SOURCE_X,
  STARTING_GAME_BUTTON_SOURCE_Y,
  STARTING_GAME_BUTTON_SOURCE_WIDTH,
  STARTING_GAME_BUTTON_SOURCE_HEIGHT
)
const START_GAME_COUNTDOWN_DURATION_MS = START_GAME_COUNTDOWN_SECONDS * 1000
const START_GAME_PROGRESS_BAR_WIDTH = Math.round(STARTING_GAME_BUTTON_WIDTH * 0.9)
const START_GAME_PROGRESS_BAR_HEIGHT = 10
const START_GAME_PROGRESS_BAR_RADIUS = 5
const LOBBY_HUD_GOLD_TOP = Math.round((1080 - (LOBBY_HUD_GOLD_HEIGHT + LOBBY_HUD_ITEM_MARGIN_BOTTOM + LOBBY_HUD_SHOP_HEIGHT)) * 0.5)

type TeamHudPlayerEntry = {
  address: string
  displayName: string
  isLocal: boolean
  hp: number
  hpRatio: number
  isDead: boolean
  respawnAtMs: number
  weaponLabel: string
  weaponTierColor: Color4
  kills: number
  zc: number
  slotIndex: number
}


type AtlasUvs = [number, number, number, number, number, number, number, number]

function createAtlasUvs(x: number, y: number, width: number, height: number): AtlasUvs {
  const left = x / HUD_LOBBY_SHEET_WIDTH
  const right = (x + width) / HUD_LOBBY_SHEET_WIDTH
  const bottom = 1 - (y + height) / HUD_LOBBY_SHEET_HEIGHT
  const top = 1 - y / HUD_LOBBY_SHEET_HEIGHT

  return [left, bottom, left, top, right, top, right, bottom]
}

function scaleUiValue(value: number, scale: number): number {
  return Math.max(1, Math.round(value * scale))
}

function detectMobileUserAgent(): boolean {
  const navigatorLike = (globalThis as { navigator?: { userAgent?: string } }).navigator
  const userAgent = navigatorLike?.userAgent ?? ''
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent)
}


function truncateLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(1, maxLength - 3))}...`
}

function getWeaponShortLabel(weaponType: string, upgradeLevel: number = 1): string {
  const base = weaponType === 'shotgun' ? 'SG' : weaponType === 'minigun' ? 'MG' : 'AR'
  if (upgradeLevel >= 3) return `${base}★`
  if (upgradeLevel >= 2) return `${base}+`
  return base
}

function getWeaponTierColor(upgradeLevel: number): Color4 {
  if (upgradeLevel >= 3) return Color4.create(1.0, 0.82, 0.2, 1)
  if (upgradeLevel >= 2) return Color4.create(0.4, 0.8, 1.0, 1)
  return Color4.create(0.85, 0.85, 0.85, 1)
}

function getHpBarColor(hpRatio: number, isDead: boolean): Color4 {
  if (isDead) return Color4.create(0.72, 0.2, 0.2, 1)
  if (hpRatio <= 0.33) return Color4.create(0.93, 0.36, 0.26, 1)
  if (hpRatio <= 0.66) return Color4.create(0.95, 0.76, 0.24, 1)
  return Color4.create(0.28, 0.88, 0.46, 1)
}

function buildTeamHudEntries(
  rosterPlayers: Array<{ address: string; displayName: string }>,
  currentArenaAddresses: Set<string>,
  localAddress: string,
  timerNowMs: number
): TeamHudPlayerEntry[] {
  const orderedRosterPlayers = rosterPlayers
    .slice(0, MATCH_MAX_PLAYERS)
    .sort((left, right) => {
      if (left.address === localAddress) return -1
      if (right.address === localAddress) return 1
      return 0
    })

  return orderedRosterPlayers.map((player, slotIndex) => {
    const isStillInArena = currentArenaAddresses.has(player.address)
    const combat = getPlayerCombatSnapshot(player.address)
    const weapon = getPlayerArenaWeapon(player.address)
    const stats = getPlayerMatchStatsSnapshot(player.address)
    const gold = player.address === localAddress ? getZombieCoins() : getPlayerZcSnapshot(player.address)
    const hp = isStillInArena
      ? (combat?.hp ?? (player.address === localAddress ? getPlayerHp() : MAX_HP))
      : 0
    const isDead = isStillInArena ? (combat?.isDead ?? false) : true
    const respawnAtMs = combat?.respawnAtMs ?? 0
    const hpRatio = isDead ? 0 : Math.max(0, Math.min(1, hp / MAX_HP))
    const displayName = player.displayName || player.address.slice(0, 6)

    return {
      address: player.address,
      displayName,
      isLocal: player.address === localAddress,
      hp,
      hpRatio,
      isDead,
      respawnAtMs: Math.max(timerNowMs, respawnAtMs),
      weaponLabel: getWeaponShortLabel(weapon.weaponType, weapon.upgradeLevel),
      weaponTierColor: getWeaponTierColor(weapon.upgradeLevel),
      kills: stats.kills,
      zc: gold,
      slotIndex
    }
  })
}

function buildDebugTeamHudEntries(localAddress: string, timerNowMs: number): TeamHudPlayerEntry[] {
  const resolvedLocalAddress = localAddress || 'debug-local-player'
  const localHp = getPlayerHp()
  const localDead = isPlayerDead()
  const localRespawnAtMs = getRespawnAtMs()
  const localWeapon = getCurrentWeapon()

  const localEntry: TeamHudPlayerEntry = {
    address: resolvedLocalAddress,
    displayName: resolvedLocalAddress.slice(0, 6),
    isLocal: true,
    hp: localHp,
    hpRatio: localDead ? 0 : Math.max(0, Math.min(1, localHp / MAX_HP)),
    isDead: localDead,
    respawnAtMs: localRespawnAtMs > 0 ? localRespawnAtMs : timerNowMs,
    weaponLabel: getWeaponShortLabel(localWeapon ?? 'gun', 1),
    weaponTierColor: getWeaponTierColor(1),
    kills: 11,
    zc: getZombieCoins(),
    slotIndex: 0
  }

  const fakeEntries = DEBUG_LOBBY_FAKE_TEAMMATES.map((player, index) => ({
    address: player.address,
    displayName: player.displayName,
    isLocal: false,
    hp: player.hp,
    hpRatio: player.isDead ? 0 : Math.max(0, Math.min(1, player.hp / MAX_HP)),
    isDead: player.isDead,
    respawnAtMs: player.isDead ? timerNowMs + player.respawnSeconds * 1000 : timerNowMs,
    weaponLabel: player.weaponLabel,
    weaponTierColor: getWeaponTierColor(1),
    kills: player.kills,
    zc: player.gold,
    slotIndex: index + 1
  }))

  return [localEntry, ...fakeEntries]
}

let cachedArenaRoster: Array<{ address: string; displayName: string }> = []
let cachedArenaMatchId = ''

function syncCachedArenaRoster(
  nextRoster: Array<{ address: string; displayName: string }>,
  matchId: string
): void {
  if (!matchId) {
    cachedArenaRoster = []
    cachedArenaMatchId = ''
    return
  }

  if (cachedArenaMatchId !== matchId) {
    cachedArenaRoster = [...nextRoster]
    cachedArenaMatchId = matchId
    return
  }

  if (nextRoster.length === 0) return

  const mergedRoster = [...cachedArenaRoster]
  let rosterChanged = false

  for (const player of nextRoster) {
    const existingIndex = mergedRoster.findIndex((entry) => entry.address === player.address)
    if (existingIndex >= 0) {
      if (mergedRoster[existingIndex].displayName !== player.displayName) {
        mergedRoster[existingIndex] = player
        rosterChanged = true
      }
      continue
    }

    mergedRoster.push(player)
    rosterChanged = true
  }

  if (rosterChanged) {
    cachedArenaRoster = mergedRoster
  }
}

let isMobileRuntime = detectMobileUserAgent()
export function isMobile(): boolean { return isMobileRuntime }
let runtimePlatformLookupRequested = false
let serverLoaderWasActive = false
let serverLoaderCompletedUntil = 0

async function resolveRuntimePlatform(): Promise<void> {
  try {
    const info = await getExplorerInformation({})
    const platform = (info.platform ?? '').toLowerCase()
    isMobileRuntime = platform === 'mobile' || (platform === 'web' && detectMobileUserAgent())
  } catch {
    isMobileRuntime = detectMobileUserAgent()
  }
}

function ServerLoadingPanel(props: {
  completed: boolean
  timeSeconds: number
}) {
  const compactLayout = isMobileRuntime
  const pulse = 0.72 + ((Math.sin(props.timeSeconds * 4.8) + 1) * 0.5) * 0.18
  const labelColor = props.completed
    ? Color4.create(0.75, 0.98, 0.8, 1)
    : Color4.create(0.95, 0.83, 0.35, 1)
  const signalBars = [22, 36, 52, 70, 90, 112]
  const activeBarIndex = Math.floor(props.timeSeconds * 5.2) % signalBars.length
  const panelTopOffset = compactLayout ? -10 : -36
  const panelWidth = compactLayout ? 260 : 300
  const panelHeight = compactLayout ? 186 : 170
  const signalWidth = compactLayout ? 114 : 126
  const signalHeight = compactLayout ? 102 : 114
  const signalBottomMargin = compactLayout ? 14 : 24
  const labelHeight = compactLayout ? 34 : 24
  const labelFontSize = compactLayout ? 20 : 17
  const signalBarWidth = 17
  const tallestSignalBar = signalBars[signalBars.length - 1]

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { left: 0, top: panelTopOffset },
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          width: panelWidth,
          height: panelHeight,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: { top: 14, right: 14, bottom: 14, left: 14 },
          borderRadius: 10
        }}
      >
        <UiEntity
          uiTransform={{
            width: signalWidth,
            height: signalHeight,
            margin: { bottom: signalBottomMargin }
          }}
        >
          <UiEntity
            uiTransform={{
              width: '100%',
              height: '100%',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-end'
            }}
          >
            {signalBars.map((height, index) => {
              const isActive = props.completed || index === activeBarIndex
              const color = props.completed
                ? Color4.create(0.33, 0.9, 0.46, 0.95)
                : isActive
                  ? Color4.create(0.79, 0.16, 0.12, pulse)
                  : Color4.create(0.22, 0.08, 0.08, 0.38)

              return (
                <UiEntity
                  key={`signal-bar-${index}`}
                  uiTransform={{
                    width: signalBarWidth,
                    height: '100%',
                    positionType: 'relative'
                  }}
                >
                  <UiEntity
                    uiTransform={{
                      width: signalBarWidth,
                      height,
                      positionType: 'absolute',
                      position: { left: 0, top: tallestSignalBar - height },
                      borderRadius: 4
                    }}
                    uiBackground={{ color }}
                  />
                </UiEntity>
              )
            })}
          </UiEntity>
        </UiEntity>
        <OutlinedText
          uiTransform={{
            width: '100%',
            height: labelHeight,
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiText={{
            value: props.completed ? 'SERVER LINK STABLE' : 'LOADING SERVER',
            fontSize: labelFontSize,
            color: labelColor,
            textAlign: 'middle-center'
          }}
        />
      </UiEntity>
    </UiEntity>
  )
}

export function setupUi() {
  if (!runtimePlatformLookupRequested) {
    runtimePlatformLookupRequested = true
    void resolveRuntimePlatform()
  }
  ReactEcsRenderer.setUiRenderer(uiMenu, { virtualWidth: 1920, virtualHeight: 1080 })
}

export const uiMenu = () => {
  const state = getWaveUiState()
  const lobbyState = getLobbyState()
  const localAddress = getLocalAddress()
  const lobbyStoreOpen = isLobbyStoreOpen()
  const isInArenaRoster = !!localAddress && !!lobbyState?.arenaPlayers.find((p) => p.address === localAddress)
  const matchRuntime = getMatchRuntimeState()
  const inMatchContext = lobbyState?.phase === LobbyPhase.MATCH_CREATED && isInArenaRoster
  const serverLoadingState = getServerLoadingState()
  const isLobbyContext =
    !lobbyState ||
    lobbyState.phase === LobbyPhase.LOBBY ||
    (!isInArenaRoster && !isLocalReadyForMatch())
  const showGameplayHudDebug = DEBUG_SHOW_GAMEPLAY_HUD_IN_LOBBY && isLobbyContext
  const syncedZombiesLeft = matchRuntime?.zombiesAlive ?? 0
  const localReadyForMatch = isLocalReadyForMatch()
  const showGameplayHud = (inMatchContext && localReadyForMatch) || showGameplayHudDebug
  const showLobbyHud = isLobbyContext && !showGameplayHudDebug && !lobbyStoreOpen
  const showBackToLobbyButton = isInArenaRoster && localReadyForMatch
  const showPlayerHealthHud = showGameplayHud
  const timerNowMs = getServerTime()
  const arenaIntroSeconds =
    lobbyState?.arenaIntroEndTimeMs && lobbyState.arenaIntroEndTimeMs > timerNowMs
      ? Math.max(0, Math.ceil((lobbyState.arenaIntroEndTimeMs - timerNowMs) / 1000))
      : 0
  const startCountdownSeconds =
    lobbyState?.countdownEndTimeMs && lobbyState.countdownEndTimeMs > timerNowMs
      ? Math.max(0, Math.ceil((lobbyState.countdownEndTimeMs - timerNowMs) / 1000))
      : 0
  const startCountdownRemainingMs =
    lobbyState?.countdownEndTimeMs && lobbyState.countdownEndTimeMs > timerNowMs
      ? Math.max(0, lobbyState.countdownEndTimeMs - timerNowMs)
      : 0
  const phaseRemainingSeconds = matchRuntime ? Math.max(0, Math.ceil((matchRuntime.phaseEndTimeMs - timerNowMs) / 1000)) : 0
  const showGameOverOverlay = shouldShowGameOverOverlay()
  const countdownLabel = getWaveCountdownLabel()
  const isIdle = state.phase === 'idle'
  const playerDead = isPlayerDead()
  const showDeathOverlay = !shouldSuppressDeathOverlayForTeamWipe() && !showGameOverOverlay && shouldShowDeathOverlay(timerNowMs)
  const showCenteredOverlay = (!isIdle || playerDead) && !inMatchContext && !isLobbyContext && !showGameplayHudDebug
  const showArenaIntroOverlay = inMatchContext && localReadyForMatch && !matchRuntime?.isRunning
  const sweepWarning = showGameplayHud ? getSweepWarning(timerNowMs) : { active: false, remainingMs: 0 }
  const isInZone = !!localAddress && !!lobbyState?.players.find((p) => p.address === localAddress)
  const isInsideLobbyTrigger = isLocalPlayerInsideLobbyTrigger()
  const isStartGameButtonLocked = startCountdownSeconds > 0
  const activeStartGameButtonWidth = isStartGameButtonLocked ? STARTING_GAME_BUTTON_WIDTH : START_GAME_BUTTON_WIDTH
  const activeStartGameButtonHeight = isStartGameButtonLocked ? STARTING_GAME_BUTTON_HEIGHT : START_GAME_BUTTON_HEIGHT
  const activeStartGameButtonUvs = isStartGameButtonLocked ? STARTING_GAME_BUTTON_UVS : START_GAME_BUTTON_UVS
  const startGameProgressRatio = isStartGameButtonLocked
    ? Math.max(0, Math.min(1, 1 - startCountdownRemainingMs / START_GAME_COUNTDOWN_DURATION_MS))
    : 0
  const startGameProgressFillWidth = Math.max(0, Math.round(START_GAME_PROGRESS_BAR_WIDTH * startGameProgressRatio))
  const showStartGameButton =
    isInZone &&
    isInsideLobbyTrigger &&
    !localReadyForMatch &&
    arenaIntroSeconds <= 0 &&
    !(matchRuntime?.isRunning) &&
    !showGameplayHudDebug

  const showZcCounter = showGameplayHud
  const brickTargetModeActive = isBrickTargetModeActive()
  const currentWeapon = getCurrentWeapon()
  const playerGold = getPlayerGold()
  const damageOverlayAlpha = showGameplayHud ? getPlayerDamageOverlayAlpha(timerNowMs) : 0
  const showPersistentDeathFrame = showGameOverOverlay || (playerDead && showDeathOverlay)
  const showDeathBackdrop = showPersistentDeathFrame && !isMobileRuntime
  const combinedDamageOverlayAlpha = showPersistentDeathFrame
    ? DEATH_DAMAGE_FRAME_ALPHA
    : damageOverlayAlpha
  const respawnSecondsLeft = Math.max(0, Math.ceil((getRespawnAtMs() - timerNowMs) / 1000))
  const playerHpRatio = Math.max(0, Math.min(1, getPlayerHp() / MAX_HP))
  const hpFrameScale = PLAYER_HP_FRAME_WIDTH / 968
  const playerHpFillWidth = Math.round(PLAYER_HP_FILL_SOURCE_W * hpFrameScale)
  const playerHpFillHeight = Math.round(PLAYER_HP_FILL_SOURCE_H * hpFrameScale)
  const playerHpFillOffsetX = Math.round(PLAYER_HP_FILL_OFFSET_X * hpFrameScale)
  const playerHpFillOffsetY = Math.round(PLAYER_HP_FILL_OFFSET_Y * hpFrameScale)
  const playerHpFillVisibleWidth = Math.max(0, Math.min(playerHpFillWidth, PLAYER_HP_FRAME_WIDTH - playerHpFillOffsetX))
  const playerHpFillVisibleHeight = Math.max(0, Math.min(playerHpFillHeight, PLAYER_HP_FRAME_HEIGHT - playerHpFillOffsetY))
  const playerHpFillCurrentWidth = Math.max(0, Math.round(playerHpFillVisibleWidth * playerHpRatio))
  const currentGameTime = getGameTime()
  if (serverLoadingState.active) {
    serverLoaderWasActive = true
  } else if (serverLoaderWasActive) {
    serverLoaderCompletedUntil = currentGameTime + 2
    serverLoaderWasActive = false
  }
  const showServerLoader = serverLoadingState.active || currentGameTime < serverLoaderCompletedUntil
  const serverLoaderCompleted = !serverLoadingState.active && currentGameTime < serverLoaderCompletedUntil
  const speedActive = showPlayerHealthHud && isSpeedActive()
  const rageActive = showPlayerHealthHud && isRaging()
  const speedFillRatio = speedActive ? Math.max(0, Math.min(1, getSpeedTimeLeft(currentGameTime) / SPEED_DURATION_SEC)) : 0
  const rageFillRatio = rageActive ? Math.max(0, Math.min(1, getRageTimeLeft(currentGameTime) / RAGE_DURATION_SEC)) : 0
  const effectBarWidth = Math.max(0, Math.round((playerHpFillVisibleWidth - 90) * 1.178))
  const effectBarHeight = 6
  const effectBarCornerRadius = 1
  const effectBarGap = 3
  const speedBarCurrentWidth = Math.max(0, Math.round(effectBarWidth * speedFillRatio))
  const rageBarCurrentWidth = Math.max(0, Math.round(effectBarWidth * rageFillRatio))
  const effectBarOffsetX = playerHpFillOffsetX + 10
  const effectBarBaseTop = playerHpFillOffsetY + playerHpFillVisibleHeight + 10
  const rageBarOffsetTop = effectBarBaseTop
  const speedBarOffsetTop = effectBarBaseTop + (rageActive ? effectBarHeight + effectBarGap : 0)
  const activeEffectBarCount = (rageActive ? 1 : 0) + (speedActive ? 1 : 0)
  const hpHudExtraHeight =
    activeEffectBarCount > 0
      ? activeEffectBarCount * effectBarHeight + Math.max(0, activeEffectBarCount - 1) * effectBarGap + 4
      : 0
  const healthPickupFeedback = showGameplayHud ? getHealthPickupFeedback(currentGameTime) : ''
  const healthFeedbackTop = PLAYER_HP_FRAME_HEIGHT + PLAYER_HEALTH_FEEDBACK_TOP_GAP
  const healthFeedbackBottom = healthPickupFeedback
    ? healthFeedbackTop + PLAYER_HEALTH_FEEDBACK_HEIGHT
    : PLAYER_HP_FRAME_HEIGHT
  const livesRowTop =
    Math.max(PLAYER_HP_FRAME_HEIGHT + hpHudExtraHeight, healthFeedbackBottom) + PLAYER_LIVES_TOP_MARGIN
  const livesRowLeft = 12
  const livesRowWidth =
    MAX_LIVES * PLAYER_LIVES_HEART_WIDTH + Math.max(0, MAX_LIVES - 1) * PLAYER_LIVES_HEART_GAP
  if (inMatchContext && lobbyState?.matchId) {
    syncCachedArenaRoster(lobbyState.arenaPlayers, lobbyState.matchId)
  } else if (!inMatchContext && !showGameplayHudDebug) {
    syncCachedArenaRoster([], '')
  }
  const currentArenaAddresses = new Set((lobbyState?.arenaPlayers ?? []).map((p) => p.address))
  const teamHudEntries =
    showGameplayHud
      ? showGameplayHudDebug
        ? buildDebugTeamHudEntries(localAddress, timerNowMs)
        : cachedArenaRoster.length > 0
          ? buildTeamHudEntries(cachedArenaRoster, currentArenaAddresses, localAddress, timerNowMs)
          : []
      : []
  const teamPanelVisible = teamHudEntries.length > 0
  const teamPanelTop = PLAYER_HUD_TOP + livesRowTop + PLAYER_LIVES_HEART_HEIGHT + (isMobileRuntime ? 12 : 18)
  const teamPanelWidth = isMobileRuntime ? 370 : 440
  const teamPanelHeaderHeight = isMobileRuntime ? 40 : 44
  const teamPanelHeaderFontSize = isMobileRuntime ? 17 : 19
  const teamPanelRowHeight = isMobileRuntime ? 38 : 42
const teamPanelNameWidth = isMobileRuntime ? 100 : 120
  const teamPanelHpWidth = isMobileRuntime ? 80 : 100
  const teamPanelKillsWidth = isMobileRuntime ? 54 : 62
  const teamPanelGoldWidth = isMobileRuntime ? 46 : 54
  const teamPanelWeaponWidth = isMobileRuntime ? 56 : 66
  const teamPanelRowGap = 4
  const teamPanelRowTextSize = isMobileRuntime ? 16 : 18
  const teamPanelHeaderPadding = isMobileRuntime ? 12 : 14
  const teamPanelBodyPadding = isMobileRuntime ? 8 : 10
  const teamPanelHeight =
    teamPanelHeaderHeight +
    6 +
    teamPanelBodyPadding * 2 +
    teamHudEntries.length * teamPanelRowHeight +
    Math.max(0, teamHudEntries.length - 1) * teamPanelRowGap
  const weaponBarScale = isMobileRuntime ? MOBILE_WEAPON_BAR_SCALE : 1
  const weaponBarBottomOffset = scaleUiValue(24, weaponBarScale)
  const weaponBarSidePadding = scaleUiValue(24, weaponBarScale)
  const weaponItemSideMargin = scaleUiValue(19, weaponBarScale)
  const weaponItemBottomMargin = scaleUiValue(14, weaponBarScale)
  const weaponItemBaseExtraHeight = scaleUiValue(20, weaponBarScale)
  const weaponItemSelectedExtraHeight = scaleUiValue(38, weaponBarScale)
  const miniGunBarContainerHeight = scaleUiValue(28, weaponBarScale)
  const miniGunBarLabelHeight = scaleUiValue(16, weaponBarScale)
  const miniGunBarLabelFontSize = scaleUiValue(13, weaponBarScale)
  const miniGunBarMarginBottom = scaleUiValue(8, weaponBarScale)
  const brickTargetReticleWidth = scaleUiValue(BRICK_TARGET_RETICLE_WIDTH, weaponBarScale)
  const brickTargetReticleHeight = scaleUiValue(BRICK_TARGET_RETICLE_HEIGHT, weaponBarScale)
  const brickTargetReticleMarginBottom = scaleUiValue(12, weaponBarScale)
  const weaponSelectionBarWidth = scaleUiValue(WEAPON_SELECTION_BAR_WIDTH, weaponBarScale)
  const weaponSelectionBarHeight = scaleUiValue(WEAPON_SELECTION_BAR_HEIGHT, weaponBarScale)
  const weaponSelectionBarMarginTop = scaleUiValue(8, weaponBarScale)
  const buyLabelWidth = scaleUiValue(60, weaponBarScale)
  const buyLabelHeight = scaleUiValue(22, weaponBarScale)
  const buyLabelHorizontalOffset = scaleUiValue(24, weaponBarScale)
  const buyLabelBottomOffset = scaleUiValue(20, weaponBarScale)
  const buyLabelFontSize = scaleUiValue(16, weaponBarScale)
  const costLabelWidth = scaleUiValue(72, weaponBarScale)
  const costLabelHeight = scaleUiValue(22, weaponBarScale)
  const costLabelHorizontalOffset = scaleUiValue(24, weaponBarScale)
  const costLabelBottomOffset = scaleUiValue(20, weaponBarScale)
  const costLabelFontSize = scaleUiValue(16, weaponBarScale)
  const miniGunHeatRatio = getMiniGunHeatRatio()
  const miniGunOverheated = isMiniGunOverheated()
  const miniGunCooldownRemaining = getMiniGunOverheatCooldownRemaining()
  const miniGunBarWidth = scaleUiValue(128, weaponBarScale)
  const miniGunBarHeight = scaleUiValue(8, weaponBarScale)
  const miniGunBarFillWidth = miniGunBarWidth * miniGunHeatRatio
  const displayWaveNumber = showGameplayHudDebug ? DEBUG_LOBBY_MATCH_WAVE : (matchRuntime?.waveNumber ?? state.currentWave)
  const displayZombiesLeft = showGameplayHudDebug ? DEBUG_LOBBY_MATCH_ZOMBIES_LEFT : syncedZombiesLeft
  const displayPhaseRemainingSeconds = showGameplayHudDebug ? DEBUG_LOBBY_MATCH_PHASE_SECONDS : phaseRemainingSeconds

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start'
      }}
    >
      <UiEntity
        uiTransform={{
          width: 1,
          height: 1,
          positionType: 'absolute',
          position: { left: 0, top: 0 }
        }}
        uiBackground={{
          color: Color4.create(1, 1, 1, 0),
          textureMode: 'stretch',
          texture: { src: BLOOD_DAMAGE_FRAME_TEXTURE_SRC, filterMode: 'bi-linear', wrapMode: 'clamp' }
        }}
      />
      {combinedDamageOverlayAlpha > 0.01 && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
            positionType: 'absolute',
            position: { left: 0, top: 0 }
          }}
          uiBackground={{
            color: Color4.create(1, 1, 1, combinedDamageOverlayAlpha),
            textureMode: 'stretch',
            texture: { src: BLOOD_DAMAGE_FRAME_TEXTURE_SRC, filterMode: 'bi-linear', wrapMode: 'clamp' }
          }}
        />
      )}
      {showDeathBackdrop && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
            positionType: 'absolute',
            position: { left: 0, top: 0 }
          }}
          uiBackground={{
            color: Color4.create(0.08, 0.01, 0.01, showGameOverOverlay ? GAME_OVER_BACKDROP_ALPHA : DEATH_BACKDROP_ALPHA)
          }}
        />
      )}
      {(rageActive || speedActive) && (
        <UiEntity
          uiTransform={{
            position: { top: 186, left: 0 },
            positionType: 'absolute',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%'
          }}
        >
          {rageActive && (
            <UiEntity
              uiTransform={{
                width: 260,
                height: 36,
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <UiEntity
                uiTransform={{ width: '100%', height: '100%' }}
                uiText={{
                  value: `RAGE • ${Math.ceil(getRageTimeLeft(currentGameTime))}s`,
                  fontSize: 26,
                  color: Color4.create(0.55, 0.08, 0.12, 1),
                  textAlign: 'middle-center'
                }}
              />
            </UiEntity>
          )}
          {speedActive && (
          <UiEntity
            uiTransform={{
              width: 260,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <UiEntity
              uiTransform={{ width: '100%', height: '100%' }}
              uiText={{
                value: `Speed • ${Math.ceil(getSpeedTimeLeft(getGameTime()))}s`,
                fontSize: 26,
                color: Color4.create(0.92, 0.78, 0.08, 1),
                textAlign: 'middle-center'
              }}
            />
          </UiEntity>
          )}
        </UiEntity>
      )}
      {showPlayerHealthHud && (
        <UiEntity
          uiTransform={{
            position: { left: PLAYER_HUD_LEFT, top: PLAYER_HUD_TOP },
            positionType: 'absolute',
            width: PLAYER_HP_FRAME_WIDTH,
            height: livesRowTop + PLAYER_LIVES_HEART_HEIGHT,
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'flex-start'
          }}
        >
            <UiEntity
              uiTransform={{
                width: PLAYER_HP_FRAME_WIDTH,
                height: PLAYER_HP_FRAME_HEIGHT + hpHudExtraHeight,
                positionType: 'relative'
              }}
            >
            <UiEntity
              uiTransform={{
                width: PLAYER_HP_FRAME_WIDTH,
                height: PLAYER_HP_FRAME_HEIGHT,
                positionType: 'absolute',
                position: { left: 0, top: 0 }
              }}
              uiBackground={{
                textureMode: 'stretch',
                texture: { src: 'assets/images/HUD2.png', filterMode: 'bi-linear', wrapMode: 'clamp' },
                uvs: PLAYER_HP_FRAME_UVS
              }}
            />
            <UiEntity
              uiTransform={{
                width: playerHpFillVisibleWidth,
                height: playerHpFillVisibleHeight,
                positionType: 'absolute',
                position: { left: playerHpFillOffsetX, top: playerHpFillOffsetY },
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'flex-start'
              }}
            >
              <UiEntity
                uiTransform={{
                  width: playerHpFillCurrentWidth,
                  height: playerHpFillVisibleHeight
                }}
                uiBackground={{
                  textureMode: 'stretch',
                  texture: { src: 'assets/images/HUD2.png', filterMode: 'bi-linear', wrapMode: 'clamp' },
                  uvs: PLAYER_HP_FILL_UVS
                }}
              />
            </UiEntity>
            {rageActive && (
              <UiEntity
                uiTransform={{
                  width: effectBarWidth,
                  height: effectBarHeight,
                  positionType: 'absolute',
                  position: { left: effectBarOffsetX, top: rageBarOffsetTop },
                  borderRadius: effectBarCornerRadius,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'flex-start'
                }}
                uiBackground={{ color: Color4.create(0.23, 0.05, 0.06, 0.92) }}
              >
                <UiEntity
                  uiTransform={{
                    width: rageBarCurrentWidth,
                    height: effectBarHeight,
                    borderRadius: effectBarCornerRadius
                  }}
                  uiBackground={{ color: Color4.create(0.75, 0.1, 0.14, 1) }}
                />
              </UiEntity>
            )}
            {speedActive && (
              <UiEntity
                uiTransform={{
                  width: effectBarWidth,
                  height: effectBarHeight,
                  positionType: 'absolute',
                  position: { left: effectBarOffsetX, top: speedBarOffsetTop },
                  borderRadius: effectBarCornerRadius,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'flex-start'
                }}
                uiBackground={{ color: Color4.create(0.22, 0.16, 0.02, 0.92) }}
              >
                <UiEntity
                  uiTransform={{
                    width: speedBarCurrentWidth,
                    height: effectBarHeight,
                    borderRadius: effectBarCornerRadius
                  }}
                  uiBackground={{ color: Color4.create(0.95, 0.8, 0.12, 1) }}
                />
              </UiEntity>
            )}
          </UiEntity>
          {/* Lives hearts */}
          <UiEntity
            uiTransform={{
              width: livesRowWidth,
              height: PLAYER_LIVES_HEART_HEIGHT,
              positionType: 'absolute',
              position: { left: livesRowLeft, top: livesRowTop },
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'flex-start'
            }}
          >
            {Array.from({ length: MAX_LIVES }).map((_, i) => (
              <UiEntity
                key={`heart_${i}`}
                uiTransform={{
                  width: PLAYER_LIVES_HEART_WIDTH,
                  height: PLAYER_LIVES_HEART_HEIGHT,
                  margin: { right: i < MAX_LIVES - 1 ? PLAYER_LIVES_HEART_GAP : 0 }
                }}
                uiBackground={{
                  textureMode: 'stretch',
                  texture: { src: 'assets/images/heart2.png' },
                  color: i < getPlayerLives() ? Color4.White() : Color4.create(1, 1, 1, 0.25)
                }}
              />
            ))}
          </UiEntity>
        </UiEntity>
      )}
      {showGameplayHud && healthPickupFeedback !== '' && (
        <UiEntity
          uiTransform={{
            position: { left: PLAYER_HUD_LEFT, top: PLAYER_HUD_TOP + healthFeedbackTop },
            positionType: 'absolute',
            width: PLAYER_HP_FRAME_WIDTH,
            height: PLAYER_HEALTH_FEEDBACK_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <UiEntity
            uiTransform={{ width: '100%', height: '100%' }}
            uiText={{
              value: healthPickupFeedback,
              fontSize: 24,
              color: Color4.create(0.3, 1, 0.42, 1),
              textAlign: 'middle-center'
            }}
          />
        </UiEntity>
      )}
      {showZcCounter && (
        <UiEntity
          uiTransform={{
            position: { left: 0, right: 0, top: 24 },
            positionType: 'absolute',
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'center'
          }}
        >
          <UiEntity
            uiTransform={{
              width: WAVE_ZOMBIES_PANEL_WIDTH,
              height: WAVE_ZOMBIES_PANEL_HEIGHT,
              positionType: 'relative'
            }}
            uiBackground={{
              textureMode: 'stretch',
              texture: { src: 'assets/images/HUD2.png', filterMode: 'bi-linear', wrapMode: 'clamp' },
              uvs: WAVE_ZOMBIES_PANEL_UVS
            }}
          >
            <UiEntity
              uiTransform={{
                width: 150,
                height: 40,
                positionType: 'absolute',
                position: { left: 52, top: 54 },
                alignItems: 'flex-start',
                justifyContent: 'center'
              }}
              uiText={{
                value: `${displayPhaseRemainingSeconds}s`,
                fontSize: 36,
                color: Color4.create(1, 0.9, 0.5, 1),
                textAlign: 'middle-left'
              }}
            />
            <UiEntity
              uiTransform={{
                width: 176,
                height: 70,
                positionType: 'absolute',
                position: { left: 158, top: 28 }
              }}
              uiText={{
                value: `${displayWaveNumber}`,
                fontSize: 58,
                color: Color4.create(0.7, 1, 0.45, 1),
                textAlign: 'middle-center'
              }}
            />
            <UiEntity
              uiTransform={{
                width: 176,
                height: 70,
                positionType: 'absolute',
                position: { right: 24, top: 40 }
              }}
              uiText={{
                value: `${displayZombiesLeft}`,
                fontSize: 58,
                color: Color4.create(1, 0.85, 0.35, 1),
                textAlign: 'middle-center'
              }}
            />
          </UiEntity>
        </UiEntity>
      )}
      {teamPanelVisible && (
        <UiEntity
          uiTransform={{
            position: { left: PLAYER_HUD_LEFT, top: teamPanelTop },
            positionType: 'absolute',
            width: teamPanelWidth,
            height: teamPanelHeight,
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'flex-start'
          }}
        >
          <UiEntity
            uiTransform={{
              width: teamPanelWidth,
              height: teamPanelHeaderHeight,
              padding: { left: teamPanelHeaderPadding, right: teamPanelHeaderPadding },
              borderRadius: 8,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'flex-start'
            }}
            uiBackground={{ color: Color4.create(0.06, 0.08, 0.11, 0.82) }}
          >
            <UiEntity
              uiTransform={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'flex-start'
              }}
            >
              <UiEntity
                uiTransform={{ width: teamPanelNameWidth, height: teamPanelHeaderHeight }}
                uiText={{
                  value: `SQUAD ${teamHudEntries.length}/${MATCH_MAX_PLAYERS}`,
                  fontSize: teamPanelHeaderFontSize,
                  color: Color4.create(0.92, 0.94, 0.98, 1),
                  textAlign: 'middle-left'
                }}
              />
              <UiEntity
                uiTransform={{ width: teamPanelHpWidth, height: teamPanelHeaderHeight }}
                uiText={{
                  value: 'STATUS',
                  fontSize: teamPanelHeaderFontSize - 1,
                  color: Color4.create(0.74, 0.89, 1, 1),
                  textAlign: 'middle-center'
                }}
              />
              <UiEntity
                uiTransform={{ width: teamPanelKillsWidth, height: teamPanelHeaderHeight }}
                uiText={{
                  value: 'KILLS',
                  fontSize: teamPanelHeaderFontSize - 1,
                  color: Color4.create(1, 0.84, 0.4, 1),
                  textAlign: 'middle-center'
                }}
              />
              <UiEntity
                uiTransform={{ width: teamPanelGoldWidth, height: teamPanelHeaderHeight }}
                uiText={{
                  value: 'ZC',
                  fontSize: teamPanelHeaderFontSize - 1,
                  color: Color4.create(1, 0.93, 0.54, 1),
                  textAlign: 'middle-center'
                }}
              />
              <UiEntity
                uiTransform={{ width: teamPanelWeaponWidth, height: teamPanelHeaderHeight }}
                uiText={{
                  value: 'WPN',
                  fontSize: teamPanelHeaderFontSize - 1,
                  color: Color4.create(0.95, 0.96, 0.99, 1),
                  textAlign: 'middle-center'
                }}
              />
            </UiEntity>
          </UiEntity>
          <UiEntity
              uiTransform={{
                width: teamPanelWidth,
                minHeight: teamPanelHeight - teamPanelHeaderHeight,
                margin: { top: 6 },
                padding: { top: teamPanelBodyPadding, right: teamPanelBodyPadding, bottom: teamPanelBodyPadding, left: teamPanelBodyPadding },
                borderRadius: 8,
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'flex-start'
              }}
              uiBackground={{ color: Color4.create(0.03, 0.04, 0.06, 0.72) }}
            >
              {teamHudEntries.map((player, index) => {
                const hpFillWidth = Math.max(0, Math.round(teamPanelHpWidth * player.hpRatio))

                return (
                  <UiEntity
                    key={`team-hud-player-${player.address}`}
                    uiTransform={{
                      width: '100%',
                      height: teamPanelRowHeight,
                      margin: { bottom: index < teamHudEntries.length - 1 ? teamPanelRowGap : 0 },
                      padding: { left: 6, right: 6 },
                      borderRadius: 6,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'flex-start'
                    }}
                    uiBackground={{ color: Color4.create(0.12, 0.15, 0.2, player.isLocal ? 0.9 : 0.68) }}
                  >
                    <UiEntity
                      uiTransform={{
                        width: teamPanelNameWidth,
                        height: teamPanelRowHeight,
                        justifyContent: 'center'
                      }}
                      uiText={{
                        value: truncateLabel(player.displayName, 12),
                        fontSize: teamPanelRowTextSize,
                        color: player.isDead ? Color4.create(0.88, 0.58, 0.58, 1) : Color4.create(0.95, 0.96, 0.99, 1),
                        textAlign: 'middle-left'
                      }}
                    />
                    <UiEntity
                      uiTransform={{
                        width: teamPanelHpWidth,
                        height: 14,
                        margin: { right: 14 },
                        borderRadius: 4,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'flex-start'
                      }}
                      uiBackground={{ color: Color4.create(0.16, 0.19, 0.24, 1) }}
                    >
                      <UiEntity
                        uiTransform={{
                          width: hpFillWidth,
                          height: 14,
                          borderRadius: 4
                        }}
                        uiBackground={{ color: getHpBarColor(player.hpRatio, player.isDead) }}
                      />
                    </UiEntity>
                    <UiEntity
                      uiTransform={{
                        width: teamPanelKillsWidth,
                        height: teamPanelRowHeight,
                        margin: { right: 6 },
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <UiEntity
                        uiTransform={{ width: isMobileRuntime ? 14 : 16, height: teamPanelRowHeight, margin: { right: 4 } }}
                        uiText={{
                          value: '\u2620',
                          fontSize: teamPanelRowTextSize - 1,
                          color: Color4.create(0.96, 0.46, 0.42, 1),
                          textAlign: 'middle-center'
                        }}
                      />
                      <UiEntity
                        uiTransform={{ width: teamPanelKillsWidth - (isMobileRuntime ? 18 : 20), height: teamPanelRowHeight }}
                        uiText={{
                          value: `${player.kills}`,
                          fontSize: teamPanelRowTextSize,
                          color: Color4.create(1, 0.84, 0.4, 1),
                          textAlign: 'middle-left'
                        }}
                      />
                    </UiEntity>
                    <UiEntity
                      uiTransform={{
                        width: teamPanelGoldWidth,
                        height: teamPanelRowHeight,
                        margin: { right: 6 },
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      uiText={{
                        value: `${player.zc}`,
                        fontSize: teamPanelRowTextSize - 1,
                        color: Color4.create(1, 0.93, 0.54, 1),
                        textAlign: 'middle-center'
                      }}
                    />
                    <UiEntity
                      uiTransform={{
                        width: teamPanelWeaponWidth,
                        height: teamPanelRowHeight,
                        justifyContent: 'center'
                      }}
                      uiText={{
                        value: player.weaponLabel,
                        fontSize: teamPanelRowTextSize,
                        color: player.weaponTierColor,
                        textAlign: 'middle-center'
                      }}
                    />
                  </UiEntity>
                )
              })}
            </UiEntity>
        </UiEntity>
      )}
      {showZcCounter && (
        <UiEntity
          uiTransform={{
            position: { top: 206, right: 24 },
            positionType: 'absolute',
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'flex-end'
          }}
        >
          <UiEntity
            uiTransform={{
              width: 241,
              height: 107
            }}
            uiBackground={{
              textureMode: 'stretch',
              texture: { src: 'assets/images/HUD2.png', filterMode: 'bi-linear', wrapMode: 'clamp' },
              uvs: [0.765896, 0.72, 0.765896, 0.926154, 0.983382, 0.926154, 0.983382, 0.72]
            }}
          >
            <UiEntity
              uiTransform={{
                width: '100%',
                height: '100%',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                margin: {left: 50}
              }}
              uiText={{
                value: `${getZombieCoins()}`,
                fontSize: 35,
                color: Color4.create(1, 0.85, 0.3, 1),
                textAlign: 'middle-center'
              }}
            />
          </UiEntity>
        </UiEntity>
      )}
      {showArenaIntroOverlay && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
            positionType: 'absolute',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <UiEntity
            uiTransform={{
              width: 780,
              minHeight: 180,
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: { top: 28, bottom: 28, left: 32, right: 32 }
            }}
          >
            {arenaIntroSeconds > 0 && (
              <UiEntity
                uiTransform={{ width: '100%', height: 88 }}
                uiText={{
                  value: `${arenaIntroSeconds}`,
                  fontSize: 60,
                  color: Color4.create(1, 0.92, 0.35, 1),
                  textAlign: 'middle-center'
                }}
              />
            )}
          </UiEntity>
        </UiEntity>
      )}
      {sweepWarning.active && (
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            width: '100%',
            height: '100%',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <UiEntity
            uiTransform={{
              width: 520,
              height: 70,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiBackground={{ color: Color4.create(0.55, 0.1, 0.0, 0.88) }}
            uiText={{
              value: '⚠ LAVA WAVE INCOMING ⚠',
              fontSize: 30,
              color: Color4.create(1, 0.75, 0.1, 1),
              textAlign: 'middle-center'
            }}
          />
        </UiEntity>
      )}
      {showBackToLobbyButton && (
        <UiEntity
          uiTransform={{
            position: { top: 321, right: 24 },
            positionType: 'absolute',
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'flex-end'
          }}
        >
          <UiEntity
            uiTransform={{ width: BACK_TO_LOBBY_BUTTON_WIDTH, height: BACK_TO_LOBBY_BUTTON_HEIGHT }}
            uiBackground={{
              textureMode: 'stretch',
              texture: { src: 'assets/images/HUD2.png', filterMode: 'bi-linear', wrapMode: 'clamp' },
              uvs: BACK_TO_LOBBY_BUTTON_UVS
            }}
            onMouseDown={() => {
              beginUiPointerCapture()
              sendLeaveLobby()
              movePlayerTo({
                newRelativePosition: LOBBY_RETURN_POSITION
              })
            }}
            onMouseUp={endUiPointerCapture}
          />
        </UiEntity>
      )}
      {showStartGameButton && (
        <UiEntity
          uiTransform={{
            position: { bottom: 80, left: 0, right: 0 },
            positionType: 'absolute',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <UiEntity
            uiTransform={{
              width: activeStartGameButtonWidth,
              height: activeStartGameButtonHeight,
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onMouseDown={
              isStartGameButtonLocked
                ? undefined
                : () => {
                    beginUiPointerCapture()
                    sendStartGameManual()
                  }
            }
            onMouseUp={endUiPointerCapture}
          >
            <UiEntity
              uiTransform={{ width: '100%', height: '100%' }}
              uiBackground={{
                textureMode: 'stretch',
                texture: { src: HUD_LOBBY_SHEET_SRC, filterMode: 'tri-linear', wrapMode: 'clamp' },
                uvs: activeStartGameButtonUvs
              }}
            />
          </UiEntity>
          {isStartGameButtonLocked && (
            <UiEntity
              uiTransform={{
                width: START_GAME_PROGRESS_BAR_WIDTH,
                height: START_GAME_PROGRESS_BAR_HEIGHT,
                margin: { top: 10 },
                borderRadius: START_GAME_PROGRESS_BAR_RADIUS,
                justifyContent: 'center'
              }}
              uiBackground={{ color: Color4.create(0.05, 0.17, 0.08, 0.95) }}
            >
              <UiEntity
                uiTransform={{
                  width: startGameProgressFillWidth,
                  height: START_GAME_PROGRESS_BAR_HEIGHT,
                  borderRadius: START_GAME_PROGRESS_BAR_RADIUS
                }}
                uiBackground={{ color: Color4.create(0.15, 0.42, 0.18, 1) }}
              />
            </UiEntity>
          )}
        </UiEntity>
      )}
      {showLobbyHud && (
        <UiEntity
          uiTransform={{
            position: { top: LOBBY_HUD_TOP_MARGIN, left: 0 },
            positionType: 'absolute',
            width: '100%',
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'center',

          }}
        >
          <UiEntity
            uiTransform={{
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <UiEntity
              uiTransform={{
                width: LOBBY_HUD_SHOP_WIDTH,
                height: LOBBY_HUD_SHOP_HEIGHT
              }}
              uiBackground={{
                textureMode: 'stretch',
                texture: { src: HUD_LOBBY_SHEET_SRC, filterMode: 'tri-linear', wrapMode: 'clamp' },
                uvs: LOBBY_HUD_SHOP_UVS
              }}
              onMouseDown={() => {
                beginUiPointerCapture()
                openLobbyStore()
              }}
              onMouseUp={endUiPointerCapture}
            />
          </UiEntity>
        </UiEntity>
      )}
      {showLobbyHud && (
        <UiEntity
          uiTransform={{
            position: { left: isMobileRuntime ? LOBBY_HUD_LEFT_MARGIN + 88 : LOBBY_HUD_LEFT_MARGIN, top: LOBBY_HUD_GOLD_TOP },
            positionType: 'absolute',
            width: LOBBY_HUD_GOLD_WIDTH,
            height: LOBBY_HUD_GOLD_HEIGHT
          }}
        >
          <UiEntity
            uiTransform={{
              width: LOBBY_HUD_GOLD_WIDTH,
              height: LOBBY_HUD_GOLD_HEIGHT,
              positionType: 'relative'
            }}
            uiBackground={{
              textureMode: 'stretch',
              texture: { src: HUD_LOBBY_SHEET_SRC, filterMode: 'tri-linear', wrapMode: 'clamp' },
              uvs: LOBBY_HUD_GOLD_UVS
            }}
          >
            <OutlinedText
              uiTransform={{
                width: 190,
                height: 48,
                positionType: 'absolute',
                position: { left: 72, top: 12 },
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: `${playerGold}`,
                fontSize: 40,
                color: Color4.create(1, 0.94, 0.58, 1),
                textAlign: 'middle-center'
              }}
              outlineColor={Color4.create(0.12, 0.08, 0.03, 1)}
              outlineScale={2}
              outlineKeyPrefix='lobby-gold-value'
            />
          </UiEntity>
        </UiEntity>
      )}
      {playerDead && showDeathOverlay && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
            positionType: 'absolute',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <OutlinedText
            uiTransform={{
              width: 900,
              height: 120,
              positionType: 'absolute',
              position: { top: 410 },
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: 'YOU DIED',
              fontSize: 108,
              color: Color4.create(0.98, 0.24, 0.18, 1),
              textAlign: 'middle-center'
            }}
            outlineColor={Color4.create(0.1, 0, 0, 0.95)}
            outlineScale={4}
            outlineKeyPrefix='death-overlay-title'
          />
          {getPlayerLives() > 0 && (
            <OutlinedText
              uiTransform={{
                width: 744,
                height: 48,
                positionType: 'absolute',
                position: { top: 580 },
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: `Respawning in ${respawnSecondsLeft > 0 ? respawnSecondsLeft : getRespawnDelay()} seconds...`,
                fontSize: 34,
                color: Color4.create(0.95, 0.88, 0.76, 1),
                textAlign: 'middle-center'
              }}
              outlineColor={Color4.create(0.08, 0.03, 0.02, 0.95)}
              outlineScale={2}
              outlineKeyPrefix='death-overlay-subtitle'
            />
          )}
        </UiEntity>
      )}
      {showGameOverOverlay && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: '100%',
            positionType: 'absolute',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <OutlinedText
            uiTransform={{
              width: 980,
              height: 128,
              positionType: 'absolute',
              position: { top: 400 },
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: 'GAME OVER',
              fontSize: 110,
              color: Color4.create(1, 0.2, 0.14, 1),
              textAlign: 'middle-center'
            }}
            outlineColor={Color4.create(0.08, 0, 0, 0.98)}
            outlineScale={4}
            outlineKeyPrefix='game-over-title'
          />
          <OutlinedText
            uiTransform={{
              width: 744,
              height: 48,
              positionType: 'absolute',
              position: { top: 580 },
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiText={{
              value: 'Returning to lobby...',
              fontSize: 34,
              color: Color4.create(0.95, 0.88, 0.76, 1),
              textAlign: 'middle-center'
            }}
            outlineColor={Color4.create(0.08, 0.03, 0.02, 0.95)}
            outlineScale={2}
            outlineKeyPrefix='game-over-subtitle'
          />
        </UiEntity>
      )}
      {showCenteredOverlay && !playerDead && (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 200,
            positionType: 'absolute',
            position: { top: 24, left: 0 },
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start'
          }}
        >
          <UiEntity
            uiTransform={{
              width: 520,
              minHeight: 140,
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: { top: 20, bottom: 20, left: 24, right: 24 }
            }}
            uiBackground={{ color: Color4.create(0.1, 0.1, 0.15, 0.85) }}
          >
            {countdownLabel.length > 0 && (
              <UiEntity
                uiTransform={{
                  width: '100%',
                  height: 36,
                  margin: { bottom: 8 }
                }}
                uiText={{
                  value: countdownLabel,
                  fontSize: 26,
                  color: Color4.create(1, 0.85, 0.3, 1),
                  textAlign: 'middle-center'
                }}
              />
            )}
            <UiEntity
              uiTransform={{
                width: '100%',
                height: 72,
                alignItems: 'center',
                justifyContent: 'center'
              }}
              uiText={{
                value: state.message,
                fontSize: state.phase === 'countdown' ? 56 : 28,
                color:
                  state.phase === 'game_complete'
                    ? Color4.create(0.3, 1, 0.4, 1)
                    : Color4.create(1, 1, 1, 1),
                textAlign: 'middle-center'
              }}
            />
            {state.phase === 'fighting' && (
              <UiEntity
                uiTransform={{
                  width: '100%',
                  height: 28,
                  margin: { top: 8 }
                }}
                uiText={{
                  value: `Wave ${state.currentWave} • Kill all zombies! • HP: ${getPlayerHp()}/${MAX_HP}`,
                  fontSize: 18,
                  color: Color4.create(0.9, 0.9, 0.9, 0.9),
                  textAlign: 'middle-center'
                }}
              />
            )}
          </UiEntity>
        </UiEntity>
      )}
      {/* Action bar: only visible once player is in active match context */}
      {showGameplayHud && (
        <UiEntity
          uiTransform={{
            width: '100%',
            position: { bottom: weaponBarBottomOffset, left: 0 },
            positionType: 'absolute',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            padding: { left: weaponBarSidePadding, right: weaponBarSidePadding }
          }}
        >
          <UiEntity
            uiTransform={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {(['gun', 'shotgun', 'minigun', 'brick'] as const).map((weapon: WeaponType | 'brick') => {
                const selectableWeapon = weapon === 'brick' ? null : weapon
                const isPurchasableWeapon = weapon === 'shotgun' || weapon === 'minigun'
                const brickCost = getBrickCost()
                const weaponCost = weapon === 'brick' ? brickCost : isPurchasableWeapon ? getWeaponUnlockCost(weapon) : 0
                const isPurchased = selectableWeapon === null ? true : selectableWeapon === 'gun' ? true : isWeaponPurchasedInMatch(selectableWeapon)
                const canAfford = weaponCost <= 0 || getZombieCoins() >= weaponCost
                const canUse =
                  weapon === 'gun' ||
                  (weapon === 'shotgun' && isShotgunUnlocked()) ||
                  (weapon === 'minigun' && isMinigunUnlocked()) ||
                  (weapon === 'brick' && getZombieCoins() >= brickCost)
                const isLockedVisual =
                  weapon === 'gun'
                    ? false
                    : weapon === 'shotgun'
                      ? !isPurchased
                    : weapon === 'minigun'
                        ? !isPurchased
                        : getZombieCoins() < brickCost
                const isSelected = weapon === 'brick' ? brickTargetModeActive : currentWeapon === selectableWeapon
                const showBuyPrompt =
                  (isPurchasableWeapon && !isPurchased && canAfford) ||
                  (weapon === 'brick' && !isSelected && canAfford)
                const showWeaponCost =
                  weaponCost > 0 &&
                  (weapon === 'brick'
                    ? !isSelected
                    : !isPurchased)
                const buttonWidth = scaleUiValue(
                  weapon === 'gun'
                    ? GUN_BUTTON_WIDTH
                    : weapon === 'shotgun'
                      ? SHOTGUN_BUTTON_WIDTH
                      : weapon === 'minigun'
                        ? MINIGUN_BUTTON_WIDTH
                        : weapon === 'brick'
                          ? BRICK_BUTTON_WIDTH
                          : 288,
                  weaponBarScale
                )
                const buttonHeight = scaleUiValue(
                  weapon === 'gun'
                    ? GUN_BUTTON_HEIGHT
                    : weapon === 'shotgun'
                      ? SHOTGUN_BUTTON_HEIGHT
                      : weapon === 'minigun'
                        ? MINIGUN_BUTTON_HEIGHT
                        : weapon === 'brick'
                          ? BRICK_BUTTON_HEIGHT
                          : 106,
                  weaponBarScale
                )
                const spriteSheetSrc =
                  weapon === 'brick'
                    ? isSelected
                      ? WEAPONS_SHEET_SRC
                      : WEAPONS_UNLOCK_SHEET_SRC
                    : isPurchasableWeapon && !isPurchased
                      ? canAfford
                        ? WEAPONS_UNLOCK_SHEET_SRC
                        : WEAPONS_LOCK_SHEET_SRC
                      : isLockedVisual
                        ? WEAPONS_LOCK_SHEET_SRC
                        : WEAPONS_SHEET_SRC
                return (
                  <UiEntity
                    key={weapon}
                    uiTransform={{
                      width: buttonWidth,
                      height:
                        buttonHeight +
                        brickTargetReticleHeight +
                        weaponSelectionBarHeight +
                        (weapon === 'minigun' && isSelected ? weaponItemSelectedExtraHeight : weaponItemBaseExtraHeight),
                      positionType: 'relative',
                      margin: { left: weaponItemSideMargin, right: weaponItemSideMargin, bottom: weaponItemBottomMargin },
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-end'
                    }}
                  >
                    {weapon === 'minigun' && isSelected && (
                      <UiEntity
                        uiTransform={{
                          width: miniGunBarWidth,
                          height: miniGunBarContainerHeight,
                          margin: { bottom: miniGunBarMarginBottom },
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'flex-end'
                        }}
                      >
                        <UiEntity
                          uiTransform={{ width: miniGunBarWidth, height: miniGunBarLabelHeight }}
                          uiText={{
                            value: miniGunOverheated ? `OVERHEAT ${Math.ceil(miniGunCooldownRemaining)}s` : '',
                            fontSize: miniGunBarLabelFontSize,
                            color: Color4.create(1, 0.45, 0.3, 1),
                            textAlign: 'middle-center'
                          }}
                        />
                        <UiEntity
                          uiTransform={{
                            width: miniGunBarWidth,
                            height: miniGunBarHeight,
                            borderRadius: 2,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'flex-start'
                          }}
                          uiBackground={{ color: Color4.create(0.18, 0.08, 0.06, 0.95) }}
                        >
                          <UiEntity
                            uiTransform={{
                              width: miniGunBarFillWidth,
                              height: miniGunBarHeight,
                              borderRadius: 2
                            }}
                            uiBackground={{
                              color: miniGunOverheated
                                ? Color4.create(1, 0.28, 0.18, 1)
                                : Color4.create(1, 0.68, 0.18, 1)
                            }}
                          />
                        </UiEntity>
                      </UiEntity>
                    )}
                    {weapon === 'brick' && brickTargetModeActive && (
                      <UiEntity
                        uiTransform={{
                          width: brickTargetReticleWidth,
                          height: brickTargetReticleHeight,
                          margin: { bottom: brickTargetReticleMarginBottom }
                        }}
                        uiBackground={{
                          textureMode: 'stretch',
                          texture: { src: WEAPONS_LOCK_SHEET_SRC, filterMode: 'tri-linear', wrapMode: 'clamp' },
                          uvs: BRICK_TARGET_RETICLE_UVS
                        }}
                      />
                    )}
                    <UiEntity
                      uiTransform={{
                        width: buttonWidth,
                        height: buttonHeight,
                        positionType: 'relative'
                      }}
                      uiBackground={
                        weapon === 'gun'
                          ? {
                              textureMode: 'stretch',
                              texture: { src: spriteSheetSrc, filterMode: 'tri-linear', wrapMode: 'clamp' },
                              uvs: GUN_BUTTON_UVS
                            }
                          : weapon === 'shotgun'
                            ? {
                                textureMode: 'stretch',
                                texture: { src: spriteSheetSrc, filterMode: 'tri-linear', wrapMode: 'clamp' },
                                uvs: SHOTGUN_BUTTON_UVS
                              }
                            : weapon === 'minigun'
                              ? {
                                  textureMode: 'stretch',
                                  texture: { src: spriteSheetSrc, filterMode: 'tri-linear', wrapMode: 'clamp' },
                                  uvs: MINIGUN_BUTTON_UVS
                                }
                              : weapon === 'brick'
                                ? {
                                    textureMode: 'stretch',
                                    texture: { src: spriteSheetSrc, filterMode: 'tri-linear', wrapMode: 'clamp' },
                                    uvs: BRICK_BUTTON_UVS
                                  }
                                : { color: Color4.create(0.2, 0.75, 0.35, 1) }
                      }
                      onMouseDown={() => {
                        beginUiPointerCapture()
                        if (weapon === 'brick') {
                          if (!canUse) return
                          if (brickTargetModeActive) {
                            confirmBrickPlacementFromTargetMode()
                          } else {
                            activateBrickTargetMode()
                          }
                        } else {
                          if (!isPurchased) {
                            if (!canAfford) return
                            if (selectableWeapon === null) return
                            if (!purchaseWeapon(selectableWeapon)) return
                          }
                          if (selectableWeapon === null) return
                          switchTo(selectableWeapon)
                        }
                      }}
                      onMouseUp={endUiPointerCapture}
                    >
                      {showBuyPrompt && (
                        <OutlinedText
                          uiTransform={{
                            width: buyLabelWidth,
                            height: buyLabelHeight,
                            positionType: 'absolute',
                            position: { left: buyLabelHorizontalOffset, bottom: buyLabelBottomOffset }
                          }}
                          uiText={{
                            value: 'BUY',
                            fontSize: buyLabelFontSize,
                            color: WEAPON_BUY_HIGHLIGHT_COLOR,
                            textAlign: 'middle-left'
                          }}
                          outlineColor={Color4.create(0, 0, 0, 1)}
                          outlineKeyPrefix={`weapon-buy-${weapon}`}
                        />
                      )}
                      {showWeaponCost && (
                        <OutlinedText
                          uiTransform={{
                            width: costLabelWidth,
                            height: costLabelHeight,
                            positionType: 'absolute',
                            position: { right: costLabelHorizontalOffset, bottom: costLabelBottomOffset }
                          }}
                          uiText={{
                            value: `${weaponCost} ZC`,
                            fontSize: costLabelFontSize,
                            color: showBuyPrompt ? WEAPON_BUY_HIGHLIGHT_COLOR : Color4.create(1, 1, 1, 1),
                            textAlign: 'middle-right'
                          }}
                          outlineColor={Color4.create(0, 0, 0, 1)}
                          outlineKeyPrefix={`weapon-cost-${weapon}`}
                        />
                      )}
                    </UiEntity>
                    {weapon !== 'brick' && isSelected && (
                      <UiEntity
                        uiTransform={{
                          width: weaponSelectionBarWidth,
                          height: weaponSelectionBarHeight,
                          margin: { top: weaponSelectionBarMarginTop }
                        }}
                        uiBackground={{ color: Color4.create(0, 0, 0, 1) }}
                      >
                        <UiEntity
                          uiTransform={{
                            width: '100%',
                            height: 4,
                            margin: { top: 1, left: 1, right: 1 }
                          }}
                          uiBackground={{ color: Color4.create(0.529, 0.737, 0.627, 1) }}
                        />
                      </UiEntity>
                    )}
                  </UiEntity>
                )
              })}
          </UiEntity>
        </UiEntity>
      )}
      {showGameplayHud && isAutoFireEnabled() && (
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { bottom: 190, left: 0 },
            width: '100%',
            height: 28,
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiText={{
            value: '[F] AUTO FIRE',
            fontSize: 15,
            color: Color4.create(1, 0.25, 0.25, 1),
            textAlign: 'middle-center'
          }}
        />
      )}
      {showGameplayHud && isTopViewEnabled() && (
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { bottom: 220, left: 0 },
            width: '100%',
            height: 28,
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiText={{
            value: '[1] TOP VIEW',
            fontSize: 15,
            color: Color4.create(0.3, 0.8, 1, 1),
            textAlign: 'middle-center'
          }}
        />
      )}
      {showGameplayHud && isIsoViewEnabled() && (
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { bottom: 220, left: 0 },
            width: '100%',
            height: 28,
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiText={{
            value: '[2] ISO VIEW',
            fontSize: 15,
            color: Color4.create(0.3, 0.8, 1, 1),
            textAlign: 'middle-center'
          }}
        />
      )}
      {!showGameplayHudDebug && <LobbyStoreUi />}
      {showServerLoader && (
        <ServerLoadingPanel
          completed={serverLoaderCompleted}
          timeSeconds={currentGameTime}
        />
      )}
    </UiEntity>
  )
}
