import { Animator, engine, Entity, GltfContainer, Schemas, Transform } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { playHealthPickupSound, playRagePickupSound, playSpeedPickupSound } from './soundManager'
import { room } from './shared/messages'
import { getCurrentRoomId } from './roomRuntime'
import { getPlayerHp, healPlayer, MAX_HP, setHealGlowEndTime } from './playerHealth'
import { applyRageEffect } from './rageEffect'
import { applySpeedEffect } from './speedEffect'
import { getGameTime } from './zombie'
import { getServerTime } from './shared/timeSync'
import { getLobbyState, getLocalAddress, isLocalReadyForMatch, sendPlayerHealRequest } from './multiplayer/lobbyClient'

const HEALTH_PICKUP_EFFECT_GLB = 'assets/custom/models/powerup_health.glb'
const HEALTH_PICKUP_EFFECT_ANIMS = [
  'Health iconsAction.001', 'Health icons.001Action.001', 'Health icons.002Action.001',
  'Health icons.003Action.001', 'Health icons.004Action.001', 'Health icons.005Action.001',
  'Health icons.006Action.001', 'Health icons.007Action.001', 'Health icons.008Action.001',
  'Health icons.009Action.001', 'Empty health icons.001Action', 'Empty heartAction.001'
]
const HEALTH_PICKUP_EFFECT_DURATION = 2.0

const HEALTH_POTION_GLB = 'assets/custom/models/powerup_health_floor.glb'
const RAGE_POTION_GLB = 'assets/custom/models/powerup_rage_floor.glb'
const SPEED_POTION_GLB = 'assets/custom/models/powerup_speed_floor.glb'

const HEALTH_POTION_SCALE = 1.5
const RAGE_POTION_SCALE = 1.5
const SPEED_POTION_SCALE = 1.5
const PICKUP_RADIUS = 2

const HEALTH_POTION_ANIMS = [
  'Empty heartAction', 'Health iconsAction', 'Health icons.001Action', 'Health icons.002Action',
  'Health icons.003Action', 'Health icons.004Action', 'Health icons.005Action',
  'Health icons.006Action', 'Health icons.007Action', 'Health icons.008Action', 'Health icons.009Action'
]
const RAGE_POTION_ANIMS = [
  'powerup_rageAction.001', 'ArmatureAction.009', 'ArmatureAction.010',
  'ArmatureAction.011', 'ArmatureAction.012', 'ArmatureAction.013', 'Fire emptyAction.002'
]
const SPEED_POTION_ANIMS = ['CylinderAction.002', 'CylinderAction.003', 'SppedAction.001']

type PotionType = 'health' | 'rage' | 'speed'

const PotionPickupSchema = {
  potionId: Schemas.String,
  potionType: Schemas.String,
  removeAtTime: Schemas.Int64,
  childEntity: Schemas.Entity,
  claimPending: Schemas.Boolean
}
const PotionPickupComponent = engine.defineComponent('PotionPickup', PotionPickupSchema)

let healthPickupFeedbackText = ''
let healthPickupFeedbackEndTime = 0
let isPotionSyncInitialized = false
let healthPickupEffectEntity: Entity | null = null
let healthPickupEffectHideAtMs = 0

const EFFECT_SCALE_HIDDEN = Vector3.create(0.001, 0.001, 0.001)
const EFFECT_SCALE_VISIBLE = Vector3.One()

function ensureHealthPickupEffectEntity(): Entity {
  if (healthPickupEffectEntity !== null && Transform.has(healthPickupEffectEntity)) return healthPickupEffectEntity
  const entity = engine.addEntity()
  Transform.create(entity, {
    parent: engine.PlayerEntity,
    position: Vector3.Zero(),
    rotation: Quaternion.Identity(),
    scale: EFFECT_SCALE_HIDDEN
  })
  GltfContainer.create(entity, {
    src: HEALTH_PICKUP_EFFECT_GLB,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0
  })
  Animator.create(entity, {
    states: HEALTH_PICKUP_EFFECT_ANIMS.map((clip) => ({ clip, playing: true, loop: true, speed: 1 }))
  })
  healthPickupEffectEntity = entity
  return entity
}

