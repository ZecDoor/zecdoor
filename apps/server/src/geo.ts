// Who may use ZecDoor, from Cloudflare's own geolocation of the request (request.cf).
// Nothing about the request is stored.

/**
 * 1Click Terms of Service §9.1 prohibited jurisdictions (research p1-legal-rivals-names §2),
 * which also cover OFAC's comprehensive embargoes. ISO 3166-1 alpha-2.
 */
export const BLOCKED_COUNTRIES = new Set([
  'AF', 'BY', 'CF', 'CU', 'CD', 'GW', 'HT', 'IR', 'LY', 'ML', 'MM', 'NI', 'KP', 'RU', 'SO', 'SS', 'SD', 'SY', 'VE', 'YE', 'ZW',
]);

/**
 * Ukrainian regions named in §9.1: Crimea (43), Sevastopol (40), Donetsk (14), Luhansk (09),
 * Zaporizhzhia (23), Kherson (65). Cloudflare reports ISO 3166-2 subdivision codes; whether it
 * resolves these regions reliably is UNVERIFIED (BUILD-PLAN §2.3).
 */
export const BLOCKED_UA_REGIONS = new Set(['43', '40', '14', '09', '23', '65']);

/** Top-up uses Jupiter, whose terms restrict these countries (decision D6). */
export const TOPUP_BLOCKED = new Set(['US', 'CN', 'SG', 'CI', 'IQ']);

export interface GeoAnswer {
  allowed: boolean;
  topup: boolean;
  country?: string;
}

export function decide(country: string | undefined, regionCode: string | undefined): GeoAnswer {
  const c = country?.toUpperCase();
  // Unknown (XX) or Tor (T1): no country to judge by; the Terms' eligibility clause applies.
  if (!c || c === 'XX' || c === 'T1') return { allowed: true, topup: true };
  const region = regionCode?.replace(/^UA-/i, '');
  const allowed = !BLOCKED_COUNTRIES.has(c) && !(c === 'UA' && region !== undefined && BLOCKED_UA_REGIONS.has(region));
  return { allowed, topup: allowed && !TOPUP_BLOCKED.has(c), country: c };
}
