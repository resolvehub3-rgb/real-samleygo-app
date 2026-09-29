/**
 * Turns raw GPS coordinates into a human-readable Ghana place name.
 *
 * The app must never show "GPS: 5.5299, -0.2255" to a customer — a delivery
 * address and a "Deliver To" pill need words a person recognises. This module
 * resolves a fix into something like "East Legon, Accra" using two layers:
 *
 *   1. OpenStreetMap Nominatim (accurate down to the neighbourhood), with a
 *      request timeout, an in-flight de-dupe and a small coordinate cache so a
 *      live position watch never hammers the service.
 *   2. A bundled list of Ghanaian localities as an offline fallback, so a
 *      blocked/offline network still yields a real place name instead of
 *      coordinates — and never an exception.
 *
 * Every failure path resolves to `null`; nothing in here throws.
 */

export interface PlaceLabel {
  /** e.g. "East Legon, Accra" */
  label: string;
  /** 'network' came from Nominatim, 'local' from the bundled fallback */
  source: 'network' | 'local';
}

/** Coarse (~110 m) key used for caching & de-duplicating lookups. */
const coordKey = (lat: number, lng: number): string =>
  `${lat.toFixed(3)},${lng.toFixed(3)}`;

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { value: PlaceLabel | null; at: number }>();
const inflight = new Map<string, Promise<PlaceLabel | null>>();

/** Reasonable request spacing for Nominatim's public (fair-use) endpoint. */
const MIN_REQUEST_GAP_MS = 4000;
let lastRequestAt = 0;

const isValidCoord = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180 &&
  // Null Island: a GPS that has not really locked yet
  !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01);

/**
 * Coarse offline gazetteer: enough coverage to name any fix in Ghana without
 * a network round-trip. Coordinates are the settlement centre.
 */
