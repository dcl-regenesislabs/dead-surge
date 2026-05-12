import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import {
  LOADOUT_WEAPON_DEFINITIONS,
  LoadoutWeaponDefinition,
  LoadoutWeaponId,
  ArenaWeaponType,
  getWeaponUpgrades
} from './shared/loadoutCatalog'
import { buyLoadoutWeaponLocally, equipLoadoutWeaponLocally, getPlayerGold, isLoadoutWeaponEquipped, isLoadoutWeaponOwned } from './loadoutState'
import { sendBuyLoadoutWeapon, sendEquipLoadoutWeapon, sendRequestLoadoutRefresh } from './multiplayer/lobbyClient'
import { endUiPointerCapture } from './gameplayInput'
import { isMobile } from './ui'
import { DEBUG_SHOP_UI_ONLY } from './debugFlags'
import { OutlinedText } from './outlineComponent'

let storeOpen = false
let selectedWeaponId: LoadoutWeaponId = LOADOUT_WEAPON_DEFINITIONS[0].id
let deniedPriceShakeWeaponId: LoadoutWeaponId | null = null
let deniedPriceShakeStartedAt = 0
const DENIED_PRICE_SHAKE_DURATION_MS = 420
const DENIED_PRICE_SHAKE_AMPLITUDE = 10

export function openLobbyStore(): void {
  storeOpen = true
  selectedWeaponId = LOADOUT_WEAPON_DEFINITIONS[0].id
  if (!DEBUG_SHOP_UI_ONLY) {
    sendRequestLoadoutRefresh()
  }
}

export function closeLobbyStore(): void {
  if (DEBUG_SHOP_UI_ONLY) return
  storeOpen = false
  endUiPointerCapture()
}

export function isLobbyStoreOpen(): boolean {
  return storeOpen
}

function triggerDeniedPriceShake(weaponId: LoadoutWeaponId): void {
  deniedPriceShakeWeaponId = weaponId
  deniedPriceShakeStartedAt = Date.now()
}

function getDeniedPriceShakeOffset(weaponId: LoadoutWeaponId): number {
  if (deniedPriceShakeWeaponId !== weaponId) return 0

  const elapsed = Date.now() - deniedPriceShakeStartedAt
  if (elapsed >= DENIED_PRICE_SHAKE_DURATION_MS) {
    deniedPriceShakeWeaponId = null
    deniedPriceShakeStartedAt = 0
    return 0
  }

  const progress = elapsed / DENIED_PRICE_SHAKE_DURATION_MS
  const wave = Math.sin(progress * Math.PI * 10)
  const damping = 1 - progress
  return Math.round(wave * damping * DENIED_PRICE_SHAKE_AMPLITUDE)
}

function getUiCanvasInfo() {
  return UiCanvasInformation.getOrNull(engine.RootEntity)
}

