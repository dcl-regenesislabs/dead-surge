import { PlayerLoadoutSnapshot } from './loadoutState'

export type DebugUiOnlyMode = 'off' | 'shop'

function resolveDebugUiOnlyMode(): DebugUiOnlyMode {
  return 'off'
}

// Use this to isolate one UI screen without gameplay/server noise.
export const DEBUG_UI_ONLY_MODE = resolveDebugUiOnlyMode()

export const DEBUG_SHOP_UI_ONLY = DEBUG_UI_ONLY_MODE === 'shop'
export const DEBUG_SHOW_GAMEPLAY_HUD_IN_LOBBY = false
export const DEBUG_LOBBY_MATCH_WAVE = 9
export const DEBUG_LOBBY_MATCH_ZOMBIES_LEFT = 23
export const DEBUG_LOBBY_MATCH_PHASE_SECONDS = 18

export const DEBUG_SHOP_UI_ONLY_LOADOUT: PlayerLoadoutSnapshot = {
  gold: 30,
  ownedWeaponIds: ['gun_t1', 'shotgun_t1', 'minigun_t1'],
  equippedWeaponIds: ['gun_t1', 'shotgun_t1', 'minigun_t1']
}