function triggerHealthPickupEffect(now: number): void {
  const entity = ensureHealthPickupEffectEntity()
  Animator.getMutable(entity).states = HEALTH_PICKUP_EFFECT_ANIMS.map((clip) => ({
    clip, playing: true, loop: true, speed: 1, shouldReset: true
  }))
  Transform.getMutable(entity).scale = EFFECT_SCALE_VISIBLE
  healthPickupEffectHideAtMs = now + HEALTH_PICKUP_EFFECT_DURATION
}

export function healthPickupEffectSystem(gameTime: number): void {
  if (healthPickupEffectEntity === null) return
  if (!Transform.has(healthPickupEffectEntity)) return
  if (healthPickupEffectHideAtMs > 0 && gameTime >= healthPickupEffectHideAtMs) {
    Transform.getMutable(healthPickupEffectEntity).scale = EFFECT_SCALE_HIDDEN
    healthPickupEffectHideAtMs = 0
  }
}
const localPotionEntityById = new Map<string, Entity>()
let lastPotionRoomId = getCurrentRoomId()

export function getHealthPickupFeedback(now: number): string {
  if (now > healthPickupFeedbackEndTime) return ''
  return healthPickupFeedbackText
}

function getPotionGlb(potionType: PotionType): string {
  if (potionType === 'health') return HEALTH_POTION_GLB
  if (potionType === 'rage') return RAGE_POTION_GLB
  return SPEED_POTION_GLB
}

function getPotionScale(potionType: PotionType): number {
  if (potionType === 'health') return HEALTH_POTION_SCALE
  if (potionType === 'rage') return RAGE_POTION_SCALE
  return SPEED_POTION_SCALE
}

function getPotionAnims(potionType: PotionType): string[] {
  if (potionType === 'health') return HEALTH_POTION_ANIMS
  if (potionType === 'rage') return RAGE_POTION_ANIMS
  return SPEED_POTION_ANIMS
}

function createPotionEntity(potionId: string, potionType: PotionType, position: Vector3, removeAtTime: number): void {
  removePotionById(potionId)

  const root = engine.addEntity()
  const child = engine.addEntity()
  const scale = getPotionScale(potionType)

  Transform.create(root, {
    position: Vector3.create(position.x, position.y, position.z),
    rotation: Quaternion.Identity(),
    scale: Vector3.create(scale, scale, scale)
  })
  Transform.create(child, {
    parent: root,
    position: Vector3.Zero(),
    rotation: Quaternion.Identity(),
    scale: Vector3.One()
  })
  GltfContainer.create(child, {
    src: getPotionGlb(potionType),
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0
  })
  Animator.create(child, {
    states: getPotionAnims(potionType).map((clip) => ({ clip, playing: true, loop: true, speed: 1 }))
  })
  PotionPickupComponent.create(root, {
    potionId,
    potionType,
    removeAtTime,
    childEntity: child,
    claimPending: false
  })
  localPotionEntityById.set(potionId, root)
}

function removePotion(root: Entity, potion: { potionId: string; childEntity: Entity }): void {
  localPotionEntityById.delete(potion.potionId)
  engine.removeEntity(potion.childEntity)
  engine.removeEntity(root)
}

function removePotionById(potionId: string): void {
  const entity = localPotionEntityById.get(potionId)
  if (!entity || !PotionPickupComponent.has(entity)) return
  removePotion(entity, PotionPickupComponent.get(entity))
}

function clearAllPotions(): void {
  for (const potionId of [...localPotionEntityById.keys()]) {
    removePotionById(potionId)
  }
}