function getEffectiveCanvasViewport() {
  const canvasInfo = getUiCanvasInfo()
  if (!canvasInfo) return null
  const devicePixelRatio = canvasInfo.devicePixelRatio > 0 ? canvasInfo.devicePixelRatio : 1
  return {
    width: Math.round(canvasInfo.width / devicePixelRatio),
    height: Math.round(canvasInfo.height / devicePixelRatio),
    devicePixelRatio,
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getStoreScaleProfile() {
  const effectiveViewport = getEffectiveCanvasViewport()
  if (!effectiveViewport) {
    return { width: 1, height: 1, spacing: 1, font: 1, image: 1, button: 1 }
  }
  const viewportScale = Math.min(
    effectiveViewport.width / 1920,
    effectiveViewport.height / 1080
  )
  const layoutScale = clampNumber(viewportScale, 0.78, 1.12) * (isMobile() ? 1.5 : 1)
  const fontScale = clampNumber(layoutScale * 1.03, 0.82, 1.14)
  return {
    width: layoutScale,
    height: layoutScale,
    spacing: layoutScale,
    font: fontScale,
    image: layoutScale,
    button: layoutScale
  }
}

function scaleStoreUiValue(value: number, scale: number = 1): number {
  return scale === 1 ? value : Math.max(1, Math.round(value * scale))
}
function scaleStoreSignedUiValue(value: number, scale: number = 1): number {
  if (scale === 1 || value === 0) return value
  const scaled = Math.max(1, Math.round(Math.abs(value) * scale))
  return value < 0 ? -scaled : scaled
}
function scaleStoreWidth(value: number): number { return scaleStoreUiValue(value, getStoreScaleProfile().width) }
function scaleStoreHeight(value: number): number { return scaleStoreUiValue(value, getStoreScaleProfile().height) }
function scaleStoreSpacing(value: number): number { return scaleStoreUiValue(value, getStoreScaleProfile().spacing) }
function scaleStoreOffset(value: number): number { return scaleStoreSignedUiValue(value, getStoreScaleProfile().spacing) }
function scaleStoreFont(value: number): number { return scaleStoreUiValue(value, getStoreScaleProfile().font) }
function scaleStoreImage(value: number): number { return scaleStoreUiValue(value, getStoreScaleProfile().image) }
function scaleStoreButton(value: number): number { return scaleStoreUiValue(value, getStoreScaleProfile().button) }

// ─── Colors ───────────────────────────────────────────────────────────────────

const C = {
  panel:        Color4.create(0.10, 0.12, 0.07, 0.97),
  headerBg:     Color4.create(0.16, 0.24, 0.13, 1),
  separator:    Color4.create(0.56, 0.69, 0.30, 1),

  rowLabel:     Color4.create(0.18, 0.28, 0.12, 1),
  rowLabelText: Color4.create(0.96, 0.94, 0.74, 1),

  cardT1:       Color4.create(0.16, 0.27, 0.13, 1),
  cardT1Sel:    Color4.create(0.34, 0.26, 0.10, 1),
  cardT2:       Color4.create(0.33, 0.10, 0.11, 1),
  cardT2Sel:    Color4.create(0.54, 0.16, 0.16, 1),
  cardT3:       Color4.create(0.48, 0.30, 0.08, 1),
  cardT3Sel:    Color4.create(0.72, 0.47, 0.12, 1),
  cardOwned:    Color4.create(0.10, 0.29, 0.14, 1),
  cardOwnedSel: Color4.create(0.17, 0.43, 0.20, 1),

  detailBg:     Color4.create(0.12, 0.15, 0.10, 1),
  statRowA:     Color4.create(0.20, 0.23, 0.15, 1),
  statBarBg:    Color4.create(0.29, 0.22, 0.12, 1),
  statBarFg:    Color4.create(0.77, 0.71, 0.28, 1),

  textWhite:    Color4.create(1.00, 1.00, 1.00, 1),
  textGold:     Color4.create(0.98, 0.83, 0.27, 1),
  textGray:     Color4.create(0.76, 0.77, 0.66, 1),
  textGreen:    Color4.create(0.56, 0.92, 0.45, 1),
  textLocked:   Color4.create(0.53, 0.50, 0.40, 1),
  textBurgundy: Color4.create(0.62, 0.18, 0.20, 1),
  textTitle:    Color4.create(0.97, 0.95, 0.79, 1),

  tierT1:       Color4.create(0.62, 0.84, 0.46, 1),
  tierT2:       Color4.create(0.93, 0.40, 0.30, 1),
  tierT3:       Color4.create(1.00, 0.80, 0.18, 1),

  btnBuy:       Color4.create(0.69, 0.46, 0.10, 1),
  btnEquip:     Color4.create(0.17, 0.49, 0.18, 1),
  btnEquipped:  Color4.create(0.11, 0.24, 0.10, 1),
  btnLocked:    Color4.create(0.19, 0.18, 0.14, 1),
  btnClose:     Color4.create(0.60, 0.13, 0.08, 1),
  goldBadgeBg:  Color4.create(0.28, 0.19, 0.04, 1),

  star:         Color4.create(1.00, 0.78, 0.10, 1),
}

// ─── Assets ───────────────────────────────────────────────────────────────────

const WEAPON_IMAGE: Partial<Record<LoadoutWeaponId, string>> = {
  gun_t1:     'assets/images/Gun01.png',
  gun_t2:     'assets/images/Gun02.png',
  gun_t3:     'assets/images/Gun03.png',
  shotgun_t1: 'assets/images/ShotGun01.png',
  shotgun_t2: 'assets/images/ShotGun02.png',
  shotgun_t3: 'assets/images/ShotGun03.png',
  minigun_t1: 'assets/images/MachineGun01.png',
  minigun_t2: 'assets/images/MachineGun02.png',
  minigun_t3: 'assets/images/MachineGun03.png',
}

const WEAPON_IMAGE_DIMENSIONS: Partial<Record<LoadoutWeaponId, { width: number; height: number }>> = {
  gun_t1:     { width: 1254, height: 1254 },
  gun_t2:     { width: 1024, height: 1024 },
  gun_t3:     { width: 1024, height: 1024 },
  shotgun_t1: { width: 1024, height: 1024 },
  shotgun_t2: { width: 1024, height: 1024 },
  shotgun_t3: { width: 1024, height: 1024 },
  minigun_t1: { width: 1024, height: 1024 },
  minigun_t2: { width: 1024, height: 1024 },
  minigun_t3: { width: 1024, height: 1024 },
}

const WEAPON_ROW_LABEL: Record<ArenaWeaponType, string> = {
  gun:     'GUN',
  shotgun: 'SHOTGUN',
  minigun: 'MINI\nGUN',
}

const WEAPON_BASE_LABEL: Record<ArenaWeaponType, string> = {
  gun:     'Pistol',
  shotgun: 'Shotgun',
  minigun: 'Minigun',
}

const WEAPON_TIER_LABEL: Record<LoadoutWeaponDefinition['upgradeLevel'], string> = {
  1: 'Basic',
  2: 'Super',
  3: 'Gold',
}

const WEAPON_EMOJI: Record<ArenaWeaponType, string> = {
  gun:     '🔫',
  shotgun: '💥',
  minigun: '⚡',
}

const UPGRADE_STARS = ['★☆☆', '★★☆', '★★★']

const WEAPON_STATS: Partial<Record<LoadoutWeaponId, { dmg: string; rate: string; range: string }>> = {
  gun_t1:     { dmg: '25',  rate: '0.40s', range: 'Long' },
  gun_t2:     { dmg: '35',  rate: '0.35s', range: 'Long' },
  gun_t3:     { dmg: '50',  rate: '0.30s', range: 'Long' },
  shotgun_t1: { dmg: '60',  rate: '0.90s', range: 'Short' },
  shotgun_t2: { dmg: '80',  rate: '0.85s', range: 'Short' },
  shotgun_t3: { dmg: '110', rate: '0.75s', range: 'Short' },
  minigun_t1: { dmg: '12',  rate: '0.08s', range: 'Medium' },
  minigun_t2: { dmg: '16',  rate: '0.07s', range: 'Medium' },
  minigun_t3: { dmg: '22',  rate: '0.06s', range: 'Medium' },
}

const WEAPON_ROWS: ArenaWeaponType[] = ['gun', 'shotgun', 'minigun']
const SHOP_ATLAS_1_SRC = 'assets/images/shop_atlas_1.png'
const SHOP_ATLAS_2_SRC = 'assets/images/shop_atlas_2.png'
const SHOP_ATLAS_WIDTH = 1024
const SHOP_ATLAS_HEIGHT = 1024
const STORE_MESSAGE_RENDER_WIDTH = 748
const STORE_MESSAGE_RENDER_HEIGHT = 53
const STORE_GOLD_RENDER_WIDTH = 127
const STORE_GOLD_RENDER_HEIGHT = 55
const STORE_OWNED_RENDER_SCALE = 0.98
const STORE_EQUIPPED_RENDER_SCALE = 1.04
const STORE_UPGRADE_ROW_SOURCE_X = 987
const STORE_UPGRADE_ROW_SOURCE_Y = 343
const STORE_UPGRADE_ROW_SOURCE_WIDTH = 326
const STORE_UPGRADE_ROW_SOURCE_HEIGHT = 135
const STORE_UPGRADE_ROW_RENDER_WIDTH = 344
const STORE_UPGRADE_ROW_RENDER_HEIGHT = 135
const STORE_UPGRADE_CARD_SOURCE_WIDTH = 102
const STORE_UPGRADE_CARD_SOURCE_HEIGHT = 135
const STORE_UPGRADE_CARD_RENDER_WIDTH = 110
const STORE_UPGRADE_CARD_RENDER_HEIGHT = 135
const STORE_WEAPON_LABEL_OFFSET_LEFT = 0
const STORE_CLOSE_RENDER_WIDTH = 70
const STORE_CLOSE_RENDER_HEIGHT = 62
const STORE_DETAIL_BOX_RENDER_WIDTH = 250
const STORE_DETAIL_BOX_RENDER_HEIGHT = 419
const STORE_HEADER_ACTIONS_TOP = 18
const STORE_HEADER_ACTIONS_RIGHT = 32
const STORE_PANEL_EXTRA_HEIGHT = 38

type ShopAtlasUvs = [number, number, number, number, number, number, number, number]
type ShopAtlasSprite = {
  src: string
  x: number
  y: number
  width: number
  height: number
  uvs: ShopAtlasUvs
}

function createShopAtlasUvs(x: number, y: number, width: number, height: number): ShopAtlasUvs {
  const left = x / SHOP_ATLAS_WIDTH
  const right = (x + width) / SHOP_ATLAS_WIDTH
  const bottom = 1 - (y + height) / SHOP_ATLAS_HEIGHT
  const top = 1 - y / SHOP_ATLAS_HEIGHT
  return [left, bottom, left, top, right, top, right, bottom]
}

function createShopAtlasSprite(src: string, x: number, y: number, width: number, height: number): ShopAtlasSprite {
  return { src, x, y, width, height, uvs: createShopAtlasUvs(x, y, width, height) }
}

function createShopSpriteBackground(sprite: ShopAtlasSprite) {
  return {
    textureMode: 'stretch' as const,
    texture: { src: sprite.src },
    uvs: sprite.uvs
  }
}

// Inventory of every atlas-backed sprite the shop UI currently uses.
const SHOP_UI_SPRITES = {
  panel: createShopAtlasSprite(SHOP_ATLAS_1_SRC, 6, 9, 782, 654),
  message: createShopAtlasSprite(SHOP_ATLAS_1_SRC, 16, 687, 748, 57),
  gold: createShopAtlasSprite(SHOP_ATLAS_2_SRC, 532, 48, 127, 55),
  equipped: createShopAtlasSprite(SHOP_ATLAS_2_SRC, 295, 236, 173, 49),
  equip: createShopAtlasSprite(SHOP_ATLAS_2_SRC, 289, 103, 201, 54),
  owned: createShopAtlasSprite(SHOP_ATLAS_2_SRC, 482, 233, 186, 52),
  buy: createShopAtlasSprite(SHOP_ATLAS_2_SRC, 717, 215, 168, 53),
  buyDisabled: createShopAtlasSprite(SHOP_ATLAS_2_SRC, 717, 147, 168, 53),
  unlockPrevious: createShopAtlasSprite(SHOP_ATLAS_2_SRC, 532, 126, 167, 41),
  buyGoldIcon: createShopAtlasSprite(SHOP_ATLAS_1_SRC, 880, 691, 60, 60),
  cardTag: createShopAtlasSprite(SHOP_ATLAS_2_SRC, 716, 47, 166, 53),
  cardSelectionGlow: createShopAtlasSprite(SHOP_ATLAS_1_SRC, 621, 803, 148, 182),
  upgradeCards: {
    1: createShopAtlasSprite(SHOP_ATLAS_1_SRC, 278, 826, 102, 135),
    2: createShopAtlasSprite(SHOP_ATLAS_1_SRC, 391, 826, 101, 135),
    3: createShopAtlasSprite(SHOP_ATLAS_1_SRC, 502, 826, 102, 135)
  },
  weaponLabels: {
    gun: createShopAtlasSprite(SHOP_ATLAS_1_SRC, 853, 33, 131, 130),
    shotgun: createShopAtlasSprite(SHOP_ATLAS_1_SRC, 852, 175, 132, 129),
    minigun: createShopAtlasSprite(SHOP_ATLAS_1_SRC, 852, 318, 131, 128)
  },
  close: createShopAtlasSprite(SHOP_ATLAS_1_SRC, 147, 795, 70, 62),
  detailBox: createShopAtlasSprite(SHOP_ATLAS_2_SRC, 11, 39, 250, 419)
} as const

const STORE_PANEL_SOURCE_WIDTH = SHOP_UI_SPRITES.panel.width
const STORE_PANEL_SOURCE_HEIGHT = SHOP_UI_SPRITES.panel.height
const STORE_MESSAGE_SOURCE_WIDTH = SHOP_UI_SPRITES.message.width
const STORE_MESSAGE_SOURCE_HEIGHT = SHOP_UI_SPRITES.message.height
const STORE_GOLD_SOURCE_WIDTH = SHOP_UI_SPRITES.gold.width
const STORE_GOLD_SOURCE_HEIGHT = SHOP_UI_SPRITES.gold.height
const STORE_EQUIPPED_SOURCE_WIDTH = SHOP_UI_SPRITES.equipped.width
const STORE_EQUIPPED_SOURCE_HEIGHT = SHOP_UI_SPRITES.equipped.height
const STORE_EQUIP_SOURCE_WIDTH = SHOP_UI_SPRITES.equip.width
const STORE_EQUIP_SOURCE_HEIGHT = SHOP_UI_SPRITES.equip.height
const STORE_OWNED_SOURCE_WIDTH = SHOP_UI_SPRITES.owned.width
const STORE_OWNED_SOURCE_HEIGHT = SHOP_UI_SPRITES.owned.height
const STORE_BUY_SOURCE_WIDTH = SHOP_UI_SPRITES.buy.width
const STORE_BUY_SOURCE_HEIGHT = SHOP_UI_SPRITES.buy.height
const STORE_BUY_DISABLED_SOURCE_WIDTH = SHOP_UI_SPRITES.buyDisabled.width
const STORE_BUY_DISABLED_SOURCE_HEIGHT = SHOP_UI_SPRITES.buyDisabled.height
const STORE_UNLOCK_PREVIOUS_SOURCE_WIDTH = SHOP_UI_SPRITES.unlockPrevious.width
const STORE_UNLOCK_PREVIOUS_SOURCE_HEIGHT = SHOP_UI_SPRITES.unlockPrevious.height
const STORE_CARD_TAG_SOURCE_WIDTH = SHOP_UI_SPRITES.cardTag.width
const STORE_CARD_TAG_SOURCE_HEIGHT = SHOP_UI_SPRITES.cardTag.height
const STORE_CARD_SELECTION_GLOW_SOURCE_WIDTH = SHOP_UI_SPRITES.cardSelectionGlow.width
const STORE_CARD_SELECTION_GLOW_SOURCE_HEIGHT = SHOP_UI_SPRITES.cardSelectionGlow.height
const STORE_CLOSE_SOURCE_WIDTH = SHOP_UI_SPRITES.close.width
const STORE_CLOSE_SOURCE_HEIGHT = SHOP_UI_SPRITES.close.height
const STORE_DETAIL_BOX_SOURCE_WIDTH = SHOP_UI_SPRITES.detailBox.width
const STORE_DETAIL_BOX_SOURCE_HEIGHT = SHOP_UI_SPRITES.detailBox.height

const STORE_UPGRADE_CARD_SPRITES: Record<LoadoutWeaponDefinition['upgradeLevel'], ShopAtlasSprite> = {
  1: SHOP_UI_SPRITES.upgradeCards[1],
  2: SHOP_UI_SPRITES.upgradeCards[2],
  3: SHOP_UI_SPRITES.upgradeCards[3]
}
const STORE_WEAPON_LABEL_SPRITES: Record<ArenaWeaponType, {
  sprite: ShopAtlasSprite
  renderW: number
  renderH: number
  offsetTop?: number
}> = {
  gun: { sprite: SHOP_UI_SPRITES.weaponLabels.gun, renderW: 140, renderH: 130, offsetTop: -4 },
  shotgun: { sprite: SHOP_UI_SPRITES.weaponLabels.shotgun, renderW: 140, renderH: 130, offsetTop: -4 },
  minigun: { sprite: SHOP_UI_SPRITES.weaponLabels.minigun, renderW: 140, renderH: 130, offsetTop: -4 }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTierColor(upgradeLevel: number): Color4 {
  if (upgradeLevel === 1) return C.tierT1
  if (upgradeLevel === 2) return C.tierT2
  return C.tierT3
}

function getStatPercent(statKey: 'dmg' | 'rate' | 'range', value: string): number {
  if (statKey === 'dmg') return Math.min(parseInt(value) || 0, 120) / 120
  if (statKey === 'rate') return Math.max(0, 1 - ((parseFloat(value) || 0) / 1.0))
  return value === 'Short' ? 0.33 : value === 'Medium' ? 0.66 : 1.0
}

function getCardBg(upgradeLevel: number, isSelected: boolean, owned: boolean): Color4 {
  if (owned) return isSelected ? C.cardOwnedSel : C.cardOwned
  if (upgradeLevel === 1) return isSelected ? C.cardT1Sel : C.cardT1
  if (upgradeLevel === 2) return isSelected ? C.cardT2Sel : C.cardT2
  return isSelected ? C.cardT3Sel : C.cardT3
}


function isPreviousOwned(weapon: LoadoutWeaponDefinition): boolean {
  if (weapon.upgradeLevel === 1) return true
  const upgrades = getWeaponUpgrades(weapon.arenaWeaponType)
  const prev = upgrades.find((u) => u.upgradeLevel === weapon.upgradeLevel - 1)
  return prev ? isLoadoutWeaponOwned(prev.id) : true
}

function getShopWeaponLabel(weapon: LoadoutWeaponDefinition): string {
  return `${WEAPON_BASE_LABEL[weapon.arenaWeaponType]} ${WEAPON_TIER_LABEL[weapon.upgradeLevel]}`
}

function getUpgradeTierLabel(weapon: LoadoutWeaponDefinition): string {
  return WEAPON_TIER_LABEL[weapon.upgradeLevel]
}

function getContainedWeaponImageSize(weaponId: LoadoutWeaponId, maxWidth: number, maxHeight: number) {
  const dimensions = WEAPON_IMAGE_DIMENSIONS[weaponId]
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    const fallback = Math.min(maxWidth, maxHeight)
    return { width: fallback, height: fallback }
  }

  const scale = Math.min(maxWidth / dimensions.width, maxHeight / dimensions.height)
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale))
  }
}



