import { engine, AvatarBase, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { LobbyPhase, LobbyStateComponent, LobbyPlayer } from '../shared/lobbySchemas'
import { MatchRuntimeStateComponent, WaveCyclePhase } from '../shared/matchRuntimeSchemas'
import { room } from '../shared/messages'
import {
  CLIENT_BASE_GROUP_SIZE,
  CLIENT_GROUP_GROWTH_EVERY_WAVES,
  CLIENT_GROUP_STAGGER_MS,
  CLIENT_MAX_GROUP_SIZE,
  CLIENT_SPAWN_INTERVAL_SECONDS,
  EXPLODER_ZOMBIE_BASE_CHANCE,
  EXPLODER_ZOMBIE_CHANCE_2,
  EXPLODER_ZOMBIE_CHANCE_3,
  EXPLODER_ZOMBIE_CHANCE_4,
  EXPLODER_ZOMBIE_CHANCE_WAVE_2,
  EXPLODER_ZOMBIE_CHANCE_WAVE_3,
  EXPLODER_ZOMBIE_CHANCE_WAVE_4,
  EXPLODER_ZOMBIE_COOLDOWN_SECONDS,
  EXPLODER_ZOMBIE_MAX_SIMULTANEOUS_EARLY,
  EXPLODER_ZOMBIE_MAX_SIMULTANEOUS_LATE,
  EXPLODER_ZOMBIE_MAX_SIMULTANEOUS_LATE_WAVE,
  EXPLODER_ZOMBIE_UNLOCK_WAVE,
  MATCH_MAX_PLAYERS,
  START_GAME_COUNTDOWN_SECONDS,
  QUICK_ZOMBIE_CHANCE,
  QUICK_ZOMBIE_UNLOCK_WAVE,
  TANK_ZOMBIE_CHANCE,
  TANK_ZOMBIE_UNLOCK_WAVE,
  WAVE_ACTIVE_SECONDS,
  WAVE_REST_SECONDS,
  COINS_PER_KILL,
  SHOTGUN_UNLOCK_COST_ZC,
  MINIGUN_UNLOCK_COST_ZC
} from '../shared/matchConfig'
import {
  ArenaWeaponType,
  DEFAULT_LOADOUT_WEAPON_BY_TIER,
  LoadoutWeaponId,
  LOADOUT_WEAPON_DEFINITIONS,
  getLoadoutWeaponDefinition
} from '../shared/loadoutCatalog'
import { createPlayerProgressStore } from './storage/playerProgress'
import { createLeaderboardStore } from './storage/leaderboard'
import { GlobalLeaderboardComponent } from '../shared/leaderboardSchemas'
import { getServerTime } from '../shared/timeSync'
import {
  LAVA_DAMAGE_INTERVAL_MS,
  shouldSpawnLavaForWave,
  type LavaHazardTileState
} from '../shared/lavaHazardConfig'
import { buildLavaHazardsForWave } from './lavaHazardPatterns'
import {
  DEFAULT_ROOM_ID,
  LOBBY_RETURN_LOOK_AT,
  LOBBY_RETURN_POSITION,
  ROOM_IDS,
  ArenaRoomConfig,
  RoomId,
  getArenaRoomConfig,
  refreshArenaRoomConfigsFromScene,
  isRoomId
} from '../shared/roomConfig'

const playerProgressStore = createPlayerProgressStore()
const leaderboardStore = createLeaderboardStore()
let leaderboardEntity: ReturnType<typeof engine.addEntity> | null = null
const VALID_WEAPON_IDS = new Set(LOADOUT_WEAPON_DEFINITIONS.map((w) => w.id))
const PLAYER_PROGRESS_AUTOSAVE_SECONDS = 20
const PLAYER_MAX_HP = 5
const PLAYER_RESPAWN_SECONDS = 5
const PLAYER_MAX_LIVES = 2
const PLAYER_DAMAGE_REQUEST_COOLDOWN_MS = 250
const PLAYER_HEAL_REQUEST_COOLDOWN_MS = 250
const HEALTH_POTION_HEAL_AMOUNT = PLAYER_MAX_HP
const HEALTH_POTION_DROP_CHANCE = 0.02
const RAGE_POTION_DROP_CHANCE = 0.015
const SPEED_POTION_DROP_CHANCE = 0.015
const RAGE_SHIELD_DURATION_MS = 10_000
const SPEED_POTION_DURATION_MS = 10_000
const SPEED_FIRE_RATE_MULTIPLIER = 2
const RAGE_SHIELD_DAMAGE = 1
const RAGE_SHIELD_RADIUS = 1.6
const RAGE_SHIELD_HIT_COOLDOWN_MS = 500
const POTION_LIFETIME_MS = 20_000
const POTION_PICKUP_RADIUS = 2.5
const POTION_MIN_SEPARATION = 1.75
const POTION_POSITION_SEARCH_ATTEMPTS = 16
const POTION_POSITION_RING_STEP = 0.7
const LAVA_BATCH_SIZE = 96
const DISCONNECTED_PLAYER_GRACE_MS = 3000
const DISCONNECTED_PLAYER_RECONCILE_INTERVAL_SECONDS = 0.5
const SHOT_RATE_LIMIT_MS_BY_WEAPON: Record<ArenaWeaponType, number> = {
  gun: 400,
  shotgun: 450,
  minigun: 120
}
const ZOMBIE_HITS_ALLOWED_PER_SHOT: Record<ArenaWeaponType, number> = {
  gun: 1,
  shotgun: 3,
  minigun: 1
}
const ZOMBIE_MAX_HP_BY_TYPE: Record<ZombieType, number> = {
  basic: 3,
  quick: 2,
  tank: 10,
  exploder: 15
}
const GUN_UPGRADE_FIRE_RATE_MS: Record<number, number> = {
  1: 440,
  2: 380,
  3: 330
}
const SPAWN_EDGE_BAND_WIDTH = 4.75
const SPAWN_CENTER_SAFE_RADIUS = 8.5
const SPAWN_CENTER_SAFE_RADIUS_SQ = SPAWN_CENTER_SAFE_RADIUS * SPAWN_CENTER_SAFE_RADIUS
const ARENA_WARNING_SECONDS = 5
const TEAM_WIPE_UI_DELAY_MS = 0
const TEAM_WIPE_TELEPORT_DELAY_MS = 3000
const GOLD_WAVE_MILESTONES: Array<{ wave: number; gold: number }> = [
  { wave: 4, gold: 1 },
  { wave: 11, gold: 2 },
  { wave: 21, gold: 3 },
  { wave: 35, gold: 5 }
]

type ZombieType = 'basic' | 'quick' | 'tank' | 'exploder'
type PotionType = 'health' | 'rage' | 'speed'
type WavePlanSpawn = {
  zombieId: string
  zombieType: ZombieType
  spawnX: number
  spawnY: number
  spawnZ: number
  spawnAtMs: number
}
type ZombieSpawnState = {
  zombieType: ZombieType
  hp: number
  spawnX: number
  spawnY: number
  spawnZ: number
  spawnAtMs: number
}
type PlayerCombatState = {
  hp: number
  isDead: boolean
  respawnAtMs: number
  lives: number
  lastDamageRequestAtMs: number
  lastHealRequestAtMs: number
  lastLavaDamageAtMs: number
  rageShieldEndAtMs: number
  speedEndAtMs: number
}
type ActivePotionState = {
  potionId: string
  potionType: PotionType
  positionX: number
  positionY: number
  positionZ: number
  expiresAtMs: number
}
type ActiveLavaHazardState = LavaHazardTileState
type ScheduledLavaHazardState = LavaHazardTileState
type PendingTeamWipeReturn = {
  players: LobbyPlayer[]
  executeAtMs: number
}

type ActiveCollectibleState = {
  collectibleId: string
  positionX: number
  positionY: number
  positionZ: number
  expiresAtMs: number
}
type RoomServerState = {
  roomId: RoomId
  roomConfig: ArenaRoomConfig
  lobbyEntity: ReturnType<typeof engine.addEntity> | null
  matchRuntimeEntity: ReturnType<typeof engine.addEntity> | null
  nextZombieSequence: number
  nextPotionSequence: number
  nextLavaSequence: number
  nextCollectibleSequence: number
  zombieSpawnAtById: Map<string, ZombieSpawnState>
  deadZombieIds: Set<string>
  explodedZombieIds: Set<string>
  activePotionsById: Map<string, ActivePotionState>
  activeCollectiblesById: Map<string, ActiveCollectibleState>
  scheduledLavaHazardsById: Map<string, ScheduledLavaHazardState>
  activeLavaHazardsById: Map<string, ActiveLavaHazardState>
  awardedWaveGoldMilestones: Set<number>
  arenaWeaponByAddress: Map<string, { weaponType: ArenaWeaponType; upgradeLevel: number }>
  playerMatchKillsByAddress: Map<string, number>
  playerMatchWavesSurvivedByAddress: Map<string, number>
  playerMatchZcByAddress: Map<string, number>
  playerUnlockedArenaWeaponsInMatch: Map<string, Set<ArenaWeaponType>>
  pendingTeamWipeReturn: PendingTeamWipeReturn | null
}

function createRoomServerState(roomId: RoomId): RoomServerState {
  return {
    roomId,
    roomConfig: getArenaRoomConfig(roomId),
    lobbyEntity: null,
    matchRuntimeEntity: null,
    nextZombieSequence: 0,
    nextPotionSequence: 0,
    nextLavaSequence: 0,
    nextCollectibleSequence: 0,
    zombieSpawnAtById: new Map<string, ZombieSpawnState>(),
    deadZombieIds: new Set<string>(),
    explodedZombieIds: new Set<string>(),
    activePotionsById: new Map<string, ActivePotionState>(),
    activeCollectiblesById: new Map<string, ActiveCollectibleState>(),
    scheduledLavaHazardsById: new Map<string, ScheduledLavaHazardState>(),
    activeLavaHazardsById: new Map<string, ActiveLavaHazardState>(),
    awardedWaveGoldMilestones: new Set<number>(),
    arenaWeaponByAddress: new Map<string, { weaponType: ArenaWeaponType; upgradeLevel: number }>(),
    playerMatchKillsByAddress: new Map<string, number>(),
    playerMatchWavesSurvivedByAddress: new Map<string, number>(),
    playerMatchZcByAddress: new Map<string, number>(),
    playerUnlockedArenaWeaponsInMatch: new Map<string, Set<ArenaWeaponType>>(),
    pendingTeamWipeReturn: null
  }
}

const roomServerStateById = Object.fromEntries(
  ROOM_IDS.map((roomId) => [roomId, createRoomServerState(roomId)])
) as Record<RoomId, RoomServerState>

const loadedProfileAddresses = new Set<string>()
const playerRoomByAddress = new Map<string, RoomId>()
const playerCombatStateByAddress = new Map<string, PlayerCombatState>()
const lastShotAtMsByPlayerAndWeapon = new Map<string, number>()
const zombieHitAllowanceByShotKey = new Map<string, number>()
const lastRageShieldHitAtMsByPlayerAndZombie = new Map<string, number>()
const explosiveZombieDamageByPlayerKey = new Set<string>()
const disconnectedLobbyPlayerSinceMs = new Map<string, number>()
let disconnectedPlayerReconcileAccumulator = 0
let isDisconnectReconcileInFlight = false

function getRoomServerState(roomId: RoomId): RoomServerState {
  return roomServerStateById[roomId]
}

function resetMatchLeaderboardStats(roomId: RoomId): void {
  const roomState = getRoomServerState(roomId)
  roomState.playerMatchKillsByAddress.clear()
  roomState.playerMatchWavesSurvivedByAddress.clear()
}

function initializeMatchLeaderboardStats(roomId: RoomId, players: LobbyPlayer[]): void {
  resetMatchLeaderboardStats(roomId)
  const roomState = getRoomServerState(roomId)
  for (const player of players) {
    roomState.playerMatchKillsByAddress.set(player.address, 0)
    roomState.playerMatchWavesSurvivedByAddress.set(player.address, 0)
  }
}

function logLobbyServerEvent(roomId: RoomId, message: string): void {
  console.log(`[Server][Lobby][${roomId}] ${message}`)
}

function getRequestedRoomId(value: unknown, fallback: RoomId = DEFAULT_ROOM_ID): RoomId {
  return typeof value === 'string' && isRoomId(value) ? value : fallback
}

function getPlayerRoomId(address: string): RoomId | null {
  return playerRoomByAddress.get(address.toLowerCase()) ?? null
}

function getRoomPlayerAddresses(roomId: RoomId): string[] {
  return getLobbyState(roomId).players.map((player) => player.address)
}

function getRoomArenaPlayerAddresses(roomId: RoomId): string[] {
  return getLobbyState(roomId).arenaPlayers.map((player) => player.address)
}

function sendMessage(type: string, payload: Record<string, unknown>, targets?: string[]): void {
  if (targets && targets.length === 0) return
  if (targets) {
    void room.send(type as never, payload as never, { to: targets })
    return
  }
  void room.send(type as never, payload as never)
}

function sendToLobby(roomId: RoomId, type: string, payload: Record<string, unknown>): void {
  sendMessage(type, payload, getRoomPlayerAddresses(roomId))
}

function sendToArena(roomId: RoomId, type: string, payload: Record<string, unknown>): void {
  sendMessage(type, payload, getRoomArenaPlayerAddresses(roomId))
}

function getOwnedWeaponIds(address: string): LoadoutWeaponId[] {
  const defaultOwnedWeaponIds = Object.values(DEFAULT_LOADOUT_WEAPON_BY_TIER).filter(
    (weaponId): weaponId is LoadoutWeaponId => !!weaponId
  )
  const progress = playerProgressStore.get(address)
  if (!progress) return defaultOwnedWeaponIds

  const validIds = VALID_WEAPON_IDS
  const ownedWeaponIds: LoadoutWeaponId[] = [...defaultOwnedWeaponIds]

  for (const tier of ['tier1', 'tier2', 'tier3', 'tier4'] as const) {
    for (const weaponId of progress.weapons.ownedByTier[tier]) {
      if (validIds.has(weaponId as LoadoutWeaponId) && !ownedWeaponIds.includes(weaponId as LoadoutWeaponId)) {
        ownedWeaponIds.push(weaponId as LoadoutWeaponId)
      }
    }
  }
  return ownedWeaponIds
}

function isArenaWeaponType(value: string): value is ArenaWeaponType {
  return value === 'gun' || value === 'shotgun' || value === 'minigun'
}

function getZombieMaxHp(zombieType: ZombieType): number {
  return ZOMBIE_MAX_HP_BY_TYPE[zombieType]
}

function getShotAllowanceKey(address: string, weaponType: ArenaWeaponType, shotSeq: number): string {
  return `${address.toLowerCase()}:${weaponType}:${Math.floor(shotSeq)}`
}

function getRageShieldHitKey(address: string, zombieId: string): string {
  return `${address.toLowerCase()}:${zombieId}`
}

function getExplosiveZombieDamageKey(address: string, zombieId: string): string {
  return `${address.toLowerCase()}:${zombieId}`
}

function isPlayerZombieTrackingKeyForRoom(key: string, roomId: RoomId): boolean {
  const separatorIndex = key.indexOf(':')
  if (separatorIndex < 0 || separatorIndex >= key.length - 1) return false
  const zombieId = key.slice(separatorIndex + 1)
  return zombieId.startsWith(`${roomId}_`)
}

function getEquippedWeaponIds(address: string): LoadoutWeaponId[] {
  const progress = playerProgressStore.get(address)
  const defaultEquippedWeaponIds = Object.values(DEFAULT_LOADOUT_WEAPON_BY_TIER).filter(
    (weaponId): weaponId is LoadoutWeaponId => !!weaponId
  )
  if (!progress) return defaultEquippedWeaponIds

  const validIds = VALID_WEAPON_IDS
  const equippedWeaponIds: LoadoutWeaponId[] = []

  for (const tier of ['tier1', 'tier2', 'tier3', 'tier4'] as const) {
    const id = progress.weapons.equippedByTier[tier]
    if (id && validIds.has(id as LoadoutWeaponId) && !equippedWeaponIds.includes(id as LoadoutWeaponId)) {
      equippedWeaponIds.push(id as LoadoutWeaponId)
    }
  }

  for (const [tierKey, weaponId] of Object.entries(DEFAULT_LOADOUT_WEAPON_BY_TIER)) {
    if (!weaponId) continue
    const alreadyEquippedInTier = equippedWeaponIds.some((equippedWeaponId) => {
      const weapon = getLoadoutWeaponDefinition(equippedWeaponId)
      return weapon?.tierKey === tierKey
    })
    if (!alreadyEquippedInTier) {
      equippedWeaponIds.push(weaponId)
    }
  }

  return equippedWeaponIds
}

function sendPlayerLoadoutState(address: string, to?: string[]): void {
  const normalizedAddress = address.toLowerCase()
  const progress = playerProgressStore.get(normalizedAddress)
  if (!progress) return
  const roomId = getPlayerRoomId(normalizedAddress)
  const arenaTargets = roomId ? getRoomArenaPlayerAddresses(roomId) : []
  const targets = to ?? Array.from(new Set([...arenaTargets, normalizedAddress]))

  sendMessage('playerLoadoutState', {
    address: normalizedAddress,
    gold: progress.profile.gold,
    ownedWeaponIds: getOwnedWeaponIds(normalizedAddress),
    equippedWeaponIds: getEquippedWeaponIds(normalizedAddress)
  }, targets)
}

function sendArenaLoadoutStatesTo(roomId: RoomId, address: string): void {
  const normalizedAddress = address.toLowerCase()
  const lobbyState = getLobbyState(roomId)
  for (const player of lobbyState.arenaPlayers) {
    sendPlayerLoadoutState(player.address, [normalizedAddress])
  }
}

function sendPlayerZcState(roomId: RoomId, address: string): void {
  const normalizedAddress = address.toLowerCase()
  const roomState = getRoomServerState(roomId)
  const zc = roomState.playerMatchZcByAddress.get(normalizedAddress) ?? 0
  const arenaTargets = getRoomArenaPlayerAddresses(roomId)
  sendMessage('playerZcState', { address: normalizedAddress, zc }, arenaTargets)
}

function sendArenaZcStatesTo(roomId: RoomId, address: string): void {
  const normalizedAddress = address.toLowerCase()
  const roomState = getRoomServerState(roomId)
  const lobbyState = getLobbyState(roomId)
  for (const player of lobbyState.arenaPlayers) {
    const zc = roomState.playerMatchZcByAddress.get(player.address.toLowerCase()) ?? 0
    sendMessage('playerZcState', { address: player.address.toLowerCase(), zc }, [normalizedAddress])
  }
}

function getPlayerArenaWeaponState(roomId: RoomId, address: string): { weaponType: ArenaWeaponType; upgradeLevel: number } {
  return getRoomServerState(roomId).arenaWeaponByAddress.get(address.toLowerCase()) ?? { weaponType: 'gun', upgradeLevel: 1 }
}

const GUN_UPGRADE_DAMAGE: Record<number, number> = { 1: 1, 2: 1, 3: 2 }

function getWeaponHitDamage(address: string, weaponType: ArenaWeaponType): number {
  const roomId = getPlayerRoomId(address)
  if (weaponType === 'gun') {
    const { upgradeLevel } = roomId ? getPlayerArenaWeaponState(roomId, address) : { upgradeLevel: 1 }
    return GUN_UPGRADE_DAMAGE[upgradeLevel] ?? 1
  }
  return 1
}

function getWeaponShotRateLimitMs(address: string, weaponType: ArenaWeaponType): number {
  const roomId = getPlayerRoomId(address)
  if (weaponType === 'gun') {
    const { upgradeLevel } = roomId ? getPlayerArenaWeaponState(roomId, address) : { upgradeLevel: 1 }
    return GUN_UPGRADE_FIRE_RATE_MS[upgradeLevel] ?? SHOT_RATE_LIMIT_MS_BY_WEAPON.gun
  }

  return SHOT_RATE_LIMIT_MS_BY_WEAPON[weaponType]
}

function sendPlayerArenaWeaponState(roomId: RoomId, address: string, to?: string[]): void {
  const normalizedAddress = address.toLowerCase()
  const state = getPlayerArenaWeaponState(roomId, normalizedAddress)
  const payload = {
    address: normalizedAddress,
    weaponType: state.weaponType,
    upgradeLevel: state.upgradeLevel
  }
  sendMessage('playerArenaWeaponState', payload, to ?? getRoomArenaPlayerAddresses(roomId))
}

function sendPlayerPowerupState(roomId: RoomId, address: string, to?: string[]): void {
  const normalizedAddress = address.toLowerCase()
  const state = getOrCreatePlayerCombatState(normalizedAddress)
  const payload = {
    address: normalizedAddress,
    rageShieldEndAtMs: state.rageShieldEndAtMs,
    speedEndAtMs: state.speedEndAtMs
  }
  sendMessage('playerPowerupState', payload, to ?? getRoomArenaPlayerAddresses(roomId))
}

function sendArenaWeaponStatesTo(roomId: RoomId, address: string): void {
  const normalizedAddress = address.toLowerCase()
  const lobbyState = getLobbyState(roomId)
  for (const player of lobbyState.arenaPlayers) {
    sendPlayerArenaWeaponState(roomId, player.address, [normalizedAddress])
  }
}

function sendPowerupStatesTo(roomId: RoomId, address: string): void {
  const normalizedAddress = address.toLowerCase()
  const lobbyState = getLobbyState(roomId)
  for (const player of lobbyState.arenaPlayers) {
    sendPlayerPowerupState(roomId, player.address, [normalizedAddress])
  }
}

function getPlayerDisplayName(address: string): string {
  const normalizedAddress = address.toLowerCase()
  for (const [_entity, identity, avatarBase] of engine.getEntitiesWith(PlayerIdentityData, AvatarBase)) {
    if (identity.address.toLowerCase() === normalizedAddress) {
      return avatarBase.name || normalizedAddress.slice(0, 8)
    }
  }
  return normalizedAddress.slice(0, 8)
}

function getLobbyStateMutable(roomId: RoomId) {
  const roomState = getRoomServerState(roomId)
  if (roomState.lobbyEntity === null) {
    roomState.lobbyEntity = engine.addEntity()
    LobbyStateComponent.create(roomState.lobbyEntity, {
      roomId,
      phase: LobbyPhase.LOBBY,
      matchId: '',
      hostAddress: '',
      players: [],
      arenaPlayers: [],
      countdownEndTimeMs: 0,
      arenaIntroEndTimeMs: 0
    })
    syncEntity(roomState.lobbyEntity, [LobbyStateComponent.componentId])
  }
  return LobbyStateComponent.getMutable(roomState.lobbyEntity)
}

function getMatchRuntimeMutable(roomId: RoomId) {
  const roomState = getRoomServerState(roomId)
  if (roomState.matchRuntimeEntity === null) {
    roomState.matchRuntimeEntity = engine.addEntity()
    MatchRuntimeStateComponent.create(roomState.matchRuntimeEntity, {
      roomId,
      isRunning: false,
      waveNumber: 0,
      cyclePhase: WaveCyclePhase.ACTIVE,
      serverNowMs: getServerTime(),
      phaseEndTimeMs: 0,
      activeDurationSeconds: WAVE_ACTIVE_SECONDS,
      restDurationSeconds: WAVE_REST_SECONDS,
      startedByAddress: '',
      zombiesAlive: 0,
      zombiesPlanned: 0
    })
    syncEntity(roomState.matchRuntimeEntity, [MatchRuntimeStateComponent.componentId])
  }
  return MatchRuntimeStateComponent.getMutable(roomState.matchRuntimeEntity)
}

function clearZombieTracking(roomId: RoomId, runtime: ReturnType<typeof getMatchRuntimeMutable>): void {
  const roomState = getRoomServerState(roomId)
  roomState.zombieSpawnAtById.clear()
  roomState.deadZombieIds.clear()
  roomState.explodedZombieIds.clear()
  runtime.zombiesAlive = 0
  runtime.zombiesPlanned = 0
  roomState.awardedWaveGoldMilestones.clear()
  for (const damageKey of [...explosiveZombieDamageByPlayerKey]) {
    if (isPlayerZombieTrackingKeyForRoom(damageKey, roomId)) {
      explosiveZombieDamageByPlayerKey.delete(damageKey)
    }
  }
  for (const hitKey of [...lastRageShieldHitAtMsByPlayerAndZombie.keys()]) {
    if (isPlayerZombieTrackingKeyForRoom(hitKey, roomId)) {
      lastRageShieldHitAtMsByPlayerAndZombie.delete(hitKey)
    }
  }
  clearActivePotions(roomId, true)
  clearAllLavaHazards(roomId)
  clearAllCollectibles(roomId)
}

function getOrCreatePlayerCombatState(address: string): PlayerCombatState {
  const normalizedAddress = address.toLowerCase()
  const cached = playerCombatStateByAddress.get(normalizedAddress)
  if (cached) return cached
  const created: PlayerCombatState = {
    hp: PLAYER_MAX_HP,
    isDead: false,
    respawnAtMs: 0,
    lives: PLAYER_MAX_LIVES,
    lastDamageRequestAtMs: 0,
    lastHealRequestAtMs: 0,
    lastLavaDamageAtMs: 0,
    rageShieldEndAtMs: 0,
    speedEndAtMs: 0
  }
  playerCombatStateByAddress.set(normalizedAddress, created)
  return created
}

function resetPlayerCombatState(address: string): void {
  const state = getOrCreatePlayerCombatState(address)
  const normalizedAddress = address.toLowerCase()
  const roomId = getPlayerRoomId(normalizedAddress)
  state.hp = PLAYER_MAX_HP
  state.isDead = false
  state.respawnAtMs = 0
  state.lives = PLAYER_MAX_LIVES
  state.lastDamageRequestAtMs = 0
  state.lastHealRequestAtMs = 0
  state.lastLavaDamageAtMs = 0
  state.rageShieldEndAtMs = 0
  state.speedEndAtMs = 0
  if (roomId) {
    getRoomServerState(roomId).arenaWeaponByAddress.set(normalizedAddress, { weaponType: 'gun', upgradeLevel: 1 })
    sendPlayerPowerupState(roomId, normalizedAddress)
  }
}

function removePlayerCombatState(address: string): void {
  const normalizedAddress = address.toLowerCase()
  const roomId = getPlayerRoomId(normalizedAddress)
  playerCombatStateByAddress.delete(normalizedAddress)
  if (roomId) {
    getRoomServerState(roomId).arenaWeaponByAddress.delete(normalizedAddress)
  }
}

function clearPlayerShotRateLimitState(address: string): void {
  const normalizedAddress = address.toLowerCase()
  for (const weaponType of Object.keys(SHOT_RATE_LIMIT_MS_BY_WEAPON) as ArenaWeaponType[]) {
    lastShotAtMsByPlayerAndWeapon.delete(`${normalizedAddress}:${weaponType}`)
  }
  for (const shotKey of zombieHitAllowanceByShotKey.keys()) {
    if (shotKey.startsWith(`${normalizedAddress}:`)) {
      zombieHitAllowanceByShotKey.delete(shotKey)
    }
  }
}

function sendPlayerHealthState(address: string, roomId?: RoomId, targets?: string[]): void {
  const normalizedAddress = address.toLowerCase()
  const state = getOrCreatePlayerCombatState(normalizedAddress)
  const targetRoomId = roomId ?? getPlayerRoomId(normalizedAddress)
  sendMessage('playerHealthState', {
    address: normalizedAddress,
    hp: state.hp,
    isDead: state.isDead,
    respawnAtMs: state.respawnAtMs,
    lives: state.lives
  }, targets ?? (targetRoomId ? getRoomPlayerAddresses(targetRoomId) : [normalizedAddress]))
}

function distanceXZ(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx
  const dz = az - bz
  return Math.sqrt(dx * dx + dz * dz)
}

function getPlayerPosition(address: string): { x: number; y: number; z: number } | null {
  const normalizedAddress = address.toLowerCase()
  for (const [_entity, identity, transform] of engine.getEntitiesWith(PlayerIdentityData, Transform)) {
    if (identity.address.toLowerCase() !== normalizedAddress) continue
    return {
      x: transform.position.x,
      y: transform.position.y,
      z: transform.position.z
    }
  }
  return null
}

function sendPotionSpawn(roomId: RoomId, potion: ActivePotionState, to?: string[]): void {
  const payload = {
    roomId,
    potionId: potion.potionId,
    potionType: potion.potionType,
    positionX: potion.positionX,
    positionY: potion.positionY,
    positionZ: potion.positionZ,
    expiresAtMs: potion.expiresAtMs
  }
  sendMessage('potionSpawned', payload, to ?? getRoomArenaPlayerAddresses(roomId))
}

function sendActivePotionsTo(roomId: RoomId, address: string): void {
  const normalizedAddress = address.toLowerCase()
  for (const potion of getRoomServerState(roomId).activePotionsById.values()) {
    sendPotionSpawn(roomId, potion, [normalizedAddress])
  }
}

function sendLavaHazardSpawnBatches(roomId: RoomId, hazards: LavaHazardTileState[], targets?: string[]): void {
  if (hazards.length === 0) return
  for (let index = 0; index < hazards.length; index += LAVA_BATCH_SIZE) {
    const payload = { roomId, hazards: hazards.slice(index, index + LAVA_BATCH_SIZE) }
    sendMessage('lavaHazardsSpawned', payload, targets ?? getRoomArenaPlayerAddresses(roomId))
  }
}

function sendLavaHazardExpiredBatches(roomId: RoomId, lavaIds: string[]): void {
  if (lavaIds.length === 0) return
  for (let index = 0; index < lavaIds.length; index += LAVA_BATCH_SIZE) {
    sendMessage('lavaHazardsExpired', {
      roomId,
      lavaIds: lavaIds.slice(index, index + LAVA_BATCH_SIZE)
    }, getRoomArenaPlayerAddresses(roomId))
  }
}

function sendActiveLavaHazardsTo(roomId: RoomId, address: string): void {
  const normalizedAddress = address.toLowerCase()
  sendLavaHazardSpawnBatches(roomId, [...getRoomServerState(roomId).activeLavaHazardsById.values()], [normalizedAddress])
}

function clearActivePotions(roomId: RoomId, notifyClients: boolean): void {
  const roomState = getRoomServerState(roomId)
  if (roomState.activePotionsById.size === 0) return
  roomState.activePotionsById.clear()
  if (notifyClients) {
    sendToArena(roomId, 'potionsCleared', { roomId })
  }
}

function clampPotionCoordinate(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function isPotionPositionFree(
  positionX: number,
  positionZ: number,
  occupiedPositions: Array<{ x: number; z: number }>
): boolean {
  for (const occupied of occupiedPositions) {
    if (distanceXZ(positionX, positionZ, occupied.x, occupied.z) < POTION_MIN_SEPARATION) return false
  }
  return true
}

function getAvailablePotionPosition(
  roomId: RoomId,
  originX: number,
  originY: number,
  originZ: number,
  occupiedPositions: Array<{ x: number; z: number }>
): { positionX: number; positionY: number; positionZ: number } {
  const roomConfig = getRoomServerState(roomId).roomConfig
  const allOccupiedPositions = [
    ...occupiedPositions,
    ...[...getRoomServerState(roomId).activePotionsById.values()].map((potion) => ({ x: potion.positionX, z: potion.positionZ }))
  ]

  if (isPotionPositionFree(originX, originZ, allOccupiedPositions)) {
    return { positionX: originX, positionY: originY, positionZ: originZ }
  }

  const angleOffset = Math.random() * Math.PI * 2
  for (let attempt = 0; attempt < POTION_POSITION_SEARCH_ATTEMPTS; attempt += 1) {
    const ring = Math.floor(attempt / 4) + 1
    const angle = angleOffset + attempt * ((Math.PI * 2) / 4)
    const radius = POTION_POSITION_RING_STEP * ring
    const candidateX = clampPotionCoordinate(originX + Math.cos(angle) * radius, roomConfig.spawnMinX, roomConfig.spawnMaxX)
    const candidateZ = clampPotionCoordinate(originZ + Math.sin(angle) * radius, roomConfig.spawnMinZ, roomConfig.spawnMaxZ)
    if (isPotionPositionFree(candidateX, candidateZ, allOccupiedPositions)) {
      return { positionX: candidateX, positionY: originY, positionZ: candidateZ }
    }
  }

  const fallbackAngle = angleOffset + Math.random() * Math.PI * 2
  const fallbackRadius = POTION_POSITION_RING_STEP * (Math.floor(POTION_POSITION_SEARCH_ATTEMPTS / 4) + 1)
  return {
    positionX: clampPotionCoordinate(originX + Math.cos(fallbackAngle) * fallbackRadius, roomConfig.spawnMinX, roomConfig.spawnMaxX),
    positionY: originY,
    positionZ: clampPotionCoordinate(originZ + Math.sin(fallbackAngle) * fallbackRadius, roomConfig.spawnMinZ, roomConfig.spawnMaxZ)
  }
}

function spawnPotionAt(roomId: RoomId, positionX: number, positionY: number, positionZ: number, potionType: PotionType): void {
  const roomState = getRoomServerState(roomId)
  roomState.nextPotionSequence += 1
  const potion: ActivePotionState = {
    potionId: `${roomId}_p${roomState.nextPotionSequence}`,
    potionType,
    positionX,
    positionY,
    positionZ,
    expiresAtMs: getServerTime() + POTION_LIFETIME_MS
  }
  roomState.activePotionsById.set(potion.potionId, potion)
  sendPotionSpawn(roomId, potion)
}

function trySpawnPotionDrops(roomId: RoomId, positionX: number, positionY: number, positionZ: number): Array<{ x: number; z: number }> {
  const occupiedPositions: Array<{ x: number; z: number }> = []

  if (Math.random() < HEALTH_POTION_DROP_CHANCE) {
    const spawn = getAvailablePotionPosition(roomId, positionX, positionY, positionZ, occupiedPositions)
    spawnPotionAt(roomId, spawn.positionX, spawn.positionY, spawn.positionZ, 'health')
    occupiedPositions.push({ x: spawn.positionX, z: spawn.positionZ })
  }
  if (Math.random() < RAGE_POTION_DROP_CHANCE) {
    const spawn = getAvailablePotionPosition(roomId, positionX, positionY, positionZ, occupiedPositions)
    spawnPotionAt(roomId, spawn.positionX, spawn.positionY, spawn.positionZ, 'rage')
    occupiedPositions.push({ x: spawn.positionX, z: spawn.positionZ })
  }
  if (Math.random() < SPEED_POTION_DROP_CHANCE) {
    const spawn = getAvailablePotionPosition(roomId, positionX, positionY, positionZ, occupiedPositions)
    spawnPotionAt(roomId, spawn.positionX, spawn.positionY, spawn.positionZ, 'speed')
    occupiedPositions.push({ x: spawn.positionX, z: spawn.positionZ })
  }

  return occupiedPositions
}

function isRageShieldActive(state: PlayerCombatState, now: number): boolean {
  return state.rageShieldEndAtMs > now
}

function getPlayerFireRateMultiplier(state: PlayerCombatState, now: number): number {
  return state.speedEndAtMs > now ? SPEED_FIRE_RATE_MULTIPLIER : 1
}

function applyPlayerDeath(state: PlayerCombatState, now: number, address: string, roomId: RoomId): void {
  state.lives = Math.max(0, state.lives - 1)
  state.isDead = true
  state.hp = 0
  if (state.lives > 0) {
    state.respawnAtMs = now + PLAYER_RESPAWN_SECONDS * 1000
  } else {
    state.respawnAtMs = 0
    eliminatePlayerFromMatch(address, roomId)
  }
}

function eliminatePlayerFromMatch(address: string, roomId: RoomId): void {
  const normalizedAddress = address.toLowerCase()
  const lobbyState = getLobbyStateMutable(roomId)
  if (lobbyState.phase !== LobbyPhase.MATCH_CREATED) return

  const player = lobbyState.arenaPlayers.find((p) => p.address === normalizedAddress)
  if (!player) return

  logLobbyServerEvent(roomId, `PlayerEliminated ${normalizedAddress}`)

  const nextArenaPlayers = lobbyState.arenaPlayers.filter((p) => p.address !== normalizedAddress)
  setArenaPlayers(roomId, nextArenaPlayers)

  sendToArena(roomId, 'lobbyEvent', {
    type: 'player_eliminated',
    message: `${player.address} has been eliminated`
  })

  if (nextArenaPlayers.length === 0) {
    endMatchAndReturnToLobby(roomId, 'All players eliminated.')
  }
}

function expirePotions(roomId: RoomId, now: number): void {
  const roomState = getRoomServerState(roomId)
  for (const [potionId, potion] of roomState.activePotionsById) {
    if (potion.expiresAtMs > now) continue
    roomState.activePotionsById.delete(potionId)
    sendToArena(roomId, 'potionExpired', { roomId, potionId })
  }
}

function getNextLavaHazardId(roomId: RoomId): string {
  const roomState = getRoomServerState(roomId)
  roomState.nextLavaSequence += 1
  return `${roomId}_l${roomState.nextLavaSequence}`
}

function queueLavaHazardsForWave(roomId: RoomId, waveNumber: number, now: number): void {
  const roomState = getRoomServerState(roomId)
  if (!shouldSpawnLavaForWave(waveNumber)) return
  const { hazards, sweepWarningAtMs } = buildLavaHazardsForWave(waveNumber, now, () => getNextLavaHazardId(roomId))
  for (const lava of hazards) {
    roomState.scheduledLavaHazardsById.set(lava.lavaId, lava)
  }
  if (sweepWarningAtMs !== null) {
    const SWEEP_UI_ADVANCE_MS = 1500
    sendMessage('lavaPatternWarning', {
      roomId,
      patternType: 'sweep',
      startsAtMs: sweepWarningAtMs - SWEEP_UI_ADVANCE_MS
    }, getRoomArenaPlayerAddresses(roomId))
  }
}

function spawnScheduledLavaHazards(roomId: RoomId, now: number): void {
  const roomState = getRoomServerState(roomId)
  const hazardsToSpawn: LavaHazardTileState[] = []
  for (const [lavaId, lava] of roomState.scheduledLavaHazardsById) {
    if (lava.warningAtMs > now) continue
    roomState.scheduledLavaHazardsById.delete(lavaId)
    roomState.activeLavaHazardsById.set(lavaId, lava)
    hazardsToSpawn.push(lava)
  }
  sendLavaHazardSpawnBatches(roomId, hazardsToSpawn)
}

function expireLavaHazards(roomId: RoomId, now: number): void {
  const roomState = getRoomServerState(roomId)
  const expiredLavaIds: string[] = []
  for (const [lavaId, lava] of roomState.activeLavaHazardsById) {
    if (lava.expiresAtMs > now) continue
    roomState.activeLavaHazardsById.delete(lavaId)
    expiredLavaIds.push(lavaId)
  }
  sendLavaHazardExpiredBatches(roomId, expiredLavaIds)
}

function clearAllLavaHazards(roomId: RoomId): void {
  const roomState = getRoomServerState(roomId)
  if (roomState.scheduledLavaHazardsById.size === 0 && roomState.activeLavaHazardsById.size === 0) return
  roomState.scheduledLavaHazardsById.clear()
  roomState.activeLavaHazardsById.clear()
  sendToArena(roomId, 'lavaHazardsCleared', { roomId })
}

const COLLECTIBLE_LIFETIME_MS = 30_000

function spawnCollectibleDrop(roomId: RoomId, x: number, y: number, z: number, now: number): void {
  const roomState = getRoomServerState(roomId)
  const collectibleId = `${roomId}_col_${roomState.nextCollectibleSequence++}`
  const expiresAtMs = Math.floor(now + COLLECTIBLE_LIFETIME_MS)
  const col: ActiveCollectibleState = {
    collectibleId,
    positionX: x,
    positionY: y,
    positionZ: z,
    expiresAtMs
  }
  roomState.activeCollectiblesById.set(collectibleId, col)
  sendToArena(roomId, 'collectibleSpawned', {
    roomId,
    collectibleId,
    positionX: x,
    positionY: y,
    positionZ: z,
    expiresAtMs
  })
}

function sendActiveCollectiblesTo(roomId: RoomId, address: string): void {
  for (const col of getRoomServerState(roomId).activeCollectiblesById.values()) {
    sendMessage('collectibleSpawned', {
      roomId,
      collectibleId: col.collectibleId,
      positionX: col.positionX,
      positionY: col.positionY,
      positionZ: col.positionZ,
      expiresAtMs: col.expiresAtMs
    }, [address])
  }
}

function tickCollectibleExpiry(roomId: RoomId, now: number): void {
  const roomState = getRoomServerState(roomId)
  for (const [id, col] of roomState.activeCollectiblesById) {
    if (now >= col.expiresAtMs) {
      roomState.activeCollectiblesById.delete(id)
      sendToArena(roomId, 'collectibleExpired', { roomId, collectibleId: id })
    }
  }
}

function clearAllCollectibles(roomId: RoomId): void {
  const roomState = getRoomServerState(roomId)
  if (roomState.activeCollectiblesById.size === 0) return
  roomState.activeCollectiblesById.clear()
  sendToArena(roomId, 'collectiblesCleared', { roomId })
}

function applyZombieDamage(
  roomId: RoomId,
  zombieId: string,
  damage: number,
  killerAddress: string,
  now: number,
  deathPos?: { x: number; y: number; z: number } | null
): boolean {
  const normalizedAddress = killerAddress.toLowerCase()
  const roomState = getRoomServerState(roomId)
  const runtime = getMatchRuntimeMutable(roomId)
  const spawnState = roomState.zombieSpawnAtById.get(zombieId)
  if (!spawnState) return false
  if (spawnState.spawnAtMs > now) return false

  const amount = Math.max(1, Math.floor(damage))
  spawnState.hp = Math.max(0, spawnState.hp - amount)

  if (spawnState.hp > 0) {
    sendToArena(roomId, 'zombieHealthChanged', { roomId, zombieId, hp: spawnState.hp })
    return true
  }

  roomState.zombieSpawnAtById.delete(zombieId)
  roomState.deadZombieIds.delete(zombieId)
  roomState.explodedZombieIds.delete(zombieId)
  roomState.playerMatchKillsByAddress.set(
    normalizedAddress,
    (roomState.playerMatchKillsByAddress.get(normalizedAddress) ?? 0) + 1
  )
  recomputeZombiesAlive(roomId, runtime, now)
  sendToArena(roomId, 'zombieDied', { roomId, zombieId, killerAddress: normalizedAddress })
  playerProgressStore.mutate(normalizedAddress, (progress) => {
    progress.profile.lifetimeStats.zombiesKilled += 1
  })
  const dropX = deathPos?.x ?? spawnState.spawnX
  const dropY = deathPos?.y ?? spawnState.spawnY
  const dropZ = deathPos?.z ?? spawnState.spawnZ
  const occupiedDropPositions = trySpawnPotionDrops(roomId, dropX, dropY, dropZ)
  const collectibleSpawn =
    occupiedDropPositions.length > 0
      ? getAvailablePotionPosition(roomId, dropX, dropY, dropZ, occupiedDropPositions)
      : { positionX: dropX, positionY: dropY, positionZ: dropZ }
  spawnCollectibleDrop(roomId, collectibleSpawn.positionX, collectibleSpawn.positionY, collectibleSpawn.positionZ, now)
  return true
}

function explodeZombie(roomId: RoomId, zombieId: string, now: number): boolean {
  const roomState = getRoomServerState(roomId)
  const runtime = getMatchRuntimeMutable(roomId)
  const spawnState = roomState.zombieSpawnAtById.get(zombieId)
  if (!spawnState) return false
  if (spawnState.spawnAtMs > now) return false
  if (spawnState.zombieType !== 'exploder') return false

  roomState.zombieSpawnAtById.delete(zombieId)
  roomState.deadZombieIds.delete(zombieId)
  roomState.explodedZombieIds.add(zombieId)
  recomputeZombiesAlive(roomId, runtime, now)
  sendToArena(roomId, 'zombieExploded', { roomId, zombieId })
  return true
}

function applyExplosionDamageToPlayer(address: string, zombieId: string, requestedAmount: number, now: number): void {
  const normalizedAddress = address.toLowerCase()
  const roomId = getPlayerRoomId(normalizedAddress)
  const state = getOrCreatePlayerCombatState(normalizedAddress)
  if (state.isDead) return

  const hitKey = getExplosiveZombieDamageKey(normalizedAddress, zombieId)
  if (explosiveZombieDamageByPlayerKey.has(hitKey)) return
  if (!roomId || !getRoomServerState(roomId).explodedZombieIds.has(zombieId)) return

  explosiveZombieDamageByPlayerKey.add(hitKey)
  const amount = Math.max(1, Math.min(PLAYER_MAX_HP, Math.floor(requestedAmount)))
  state.lastDamageRequestAtMs = now
  state.hp = Math.max(0, state.hp - amount)
  if (state.hp <= 0) applyPlayerDeath(state, now, normalizedAddress, roomId)
  sendPlayerHealthState(normalizedAddress, roomId)
}

function sendPlayerHealthStatesForLobbyPlayers(roomId: RoomId, players: LobbyPlayer[]): void {
  for (const player of players) {
    sendPlayerHealthState(player.address, roomId)
  }
}

function areAllLobbyPlayersEliminated(players: LobbyPlayer[]): boolean {
  if (!players.length) return false
  for (const player of players) {
    const state = getOrCreatePlayerCombatState(player.address)
    if (!state.isDead || state.lives > 0) return false
  }
  return true
}

function endMatchAndReturnToLobby(roomId: RoomId, message: string): void {
  const roomState = getRoomServerState(roomId)
  const lobby = getLobbyStateMutable(roomId)
  const players = [...lobby.arenaPlayers]

  lobby.countdownEndTimeMs = 0
  lobby.arenaIntroEndTimeMs = 0
  resetMatchRuntime(roomId)
  roomState.pendingTeamWipeReturn = null

  sendToLobby(roomId, 'lobbyEvent', {
    type: 'team_wipe',
    message
  })
}

function finalizePendingTeamWipeReturn(roomId: RoomId): void {
  const roomState = getRoomServerState(roomId)
  if (!roomState.pendingTeamWipeReturn) return
  const { players } = roomState.pendingTeamWipeReturn
  roomState.pendingTeamWipeReturn = null

  commitMatchStatsToLeaderboard(roomId, players)
  resetMatchLeaderboardStats(roomId)

  for (const player of players) {
    if (playerRoomByAddress.get(player.address) === roomId) {
      playerRoomByAddress.delete(player.address)
    }
  }
  setPlayers(roomId, [])

  for (const player of players) {
    resetPlayerCombatState(player.address)
    sendPlayerHealthState(player.address, roomId, [player.address])
    sendPlayerArenaWeaponState(roomId, player.address)
  }

  sendLobbyReturnTeleport(roomId, players)
}

function resetArenaToLobby(roomId: RoomId, message: string): void {
  getRoomServerState(roomId).pendingTeamWipeReturn = null
  resetMatchToLobbyKeepingPlayers(roomId)
  logLobbyServerEvent(roomId, `ArenaResetToLobby ${message}`)
  sendToLobby(roomId, 'lobbyEvent', {
    type: 'lobby',
    message
  })
}

function recomputeZombiesAlive(roomId: RoomId, runtime: ReturnType<typeof getMatchRuntimeMutable>, nowMs: number): void {
  let alive = 0
  for (const [_zombieId, spawnState] of getRoomServerState(roomId).zombieSpawnAtById) {
    if (spawnState.spawnAtMs > nowMs) continue
    alive += 1
  }
  runtime.zombiesAlive = alive
}

function resetMatchRuntime(roomId: RoomId) {
  const roomState = getRoomServerState(roomId)
  const runtime = getMatchRuntimeMutable(roomId)
  runtime.serverNowMs = getServerTime()
  runtime.isRunning = false
  runtime.waveNumber = 0
  runtime.cyclePhase = WaveCyclePhase.ACTIVE
  runtime.phaseEndTimeMs = 0
  runtime.activeDurationSeconds = WAVE_ACTIVE_SECONDS
  runtime.restDurationSeconds = WAVE_REST_SECONDS
  runtime.startedByAddress = ''
  clearZombieTracking(roomId, runtime)
  roomState.arenaWeaponByAddress.clear()
  roomState.playerMatchZcByAddress.clear()
  roomState.playerUnlockedArenaWeaponsInMatch.clear()
}

function resetMatchToLobbyKeepingPlayers(roomId: RoomId): void {
  const roomState = getRoomServerState(roomId)
  roomState.pendingTeamWipeReturn = null
  const lobby = getLobbyStateMutable(roomId)
  lobby.phase = LobbyPhase.LOBBY
  lobby.matchId = ''
  lobby.arenaPlayers = []
  lobby.countdownEndTimeMs = 0
  lobby.arenaIntroEndTimeMs = 0
  resetMatchRuntime(roomId)
  resetMatchLeaderboardStats(roomId)
}

function cancelArenaAutoTeleportCountdown(roomId: RoomId): void {
  const lobby = getLobbyStateMutable(roomId)
  if (lobby.countdownEndTimeMs === 0) return
  lobby.countdownEndTimeMs = 0
  logLobbyServerEvent(roomId, 'ArenaAutoTeleportCountdownCancelled')
}

function cancelArenaIntroCountdown(roomId: RoomId): void {
  const lobby = getLobbyStateMutable(roomId)
  if (lobby.arenaIntroEndTimeMs === 0) return
  lobby.arenaIntroEndTimeMs = 0
  logLobbyServerEvent(roomId, 'ArenaIntroCountdownCancelled')
}

function getLobbyState(roomId: RoomId) {
  const mutable = getLobbyStateMutable(roomId)
  return {
    roomId: mutable.roomId,
    phase: mutable.phase,
    matchId: mutable.matchId,
    hostAddress: mutable.hostAddress,
    players: [...mutable.players],
    arenaPlayers: [...mutable.arenaPlayers],
    countdownEndTimeMs: mutable.countdownEndTimeMs,
    arenaIntroEndTimeMs: mutable.arenaIntroEndTimeMs
  }
}

function setPlayers(roomId: RoomId, players: LobbyPlayer[]) {
  const state = getLobbyStateMutable(roomId)
  state.players = players
  if (players.length === 0) {
    state.hostAddress = ''
    state.phase = LobbyPhase.LOBBY
    state.matchId = ''
    state.arenaPlayers = []
    state.countdownEndTimeMs = 0
    state.arenaIntroEndTimeMs = 0
    resetMatchRuntime(roomId)
  } else if (!players.find((p) => p.address === state.hostAddress)) {
    state.hostAddress = players[0].address
  }
}

function setArenaPlayers(roomId: RoomId, players: LobbyPlayer[]) {
  const state = getLobbyStateMutable(roomId)
  state.arenaPlayers = players
}

function isPlayerInLobby(address: string, roomId: RoomId): boolean {
  const state = getLobbyState(roomId)
  return state.players.some((p) => p.address === address.toLowerCase())
}

function isPlayerInArena(address: string, roomId: RoomId): boolean {
  const state = getLobbyState(roomId)
  return state.arenaPlayers.some((p) => p.address === address.toLowerCase())
}

function isMatchJoinLocked(roomId: RoomId): boolean {
  const lobby = getLobbyState(roomId)
  if (lobby.phase !== LobbyPhase.MATCH_CREATED) return false

  const runtime = getMatchRuntimeMutable(roomId)
  return runtime.isRunning || lobby.arenaIntroEndTimeMs > 0
}

async function ensurePlayerLoadedAndInLobby(roomId: RoomId, address: string): Promise<void> {
  const normalizedAddress = address.toLowerCase()
  await ensurePlayerProfileLoaded(normalizedAddress)
  const previousRoomId = getPlayerRoomId(normalizedAddress)
  if (previousRoomId && previousRoomId !== roomId) {
    await removePlayerFromLobby(previousRoomId, normalizedAddress, { preserveLoadedProfile: true })
  }
  addPlayerToLobby(roomId, normalizedAddress)
}

async function ensurePlayerProfileLoaded(address: string): Promise<void> {
  const normalizedAddress = address.toLowerCase()
  if (loadedProfileAddresses.has(normalizedAddress)) {
    sendPlayerLoadoutState(normalizedAddress)
    return
  }
  const displayName = getPlayerDisplayName(normalizedAddress)
  const progress = await playerProgressStore.load(normalizedAddress, displayName)
  loadedProfileAddresses.add(normalizedAddress)
  sendPlayerLoadoutState(normalizedAddress)
  console.log(`[Server][Lobby] ProfileLoaded ${displayName} (${normalizedAddress})`)
  sendMessage('lobbyEvent', {
    type: 'profile_loaded',
    message: `${displayName} profile loaded (GOLD ${progress.profile.gold})`
  }, [normalizedAddress])
}

function sendArenaAutoTeleport(roomId: RoomId, players: LobbyPlayer[]): void {
  if (!players.length) return
  const roomConfig = getRoomServerState(roomId).roomConfig
  const lobby = getLobbyStateMutable(roomId)
  lobby.arenaIntroEndTimeMs = getServerTime() + ARENA_WARNING_SECONDS * 1000
  logLobbyServerEvent(roomId, `ArenaAutoTeleport ${players.length}/${MATCH_MAX_PLAYERS}`)
  sendMessage('matchAutoTeleport', {
    addresses: players.map((player) => player.address),
    positionX: roomConfig.arenaTeleportPosition.x,
    positionY: roomConfig.arenaTeleportPosition.y,
    positionZ: roomConfig.arenaTeleportPosition.z,
    lookAtX: roomConfig.arenaTeleportLookAt.x,
    lookAtY: roomConfig.arenaTeleportLookAt.y,
    lookAtZ: roomConfig.arenaTeleportLookAt.z
  }, players.map((player) => player.address))
}

function sendLobbyReturnTeleport(roomId: RoomId, players: LobbyPlayer[]): void {
  if (!players.length) return
  logLobbyServerEvent(roomId, `LobbyReturnTeleport ${players.length}`)
  sendMessage('lobbyReturnTeleport', {
    addresses: players.map((player) => player.address),
    positionX: LOBBY_RETURN_POSITION.x,
    positionY: LOBBY_RETURN_POSITION.y,
    positionZ: LOBBY_RETURN_POSITION.z,
    lookAtX: LOBBY_RETURN_LOOK_AT.x,
    lookAtY: LOBBY_RETURN_LOOK_AT.y,
    lookAtZ: LOBBY_RETURN_LOOK_AT.z
  }, players.map((player) => player.address))
}

function startArenaAutoTeleportCountdown(roomId: RoomId, players: LobbyPlayer[]): void {
  const lobby = getLobbyStateMutable(roomId)
  if (lobby.countdownEndTimeMs > 0) return
  lobby.countdownEndTimeMs = getServerTime() + START_GAME_COUNTDOWN_SECONDS * 1000
  logLobbyServerEvent(
    roomId,
    `ArenaAutoTeleportCountdownStarted ${players.length}/${MATCH_MAX_PLAYERS} (${START_GAME_COUNTDOWN_SECONDS}s)`
  )
}

function addPlayerToLobby(roomId: RoomId, address: string): void {
  const state = getLobbyState(roomId)
  const normalizedAddress = address.toLowerCase()
  if (state.players.some((p) => p.address === normalizedAddress)) return
  if (state.players.length >= MATCH_MAX_PLAYERS) return

  const nextPlayers = [...state.players, { address: normalizedAddress, displayName: getPlayerDisplayName(normalizedAddress) }]
  playerRoomByAddress.set(normalizedAddress, roomId)
  setPlayers(roomId, nextPlayers)

  const mutable = getLobbyStateMutable(roomId)
  if (!mutable.hostAddress) {
    mutable.hostAddress = normalizedAddress
  }
  if (mutable.phase === LobbyPhase.MATCH_CREATED && !isMatchJoinLocked(roomId)) {
    mutable.arenaPlayers = [...mutable.arenaPlayers, nextPlayers[nextPlayers.length - 1]]
    if (mutable.arenaPlayers.length === MATCH_MAX_PLAYERS) {
      startArenaAutoTeleportCountdown(roomId, mutable.arenaPlayers)
    }
  }

  logLobbyServerEvent(
    roomId,
    `PlayerJoined ${getPlayerDisplayName(normalizedAddress)} ${nextPlayers.length}/${MATCH_MAX_PLAYERS}`
  )

  sendToLobby(roomId, 'lobbyEvent', {
    type: 'join',
    message: `${getPlayerDisplayName(normalizedAddress)} joined lobby`
  })
}

async function removePlayerFromLobby(
  roomId: RoomId,
  address: string,
  options?: { preserveLoadedProfile?: boolean }
): Promise<void> {
  const normalizedAddress = address.toLowerCase()
  const roomState = getRoomServerState(roomId)
  const state = getLobbyState(roomId)
  const nextPlayers = state.players.filter((p) => p.address !== normalizedAddress)
  const nextArenaPlayers = state.arenaPlayers.filter((p) => p.address !== normalizedAddress)
  const leavingPlayer = state.players.find((p) => p.address === normalizedAddress)
  const leavingArenaPlayer = state.arenaPlayers.find((p) => p.address === normalizedAddress)
  const leaderboardCandidate = leavingArenaPlayer ?? leavingPlayer

  if (leaderboardCandidate && commitPlayerMatchStatsToLeaderboard(roomId, leaderboardCandidate)) {
    syncLeaderboardToComponent()
    void leaderboardStore.persist()
  }

  if (options?.preserveLoadedProfile) {
    await playerProgressStore.save(normalizedAddress)
  } else {
    await playerProgressStore.saveAndEvict(normalizedAddress)
    loadedProfileAddresses.delete(normalizedAddress)
  }
  removePlayerCombatState(normalizedAddress)
  clearPlayerShotRateLimitState(normalizedAddress)
  disconnectedLobbyPlayerSinceMs.delete(normalizedAddress)
  if (playerRoomByAddress.get(normalizedAddress) === roomId) {
    playerRoomByAddress.delete(normalizedAddress)
  }
  roomState.playerMatchKillsByAddress.delete(normalizedAddress)
  roomState.playerMatchWavesSurvivedByAddress.delete(normalizedAddress)
  setPlayers(roomId, nextPlayers)
  setArenaPlayers(roomId, nextArenaPlayers)
  if (nextArenaPlayers.length === 0) {
    cancelArenaAutoTeleportCountdown(roomId)
  }
  if (nextArenaPlayers.length === 0) {
    cancelArenaIntroCountdown(roomId)
    if (state.phase === LobbyPhase.MATCH_CREATED) {
      resetArenaToLobby(roomId, 'Match closed. Returning to lobby.')
    }
  }

  if (leavingPlayer) {
    logLobbyServerEvent(
      roomId,
      `PlayerLeft ${leavingPlayer.displayName} ${nextPlayers.length}/${MATCH_MAX_PLAYERS}`
    )
    sendToLobby(roomId, 'lobbyEvent', {
      type: 'leave',
      message: `${leavingPlayer.displayName} left lobby`
    })
  }
}

function getConnectedPlayerAddresses(): Set<string> {
  const connectedAddresses = new Set<string>()
  for (const [_entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (!identity.address) continue
    connectedAddresses.add(identity.address.toLowerCase())
  }
  return connectedAddresses
}

async function reconcileDisconnectedLobbyPlayers(): Promise<void> {
  if (isDisconnectReconcileInFlight) return
  isDisconnectReconcileInFlight = true

  try {
    const now = getServerTime()
    const connectedAddresses = getConnectedPlayerAddresses()
    const stalePlayers: Array<{ roomId: RoomId; address: string }> = []

    for (const roomId of ROOM_IDS) {
      const lobbyState = getLobbyState(roomId)
      for (const player of lobbyState.players) {
        const address = player.address.toLowerCase()
        if (connectedAddresses.has(address)) {
          disconnectedLobbyPlayerSinceMs.delete(address)
          continue
        }

        const missingSince = disconnectedLobbyPlayerSinceMs.get(address) ?? now
        disconnectedLobbyPlayerSinceMs.set(address, missingSince)
        if (now - missingSince >= DISCONNECTED_PLAYER_GRACE_MS) {
          stalePlayers.push({ roomId, address })
        }
      }
    }

    for (const trackedAddress of [...disconnectedLobbyPlayerSinceMs.keys()]) {
      if (connectedAddresses.has(trackedAddress)) {
        disconnectedLobbyPlayerSinceMs.delete(trackedAddress)
      }
    }

    for (const entry of stalePlayers) {
      logLobbyServerEvent(entry.roomId, `PlayerDisconnected ${entry.address}`)
      await removePlayerFromLobby(entry.roomId, entry.address)
    }
  } finally {
    isDisconnectReconcileInFlight = false
  }
}

function disconnectedPlayerReconcileSystem(dt: number): void {
  disconnectedPlayerReconcileAccumulator += dt
  if (disconnectedPlayerReconcileAccumulator < DISCONNECTED_PLAYER_RECONCILE_INTERVAL_SECONDS) return
  disconnectedPlayerReconcileAccumulator = 0
  void reconcileDisconnectedLobbyPlayers()
}

function createMatch(roomId: RoomId, address: string): void {
  const normalizedAddress = address.toLowerCase()
  const state = getLobbyState(roomId)
  if (state.phase === LobbyPhase.MATCH_CREATED) return
  if (!state.players.length) return
  if (!state.players.some((p) => p.address === normalizedAddress)) return

  const mutable = getLobbyStateMutable(roomId)
  mutable.phase = LobbyPhase.MATCH_CREATED
  mutable.hostAddress = state.hostAddress || normalizedAddress
  mutable.matchId = `${roomId}_match_${Date.now()}`
  mutable.arenaPlayers = [...state.players]
  mutable.countdownEndTimeMs = 0
  mutable.arenaIntroEndTimeMs = 0
  resetMatchRuntime(roomId)
  logLobbyServerEvent(roomId, `MatchCreated ${mutable.matchId} by ${normalizedAddress}`)

  sendToLobby(roomId, 'lobbyEvent', {
    type: 'match_created',
    message: `Match created (${mutable.matchId})`
  })

  for (const player of mutable.arenaPlayers) {
    sendPlayerLoadoutState(player.address)
  }

  if (mutable.arenaPlayers.length === MATCH_MAX_PLAYERS) {
    startArenaAutoTeleportCountdown(roomId, mutable.arenaPlayers)
  }
}

function getSpawnGroupSize(waveNumber: number): number {
  const growth = Math.floor(Math.max(0, waveNumber - 1) / CLIENT_GROUP_GROWTH_EVERY_WAVES)
  return Math.min(CLIENT_MAX_GROUP_SIZE, CLIENT_BASE_GROUP_SIZE + growth)
}

function getExploderChanceForWave(waveNumber: number): number {
  if (waveNumber >= EXPLODER_ZOMBIE_CHANCE_WAVE_4) return EXPLODER_ZOMBIE_CHANCE_4
  if (waveNumber >= EXPLODER_ZOMBIE_CHANCE_WAVE_3) return EXPLODER_ZOMBIE_CHANCE_3
  if (waveNumber >= EXPLODER_ZOMBIE_CHANCE_WAVE_2) return EXPLODER_ZOMBIE_CHANCE_2
  return EXPLODER_ZOMBIE_BASE_CHANCE
}

function getExploderMaxSimultaneousForWave(waveNumber: number): number {
  return waveNumber >= EXPLODER_ZOMBIE_MAX_SIMULTANEOUS_LATE_WAVE
    ? EXPLODER_ZOMBIE_MAX_SIMULTANEOUS_LATE
    : EXPLODER_ZOMBIE_MAX_SIMULTANEOUS_EARLY
}

function pickZombieType(waveNumber: number): ZombieType {
  if (waveNumber === 1) return 'basic'
  const roll = Math.random()
  if (waveNumber >= TANK_ZOMBIE_UNLOCK_WAVE && roll < TANK_ZOMBIE_CHANCE) return 'tank'
  if (waveNumber >= QUICK_ZOMBIE_UNLOCK_WAVE && roll < QUICK_ZOMBIE_CHANCE) return 'quick'
  return 'basic'
}

function randomSpawnPoint(roomId: RoomId) {
  const roomConfig = getRoomServerState(roomId).roomConfig
  const minX = roomConfig.spawnMinX
  const maxX = roomConfig.spawnMaxX
  const minZ = roomConfig.spawnMinZ
  const maxZ = roomConfig.spawnMaxZ

  for (let attempt = 0; attempt < 10; attempt++) {
    const edge = Math.floor(Math.random() * 4)
    let spawnX = minX
    let spawnZ = minZ

    if (edge === 0) {
      spawnX = minX + Math.random() * SPAWN_EDGE_BAND_WIDTH
      spawnZ = minZ + Math.random() * (maxZ - minZ)
    } else if (edge === 1) {
      spawnX = maxX - Math.random() * SPAWN_EDGE_BAND_WIDTH
      spawnZ = minZ + Math.random() * (maxZ - minZ)
    } else if (edge === 2) {
      spawnX = minX + Math.random() * (maxX - minX)
      spawnZ = minZ + Math.random() * SPAWN_EDGE_BAND_WIDTH
    } else {
      spawnX = minX + Math.random() * (maxX - minX)
      spawnZ = maxZ - Math.random() * SPAWN_EDGE_BAND_WIDTH
    }

    const dx = spawnX - roomConfig.arenaCenter.x
    const dz = spawnZ - roomConfig.arenaCenter.z
    if (dx * dx + dz * dz >= SPAWN_CENTER_SAFE_RADIUS_SQ) {
      return { spawnX, spawnY: 0, spawnZ }
    }
  }

  return {
    spawnX: Math.random() < 0.5 ? minX : maxX,
    spawnY: 0,
    spawnZ: minZ + Math.random() * (maxZ - minZ)
  }
}

function buildWaveSpawnPlan(
  roomId: RoomId,
  waveNumber: number,
  startAtMs: number,
  activeDurationSeconds: number,
  playerCount: number
) {
  const roomState = getRoomServerState(roomId)
  const intervalMs = Math.floor(CLIENT_SPAWN_INTERVAL_SECONDS * 1000)
  const activeMs = Math.floor(activeDurationSeconds * 1000)
  const latestSpawnAtMs = startAtMs + activeMs - 100
  const exploderCooldownMs = Math.floor(EXPLODER_ZOMBIE_COOLDOWN_SECONDS * 1000)
  // Scale group size with player count: +10% per additional player (1p=1x, 2p=1.1x, 3p=1.2x, 4p=1.3x)
  const playerMultiplier = 0.9 + Math.max(1, playerCount) * 0.1
  const groupSize = Math.round(getSpawnGroupSize(waveNumber) * playerMultiplier)
  const spawns: WavePlanSpawn[] = []
  let lastExploderSpawnAtMs = Number.NEGATIVE_INFINITY
  let guaranteedExploderSpawned = false

  for (let offsetMs = 0; offsetMs < activeMs; offsetMs += intervalMs) {
    const groupSpawnAtMs = startAtMs + offsetMs
    let groupHasExploder = false

    for (let i = 0; i < groupSize; i++) {
      const spawnAtMs = Math.min(groupSpawnAtMs + i * CLIENT_GROUP_STAGGER_MS, latestSpawnAtMs)
      roomState.nextZombieSequence += 1
      const point = randomSpawnPoint(roomId)
      const zombieId = `${roomId}_w${waveNumber}_z${roomState.nextZombieSequence}`
      let zombieType = pickZombieType(waveNumber)

      if (
        waveNumber >= EXPLODER_ZOMBIE_UNLOCK_WAVE &&
        !groupHasExploder &&
        spawnAtMs - lastExploderSpawnAtMs >= exploderCooldownMs
      ) {
        const maxSimultaneousExploders = getExploderMaxSimultaneousForWave(waveNumber)
        const exploderPlanningWindowStartMs = spawnAtMs - exploderCooldownMs * maxSimultaneousExploders
        const explodersAlreadyPlanned = spawns.filter(
          (spawn) =>
            spawn.zombieType === 'exploder' &&
            spawn.spawnAtMs >= exploderPlanningWindowStartMs &&
            spawn.spawnAtMs <= spawnAtMs
        ).length
        const canSpawnExploder = explodersAlreadyPlanned < maxSimultaneousExploders
        const shouldForceTutorialExploder = waveNumber === EXPLODER_ZOMBIE_UNLOCK_WAVE && !guaranteedExploderSpawned
        const shouldRollExploder = Math.random() < getExploderChanceForWave(waveNumber)

        if (canSpawnExploder && (shouldForceTutorialExploder || shouldRollExploder)) {
          zombieType = 'exploder'
          groupHasExploder = true
          guaranteedExploderSpawned = true
          lastExploderSpawnAtMs = spawnAtMs
        }
      }

      spawns.push({
        zombieId,
        zombieType,
        spawnX: point.spawnX,
        spawnY: point.spawnY,
        spawnZ: point.spawnZ,
        spawnAtMs
      })
    }
  }

  return {
    waveNumber,
    startAtMs,
    intervalMs,
    spawns
  }
}

function sendWaveSpawnPlan(roomId: RoomId, waveNumber: number, startAtMs: number): void {
  const roomState = getRoomServerState(roomId)
  const runtime = getMatchRuntimeMutable(roomId)
  const playerCount = getLobbyState(roomId).arenaPlayers.length ?? 1
  const plan = buildWaveSpawnPlan(roomId, waveNumber, startAtMs, runtime.activeDurationSeconds, playerCount)

  for (const spawn of plan.spawns) {
    roomState.zombieSpawnAtById.set(spawn.zombieId, {
      zombieType: spawn.zombieType,
      hp: getZombieMaxHp(spawn.zombieType),
      spawnX: spawn.spawnX,
      spawnY: spawn.spawnY,
      spawnZ: spawn.spawnZ,
      spawnAtMs: spawn.spawnAtMs
    })
    roomState.deadZombieIds.delete(spawn.zombieId)
    roomState.explodedZombieIds.delete(spawn.zombieId)
  }

  recomputeZombiesAlive(roomId, runtime, runtime.serverNowMs)
  runtime.zombiesPlanned = plan.spawns.length

  sendToArena(roomId, 'waveSpawnPlan', { roomId, ...plan })
}

function grantWaveMilestoneGold(roomId: RoomId, waveNumber: number, players: LobbyPlayer[]): void {
  const roomState = getRoomServerState(roomId)
  const reachedMilestones = GOLD_WAVE_MILESTONES.filter((milestone) => milestone.wave <= waveNumber)
  for (const milestone of reachedMilestones) {
    if (roomState.awardedWaveGoldMilestones.has(milestone.wave)) continue
    roomState.awardedWaveGoldMilestones.add(milestone.wave)

    for (const player of players) {
      playerProgressStore.mutate(player.address, (progress) => {
        progress.profile.gold += milestone.gold
      })
      sendPlayerLoadoutState(player.address)
    }

    sendToLobby(roomId, 'lobbyEvent', {
      type: 'gold_reward',
      message: `Wave ${milestone.wave} reached: +${milestone.gold} GOLD`
    })
  }
}

function startZombieWaves(roomId: RoomId, address: string, startReason: 'manual' | 'auto' = 'manual'): void {
  const normalizedAddress = address.toLowerCase()
  const state = getLobbyState(roomId)
  if (state.phase !== LobbyPhase.MATCH_CREATED) return
  if (!state.arenaPlayers.some((p) => p.address === normalizedAddress)) return

  const runtime = getMatchRuntimeMutable(roomId)
  if (runtime.isRunning) return

  const lobby = getLobbyStateMutable(roomId)
  lobby.arenaIntroEndTimeMs = 0

  runtime.isRunning = true
  runtime.waveNumber = 1
  runtime.cyclePhase = WaveCyclePhase.ACTIVE
  runtime.serverNowMs = getServerTime()
  runtime.phaseEndTimeMs = runtime.serverNowMs + runtime.activeDurationSeconds * 1000
  runtime.startedByAddress = normalizedAddress
  clearZombieTracking(roomId, runtime)
  initializeMatchLeaderboardStats(roomId, state.arenaPlayers)
  sendWaveSpawnPlan(roomId, runtime.waveNumber, runtime.serverNowMs)
  queueLavaHazardsForWave(roomId, runtime.waveNumber, runtime.serverNowMs)
  spawnScheduledLavaHazards(roomId, runtime.serverNowMs)
  logLobbyServerEvent(roomId, `WavesStarted by ${normalizedAddress}`)

  for (const player of state.arenaPlayers) {
    resetPlayerCombatState(player.address)
  }
  sendPlayerHealthStatesForLobbyPlayers(roomId, state.arenaPlayers)
  for (const player of state.arenaPlayers) {
    sendPlayerArenaWeaponState(roomId, player.address)
  }

  for (const player of state.arenaPlayers) {
    playerProgressStore.mutate(player.address, (progress) => {
      progress.profile.lifetimeStats.matchesPlayed += 1
    })
  }

  sendToLobby(roomId, 'lobbyEvent', {
    type: 'waves_started',
    message: startReason === 'auto' ? 'Waves started' : `${getPlayerDisplayName(normalizedAddress)} started zombies`
  })
}

let waveTickAccumulator = 0
function waveRuntimeSystem(dt: number): void {
  waveTickAccumulator += dt
  if (waveTickAccumulator < 0.2) return
  waveTickAccumulator = 0

  for (const roomId of ROOM_IDS) {
    const lobbyState = getLobbyState(roomId)
    if (lobbyState.phase !== LobbyPhase.MATCH_CREATED) continue

    const runtime = getMatchRuntimeMutable(roomId)
    const now = getServerTime()
    runtime.serverNowMs = now
    expirePotions(roomId, now)
    spawnScheduledLavaHazards(roomId, now)
    expireLavaHazards(roomId, now)
    tickCollectibleExpiry(roomId, now)
    recomputeZombiesAlive(roomId, runtime, now)

    const pendingTeamWipeReturn = getRoomServerState(roomId).pendingTeamWipeReturn
    if (pendingTeamWipeReturn && now >= pendingTeamWipeReturn.executeAtMs) {
      finalizePendingTeamWipeReturn(roomId)
      continue
    }

    if (lobbyState.arenaPlayers.length === 0) {
      cancelArenaIntroCountdown(roomId)
      resetArenaToLobby(roomId, 'Match closed. Returning to lobby.')
      continue
    }

    if (lobbyState.countdownEndTimeMs > 0 && now >= lobbyState.countdownEndTimeMs) {
      cancelArenaAutoTeleportCountdown(roomId)
      sendArenaAutoTeleport(roomId, lobbyState.arenaPlayers)
    }

    if (!runtime.isRunning && lobbyState.arenaIntroEndTimeMs > 0 && now >= lobbyState.arenaIntroEndTimeMs) {
      const starterAddress = lobbyState.arenaPlayers.some((player) => player.address === lobbyState.hostAddress)
        ? lobbyState.hostAddress
        : lobbyState.arenaPlayers[0]?.address
      if (starterAddress) {
        startZombieWaves(roomId, starterAddress, 'auto')
      }
    }

    for (const player of lobbyState.arenaPlayers) {
      const combat = getOrCreatePlayerCombatState(player.address)
      if (!combat.isDead) continue
      if (combat.respawnAtMs <= 0 || now < combat.respawnAtMs) continue
      combat.hp = PLAYER_MAX_HP
      combat.isDead = false
      combat.respawnAtMs = 0
      sendPlayerHealthState(player.address, roomId)
    }

    if (!runtime.isRunning) continue
    if (now < runtime.phaseEndTimeMs) continue

    if (runtime.cyclePhase === WaveCyclePhase.ACTIVE) {
      const roomState = getRoomServerState(roomId)
      runtime.cyclePhase = WaveCyclePhase.REST
      runtime.phaseEndTimeMs = now + runtime.restDurationSeconds * 1000
      clearAllLavaHazards(roomId)
      grantWaveMilestoneGold(roomId, runtime.waveNumber, lobbyState.arenaPlayers)
      for (const player of lobbyState.arenaPlayers) {
        const normalizedAddress = player.address.toLowerCase()
        roomState.playerMatchWavesSurvivedByAddress.set(
          normalizedAddress,
          (roomState.playerMatchWavesSurvivedByAddress.get(normalizedAddress) ?? 0) + 1
        )
        playerProgressStore.mutate(player.address, (progress) => {
          progress.profile.lifetimeStats.wavesCleared += 1
        })
      }
      sendToLobby(roomId, 'lobbyEvent', {
        type: 'wave_rest',
        message: `Wave ${runtime.waveNumber} complete. Resting...`
      })
    } else {
      runtime.waveNumber += 1
      runtime.cyclePhase = WaveCyclePhase.ACTIVE
      runtime.phaseEndTimeMs = now + runtime.activeDurationSeconds * 1000
      sendWaveSpawnPlan(roomId, runtime.waveNumber, now)
      queueLavaHazardsForWave(roomId, runtime.waveNumber, now)
      spawnScheduledLavaHazards(roomId, now)
      sendToLobby(roomId, 'lobbyEvent', {
        type: 'wave_active',
        message: `Wave ${runtime.waveNumber} started`
      })
    }
  }
}

let progressAutosaveAccumulator = 0
function playerProgressAutosaveSystem(dt: number): void {
  progressAutosaveAccumulator += dt
  if (progressAutosaveAccumulator < PLAYER_PROGRESS_AUTOSAVE_SECONDS) return
  progressAutosaveAccumulator = 0
  void playerProgressStore.saveDirty()
}

function getLeaderboardEntityMutable() {
  if (!leaderboardEntity) {
    leaderboardEntity = engine.addEntity()
    GlobalLeaderboardComponent.create(leaderboardEntity, { kills: [], waves: [] })
    syncEntity(leaderboardEntity, [GlobalLeaderboardComponent.componentId])
  }
  return GlobalLeaderboardComponent.getMutable(leaderboardEntity)
}

function syncLeaderboardToComponent(): void {
  const comp = getLeaderboardEntityMutable()
  comp.kills = leaderboardStore.getKillsTop().map((e) => ({
    address: e.address,
    displayName: e.displayName,
    value: e.value
  }))
  comp.waves = leaderboardStore.getWavesTop().map((e) => ({
    address: e.address,
    displayName: e.displayName,
    value: e.value
  }))
}

function commitPlayerMatchStatsToLeaderboard(roomId: RoomId, player: LobbyPlayer): boolean {
  const progress = playerProgressStore.get(player.address)
  if (!progress) return false

  const roomState = getRoomServerState(roomId)
  const killsChanged = leaderboardStore.update(
    'kills',
    player.address,
    progress.profile.lastKnownName,
    roomState.playerMatchKillsByAddress.get(player.address) ?? 0
  )
  const wavesChanged = leaderboardStore.update(
    'waves',
    player.address,
    progress.profile.lastKnownName,
    roomState.playerMatchWavesSurvivedByAddress.get(player.address) ?? 0
  )

  return killsChanged || wavesChanged
}

function commitMatchStatsToLeaderboard(roomId: RoomId, players: LobbyPlayer[]): void {
  let changed = false
  for (const player of players) {
    if (commitPlayerMatchStatsToLeaderboard(roomId, player)) changed = true
  }
  if (changed) {
    syncLeaderboardToComponent()
    void leaderboardStore.persist()
  }
}

export function setupLobbyServer(): void {
  refreshArenaRoomConfigsFromScene()
  for (const roomId of ROOM_IDS) {
    roomServerStateById[roomId].roomConfig = getArenaRoomConfig(roomId)
  }

  for (const roomId of ROOM_IDS) {
    getLobbyStateMutable(roomId)
    getMatchRuntimeMutable(roomId)
  }

  getLeaderboardEntityMutable()
  void leaderboardStore.load().then(() => {
    syncLeaderboardToComponent()
  })

  room.onMessage('playerLoadProfile', async (_data, context) => {
    if (!context) return
    await ensurePlayerProfileLoaded(context.from)
  })

  room.onMessage('playerJoinLobby', async (data, context) => {
    if (!context) return
    const roomId = getRequestedRoomId(data.roomId, getPlayerRoomId(context.from) ?? DEFAULT_ROOM_ID)
    await ensurePlayerLoadedAndInLobby(roomId, context.from)
    sendPlayerHealthState(context.from, roomId)
    sendArenaWeaponStatesTo(roomId, context.from)
    sendArenaLoadoutStatesTo(roomId, context.from)
    sendArenaZcStatesTo(roomId, context.from)
    sendPowerupStatesTo(roomId, context.from)
    if (isPlayerInArena(context.from, roomId)) {
      sendActivePotionsTo(roomId, context.from)
      sendActiveLavaHazardsTo(roomId, context.from)
      sendActiveCollectiblesTo(roomId, context.from)
    }
  })

  room.onMessage('playerLeaveLobby', async (data, context) => {
    if (!context) return
    const roomId = getPlayerRoomId(context.from) ?? getRequestedRoomId(data.roomId)
    if (!isPlayerInLobby(context.from, roomId)) return
    await removePlayerFromLobby(roomId, context.from)
  })

  room.onMessage('playerForfeitMatch', async (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    const roomId = getPlayerRoomId(normalizedAddress) ?? getRequestedRoomId(data.roomId)
    if (!isPlayerInLobby(normalizedAddress, roomId)) return

    const lobbyState = getLobbyState(roomId)
    const runtime = getMatchRuntimeMutable(roomId)
    if (lobbyState.phase !== LobbyPhase.MATCH_CREATED || !isPlayerInArena(normalizedAddress, roomId) || !runtime.isRunning) {
      await removePlayerFromLobby(roomId, normalizedAddress)
      return
    }

    const now = getServerTime()
    const state = getOrCreatePlayerCombatState(normalizedAddress)
    if (state.lives <= 0) return

    state.lives = Math.min(state.lives, 1)
    applyPlayerDeath(state, now, normalizedAddress, roomId)
    sendPlayerHealthState(normalizedAddress, roomId)
  })

  room.onMessage('buyLoadoutWeapon', async (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    await ensurePlayerProfileLoaded(normalizedAddress)

    const weapon = getLoadoutWeaponDefinition(data.weaponId)
    if (!weapon || weapon.priceGold === 0) return

    const progress = playerProgressStore.get(normalizedAddress)
    if (!progress) return

    const alreadyOwned = progress.weapons.ownedByTier[weapon.tierKey].includes(weapon.id)
    if (alreadyOwned) {
      sendPlayerLoadoutState(normalizedAddress)
      return
    }
    if (progress.profile.gold < weapon.priceGold) {
      sendMessage('lobbyEvent', {
        type: 'loadout_error',
        message: `Not enough GOLD for ${weapon.label}`
      }, [normalizedAddress])
      return
    }

    playerProgressStore.mutate(normalizedAddress, (state) => {
      state.profile.gold -= weapon.priceGold
      state.weapons.ownedByTier[weapon.tierKey] = [...state.weapons.ownedByTier[weapon.tierKey], weapon.id]
      state.weapons.equippedByTier[weapon.tierKey] = weapon.id
    })
    await playerProgressStore.save(normalizedAddress)
    sendPlayerLoadoutState(normalizedAddress)

    sendMessage('lobbyEvent', {
      type: 'loadout_purchase',
      message: `${weapon.label} purchased and equipped for ${weapon.priceGold} GOLD`
    }, [normalizedAddress])
  })

  room.onMessage('equipLoadoutWeapon', async (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    await ensurePlayerProfileLoaded(normalizedAddress)

    const weapon = getLoadoutWeaponDefinition(data.weaponId)
    if (!weapon) return

    const progress = playerProgressStore.get(normalizedAddress)
    if (!progress) return

    const ownedWeaponIds =
      weapon.priceGold === 0
        ? [weapon.id]
        : progress.weapons.ownedByTier[weapon.tierKey]
    if (!ownedWeaponIds.includes(weapon.id)) {
      sendMessage('lobbyEvent', {
        type: 'loadout_error',
        message: `${weapon.label} is not owned yet`
      }, [normalizedAddress])
      return
    }

    playerProgressStore.mutate(normalizedAddress, (state) => {
      state.weapons.equippedByTier[weapon.tierKey] = weapon.id
    })
    await playerProgressStore.save(normalizedAddress)
    sendPlayerLoadoutState(normalizedAddress)

    sendMessage('lobbyEvent', {
      type: 'loadout_equipped',
      message: `${weapon.label} equipped`
    }, [normalizedAddress])
  })

  room.onMessage('createMatch', (data, context) => {
    if (!context) return
    const roomId = getPlayerRoomId(context.from) ?? getRequestedRoomId(data.roomId)
    if (!isPlayerInLobby(context.from, roomId)) return
    const state = getLobbyState(roomId)
    if (state.phase === LobbyPhase.MATCH_CREATED) return
    createMatch(roomId, context.from)
  })

  room.onMessage('startGameManual', (data, context) => {
    if (!context) return
    const roomId = getPlayerRoomId(context.from) ?? getRequestedRoomId(data.roomId)
    if (!isPlayerInLobby(context.from, roomId)) return
    const state = getLobbyState(roomId)
    if (state.phase !== LobbyPhase.MATCH_CREATED) {
      createMatch(roomId, context.from)
    }
    const updatedState = getLobbyState(roomId)
    if (updatedState.phase === LobbyPhase.MATCH_CREATED && updatedState.arenaPlayers.length > 0) {
      startArenaAutoTeleportCountdown(roomId, updatedState.arenaPlayers)
    }
  })

  room.onMessage('createMatchAndJoin', async (data, context) => {
    if (!context) return
    const roomId = getRequestedRoomId(data.roomId, getPlayerRoomId(context.from) ?? DEFAULT_ROOM_ID)
    if (!isPlayerInLobby(context.from, roomId) && isMatchJoinLocked(roomId)) {
      logLobbyServerEvent(roomId, `JoinRejectedMatchLocked ${context.from.toLowerCase()}`)
      await ensurePlayerProfileLoaded(context.from)
      const previousRoomId = getPlayerRoomId(context.from)
      if (previousRoomId && previousRoomId !== roomId) {
        await removePlayerFromLobby(previousRoomId, context.from, { preserveLoadedProfile: true })
      }
      addPlayerToLobby(roomId, context.from)
      sendToLobby(roomId, 'lobbyEvent', {
        type: 'match_locked',
        message: `${getPlayerDisplayName(context.from.toLowerCase())} can join the next match`
      })
      return
    }
    await ensurePlayerLoadedAndInLobby(roomId, context.from)
    const state = getLobbyState(roomId)
    if (state.phase !== LobbyPhase.MATCH_CREATED) {
      createMatch(roomId, context.from)
    }
    sendPlayerHealthState(context.from, roomId)
    sendArenaWeaponStatesTo(roomId, context.from)
    sendArenaLoadoutStatesTo(roomId, context.from)
    sendArenaZcStatesTo(roomId, context.from)
    sendPowerupStatesTo(roomId, context.from)
    if (isPlayerInArena(context.from, roomId)) {
      sendActivePotionsTo(roomId, context.from)
      sendActiveLavaHazardsTo(roomId, context.from)
      sendActiveCollectiblesTo(roomId, context.from)
    }
  })


  room.onMessage('playerArenaWeaponChanged', (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    const roomId = getPlayerRoomId(normalizedAddress)
    if (!roomId || !isPlayerInArena(normalizedAddress, roomId)) return
    if (!isArenaWeaponType(data.weaponType)) return

    const upgradeLevel =
      Number.isInteger(data.upgradeLevel) && data.upgradeLevel >= 1 && data.upgradeLevel <= 3
        ? data.upgradeLevel
        : 1
    const roomState = getRoomServerState(roomId)
    roomState.arenaWeaponByAddress.set(normalizedAddress, { weaponType: data.weaponType, upgradeLevel })
    sendPlayerArenaWeaponState(roomId, normalizedAddress)

    if (data.weaponType !== 'gun') {
      const unlocked = roomState.playerUnlockedArenaWeaponsInMatch.get(normalizedAddress) ?? new Set<ArenaWeaponType>()
      if (!unlocked.has(data.weaponType)) {
        const cost = data.weaponType === 'shotgun' ? SHOTGUN_UNLOCK_COST_ZC : data.weaponType === 'minigun' ? MINIGUN_UNLOCK_COST_ZC : 0
        if (cost > 0) {
          const currentZc = roomState.playerMatchZcByAddress.get(normalizedAddress) ?? 0
          roomState.playerMatchZcByAddress.set(normalizedAddress, Math.max(0, currentZc - cost))
        }
        unlocked.add(data.weaponType)
        roomState.playerUnlockedArenaWeaponsInMatch.set(normalizedAddress, unlocked)
        sendPlayerZcState(roomId, normalizedAddress)
      }
    }
  })

  room.onMessage('zombieHitRequest', (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    const roomId = getPlayerRoomId(normalizedAddress)
    if (!roomId || !isPlayerInArena(normalizedAddress, roomId)) return
    const lobbyState = getLobbyState(roomId)
    if (lobbyState.phase !== LobbyPhase.MATCH_CREATED) return
    const runtime = getMatchRuntimeMutable(roomId)
    if (!runtime.isRunning) return
    if (!data.zombieId) return
    if (!isArenaWeaponType(data.weaponType)) return

    const shotSeq = Number.isFinite(data.shotSeq) ? Math.floor(data.shotSeq) : -1
    if (shotSeq < 0) return

    const allowanceKey = getShotAllowanceKey(normalizedAddress, data.weaponType, shotSeq)
    const remainingHits = zombieHitAllowanceByShotKey.get(allowanceKey) ?? 0
    if (remainingHits <= 0) return
    const now = getServerTime()

    const damage = getWeaponHitDamage(normalizedAddress, data.weaponType as ArenaWeaponType)
    zombieHitAllowanceByShotKey.set(allowanceKey, remainingHits - 1)
    const deathPos = (Number.isFinite(data.positionX) && Number.isFinite(data.positionY) && Number.isFinite(data.positionZ))
      ? { x: data.positionX, y: data.positionY, z: data.positionZ }
      : null
    applyZombieDamage(roomId, data.zombieId, damage, normalizedAddress, now, deathPos)
  })

  room.onMessage('zombieExplodeRequest', (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    const roomId = getPlayerRoomId(normalizedAddress)
    if (!roomId || !isPlayerInArena(normalizedAddress, roomId)) return

    const lobbyState = getLobbyState(roomId)
    if (lobbyState.phase !== LobbyPhase.MATCH_CREATED) return

    const runtime = getMatchRuntimeMutable(roomId)
    if (!runtime.isRunning) return
    if (!data.zombieId) return

    explodeZombie(roomId, data.zombieId, getServerTime())
  })

  room.onMessage('potionClaimRequest', (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    const roomId = getPlayerRoomId(normalizedAddress)
    if (!roomId || !isPlayerInArena(normalizedAddress, roomId)) return
    if (!data.potionId) return

    const roomState = getRoomServerState(roomId)
    const potion = roomState.activePotionsById.get(data.potionId)
    if (!potion) {
      sendMessage('potionClaimRejected', { potionId: data.potionId }, [normalizedAddress])
      return
    }

    const now = getServerTime()
    if (potion.expiresAtMs <= now) {
      roomState.activePotionsById.delete(data.potionId)
      sendToArena(roomId, 'potionExpired', { roomId, potionId: data.potionId })
      return
    }

    const playerPosition = getPlayerPosition(normalizedAddress)
    if (
      playerPosition &&
      distanceXZ(playerPosition.x, playerPosition.z, potion.positionX, potion.positionZ) > POTION_PICKUP_RADIUS
    ) {
      sendMessage('potionClaimRejected', { potionId: data.potionId }, [normalizedAddress])
      return
    }

    roomState.activePotionsById.delete(data.potionId)
    const state = getOrCreatePlayerCombatState(normalizedAddress)
    if (potion.potionType === 'rage') {
      state.rageShieldEndAtMs = now + RAGE_SHIELD_DURATION_MS
    } else if (potion.potionType === 'speed') {
      state.speedEndAtMs = now + SPEED_POTION_DURATION_MS
    }
    sendPlayerPowerupState(roomId, normalizedAddress)
    sendToArena(roomId, 'potionClaimed', {
      roomId,
      potionId: data.potionId,
      claimerAddress: normalizedAddress
    })
  })

  room.onMessage('collectiblePickupRequest', (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    const roomId = getPlayerRoomId(normalizedAddress)
    if (!roomId || !isPlayerInArena(normalizedAddress, roomId)) return
    if (!data.collectibleId) return

    const roomState = getRoomServerState(roomId)
    const col = roomState.activeCollectiblesById.get(data.collectibleId)
    if (!col) {
      sendMessage('collectibleClaimRejected', { collectibleId: data.collectibleId }, [normalizedAddress])
      return
    }

    const now = getServerTime()
    if (col.expiresAtMs <= now) {
      roomState.activeCollectiblesById.delete(data.collectibleId)
      sendToArena(roomId, 'collectibleExpired', { roomId, collectibleId: data.collectibleId })
      return
    }

    const playerPosition = getPlayerPosition(normalizedAddress)
    const COLLECTIBLE_SERVER_PICKUP_RADIUS = 3.5
    if (
      playerPosition &&
      distanceXZ(playerPosition.x, playerPosition.z, col.positionX, col.positionZ) > COLLECTIBLE_SERVER_PICKUP_RADIUS
    ) {
      sendMessage('collectibleClaimRejected', { collectibleId: data.collectibleId }, [normalizedAddress])
      return
    }

    roomState.activeCollectiblesById.delete(data.collectibleId)
    sendToArena(roomId, 'collectibleClaimed', {
      roomId,
      collectibleId: data.collectibleId,
      claimerAddress: normalizedAddress
    })
    const currentZc = roomState.playerMatchZcByAddress.get(normalizedAddress) ?? 0
    roomState.playerMatchZcByAddress.set(normalizedAddress, currentZc + COINS_PER_KILL)
    sendPlayerZcState(roomId, normalizedAddress)
  })

  room.onMessage('rageShieldHitRequest', (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    const roomId = getPlayerRoomId(normalizedAddress)
    if (!roomId || !isPlayerInArena(normalizedAddress, roomId)) return
    if (!data.zombieId) return

    const lobbyState = getLobbyState(roomId)
    if (lobbyState.phase !== LobbyPhase.MATCH_CREATED) return

    const runtime = getMatchRuntimeMutable(roomId)
    if (!runtime.isRunning) return

    const now = getServerTime()
    const state = getOrCreatePlayerCombatState(normalizedAddress)
    if (state.isDead) return
    if (!isRageShieldActive(state, now)) return

    const zombie = getRoomServerState(roomId).zombieSpawnAtById.get(data.zombieId)
    if (!zombie || zombie.spawnAtMs > now) return

    const hitKey = getRageShieldHitKey(normalizedAddress, data.zombieId)
    const lastHitAtMs = lastRageShieldHitAtMsByPlayerAndZombie.get(hitKey) ?? 0
    if (now - lastHitAtMs < RAGE_SHIELD_HIT_COOLDOWN_MS) return

    // The server only tracks the zombie spawn point, not its live world position.
    // Range gating is already performed client-side against the current zombie transform.
    lastRageShieldHitAtMsByPlayerAndZombie.set(hitKey, now)
    applyZombieDamage(roomId, data.zombieId, RAGE_SHIELD_DAMAGE, normalizedAddress, now)
  })

  room.onMessage('playerDamageRequest', (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    const roomId = getPlayerRoomId(normalizedAddress)
    if (!roomId || !isPlayerInArena(normalizedAddress, roomId)) return

    const lobbyState = getLobbyState(roomId)
    if (lobbyState.phase !== LobbyPhase.MATCH_CREATED) return

    const runtime = getMatchRuntimeMutable(roomId)
    if (!runtime.isRunning) return

    const now = getServerTime()
    const state = getOrCreatePlayerCombatState(normalizedAddress)
    if (state.isDead) return
    if (isRageShieldActive(state, now)) return
    if (now - state.lastDamageRequestAtMs < PLAYER_DAMAGE_REQUEST_COOLDOWN_MS) return

    const requestedAmount = Number.isFinite(data.amount) ? Math.floor(data.amount) : 1
    const amount = Math.max(1, Math.min(3, requestedAmount))
    state.lastDamageRequestAtMs = now
    state.hp = Math.max(0, state.hp - amount)
    if (state.hp <= 0) applyPlayerDeath(state, now, normalizedAddress, roomId)
    sendPlayerHealthState(normalizedAddress, roomId)

    if (areAllLobbyPlayersEliminated(lobbyState.arenaPlayers)) {
      endMatchAndReturnToLobby(roomId, 'All players died. Returning to lobby.')
    }
  })

  room.onMessage('lavaHazardDamageRequest', (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    const roomId = getPlayerRoomId(normalizedAddress)
    if (!roomId || !isPlayerInArena(normalizedAddress, roomId)) return
    if (!data.lavaId) return

    const lobbyState = getLobbyState(roomId)
    if (lobbyState.phase !== LobbyPhase.MATCH_CREATED) return

    const runtime = getMatchRuntimeMutable(roomId)
    if (!runtime.isRunning) return

    const now = getServerTime()
    const lava = getRoomServerState(roomId).activeLavaHazardsById.get(data.lavaId)
    if (!lava) return
    if (now < lava.activeAtMs || now >= lava.expiresAtMs) return

    const state = getOrCreatePlayerCombatState(normalizedAddress)
    if (state.isDead) return
    if (isRageShieldActive(state, now)) return
    if (now - state.lastLavaDamageAtMs < LAVA_DAMAGE_INTERVAL_MS) return

    state.lastLavaDamageAtMs = now
    state.hp = Math.max(0, state.hp - 1)
    if (state.hp <= 0) applyPlayerDeath(state, now, normalizedAddress, roomId)
    sendPlayerHealthState(normalizedAddress, roomId)

    if (areAllLobbyPlayersEliminated(lobbyState.arenaPlayers)) {
      endMatchAndReturnToLobby(roomId, 'All players died. Returning to lobby.')
    }
  })

  room.onMessage('playerExplosionDamageRequest', (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    const roomId = getPlayerRoomId(normalizedAddress)
    if (!roomId || !isPlayerInArena(normalizedAddress, roomId)) return
    if (!data.zombieId) return

    const lobbyState = getLobbyState(roomId)
    if (lobbyState.phase !== LobbyPhase.MATCH_CREATED) return

    const runtime = getMatchRuntimeMutable(roomId)
    if (!runtime.isRunning) return

    const now = getServerTime()
    applyExplosionDamageToPlayer(normalizedAddress, data.zombieId, data.amount, now)

    if (areAllLobbyPlayersEliminated(lobbyState.arenaPlayers)) {
      endMatchAndReturnToLobby(roomId, 'All players died. Returning to lobby.')
    }
  })

  room.onMessage('playerHealRequest', (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    const roomId = getPlayerRoomId(normalizedAddress)
    if (!roomId || !isPlayerInArena(normalizedAddress, roomId)) return

    const lobbyState = getLobbyState(roomId)
    if (lobbyState.phase !== LobbyPhase.MATCH_CREATED) return

    const runtime = getMatchRuntimeMutable(roomId)
    if (!runtime.isRunning) return

    const state = getOrCreatePlayerCombatState(normalizedAddress)
    if (state.isDead) return

    const now = getServerTime()
    if (now - state.lastHealRequestAtMs < PLAYER_HEAL_REQUEST_COOLDOWN_MS) return

    const requestedAmount = Number.isFinite(data.amount) ? Math.floor(data.amount) : HEALTH_POTION_HEAL_AMOUNT
    const amount = Math.max(1, Math.min(HEALTH_POTION_HEAL_AMOUNT, requestedAmount))
    state.lastHealRequestAtMs = now
    state.hp = Math.min(PLAYER_MAX_HP, state.hp + amount)
    sendPlayerHealthState(normalizedAddress, roomId)
  })

  room.onMessage('playerShotRequest', (data, context) => {
    if (!context) return
    const normalizedAddress = context.from.toLowerCase()
    const roomId = getPlayerRoomId(normalizedAddress)
    if (!roomId || !isPlayerInArena(normalizedAddress, roomId)) return

    const lobbyState = getLobbyState(roomId)
    if (lobbyState.phase !== LobbyPhase.MATCH_CREATED) return

    const runtime = getMatchRuntimeMutable(roomId)
    if (!runtime.isRunning) return

    const state = getOrCreatePlayerCombatState(normalizedAddress)
    if (state.isDead) return

    if (!isArenaWeaponType(data.weaponType)) return
    const weaponType = data.weaponType
    const now = getServerTime()
    const rateLimitKey = `${normalizedAddress}:${weaponType}`
    const lastShotAtMs = lastShotAtMsByPlayerAndWeapon.get(rateLimitKey) ?? 0
    const effectiveShotRateLimitMs = getWeaponShotRateLimitMs(normalizedAddress, weaponType) / getPlayerFireRateMultiplier(state, now)
    if (now - lastShotAtMs < effectiveShotRateLimitMs) return

    const originX = Number(data.originX)
    const originY = Number(data.originY)
    const originZ = Number(data.originZ)
    const directionX = Number(data.directionX)
    const directionY = Number(data.directionY)
    const directionZ = Number(data.directionZ)
    if (
      !Number.isFinite(originX) ||
      !Number.isFinite(originY) ||
      !Number.isFinite(originZ) ||
      !Number.isFinite(directionX) ||
      !Number.isFinite(directionY) ||
      !Number.isFinite(directionZ)
    ) {
      return
    }

    const directionLenSq = directionX * directionX + directionY * directionY + directionZ * directionZ
    if (directionLenSq < 0.0001) return
    const directionLen = Math.sqrt(directionLenSq)

    lastShotAtMsByPlayerAndWeapon.set(rateLimitKey, now)
    const shotSeq = Number.isFinite(data.seq) ? Math.floor(data.seq) : 0
    zombieHitAllowanceByShotKey.set(
      getShotAllowanceKey(normalizedAddress, weaponType, shotSeq),
      ZOMBIE_HITS_ALLOWED_PER_SHOT[weaponType]
    )
    sendToArena(roomId, 'playerShotBroadcast', {
      roomId,
      shooterAddress: normalizedAddress,
      seq: shotSeq,
      weaponType,
      originX,
      originY,
      originZ,
      directionX: directionX / directionLen,
      directionY: directionY / directionLen,
      directionZ: directionZ / directionLen,
      firedAtMs: Number.isFinite(data.firedAtMs) ? Math.floor(data.firedAtMs) : now,
      serverTimeMs: now
    })
  })

  engine.addSystem(waveRuntimeSystem, undefined, 'match-wave-runtime-system')
  engine.addSystem(playerProgressAutosaveSystem, undefined, 'player-progress-autosave-system')
  engine.addSystem(disconnectedPlayerReconcileSystem, undefined, 'disconnected-player-reconcile-system')

  console.log('[Server] Lobby server ready')
}
