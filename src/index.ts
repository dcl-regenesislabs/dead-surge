import {
  engine,
  pointerEventsSystem,
  PointerEvents,
  InputAction,
  Transform,
  MainCamera,
  VirtualCamera
} from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { setupUi } from './ui'
import {
  spawnZombie,
  spawnQuickZombie,
  spawnTankZombie,
  zombieSystem,
  bloodParticleSystem,
  bloodSplatSystem,
  spawnVfxSystem,
  explosionVfxSystem,
  rewardTextSystem,
  setPlayerDamageReporter
} from './zombie'
import { initGunSystems, spawnReplicatedGunShotVisual } from './gun'
import { initShotGunSystems, spawnReplicatedShotGunShotVisual } from './shotGun'
import { initMiniGunSystems, spawnReplicatedMiniGunShotVisual } from './miniGun'
import { initBrickSystem } from './brick'
import { initLavaHazardClient, lavaHazardSystem } from './lavaHazard'
import { updateAutoFireToggle, isTopViewEnabled, updateTopViewToggle, isIsoViewEnabled, updateIsoViewToggle } from './gameplayInput'
import { initHealthBarSystem } from './healthBar'
import { initWeaponLifecycleSystem } from './weaponManager'
import {
  isPlayerDead,
  getRespawnDelay,
  respawnPlayer,
  initPlayerDeathMovementLockSystem
} from './playerHealth'
import { getGameTime } from './zombie'
import { rageEffectSystem } from './rageEffect'
import { speedEffectSystem } from './speedEffect'
import { initRageAura } from './rageAura'
import { initSpeedAura } from './speedAura'
import { initPotionSyncClient, potionPickupSystem, potionVisualSystem } from './potions'
import { initCollectibleClient, collectibleSystem } from './collectible'
import { EntityNames } from '../assets/scene/entity-names'
import { setupLobbyServer } from './server/lobbyServer'
import {
  getLocalAddress,
  getLobbyState,
  isLocalReadyForMatch,
  sendPlayerDamageRequest,
  setupLobbyClient
} from './multiplayer/lobbyClient'
import { initMatchWaveClientSystem } from './multiplayer/matchWaveClient'
import { initLobbyWorldPanel } from './lobbyWorldPanel'
import { initLeaderboardWorldPanel } from './LeaderboardWorldPanel'
import { initLobbyStore } from './lobbyStore'
import { initDeathAnimationSystem } from './deathAnimation'
import { getCurrentRoomId } from './roomRuntime'
import {
  initArenaRemoteDefaultWeapons,
  isArenaWeaponType,
  playRemoteWeaponShotAnimation
} from './arenaRemoteDefaultWeapons'
import { initArenaRemotePowerups } from './arenaRemotePowerups'
// import { initLoadoutWorldPanel } from './loadoutWorldPanel'
import { initTimeSync } from './shared/timeSync'
import { room } from './shared/messages'
import { refreshArenaRoomConfigsFromScene } from './shared/roomConfig'
import { DEBUG_SHOP_UI_ONLY, DEBUG_SHOP_UI_ONLY_LOADOUT, DEBUG_UI_ONLY_MODE } from './debugFlags'
import { applyPlayerLoadoutSnapshot } from './loadoutState'
import { openLobbyStore } from './lobbyStoreUi'

// Cinematic (Diablo-like) camera: follows player position but keeps fixed world rotation (no parent)
const CINEMATIC_CAMERA_HEIGHT = 12
const CINEMATIC_CAMERA_DISTANCE = 10 // Offset in world -Z from player (camera in front of default view)
const CINEMATIC_CAMERA_TILT_DEG = 55 // Look down at the scene
// Two-stage smoothing to kill jitter: first smooth the target, then smooth camera toward it
const CINEMATIC_TARGET_SMOOTH_SPEED = 4   // How fast smoothed target follows player (lower = less jitter)
const CINEMATIC_CAMERA_SMOOTH_SPEED = 6   // How fast camera follows smoothed target
const CINEMATIC_DT_MAX = 1 / 30            // Cap dt to avoid spikes from hitches (treat as ~30fps min)
// Top-view camera: overhead angled view that follows the player
const TOP_VIEW_HEIGHT = 15                // Height above player — adjust to taste
const TOP_VIEW_DISTANCE = 6              // Distance behind player — adjust to taste
const TOP_VIEW_TILT_DEG = 70             // Angle looking down — adjust to taste
const TOP_VIEW_SMOOTH_SPEED = 5          // How fast it follows the player
const TOP_VIEW_DT_MAX = 1 / 30
// Iso-view camera: isometric corner view (like the screenshot), 45° rotated
const ISO_VIEW_HEIGHT = 15               // Height above player — adjust to taste
const ISO_VIEW_DISTANCE = 8             // Diagonal distance from player — adjust to taste
const ISO_VIEW_TILT_DEG = 55             // Angle looking down — adjust to taste
const ISO_VIEW_SMOOTH_SPEED = 5
const ISO_VIEW_DT_MAX = 1 / 30