// ─── Metrics ─────────────────────────────────────────────────────────────────

function getStoreMetrics() {
  const actualMobile = isMobile()
  const storePanelBaseWidth = scaleStoreWidth(STORE_PANEL_SOURCE_WIDTH)
  const storePanelMaxW = actualMobile ? Math.round(storePanelBaseWidth * 1.08) : storePanelBaseWidth
  const safeHorizontalMargin = scaleStoreSpacing(actualMobile ? 18 : 24)
  const cardWBase = scaleStoreWidth(actualMobile ? STORE_UPGRADE_CARD_RENDER_WIDTH + 4 : STORE_UPGRADE_CARD_RENDER_WIDTH)
  const cardHBase = scaleStoreHeight(STORE_UPGRADE_CARD_RENDER_HEIGHT)
  const cardGapBase = scaleStoreSpacing(1)
  const rowCardAreaWBase = cardWBase * 3 + cardGapBase * 2
  const rowCardAreaHBase = cardHBase
  const cardImageBoxBase = scaleStoreImage(74)
  const cardImageAreaHBase = scaleStoreHeight(96)
  const cardNameAreaH = 0
  const rowGapBase = scaleStoreSpacing(7)
  // Intentionally keep desktop-style row labels and sizing logic on all devices for this shop layout.
  const mobile = false
  const rowLabelWBase = Math.max(
    scaleStoreWidth(STORE_WEAPON_LABEL_SPRITES.gun.renderW),
    scaleStoreWidth(STORE_WEAPON_LABEL_SPRITES.shotgun.renderW),
    scaleStoreWidth(STORE_WEAPON_LABEL_SPRITES.minigun.renderW)
  )
  const rowLabelGapBase = scaleStoreSpacing(10)
  const detailPanelWBase = scaleStoreWidth(175)
  const detailTitleHBase = scaleStoreHeight(34)
  const detailSubtitleHBase = scaleStoreHeight(20)
  const detailBoxWidthBase = scaleStoreWidth(STORE_DETAIL_BOX_RENDER_WIDTH)
  const detailBoxHeightBase = scaleStoreHeight(STORE_DETAIL_BOX_RENDER_HEIGHT)
  const detailBoxGapBase = scaleStoreSpacing(10)
  const naturalContentWidth = rowLabelWBase + rowLabelGapBase + rowCardAreaWBase + detailBoxGapBase + detailBoxWidthBase
  const safeContentWidth = Math.max(1, storePanelMaxW - safeHorizontalMargin * 2)
  const contentFitScale = Math.min(1, safeContentWidth / naturalContentWidth)
  const fitDimension = (value: number) => Math.max(1, Math.round(value * contentFitScale))

  const rowCardAreaW = fitDimension(rowCardAreaWBase)
  const rowCardAreaH = fitDimension(rowCardAreaHBase)
  const cardW = fitDimension(cardWBase)
  const cardH = fitDimension(cardHBase)
  const cardGap = fitDimension(cardGapBase)
  const cardImageBox = fitDimension(cardImageBoxBase)
  const cardImageAreaH = fitDimension(cardImageAreaHBase)
  const rowGap = fitDimension(rowGapBase)
  const rowLabelW = fitDimension(rowLabelWBase)
  const rowLabelGap = fitDimension(rowLabelGapBase)
  const detailPanelW = fitDimension(detailPanelWBase)
  const detailTitleH = fitDimension(detailTitleHBase)
  const detailSubtitleH = fitDimension(detailSubtitleHBase)
  const detailBoxBaseWidth = fitDimension(detailBoxWidthBase)
  const detailBoxBaseHeight = fitDimension(detailBoxHeightBase)
  const detailBoxGap = fitDimension(detailBoxGapBase)

  // Stat row widths derived from panel so they always add up (panel - 24 panel pad - 26 row pad - 16 gaps)
  const statNoGap = detailPanelW - fitDimension(24) - fitDimension(26) - fitDimension(16)
  const statLabelW = Math.round(statNoGap * 0.379)
  const statValueW = Math.round(statNoGap * 0.265)
  const statBarW   = statNoGap - statLabelW - statValueW

  const storePanelBaseHeight = actualMobile
    ? Math.round(scaleStoreHeight(STORE_PANEL_SOURCE_HEIGHT) * (storePanelMaxW / storePanelBaseWidth) * 0.94)
    : scaleStoreHeight(STORE_PANEL_SOURCE_HEIGHT)
  const storeBodyGap = 0
  const gridColumns = 3
  const leftGridW = rowLabelW + rowLabelGap + rowCardAreaW
  const storeGridHeight = cardH * WEAPON_ROWS.length + rowGap * (WEAPON_ROWS.length - 1)
  const detailBoxScale = actualMobile ? storeGridHeight / detailBoxBaseHeight : 1
  const detailBoxRenderWidth = Math.round(detailBoxBaseWidth * detailBoxScale)
  const detailBoxRenderHeight = Math.round(detailBoxBaseHeight * detailBoxScale)
  const storeContentW = leftGridW + detailBoxGap + detailBoxRenderWidth
  const detailPanelFitScale = detailPanelW / Math.max(1, detailPanelWBase)
  const messageWidthCompensation = fitDimension(18)
  const storeControlsHeight = scaleStoreButton(34)
  const storeBodyMarginTop = scaleStoreSpacing(28)
  const storeMessageWidth = storeContentW + messageWidthCompensation
  const storeMessageHeight = scaleStoreHeight(STORE_MESSAGE_RENDER_HEIGHT)
  const storeMessageMarginTop = scaleStoreSpacing(6)
  const storeMessageMarginBottom = scaleStoreSpacing(0)
  const storePanelVerticalPadding = scaleStoreSpacing(0)
  const storeBodyHeight = storeGridHeight + scaleStoreSpacing(10)
  const storePanelContentH = storeControlsHeight + storeBodyMarginTop + storeBodyHeight + storeMessageMarginTop + storeMessageHeight + storeMessageMarginBottom + storePanelVerticalPadding
  const storePanelHeight = Math.max(storePanelBaseHeight + scaleStoreHeight(STORE_PANEL_EXTRA_HEIGHT), storePanelContentH)

  return {
    CARD_W: cardW, CARD_H: cardH, CARD_GAP: cardGap, ROW_CARD_AREA_W: rowCardAreaW, ROW_CARD_AREA_H: rowCardAreaH,
    CARD_IMAGE_BOX: cardImageBox, CARD_IMAGE_AREA_H: cardImageAreaH, CARD_NAME_AREA_H: cardNameAreaH,
    ROW_GAP: rowGap, ROW_LABEL_W: rowLabelW, ROW_LABEL_GAP: rowLabelGap,
    DETAIL_PANEL_W: detailPanelW, DETAIL_TITLE_H: detailTitleH, DETAIL_SUBTITLE_H: detailSubtitleH,
    DETAIL_PANEL_FIT_SCALE: detailPanelFitScale,
    STORE_PANEL_MAX_W: storePanelMaxW, STORE_BODY_GAP: storeBodyGap,
    STORE_DETAIL_BOX_RENDER_WIDTH: detailBoxRenderWidth, STORE_DETAIL_BOX_RENDER_HEIGHT: detailBoxRenderHeight,
    STORE_DETAIL_BOX_GAP: detailBoxGap,
    LEFT_GRID_W: leftGridW, STORE_CONTENT_W: storeContentW, STORE_GRID_HEIGHT: storeGridHeight, STORE_PANEL_HEIGHT: storePanelHeight,
    STORE_BODY_MARGIN_TOP: storeBodyMarginTop,
    STORE_MESSAGE_WIDTH: storeMessageWidth, STORE_MESSAGE_HEIGHT: storeMessageHeight,
    STORE_MESSAGE_MARGIN_TOP: storeMessageMarginTop, STORE_MESSAGE_MARGIN_BOTTOM: storeMessageMarginBottom,
    STAT_LABEL_W: statLabelW, STAT_BAR_W: statBarW, STAT_VALUE_W: statValueW,
    MOBILE: mobile,
  }
}

