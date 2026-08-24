import { Vector3 } from '@dcl/sdk/math'
import { ROOM_IDS, RoomId, getArenaRoomConfig } from './roomConfig'

export const LAVA_MODEL_SRCS = [
  'assets/custom/models/lava .glb'
] as const

export const LAVA_FIRST_WAVE = 1
export const LAVA_ZONE_WORLD_SIZE = 4
type LavaGridDimensions = {
  worldSizeX: number
  worldSizeZ: number
  gridSizeX: number
  gridSizeZ: number
}

function getLavaGridDimensions(roomId: RoomId): LavaGridDimensions {
  const roomConfig = getArenaRoomConfig(roomId)
  return {
    worldSizeX: roomConfig.floorSizeX,
    worldSizeZ: roomConfig.floorSizeZ,
    gridSizeX: Math.floor(roomConfig.floorSizeX / LAVA_ZONE_WORLD_SIZE),
    gridSizeZ: Math.floor(roomConfig.floorSizeZ / LAVA_ZONE_WORLD_SIZE)
  }
}

function getSharedLavaGridDimensions(): LavaGridDimensions {
  const sharedDimensions = getLavaGridDimensions(ROOM_IDS[0])
  for (const roomId of ROOM_IDS.slice(1)) {
    const dimensions = getLavaGridDimensions(roomId)
    if (
      dimensions.worldSizeX !== sharedDimensions.worldSizeX ||
      dimensions.worldSizeZ !== sharedDimensions.worldSizeZ ||
      dimensions.gridSizeX !== sharedDimensions.gridSizeX ||
      dimensions.gridSizeZ !== sharedDimensions.gridSizeZ
    ) {
      throw new Error(
        `[LavaHazardConfig] Lava patterns currently require uniform arena floor dimensions. ${ROOM_IDS[0]}=` +
          `${sharedDimensions.worldSizeX}x${sharedDimensions.worldSizeZ}, ${roomId}=` +
          `${dimensions.worldSizeX}x${dimensions.worldSizeZ}`
      )
    }
  }
  return sharedDimensions
}

const SHARED_LAVA_GRID_DIMENSIONS = getSharedLavaGridDimensions()

export const LAVA_WORLD_SIZE_X = SHARED_LAVA_GRID_DIMENSIONS.worldSizeX
export const LAVA_WORLD_SIZE_Z = SHARED_LAVA_GRID_DIMENSIONS.worldSizeZ
export const LAVA_GRID_SIZE_X = Math.floor(LAVA_WORLD_SIZE_X / LAVA_ZONE_WORLD_SIZE)
export const LAVA_GRID_SIZE_Z = Math.floor(LAVA_WORLD_SIZE_Z / LAVA_ZONE_WORLD_SIZE)
export const LAVA_GRID_SIZE = Math.min(LAVA_GRID_SIZE_X, LAVA_GRID_SIZE_Z)
export const LAVA_TILE_SCALE_XZ = LAVA_ZONE_WORLD_SIZE
export const LAVA_TILE_WARNING_SCALE_Y = 0.04
export const LAVA_TILE_ACTIVE_SCALE_Y = 0.1
export const LAVA_TILE_HIDDEN_SCALE_Y = 0.001
export const LAVA_WARNING_DURATION_MS = 0
export const LAVA_DAMAGE_INTERVAL_MS = 2400
export const LAVA_STATIC_ACTIVE_MS = 12000
export const LAVA_SAFE_ZONE_ACTIVE_MS = 12500
export const LAVA_SWEEP_WARNING_MS = 850
export const LAVA_SWEEP_STEP_INTERVAL_MS = 260
export const LAVA_SWEEP_ACTIVE_MS = 2200

export type LavaHazardTileState = {
  lavaId: string
  gridX: number
  gridZ: number
  modelVariant: number
  rotationQuarterTurns: number
  warningAtMs: number
  activeAtMs: number
  expiresAtMs: number
}

export function shouldSpawnLavaForWave(waveNumber: number): boolean {
  return waveNumber >= LAVA_FIRST_WAVE
}

export function getLavaWaveTier(waveNumber: number): number {
  if (waveNumber >= 16) return 4
  if (waveNumber >= 12) return 3
  if (waveNumber >= 8) return 2
  return 1
}

export function getLavaTileKey(gridX: number, gridZ: number): string {
  return `${gridX}:${gridZ}`
}

export function getRoomLavaTileKey(roomId: RoomId, gridX: number, gridZ: number): string {
  return `${roomId}:${gridX}:${gridZ}`
}

export function isLavaGridInBounds(gridX: number, gridZ: number): boolean {
  return gridX >= 0 && gridZ >= 0 && gridX < LAVA_GRID_SIZE_X && gridZ < LAVA_GRID_SIZE_Z
}

export function getLavaWorldPosition(
  roomId: RoomId,
  gridX: number,
  gridZ: number,
  scaleY: number = LAVA_TILE_ACTIVE_SCALE_Y
): Vector3 {
  const roomConfig = getArenaRoomConfig(roomId)
  return Vector3.create(
    roomConfig.floorMinX + gridX * LAVA_ZONE_WORLD_SIZE + LAVA_ZONE_WORLD_SIZE * 0.5,
    scaleY * 0.5,
    roomConfig.floorMinZ + gridZ * LAVA_ZONE_WORLD_SIZE + LAVA_ZONE_WORLD_SIZE * 0.5
  )
}

export function getLavaGridCoordsFromWorld(
  roomId: RoomId,
  positionX: number,
  positionZ: number
): { gridX: number; gridZ: number } | null {
  const roomConfig = getArenaRoomConfig(roomId)
  const gridX = Math.floor((positionX - roomConfig.floorMinX) / LAVA_ZONE_WORLD_SIZE)
  const gridZ = Math.floor((positionZ - roomConfig.floorMinZ) / LAVA_ZONE_WORLD_SIZE)
  if (!isLavaGridInBounds(gridX, gridZ)) return null
  return { gridX, gridZ }
}
