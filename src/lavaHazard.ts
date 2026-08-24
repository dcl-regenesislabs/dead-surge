import { Animator, engine, Entity, GltfContainer, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { room } from './shared/messages'
import { getLobbyState, getLocalAddress, isLocalReadyForMatch } from './multiplayer/lobbyClient'
import { LobbyPhase } from './shared/lobbySchemas'
import { getServerTime } from './shared/timeSync'
import { getCurrentRoomId } from './roomRuntime'
import { ROOM_IDS, RoomId } from './shared/roomConfig'
import { triggerPredictedDamageFeedback } from './playerHealth'
import { BRICK_RADIUS, getBricks } from './brick'
import {
  LAVA_DAMAGE_INTERVAL_MS,
  LAVA_GRID_SIZE_X,
  LAVA_GRID_SIZE_Z,
  LAVA_MODEL_SRCS,
  LAVA_TILE_ACTIVE_SCALE_Y,
  LAVA_TILE_HIDDEN_SCALE_Y,
  LAVA_TILE_SCALE_XZ,
  LAVA_TILE_WARNING_SCALE_Y,
  getLavaGridCoordsFromWorld,
  getLavaWorldPosition,
  getRoomLavaTileKey
} from './shared/lavaHazardConfig'

type LocalLavaZone = {
  roomId: RoomId
  entity: Entity
  gridX: number
  gridZ: number
  lavaId: string | null
  modelVariant: number
  rotationQuarterTurns: number
  warningAtMs: number
  activeAtMs: number
  expiresAtMs: number
}

const HIDDEN_POSITION_Y = -3
const LAVA_JUMP_CLEARANCE_Y = 0.9
const BRICK_SAFE_HEIGHT_Y = 0.35

const FIRE_ON_PLAYER_GLB = 'assets/custom/models/fire_on_player.glb'
const FIRE_ON_PLAYER_ANIMS = [
  'Fire emptyAction.001', 'ArmatureAction.005', 'ArmatureAction.006',
  'ArmatureAction.007', 'ArmatureAction.008',
  'Spark 1Action', 'Spark 2Action', 'Sparks backAction',
  'Spark 1Action.001', 'Spark 2Action.001'
]

let fireOnPlayerEntity: Entity | null = null

const localLavaZoneByRoomTileKey = new Map<string, LocalLavaZone>()
const localLavaTileKeyById = new Map<string, string>()
let isLavaSyncInitialized = false
let areLavaZonesInitialized = false
let lastLavaDamageRequestAtMs = 0
let lastVisualRoomId: RoomId | null = null
let lavaPlayerGroundY: number | null = null
let sweepWarningStartAtMs = 0
let sweepWarningEndAtMs = 0

const SWEEP_UI_DURATION_MS = 1000

export function getSweepWarning(nowMs: number): { active: boolean; remainingMs: number } {
  if (nowMs < sweepWarningStartAtMs || nowMs >= sweepWarningEndAtMs) {
    return { active: false, remainingMs: 0 }
  }
  return { active: true, remainingMs: sweepWarningEndAtMs - nowMs }
}

function getZoneModelVariant(gridX: number, gridZ: number): number {
  return Math.abs(gridX * 17 + gridZ * 31) % LAVA_MODEL_SRCS.length
}

function getZoneRotationQuarterTurns(_gridX: number, _gridZ: number): number {
  return 0
}

function isPlayerStandingOnBrick(playerPosition: Vector3): boolean {
  for (const { position } of getBricks()) {
    const dx = playerPosition.x - position.x
    const dz = playerPosition.z - position.z
    if (dx * dx + dz * dz > BRICK_RADIUS * BRICK_RADIUS) continue
    if (playerPosition.y < position.y + BRICK_SAFE_HEIGHT_Y) continue
    return true
  }
  return false
}

function getZoneHiddenPosition(roomId: RoomId, gridX: number, gridZ: number): Vector3 {
  const visiblePosition = getLavaWorldPosition(roomId, gridX, gridZ, LAVA_TILE_HIDDEN_SCALE_Y)
  return Vector3.create(visiblePosition.x, HIDDEN_POSITION_Y, visiblePosition.z)
}

function getZoneKey(roomId: RoomId, gridX: number, gridZ: number): string {
  return getRoomLavaTileKey(roomId, gridX, gridZ)
}

function hideZone(zone: LocalLavaZone): void {
  if (!Transform.has(zone.entity)) return
  const mutableTransform = Transform.getMutable(zone.entity)
  mutableTransform.position = getZoneHiddenPosition(zone.roomId, zone.gridX, zone.gridZ)
  mutableTransform.scale = Vector3.create(LAVA_TILE_SCALE_XZ, LAVA_TILE_HIDDEN_SCALE_Y, LAVA_TILE_SCALE_XZ)
}

function initializeLavaZones(): void {
  if (areLavaZonesInitialized) return
  areLavaZonesInitialized = true

  for (const roomId of ROOM_IDS) {
    for (let gridX = 0; gridX < LAVA_GRID_SIZE_X; gridX += 1) {
      for (let gridZ = 0; gridZ < LAVA_GRID_SIZE_Z; gridZ += 1) {
        const modelVariant = getZoneModelVariant(gridX, gridZ)
        const rotationQuarterTurns = getZoneRotationQuarterTurns(gridX, gridZ)
        const entity = engine.addEntity()

        Transform.create(entity, {
          position: getZoneHiddenPosition(roomId, gridX, gridZ),
          rotation: Quaternion.fromEulerDegrees(0, rotationQuarterTurns * 90, 0),
          scale: Vector3.create(LAVA_TILE_SCALE_XZ, LAVA_TILE_HIDDEN_SCALE_Y, LAVA_TILE_SCALE_XZ)
        })
        GltfContainer.create(entity, {
          src: LAVA_MODEL_SRCS[modelVariant],
          visibleMeshesCollisionMask: 0,
          invisibleMeshesCollisionMask: 0
        })

        localLavaZoneByRoomTileKey.set(getZoneKey(roomId, gridX, gridZ), {
          roomId,
          entity,
          gridX,
          gridZ,
          lavaId: null,
          modelVariant,
          rotationQuarterTurns,
          warningAtMs: 0,
          activeAtMs: 0,
          expiresAtMs: 0
        })
      }
    }
  }
}

function clearZoneState(zone: LocalLavaZone): void {
  if (zone.lavaId) {
    localLavaTileKeyById.delete(zone.lavaId)
  }
  zone.lavaId = null
  zone.warningAtMs = 0
  zone.activeAtMs = 0
  zone.expiresAtMs = 0
  hideZone(zone)
}

function clearAllLavaHazards(roomId?: RoomId): void {
  lastLavaDamageRequestAtMs = 0
  lavaPlayerGroundY = null
  if (!roomId) {
    for (const zone of localLavaZoneByRoomTileKey.values()) {
      clearZoneState(zone)
    }
    localLavaTileKeyById.clear()
    return
  }

  for (const zone of localLavaZoneByRoomTileKey.values()) {
    if (zone.roomId !== roomId) continue
    clearZoneState(zone)
  }
}

function removeLavaHazardById(lavaId: string): void {
  const zoneKey = localLavaTileKeyById.get(lavaId)
  if (!zoneKey) return
  const zone = localLavaZoneByRoomTileKey.get(zoneKey)
  if (!zone || zone.lavaId !== lavaId) {
    localLavaTileKeyById.delete(lavaId)
    return
  }
  clearZoneState(zone)
}

function isLocalPlayerInCurrentMatch(roomId: RoomId): boolean {
  const lobbyState = getLobbyState(roomId)
  const localAddress = getLocalAddress()
  if (!lobbyState || !localAddress) return false
  if (lobbyState.phase !== LobbyPhase.MATCH_CREATED) return false
  if (!isLocalReadyForMatch()) return false
  return lobbyState.arenaPlayers.some((player) => player.address === localAddress)
}

function upsertLocalLavaHazard(
  roomId: RoomId,
  data: {
    lavaId: string
    gridX: number
    gridZ: number
    modelVariant: number
    rotationQuarterTurns: number
    warningAtMs: number
    activeAtMs: number
    expiresAtMs: number
  }
): void {
  const zone = localLavaZoneByRoomTileKey.get(getZoneKey(roomId, data.gridX, data.gridZ))
  if (!zone) return

  if (zone.lavaId && zone.lavaId !== data.lavaId) {
    localLavaTileKeyById.delete(zone.lavaId)
  }

  zone.lavaId = data.lavaId
  zone.warningAtMs = data.warningAtMs
  zone.activeAtMs = data.activeAtMs
  zone.expiresAtMs = data.expiresAtMs
  localLavaTileKeyById.set(data.lavaId, getZoneKey(roomId, data.gridX, data.gridZ))
}

function getZoneScaleY(now: number, zone: LocalLavaZone): number {
  const pulseSeed = zone.gridX * 0.7 + zone.gridZ * 0.45
  if (now >= zone.activeAtMs) {
    const activePulse = Math.sin(now * 0.01 + pulseSeed)
    return LAVA_TILE_ACTIVE_SCALE_Y + activePulse * 0.01
  }

  const warningDuration = Math.max(1, zone.activeAtMs - zone.warningAtMs)
  const warningProgress = Math.max(0, Math.min(1, (now - zone.warningAtMs) / warningDuration))
  const warningPulse = Math.sin(now * 0.016 + pulseSeed)
  return LAVA_TILE_WARNING_SCALE_Y + warningProgress * 0.014 + (warningPulse + 1) * 0.004
}

function updateZoneVisual(zone: LocalLavaZone, now: number): void {
  if (!zone.lavaId || now < zone.warningAtMs || now >= zone.expiresAtMs) {
    hideZone(zone)
    return
  }

  if (!Transform.has(zone.entity)) return
  const scaleY = getZoneScaleY(now, zone)
  const mutableTransform = Transform.getMutable(zone.entity)
  mutableTransform.position = getLavaWorldPosition(zone.roomId, zone.gridX, zone.gridZ, scaleY)
  mutableTransform.scale = Vector3.create(LAVA_TILE_SCALE_XZ, scaleY, LAVA_TILE_SCALE_XZ)
}

export function initLavaHazardClient(): void {
  if (isLavaSyncInitialized) return
  isLavaSyncInitialized = true
  initializeLavaZones()

  const fireEntity = engine.addEntity()
  GltfContainer.create(fireEntity, { src: FIRE_ON_PLAYER_GLB, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  Animator.create(fireEntity, {
    states: FIRE_ON_PLAYER_ANIMS.map((clip) => ({ clip, playing: true, loop: true, speed: 1 }))
  })
  Transform.create(fireEntity, { position: Vector3.Zero() })
  VisibilityComponent.create(fireEntity, { visible: false })
  fireOnPlayerEntity = fireEntity

  room.onMessage('lavaHazardsSpawned', (data) => {
    if (data.roomId !== getCurrentRoomId()) return
    if (!isLocalPlayerInCurrentMatch(data.roomId)) return
    for (const lava of data.hazards) {
      upsertLocalLavaHazard(data.roomId, lava)
    }
  })

  room.onMessage('lavaHazardsExpired', (data) => {
    if (data.roomId !== getCurrentRoomId()) return
    for (const lavaId of data.lavaIds) {
      removeLavaHazardById(lavaId)
    }
  })

  room.onMessage('lavaHazardsCleared', (data) => {
    if (data.roomId !== getCurrentRoomId()) return
    clearAllLavaHazards(data.roomId)
  })

  room.onMessage('lavaPatternWarning', (data) => {
    if (data.roomId !== getCurrentRoomId()) return
    if (data.patternType === 'sweep') {
      sweepWarningStartAtMs = data.startsAtMs
      sweepWarningEndAtMs = data.startsAtMs + SWEEP_UI_DURATION_MS
    }
  })
}

export function lavaHazardSystem(): void {
  if (!areLavaZonesInitialized) {
    if (fireOnPlayerEntity) VisibilityComponent.getMutable(fireOnPlayerEntity).visible = false
    return
  }

  const roomId = getCurrentRoomId()
  if (lastVisualRoomId && lastVisualRoomId !== roomId) {
    clearAllLavaHazards(lastVisualRoomId)
  }
  lastVisualRoomId = roomId

  if (!isLocalPlayerInCurrentMatch(roomId)) {
    if (fireOnPlayerEntity) VisibilityComponent.getMutable(fireOnPlayerEntity).visible = false
    clearAllLavaHazards(roomId)
    return
  }

  const now = getServerTime()
  for (const zone of localLavaZoneByRoomTileKey.values()) {
    if (zone.roomId !== roomId) continue
    updateZoneVisual(zone, now)
  }

  if (!Transform.has(engine.PlayerEntity)) {
    if (fireOnPlayerEntity) VisibilityComponent.getMutable(fireOnPlayerEntity).visible = false
    return
  }

  const playerPosition = Transform.get(engine.PlayerEntity).position
  if (lavaPlayerGroundY === null || playerPosition.y < lavaPlayerGroundY || playerPosition.y - lavaPlayerGroundY < 0.2) {
    lavaPlayerGroundY = playerPosition.y
  }

  const isJumping = lavaPlayerGroundY !== null && playerPosition.y - lavaPlayerGroundY > LAVA_JUMP_CLEARANCE_Y
  const isOnBrick = isPlayerStandingOnBrick(playerPosition)
  const tileCoords = getLavaGridCoordsFromWorld(roomId, playerPosition.x, playerPosition.z)
  const zone = tileCoords
    ? localLavaZoneByRoomTileKey.get(getZoneKey(roomId, tileCoords.gridX, tileCoords.gridZ))
    : undefined
  const isOnActiveLava = !!zone?.lavaId && now >= zone.activeAtMs && now < zone.expiresAtMs && !isJumping && !isOnBrick

  if (fireOnPlayerEntity) {
    VisibilityComponent.getMutable(fireOnPlayerEntity).visible = isOnActiveLava
    if (isOnActiveLava) {
      Transform.getMutable(fireOnPlayerEntity).position = Vector3.create(playerPosition.x, playerPosition.y, playerPosition.z)
    }
  }

  if (now - lastLavaDamageRequestAtMs < LAVA_DAMAGE_INTERVAL_MS) return
  if (!isOnActiveLava) return

  lastLavaDamageRequestAtMs = now
  triggerPredictedDamageFeedback(1)
  void room.send('lavaHazardDamageRequest', { lavaId: zone!.lavaId! })
}