// ─── Upgrade Card ─────────────────────────────────────────────────────────────

function UpgradeCard({ weapon, isLast }: { weapon: LoadoutWeaponDefinition; isLast?: boolean }) {
  const { CARD_W, CARD_H, CARD_GAP, CARD_IMAGE_BOX, CARD_IMAGE_AREA_H } = getStoreMetrics()
  const ACTUAL_MOBILE = isMobile()
  const isSelected = weapon.id === selectedWeaponId
  const imageSrc = WEAPON_IMAGE[weapon.id]
  const cardImageSize = getContainedWeaponImageSize(weapon.id, CARD_IMAGE_BOX, CARD_IMAGE_BOX)
  const cardTagWidth = Math.max(1, CARD_W - scaleStoreSpacing(ACTUAL_MOBILE ? 14 : 18))
  const cardTagScale = cardTagWidth / STORE_CARD_TAG_SOURCE_WIDTH
  const cardTagHeight = Math.max(1, Math.round(STORE_CARD_TAG_SOURCE_HEIGHT * cardTagScale))
  const selectionGlowFrameWidth = CARD_W + scaleStoreSpacing(ACTUAL_MOBILE ? 8 : 6)
  const selectionGlowFrameHeight = CARD_H + scaleStoreSpacing(ACTUAL_MOBILE ? 10 : 8)
  const selectionGlowWidth = Math.round(selectionGlowFrameWidth * (STORE_CARD_SELECTION_GLOW_SOURCE_WIDTH / 108))
  const selectionGlowHeight = Math.round(selectionGlowFrameHeight * (STORE_CARD_SELECTION_GLOW_SOURCE_HEIGHT / 142))
  const selectionGlowLeft = Math.round((CARD_W - selectionGlowWidth) * 0.5) + (
    weapon.upgradeLevel === 1
      ? scaleStoreOffset(-3)
      : 0
  )
  const selectionGlowTop = Math.round((CARD_H - selectionGlowHeight) * 0.5)
  const owned = isLoadoutWeaponOwned(weapon.id)
  const equipped = isLoadoutWeaponEquipped(weapon.id)
  const unlocked = isPreviousOwned(weapon)
  const canAfford = getPlayerGold() >= weapon.priceGold
  const cardTagLabel = equipped
    ? 'EQUIPPED'
    : (owned
      ? 'EQUIP'
      : (unlocked ? 'BUY' : 'LOCKED'))
  const cardTagLeft = ACTUAL_MOBILE
    ? scaleStoreSpacing(6)
    : Math.round((CARD_W - cardTagWidth) * 0.5) + (
      weapon.upgradeLevel === 1
        ? -2
        : (weapon.upgradeLevel === 3 ? 2 : 0)
    )
  const cardTagTextColor = cardTagLabel === 'BUY'
    ? (canAfford ? C.textGold : C.textBurgundy)
    : (cardTagLabel === 'LOCKED' ? C.textGray : C.textWhite)

  return (
    <UiEntity
      uiTransform={{
        width: CARD_W, height: CARD_H,
        margin: { right: isLast ? 0 : CARD_GAP },
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: { left: scaleStoreSpacing(6), right: scaleStoreSpacing(6) },
        flexShrink: 0,
      }}
      onMouseDown={() => { selectedWeaponId = weapon.id }}
    >
      {isSelected && (
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { top: selectionGlowTop, left: selectionGlowLeft },
            width: selectionGlowWidth,
            height: selectionGlowHeight,
        }}
        uiBackground={{
          ...createShopSpriteBackground(SHOP_UI_SPRITES.cardSelectionGlow)
        }}
      />
      )}

      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 0, left: 0 },
          width: CARD_W,
          height: CARD_H,
        }}
        uiBackground={{
          ...createShopSpriteBackground(STORE_UPGRADE_CARD_SPRITES[weapon.upgradeLevel])
        }}
      />

      {/* Weapon image */}
      <UiEntity
        uiTransform={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
      >
        {imageSrc ? (
          <UiEntity
            uiTransform={{ width: cardImageSize.width, height: cardImageSize.height, margin: { top: -scaleStoreHeight(30) } }}
            uiBackground={{ textureMode: 'stretch', texture: { src: imageSrc } }}
          />
        ) : (
          <Label value={WEAPON_EMOJI[weapon.arenaWeaponType]} fontSize={scaleStoreFont(38)} color={C.textWhite} />
        )}
      </UiEntity>

      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { bottom: scaleStoreSpacing(10), left: cardTagLeft },
          width: cardTagWidth,
          height: cardTagHeight,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        uiBackground={{
          ...createShopSpriteBackground(SHOP_UI_SPRITES.cardTag)
        }}
      >
        <Label
          value={cardTagLabel}
          fontSize={scaleStoreFont(14)}
          color={cardTagTextColor}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: '100%' }}
        />
      </UiEntity>
    </UiEntity>
  )
}

