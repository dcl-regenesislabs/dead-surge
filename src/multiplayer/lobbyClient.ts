import { engine, PlayerIdentityData, RealmInfo } from '@dcl/sdk/ecs'
import { GlobalLeaderboardComponent, LeaderboardEntrySnapshot } from '../shared/leaderboardSchemas'
import { room } from '../shared/messages'
import { LobbyPhase, LobbyPlayer, LobbyStateComponent, LobbyStateSnapshot } from '../shared/lobbySchemas'
import { MatchRuntimeSnapshot, MatchRuntimeStateComponent, WaveCyclePhase } from '../shared/matchRuntimeSchemas'
import { movePlayerTo } from '~system/RestrictedActions'
import { Vector3 } from '@dcl/sdk/math'
import { applyAuthoritativeHealthState, resetPlayerHealthAndLives } from '../playerHealth'
import { resetDeathAnimationState, setLocalAvatarHidden } from '../deathAnimation'
import { applyPlayerLoadoutSnapshot, getPlayerGold } from '../loadoutState'
import { enableArenaWeapon, resetArenaWeaponProgress } from '../weaponManager'
import { resetToIdle } from '../waveManager'
import { ArenaWeaponType } from '../shared/loadoutCatalog'
import { START_GAME_COUNTDOWN_SECONDS, WAVE_ACTIVE_SECONDS, WAVE_REST_SECONDS } from '../shared/matchConfig'
import { getCurrentRoomId as getRuntimeRoomId, setCurrentRoomId } from '../roomRuntime'
import { DEFAULT_ROOM_ID, RoomId, getArenaRoomConfig, isRoomId } from '../shared/roomConfig'
import { getServerTime } from '../shared/timeSync'
import { setIsoViewEnabled, setTopViewEnabled, setAutoFireEnabled, setCameraModeToggleEnabled } from '../gameplayInput'

let latestLobbyEvent = ''
let latestLobbyEventType = ''
let latestLobbyEventAtMs = 0
let hasProfileLoadSent = false
let hasLocalLoadoutState = false
let localReadyForMatch = false
let lastTeamWipeAffectedLocalPlayer = false
let localGameOverActive = false
let sceneRoomConnectedAtMs = 0
let localAuthDebugActive = false
let debugLobbyState: LobbyStateSnapshot | null = null
let debugMatchRuntimeState: MatchRuntimeSnapshot | null = null
const GAME_OVER_OVERLAY_DELAY_MS = 0
const playerCombatStateByAddress = new Map<string, { hp: number; isDead: boolean; respawnAtMs: number; updatedAtMs: number }>()
const playerArenaWeaponByAddress = new Map<string, { weaponType: ArenaWeaponType; upgradeLevel: number }>()
const playerPowerupStateByAddress = new Map<string, { rageShieldEndAtMs: number; speedEndAtMs: number }>()
const playerMatchKillsByAddress = new Map<string, number>()
const playerMatchZcByAddress = new Map<string, number>()
let localMatchKills = 0
let localMatchZcCollected = 0
type GameOverStatsSnapshot = {
  kills: number
  wavesSurvived: number
  timeMinutes: number
  zcCollected: number
  goldCoinsEarned: number
}
let latestGameOverStatsSnapshot: GameOverStatsSnapshot | null = null
let currentMatchStartedAtMs = 0
let currentMatchStartingGold = 0
const ENABLE_LOCAL_AUTH_DEBUG_IN_PREVIEW = false
const LOCAL_AUTH_DEBUG_GRACE_MS = 2500
const LOCAL_AUTH_DEBUG_ARENA_INTRO_SECONDS = 5
const DEBUG_MATCH_ID_PREFIX = 'debug_local_match_'

function getDebugArenaPosition(): { x: number; y: number; z: number } {
  return getArenaRoomConfig(DEFAULT_ROOM_ID).arenaTeleportPosition
}

function getDebugArenaLookAt(): { x: number; y: number; z: number } {
  return getArenaRoomConfig(DEFAULT_ROOM_ID).arenaTeleportLookAt
}

function resetLocalMatchUiState(): void {
  localReadyForMatch = false
  lastTeamWipeAffectedLocalPlayer = false
  localGameOverActive = false
  latestGameOverStatsSnapshot = null
  currentMatchStartedAtMs = 0
  currentMatchStartingGold = 0
  localMatchKills = 0
  localMatchZcCollected = 0
  playerCombatStateByAddress.clear()
  playerMatchKillsByAddress.clear()
  playerMatchZcByAddress.clear()
  latestLobbyEventType = ''
  setCameraModeToggleEnabled(false)
  setTopViewEnabled(false)
  setIsoViewEnabled(false)
  setAutoFireEnabled(false)
  setLocalAvatarHidden(false)
  resetToIdle()
  resetArenaWeaponProgress()
  resetPlayerHealthAndLives()
  resetDeathAnimationState()
}