const GHANA_PLACES: Array<{ name: string; lat: number; lng: number }> = [
  // Greater Accra — Accra & Tema metro
  { name: 'East Legon, Accra', lat: 5.6355, lng: -0.1552 },
  { name: 'West Legon, Accra', lat: 5.6486, lng: -0.2196 },
  { name: 'Legon, Accra', lat: 5.6507, lng: -0.1871 },
  { name: 'Osu, Accra', lat: 5.5566, lng: -0.1827 },
  { name: 'Airport Residential Area, Accra', lat: 5.6058, lng: -0.1748 },
  { name: 'Kotoka, Accra', lat: 5.6051, lng: -0.1706 },
  { name: 'Cantonments, Accra', lat: 5.5484, lng: -0.1766 },
  { name: 'Labadi, Accra', lat: 5.5732, lng: -0.1517 },
  { name: 'Teshie, Accra', lat: 5.5833, lng: -0.1 },
  { name: 'Nungua, Accra', lat: 5.6, lng: -0.0667 },
  { name: 'Spintex, Accra', lat: 5.6261, lng: -0.1034 },
  { name: 'Sakumono, Accra', lat: 5.6294, lng: -0.0978 },
  { name: 'Tema, Greater Accra', lat: 5.6692, lng: -0.0166 },
  { name: 'Community 1, Tema', lat: 5.6314, lng: -0.0166 },
  { name: 'Ashaiman, Greater Accra', lat: 5.6884, lng: -0.0403 },
  { name: 'Madina, Accra', lat: 5.6684, lng: -0.1665 },
  { name: 'Adenta, Accra', lat: 5.7086, lng: -0.1546 },
  { name: 'Aburi, Eastern Region', lat: 5.8467, lng: -0.1764 },
  { name: 'Haatso, Accra', lat: 5.6748, lng: -0.1924 },
  { name: 'Atomic, Accra', lat: 5.6748, lng: -0.2177 },
  { name: 'Dome, Accra', lat: 5.6531, lng: -0.2367 },
  { name: 'Kwabenya, Accra', lat: 5.6748, lng: -0.2456 },
  { name: 'Ashongman, Accra', lat: 5.6874, lng: -0.2284 },
  { name: 'Achimota, Accra', lat: 5.6188, lng: -0.2319 },
  { name: 'Dzorwulu, Accra', lat: 5.6053, lng: -0.2169 },
  { name: 'Abelemkpe, Accra', lat: 5.6011, lng: -0.2137 },
  { name: 'Dansoman, Accra', lat: 5.5431, lng: -0.3094 },
  { name: 'Mamprobi, Accra', lat: 5.5405, lng: -0.2873 },
  { name: 'Kaneshie, Accra', lat: 5.5654, lng: -0.2406 },
  { name: 'Circle, Accra', lat: 5.5711, lng: -0.2113 },
  { name: 'Adabraka, Accra', lat: 5.5619, lng: -0.2211 },
  { name: 'Ridge, Accra', lat: 5.5556, lng: -0.2216 },
  { name: 'Asylum Down, Accra', lat: 5.5649, lng: -0.2155 },
  { name: 'Nima, Accra', lat: 5.5731, lng: -0.1995 },
  { name: 'Accra Central, Greater Accra', lat: 5.5556, lng: -0.2169 },
  { name: 'Korle Bu, Accra', lat: 5.5444, lng: -0.2343 },
  { name: 'Lapaz, Accra', lat: 5.6064, lng: -0.2487 },
  { name: 'Sowutuom, Accra', lat: 5.6348, lng: -0.2667 },
  { name: 'Taifa, Accra', lat: 5.6253, lng: -0.2484 },
  { name: 'Ofankor, Accra', lat: 5.6264, lng: -0.2646 },
  { name: 'Amasaman, Accra', lat: 5.6764, lng: -0.3018 },
  { name: 'Pokuase, Accra', lat: 5.6736, lng: -0.2848 },
  { name: 'Weija, Greater Accra', lat: 5.5569, lng: -0.3417 },
  { name: 'Tuba, Greater Accra', lat: 5.6, lng: -0.3333 },
  { name: 'Kasoa, Central Region', lat: 5.5344, lng: -0.4166 },
  { name: 'Bortianor, Greater Accra', lat: 5.5667, lng: -0.3667 },
  { name: 'Dodowa, Greater Accra', lat: 5.7667, lng: -0.0167 },
  { name: 'Oyibi, Greater Accra', lat: 5.7167, lng: -0.1 },
  { name: 'Prampram, Greater Accra', lat: 5.7167, lng: -0.1 },
  { name: 'Ningo, Greater Accra', lat: 5.75, lng: -0.1667 },
  { name: 'Akosombo, Eastern Region', lat: 5.7917, lng: -0.0667 },
  { name: 'Nsawam, Eastern Region', lat: 5.8083, lng: -0.35 },
  { name: 'Suhum, Eastern Region', lat: 5.9667, lng: -0.45 },
  { name: 'Koforidua, Eastern Region', lat: 6.09, lng: -0.26 },
  { name: 'Akim Oda, Eastern Region', lat: 5.9267, lng: -0.9867 },
  { name: 'Ho, Volta Region', lat: 6.6111, lng: 0.4714 },
  { name: 'Hohoe, Volta Region', lat: 7.15, lng: 0.4733 },
  { name: 'Kpando, Volta Region', lat: 7.0, lng: 0.2833 },
  { name: 'Aflao, Volta Region', lat: 6.1189, lng: 1.1919 },
  { name: 'Sogakope, Volta Region', lat: 6.0, lng: 0.6 },
  { name: 'Takoradi, Western Region', lat: 4.9014, lng: -1.7592 },
  { name: 'Sekondi, Western Region', lat: 4.9333, lng: -1.7167 },
  { name: 'Effia, Western Region', lat: 4.9167, lng: -1.75 },
  { name: 'Tarkwa, Western Region', lat: 5.3, lng: -1.9833 },
  { name: 'Axim, Western Region', lat: 4.8667, lng: -2.2417 },
  { name: 'Agona Nkwanta, Western Region', lat: 4.9833, lng: -1.95 },
  { name: 'Cape Coast, Central Region', lat: 5.1064, lng: -1.2466 },
  { name: 'Elmina, Central Region', lat: 5.0847, lng: -1.3509 },
  { name: 'Winneba, Central Region', lat: 5.3547, lng: -0.6235 },
  { name: 'Swedru, Central Region', lat: 5.5333, lng: -0.7 },
  { name: 'Mankessim, Central Region', lat: 5.2833, lng: -1.0167 },
  { name: 'Assin Fosu, Central Region', lat: 5.7, lng: -1.2833 },
  { name: 'Dunkwa-on-Offin, Central Region', lat: 5.9667, lng: -1.7833 },
  { name: 'Kumasi, Ashanti Region', lat: 6.6885, lng: -1.6244 },
  { name: 'Adum, Kumasi', lat: 6.6936, lng: -1.6269 },
  { name: 'Asokwa, Kumasi', lat: 6.6667, lng: -1.6 },
  { name: 'Suame, Kumasi', lat: 6.7167, lng: -1.65 },
  { name: 'Tafo, Kumasi', lat: 6.7333, lng: -1.6167 },
  { name: 'Obuasi, Ashanti Region', lat: 6.2, lng: -1.6667 },
  { name: 'Mampong, Ashanti Region', lat: 7.0667, lng: -1.4 },
  { name: 'Ejisu, Ashanti Region', lat: 6.7239, lng: -1.3669 },
  { name: 'Konongo, Ashanti Region', lat: 6.6167, lng: -1.2167 },
  { name: 'Sunyani, Bono Region', lat: 7.3333, lng: -2.3333 },
  { name: 'Techiman, Bono East Region', lat: 7.5833, lng: -1.9333 },
  { name: 'Kintampo, Bono East Region', lat: 8.05, lng: -2.3 },
  { name: 'Goaso, Ahafo Region', lat: 6.9833, lng: -2.5167 },
  { name: 'Bechem, Ahafo Region', lat: 7.0, lng: -2.0 },
  { name: 'Tamale, Northern Region', lat: 9.4034, lng: -0.8393 },
  { name: 'Savelugu, Northern Region', lat: 9.6333, lng: -0.9 },
  { name: 'Tolon, Northern Region', lat: 9.4333, lng: -0.9667 },
  { name: 'Salaga, Savannah Region', lat: 8.7, lng: -0.5167 },
  { name: 'Damongo, Savannah Region', lat: 9.0833, lng: -1.6833 },
  { name: 'Bolgatanga, Upper East Region', lat: 10.7833, lng: -0.85 },
  { name: 'Navrongo, Upper East Region', lat: 10.9667, lng: -1.1167 },
  { name: 'Bawku, Upper East Region', lat: 11.05, lng: -0.25 },
  { name: 'Wa, Upper West Region', lat: 10.0667, lng: -2.5 },
  { name: 'Lawra, Upper West Region', lat: 10.3167, lng: -2.8 },
  { name: 'Yendi, Northern Region', lat: 9.45, lng: -0.0167 },
  { name: 'Buipe, Savannah Region', lat: 9.1, lng: -1.15 },
];

