import { trackTutorialCancelled, trackTutorialCompleted, trackTutorialStarted, trackTutorialStepReached } from './analytics'
import { engine, Entity, GltfContainer, Name, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { EntityNames } from '../assets/scene/entity-names'
import { DEBUG_FORCE_TUTORIAL_MODE } from './debugFlags'
import { setLocalAvatarHidden } from './deathAnimation'
import { endUiPointerCapture, setAutoFireEnabled, setIsoViewEnabled, setTopViewEnabled } from './gameplayInput'
import { setZombieHealthBarMaxHp } from './healthBar'
import { closeLobbyStore } from './lobbyStoreUi'
import { getLobbyState, getLocalAddress, getServerLoadingState, isLocalReadyForMatch, sendCompleteTutorial } from './multiplayer/lobbyClient'
import { resetPlayerHealthAndLives } from './playerHealth'
import { activatePostTutorialArrow, deactivatePostTutorialArrow } from './postTutorialArrow'
import { LOBBY_RETURN_LOOK_AT, LOBBY_RETURN_POSITION } from './shared/roomConfig'
import { LobbyPhase } from './shared/lobbySchemas'
import { playCoinSound } from './soundManager'
import { isTutorialCompleted, isTutorialStateLoaded, markTutorialCompletedLocally, setTutorialActive, setTutorialCombatEnabled } from './tutorialState'
import { enableArenaWeapon, resetArenaWeaponProgress, setWeaponHiddenByTutorial } from './weaponManager'
import { addZombieCoins, COINS_PER_KILL, resetZombieCoins } from './zombieCoins'
import { ZombieComponent, getGameTime, spawnZcRewardTextAtPosition, spawnZombie } from './zombie'

const TUTORIAL_TARGET_HEALTH = 16
const TUTORIAL_COIN_PICKUP_RADIUS = 1.9
const TUTORIAL_COIN_FLOAT_HEIGHT = 0.65
const TUTORIAL_COIN_BOB_AMPLITUDE = 0.12
const TUTORIAL_COIN_BOB_SPEED = 2.1
const TUTORIAL_TARGET_Z_OFFSET = 8.5
const TUTORIAL_PLAYER_SPAWN_X_OFFSET = 4
const TUTORIAL_PLAYER_TO_TARGET_Z_GAP = 9.25
const TUTORIAL_PLAYER_SPAWN_LOBBY_OFFSET = 4.5
const TUTORIAL_ZOMBIE_SPAWN_DELAY_SEC = 0.22
const TUTORIAL_SPLIT_PREVIEW_SEC = 1.2
const TUTORIAL_PANEL_TRANSITION_SEC = 0.45
const TUTORIAL_COMBAT_COUNTDOWN_SEC = 3
const TUTORIAL_MOVEMENT_LOCK_DISTANCE_SQ = 0.0025

type TutorialPhase =
  | 'inactive'
  | 'card1'
  | 'card2_spawn_preview'
  | 'card2_transition'
  | 'card2_ready'
  | 'combat_transition_out'
  | 'combat_countdown'
  | 'combat_hidden'
  | 'card3_transition'
  | 'card3'
  | 'collect_transition_out'
  | 'collect_hidden'
  | 'card4'

type TutorialButtonKey = 'start_mission' | 'got_it' | 'collect_zc' | 'return_to_lobby' | null
type TutorialPanelLayout = 'center-large' | 'transition-to-right' | 'right-small' | 'hidden'

export type TutorialUiState = {
  active: boolean
  showPanel: boolean
  imageSrc: string
  primaryButton: TutorialButtonKey
  showSkip: boolean
  panelLayout: TutorialPanelLayout
  layoutProgress: number
  rightBackdropProgress: number
  countdownText: string
}

export type TutorialCameraFocusTarget = {
  position: Vector3
  kind: 'zombie' | 'coin'
}

type TutorialZombiePauseState = {
  speed: number
  attackCooldown: number
}

const tutorialState: {
  active: boolean
  finishedThisSession: boolean
  completionReported: boolean
  phase: TutorialPhase
  phaseStartedAt: number
  playerSpawn: Vector3
  focusPosition: Vector3
  targetZombie: Entity | null
  targetZombieDeathPosition: Vector3 | null
  ambientZombie: Entity | null
  coinEntity: Entity | null
  coinBasePosition: Vector3 | null
  coinSpawnTime: number
  movementLockPosition: Vector3 | null
} = {
  active: false,
  finishedThisSession: false,
  completionReported: false,
  phase: 'inactive',
  phaseStartedAt: 0,
  playerSpawn: Vector3.create(0, 0, 0),
  focusPosition: Vector3.create(0, 0, 0),
  targetZombie: null,
  targetZombieDeathPosition: null,
  ambientZombie: null,
  coinEntity: null,
  coinBasePosition: null,
  coinSpawnTime: 0,
  movementLockPosition: null
}

function shouldRunTutorial(): boolean {
  return DEBUG_FORCE_TUTORIAL_MODE || !isTutorialCompleted()
}

function removeEntity(entity: Entity | null): void {
  if (entity === null || !Transform.has(entity)) return
  engine.removeEntity(entity)
}

function clearTutorialEntities(): void {
  tutorialZombiePauseStates.clear()
  removeEntity(tutorialState.targetZombie)
  removeEntity(tutorialState.ambientZombie)
  removeEntity(tutorialState.coinEntity)
  tutorialState.targetZombie = null
  tutorialState.ambientZombie = null
  tutorialState.coinEntity = null
  tutorialState.coinBasePosition = null
  tutorialState.targetZombieDeathPosition = null
}

function clearTutorialMovementLock(): void {
  tutorialState.movementLockPosition = null
}

const tutorialZombiePauseStates = new Map<Entity, TutorialZombiePauseState>()
const TUTORIAL_ARENA_FLOOR_NAME_PREFIX = 'Plane'

function findSceneEntity(entityName: EntityNames): Entity | null {
  for (const [entity, name] of engine.getEntitiesWith(Name)) {
    if (name.value === entityName) return entity
  }
  return null
}

function findTutorialArenaFloorEntity(arenaRootEntity: Entity): Entity | null {
  for (const [entity, name, transform] of engine.getEntitiesWith(Name, Transform)) {
    if (transform.parent !== arenaRootEntity) continue
    if (!name.value.startsWith(TUTORIAL_ARENA_FLOOR_NAME_PREFIX)) continue
    return entity
  }
  return null
}

function getTutorialArenaTransform(): {
  center: Vector3
  rotation: ReturnType<typeof Transform.get>['rotation']
} | null {
  const arenaEntity = findSceneEntity(EntityNames.arena_tutorial)
  if (arenaEntity === null) return null

  const rootTransform = Transform.getOrNull(arenaEntity)
  const floorEntity = findTutorialArenaFloorEntity(arenaEntity)
  const floorTransform = floorEntity !== null ? Transform.getOrNull(floorEntity) : null
  if (!rootTransform) return null

  if (!floorTransform) {
    return {
      center: Vector3.clone(rootTransform.position),
      rotation: rootTransform.rotation
    }
  }

  const scaledFloorOffset = Vector3.create(
    floorTransform.position.x * rootTransform.scale.x,
    floorTransform.position.y * rootTransform.scale.y,
    floorTransform.position.z * rootTransform.scale.z
  )
  return {
    center: Vector3.add(rootTransform.position, Vector3.rotate(scaledFloorOffset, rootTransform.rotation)),
    rotation: rootTransform.rotation
  }
}

export function getTutorialArenaFloorBounds(): { centerX: number; centerZ: number; sizeX: number; sizeZ: number } | null {
  const arenaEntity = findSceneEntity(EntityNames.arena_tutorial)
  if (arenaEntity === null) return null
  const rootTransform = Transform.getOrNull(arenaEntity)
  const floorEntity = findTutorialArenaFloorEntity(arenaEntity)
  const floorTransform = floorEntity !== null ? Transform.getOrNull(floorEntity) : null
  if (!rootTransform || !floorTransform) return null
  const scaledFloorOffset = Vector3.create(
    floorTransform.position.x * rootTransform.scale.x,
    floorTransform.position.y * rootTransform.scale.y,
    floorTransform.position.z * rootTransform.scale.z
  )
  const center = Vector3.add(rootTransform.position, Vector3.rotate(scaledFloorOffset, rootTransform.rotation))
  const sizeX = Math.abs(floorTransform.scale.x * rootTransform.scale.x)
  const sizeZ = Math.abs(floorTransform.scale.y * rootTransform.scale.z) // Plane primitive: local Y maps to world Z
  return { centerX: center.x, centerZ: center.z, sizeX, sizeZ }
}

function setTutorialMovementLockPosition(position: Vector3): void {
  tutorialState.movementLockPosition = Vector3.create(position.x, position.y, position.z)
}

function captureTutorialMovementLockPosition(): void {
  if (!Transform.has(engine.PlayerEntity)) return
  const position = Transform.get(engine.PlayerEntity).position
  setTutorialMovementLockPosition(position)
}

function shouldHideLocalAvatarForTutorialPhase(phase: TutorialPhase): boolean {
  return (
    phase === 'card2_transition' ||
    phase === 'card2_spawn_preview' ||
    phase === 'card2_ready' ||
    phase === 'card3_transition' ||
    phase === 'card3'
  )
}

function syncTutorialAvatarVisibility(): void {
  const hidden = shouldHideLocalAvatarForTutorialPhase(tutorialState.phase)
  setLocalAvatarHidden(hidden)
  setWeaponHiddenByTutorial(hidden)
}

function setZombiePaused(entity: Entity | null, paused: boolean): void {
  if (entity === null || !ZombieComponent.has(entity)) return
  const zombie = ZombieComponent.getMutable(entity)
  if (paused) {
    if (!tutorialZombiePauseStates.has(entity)) {
      tutorialZombiePauseStates.set(entity, {
        speed: zombie.speed,
        attackCooldown: zombie.attackCooldown
      })
    }
    zombie.speed = 0
    zombie.attackCooldown = 999
    return
  }

  const originalState = tutorialZombiePauseStates.get(entity)
  if (!originalState) return
  zombie.speed = originalState.speed
  zombie.attackCooldown = originalState.attackCooldown
  tutorialZombiePauseStates.delete(entity)
}

function spawnTutorialCoin(position: Vector3, now: number): void {
  removeEntity(tutorialState.coinEntity)
  const coin = engine.addEntity()
  Transform.create(coin, {
    position: Vector3.create(position.x, position.y + TUTORIAL_COIN_FLOAT_HEIGHT, position.z),
    scale: Vector3.One()
  })
  GltfContainer.create(coin, {
    src: 'assets/scene/Models/zcoins/Zcoin.glb',
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0
  })
  tutorialState.coinEntity = coin
  tutorialState.coinBasePosition = Vector3.clone(position)
  tutorialState.coinSpawnTime = now
}

function reportTutorialCompleted(): void {
  markTutorialCompletedLocally()
  trackTutorialCompleted()
  if (tutorialState.completionReported) return
  tutorialState.completionReported = true
  sendCompleteTutorial()
}

function spawnTutorialZombies(): void {
  if (tutorialState.targetZombie) return

  tutorialState.targetZombie = spawnZombie({ position: tutorialState.focusPosition })
  if (tutorialState.targetZombie && ZombieComponent.has(tutorialState.targetZombie)) {
    ZombieComponent.getMutable(tutorialState.targetZombie).health = TUTORIAL_TARGET_HEALTH
    setZombieHealthBarMaxHp(tutorialState.targetZombie, TUTORIAL_TARGET_HEALTH)
  }

  setZombiePaused(tutorialState.targetZombie, true)
}

function startTutorial(): boolean {
  const tutorialArenaTransform = getTutorialArenaTransform()
  if (tutorialArenaTransform === null) return false

  const arenaCenter = tutorialArenaTransform.center
  const arenaForward = Vector3.rotate(Vector3.Forward(), tutorialArenaTransform.rotation)
  const arenaRight = Vector3.rotate(Vector3.Right(), tutorialArenaTransform.rotation)
  const tutorialForward = arenaRight
  const tutorialRight = Vector3.scale(arenaForward, -1)

  tutorialState.active = true
  tutorialState.phase = 'card1'
  tutorialState.phaseStartedAt = getGameTime()
  tutorialState.completionReported = false
  tutorialState.focusPosition = Vector3.add(
    arenaCenter,
    Vector3.scale(tutorialForward, TUTORIAL_TARGET_Z_OFFSET)
  )
  tutorialState.playerSpawn = Vector3.add(
    tutorialState.focusPosition,
    Vector3.add(
      Vector3.scale(tutorialRight, TUTORIAL_PLAYER_SPAWN_X_OFFSET),
      Vector3.scale(tutorialForward, -(TUTORIAL_PLAYER_TO_TARGET_Z_GAP + TUTORIAL_PLAYER_SPAWN_LOBBY_OFFSET))
    )
  )

  clearTutorialEntities()
  clearTutorialMovementLock()
  deactivatePostTutorialArrow()
  closeLobbyStore()
  trackTutorialStarted()
  setTutorialActive(true)
  setTutorialCombatEnabled(false)
  resetZombieCoins()
  resetPlayerHealthAndLives()
  resetArenaWeaponProgress()
  setTopViewEnabled(false)
  setIsoViewEnabled(true)
  setAutoFireEnabled(false)
  enableArenaWeapon()

  movePlayerTo({
    newRelativePosition: tutorialState.playerSpawn,
    cameraTarget: {
      x: tutorialState.focusPosition.x,
      y: tutorialState.focusPosition.y + 1.2,
      z: tutorialState.focusPosition.z
    }
  })
  setTutorialMovementLockPosition(tutorialState.playerSpawn)
  return true
}

function finishTutorial(): void {
  clearTutorialEntities()
  clearTutorialMovementLock()
  tutorialState.active = false
  tutorialState.phase = 'inactive'
  tutorialState.finishedThisSession = true
  resetArenaWeaponProgress()
  setIsoViewEnabled(false)
  setAutoFireEnabled(false)
  setTutorialActive(false)
  setTutorialCombatEnabled(false)
  setLocalAvatarHidden(false)
  setWeaponHiddenByTutorial(false)

  movePlayerTo({
    newRelativePosition: LOBBY_RETURN_POSITION,
    cameraTarget: LOBBY_RETURN_LOOK_AT
  })
  activatePostTutorialArrow()
}

function cancelTutorialForMatchStart(): void {
  trackTutorialCancelled(tutorialState.phase)
  clearTutorialEntities()
  clearTutorialMovementLock()
  tutorialState.active = false
  tutorialState.phase = 'inactive'
  tutorialState.finishedThisSession = true
  setTutorialActive(false)
  setTutorialCombatEnabled(false)
  setLocalAvatarHidden(false)
  setWeaponHiddenByTutorial(false)
  deactivatePostTutorialArrow()
}

function setPhase(phase: TutorialPhase): void {
  tutorialState.phase = phase
  tutorialState.phaseStartedAt = getGameTime()
  trackTutorialStepReached(phase)
  syncTutorialAvatarVisibility()
}

function updateTransitionPhase(now: number): void {
  if (now - tutorialState.phaseStartedAt < TUTORIAL_PANEL_TRANSITION_SEC) return
  if (tutorialState.phase === 'card2_transition') {
    setPhase('card2_spawn_preview')
    return
  }
  if (tutorialState.phase === 'combat_transition_out') {
    setPhase('combat_countdown')
    clearTutorialMovementLock()
    return
  }
  if (tutorialState.phase === 'card3_transition') {
    setPhase('card3')
    return
  }
  if (tutorialState.phase === 'collect_transition_out') {
    setPhase('collect_hidden')
  }
}

function updatePreviewPhase(now: number): void {
  if (tutorialState.phase !== 'card2_spawn_preview') return
  const elapsed = now - tutorialState.phaseStartedAt
  if (elapsed >= TUTORIAL_ZOMBIE_SPAWN_DELAY_SEC && tutorialState.targetZombie === null) {
    spawnTutorialZombies()
  }
  if (elapsed < TUTORIAL_SPLIT_PREVIEW_SEC) return
  setPhase('card2_ready')
}

function updateCombatPhase(now: number): void {
  const targetZombie = tutorialState.targetZombie
  if (targetZombie !== null && ZombieComponent.has(targetZombie) && Transform.has(targetZombie)) {
    tutorialState.targetZombieDeathPosition = Vector3.clone(Transform.get(targetZombie).position)
    return
  }

  tutorialState.targetZombie = null
  removeEntity(tutorialState.ambientZombie)
  tutorialState.ambientZombie = null
  const deathPosition = tutorialState.targetZombieDeathPosition ?? Vector3.clone(tutorialState.focusPosition)
  spawnTutorialCoin(deathPosition, now)
  setAutoFireEnabled(false)
  setTutorialCombatEnabled(false)
  captureTutorialMovementLockPosition()
  setPhase('card3_transition')
}

function updateCombatCountdownPhase(now: number): void {
  if (tutorialState.phase !== 'combat_countdown') return
  if (now - tutorialState.phaseStartedAt < TUTORIAL_COMBAT_COUNTDOWN_SEC) return

  setAutoFireEnabled(true)
  setTutorialCombatEnabled(true)
  setZombiePaused(tutorialState.targetZombie, false)
  setPhase('combat_hidden')
}

function updateCoinAnimation(now: number): void {
  if (
    tutorialState.coinEntity === null ||
    tutorialState.coinBasePosition === null ||
    !Transform.has(tutorialState.coinEntity)
  ) {
    return
  }

  const bobOffset = Math.sin((now - tutorialState.coinSpawnTime) * TUTORIAL_COIN_BOB_SPEED) * TUTORIAL_COIN_BOB_AMPLITUDE
  Transform.getMutable(tutorialState.coinEntity).position = Vector3.create(
    tutorialState.coinBasePosition.x,
    tutorialState.coinBasePosition.y + TUTORIAL_COIN_FLOAT_HEIGHT + bobOffset,
    tutorialState.coinBasePosition.z
  )
}

function updateCoinPickup(now: number): void {
  updateCoinAnimation(now)
  if (
    (tutorialState.phase !== 'collect_transition_out' && tutorialState.phase !== 'collect_hidden') ||
    tutorialState.coinEntity === null ||
    tutorialState.coinBasePosition === null ||
    !Transform.has(engine.PlayerEntity)
  ) {
    return
  }

  const playerPos = Transform.get(engine.PlayerEntity).position
  const dx = playerPos.x - tutorialState.coinBasePosition.x
  const dz = playerPos.z - tutorialState.coinBasePosition.z
  if (Math.sqrt(dx * dx + dz * dz) > TUTORIAL_COIN_PICKUP_RADIUS) return

  playCoinSound()
  addZombieCoins(COINS_PER_KILL)
  spawnZcRewardTextAtPosition(
    Vector3.create(
      tutorialState.coinBasePosition.x,
      tutorialState.coinBasePosition.y + TUTORIAL_COIN_FLOAT_HEIGHT,
      tutorialState.coinBasePosition.z
    ),
    COINS_PER_KILL
  )
  removeEntity(tutorialState.coinEntity)
  tutorialState.coinEntity = null
  tutorialState.coinBasePosition = null
  captureTutorialMovementLockPosition()
  reportTutorialCompleted()
  setPhase('card4')
}

function tutorialMovementLockSystem(): void {
  if (!tutorialState.active || tutorialState.movementLockPosition === null || !Transform.has(engine.PlayerEntity)) return

  const currentPosition = Transform.get(engine.PlayerEntity).position
  const dx = currentPosition.x - tutorialState.movementLockPosition.x
  const dy = currentPosition.y - tutorialState.movementLockPosition.y
  const dz = currentPosition.z - tutorialState.movementLockPosition.z
  const distanceSq = dx * dx + dy * dy + dz * dz
  if (distanceSq <= TUTORIAL_MOVEMENT_LOCK_DISTANCE_SQ) return

  void movePlayerTo({
    newRelativePosition: {
      x: tutorialState.movementLockPosition.x,
      y: tutorialState.movementLockPosition.y,
      z: tutorialState.movementLockPosition.z
    }
  })
}

function tutorialSystem(): void {
  if (!tutorialState.active) {
    if (tutorialState.finishedThisSession) return
    if (!shouldRunTutorial()) return
    if (!isTutorialStateLoaded()) return
    if (getServerLoadingState().active) return
    if (!getLocalAddress()) return
    if (!Transform.has(engine.PlayerEntity)) return
    const lobbyState = getLobbyState()
    if (lobbyState?.phase === LobbyPhase.MATCH_CREATED || isLocalReadyForMatch()) return
    if (!startTutorial()) return
    return
  }

  syncTutorialAvatarVisibility()

  const lobbyState = getLobbyState()
  if (lobbyState?.phase === LobbyPhase.MATCH_CREATED && isLocalReadyForMatch()) {
    cancelTutorialForMatchStart()
    return
  }

  const now = getGameTime()
  updatePreviewPhase(now)

  if (
    tutorialState.phase === 'card2_transition' ||
    tutorialState.phase === 'combat_transition_out' ||
    tutorialState.phase === 'card3_transition' ||
    tutorialState.phase === 'collect_transition_out'
  ) {
    updateTransitionPhase(now)
  }

  updateCombatCountdownPhase(now)

  if (tutorialState.phase === 'combat_hidden') {
    updateCombatPhase(now)
  }

  updateCoinPickup(now)
}

export function initTutorialSystem(): void {
  engine.addSystem(tutorialSystem, undefined, 'tutorial-system')
  engine.addSystem(tutorialMovementLockSystem, undefined, 'tutorial-movement-lock-system')
}

export function advanceTutorialPrimaryAction(): void {
  if (!tutorialState.active) return

  if (tutorialState.phase === 'card1') {
    captureTutorialMovementLockPosition()
    setPhase('card2_transition')
    return
  }

  if (tutorialState.phase === 'card2_ready') {
    endUiPointerCapture()
    setPhase('combat_transition_out')
    return
  }

  if (tutorialState.phase === 'card3') {
    endUiPointerCapture()
    clearTutorialMovementLock()
    setPhase('collect_transition_out')
    return
  }

  if (tutorialState.phase === 'card4') {
    endUiPointerCapture()
    finishTutorial()
  }
}

export function skipTutorial(): void {
  if (!tutorialState.active) return
  reportTutorialCompleted()
  finishTutorial()
}

export function restartTutorial(): boolean {
  tutorialState.finishedThisSession = false
  return startTutorial()
}

export function getTutorialUiState(): TutorialUiState {
  const transitionProgress = Math.max(
    0,
    Math.min(1, (getGameTime() - tutorialState.phaseStartedAt) / TUTORIAL_PANEL_TRANSITION_SEC)
  )

  if (!tutorialState.active) {
    return {
      active: false,
      showPanel: false,
      imageSrc: '',
      primaryButton: null,
      showSkip: false,
      panelLayout: 'hidden',
      layoutProgress: 0,
      rightBackdropProgress: 0,
      countdownText: ''
    }
  }

  if (tutorialState.phase === 'card1') {
    return {
      active: true,
      showPanel: true,
      imageSrc: 'assets/images/tutorials/tutorial.png',
      primaryButton: 'start_mission',
      showSkip: true,
      panelLayout: 'center-large',
      layoutProgress: 0,
      rightBackdropProgress: 0,
      countdownText: ''
    }
  }

  if (tutorialState.phase === 'card2_spawn_preview') {
    return {
      active: true,
      showPanel: true,
      imageSrc: 'assets/images/tutorials/tutorial2.png',
      primaryButton: null,
      showSkip: true,
      panelLayout: 'right-small',
      layoutProgress: 1,
      rightBackdropProgress: 1,
      countdownText: ''
    }
  }

  if (tutorialState.phase === 'card2_transition') {
    return {
      active: true,
      showPanel: true,
      imageSrc: 'assets/images/tutorials/tutorial2.png',
      primaryButton: null,
      showSkip: true,
      panelLayout: 'transition-to-right',
      layoutProgress: transitionProgress,
      rightBackdropProgress: transitionProgress,
      countdownText: ''
    }
  }

  if (tutorialState.phase === 'card2_ready') {
    return {
      active: true,
      showPanel: true,
      imageSrc: 'assets/images/tutorials/tutorial2.png',
      primaryButton: 'got_it',
      showSkip: true,
      panelLayout: 'right-small',
      layoutProgress: 1,
      rightBackdropProgress: 1,
      countdownText: ''
    }
  }

  if (tutorialState.phase === 'combat_transition_out') {
    return {
      active: true,
      showPanel: false,
      imageSrc: '',
      primaryButton: null,
      showSkip: false,
      panelLayout: 'hidden',
      layoutProgress: 0,
      rightBackdropProgress: 1 - transitionProgress,
      countdownText: ''
    }
  }

  if (tutorialState.phase === 'combat_countdown') {
    const countdownSecondsLeft = Math.max(
      1,
      Math.ceil(TUTORIAL_COMBAT_COUNTDOWN_SEC - (getGameTime() - tutorialState.phaseStartedAt))
    )
    return {
      active: true,
      showPanel: false,
      imageSrc: '',
      primaryButton: null,
      showSkip: false,
      panelLayout: 'hidden',
      layoutProgress: 0,
      rightBackdropProgress: 0,
      countdownText: String(countdownSecondsLeft)
    }
  }

  if (tutorialState.phase === 'combat_hidden') {
    return {
      active: true,
      showPanel: false,
      imageSrc: '',
      primaryButton: null,
      showSkip: false,
      panelLayout: 'hidden',
      layoutProgress: 0,
      rightBackdropProgress: 0,
      countdownText: ''
    }
  }

  if (tutorialState.phase === 'card3_transition') {
    return {
      active: true,
      showPanel: true,
      imageSrc: 'assets/images/tutorials/tutorial3.png',
      primaryButton: null,
      showSkip: true,
      panelLayout: 'right-small',
      layoutProgress: 1,
      rightBackdropProgress: transitionProgress,
      countdownText: ''
    }
  }

  if (tutorialState.phase === 'card3') {
    return {
      active: true,
      showPanel: true,
      imageSrc: 'assets/images/tutorials/tutorial3.png',
      primaryButton: 'collect_zc',
      showSkip: true,
      panelLayout: 'right-small',
      layoutProgress: 1,
      rightBackdropProgress: 1,
      countdownText: ''
    }
  }

  if (tutorialState.phase === 'collect_transition_out') {
    return {
      active: true,
      showPanel: false,
      imageSrc: '',
      primaryButton: null,
      showSkip: false,
      panelLayout: 'hidden',
      layoutProgress: 0,
      rightBackdropProgress: 1 - transitionProgress,
      countdownText: ''
    }
  }

  if (tutorialState.phase === 'collect_hidden') {
    return {
      active: true,
      showPanel: false,
      imageSrc: '',
      primaryButton: null,
      showSkip: false,
      panelLayout: 'hidden',
      layoutProgress: 0,
      rightBackdropProgress: 0,
      countdownText: ''
    }
  }

  return {
    active: true,
    showPanel: true,
    imageSrc: 'assets/images/tutorials/tutorial4.png',
    primaryButton: 'return_to_lobby',
    showSkip: true,
    panelLayout: 'center-large',
    layoutProgress: 0,
    rightBackdropProgress: 0,
    countdownText: ''
  }
}

export function getTutorialCameraTransitionProgress(): number {
  if (!tutorialState.active) return 0
  if (tutorialState.phase === 'card1') return 0
  if (tutorialState.phase === 'card2_transition') {
    return Math.max(0, Math.min(1, (getGameTime() - tutorialState.phaseStartedAt) / TUTORIAL_PANEL_TRANSITION_SEC))
  }
  if (tutorialState.phase === 'card2_spawn_preview') return 1
  if (tutorialState.phase === 'card2_ready') return 1
  if (tutorialState.phase === 'combat_transition_out') {
    return 1 - Math.max(0, Math.min(1, (getGameTime() - tutorialState.phaseStartedAt) / TUTORIAL_PANEL_TRANSITION_SEC))
  }
  if (tutorialState.phase === 'combat_countdown') return 0
  if (tutorialState.phase === 'combat_hidden') return 0
  if (tutorialState.phase === 'card3_transition') {
    return Math.max(0, Math.min(1, (getGameTime() - tutorialState.phaseStartedAt) / TUTORIAL_PANEL_TRANSITION_SEC))
  }
  if (tutorialState.phase === 'card3') return 1
  if (tutorialState.phase === 'collect_transition_out') {
    return 1 - Math.max(0, Math.min(1, (getGameTime() - tutorialState.phaseStartedAt) / TUTORIAL_PANEL_TRANSITION_SEC))
  }
  return 0
}

export function getTutorialCameraFocusTarget(): TutorialCameraFocusTarget | null {
  if (!tutorialState.active) return null

  if (
    tutorialState.phase === 'card2_transition' ||
    tutorialState.phase === 'card2_spawn_preview' ||
    tutorialState.phase === 'card2_ready'
  ) {
    const position =
      tutorialState.targetZombie !== null && Transform.has(tutorialState.targetZombie)
        ? Transform.get(tutorialState.targetZombie).position
        : tutorialState.focusPosition
    return {
      position: Vector3.create(position.x, position.y + 0.9, position.z),
      kind: 'zombie'
    }
  }

  if (
    (tutorialState.phase === 'card3_transition' || tutorialState.phase === 'card3') &&
    tutorialState.coinBasePosition !== null
  ) {
    return {
      position: Vector3.create(
        tutorialState.coinBasePosition.x,
        tutorialState.coinBasePosition.y + TUTORIAL_COIN_FLOAT_HEIGHT,
        tutorialState.coinBasePosition.z
      ),
      kind: 'coin'
    }
  }

  return null
}

export function shouldUseTutorialGameplayCloseCamera(): boolean {
  if (!tutorialState.active) return false
  return tutorialState.phase === 'combat_hidden' || tutorialState.phase === 'collect_hidden'
}