// ─── Weapon Row ───────────────────────────────────────────────────────────────

function WeaponRow({ weaponType, isLast }: { weaponType: ArenaWeaponType; isLast?: boolean }) {
  const { CARD_H, ROW_GAP, ROW_LABEL_W, ROW_LABEL_GAP, ROW_CARD_AREA_W, ROW_CARD_AREA_H } = getStoreMetrics()
  const upgrades = getWeaponUpgrades(weaponType)
  const labelSprite = STORE_WEAPON_LABEL_SPRITES[weaponType]
  return (
    <UiEntity
      uiTransform={{
        flexDirection: 'row', alignItems: 'center',
        width: '100%', margin: { bottom: isLast ? 0 : ROW_GAP },
      }}
    >
      <UiEntity
        uiTransform={{
          width: ROW_LABEL_W, height: CARD_H,
          alignItems: 'center', justifyContent: 'center',
          margin: { left: STORE_WEAPON_LABEL_OFFSET_LEFT, right: ROW_LABEL_GAP },
          flexShrink: 0,
        }}
      >
        <UiEntity
          uiTransform={{
            width: scaleStoreWidth(labelSprite.renderW),
            height: scaleStoreHeight(labelSprite.renderH),
            margin: { top: scaleStoreOffset(labelSprite.offsetTop ?? 0) }
          }}
          uiBackground={{
            ...createShopSpriteBackground(labelSprite.sprite)
          }}
        />
      </UiEntity>

      <UiEntity
        uiTransform={{
          width: ROW_CARD_AREA_W,
          height: ROW_CARD_AREA_H,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-start',
        }}
      >
        {upgrades.map((w, index) =>
          ReactEcs.createElement(UpgradeCard, {
            key: w.id,
            weapon: w,
            isLast: index === upgrades.length - 1
          })
        )}
      </UiEntity>
    </UiEntity>
  )
}

// ─── Stat Row ─────────────────────────────────────────────────────────────────