function getRequestedRoomId(roomId?: RoomId): RoomId {
  return roomId ?? getRuntimeRoomId()
}

function captureLatestGameOverStatsSnapshot(localAddress: string): void {
  const normalizedAddress = localAddress.toLowerCase()
  const runtime = getMatchRuntimeState()
  const activeWaveNumber = runtime?.waveNumber ?? 0
  const wavesSurvived =
    runtime?.cyclePhase === WaveCyclePhase.ACTIVE
      ? Math.max(0, activeWaveNumber - 1)
      : activeWaveNumber
  const elapsedMinutes =
    currentMatchStartedAtMs > 0
      ? Math.max(1, Math.round((Date.now() - currentMatchStartedAtMs) / 60000))
      : 0

  latestGameOverStatsSnapshot = {
    kills: localMatchKills,
    wavesSurvived,
    timeMinutes: elapsedMinutes,
    zcCollected: localMatchZcCollected,
    goldCoinsEarned: Math.max(0, getPlayerGold() - currentMatchStartingGold)
  }
}

function getLobbySnapshotsByRoomId(): Map<RoomId, LobbyStateSnapshot> {
  const snapshots = new Map<RoomId, LobbyStateSnapshot>()
  for (const [entity] of engine.getEntitiesWith(LobbyStateComponent)) {
    const state = LobbyStateComponent.get(entity)
    if (!isRoomId(state.roomId)) continue
    snapshots.set(state.roomId, {
      roomId: state.roomId,
      phase: state.phase,
      matchId: state.matchId,
      hostAddress: state.hostAddress,
      players: [...state.players],
      arenaPlayers: [...state.arenaPlayers],
      countdownEndTimeMs: state.countdownEndTimeMs,
      arenaIntroEndTimeMs: state.arenaIntroEndTimeMs
    })
  }
  return snapshots
}

function getMatchRuntimeSnapshotsByRoomId(): Map<RoomId, MatchRuntimeSnapshot> {
  const snapshots = new Map<RoomId, MatchRuntimeSnapshot>()
  for (const [entity] of engine.getEntitiesWith(MatchRuntimeStateComponent)) {
    const state = MatchRuntimeStateComponent.get(entity)
    if (!isRoomId(state.roomId)) continue
    snapshots.set(state.roomId, {
      roomId: state.roomId,
      isRunning: state.isRunning,
      waveNumber: state.waveNumber,
      cyclePhase: state.cyclePhase,
      serverNowMs: state.serverNowMs,
      phaseEndTimeMs: state.phaseEndTimeMs,
      activeDurationSeconds: state.activeDurationSeconds,
      restDurationSeconds: state.restDurationSeconds,
      startedByAddress: state.startedByAddress,
      zombiesAlive: state.zombiesAlive,
      zombiesPlanned: state.zombiesPlanned
    })
  }
  return snapshots
}

function resolvePreferredRoomIdFromLobbySnapshots(snapshots: Map<RoomId, LobbyStateSnapshot>): RoomId | null {
  const localAddress = getLocalAddress()
  if (localAddress) {
    for (const [roomId, state] of snapshots) {
      const isLocalInRoom =
        state.players.some((player) => player.address === localAddress) ||
        state.arenaPlayers.some((player) => player.address === localAddress)
      if (isLocalInRoom) {
        setCurrentRoomId(roomId)
        return roomId
      }
    }
  }

  const currentRoomId = getRuntimeRoomId()
  if (snapshots.has(currentRoomId)) return currentRoomId
  const firstRoomId = snapshots.keys().next().value as RoomId | undefined
  if (firstRoomId) {
    setCurrentRoomId(firstRoomId)
    return firstRoomId
  }
  return null
}

