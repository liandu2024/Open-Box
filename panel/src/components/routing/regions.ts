// Curated region list for RoutingRegionCard's region-defaults picker.
//
// This is intentionally a short, known-good list rather than a free-text field or every
// ISO region code: each `code` is sent verbatim to `GET /api/openbox/profile/defaults?region=`,
// which (for anything other than CN) turns it straight into ruleset tags
// `geosite-{code.toLowerCase()}` / `geoip-{code.toLowerCase()}` (see profile.mjs). Those tags
// only resolve to something real at deploy time if a matching ruleset file actually exists, so
// offering an arbitrary region here could silently produce a routing rule that never matches
// anything. `OTHER` is handled specially by the card (see RoutingRegionCard.vue): it still
// fetches non-CN defaults for the DNS/fallback shape, but the direct-ruleset tags are cleared
// before saving instead of sending a bogus `geosite-other`.
export const OTHER_REGION_CODE = 'OTHER'

export interface RegionOption {
  code: string
  labelKey: string
}

export const REGION_OPTIONS: RegionOption[] = [
  { code: 'CN', labelKey: 'routingRegionOptionCn' },
  { code: 'HK', labelKey: 'routingRegionOptionHk' },
  { code: 'TW', labelKey: 'routingRegionOptionTw' },
  { code: 'JP', labelKey: 'routingRegionOptionJp' },
  { code: 'KR', labelKey: 'routingRegionOptionKr' },
  { code: 'SG', labelKey: 'routingRegionOptionSg' },
  { code: 'US', labelKey: 'routingRegionOptionUs' },
  { code: 'GB', labelKey: 'routingRegionOptionGb' },
  { code: 'DE', labelKey: 'routingRegionOptionDe' },
  { code: OTHER_REGION_CODE, labelKey: 'routingRegionOptionOther' },
]

export const findRegionOption = (code: string | undefined) =>
  REGION_OPTIONS.find((option) => option.code === (code || '').toUpperCase())

// Best-effort guess from the browser locale (e.g. "zh-CN" -> CN, "ja-JP" -> JP) so the select
// starts somewhere reasonable instead of on an arbitrary first item. Falls back to CN, since
// that's also the backend's own default region.
export const guessRegionFromLocale = (locale: string): string => {
  const match = /-([A-Za-z]{2})$/.exec(locale || '')
  const code = match?.[1]?.toUpperCase()
  return code && findRegionOption(code) ? code : 'CN'
}