let useCinematicCamera = false
let cinematicCameraEntity: ReturnType<typeof engine.addEntity> | null = null
let cinematicSmoothedTarget = Vector3.create(0, 0, 0)
let cinematicSmoothedTargetReady = false
let topViewCameraEntity: ReturnType<typeof engine.addEntity> | null = null
let topViewSmoothedPos = Vector3.create(0, 0, 0)
let topViewSmoothedReady = false
let prevTopViewState = false
let isoViewCameraEntity: ReturnType<typeof engine.addEntity> | null = null
let isoViewSmoothedPos = Vector3.create(0, 0, 0)
let isoViewSmoothedReady = false
let prevIsoViewState = false
const seenRemoteShotKeys = new Set<string>()
const seenRemoteShotKeyQueue: string[] = []
const MAX_SEEN_REMOTE_SHOTS = 512
const ARENA_LAYOUT_SYSTEM_NAME = 'arena-layout-system'
const EXPECTED_ARENA_LAYOUT_ENTITIES = 1

// Fixed world offset: camera sits here relative to player; rotation never changes
const CINEMATIC_OFFSET = Vector3.create(0, CINEMATIC_CAMERA_HEIGHT, -CINEMATIC_CAMERA_DISTANCE)
const CINEMATIC_ROTATION = Quaternion.fromEulerDegrees(CINEMATIC_CAMERA_TILT_DEG, 0, 0)

function createCinematicCamera() {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(0, 0, 0), // Smoothed toward target every frame
    rotation: CINEMATIC_ROTATION,
    scale: Vector3.One()
  })
  VirtualCamera.create(entity, {})
  return entity
}

function createTopViewCamera() {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(0, 0, 0),
    rotation: Quaternion.fromEulerDegrees(TOP_VIEW_TILT_DEG, 0, 0),
    scale: Vector3.One()
  })
  VirtualCamera.create(entity, {
    defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0.6) }
  })
  return entity
}

function topViewCameraSystem(dt: number) {
  const enabled = isTopViewEnabled()

  // Handle toggle transitions
  if (enabled !== prevTopViewState) {
    prevTopViewState = enabled
    topViewSmoothedReady = false
    if (!MainCamera.has(engine.CameraEntity)) return
    MainCamera.getMutable(engine.CameraEntity).virtualCameraEntity =
      enabled && topViewCameraEntity ? topViewCameraEntity : undefined
  }

  if (!enabled || !topViewCameraEntity || !Transform.has(engine.PlayerEntity)) return

  const stableDt = Math.min(dt, TOP_VIEW_DT_MAX) 
  const playerPos = Transform.get(engine.PlayerEntity).position
  const target = Vector3.create(playerPos.x, playerPos.y + TOP_VIEW_HEIGHT, playerPos.z - TOP_VIEW_DISTANCE)

  if (!topViewSmoothedReady) {
    topViewSmoothedPos = Vector3.clone(target)
    topViewSmoothedReady = true 
  }

  const factor = 1 - Math.exp(-TOP_VIEW_SMOOTH_SPEED * stableDt)
  topViewSmoothedPos = Vector3.lerp(topViewSmoothedPos, target, factor)
  Transform.getMutable(topViewCameraEntity).position = topViewSmoothedPos
}

function createIsoViewCamera() {
  const entity = engine.addEntity()
  // 45° Y rotation = diagonal corner, ISO_VIEW_TILT_DEG X = look down at an angle
  Transform.create(entity, {
    position: Vector3.create(0, 0, 0),
    rotation: Quaternion.fromEulerDegrees(ISO_VIEW_TILT_DEG, 45, 0),
    scale: Vector3.One()
  })
  VirtualCamera.create(entity, {
    defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0.6) }
  })
  return entity
}

