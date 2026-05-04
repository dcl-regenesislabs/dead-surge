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
import { getPlayerGold, isLoadoutWeaponEquipped, isLoadoutWeaponOwned } from './loadoutState'
import { sendBuyLoadoutWeapon, sendEquipLoadoutWeapon, sendRequestLoadoutRefresh } from './multiplayer/lobbyClient'
import { endUiPointerCapture } from './gameplayInput'
import { isMobile } from './ui'

let storeOpen = false
let selectedWeaponId: LoadoutWeaponId = LOADOUT_WEAPON_DEFINITIONS[0].id

export function openLobbyStore(): void {
  storeOpen = true
  selectedWeaponId = LOADOUT_WEAPON_DEFINITIONS[0].id
  sendRequestLoadoutRefresh()
}

export function closeLobbyStore(): void {
  storeOpen = false
  endUiPointerCapture()
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

function getStoreScaleProfile() {
  const effectiveViewport = getEffectiveCanvasViewport()
  if (!effectiveViewport) {
    return { width: 1, height: 1, spacing: 1, font: 1, image: 1, button: 1 }
  }
  const shortestEffectiveSide = Math.min(effectiveViewport.width, effectiveViewport.height)
  if (shortestEffectiveSide <= 460) {
    return { width: 1.10, height: 1.26, spacing: 1.12, font: 1.52, image: 1.40, button: 1.22 }
  }
  if (shortestEffectiveSide <= 540) {
    return { width: 1.08, height: 1.20, spacing: 1.10, font: 1.40, image: 1.30, button: 1.18 }
  }
  if (shortestEffectiveSide <= 720) {
    return { width: 1.04, height: 1.10, spacing: 1.06, font: 1.18, image: 1.14, button: 1.10 }
  }
  return { width: 1, height: 1, spacing: 1, font: 1, image: 1, button: 1 }
}

function scaleStoreUiValue(value: number, scale: number = 1): number {
  return scale === 1 ? value : Math.max(1, Math.round(value * scale))
}
function scaleStoreWidth(value: number): number { return scaleStoreUiValue(value, getStoreScaleProfile().width) }
function scaleStoreHeight(value: number): number { return scaleStoreUiValue(value, getStoreScaleProfile().height) }
function scaleStoreSpacing(value: number): number { return scaleStoreUiValue(value, getStoreScaleProfile().spacing) }
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
const STORE_BACKGROUND_ASPECT = 722 / 1137

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

// ─── Metrics ─────────────────────────────────────────────────────────────────

function getStoreMetrics() {
  const cardW = scaleStoreWidth(152)
  const cardH = scaleStoreHeight(146)
  const cardGap = scaleStoreSpacing(8)
  const cardImageBox = scaleStoreImage(72)
  const cardImageAreaH = scaleStoreHeight(76)
  const cardNameAreaH = scaleStoreHeight(28)
  const rowGap = scaleStoreSpacing(8)
  const mobile = isMobile()
  const rowLabelW = mobile ? 0 : scaleStoreWidth(118)
  const rowLabelGap = mobile ? 0 : scaleStoreSpacing(12)
  const detailPanelW = mobile ? scaleStoreWidth(320) : scaleStoreWidth(330)

  // Stat row widths derived from panel so they always add up (panel - 24 panel pad - 26 row pad - 16 gaps)
  const statNoGap = detailPanelW - 24 - 26 - 16
  const statLabelW = Math.round(statNoGap * 0.379)
  const statValueW = Math.round(statNoGap * 0.265)
  const statBarW   = statNoGap - statLabelW - statValueW

  const detailTitleH = scaleStoreHeight(36)
  const detailSubtitleH = scaleStoreHeight(24)
  const storePanelMaxW = 1080
  const storeBodyGap = scaleStoreSpacing(16)
  const gridColumns = 3
  const leftGridW = rowLabelW + rowLabelGap + cardW * gridColumns + cardGap * (gridColumns - 1)
  const storeContentW = leftGridW + storeBodyGap + detailPanelW
  const storeGridHeight = cardH * WEAPON_ROWS.length + rowGap * (WEAPON_ROWS.length - 1)
  const storeHeaderHeight = scaleStoreButton(34) + scaleStoreSpacing(20)
  const storeSeparatorHeight = 2 + scaleStoreSpacing(12)
  const storePanelVerticalPadding = scaleStoreSpacing(72)
  const storeBodyHeight = storeGridHeight + scaleStoreSpacing(10)
  const storePanelContentH = storeHeaderHeight + scaleStoreSpacing(4) + storeSeparatorHeight + storeBodyHeight + storePanelVerticalPadding
  const storePanelAspectH = Math.round(storePanelMaxW * STORE_BACKGROUND_ASPECT)
  const storePanelHeight = Math.max(storePanelAspectH + scaleStoreHeight(18), storePanelContentH)

  return {
    CARD_W: cardW, CARD_H: cardH, CARD_GAP: cardGap,
    CARD_IMAGE_BOX: cardImageBox, CARD_IMAGE_AREA_H: cardImageAreaH, CARD_NAME_AREA_H: cardNameAreaH,
    ROW_GAP: rowGap, ROW_LABEL_W: rowLabelW, ROW_LABEL_GAP: rowLabelGap,
    DETAIL_PANEL_W: detailPanelW, DETAIL_TITLE_H: detailTitleH, DETAIL_SUBTITLE_H: detailSubtitleH,
    STORE_PANEL_MAX_W: storePanelMaxW, STORE_BODY_GAP: storeBodyGap,
    LEFT_GRID_W: leftGridW, STORE_CONTENT_W: storeContentW, STORE_GRID_HEIGHT: storeGridHeight, STORE_PANEL_HEIGHT: storePanelHeight,
    STAT_LABEL_W: statLabelW, STAT_BAR_W: statBarW, STAT_VALUE_W: statValueW,
    MOBILE: mobile,
  }
}

// ─── Upgrade Card ─────────────────────────────────────────────────────────────

function UpgradeCard({ weapon, isLast }: { weapon: LoadoutWeaponDefinition; isLast?: boolean }) {
  const { CARD_W, CARD_H, CARD_GAP, CARD_IMAGE_BOX, CARD_IMAGE_AREA_H, CARD_NAME_AREA_H } = getStoreMetrics()
  const isSelected = selectedWeaponId === weapon.id
  const owned = isLoadoutWeaponOwned(weapon.id)
  const equipped = isLoadoutWeaponEquipped(weapon.id)
  const stars = UPGRADE_STARS[weapon.upgradeLevel - 1]
  const imageSrc = WEAPON_IMAGE[weapon.id]
  const tierColor = getTierColor(weapon.upgradeLevel)
  const bg = getCardBg(weapon.upgradeLevel, isSelected, owned)

  return (
    <UiEntity
      uiTransform={{
        width: CARD_W, height: CARD_H,
        margin: { right: isLast ? 0 : CARD_GAP },
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        padding: scaleStoreSpacing(6),
        borderRadius: 10,
        flexShrink: 0,
      }}
      uiBackground={{ color: bg }}
      onMouseDown={() => { selectedWeaponId = weapon.id }}
    >
      {/* Tier accent strip */}
      <UiEntity
        uiTransform={{ width: '75%', height: 3, borderRadius: 2, margin: { bottom: scaleStoreSpacing(4) } }}
        uiBackground={{ color: owned ? C.textGreen : tierColor }}
      />

      {/* Weapon image */}
      <UiEntity
        uiTransform={{ width: '100%', height: CARD_IMAGE_AREA_H, alignItems: 'center', justifyContent: 'center' }}
      >
        {imageSrc ? (
          <UiEntity
            uiTransform={{ width: CARD_IMAGE_BOX, height: CARD_IMAGE_BOX }}
            uiBackground={{ textureMode: 'stretch', texture: { src: imageSrc } }}
          />
        ) : (
          <Label value={WEAPON_EMOJI[weapon.arenaWeaponType]} fontSize={scaleStoreFont(38)} color={C.textWhite} />
        )}
      </UiEntity>

      <Label
        value={stars}
        fontSize={scaleStoreFont(15)}
        color={owned ? C.textGreen : tierColor}
        uiTransform={{ margin: { bottom: scaleStoreSpacing(3) } }}
      />

      <UiEntity
        uiTransform={{
          width: '100%', height: CARD_NAME_AREA_H,
          alignItems: 'center', justifyContent: 'center',
          padding: { left: scaleStoreSpacing(4), right: scaleStoreSpacing(4) },
        }}
      >
        <Label
          value={equipped ? 'EQUIPPED' : getUpgradeTierLabel(weapon)}
          fontSize={scaleStoreFont(12)}
          color={equipped ? C.textGreen : (owned ? C.textGray : tierColor)}
          textAlign="middle-center"
          textWrap="wrap"
          uiTransform={{ width: '100%' }}
        />
      </UiEntity>
    </UiEntity>
  )
}

// ─── Weapon Row ───────────────────────────────────────────────────────────────

function WeaponRow({ weaponType, isLast }: { weaponType: ArenaWeaponType; isLast?: boolean }) {
  const { CARD_H, ROW_GAP, ROW_LABEL_W, ROW_LABEL_GAP } = getStoreMetrics()
  const upgrades = getWeaponUpgrades(weaponType)
  const mobile = isMobile()
  return (
    <UiEntity
      uiTransform={{
        flexDirection: 'row', alignItems: 'center',
        width: '100%', margin: { bottom: isLast ? 0 : ROW_GAP },
      }}
    >
      {!mobile && (
        <UiEntity
          uiTransform={{
            width: ROW_LABEL_W, height: CARD_H,
            alignItems: 'center', justifyContent: 'center',
            margin: { right: ROW_LABEL_GAP },
            borderRadius: 8, flexShrink: 0,
          }}
          uiBackground={{ color: C.rowLabel }}
        >
          <Label
            value={WEAPON_ROW_LABEL[weaponType]}
            fontSize={scaleStoreFont(weaponType === 'gun' ? 18 : 15)}
            color={C.rowLabelText}
            textAlign="middle-center"
            textWrap="wrap"
            uiTransform={{ width: '100%', padding: { left: scaleStoreSpacing(6), right: scaleStoreSpacing(6) } }}
          />
        </UiEntity>
      )}

      {upgrades.map((w, index) =>
        ReactEcs.createElement(UpgradeCard, {
          key: w.id,
          weapon: w,
          isLast: index === upgrades.length - 1
        })
      )}
    </UiEntity>
  )
}

// ─── Stat Row ─────────────────────────────────────────────────────────────────

function StatRow({ label, value, statKey, labelW, barW, valueW }: {
  label: string; value: string; statKey: 'dmg' | 'rate' | 'range'
  labelW: number; barW: number; valueW: number
}) {
  const fillW = Math.max(4, Math.round(Math.min(getStatPercent(statKey, value), 1) * barW))
  const rowH = scaleStoreHeight(38)
  return (
    <UiEntity
      uiTransform={{
        flexDirection: 'row', alignItems: 'center',
        width: '100%', height: rowH,
        margin: { bottom: scaleStoreSpacing(6) },
        padding: { left: scaleStoreSpacing(10), right: scaleStoreSpacing(16) },
        borderRadius: 6,
      }}
      uiBackground={{ color: C.statRowA }}
    >
      <Label value={label} fontSize={scaleStoreFont(16)} color={C.textGray}
        textAlign="middle-left"
        uiTransform={{ width: labelW, height: rowH, flexShrink: 0 }} />
      <UiEntity
        uiTransform={{ width: barW, height: scaleStoreHeight(8), borderRadius: 4, margin: { left: scaleStoreSpacing(8), right: scaleStoreSpacing(8) }, flexShrink: 0 }}
        uiBackground={{ color: C.statBarBg }}
      >
        <UiEntity
          uiTransform={{ width: fillW, height: '100%', borderRadius: 4 }}
          uiBackground={{ color: C.statBarFg }}
        />
      </UiEntity>
      <Label value={value} fontSize={scaleStoreFont(16)} color={C.textWhite}
        textAlign="middle-right"
        uiTransform={{ width: valueW, height: rowH, flexShrink: 0 }} />
    </UiEntity>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ weapon }: { weapon: LoadoutWeaponDefinition }) {
  const { DETAIL_PANEL_W, DETAIL_TITLE_H, DETAIL_SUBTITLE_H, STORE_GRID_HEIGHT, STAT_LABEL_W, STAT_BAR_W, STAT_VALUE_W, MOBILE } = getStoreMetrics()
  const owned = isLoadoutWeaponOwned(weapon.id)
  const equipped = isLoadoutWeaponEquipped(weapon.id)
  const unlocked = isPreviousOwned(weapon)
  const gold = getPlayerGold()
  const canAfford = gold >= weapon.priceGold
  const stats = WEAPON_STATS[weapon.id] ?? { dmg: '-', rate: '-', range: '-' }
  const stars = UPGRADE_STARS[weapon.upgradeLevel - 1]
  const imageSrc = WEAPON_IMAGE[weapon.id]
  const tierColor = getTierColor(weapon.upgradeLevel)
  const showOwnedLabel = owned && (!MOBILE || !equipped)
  const priceLabel = owned ? 'OWNED' : `${weapon.priceGold} G`
  const actionLabel = owned
    ? (equipped ? 'EQUIPPED' : 'EQUIP')
    : (!unlocked ? 'Unlock previous first' : (canAfford ? 'BUY' : 'NOT ENOUGH GOLD'))
  const actionBg = owned
    ? (equipped ? C.btnEquipped : C.btnEquip)
    : (!unlocked ? C.btnLocked : (canAfford ? C.btnBuy : C.btnLocked))
  const actionTextColor = owned
    ? (equipped ? C.textGreen : C.textWhite)
    : (!unlocked || !canAfford ? C.textLocked : C.textWhite)
  const actionFontSize = scaleStoreFont(
    MOBILE
      ? (owned ? 20 : (!unlocked || !canAfford ? 12 : 20))
      : (owned ? 22 : (!unlocked || !canAfford ? 13 : 22))
  )
  const actionHandler = owned
    ? (equipped ? undefined : () => sendEquipLoadoutWeapon(weapon.id))
    : (unlocked && canAfford ? () => sendBuyLoadoutWeapon(weapon.id) : undefined)

  return (
    <UiEntity
      uiTransform={{
        ...(MOBILE ? { flex: 1 } : { width: DETAIL_PANEL_W }),
        height: STORE_GRID_HEIGHT,
        maxWidth: '100%', flexDirection: 'column',
        alignItems: 'center', justifyContent: MOBILE ? 'flex-start' : 'space-between',
        padding: scaleStoreSpacing(12),
        borderRadius: 10,
        margin: { bottom: scaleStoreSpacing(6) },
        flexShrink: 1,
      }}
      uiBackground={{ color: C.detailBg }}
    >
      {/* Tier accent bar */}
      <UiEntity
        uiTransform={{ width: '100%', height: 3, borderRadius: 2, margin: { bottom: MOBILE ? scaleStoreSpacing(8) : 0 } }}
        uiBackground={{ color: tierColor }}
      />

      {/* Title */}
      <UiEntity uiTransform={{ width: '100%', height: DETAIL_TITLE_H, alignItems: 'center', justifyContent: 'center', margin: { bottom: MOBILE ? scaleStoreSpacing(4) : 0 } }}>
        <Label
          value={getShopWeaponLabel(weapon)}
          fontSize={scaleStoreFont(24)}
          color={C.textWhite}
          textAlign="middle-center"
          textWrap="wrap"
          uiTransform={{ width: '100%', padding: { left: scaleStoreSpacing(4), right: scaleStoreSpacing(4) } }}
        />
      </UiEntity>

      {/* Subtitle — desktop only */}
      {!MOBILE && (
        <UiEntity uiTransform={{ width: '100%', height: DETAIL_SUBTITLE_H, alignItems: 'center', justifyContent: 'center' }}>
          <Label
            value={weapon.previewLabel}
            fontSize={scaleStoreFont(14)}
            color={C.textGray}
            textAlign="middle-center"
            textWrap="wrap"
            uiTransform={{ width: '100%', padding: { left: scaleStoreSpacing(4), right: scaleStoreSpacing(4) } }}
          />
        </UiEntity>
      )}

      {/* Weapon image */}
      {imageSrc ? (
        <UiEntity
          uiTransform={{ width: scaleStoreImage(MOBILE ? 72 : 96), height: scaleStoreImage(MOBILE ? 72 : 96), margin: { bottom: MOBILE ? scaleStoreSpacing(4) : 0 } }}
          uiBackground={{ textureMode: 'stretch', texture: { src: imageSrc } }}
        />
      ) : (
        <Label
          value={WEAPON_EMOJI[weapon.arenaWeaponType]}
          fontSize={scaleStoreFont(MOBILE ? 36 : 50)}
          color={C.textWhite}
        />
      )}

      {/* Stars */}
      <Label
        value={stars}
        fontSize={scaleStoreFont(22)}
        color={owned ? C.textGreen : tierColor}
        uiTransform={{ margin: { bottom: MOBILE ? scaleStoreSpacing(6) : 0 } }}
      />

      {/* Stats */}
      <UiEntity uiTransform={{ flexDirection: 'column', width: '100%', margin: { bottom: MOBILE ? scaleStoreSpacing(8) : 0 } }}>
        <StatRow label="Damage"    value={stats.dmg}   statKey="dmg"   labelW={STAT_LABEL_W} barW={STAT_BAR_W} valueW={STAT_VALUE_W} />
        <StatRow label="Fire Rate" value={stats.rate}  statKey="rate"  labelW={STAT_LABEL_W} barW={STAT_BAR_W} valueW={STAT_VALUE_W} />
        <StatRow label="Range"     value={stats.range} statKey="range" labelW={STAT_LABEL_W} barW={STAT_BAR_W} valueW={STAT_VALUE_W} />
      </UiEntity>

      {/* Bottom: price + action */}
      <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        {showOwnedLabel || !owned ? (
          <UiEntity
            key={`price-${weapon.id}-${owned ? 'owned' : 'price'}-${equipped ? 'equipped' : 'idle'}`}
            uiTransform={{ flexDirection: 'row', alignItems: 'center', margin: { bottom: scaleStoreSpacing(8) } }}
          >
            <Label
              value={priceLabel}
              fontSize={scaleStoreFont(MOBILE ? 18 : 20)}
              color={owned ? C.textGreen : C.textGold}
            />
          </UiEntity>
        ) : null}

        <UiEntity
          key={`action-${weapon.id}-${owned ? 'owned' : 'shop'}-${equipped ? 'equipped' : 'idle'}-${unlocked ? 'unlocked' : 'locked'}-${canAfford ? 'can' : 'cant'}`}
          uiTransform={{ width: '100%', height: scaleStoreButton(MOBILE ? 36 : 40), borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}
          uiBackground={{ color: actionBg }}
          onMouseDown={actionHandler}
        >
          <Label
            value={actionLabel}
            fontSize={actionFontSize}
            color={actionTextColor}
          />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// ─── Root Store UI ────────────────────────────────────────────────────────────

export function LobbyStoreUi() {
  if (!storeOpen) return null
  const { STORE_PANEL_MAX_W, STORE_CONTENT_W, LEFT_GRID_W, STORE_BODY_GAP, STORE_PANEL_HEIGHT, MOBILE } = getStoreMetrics()
  const selected = LOADOUT_WEAPON_DEFINITIONS.find((w) => w.id === selectedWeaponId) ?? LOADOUT_WEAPON_DEFINITIONS[0]
  const gold = getPlayerGold()

  return (
    <UiEntity
      uiTransform={{
        width: '100%', height: '100%',
        positionType: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
        padding: { left: '2vw', right: '8vw', top: '4vh', bottom: '4vh' },
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
          padding: { top: scaleStoreSpacing(44), bottom: scaleStoreSpacing(28), left: scaleStoreSpacing(2), right: scaleStoreSpacing(30) },
          borderRadius: 14,
        }}
        uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/background.png' } }}
      >
        {/* Header */}
        <UiEntity
          uiTransform={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            maxWidth: STORE_CONTENT_W,
            alignSelf: 'center',
            padding: { left: scaleStoreSpacing(14), right: scaleStoreSpacing(14), top: scaleStoreSpacing(10), bottom: scaleStoreSpacing(10) },
            borderRadius: 10,
            margin: { bottom: scaleStoreSpacing(4) },
          }}
          uiBackground={{ color: C.headerBg }}
        >
          <Label value="UPGRADE SHOP" fontSize={scaleStoreFont(28)} color={C.textTitle} />

          <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* Gold badge */}
            <UiEntity
              uiTransform={{
                flexDirection: 'row', alignItems: 'center',
                borderRadius: 8,
                padding: { left: scaleStoreSpacing(12), right: scaleStoreSpacing(12), top: scaleStoreSpacing(5), bottom: scaleStoreSpacing(5) },
                margin: { right: scaleStoreSpacing(12) },
              }}
              uiBackground={{ color: C.goldBadgeBg }}
            >
              <Label value={`${gold} G`} fontSize={scaleStoreFont(17)} color={C.textGold} />
            </UiEntity>

            {/* Close */}
            <UiEntity
              uiTransform={{ width: scaleStoreButton(86), height: scaleStoreButton(34), borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}
              uiBackground={{ color: C.btnClose }}
              onMouseDown={() => closeLobbyStore()}
            >
              <Label value="Close" fontSize={scaleStoreFont(18)} color={C.textWhite} />
            </UiEntity>
          </UiEntity>
        </UiEntity>

        {/* Separator */}
        <UiEntity
          uiTransform={{ width: '100%', maxWidth: STORE_CONTENT_W, alignSelf: 'center', height: 2, margin: { bottom: scaleStoreSpacing(12) } }}
          uiBackground={{ color: C.separator }}
        />

        {/* Body */}
        <UiEntity
          uiTransform={{
            flexDirection: 'row',
            flexWrap: MOBILE ? 'nowrap' : 'wrap',
            justifyContent: 'center',
            alignItems: 'flex-start',
            width: '100%',
            maxWidth: STORE_CONTENT_W,
            alignSelf: 'center',
          }}
        >
          <UiEntity
            uiTransform={{
              flexDirection: 'column',
              width: LEFT_GRID_W,
              maxWidth: '100%',
              margin: { right: STORE_BODY_GAP, bottom: scaleStoreSpacing(10) },
              flexShrink: 1,
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

          <DetailPanel weapon={selected} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