export function setupLobbyClient(): void {
  room.onMessage('lobbyEvent', (data) => {
    const localAddress = getLocalAddress()
    const lobbyState = getLobbyState()
    const localIsInArena =
      !!localAddress && !!lobbyState?.arenaPlayers.some((player) => player.address === localAddress)

    latestLobbyEvent = data.message
    latestLobbyEventType = data.type
    latestLobbyEventAtMs = Date.now()
    if (data.type === 'team_wipe') {
      lastTeamWipeAffectedLocalPlayer = localReadyForMatch || localIsInArena
    } else {
      lastTeamWipeAffectedLocalPlayer = false
    }
    if (data.type === 'team_wipe' || data.type === 'lobby' || data.type === 'match_created') {
      if (data.type !== 'team_wipe' && !localGameOverActive) {
        latestGameOverStatsSnapshot = null
      }
      if (data.type !== 'team_wipe') {
        currentMatchStartedAtMs = 0
        currentMatchStartingGold = 0
      }
      playerArenaWeaponByAddress.clear()
      playerPowerupStateByAddress.clear()
      playerMatchKillsByAddress.clear()
      playerMatchZcByAddress.clear()
      resetToIdle()
      resetArenaWeaponProgress()
    }
    if (data.type === 'waves_started') {
      if (!localIsInArena || !localReadyForMatch) return
      currentMatchStartedAtMs = Date.now()
      currentMatchStartingGold = getPlayerGold()
      latestGameOverStatsSnapshot = null
      localMatchKills = 0
      localMatchZcCollected = 0
      enableArenaWeapon()
    }
    console.log(`[Lobby] ${data.type}: ${data.message}`)
  })
  room.onMessage('zombieDied', (data) => {
    const killerAddress = data.killerAddress.toLowerCase()
    playerMatchKillsByAddress.set(killerAddress, (playerMatchKillsByAddress.get(killerAddress) ?? 0) + 1)
    const localAddress = getLocalAddress()
    if (localAddress && killerAddress === localAddress.toLowerCase()) {
      localMatchKills += 1
    }
  })
  room.onMessage('playerHealthState', (data) => {
    const address = data.address.toLowerCase()
    playerCombatStateByAddress.set(address, {
      hp: data.hp,
      isDead: data.isDead,
      respawnAtMs: data.respawnAtMs,
      updatedAtMs: Date.now()
    })

    const localAddress = getLocalAddress()
    if (!localAddress || address !== localAddress) return
    setLocalAvatarHidden(data.isDead)
    applyAuthoritativeHealthState(data.hp, data.isDead, data.respawnAtMs, data.lives)
    if (data.isDead && data.lives <= 0) {
      captureLatestGameOverStatsSnapshot(localAddress)
      localGameOverActive = true
    }
  })
  room.onMessage('playerLoadoutState', (data) => {
    const localAddress = getLocalAddress()
    if (!localAddress || data.address !== localAddress) return
    hasLocalLoadoutState = true
    applyPlayerLoadoutSnapshot(data)
  })
  room.onMessage('playerArenaWeaponState', (data) => {
    if (data.weaponType !== 'gun' && data.weaponType !== 'shotgun' && data.weaponType !== 'minigun') return
    const upgradeLevel = typeof data.upgradeLevel === 'number' && data.upgradeLevel >= 1 ? data.upgradeLevel : 1
    playerArenaWeaponByAddress.set(data.address.toLowerCase(), { weaponType: data.weaponType, upgradeLevel })
  })
  room.onMessage('playerPowerupState', (data) => {
    playerPowerupStateByAddress.set(data.address.toLowerCase(), {
      rageShieldEndAtMs: data.rageShieldEndAtMs,
      speedEndAtMs: data.speedEndAtMs
    })
  })
  room.onMessage('playerZcState', (data) => {
    const normalizedAddress = data.address.toLowerCase()
    playerMatchZcByAddress.set(normalizedAddress, data.zc)
    const localAddress = getLocalAddress()
    if (localAddress && normalizedAddress === localAddress.toLowerCase()) {
      localMatchZcCollected = data.zc
    }
  })
  room.onMessage('matchAutoTeleport', (data) => {
    const localAddress = getLocalAddress()
    if (!localAddress || !data.addresses.includes(localAddress)) return
    localReadyForMatch = true
    setCameraModeToggleEnabled(true)
    setIsoViewEnabled(true)
    setAutoFireEnabled(true)
    movePlayerTo({
      newRelativePosition: {
        x: data.positionX,
        y: data.positionY,
        z: data.positionZ
      },
      cameraTarget: {
        x: data.lookAtX,
        y: data.lookAtY,
        z: data.lookAtZ
      }
    })
  })
  room.onMessage('lobbyReturnTeleport', (data) => {
    const localAddress = getLocalAddress()
    if (!localAddress || !data.addresses.includes(localAddress)) return
    resetLocalMatchUiState()
    movePlayerTo({
      newRelativePosition: {
        x: data.positionX,
        y: data.positionY,
        z: data.positionZ
      }
    })
  })

  engine.addSystem(autoJoinLobbySystem, undefined, 'auto-join-lobby-client-system')
  engine.addSystem(localAuthDebugSystem, undefined, 'local-auth-debug-system')
}

