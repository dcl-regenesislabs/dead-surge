import { Animator, engine, Entity, GltfContainer, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { isRaging } from './rageEffect'

const RAGE_AURA_GLB = 'assets/custom/models/powerup_rage.glb'
const RAGE_AURA_ANIMS = [
  'RageHex_Spin',
  'Rage1_Wave', 'Flame1_Flicker', 'Rage2_Wave', 'Flame2_Flicker',
  'Rage3_Wave', 'Flame3_Flicker', 'Rage4_Wave', 'Flame4_Flicker',
  'Rage5_Wave', 'Flame5_Flicker', 'Rage6_Wave', 'Flame6_Flicker'
]

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