function applyLocalPotionEffect(potionType: PotionType, now: number): void {
  if (potionType === 'health') {
    const hpBefore = getPlayerHp()
    healPlayer(MAX_HP)
    sendPlayerHealRequest(MAX_HP)
    healthPickupFeedbackText = hpBefore >= MAX_HP ? 'Maximum Health' : '+100 Health'
    healthPickupFeedbackEndTime = now + 1.5
    setHealGlowEndTime(now + 1.5)
    playHealthPickupSound()
    triggerHealthPickupEffect(now)
    return
  }

  if (potionType === 'speed') {
    applySpeedEffect(now)
    playSpeedPickupSound()
    return
  }

  applyRageEffect(now)
  playRagePickupSound()
}

function isLocalPlayerInCurrentMatch(): boolean {
  const lobbyState = getLobbyState()
  const localAddress = getLocalAddress()
  if (!lobbyState || !localAddress) return false
  if (lobbyState.phase !== 'match_created') return false
  if (!isLocalReadyForMatch()) return false
  return lobbyState.arenaPlayers.some((player) => player.address === localAddress)
}

export function initPotionSyncClient(): void {
  if (isPotionSyncInitialized) return
  isPotionSyncInitialized = true

  // Pre-load the health pickup effect GLB so it's ready when needed on mobile
  ensureHealthPickupEffectEntity()

  room.onMessage('potionSpawned', (data) => {
    if (data.roomId !== getCurrentRoomId()) return
    if (!isLocalPlayerInCurrentMatch()) return
    if (data.potionType !== 'health' && data.potionType !== 'rage' && data.potionType !== 'speed') return
    createPotionEntity(
      data.potionId,
      data.potionType,
      Vector3.create(data.positionX, data.positionY, data.positionZ),
      data.expiresAtMs
    )
  })

  room.onMessage('potionClaimed', (data) => {
    if (data.roomId !== getCurrentRoomId()) return
    const entity = localPotionEntityById.get(data.potionId)
    const localAddress = getLocalAddress()
    const now = getGameTime()

    if (entity && PotionPickupComponent.has(entity)) {
      const potion = PotionPickupComponent.get(entity)
      removePotion(entity, potion)
      if (
        localAddress &&
        data.claimerAddress.toLowerCase() === localAddress &&
        (potion.potionType === 'health' || potion.potionType === 'rage' || potion.potionType === 'speed')
      ) {
        applyLocalPotionEffect(potion.potionType, now)
      }
    }
  })

  room.onMessage('potionExpired', (data) => {
    if (data.roomId !== getCurrentRoomId()) return
    removePotionById(data.potionId)
  })

  room.onMessage('potionClaimRejected', (data) => {
    const entity = localPotionEntityById.get(data.potionId)
    if (!entity || !PotionPickupComponent.has(entity)) return
    PotionPickupComponent.getMutable(entity).claimPending = false
  })

  room.onMessage('potionsCleared', (data) => {
    if (data.roomId !== getCurrentRoomId()) return
    clearAllPotions()
  })
}

export function potionVisualSystem(): void {
  // Visual animation is handled by the GLB clip itself.
}

function distanceXZ(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

export function potionPickupSystem(): void {
  const currentRoomId = getCurrentRoomId()
  if (lastPotionRoomId !== currentRoomId) {
    clearAllPotions()
    lastPotionRoomId = currentRoomId
  }

  if (!isLocalPlayerInCurrentMatch()) {
    clearAllPotions()
    return
  }

  const now = getServerTime()
  const playerPos = Transform.has(engine.PlayerEntity) ? Transform.get(engine.PlayerEntity).position : null
  const toRemove: Entity[] = []

  for (const [entity, potion, transform] of engine.getEntitiesWith(PotionPickupComponent, Transform)) {
    if (now >= potion.removeAtTime) {
      toRemove.push(entity)
      continue
    }
    if (!playerPos || potion.claimPending) continue

    const dist = distanceXZ(playerPos, transform.position)
    if (dist > PICKUP_RADIUS) continue

    PotionPickupComponent.getMutable(entity).claimPending = true
    void room.send('potionClaimRequest', { potionId: potion.potionId })
  }

  for (const entity of toRemove) {
    if (!PotionPickupComponent.has(entity)) continue
    removePotion(entity, PotionPickupComponent.get(entity))
  }
}