export function sendLoadProfile(): void {
  if (localAuthDebugActive) {
    console.log(`[LobbyClientDebug] skip remote playerLoadProfile addr=${getLocalAddress() || 'none'}`)
    return
  }
  void room.send('playerLoadProfile', {})
}

export function sendRequestLoadoutRefresh(): void {
  if (localAuthDebugActive) {
    console.log('[LobbyClientDebug] skip remote loadout refresh')
    return
  }
  void room.send('playerLoadProfile', {})
}

export function sendJoinLobby(): void {
  if (ensureLocalAuthDebugActive('joinLobby')) {
    debugJoinLobbyOnly()
    return
  }
  const roomId = getRequestedRoomId()
  setCurrentRoomId(roomId)
  void room.send('playerJoinLobby', { roomId })
}

export function sendLeaveLobby(roomId?: RoomId): void {
  resetLocalMatchUiState()
  if (ensureLocalAuthDebugActive('leaveLobby')) {
    debugLeaveLobby()
    return
  }
  const targetRoomId = getRequestedRoomId(roomId)
  setCurrentRoomId(targetRoomId)
  void room.send('playerLeaveLobby', { roomId: targetRoomId })
}

export function sendForfeitMatch(roomId?: RoomId): void {
  if (ensureLocalAuthDebugActive('leaveLobby')) {
    debugLeaveLobby()
    return
  }
  const targetRoomId = getRequestedRoomId(roomId)
  setCurrentRoomId(targetRoomId)
  void room.send('playerForfeitMatch', { roomId: targetRoomId })
}

export function sendBuyLoadoutWeapon(weaponId: string): void {
  void room.send('buyLoadoutWeapon', { weaponId })
}

export function sendEquipLoadoutWeapon(weaponId: string): void {
  void room.send('equipLoadoutWeapon', { weaponId })
}

export function sendCreateMatch(roomId?: RoomId): void {
  if (ensureLocalAuthDebugActive('createMatch')) {
    debugCreateMatch()
    return
  }
  const targetRoomId = getRequestedRoomId(roomId)
  setCurrentRoomId(targetRoomId)
  void room.send('createMatch', { roomId: targetRoomId })
}

export function sendCreateMatchAndJoin(roomId?: RoomId): void {
  if (ensureLocalAuthDebugActive('createMatch')) {
    debugCreateMatch()
    return
  }
  const targetRoomId = getRequestedRoomId(roomId)
  setCurrentRoomId(targetRoomId)
  void room.send('createMatchAndJoin', { roomId: targetRoomId })
}

export function sendStartGameManual(roomId?: RoomId): void {
  if (ensureLocalAuthDebugActive('startGameManual')) {
    debugStartGameManual()
    return
  }
  const targetRoomId = getRequestedRoomId(roomId)
  setCurrentRoomId(targetRoomId)
  void room.send('startGameManual', { roomId: targetRoomId })
}

export function sendPlayerDamageRequest(amount: number): void {
  void room.send('playerDamageRequest', { amount })
}

export function sendPlayerHealRequest(amount: number): void {
  void room.send('playerHealRequest', { amount })
}

export function sendPlayerShotRequest(
  weaponType: 'gun' | 'shotgun' | 'minigun',
  origin: Vector3,
  direction: Vector3,
  seq: number
): void {
  void room.send('playerShotRequest', {
    seq,
    weaponType,
    originX: origin.x,
    originY: origin.y,
    originZ: origin.z,
    directionX: direction.x,
    directionY: direction.y,
    directionZ: direction.z,
    firedAtMs: Date.now()
  })
}

export function sendRageShieldHitRequest(zombieId: string): void {
  void room.send('rageShieldHitRequest', { zombieId })
}

export function sendZombieExplodeRequest(zombieId: string): void {
  void room.send('zombieExplodeRequest', { zombieId })
}

export function sendPlayerExplosionDamageRequest(zombieId: string, amount: number): void {
  void room.send('playerExplosionDamageRequest', { zombieId, amount })
}

export function sendPlayerArenaWeaponChanged(weaponType: ArenaWeaponType, upgradeLevel: number): void {
  void room.send('playerArenaWeaponChanged', { weaponType, upgradeLevel })
}