const distanceKm = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * Nearest bundled locality, or null when nothing is within `maxKm`.
 * Used as the instant + offline label so coordinates never have to be shown.
 */
export function nearestLocalPlace(lat: number, lng: number, maxKm = 25): PlaceLabel | null {
  if (!isValidCoord(lat, lng)) return null;

  let best: { name: string; km: number } | null = null;
  for (const place of GHANA_PLACES) {
    const km = distanceKm(lat, lng, place.lat, place.lng);
    if (!best || km < best.km) best = { name: place.name, km };
  }
  if (!best || best.km > maxKm) return null;
  return { label: best.name, source: 'local' };
}

interface NominatimAddress {
  neighbourhood?: string;
  quarter?: string;
  suburb?: string;
  city_district?: string;
  borough?: string;
  village?: string;
  hamlet?: string;
  town?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
}

/** Picks the most specific meaningful parts of a Nominatim address. */
const buildLabel = (address: NominatimAddress): string | null => {
  const locality =
    address.neighbourhood ||
    address.quarter ||
    address.suburb ||
    address.village ||
    address.hamlet ||
    address.city_district ||
    address.borough ||
    address.town ||
    address.city;

  const city = address.city || address.town || address.county || address.state;
  const parts: string[] = [];

  if (locality) parts.push(locality);
  if (city && city.toLowerCase() !== (locality || '').toLowerCase()) parts.push(city);
  if (parts.length === 0 && address.state) parts.push(address.state);
  if (parts.length === 0 && address.country) parts.push(address.country);

  return parts.length > 0 ? parts.join(', ') : null;
};

const fetchPlaceLabel = async (lat: number, lng: number): Promise<PlaceLabel | null> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}` +
      `&zoom=16&addressdetails=1&accept-language=en`;

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { address?: NominatimAddress } | null;
    const label = data?.address ? buildLabel(data.address) : null;
    return label ? { label, source: 'network' } : null;
  } catch {
    // Offline, blocked, timed out, malformed — callers fall back locally.
    return null;
  } finally {
    window.clearTimeout(timer);
  }
};

/**
 * Resolves a GPS fix to a friendly place name. Never rejects and never
 * returns raw coordinates: Nominatim first, bundled gazetteer second,
 * `null` only when neither can name the position.
 */
export function resolvePlaceLabel(lat: number, lng: number): Promise<PlaceLabel | null> {
  if (!isValidCoord(lat, lng)) return Promise.resolve(null);

  const key = coordKey(lat, lng);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Promise.resolve(cached.value);
  }

  const running = inflight.get(key);
  if (running) return running;

  const local = nearestLocalPlace(lat, lng);

  const task = (async (): Promise<PlaceLabel | null> => {
    // Keep the public Nominatim endpoint happy: space successive requests out.
    const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();

    const fromNetwork = await fetchPlaceLabel(lat, lng);
    const value = fromNetwork ?? local;
    cache.set(key, { value, at: Date.now() });
    return value;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, task);
  return task;
}

/** Drops cached place names (used when a session changes). */
export function clearPlaceLabelCache(): void {
  cache.clear();
}