function isoViewCameraSystem(dt: number) {
  const enabled = isIsoViewEnabled()

  if (enabled !== prevIsoViewState) {
    prevIsoViewState = enabled
    isoViewSmoothedReady = false
    if (!MainCamera.has(engine.CameraEntity)) return
    MainCamera.getMutable(engine.CameraEntity).virtualCameraEntity =
      enabled && isoViewCameraEntity ? isoViewCameraEntity : undefined
  }

  if (!enabled || !isoViewCameraEntity || !Transform.has(engine.PlayerEntity)) return

  const stableDt = Math.min(dt, ISO_VIEW_DT_MAX)
  const playerPos = Transform.get(engine.PlayerEntity).position
  // Diagonal offset: pull back equally on X and Z (45° corner)
  const diag = ISO_VIEW_DISTANCE * 0.707 // sin/cos of 45°
  const target = Vector3.create(
    playerPos.x - diag,
    playerPos.y + ISO_VIEW_HEIGHT,
    playerPos.z - diag
  )

  if (!isoViewSmoothedReady) {
    isoViewSmoothedPos = Vector3.clone(target)
    isoViewSmoothedReady = true
  }

  const factor = 1 - Math.exp(-ISO_VIEW_SMOOTH_SPEED * stableDt)
  isoViewSmoothedPos = Vector3.lerp(isoViewSmoothedPos, target, factor)
  Transform.getMutable(isoViewCameraEntity).position = isoViewSmoothedPos
}

function cinematicCameraFollowSystem(dt: number) {
  if (!useCinematicCamera || !cinematicCameraEntity || !Transform.has(engine.PlayerEntity)) return
  // Stabilize dt to avoid one-frame spikes causing visible jumps
  const stableDt = Math.min(dt, CINEMATIC_DT_MAX)
  const playerPos = Transform.get(engine.PlayerEntity).position
  const rawTarget = Vector3.add(playerPos, CINEMATIC_OFFSET)

  // Stage 1: smooth the target (filters jitter from player position)
  if (!cinematicSmoothedTargetReady) {
    cinematicSmoothedTarget = Vector3.clone(rawTarget)
    cinematicSmoothedTargetReady = true
  }
  const targetFactor = 1 - Math.exp(-CINEMATIC_TARGET_SMOOTH_SPEED * stableDt)
  cinematicSmoothedTarget = Vector3.lerp(cinematicSmoothedTarget, rawTarget, targetFactor)

  // Stage 2: smooth camera toward the smoothed target
  const camTransform = Transform.getMutable(cinematicCameraEntity)
  const currentPos = camTransform.position
  const cameraFactor = 1 - Math.exp(-CINEMATIC_CAMERA_SMOOTH_SPEED * stableDt)
  camTransform.position = Vector3.lerp(currentPos, cinematicSmoothedTarget, cameraFactor)
}


function setActiveCamera(cinematic: boolean) {
  useCinematicCamera = cinematic
  if (cinematic) cinematicSmoothedTargetReady = false // Re-init smoothed target when entering cinematic
  if (!MainCamera.has(engine.CameraEntity)) return
  const mainCamera = MainCamera.getMutable(engine.CameraEntity)
  mainCamera.virtualCameraEntity = cinematic && cinematicCameraEntity ? cinematicCameraEntity : undefined
}

function isLocalPlayerInCurrentMatch(): boolean {
  const lobbyState = getLobbyState()
  const localAddress = getLocalAddress()
  if (!lobbyState || !localAddress) return false
  if (lobbyState.phase !== 'match_created') return false
  if (!isLocalReadyForMatch()) return false
  return lobbyState.arenaPlayers.some((player) => player.address === localAddress)
}

function rememberRemoteShot(key: string): boolean {
  if (seenRemoteShotKeys.has(key)) return false
  seenRemoteShotKeys.add(key)
  seenRemoteShotKeyQueue.push(key)
  if (seenRemoteShotKeyQueue.length > MAX_SEEN_REMOTE_SHOTS) {
    const oldest = seenRemoteShotKeyQueue.shift()
    if (oldest) seenRemoteShotKeys.delete(oldest)
  }
  return true
}