export function getLocalAddress(): string {
  const identity = PlayerIdentityData.getOrNull(engine.PlayerEntity)
  return identity?.address?.toLowerCase() || ''
}

export function getServerLoadingState(): {
  active: boolean
  title: string
  detail: string
} {
  const localAddress = getLocalAddress()
  if (!localAddress || localAuthDebugActive) {
    return { active: false, title: '', detail: '' }
  }

  if (!isSceneRoomConnected()) {
    return {
      active: true,
      title: 'CONTACTING SCENE ROOM',
      detail: 'Routing distress signal through quarantine uplink'
    }
  }

  if (!hasProfileLoadSent) {
    return {
      active: true,
      title: 'HANDSHAKING SERVER',
      detail: 'Negotiating arena authority and comms channel'
    }
  }

  if (!hasLocalLoadoutState) {
    return {
      active: true,
      title: 'SYNCING SURVIVOR DATA',
      detail: 'Loading profile, loadout and bunker records'
    }
  }

  return { active: false, title: '', detail: '' }
}

function autoJoinLobbySystem(): void {
  const sceneRoomConnected = isSceneRoomConnected()
  if (sceneRoomConnected && sceneRoomConnectedAtMs <= 0) {
    sceneRoomConnectedAtMs = Date.now()
  }
  if (!sceneRoomConnected) {
    sceneRoomConnectedAtMs = 0
    hasProfileLoadSent = false
    hasLocalLoadoutState = false
  }

  if (hasProfileLoadSent) return
  const localAddress = getLocalAddress()
  if (!localAddress) return

  if (ensureLocalAuthDebugActive('autoJoinLobbySystem')) {
    hasProfileLoadSent = true
    console.log(`[LobbyClientDebug] local auth debug ready for ${localAddress}`)
    return
  }

  if (!sceneRoomConnected) return

  hasProfileLoadSent = true
  sendLoadProfile()
}

function localAuthDebugSystem(): void {
  if (!localAuthDebugActive) {
    ensureLocalAuthDebugActive('autoJoinLobbySystem')
    return
  }

  const lobby = ensureDebugLobbyState()
  const runtime = ensureDebugMatchRuntimeState()
  const nowMs = getServerTime()
  runtime.serverNowMs = nowMs

  if (lobby.countdownEndTimeMs > 0 && lobby.countdownEndTimeMs <= nowMs) {
    lobby.countdownEndTimeMs = 0
    lobby.arenaIntroEndTimeMs = nowMs + LOCAL_AUTH_DEBUG_ARENA_INTRO_SECONDS * 1000
    localReadyForMatch = true
    movePlayerTo({
      newRelativePosition: getDebugArenaPosition(),
      cameraTarget: getDebugArenaLookAt()
    })
    console.log('[LobbyClientDebug] local arena teleport fired')
  }

  if (lobby.arenaIntroEndTimeMs > 0 && lobby.arenaIntroEndTimeMs <= nowMs) {
    lobby.arenaIntroEndTimeMs = 0
    runtime.isRunning = true
    runtime.waveNumber = Math.max(1, runtime.waveNumber || 1)
    runtime.cyclePhase = WaveCyclePhase.ACTIVE
    runtime.phaseEndTimeMs = nowMs + runtime.activeDurationSeconds * 1000
    runtime.startedByAddress = lobby.hostAddress
    enableArenaWeapon()
    latestLobbyEvent = `Debug wave ${runtime.waveNumber} started`
    latestLobbyEventType = 'waves_started'
    latestLobbyEventAtMs = Date.now()
    console.log('[LobbyClientDebug] match runtime started')
  }

  if (!runtime.isRunning || runtime.phaseEndTimeMs <= 0 || runtime.phaseEndTimeMs > nowMs) return

  if (runtime.cyclePhase === WaveCyclePhase.ACTIVE) {
    runtime.cyclePhase = WaveCyclePhase.REST
    runtime.phaseEndTimeMs = nowMs + runtime.restDurationSeconds * 1000
    latestLobbyEvent = `Debug rest after wave ${runtime.waveNumber}`
    latestLobbyEventType = 'wave_rest'
    latestLobbyEventAtMs = Date.now()
    return
  }

  runtime.cyclePhase = WaveCyclePhase.ACTIVE
  runtime.waveNumber += 1
  runtime.phaseEndTimeMs = nowMs + runtime.activeDurationSeconds * 1000
  latestLobbyEvent = `Debug wave ${runtime.waveNumber} started`
  latestLobbyEventType = 'waves_started'
  latestLobbyEventAtMs = Date.now()
}

