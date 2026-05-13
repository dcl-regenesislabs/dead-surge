import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

const LobbyMessages = {
  playerLoadProfile: Schemas.Map({}),
  playerJoinLobby: Schemas.Map({
    roomId: Schemas.String
  }),
  playerLeaveLobby: Schemas.Map({
    roomId: Schemas.String
  }),
  playerForfeitMatch: Schemas.Map({
    roomId: Schemas.String
  }),
  buyLoadoutWeapon: Schemas.Map({
    weaponId: Schemas.String
  }),
  equipLoadoutWeapon: Schemas.Map({
    weaponId: Schemas.String
  }),
  createMatch: Schemas.Map({
    roomId: Schemas.String
  }),
  createMatchAndJoin: Schemas.Map({
    roomId: Schemas.String
  }),
  startGameManual: Schemas.Map({
    roomId: Schemas.String
  }),
  waveSpawnPlan: Schemas.Map({
    roomId: Schemas.String,
    waveNumber: Schemas.Number,
    startAtMs: Schemas.Int64,
    intervalMs: Schemas.Int64,
    spawns: Schemas.Array(
      Schemas.Map({
        zombieId: Schemas.String,
        zombieType: Schemas.String,
        spawnX: Schemas.Number,
        spawnY: Schemas.Number,
        spawnZ: Schemas.Number,
        spawnAtMs: Schemas.Int64
      })
    )
  }),
  zombieHitRequest: Schemas.Map({
    zombieId: Schemas.String,
    damage: Schemas.Number,
    weaponType: Schemas.String,
    shotSeq: Schemas.Number,
    positionX: Schemas.Number,
    positionY: Schemas.Number,
    positionZ: Schemas.Number
  }),
  rageShieldHitRequest: Schemas.Map({
    zombieId: Schemas.String
  }),
  zombieExplodeRequest: Schemas.Map({
    zombieId: Schemas.String
  }),
  zombieHealthChanged: Schemas.Map({
    roomId: Schemas.String,
    zombieId: Schemas.String,
    hp: Schemas.Number
  }),
  zombieDied: Schemas.Map({
    roomId: Schemas.String,
    zombieId: Schemas.String,
    killerAddress: Schemas.String
  }),
  zombieExploded: Schemas.Map({
    roomId: Schemas.String,
    zombieId: Schemas.String
  }),
  potionSpawned: Schemas.Map({
    roomId: Schemas.String,
    potionId: Schemas.String,
    potionType: Schemas.String,
    positionX: Schemas.Number,
    positionY: Schemas.Number,
    positionZ: Schemas.Number,
    expiresAtMs: Schemas.Int64
  }),
  potionClaimRequest: Schemas.Map({
    potionId: Schemas.String
  }),
  potionClaimed: Schemas.Map({
    roomId: Schemas.String,
    potionId: Schemas.String,
    claimerAddress: Schemas.String
  }),
  potionExpired: Schemas.Map({
    roomId: Schemas.String,
    potionId: Schemas.String
  }),
  potionClaimRejected: Schemas.Map({
    potionId: Schemas.String
  }),
  potionsCleared: Schemas.Map({
    roomId: Schemas.String
  }),
  playerDamageRequest: Schemas.Map({
    amount: Schemas.Number
  }),
  playerExplosionDamageRequest: Schemas.Map({
    zombieId: Schemas.String,
    amount: Schemas.Number
  }),
  playerHealRequest: Schemas.Map({
    amount: Schemas.Number
  }),
  playerShotRequest: Schemas.Map({
    seq: Schemas.Number,
    weaponType: Schemas.String,
    originX: Schemas.Number,
    originY: Schemas.Number,
    originZ: Schemas.Number,
    directionX: Schemas.Number,
    directionY: Schemas.Number,
    directionZ: Schemas.Number,
    firedAtMs: Schemas.Int64
  }),
  playerArenaWeaponChanged: Schemas.Map({
    weaponType: Schemas.String,
    upgradeLevel: Schemas.Number
  }),
  playerArenaWeaponState: Schemas.Map({
    address: Schemas.String,
    weaponType: Schemas.String,
    upgradeLevel: Schemas.Number
  }),
  playerPowerupState: Schemas.Map({
    address: Schemas.String,
    rageShieldEndAtMs: Schemas.Int64,
    speedEndAtMs: Schemas.Int64
  }),
  playerShotBroadcast: Schemas.Map({
    roomId: Schemas.String,
    shooterAddress: Schemas.String,
    seq: Schemas.Number,
    weaponType: Schemas.String,
    originX: Schemas.Number,
    originY: Schemas.Number,
    originZ: Schemas.Number,
    directionX: Schemas.Number,
    directionY: Schemas.Number,
    directionZ: Schemas.Number,
    firedAtMs: Schemas.Int64,
    serverTimeMs: Schemas.Int64
  }),
  playerHealthState: Schemas.Map({
    address: Schemas.String,
    hp: Schemas.Number,
    isDead: Schemas.Boolean,
    respawnAtMs: Schemas.Int64,
    lives: Schemas.Number
  }),
  matchAutoTeleport: Schemas.Map({
    addresses: Schemas.Array(Schemas.String),
    positionX: Schemas.Number,
    positionY: Schemas.Number,
    positionZ: Schemas.Number,
    lookAtX: Schemas.Number,
    lookAtY: Schemas.Number,
    lookAtZ: Schemas.Number
  }),
  lobbyReturnTeleport: Schemas.Map({
    addresses: Schemas.Array(Schemas.String),
    positionX: Schemas.Number,
    positionY: Schemas.Number,
    positionZ: Schemas.Number,
    lookAtX: Schemas.Number,
    lookAtY: Schemas.Number,
    lookAtZ: Schemas.Number
  }),
  playerLoadoutState: Schemas.Map({
    address: Schemas.String,
    gold: Schemas.Number,
    ownedWeaponIds: Schemas.Array(Schemas.String),
    equippedWeaponIds: Schemas.Array(Schemas.String)
  }),
  lobbyEvent: Schemas.Map({
    type: Schemas.String,
    message: Schemas.String
  }),
  lavaHazardsSpawned: Schemas.Map({
    roomId: Schemas.String,
    hazards: Schemas.Array(
      Schemas.Map({
        lavaId: Schemas.String,
        gridX: Schemas.Number,
        gridZ: Schemas.Number,
        modelVariant: Schemas.Number,
        rotationQuarterTurns: Schemas.Number,
        warningAtMs: Schemas.Int64,
        activeAtMs: Schemas.Int64,
        expiresAtMs: Schemas.Int64
      })
    )
  }),
  lavaHazardsExpired: Schemas.Map({
    roomId: Schemas.String,
    lavaIds: Schemas.Array(Schemas.String)
  }),
  lavaHazardsCleared: Schemas.Map({
    roomId: Schemas.String
  }),
  lavaPatternWarning: Schemas.Map({
    roomId: Schemas.String,
    patternType: Schemas.String,
    startsAtMs: Schemas.Int64
  }),
  lavaHazardDamageRequest: Schemas.Map({
    lavaId: Schemas.String
  }),
  collectibleSpawned: Schemas.Map({
    roomId: Schemas.String,
    collectibleId: Schemas.String,
    positionX: Schemas.Number,
    positionY: Schemas.Number,
    positionZ: Schemas.Number,
    expiresAtMs: Schemas.Int64
  }),
  collectiblePickupRequest: Schemas.Map({
    collectibleId: Schemas.String
  }),
  collectibleClaimed: Schemas.Map({
    roomId: Schemas.String,
    collectibleId: Schemas.String,
    claimerAddress: Schemas.String
  }),
  collectibleExpired: Schemas.Map({
    roomId: Schemas.String,
    collectibleId: Schemas.String
  }),
  collectiblesCleared: Schemas.Map({
    roomId: Schemas.String
  }),
  collectibleClaimRejected: Schemas.Map({
    collectibleId: Schemas.String
  }),
  playerZcState: Schemas.Map({
    address: Schemas.String,
    zc: Schemas.Number
  })
}

export const room = registerMessages(LobbyMessages)