function setupShotReplicationClient(): void {
  room.onMessage('playerShotBroadcast', (data) => {
    if (data.roomId !== getCurrentRoomId()) return
    if (!isLocalPlayerInCurrentMatch()) return
    const shooterAddress = data.shooterAddress.toLowerCase()
    const localAddress = getLocalAddress()
    if (!shooterAddress || shooterAddress === localAddress) return

    const shotKey = `${shooterAddress}:${data.weaponType}:${Math.floor(data.seq)}`
    if (!rememberRemoteShot(shotKey)) return
    if (!isArenaWeaponType(data.weaponType)) return

    const origin = Vector3.create(data.originX, data.originY, data.originZ)
    const direction = Vector3.create(data.directionX, data.directionY, data.directionZ)
    playRemoteWeaponShotAnimation(shooterAddress, data.weaponType)
    switch (data.weaponType) {
      case 'gun':
        spawnReplicatedGunShotVisual(origin, direction, shooterAddress)
        break
      case 'shotgun':
        spawnReplicatedShotGunShotVisual(origin, direction, shooterAddress)
        break
      case 'minigun':
        spawnReplicatedMiniGunShotVisual(origin, direction, shooterAddress)
        break
    }
  })
}

export function main() {
  refreshArenaRoomConfigsFromScene()

  if (DEBUG_UI_ONLY_MODE !== 'off') {
    if (isServer()) return
    if (DEBUG_SHOP_UI_ONLY) {
      applyPlayerLoadoutSnapshot(DEBUG_SHOP_UI_ONLY_LOADOUT)
    }
    setupUi()
    if (DEBUG_SHOP_UI_ONLY) {
      openLobbyStore()
    }
    return
  }

  if (isServer()) {
    initTimeSync({ isServer: true })
    setupLobbyServer()
    return
  }

  initTimeSync({ isServer: false })

  setupLobbyClient()
  setupShotReplicationClient()
  initPotionSyncClient()
  initCollectibleClient()
  initLavaHazardClient()
  setPlayerDamageReporter((amount) => {
    if (isPlayerDead()) return
    sendPlayerDamageRequest(amount)
  })
  initLobbyWorldPanel()
  initLeaderboardWorldPanel()
  initLobbyStore()
  initArenaRemoteDefaultWeapons()
  initArenaRemotePowerups()
  // Loadout panel disabled
  // initLoadoutWorldPanel()
  setupUi()

  // Cinematic camera: follows player position only, fixed world rotation (Diablo-style)
  cinematicCameraEntity = createCinematicCamera()
  engine.addSystem(cinematicCameraFollowSystem)
  setActiveCamera(false) // Start with regular camera
  // Top-view camera: overhead angled, toggle with key [1]
  topViewCameraEntity = createTopViewCamera()
  engine.addSystem(topViewCameraSystem)
  engine.addSystem(updateTopViewToggle)
  // Iso-view camera: diagonal corner view, toggle with key [2] — activates on arena entry
  isoViewCameraEntity = createIsoViewCamera()
  engine.addSystem(isoViewCameraSystem)
  engine.addSystem(updateIsoViewToggle)

  // Blood burst particles (must run every frame to advance _gameTime)
  engine.addSystem(bloodParticleSystem)
  engine.addSystem(bloodSplatSystem)
  engine.addSystem(spawnVfxSystem)
  engine.addSystem(explosionVfxSystem)
  // Floating +ZC text on zombie kills
  engine.addSystem(rewardTextSystem)
  // Rage potion duration decay
  engine.addSystem(() => rageEffectSystem(getGameTime()))
  // Speed potion duration decay
  engine.addSystem(() => speedEffectSystem(getGameTime()))
  // Red aura around player when enraged
  initRageAura()
  // Yellow speed aura + pickup flash around player
  initSpeedAura()
  // Deferred brick placement (spawn from game loop, not from UI callback)
  initBrickSystem()
  // Health bar billboards above zombies
  initHealthBarSystem()
  // Add zombie behavior system
  engine.addSystem(zombieSystem)
  // Potion pickup and visual (tilt + spin)
  engine.addSystem(potionPickupSystem)
  engine.addSystem(potionVisualSystem)
  engine.addSystem(collectibleSystem)
  engine.addSystem(lavaHazardSystem)
  initDeathAnimationSystem()
  initPlayerDeathMovementLockSystem()
  // Authoritative match waves (30s active / 10s rest)
  initMatchWaveClientSystem()

  // Auto-fire toggle (F key) — must run before weapon systems
  engine.addSystem(updateAutoFireToggle)
  // Init all weapon systems (active weapon gets spawned when match starts)
  initWeaponLifecycleSystem()
  initGunSystems()
  initShotGunSystems()
  initMiniGunSystems()
}
