const POSTHOG_KEY  = 'phc_DffbVvzph4Ga5QakNtCAF4WorVfNWAKARbASaSLNkU6u'
const POSTHOG_HOST = 'eu.i.posthog.com'
const GAME_ID      = 'deadsurge'

let _wallet = ''

export function setAnalyticsWallet(wallet: string): void {
  _wallet = wallet.toLowerCase()
}

function trackEvent(name: string, properties: Record<string, unknown> = {}): void {
  if (!_wallet) return
  fetch(`https://${POSTHOG_HOST}/i/v0/e/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key:     POSTHOG_KEY,
      event:       name,
      distinct_id: _wallet,
      properties:  { ...properties, game_id: GAME_ID },
    }),
  }).catch(() => {})
}

// Session
export function trackSessionStarted(isTutorialCompleted: boolean): void {
  trackEvent('session started', { tutorial_complete: isTutorialCompleted })
}

// Tutorial
export function trackTutorialStarted(): void {
  trackEvent('tutorial started')
}

export function trackTutorialStepReached(step: string): void {
  trackEvent('tutorial step reached', { step })
}

export function trackTutorialCompleted(): void {
  trackEvent('tutorial completed')
}

export function trackTutorialCancelled(lastStep: string): void {
  trackEvent('tutorial cancelled', { last_step: lastStep })
}

// Match
export function trackMatchJoined(): void {
  trackEvent('match joined')
}

export function trackMatchCompleted(wavesSurvived: number, playerCount: number): void {
  trackEvent('match completed', { waves_survived: wavesSurvived, player_count: playerCount })
}

export function trackPlayerDied(waveNumber: number, cause: 'zombie' | 'lava'): void {
  trackEvent('player died', { wave_number: waveNumber, cause })
}

// Progression
export function trackWaveReached(waveNumber: number): void {
  trackEvent('wave reached', { wave_number: waveNumber })
}

export function trackWeaponPurchased(weaponId: string, cost: number): void {
  trackEvent('weapon purchased', { weapon_id: weaponId, cost })
}