function isSceneRoomConnected(): boolean {
  const realmInfo = RealmInfo.getOrNull(engine.RootEntity)
  return !!realmInfo?.isConnectedSceneRoom
}

function isPreviewMode(): boolean {
  const realmInfo = RealmInfo.getOrNull(engine.RootEntity)
  return !!realmInfo?.isPreview
}

function hasAuthoritativeLobbyState(): boolean {
  for (const _ of engine.getEntitiesWith(LobbyStateComponent)) return true
  return false
}

function hasAuthoritativeMatchRuntimeState(): boolean {
  for (const _ of engine.getEntitiesWith(MatchRuntimeStateComponent)) return true
  return false
}

function ensureLocalAuthDebugActive(
  reason: 'autoJoinLobbySystem' | 'joinLobby' | 'leaveLobby' | 'createMatch' | 'startGameManual'
): boolean {
  if (localAuthDebugActive) return true
  if (!ENABLE_LOCAL_AUTH_DEBUG_IN_PREVIEW) return false
  if (!isPreviewMode()) return false
  if (!isSceneRoomConnected()) return false
  if (hasAuthoritativeLobbyState() || hasAuthoritativeMatchRuntimeState()) return false

  const nowMs = Date.now()
  const graceElapsed =
    sceneRoomConnectedAtMs > 0 && nowMs - sceneRoomConnectedAtMs >= LOCAL_AUTH_DEBUG_GRACE_MS
  const shouldForceForAction =
    reason === 'joinLobby' ||
    reason === 'leaveLobby' ||
    reason === 'createMatch' ||
    reason === 'startGameManual'
  if (!graceElapsed && !shouldForceForAction) return false

  localAuthDebugActive = true
  console.log(`[LobbyClientDebug] activated local auth debug (${reason})`)
  return true
}

function ensureDebugLobbyState(): LobbyStateSnapshot {
  if (debugLobbyState) return debugLobbyState
  debugLobbyState = {
    roomId: DEFAULT_ROOM_ID,
    phase: LobbyPhase.LOBBY,
    matchId: '',
    hostAddress: '',
    players: [],
    arenaPlayers: [],
    countdownEndTimeMs: 0,
    arenaIntroEndTimeMs: 0
  }
  return debugLobbyState
}

function ensureDebugMatchRuntimeState(): MatchRuntimeSnapshot {
  if (debugMatchRuntimeState) return debugMatchRuntimeState
  debugMatchRuntimeState = {
    roomId: DEFAULT_ROOM_ID,
    isRunning: false,
    waveNumber: 0,
    cyclePhase: WaveCyclePhase.ACTIVE,
    serverNowMs: Date.now(),
    phaseEndTimeMs: 0,
    activeDurationSeconds: WAVE_ACTIVE_SECONDS,
    restDurationSeconds: WAVE_REST_SECONDS,
    startedByAddress: '',
    zombiesAlive: 0,
    zombiesPlanned: 0
  }
  return debugMatchRuntimeState
}

function cloneLobbyState(state: LobbyStateSnapshot): LobbyStateSnapshot {
  return {
    roomId: state.roomId,
    phase: state.phase,
    matchId: state.matchId,
    hostAddress: state.hostAddress,
    players: [...state.players],
    arenaPlayers: [...state.arenaPlayers],
    countdownEndTimeMs: state.countdownEndTimeMs,
    arenaIntroEndTimeMs: state.arenaIntroEndTimeMs
  }
}

function cloneMatchRuntimeState(state: MatchRuntimeSnapshot): MatchRuntimeSnapshot {
  return {
    roomId: state.roomId,
    isRunning: state.isRunning,
    waveNumber: state.waveNumber,
    cyclePhase: state.cyclePhase,
    serverNowMs: state.serverNowMs,
    phaseEndTimeMs: state.phaseEndTimeMs,
    activeDurationSeconds: state.activeDurationSeconds,
    restDurationSeconds: state.restDurationSeconds,
    startedByAddress: state.startedByAddress,
    zombiesAlive: state.zombiesAlive,
    zombiesPlanned: state.zombiesPlanned
  }
}

function getDebugLobbyPlayer(): LobbyPlayer | null {
  const address = getLocalAddress()
  if (!address) return null
  return {
    address,
    displayName: `${address.slice(0, 6)}...${address.slice(-4)}`
  }
}