function StatRow({ label, value, statKey, labelW, barW, valueW }: {
  label: string; value: string; statKey: 'dmg' | 'rate' | 'range'
  labelW: number; barW: number; valueW: number
}) {
  const fillPercent = Math.max(0.08, Math.min(getStatPercent(statKey, value), 1))
  const rowH = scaleStoreHeight(50)
  return (
    <UiEntity
      uiTransform={{
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        width: '100%', height: rowH,
        margin: { bottom: scaleStoreSpacing(6) },
        padding: {
          top: scaleStoreSpacing(6),
          bottom: scaleStoreSpacing(6),
          left: scaleStoreSpacing(10),
          right: scaleStoreSpacing(10)
        },
        borderRadius: 8,
      }}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: scaleStoreHeight(18),
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: { top: scaleStoreOffset(-8), bottom: scaleStoreSpacing(8) }
        }}
      >
        <Label
          value={label}
          fontSize={scaleStoreFont(15)}
          color={C.textGray}
          textAlign="middle-left"
          uiTransform={{ width: '60%', height: '100%', flexShrink: 0 }}
        />
        <Label
          value={value}
          fontSize={scaleStoreFont(15)}
          color={C.textWhite}
          textAlign="middle-right"
          uiTransform={{ width: '40%', height: '100%', flexShrink: 0 }}
        />
      </UiEntity>

      <UiEntity
        uiTransform={{
          width: '100%',
          height: scaleStoreHeight(10),
          borderRadius: 5,
          flexShrink: 0
        }}
        uiBackground={{ color: Color4.create(0.27, 0.35, 0.24, 1) }}
      >
        <UiEntity
          uiTransform={{ width: `${Math.round(fillPercent * 100)}%`, height: '100%', borderRadius: 4 }}
          uiBackground={{ color: Color4.create(0.63, 0.92, 0.32, 1) }}
        />
      </UiEntity>
    </UiEntity>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ weapon, embedded = false }: { weapon: LoadoutWeaponDefinition; embedded?: boolean }) {
  const ACTUAL_MOBILE = isMobile()
  const {
    DETAIL_PANEL_W,
    DETAIL_TITLE_H,
    DETAIL_SUBTITLE_H,
    DETAIL_PANEL_FIT_SCALE,
    STORE_DETAIL_BOX_RENDER_WIDTH,
    STORE_GRID_HEIGHT,
    STAT_LABEL_W,
    STAT_BAR_W,
    STAT_VALUE_W,
    MOBILE
  } = getStoreMetrics()
  const owned = isLoadoutWeaponOwned(weapon.id)
  const equipped = isLoadoutWeaponEquipped(weapon.id)
  const unlocked = isPreviousOwned(weapon)
  const gold = getPlayerGold()
  const canAfford = gold >= weapon.priceGold
  const stats = WEAPON_STATS[weapon.id] ?? { dmg: '-', rate: '-', range: '-' }
  const imageSrc = WEAPON_IMAGE[weapon.id]
  const detailImageMaxSize = scaleStoreImage(embedded ? 106 : (MOBILE ? 84 : 112))
  const detailImageMinSize = scaleStoreImage(embedded ? 92 : (MOBILE ? 74 : 96))
  const detailImageSlotHeight = scaleStoreHeight(embedded ? 96 : (MOBILE ? 100 : 132))
  const detailImageSize = getContainedWeaponImageSize(weapon.id, detailImageMaxSize, detailImageMaxSize)
  const detailTopSectionH = embedded ? '42%' : scaleStoreHeight(MOBILE ? 156 : 188)
  const detailStatsSectionH = embedded ? '30%' : scaleStoreHeight(MOBILE ? 122 : 138)
  const detailButtonsSectionH = embedded ? '28%' : scaleStoreHeight(MOBILE ? 110 : 126)
  const deniedPriceShakeOffset = !owned ? getDeniedPriceShakeOffset(weapon.id) : 0
  const tierColor = getTierColor(weapon.upgradeLevel)
  const showOwnedLabel = owned && (!MOBILE || !equipped)
  const priceLabel = owned ? 'OWNED' : `${weapon.priceGold} G`
  const actionLabel = owned
    ? (equipped ? 'EQUIPPED' : 'EQUIP')
    : (!unlocked ? 'Unlock previous first' : (canAfford ? 'BUY' : 'NOT ENOUGH GOLD'))
  const showBuyButtonSprite = !owned && unlocked && canAfford
  const showUnlockPreviousButtonSprite = !owned && !unlocked
  const showDisabledBuyButtonSprite = !owned && unlocked && !canAfford
  const showEquipActionText = owned && !equipped
  const actionBg = owned
    ? (equipped ? C.btnEquipped : C.btnEquip)
    : (!unlocked ? C.btnLocked : (canAfford ? C.btnBuy : C.btnLocked))
  const actionTextColor = owned
    ? (equipped ? C.textGreen : C.textWhite)
    : (!unlocked || !canAfford ? C.textLocked : C.textWhite)
  const priceBackground = owned
    ? createShopSpriteBackground(SHOP_UI_SPRITES.owned)
    : { color: Color4.create(17 / 255, 44 / 255, 27 / 255, 1) }
  const actionBackground = equipped
    ? createShopSpriteBackground(SHOP_UI_SPRITES.equipped)
    : (owned
      ? createShopSpriteBackground(SHOP_UI_SPRITES.equip)
      : (showBuyButtonSprite
        ? createShopSpriteBackground(SHOP_UI_SPRITES.buy)
        : (showUnlockPreviousButtonSprite
          ? createShopSpriteBackground(SHOP_UI_SPRITES.unlockPrevious)
          : (showDisabledBuyButtonSprite
            ? createShopSpriteBackground(SHOP_UI_SPRITES.buyDisabled)
            : { color: actionBg }))))
  const actionFontSize = scaleStoreFont(
    MOBILE
      ? (owned ? 20 : (!unlocked || !canAfford ? 12 : 20))
      : (owned ? 22 : (!unlocked || !canAfford ? 13 : 22))
  )
  const actionHandler = owned
    ? (equipped ? undefined : () => {
      if (DEBUG_SHOP_UI_ONLY) {
        equipLoadoutWeaponLocally(weapon.id)
        return
      }
      sendEquipLoadoutWeapon(weapon.id)
    })
    : (unlocked && canAfford ? () => {
      if (DEBUG_SHOP_UI_ONLY) {
        buyLoadoutWeaponLocally(weapon.id)
        return
      }
      sendBuyLoadoutWeapon(weapon.id)
    } : (!owned && unlocked && !canAfford ? () => {
      triggerDeniedPriceShake(weapon.id)
    } : undefined))
  const fitDetailWidth = (value: number) => Math.max(1, Math.round(value * DETAIL_PANEL_FIT_SCALE))
  const fitDetailHeight = (value: number) => Math.max(1, Math.round(value * DETAIL_PANEL_FIT_SCALE))
  const detailBadgeMaxWidth = Math.round((embedded ? STORE_DETAIL_BOX_RENDER_WIDTH : DETAIL_PANEL_W) * 0.72)
  const detailActionMaxWidth = Math.round((embedded ? STORE_DETAIL_BOX_RENDER_WIDTH : DETAIL_PANEL_W) * 0.78)
  const ownedBadgeWidth = Math.min(
    detailBadgeMaxWidth,
    Math.round(fitDetailWidth(STORE_OWNED_SOURCE_WIDTH) * (ACTUAL_MOBILE ? 1.10 : STORE_OWNED_RENDER_SCALE))
  )
  const buyPriceBadgeWidth = Math.min(
    detailBadgeMaxWidth,
    Math.round(fitDetailWidth(STORE_CARD_TAG_SOURCE_WIDTH) * (ACTUAL_MOBILE ? 1.02 : 0.9))
  )
  const equippedActionWidth = Math.min(
    detailActionMaxWidth,
    Math.round(fitDetailWidth(STORE_EQUIPPED_SOURCE_WIDTH) * (ACTUAL_MOBILE ? 1.12 : STORE_EQUIPPED_RENDER_SCALE))
  )
  const equipActionWidth = Math.min(
    detailActionMaxWidth,
    Math.round(fitDetailWidth(STORE_EQUIP_SOURCE_WIDTH) * (ACTUAL_MOBILE ? 1.08 : 1))
  )
  const buyActionWidth = Math.min(
    detailActionMaxWidth,
    Math.round(fitDetailWidth(STORE_BUY_SOURCE_WIDTH) * (ACTUAL_MOBILE ? 1.10 : 1))
  )
  const buyDisabledActionWidth = Math.min(
    detailActionMaxWidth,
    Math.round(fitDetailWidth(STORE_BUY_DISABLED_SOURCE_WIDTH) * (ACTUAL_MOBILE ? 1.10 : 1))
  )
  const unlockPreviousActionWidth = Math.min(
    detailActionMaxWidth,
    Math.round(fitDetailWidth(STORE_UNLOCK_PREVIOUS_SOURCE_WIDTH) * (ACTUAL_MOBILE ? 1.24 : 1))
  )

  return (
    <UiEntity
      uiTransform={{
        ...(embedded
          ? { width: '100%', height: '100%' }
          : (MOBILE ? { flex: 1 } : { width: DETAIL_PANEL_W, height: STORE_GRID_HEIGHT })),
        maxWidth: '100%', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-start',
        padding: embedded
          ? { top: scaleStoreSpacing(18), bottom: scaleStoreSpacing(16), left: scaleStoreSpacing(10), right: scaleStoreSpacing(10) }
          : { top: scaleStoreSpacing(10), bottom: scaleStoreSpacing(12), left: scaleStoreSpacing(12), right: scaleStoreSpacing(12) },
        borderRadius: embedded ? 0 : 10,
        flexShrink: 1,
      }}
      uiBackground={embedded ? undefined : { color: C.detailBg }}
    >
      {/* Tier accent bar */}
      {!embedded && (
        <UiEntity
          uiTransform={{ width: '100%', height: 3, borderRadius: 2, margin: { bottom: MOBILE ? scaleStoreSpacing(8) : 0 } }}
          uiBackground={{ color: tierColor }}
        />
      )}

      <UiEntity
        uiTransform={{
          width: '100%',
          height: detailTopSectionH,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          flexShrink: 0,
        }}
      >
        <UiEntity uiTransform={{ width: '100%', height: DETAIL_TITLE_H, alignItems: 'center', justifyContent: 'center', margin: { bottom: scaleStoreSpacing(2) } }}>
          <Label
            value={getShopWeaponLabel(weapon)}
            fontSize={scaleStoreFont(embedded ? 20 : 22)}
            color={C.textWhite}
            textAlign="middle-center"
            textWrap="wrap"
            uiTransform={{ width: '100%', padding: { left: scaleStoreSpacing(4), right: scaleStoreSpacing(4) } }}
          />
        </UiEntity>

        <UiEntity
          uiTransform={{
            width: '100%',
            height: detailImageSlotHeight,
            alignItems: 'center',
            justifyContent: 'center',
            margin: { top: scaleStoreSpacing(8) },
            flexShrink: 0,
          }}
        >
          {imageSrc ? (
            <UiEntity
              uiTransform={{
                width: Math.min(detailImageMaxSize, Math.max(detailImageMinSize, detailImageSize.width)),
                height: Math.min(detailImageMaxSize, Math.max(detailImageMinSize, detailImageSize.height)),
                flexShrink: 0,
              }}
              uiBackground={{ textureMode: 'stretch', texture: { src: imageSrc } }}
            />
          ) : (
            <Label
              value={WEAPON_EMOJI[weapon.arenaWeaponType]}
              fontSize={scaleStoreFont(MOBILE ? 36 : 50)}
              color={C.textWhite}
            />
          )}
        </UiEntity>
      </UiEntity>

      <UiEntity
        uiTransform={{
          flexDirection: 'column',
          width: '88%',
          height: detailStatsSectionH,
          justifyContent: 'flex-start',
          flexShrink: 0,
          margin: { top: scaleStoreOffset(-10), bottom: embedded ? 0 : scaleStoreSpacing(8) }
        }}
      >
        <StatRow label="Damage"    value={stats.dmg}   statKey="dmg"   labelW={STAT_LABEL_W} barW={STAT_BAR_W} valueW={STAT_VALUE_W} />
        <StatRow label="Fire Rate" value={stats.rate}  statKey="rate"  labelW={STAT_LABEL_W} barW={STAT_BAR_W} valueW={STAT_VALUE_W} />
        <StatRow label="Range"     value={stats.range} statKey="range" labelW={STAT_LABEL_W} barW={STAT_BAR_W} valueW={STAT_VALUE_W} />
      </UiEntity>

      <UiEntity
        uiTransform={{
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: ACTUAL_MOBILE ? 'flex-end' : 'flex-start',
          width: '100%',
          height: detailButtonsSectionH,
          flexShrink: 0,
          margin: { top: ACTUAL_MOBILE ? scaleStoreSpacing(18) : scaleStoreSpacing(6) },
          padding: ACTUAL_MOBILE ? { bottom: scaleStoreSpacing(14) } : undefined
        }}
      >
        {showOwnedLabel || !owned ? (
          <UiEntity
            key={`price-badge-${weapon.id}`}
            uiTransform={{
              width: owned
                ? ownedBadgeWidth
                : buyPriceBadgeWidth,
              height: owned
                ? Math.round(fitDetailHeight(STORE_OWNED_SOURCE_HEIGHT + 10) * (ACTUAL_MOBILE ? 0.92 : STORE_OWNED_RENDER_SCALE))
                : Math.round(fitDetailHeight(STORE_CARD_TAG_SOURCE_HEIGHT) * (ACTUAL_MOBILE ? 0.92 : 0.9)),
              alignItems: 'center',
              justifyContent: 'center',
              margin: { left: deniedPriceShakeOffset, bottom: ACTUAL_MOBILE ? scaleStoreSpacing(2) : scaleStoreSpacing(4) },
              borderRadius: 8
            }}
            uiBackground={priceBackground}
          >
            {!owned && (
              <UiEntity
                key={`price-inner-${weapon.id}`}
                uiTransform={{
                  flexDirection: 'row',
                  width: '100%',
                  height: '100%',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: { left: scaleStoreSpacing(10), right: scaleStoreSpacing(10) }
                }}
              >
                <Label
                  value={`${weapon.priceGold} G`}
                  fontSize={scaleStoreFont(MOBILE ? 18 : 19)}
                  color={canAfford ? C.textGold : C.textBurgundy}
                  textAlign="middle-center"
                  uiTransform={{ flex: 1, height: '100%', minWidth: 0 }}
                />
              </UiEntity>
            )}
          </UiEntity>
        ) : null}

        <UiEntity
          uiTransform={{
            width: equipped
              ? equippedActionWidth
              : (owned
                ? equipActionWidth
              : (showBuyButtonSprite
                ? buyActionWidth
                : (showDisabledBuyButtonSprite
                  ? buyDisabledActionWidth
                  : (showUnlockPreviousButtonSprite
                    ? unlockPreviousActionWidth
                    : '88%')))),
            height: equipped
              ? Math.round(fitDetailHeight(STORE_EQUIPPED_SOURCE_HEIGHT + 6) * (ACTUAL_MOBILE ? 0.92 : 1))
              : (owned
                ? Math.round(fitDetailHeight(STORE_EQUIP_SOURCE_HEIGHT) * (ACTUAL_MOBILE ? 0.92 : 1))
              : (showBuyButtonSprite
                ? Math.round(fitDetailHeight(STORE_BUY_SOURCE_HEIGHT) * (ACTUAL_MOBILE ? 0.92 : 1))
                : (showDisabledBuyButtonSprite
                  ? Math.round(fitDetailHeight(STORE_BUY_DISABLED_SOURCE_HEIGHT) * (ACTUAL_MOBILE ? 0.92 : 1))
                  : (showUnlockPreviousButtonSprite
                    ? Math.round(fitDetailHeight(STORE_UNLOCK_PREVIOUS_SOURCE_HEIGHT) * (ACTUAL_MOBILE ? 1.14 : 1))
                    : scaleStoreButton(MOBILE ? 40 : 46))))),
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            margin: { top: (showBuyButtonSprite || showUnlockPreviousButtonSprite || showDisabledBuyButtonSprite) ? scaleStoreSpacing(ACTUAL_MOBILE ? 8 : 8) : 0 }
          }}
          uiBackground={actionBackground}
          onMouseDown={actionHandler}
        >
          {showEquipActionText && (
            <Label
              value={actionLabel}
              fontSize={actionFontSize}
              color={actionTextColor}
            />
          )}
          {!showBuyButtonSprite && !showUnlockPreviousButtonSprite && !showDisabledBuyButtonSprite && !owned && !equipped && (
            <Label
              value={actionLabel}
              fontSize={actionFontSize}
              color={actionTextColor}
            />
          )}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// ─── Root Store UI ────────────────────────────────────────────────────────────

export function LobbyStoreUi() {
  if (!storeOpen) return null
  const ACTUAL_MOBILE = isMobile()
  const {
    STORE_PANEL_MAX_W,
    STORE_CONTENT_W,
    LEFT_GRID_W,
    STORE_DETAIL_BOX_RENDER_WIDTH,
    STORE_DETAIL_BOX_RENDER_HEIGHT,
    STORE_DETAIL_BOX_GAP,
    STORE_BODY_MARGIN_TOP,
    STORE_PANEL_HEIGHT,
    STORE_MESSAGE_WIDTH,
    STORE_MESSAGE_HEIGHT,
    STORE_MESSAGE_MARGIN_TOP,
    STORE_MESSAGE_MARGIN_BOTTOM,
    MOBILE
  } = getStoreMetrics()
  const MOBILE_MESSAGE_RENDER_WIDTH = ACTUAL_MOBILE ? Math.round(STORE_MESSAGE_WIDTH * 0.995) : STORE_MESSAGE_WIDTH
  const MOBILE_MESSAGE_RENDER_HEIGHT = ACTUAL_MOBILE ? Math.round(STORE_MESSAGE_HEIGHT * 1.06) : STORE_MESSAGE_HEIGHT
  const selected = LOADOUT_WEAPON_DEFINITIONS.find((w) => w.id === selectedWeaponId) ?? LOADOUT_WEAPON_DEFINITIONS[0]
  const gold = getPlayerGold()

  return (
    <UiEntity
      uiTransform={{
        width: '100%', height: '100%',
        positionType: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
        padding: ACTUAL_MOBILE
          ? { left: '0.5vw', right: '0.5vw', top: '2vh', bottom: '2vh' }
          : { left: '2vw', right: '8vw', top: '4vh', bottom: '4vh' },
        pointerFilter: 'block',
        zIndex: 20,
      }}
    >
      <UiEntity
        uiTransform={{
          flexDirection: 'column',
          width: '100%',
          maxWidth: STORE_PANEL_MAX_W,
          height: STORE_PANEL_HEIGHT,
          padding: {
            top: scaleStoreSpacing(74),
            bottom: scaleStoreSpacing(14),
            left: ACTUAL_MOBILE ? scaleStoreSpacing(2) : scaleStoreSpacing(2),
            right: ACTUAL_MOBILE ? scaleStoreSpacing(2) : scaleStoreSpacing(8)
          },
          borderRadius: 14,
        }}
        uiBackground={{
          ...createShopSpriteBackground(SHOP_UI_SPRITES.panel)
        }}
      >
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: {
              top: ACTUAL_MOBILE ? scaleStoreSpacing(STORE_HEADER_ACTIONS_TOP) + scaleStoreSpacing(10) : scaleStoreSpacing(STORE_HEADER_ACTIONS_TOP),
              right: scaleStoreSpacing(STORE_HEADER_ACTIONS_RIGHT)
            },
            flexDirection: 'row',
            alignItems: 'center',
            zIndex: 2,
          }}
        >
          <UiEntity
            uiTransform={{
              width: ACTUAL_MOBILE ? Math.round(scaleStoreWidth(STORE_GOLD_RENDER_WIDTH) * 1.08) : scaleStoreWidth(STORE_GOLD_RENDER_WIDTH),
              height: ACTUAL_MOBILE ? Math.round(scaleStoreHeight(STORE_GOLD_RENDER_HEIGHT) * 1.08) : scaleStoreHeight(STORE_GOLD_RENDER_HEIGHT),
              margin: { right: scaleStoreSpacing(12) },
            }}
            uiBackground={{
              ...createShopSpriteBackground(SHOP_UI_SPRITES.gold)
            }}
          >
            <UiEntity
              uiTransform={{
                width: '100%',
                height: '100%',
                padding: { left: scaleStoreSpacing(54), right: scaleStoreSpacing(6) }
              }}
            >
              <OutlinedText
                uiTransform={{
                  width: '100%',
                  height: '100%',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                uiText={{
                  value: `${gold} G`,
                  fontSize: scaleStoreFont(ACTUAL_MOBILE ? 18 : 20),
                  color: C.textGold,
                  textAlign: 'middle-center'
                }}
                outlineColor={Color4.Black()}
                outlineScale={1}
                outlineKeyPrefix='shop-gold-badge'
              />
            </UiEntity>
          </UiEntity>

          <UiEntity
            uiTransform={{
              width: ACTUAL_MOBILE ? Math.round(scaleStoreWidth(STORE_CLOSE_RENDER_WIDTH) * 1.08) : scaleStoreWidth(STORE_CLOSE_RENDER_WIDTH),
              height: ACTUAL_MOBILE ? Math.round(scaleStoreHeight(STORE_CLOSE_RENDER_HEIGHT) * 1.08) : scaleStoreHeight(STORE_CLOSE_RENDER_HEIGHT)
            }}
            uiBackground={{
              ...createShopSpriteBackground(SHOP_UI_SPRITES.close)
            }}
            onMouseDown={() => closeLobbyStore()}
          />
        </UiEntity>

        <UiEntity
          uiTransform={{
            flexDirection: 'row',
            flexWrap: 'nowrap',
            justifyContent: 'flex-start',
            alignItems: 'flex-start',
            width: STORE_CONTENT_W,
            maxWidth: '100%',
            alignSelf: 'center',
            margin: {
              top: ACTUAL_MOBILE ? STORE_BODY_MARGIN_TOP + scaleStoreSpacing(20) : STORE_BODY_MARGIN_TOP,
              left: 0,
              right: ACTUAL_MOBILE ? 0 : 0
            },
          }}
        >
          <UiEntity
            uiTransform={{
              flexDirection: 'column',
              width: LEFT_GRID_W,
              maxWidth: '100%',
              margin: { bottom: scaleStoreSpacing(10) },
              flexShrink: 0,
            }}
          >
            {WEAPON_ROWS.map((t, index) =>
              ReactEcs.createElement(WeaponRow, {
                key: t,
                weaponType: t,
                isLast: index === WEAPON_ROWS.length - 1
              })
            )}
          </UiEntity>

          <UiEntity
            uiTransform={{
              width: STORE_DETAIL_BOX_RENDER_WIDTH,
              height: STORE_DETAIL_BOX_RENDER_HEIGHT,
              margin: {
                left: STORE_DETAIL_BOX_GAP,
                right: 0
              },
              flexShrink: 0,
            }}
            uiBackground={{
              ...createShopSpriteBackground(SHOP_UI_SPRITES.detailBox)
            }}
          >
            <DetailPanel weapon={selected} embedded />
          </UiEntity>
        </UiEntity>

        <UiEntity
          uiTransform={{
            width: '100%',
            height: MOBILE_MESSAGE_RENDER_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
            margin: {
              top: ACTUAL_MOBILE ? scaleStoreSpacing(6) : -scaleStoreSpacing(2),
              bottom: STORE_MESSAGE_MARGIN_BOTTOM,
            },
          }}
        >
          <UiEntity
            uiTransform={{
              width: ACTUAL_MOBILE ? STORE_MESSAGE_WIDTH : Math.round(STORE_MESSAGE_WIDTH * 0.92),
              height: ACTUAL_MOBILE ? MOBILE_MESSAGE_RENDER_HEIGHT : Math.round(MOBILE_MESSAGE_RENDER_HEIGHT * 0.92),
              flexShrink: 0,
            }}
            uiBackground={{
              ...createShopSpriteBackground(SHOP_UI_SPRITES.message)
            }}
          />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
