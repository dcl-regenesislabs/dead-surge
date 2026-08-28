import { Animator, engine, Entity, GltfContainer, PlayerIdentityData, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import {
  getLobbyState,
  getLocalAddress,
  getPlayerCombatSnapshot,
  getPlayerPowerupSnapshot,
  isLocalReadyForMatch
} from './multiplayer/lobbyClient'
import { getServerTime } from './shared/timeSync'
import {
  HEALTH_PICKUP_EFFECT_ANIMS,
  HEALTH_PICKUP_EFFECT_DURATION_SECONDS,
  HEALTH_PICKUP_EFFECT_GLB,
  RAGE_AURA_ANIMS,
  RAGE_AURA_GLB,
  SPEED_AURA_ANIMS,
  SPEED_AURA_GLB
} from './shared/powerupVisuals'

type RemotePowerupEntry = {
  avatarEntity: Entity
  healthEffectEntity: Entity
  rageAuraEntity: Entity
  speedAuraEntity: Entity
}

type TransformData = ReturnType<typeof Transform.get>

const remoteHealthEffectHideAtMsByAddress = new Map<string, number>()
const remoteHealthEffectResetPendingAddresses = new Set<string>()

function canShowArenaRemotePowerups(): boolean {
  const lobbyState = getLobbyState()
  const localAddress = getLocalAddress()
  if (!lobbyState || !localAddress) return false
  if (lobbyState.phase !== 'match_created') return false
  if (!isLocalReadyForMatch()) return false
  return lobbyState.arenaPlayers.some((player) => player.address.toLowerCase() === localAddress)
}

class ArenaRemotePowerups {
  private readonly entriesByAddress = new Map<string, RemotePowerupEntry>()

  constructor() {
    engine.addSystem(() => {
      this.syncRoster()
      this.updateEffects()
    }, undefined, 'arena-remote-powerups-system')
  }

  private syncRoster(): void {
    const lobbyState = getLobbyState()
    const localAddress = getLocalAddress()
    if (!canShowArenaRemotePowerups()) {
      for (const address of [...this.entriesByAddress.keys()]) {
        this.removeEntry(address)
      }
      return
    }

    const arenaAddresses = new Set((lobbyState?.arenaPlayers ?? []).map((player) => player.address.toLowerCase()))
    const visibleRemoteAddresses = new Set<string>()

    for (const [avatarEntity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
      const address = identity.address?.toLowerCase()
      if (!address || address === localAddress) continue

      const isDead = !!getPlayerCombatSnapshot(address)?.isDead
      if (!arenaAddresses.has(address) || isDead) {
        this.removeEntry(address)
        continue
      }

      visibleRemoteAddresses.add(address)

      const existing = this.entriesByAddress.get(address)
      if (existing) {
        existing.avatarEntity = avatarEntity
        continue
      }

      this.entriesByAddress.set(address, createRemotePowerupEntry(avatarEntity))
    }

    for (const address of [...this.entriesByAddress.keys()]) {
      if (!visibleRemoteAddresses.has(address)) {
        this.removeEntry(address)
      }
    }
  }

  private updateEffects(): void {
    const serverNowMs = getServerTime()
    for (const [address, hideAtMs] of remoteHealthEffectHideAtMsByAddress) {
      if (hideAtMs <= serverNowMs) {
        remoteHealthEffectHideAtMsByAddress.delete(address)
        remoteHealthEffectResetPendingAddresses.delete(address)
      }
    }

    for (const [address, entry] of this.entriesByAddress) {
      const avatarTransform = Transform.getOrNull(entry.avatarEntity)
      if (avatarTransform == null) continue

      const powerup = getPlayerPowerupSnapshot(address)
      const healthEffectHideAtMs = remoteHealthEffectHideAtMsByAddress.get(address) ?? 0
      if (healthEffectHideAtMs > serverNowMs && remoteHealthEffectResetPendingAddresses.has(address)) {
        resetRemoteHealthEffect(entry.healthEffectEntity)
        remoteHealthEffectResetPendingAddresses.delete(address)
      }
      updateRemoteAura(entry.healthEffectEntity, avatarTransform, healthEffectHideAtMs > serverNowMs)
      updateRemoteAura(entry.rageAuraEntity, avatarTransform, powerup.rageShieldEndAtMs > serverNowMs)
      updateRemoteAura(entry.speedAuraEntity, avatarTransform, powerup.speedEndAtMs > serverNowMs)
    }
  }

  private removeEntry(address: string): void {
    const entry = this.entriesByAddress.get(address)
    if (!entry) return
    this.entriesByAddress.delete(address)
    engine.removeEntity(entry.healthEffectEntity)
    engine.removeEntity(entry.rageAuraEntity)
    engine.removeEntity(entry.speedAuraEntity)
  }
}

function createRemotePowerupEntry(avatarEntity: Entity): RemotePowerupEntry {
  const healthEffectEntity = createRemoteHealthEffectEntity()
  const rageAuraEntity = createRemoteAuraEntity(RAGE_AURA_GLB, RAGE_AURA_ANIMS)
  const speedAuraEntity = createRemoteAuraEntity(SPEED_AURA_GLB, SPEED_AURA_ANIMS)

  return {
    avatarEntity,
    healthEffectEntity,
    rageAuraEntity,
    speedAuraEntity
  }
}

function createRemoteHealthEffectEntity(): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.Zero(),
    rotation: Quaternion.Identity(),
    scale: Vector3.One()
  })
  GltfContainer.create(entity, {
    src: HEALTH_PICKUP_EFFECT_GLB,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0
  })
  Animator.create(entity, {
    states: HEALTH_PICKUP_EFFECT_ANIMS.map((clip) => ({ clip, playing: true, loop: true, speed: 1 }))
  })
  VisibilityComponent.create(entity, { visible: false })
  return entity
}

function createRemoteAuraEntity(src: string, clips: string[]): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.Zero(),
    rotation: Quaternion.Identity(),
    scale: Vector3.One()
  })
  GltfContainer.create(entity, {
    src,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0
  })
  Animator.create(entity, {
    states: clips.map((clip) => ({ clip, playing: true, loop: true, speed: 1 }))
  })
  VisibilityComponent.create(entity, { visible: false })
  return entity
}

function resetRemoteHealthEffect(entity: Entity): void {
  Animator.getMutable(entity).states = HEALTH_PICKUP_EFFECT_ANIMS.map((clip) => ({
    clip,
    playing: true,
    loop: true,
    speed: 1,
    shouldReset: true
  }))
}

function updateRemoteAura(entity: Entity, avatarTransform: TransformData, active: boolean): void {
  const transform = Transform.getMutable(entity)
  transform.position = avatarTransform.position
  transform.rotation = avatarTransform.rotation
  VisibilityComponent.getMutable(entity).visible = active
}

let arenaRemotePowerups: ArenaRemotePowerups | null = null

export function initArenaRemotePowerups(): void {
  if (arenaRemotePowerups) return
  arenaRemotePowerups = new ArenaRemotePowerups()
}

export function playRemoteHealthPickupEffect(address: string): void {
  const normalizedAddress = address.toLowerCase()
  remoteHealthEffectHideAtMsByAddress.set(
    normalizedAddress,
    getServerTime() + HEALTH_PICKUP_EFFECT_DURATION_SECONDS * 1000
  )
  remoteHealthEffectResetPendingAddresses.add(normalizedAddress)
}