function resetDebugMatchState(): void {
  const runtime = ensureDebugMatchRuntimeState()
  runtime.isRunning = false
  runtime.waveNumber = 0
  runtime.cyclePhase = WaveCyclePhase.ACTIVE
  runtime.serverNowMs = Date.now()
  runtime.phaseEndTimeMs = 0
  runtime.startedByAddress = ''
  runtime.zombiesAlive = 0
  runtime.zombiesPlanned = 0
}

function debugJoinLobbyOnly(): void {
  const player = getDebugLobbyPlayer()
  if (!player) return

  const lobby = ensureDebugLobbyState()
  if (!lobby.players.some((entry) => entry.address === player.address)) {
    lobby.players = [...lobby.players, player]
  }
  if (!lobby.hostAddress) {
    lobby.hostAddress = player.address
  }
  latestLobbyEvent = `${player.displayName} joined debug lobby`
  latestLobbyEventType = 'join'
  latestLobbyEventAtMs = Date.now()
  console.log(`[LobbyClientDebug] joined lobby as ${player.address}`)
}

function debugCreateMatch(): void {
  const player = getDebugLobbyPlayer()
  if (!player) return

  debugJoinLobbyOnly()
  const lobby = ensureDebugLobbyState()
  if (lobby.phase === LobbyPhase.MATCH_CREATED) return

  lobby.phase = LobbyPhase.MATCH_CREATED
  lobby.matchId = `${DEBUG_MATCH_ID_PREFIX}${Date.now()}`
  lobby.arenaPlayers = [...lobby.players]
  lobby.countdownEndTimeMs = 0
  lobby.arenaIntroEndTimeMs = 0
  localReadyForMatch = false
  resetDebugMatchState()
  latestLobbyEvent = `Debug match created (${lobby.matchId})`
  latestLobbyEventType = 'match_created'
  latestLobbyEventAtMs = Date.now()
  console.log(`[LobbyClientDebug] match created by ${player.address}`)
}

function debugStartGameManual(): void {
  const player = getDebugLobbyPlayer()
  if (!player) return

  debugCreateMatch()
  const lobby = ensureDebugLobbyState()
  const runtime = ensureDebugMatchRuntimeState()
  if (runtime.isRunning || lobby.countdownEndTimeMs > 0 || lobby.arenaIntroEndTimeMs > 0) return

  lobby.countdownEndTimeMs = getServerTime() + START_GAME_COUNTDOWN_SECONDS * 1000
  latestLobbyEvent = 'Debug auto-teleport countdown started'
  latestLobbyEventType = 'countdown'
  latestLobbyEventAtMs = Date.now()
  console.log(`[LobbyClientDebug] countdown started for ${player.address}`)
}

function debugLeaveLobby(): void {
  const lobby = ensureDebugLobbyState()
  lobby.phase = LobbyPhase.LOBBY
  lobby.matchId = ''
  lobby.hostAddress = ''
  lobby.players = []
  lobby.arenaPlayers = []
  lobby.countdownEndTimeMs = 0
  lobby.arenaIntroEndTimeMs = 0
  localReadyForMatch = false
  resetDebugMatchState()
  latestLobbyEvent = 'Debug left lobby'
  latestLobbyEventType = 'lobby'
  latestLobbyEventAtMs = Date.now()
  console.log('[LobbyClientDebug] left lobby without teleport')
}

export function getLobbyState(roomId?: RoomId): LobbyStateSnapshot | null {
  if (localAuthDebugActive) {
    const state = ensureDebugLobbyState()
    const targetRoomId = roomId ?? DEFAULT_ROOM_ID
    if (targetRoomId !== DEFAULT_ROOM_ID) return null
    const localAddress = getLocalAddress()
    const isInArenaRoster = !!localAddress && state.arenaPlayers.some((p) => p.address === localAddress)
    // Only update localReadyForMatch when querying the player's own room (no explicit roomId)
    if (roomId === undefined) {
      if (state.phase !== LobbyPhase.MATCH_CREATED || !isInArenaRoster) {
        localReadyForMatch = false
      }
    }
    return cloneLobbyState(state)
  }

  const snapshots = getLobbySnapshotsByRoomId()
  const targetRoomId = roomId ?? resolvePreferredRoomIdFromLobbySnapshots(snapshots)
  if (!targetRoomId) return null

  const state = snapshots.get(targetRoomId) ?? null
  const localAddress = getLocalAddress()
  const isInArenaRoster = !!localAddress && !!state?.arenaPlayers.some((p) => p.address === localAddress)
  // Only update localReadyForMatch when querying the player's own room (no explicit roomId).
  // Querying a specific room (e.g. room_1 panel checking room_1 state while player is in room_2)
  // must NOT reset localReadyForMatch, otherwise the wrong room's panel would cancel the player's match state.
  if (roomId === undefined) {
    if (!state || state.phase !== LobbyPhase.MATCH_CREATED || !isInArenaRoster) {
      localReadyForMatch = false
    }
  }
  return state ? cloneLobbyState(state) : null
}

