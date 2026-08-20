import { Animator, engine, Entity, GltfContainer, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { getSpeedPickupFlashTimeLeft, isSpeedActive } from './speedEffect'
import { getGameTime } from './zombie'

const SPEED_AURA_GLB = 'assets/custom/models/powerup_speed.glb'
const SPEED_AURA_ANIMS = ['CylinderAction', 'CylinderAction.001', 'SppedAction']

const SPEED_FLASH_DURATION_SEC = 0.65

let speedAuraEntity: Entity | null = null

function ensureSpeedAuraEntity(): Entity {
  if (speedAuraEntity !== null && Transform.has(speedAuraEntity)) return speedAuraEntity

  const entity = engine.addEntity()
  Transform.create(entity, {
    parent: engine.PlayerEntity,
    position: Vector3.Zero(),
    rotation: Quaternion.Identity(),
    scale: Vector3.One()
  })
  GltfContainer.create(entity, {
    src: SPEED_AURA_GLB,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0
  })
  Animator.create(entity, {
    states: SPEED_AURA_ANIMS.map((clip) => ({ clip, playing: true, loop: true, speed: 1 }))
  })
  VisibilityComponent.create(entity, { visible: false })
  speedAuraEntity = entity
  return entity
}

export function speedAuraSystem(): void {
  if (!Transform.has(engine.PlayerEntity)) return

  const entity = ensureSpeedAuraEntity()
  const time = getGameTime()
  const flashActive = getSpeedPickupFlashTimeLeft(time) > 0
  VisibilityComponent.getMutable(entity).visible = isSpeedActive() || flashActive
}

export function initSpeedAura(): void {
  engine.addSystem(speedAuraSystem)
}
