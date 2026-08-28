import { Animator, engine, Entity, GltfContainer, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { isRaging } from './rageEffect'
import { RAGE_AURA_ANIMS, RAGE_AURA_GLB } from './shared/powerupVisuals'

let auraEntity: Entity | null = null

function ensureAuraEntity(): Entity {
  if (auraEntity !== null && Transform.has(auraEntity)) return auraEntity

  const entity = engine.addEntity()
  Transform.create(entity, {
    parent: engine.PlayerEntity,
    position: Vector3.Zero(),
    rotation: Quaternion.Identity(),
    scale: Vector3.One()
  })
  GltfContainer.create(entity, {
    src: RAGE_AURA_GLB,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0
  })
  Animator.create(entity, {
    states: RAGE_AURA_ANIMS.map((clip) => ({ clip, playing: true, loop: true, speed: 1 }))
  })
  VisibilityComponent.create(entity, { visible: false })
  auraEntity = entity
  return entity
}

export function rageAuraSystem(): void {
  if (!Transform.has(engine.PlayerEntity)) return

  const entity = ensureAuraEntity()
  VisibilityComponent.getMutable(entity).visible = isRaging()
}

export function initRageAura(): void {
  engine.addSystem(rageAuraSystem)
}