export function getMatchRuntimeState(roomId?: RoomId): MatchRuntimeSnapshot | null {
  if (localAuthDebugActive) {
    const targetRoomId = roomId ?? DEFAULT_ROOM_ID
    if (targetRoomId !== DEFAULT_ROOM_ID) return null
    return cloneMatchRuntimeState(ensureDebugMatchRuntimeState())
  }

  const snapshots = getMatchRuntimeSnapshotsByRoomId()
  const targetRoomId =
    roomId ??
    (snapshots.has(getRuntimeRoomId()) ? getRuntimeRoomId() : (snapshots.keys().next().value as RoomId | undefined))
  if (!targetRoomId) return null
  const state = snapshots.get(targetRoomId)
  return state ? cloneMatchRuntimeState(state) : null
}

export function getCurrentRoomId(): RoomId {
  const lobby = getLobbyState()
  if (lobby?.roomId && isRoomId(lobby.roomId)) {
    setCurrentRoomId(lobby.roomId)
    return lobby.roomId
  }
  return getRuntimeRoomId()
}

export function getLatestLobbyEvent(): string {
  return latestLobbyEvent
}

export function getLatestGameOverStatsSnapshot(): GameOverStatsSnapshot | null {
  return latestGameOverStatsSnapshot ? { ...latestGameOverStatsSnapshot } : null
}

export function shouldShowGameOverOverlay(windowMs: number = 3000): boolean {
  if (localGameOverActive) return true
  if (latestLobbyEventType !== 'team_wipe') return false
  if (!lastTeamWipeAffectedLocalPlayer) return false
  const elapsedMs = Date.now() - latestLobbyEventAtMs
  if (elapsedMs < GAME_OVER_OVERLAY_DELAY_MS) return false
  return elapsedMs <= windowMs + GAME_OVER_OVERLAY_DELAY_MS
}

export function shouldSuppressDeathOverlayForTeamWipe(): boolean {
  return localGameOverActive || (latestLobbyEventType === 'team_wipe' && lastTeamWipeAffectedLocalPlayer)
}

export function isLocalReadyForMatch(): boolean {
  return localReadyForMatch
}

export function getPlayerCombatSnapshot(address: string): { hp: number; isDead: boolean; respawnAtMs: number } | null {
  const state = playerCombatStateByAddress.get(address.toLowerCase())
  if (!state) return null
  return {
    hp: state.hp,
    isDead: state.isDead,
    respawnAtMs: state.respawnAtMs
  }
}

export function getPlayerArenaWeapon(address: string): { weaponType: ArenaWeaponType; upgradeLevel: number } {
  return playerArenaWeaponByAddress.get(address.toLowerCase()) ?? { weaponType: 'gun', upgradeLevel: 1 }
}

export function getPlayerPowerupSnapshot(address: string): { rageShieldEndAtMs: number; speedEndAtMs: number } {
  return (
    playerPowerupStateByAddress.get(address.toLowerCase()) ?? {
      rageShieldEndAtMs: 0,
      speedEndAtMs: 0
    }
  )
}

export function getPlayerMatchStatsSnapshot(address: string): { kills: number } {
  return {
    kills: playerMatchKillsByAddress.get(address.toLowerCase()) ?? 0
  }
}

export function getPlayerZcSnapshot(address: string): number {
  return playerMatchZcByAddress.get(address.toLowerCase()) ?? 0
}

export function getLeaderboardKills(): LeaderboardEntrySnapshot[] {
  for (const [, data] of engine.getEntitiesWith(GlobalLeaderboardComponent)) {
    return data.kills.map((e) => ({ address: e.address, displayName: e.displayName, value: e.value }))
  }
  return []
}

export function getLeaderboardWaves(): LeaderboardEntrySnapshot[] {
  for (const [, data] of engine.getEntitiesWith(GlobalLeaderboardComponent)) {
    return data.waves.map((e) => ({ address: e.address, displayName: e.displayName, value: e.value }))
  }
  return []
}
