// HikeRight -- app.js
// Uses: Nominatim (OpenStreetMap) for geocoding  [free, no key]
//       Open-Meteo for weather                   [free, no key]

const input   = document.getElementById('locationInput');
const nearMeBtn = document.getElementById('nearMeBtn');
const btn     = document.getElementById('checkBtn');
const hikeDateInput = document.getElementById('hikeDateInput');
const seasonSelect = document.getElementById('seasonSelect');
const settingLanguage = document.getElementById('settingLanguage');
const settingUnits = document.getElementById('settingUnits');
const settingLocalFocus = document.getElementById('settingLocalFocus');
const settingBatterySaver = document.getElementById('settingBatterySaver');
const settingAnonymousEmergency = document.getElementById('settingAnonymousEmergency');
const settingEmergencyWebhook = document.getElementById('settingEmergencyWebhook');
const settingsSavedNote = document.getElementById('settingsSavedNote');
const settingsShell = document.getElementById('settingsShell');
const settingsToggleBtn = document.getElementById('settingsToggleBtn');
const settingsPopover = document.getElementById('settingsPopover');
const loading = document.getElementById('loadingState');
const errorEl = document.getElementById('errorState');
const errorMsg= document.getElementById('errorMsg');
const result  = document.getElementById('resultCard');
const moreBtn = document.getElementById('moreBtn');
const morePanel = document.getElementById('morePanel');
const plannerOpenBtn = document.getElementById('plannerOpenBtn');
const safetyCenterBtn = document.getElementById('safetyCenterBtn');
const continentSelect = document.getElementById('placeContinent');
const countrySelect = document.getElementById('placeCountry');
const placeCountEl = document.getElementById('placeCount');
const isResultPage = document.body && document.body.dataset.page === 'result';
const isFileOrigin = window.location.protocol === 'file:';
const SETTINGS_KEY = 'hikeRightSettings';
const GEOCODE_CACHE_KEY = 'hikeRightGeocodeCacheV1';
const WEATHER_CACHE_KEY = 'hikeRightWeatherCacheV1';
const OFFLINE_PACKS_KEY = 'hikeRightOfflinePacksV1';
const COVERAGE_TRACK_KEY = 'hikeRightCoverageTrackV1';
const ESSENTIALS_KEY = 'hikeRightTenEssentialsV1';
const GEOCODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WEATHER_TTL_MS = 20 * 60 * 1000;
const userSettings = loadUserSettings();

let activeCoverageWatchId = null;
let batteryListenersBound = false;

// ─── Dynamic Battery Profile ──────────────────────────────────────────────────
// Uses Battery Status API (where supported) to automatically tier GPS accuracy.
// Tiers: full (>40%) → saver (15-40%) → critical (≤15%)
// Falls back to manual batterySaver setting when API is unavailable.
async function getGeoOptions(isContinuous = false) {
  if ('getBattery' in navigator) {
    try {
      const bat = await navigator.getBattery();
      const pct = Math.round(bat.level * 100);
      if (pct <= 15) {
        return { enableHighAccuracy: false, maximumAge: isContinuous ? 600000 : 480000, timeout: 20000 };
      }
      if (pct <= 40) {
        return { enableHighAccuracy: false, maximumAge: isContinuous ? 180000 : 150000, timeout: 14000 };
      }
      return { enableHighAccuracy: true, maximumAge: isContinuous ? 45000 : 30000, timeout: 8000 };
    } catch { /* fall through */ }
  }
  // Manual fallback
  const saver = userSettings.batterySaver === 'on';
  return {
    enableHighAccuracy: !saver,
    maximumAge: saver ? (isContinuous ? 180000 : 300000) : (isContinuous ? 45000 : 60000),
    timeout: saver ? (isContinuous ? 12000 : 14000) : (isContinuous ? 7000 : 10000)
  };
}

const TEN_ESSENTIALS = [
  'Navigation (map, compass, GPS backup)',
  'Headlamp with extra batteries',
  'Sun protection (hat, sunglasses, sunscreen)',
  'First aid kit and meds',
  'Knife or multi-tool',
  'Fire starter (lighter/matches)',
  'Shelter layer (bivy/tarp/emergency blanket)',
  'Extra food',
  'Extra water and treatment',
  'Extra clothes (insulation and rain shell)'
];

document.documentElement.lang = userSettings.language;

let runInFlight = false;

if (btn) btn.addEventListener('click', run);
if (nearMeBtn) nearMeBtn.addEventListener('click', runNearMe);
if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });

document.querySelectorAll('.hike-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (!input) return;
    markSelectedTab(tab);
    input.value = tab.dataset.query;
    run();
  });
});

deferPlaceOrganizerSetup();
setupMoreToggle();
setupHikeDateInput();
setupSettingsPanel();
setupSafetyCenterButton();
registerServiceWorker();

if (seasonSelect) {
  seasonSelect.addEventListener('change', setupSeasonBadges);
  setupSeasonBadges();
}

if (isResultPage) {
  hydrateResultPage();
}

async function run(options = {}) {
  if (runInFlight) return;
  const { navigateToResult = true } = options;
  if (!input) return;
  const query = input.value.trim();
  const selectedSeason = seasonSelect ? seasonSelect.value : 'auto';
  const selectedDate = hikeDateInput ? hikeDateInput.value : '';
  if (!query) return;

  runInFlight = true;
  if (btn) btn.disabled = true;
  setState('loading');
  try {
    const geo = await geocode(query);
    if (!geo) { showError("Couldn't find that location. Try being more specific."); return; }
    const weather = await getWeather(geo.lat, geo.lon);
    if (navigateToResult) {
      const payload = { geo, weather, selectedSeason, selectedDate, createdAt: Date.now() };
      sessionStorage.setItem('hikeRightResult', JSON.stringify(payload));
      window.location.href = 'result.html';
      return;
    }
    renderResult(geo, weather, selectedSeason, selectedDate);
    setState('result');
  } catch (err) {
    console.error(err);
    showError("Something went wrong fetching data. Check your connection.");
  } finally {
    runInFlight = false;
    if (btn) btn.disabled = false;
  }
}

function hydrateResultPage() {
  const raw = sessionStorage.getItem('hikeRightResult');
  if (!raw) {
    showError('No hike result found. Go back and check a location first.');
    return;
  }

  try {
    const payload = JSON.parse(raw);
    if (!payload.geo || !payload.weather) {
      showError('Saved result is incomplete. Go back and run a new check.');
      return;
    }
    renderResult(payload.geo, payload.weather, payload.selectedSeason || 'auto', payload.selectedDate || '');
    setState('result');
  } catch (err) {
    console.error(err);
    showError('Could not load saved result. Go back and run a new check.');
  }
}

function setupSeasonBadges() {
  const season = seasonSelect ? seasonSelect.value : 'auto';
  const label = season === 'auto' ? currentSeasonName() : `${season[0].toUpperCase()}${season.slice(1)}`;

  document.querySelectorAll('.hike-tab').forEach(tab => {
    let seasonBadge = tab.querySelector('.ht-season');
    if (!seasonBadge) {
      seasonBadge = document.createElement('span');
      seasonBadge.className = 'ht-season';
      tab.appendChild(seasonBadge);
    }
    seasonBadge.textContent = label;
  });

  const selectedTab = document.querySelector('.hike-tab.selected');
  if (selectedTab) applyTabRecommendation(selectedTab, label);
}

function setupHikeDateInput() {
  if (!hikeDateInput) return;
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  hikeDateInput.min = iso;
  if (!hikeDateInput.value) hikeDateInput.value = iso;
}

function deferPlaceOrganizerSetup() {
  const runSetup = () => setupPlaceOrganizer();
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(runSetup, { timeout: 250 });
    return;
  }
  window.setTimeout(runSetup, 0);
}

function setupSettingsPanel() {
  if (!settingLanguage || !settingUnits || !settingLocalFocus) return;

  settingLanguage.value = userSettings.language;
  settingUnits.value = userSettings.units;
  settingLocalFocus.value = userSettings.localFocus;
  if (settingBatterySaver) settingBatterySaver.value = userSettings.batterySaver;
  if (settingAnonymousEmergency) settingAnonymousEmergency.value = userSettings.anonymousEmergency;
  if (settingEmergencyWebhook) settingEmergencyWebhook.value = userSettings.emergencyWebhook;

  const applyAndSave = () => {
    userSettings.language = settingLanguage.value;
    userSettings.units = settingUnits.value;
    userSettings.localFocus = settingLocalFocus.value;
    if (settingBatterySaver) userSettings.batterySaver = settingBatterySaver.value;
    if (settingAnonymousEmergency) userSettings.anonymousEmergency = settingAnonymousEmergency.value;
    if (settingEmergencyWebhook) userSettings.emergencyWebhook = settingEmergencyWebhook.value.trim();
    saveUserSettings(userSettings);
    document.documentElement.lang = userSettings.language;

    if (settingsSavedNote) {
      settingsSavedNote.classList.remove('hidden');
      window.setTimeout(() => settingsSavedNote.classList.add('hidden'), 1200);
    }

    if (continentSelect && countrySelect) {
      if (userSettings.localFocus === 'us') {
        if (Array.from(continentSelect.options).some(option => option.value === 'North America')) {
          continentSelect.value = 'North America';
          continentSelect.dispatchEvent(new Event('change'));
        }
        if (Array.from(countrySelect.options).some(option => option.value === 'USA')) {
          countrySelect.value = 'USA';
          countrySelect.dispatchEvent(new Event('change'));
        }
      } else {
        continentSelect.value = 'all';
        continentSelect.dispatchEvent(new Event('change'));
        countrySelect.value = 'all';
        countrySelect.dispatchEvent(new Event('change'));
      }
    }

    if (isResultPage) hydrateResultPage();
  };

  settingLanguage.addEventListener('change', applyAndSave);
  settingUnits.addEventListener('change', applyAndSave);
  settingLocalFocus.addEventListener('change', applyAndSave);
  if (settingBatterySaver) settingBatterySaver.addEventListener('change', applyAndSave);
  if (settingAnonymousEmergency) settingAnonymousEmergency.addEventListener('change', applyAndSave);
  if (settingEmergencyWebhook) settingEmergencyWebhook.addEventListener('change', applyAndSave);

  if (settingsToggleBtn && settingsPopover && settingsShell && settingsToggleBtn.dataset.wired !== '1') {
    settingsToggleBtn.dataset.wired = '1';

    settingsToggleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = settingsPopover.classList.contains('hidden');
      settingsPopover.classList.toggle('hidden', !opening);
      settingsToggleBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    });

    document.addEventListener('click', (event) => {
      if (settingsPopover.classList.contains('hidden')) return;
      if (!settingsShell.contains(event.target)) {
        settingsPopover.classList.add('hidden');
        settingsToggleBtn.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !settingsPopover.classList.contains('hidden')) {
        settingsPopover.classList.add('hidden');
        settingsToggleBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

async function runNearMe() {
  if (!nearMeBtn || !navigator.geolocation || runInFlight) return;

  runInFlight = true;
  nearMeBtn.disabled = true;
  if (btn) btn.disabled = true;
  setState('loading');

  const geoOpts = await getGeoOptions(false);
  navigator.geolocation.getCurrentPosition(async (position) => {
    try {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      const geo = await reverseGeocode(lat, lon);
      const weather = await getWeather(lat, lon);
      const payload = {
        geo,
        weather,
        selectedSeason: seasonSelect ? seasonSelect.value : 'auto',
        selectedDate: hikeDateInput ? hikeDateInput.value : '',
        createdAt: Date.now()
      };
      sessionStorage.setItem('hikeRightResult', JSON.stringify(payload));
      window.location.href = 'result.html';
    } catch (err) {
      console.error(err);
      showError('Could not fetch weather for your current location.');
    } finally {
      runInFlight = false;
      nearMeBtn.disabled = false;
      if (btn) btn.disabled = false;
    }
  }, () => {
    showError('Location permission was denied. You can still type a location manually.');
    runInFlight = false;
    nearMeBtn.disabled = false;
    if (btn) btn.disabled = false;
  }, geoOpts);
}

async function reverseGeocode(lat, lon) {
  try {
    const lang = getLanguageCode();
    const url = `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=${lang}&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Reverse geocode failed');
    const data = await res.json();
    const row = data && Array.isArray(data.results) ? data.results[0] : null;
    if (!row) {
      return { lat, lon, name: 'My Location', sub: `${lat.toFixed(3)}, ${lon.toFixed(3)}` };
    }
    const bits = [row.country, row.admin1].filter(Boolean);
    return {
      lat,
      lon,
      name: row.name || 'My Location',
      sub: bits.join(', ') || `${lat.toFixed(3)}, ${lon.toFixed(3)}`
    };
  } catch {
    return { lat, lon, name: 'My Location', sub: `${lat.toFixed(3)}, ${lon.toFixed(3)}` };
  }
}

function setupMoreToggle() {
  if (!moreBtn || !morePanel || moreBtn.dataset.wired === '1') return;
  moreBtn.dataset.wired = '1';
  moreBtn.addEventListener('click', () => {
    const willOpen = morePanel.classList.contains('hidden');
    morePanel.classList.toggle('hidden', !willOpen);
    moreBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    moreBtn.textContent = willOpen ? 'Less Information' : 'More Information';
  });
}

function setupPlaceOrganizer() {
  const tabs = Array.from(document.querySelectorAll('.hike-tab'));
  if (!tabs.length || !continentSelect || !countrySelect || !placeCountEl) return;

  tabs.forEach(tab => {
    const parsed = parsePlaceMeta(tab);
    tab.dataset.continent = parsed.continent;
    tab.dataset.country = parsed.country;
  });

  tabs.sort((a, b) => {
    const aKey = `${a.dataset.continent}|${a.dataset.country}|${tabName(a)}`;
    const bKey = `${b.dataset.continent}|${b.dataset.country}|${tabName(b)}`;
    return aKey.localeCompare(bKey);
  });

  const grid = tabs[0].parentElement;
  tabs.forEach(tab => grid.appendChild(tab));

  const continents = uniqueSorted(tabs.map(tab => tab.dataset.continent));
  continentSelect.innerHTML = '<option value="all">All Continents</option>';
  continents.forEach(continent => {
    const option = document.createElement('option');
    option.value = continent;
    option.textContent = continent;
    continentSelect.appendChild(option);
  });

  const updateCountryOptions = () => {
    const selectedContinent = continentSelect.value;
    const countries = uniqueSorted(
      tabs
        .filter(tab => selectedContinent === 'all' || tab.dataset.continent === selectedContinent)
        .map(tab => tab.dataset.country)
    );

    countrySelect.innerHTML = '<option value="all">All Countries</option>';
    countries.forEach(country => {
      const option = document.createElement('option');
      option.value = country;
      option.textContent = country;
      countrySelect.appendChild(option);
    });
  };

  const applyPlaceFilter = () => {
    const selectedContinent = continentSelect.value;
    const selectedCountry = countrySelect.value;
    let shown = 0;

    tabs.forEach(tab => {
      const continentOk = selectedContinent === 'all' || tab.dataset.continent === selectedContinent;
      const countryOk = selectedCountry === 'all' || tab.dataset.country === selectedCountry;
      const visible = continentOk && countryOk;
      tab.classList.toggle('hidden-by-place', !visible);
      if (visible) shown += 1;
    });

    const localTag = selectedCountry === 'USA'
      ? ' in the U.S.'
      : selectedContinent === 'North America'
        ? ' in North America'
        : '';
    placeCountEl.textContent = `Showing ${shown} place${shown === 1 ? '' : 's'}${localTag}`;
  };

  continentSelect.addEventListener('change', () => {
    updateCountryOptions();
    applyPlaceFilter();
  });

  countrySelect.addEventListener('change', applyPlaceFilter);

  updateCountryOptions();

  // Default to local-first browsing for US users when enabled in settings.
  if (userSettings.localFocus === 'us' && Array.from(continentSelect.options).some(option => option.value === 'North America')) {
    continentSelect.value = 'North America';
    updateCountryOptions();
  }
  if (userSettings.localFocus === 'us' && Array.from(countrySelect.options).some(option => option.value === 'USA')) {
    countrySelect.value = 'USA';
  }

  applyPlaceFilter();
}

function parsePlaceMeta(tab) {
  const loc = (tab.querySelector('.ht-loc')?.textContent || '').trim();
  const query = (tab.dataset.query || '').trim();
  const placeString = `${loc}, ${query}`;
  const country = inferCountry(placeString);
  const continent = countryToContinent(country);
  return { country, continent };
}

function inferCountry(placeString) {
  const lower = placeString.toLowerCase();
  const checks = [
    ['usa', [' usa', 'u.s.', 'united states', 'washington', 'california', 'oregon', 'alaska', 'hawaii', 'colorado', 'utah', 'arizona', 'wyoming', 'montana', 'florida', 'maine', 'tennessee', 'texas', 'virginia', 'south dakota', 'west virginia', 'new hampshire', 'georgia']],
    ['canada', ['canada', 'alberta', 'british columbia', 'nova scotia', 'ontario', 'newfoundland', 'new brunswick']],
    ['mexico', ['mexico']],
    ['costa rica', ['costa rica']],
    ['chile', ['chile']],
    ['peru', ['peru']],
    ['venezuela', ['venezuela']],
    ['argentina', ['argentina']],
    ['ecuador', ['ecuador']],
    ['brazil', ['brazil']],
    ['bolivia', ['bolivia']],
    ['italy', ['italy']],
    ['france', ['france']],
    ['switzerland', ['switzerland']],
    ['austria', ['austria']],
    ['andorra', ['andorra']],
    ['slovenia', ['slovenia']],
    ['spain', ['spain']],
    ['uk', ['uk', 'wales', 'scotland', 'england']],
    ['norway', ['norway']],
    ['sweden', ['sweden']],
    ['finland', ['finland']],
    ['iceland', ['iceland']],
    ['greece', ['greece']],
    ['bulgaria', ['bulgaria']],
    ['montenegro', ['montenegro']],
    ['poland', ['poland']],
    ['romania', ['romania']],
    ['croatia', ['croatia']],
    ['portugal', ['portugal']],
    ['germany', ['germany', 'bavaria']],
    ['tanzania', ['tanzania']],
    ['kenya', ['kenya']],
    ['uganda', ['uganda']],
    ['ethiopia', ['ethiopia']],
    ['south africa', ['south africa']],
    ['morocco', ['morocco']],
    ['dr congo', ['drc', 'dr congo', 'democratic republic of congo']],
    ['namibia', ['namibia']],
    ['nepal', ['nepal']],
    ['pakistan', ['pakistan']],
    ['india', ['india', 'ladakh', 'uttarakhand', 'himachal']],
    ['bhutan', ['bhutan']],
    ['japan', ['japan']],
    ['south korea', ['south korea']],
    ['taiwan', ['taiwan']],
    ['china', ['china', 'yunnan']],
    ['malaysia', ['malaysia', 'sarawak']],
    ['indonesia', ['indonesia', 'java', 'lombok']],
    ['thailand', ['thailand']],
    ['vietnam', ['vietnam']],
    ['sri lanka', ['sri lanka']],
    ['jordan', ['jordan']],
    ['israel', ['israel']],
    ['egypt', ['egypt']],
    ['oman', ['oman']],
    ['saudi arabia', ['saudi arabia']],
    ['australia', ['australia', 'tasmania', 'nsw', 'queensland', 'victoria']],
    ['new zealand', ['new zealand', 'auckland']],
    ['papua new guinea', ['papua new guinea']]
  ];

  for (const [country, tokens] of checks) {
    if (tokens.some(token => lower.includes(token))) return country.toUpperCase();
  }
  return 'OTHER';
}

function countryToContinent(country) {
  const northAmerica = ['USA', 'CANADA', 'MEXICO', 'COSTA RICA'];
  const southAmerica = ['CHILE', 'PERU', 'VENEZUELA', 'ARGENTINA', 'ECUADOR', 'BRAZIL', 'BOLIVIA'];
  const europe = ['ITALY', 'FRANCE', 'SWITZERLAND', 'AUSTRIA', 'ANDORRA', 'SLOVENIA', 'SPAIN', 'UK', 'NORWAY', 'SWEDEN', 'FINLAND', 'ICELAND', 'GREECE', 'BULGARIA', 'MONTENEGRO', 'POLAND', 'ROMANIA', 'CROATIA', 'PORTUGAL', 'GERMANY'];
  const africa = ['TANZANIA', 'KENYA', 'UGANDA', 'ETHIOPIA', 'SOUTH AFRICA', 'MOROCCO', 'DR CONGO', 'NAMIBIA'];
  const asia = ['NEPAL', 'PAKISTAN', 'INDIA', 'BHUTAN', 'JAPAN', 'SOUTH KOREA', 'TAIWAN', 'CHINA', 'MALAYSIA', 'INDONESIA', 'THAILAND', 'VIETNAM', 'SRI LANKA', 'JORDAN', 'ISRAEL', 'EGYPT', 'OMAN', 'SAUDI ARABIA'];
  const oceania = ['AUSTRALIA', 'NEW ZEALAND', 'PAPUA NEW GUINEA'];

  if (northAmerica.includes(country)) return 'North America';
  if (southAmerica.includes(country)) return 'South America';
  if (europe.includes(country)) return 'Europe';
  if (africa.includes(country)) return 'Africa';
  if (asia.includes(country)) return 'Asia / Middle East';
  if (oceania.includes(country)) return 'Oceania';
  return 'Other';
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function tabName(tab) {
  return (tab.querySelector('.ht-name')?.textContent || tab.dataset.query || '').trim();
}

function markSelectedTab(tab) {
  document.querySelectorAll('.hike-tab').forEach(t => t.classList.remove('selected'));
  tab.classList.add('selected');
  const season = seasonSelect ? seasonSelect.value : 'auto';
  const label = season === 'auto' ? currentSeasonName() : `${season[0].toUpperCase()}${season.slice(1)}`;
  applyTabRecommendation(tab, label);
}

function applyTabRecommendation(tab, seasonLabel) {
  let reco = tab.querySelector('.ht-reco');
  if (!reco) {
    reco = document.createElement('span');
    reco.className = 'ht-reco';
    tab.appendChild(reco);
  }

  if (seasonLabel === 'Winter') {
    reco.textContent = 'Rec: Not recommended in Winter';
    return;
  }

  const timeRange = seasonLabel === 'Summer'
    ? '4:30 AM - 7:43 AM'
    : '6:30 AM - 9:00 AM';
  reco.textContent = `Rec: ${timeRange} • Best upcoming day • ${seasonLabel}`;
}

function currentSeasonName() {
  const m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 5) return 'Spring';
  if (m >= 6 && m <= 8) return 'Summer';
  if (m >= 9 && m <= 11) return 'Fall';
  return 'Winter';
}

// --- GEOCODING ---
async function geocode(query) {
  const primary = query.trim();
  const simple = primary.split(',')[0].trim();
  const queries = simple && simple.toLowerCase() !== primary.toLowerCase()
    ? [primary, simple]
    : [primary];

  for (const q of queries) {
    const cached = getCacheEntry(GEOCODE_CACHE_KEY, q.toLowerCase(), GEOCODE_TTL_MS);
    if (cached) return cached;
  }

  // Open-Meteo geocoding is browser-friendly and should be used first.
  for (const q of queries) {
    const hit = await geocodeWithOpenMeteo(q);
    if (hit) {
      setCacheEntry(GEOCODE_CACHE_KEY, q.toLowerCase(), hit);
      return hit;
    }
  }

  // Nominatim often blocks file:// origins and can rate-limit; keep as best-effort fallback.
  if (isFileOrigin) return null;

  for (const q of queries) {
    const hit = await geocodeWithNominatim(q);
    if (hit) {
      setCacheEntry(GEOCODE_CACHE_KEY, q.toLowerCase(), hit);
      return hit;
    }
  }

  return null;
}

async function geocodeWithNominatim(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3&addressdetails=1`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let res;
    try {
      res = await fetch(url, { headers: { 'Accept-Language': getLanguageCode() }, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;

    const r = data[0];
    const addr = r.address || {};
    const sub = [addr.country, addr.state || addr.region].filter(Boolean).join(', ');
    return {
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      name: r.name || (r.display_name ? r.display_name.split(',')[0] : query),
      sub: sub || r.display_name || query,
    };
  } catch {
    return null;
  }
}

async function geocodeWithOpenMeteo(query) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=${getLanguageCode()}&format=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;

    const data = await res.json();
    const row = data && Array.isArray(data.results) ? data.results[0] : null;
    if (!row) return null;

    const bits = [row.country, row.admin1].filter(Boolean);
    return {
      lat: row.latitude,
      lon: row.longitude,
      name: row.name || query,
      sub: bits.join(', ') || row.country || query,
    };
  } catch {
    return null;
  }
}

// --- WEATHER ---
async function getWeather(lat, lon) {
  const weatherKey = `${Math.round(lat * 1000) / 1000},${Math.round(lon * 1000) / 1000},${getLanguageCode()}`;
  const cached = getCacheEntry(WEATHER_CACHE_KEY, weatherKey, WEATHER_TTL_MS);
  if (cached) return cached;

  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day,relative_humidity_2m`
    + `&daily=sunrise,sunset,precipitation_sum,wind_speed_10m_max,temperature_2m_max,temperature_2m_min,weather_code,uv_index_max`
    + `&timezone=auto`
    + `&forecast_days=7`;
  const res = await fetchWithTimeout(url, {}, 6000);
  const data = await res.json();
  const c = data.current;
  const d = data.daily;
  const payload = {
    elevation:    data.elevation,
    tempC:        c.temperature_2m,
    feelsLike:    c.apparent_temperature,
    precip:       c.precipitation,
    windKph:      c.wind_speed_10m,
    code:         c.weather_code,
    isDay:        c.is_day,
    humidity:     c.relative_humidity_2m,
    uvIndex:      d.uv_index_max ? d.uv_index_max[0] : null,
    sunrise:      formatTime(d.sunrise[0]),
    sunset:       formatTime(d.sunset[0]),
    dailyMaxTemp: d.temperature_2m_max[0],
    dailyMinTemp: d.temperature_2m_min[0],
    dailyPrecip:  d.precipitation_sum[0],
    dailyMaxWind: d.wind_speed_10m_max[0],
    dailyCode:    d.weather_code[0],
    forecastDates: d.time,
    forecastMaxC:  d.temperature_2m_max,
    forecastMinC:  d.temperature_2m_min,
    forecastPrecip: d.precipitation_sum,
    forecastMaxWindKph: d.wind_speed_10m_max,
    forecastWeatherCode: d.weather_code,
  };

  setCacheEntry(WEATHER_CACHE_KEY, weatherKey, payload);
  return payload;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return response;
  } finally {
    window.clearTimeout(timer);
  }
}

function getCacheEntry(cacheKey, key, ttlMs) {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    const store = JSON.parse(raw);
    const hit = store[key];
    if (!hit || typeof hit.ts !== 'number') return null;
    if (Date.now() - hit.ts > ttlMs) return null;
    return hit.value;
  } catch {
    return null;
  }
}

function setCacheEntry(cacheKey, key, value) {
  try {
    const raw = localStorage.getItem(cacheKey);
    const store = raw ? JSON.parse(raw) : {};
    store[key] = { ts: Date.now(), value };

    // Keep cache bounded to avoid unbounded growth.
    const keys = Object.keys(store);
    if (keys.length > 120) {
      keys
        .sort((a, b) => (store[a]?.ts || 0) - (store[b]?.ts || 0))
        .slice(0, keys.length - 100)
        .forEach(oldKey => delete store[oldKey]);
    }

    localStorage.setItem(cacheKey, JSON.stringify(store));
  } catch {
    // Ignore cache failures.
  }
}

// --- WEATHER CODE -> LABEL ---
function weatherLabel(code) {
  if (code === 0)              return 'Clear Sky';
  if (code <= 2)               return 'Partly Cloudy';
  if (code === 3)              return 'Overcast';
  if (code <= 49)              return 'Fog / Drizzle';
  if (code <= 57)              return 'Drizzle';
  if (code <= 67)              return 'Rain';
  if (code <= 77)              return 'Snow / Sleet';
  if (code <= 82)              return 'Rain Showers';
  if (code <= 86)              return 'Snow Showers';
  if (code >= 95 && code < 99) return 'Thunderstorm';
  if (code === 99)             return 'Thunderstorm w/ Hail';
  return 'Unknown';
}

// --- ANALYSIS ---
function analyse(weather, selectedSeason = 'auto', geo = null, selectedDate = '') {
  const { tempC, windKph, precip, code, elevation, dailyMaxWind, dailyMinTemp, dailyPrecip } = weather;
  const warnings = [];
  const tips     = [];
  let   score    = 0;
  const rainLikely = dailyPrecip >= 2 || (code >= 51 && code <= 82) || precip > 0.2;
  const uvRelevantNow = isUvRelevantForCurrentContext(weather, selectedDate);
  const coldAndNotSunny = (tempC <= 10 || dailyMinTemp <= 5) && code >= 3 && code < 45;

  if (tempC <= -20 || dailyMinTemp <= -20) {
    score += 4; warnings.push(`Extremely cold weather (${fmt(tempC)}). Frostbite risk may be elevated for exposed skin.`);
  } else if (tempC <= -10 || dailyMinTemp <= -10) {
    score += 3; warnings.push(`Very cold temperatures (${fmt(tempC)}). Heavy insulation is strongly recommended.`);
  } else if (tempC <= 0 || dailyMinTemp <= 0) {
    score += 2; warnings.push(`Freezing temperatures may leave trails icy or snow-covered.`);
  } else if (tempC <= 8 || dailyMinTemp <= 5) {
    score += 1; warnings.push(`Cold hiking window (${fmt(tempC)}). Warm layers and gloves are recommended.`);
  } else if (tempC >= 38) {
    score += 3; warnings.push(`Extreme heat (${fmt(tempC)}). Heat-related health risks may rise quickly.`);
  } else if (tempC >= 32) {
    score += 2; warnings.push(`Very hot (${fmt(tempC)}). Carry extra water and consider an early start.`);
  }

  if (weather.uvIndex != null && uvRelevantNow) {
    if (weather.uvIndex >= 11) {
      score += 2;
      if (coldAndNotSunny) {
        warnings.push(`Extreme UV index (${weather.uvIndex.toFixed(1)}) despite cold/cloudy conditions. Keep basic sun protection.`);
      } else {
        warnings.push(`Extreme UV index (${weather.uvIndex.toFixed(1)}). Sun exposure risk is high.`);
      }
    } else if (weather.uvIndex >= 9) {
      if (!coldAndNotSunny) {
        score += 1;
        warnings.push(`Very high UV index (${weather.uvIndex.toFixed(1)}). Sun protection is required.`);
      }
    } else if (weather.uvIndex >= 7) {
      if (!coldAndNotSunny) {
        warnings.push(`High UV index (${weather.uvIndex.toFixed(1)}). Use sun protection.`);
      }
    }
  }

  if (dailyMaxWind >= 80 || windKph >= 80) {
    score += 4; warnings.push(`Very strong winds (${Math.round(kphToMph(windKph))} mph). Exposed areas may be hazardous and debris risk may increase.`);
  } else if (dailyMaxWind >= 50 || windKph >= 50) {
    score += 2; warnings.push(`Strong winds (${Math.round(kphToMph(windKph))} mph) can make footing less stable on exposed ridges.`);
  } else if (windKph >= 30) {
    score += 1; warnings.push(`Moderate winds (${Math.round(kphToMph(windKph))} mph). Use caution on open terrain.`);
  }

  if (code === 99) {
    score += 5; warnings.push('Thunderstorm with hail is forecast. Based on weather data alone, hiking appears inadvisable without checking local alerts and official guidance.');
  } else if (code >= 95) {
    score += 4; warnings.push('Thunderstorm risk is present. Exposed trails may have elevated lightning risk.');
  } else if (code >= 71 && code <= 77) {
    score += 3; warnings.push('Snow is forecast. Trails may be buried and navigation may become difficult.');
  } else if ((code >= 61 && code <= 67) || precip > 5) {
    score += 2; warnings.push('Moderate to heavy rain is likely. Trails may become muddy and slippery.');
  } else if ((code >= 51 && code <= 57) || precip > 0) {
    score += 1; warnings.push('Light rain or drizzle is possible. Waterproof gear is recommended.');
  }

  if (dailyPrecip >= 6 && code < 61) {
    score += 2;
    warnings.push(`Forecast suggests notable rainfall later today (${mmToInches(dailyPrecip).toFixed(2)} in / ${dailyPrecip} mm).`);
  } else if (dailyPrecip >= 2 && code < 51) {
    score += 1;
    warnings.push(`Rain is likely later today (${mmToInches(dailyPrecip).toFixed(2)} in / ${dailyPrecip} mm forecast).`);
  }

  if (elevation >= 4000) {
    score += 2;
    warnings.push(`Very high elevation (${Math.round(elevation)} m). Altitude-related symptoms may be more likely without acclimatization.`);
    tips.push('Ascend slowly and watch for symptoms of altitude stress such as headache, nausea, or dizziness.');
    tips.push('At this elevation, pre-acclimatization days are strongly recommended before any hard effort.');
    tips.push('Turn around immediately if severe headache, confusion, or vomiting appears.');
  } else if (elevation >= 2500) {
    score += 1;
    warnings.push(`High elevation (${Math.round(elevation)} m). Weather may change rapidly.`);
    tips.push('Carry extra layers because high-altitude weather is often less predictable.');
  }

  if (tempC <= 5) { tips.push('Wear moisture-wicking base layers and an insulating mid-layer.'); tips.push('Pack hand warmers and keep your extremities covered.'); }
  if (tempC <= -5) { tips.push('Limit exposed skin and use windproof outer layers to reduce frostbite risk.'); }
  if (tempC >= 28) { tips.push('Start your hike at dawn to avoid peak heat.'); tips.push('Carry at least 0.5L of water per hour of hiking.'); }
  if (code >= 95) tips.push('Check the forecast every hour on days with storm risk.');
  if (windKph >= 30) tips.push('Secure loose clothing and gear. Avoid exposed ridgelines if possible.');
  if (precip > 0 || (code >= 51 && code <= 82)) { tips.push('Waterproof boots and a rain jacket are essential today.'); tips.push('Trekking poles help on slippery, wet trails.'); }

  if (selectedSeason === 'winter') {
    score += 4;
    if (tempC <= -5 || dailyMinTemp <= -5) {
      score += 1;
      warnings.push('Winter profile selected: expect icy surfaces and limited daylight.');
    }
    warnings.push('Winter profile selected: hiking is generally not recommended for most routes.');
    tips.push('Winter season selected: pack traction devices and insulated gloves.');
  }

  if (rainLikely && score < 2) {
    score = 2;
  }

  if (selectedSeason === 'summer') {
    if (tempC >= 30) {
      score += 1;
      warnings.push('Summer profile selected: heat risk rises quickly on exposed trails.');
    }
    if (tempC <= 5) {
      score += 2;
      warnings.push('Summer profile selected, but current temperatures are unexpectedly cold.');
    }
    tips.push('Summer season selected: start earlier and plan extra water stops.');
  }

  if (selectedSeason === 'spring' || selectedSeason === 'fall') {
    if (dailyPrecip >= 8 || windKph >= 35) {
      score += 1;
      warnings.push('Shoulder season profile selected: rapid weather swings are more likely.');
    }
    tips.push('Spring/Fall season selected: layer clothing for quick temperature shifts.');
  }

  tips.push('Always tell someone your route and expected return time.');
  tips.push('Carry a fully charged phone and a paper map as backup.');
  if (tips.length < 4) tips.push('Check trail-specific conditions on AllTrails or local park websites.');

  let verdict, message;
  if (score >= 7) {
    verdict = 'dangerous';
    message = `Based on forecast data alone, conditions appear hazardous right now. ${weatherLabel(code)} weather, ${fmt(tempC)}, and ${Math.round(kphToMph(windKph))} mph winds suggest postponing until you verify local trail status and official advisories.`;
  } else if (score >= 4) {
    verdict = 'bad';
    message = `Forecast conditions suggest a poor hiking window. ${weatherLabel(code)} weather, ${fmt(tempC)} temperatures, and ${Math.round(kphToMph(windKph))} mph winds may create significant hazards, so verify local conditions before going.`;
  } else if (score >= 2) {
    verdict = 'okay';
    message = `Forecast suggests a possible hiking window, but use caution. Conditions are ${weatherLabel(code).toLowerCase()} at ${fmt(tempC)}. Prepare for changing weather and check trail-specific updates before heading out.`;
  } else {
    verdict = 'great';
    message = `Forecast suggests relatively favorable hiking weather at this location, with ${weatherLabel(code).toLowerCase()}, ${fmt(tempC)}, and light winds. Keep checking local conditions before you go.`;
  }

  if (selectedSeason === 'winter') {
    if (verdict === 'great' || verdict === 'okay') {
      verdict = 'bad';
      message = 'Winter profile selected: forecast conditions suggest hiking may be a weak choice for many trails unless you have winter gear, route-specific experience, and current local condition checks.';
    }
  }

  if (rainLikely && verdict === 'great') {
    verdict = 'okay';
    message = 'Rain is likely, so forecast conditions are not favorable enough for the most positive rating. If you still go, use waterproof gear and choose less slippery trail surfaces.';
  }

  if ((
    tempC <= 10
    || dailyMinTemp <= 5
    || windKph >= 30
    || dailyMaxWind >= 35
    || (weather.uvIndex != null && weather.uvIndex >= 9 && uvRelevantNow && !coldAndNotSunny)
  ) && verdict === 'great') {
    verdict = 'okay';
    message = 'Forecast conditions suggest a possible hiking window, but caution is recommended due to wind, temperature, or UV exposure. Prepare gear carefully and verify local trail conditions before heading out.';
  }

  const recommendation = buildRecommendation(weather, selectedSeason, selectedDate);
  const seasonFit = getSeasonFit(geo, weather, selectedSeason);

  if (seasonFit.badChoice) {
    warnings.push(`Selected season is a weak fit for this location. Better season: ${seasonFit.recommendedLabel}.`);
  }

  recommendation.season = seasonFit.seasonText;
  return { verdict, message, warnings, tips, recommendation };
}

function getSeasonFit(geo, weather, selectedSeason = 'auto') {
  const lat = geo && typeof geo.lat === 'number' ? geo.lat : 0;
  const absLat = Math.abs(lat);
  const hemisphereNorth = lat >= 0;
  const placeText = `${geo?.name || ''} ${geo?.sub || ''}`.toLowerCase();
  const desertLike = /desert|canyon|uluru|wadi|namib|death valley|sahara|atlas|mesa|joshua tree/.test(placeText);
  const alpineLike = weather.elevation >= 2200 || /mount|peak|alps|himalaya|everest|denali|fuji|kilimanjaro|teton|rainier|dolomite/.test(placeText);

  let recommended = [];

  if (weather.elevation >= 5000) {
    recommended = [];
  } else if (desertLike) {
    recommended = ['Fall', 'Winter', 'Spring'];
  } else if (alpineLike) {
    recommended = hemisphereNorth ? ['Summer', 'Fall'] : ['Winter', 'Spring'];
  } else if (absLat >= 60) {
    recommended = hemisphereNorth ? ['Summer'] : ['Winter'];
  } else if (absLat >= 35) {
    recommended = hemisphereNorth ? ['Summer', 'Fall', 'Spring'] : ['Winter', 'Spring', 'Fall'];
  } else if (absLat >= 15) {
    recommended = hemisphereNorth ? ['Fall', 'Spring', 'Winter'] : ['Spring', 'Fall', 'Summer'];
  } else {
    recommended = ['Winter', 'Spring'];
  }

  const uniqueRecommended = Array.from(new Set(recommended));
  const selectedLabel = selectedSeason === 'auto'
    ? currentSeasonName()
    : `${selectedSeason[0].toUpperCase()}${selectedSeason.slice(1)}`;

  const badChoice = selectedSeason !== 'auto' && !uniqueRecommended.includes(selectedLabel);
  const recommendedLabel = uniqueRecommended.length ? uniqueRecommended.join(' / ') : 'No recommended seasons';

  if (!uniqueRecommended.length) {
    return {
      badChoice: true,
      recommendedLabel,
      seasonText: `${selectedLabel} (No recommended seasons)`
    };
  }

  if (selectedSeason === 'auto') {
    return {
      badChoice: false,
      recommendedLabel,
      seasonText: `${selectedLabel} (Best: ${recommendedLabel})`
    };
  }

  if (badChoice) {
    return {
      badChoice: true,
      recommendedLabel,
      seasonText: `${selectedLabel} (Try: ${recommendedLabel})`
    };
  }

  return {
    badChoice: false,
    recommendedLabel,
    seasonText: `${selectedLabel} (Good choice)`
  };
}

function buildRecommendation(weather, selectedSeason = 'auto', selectedDate = '') {
  const seasonLabel = selectedSeason === 'auto'
    ? currentSeasonName()
    : `${selectedSeason[0].toUpperCase()}${selectedSeason.slice(1)}`;

  if (seasonLabel === 'Winter') {
    return { time: 'Not Recommended', day: 'Do not schedule', season: seasonLabel };
  }

  // Base windows by season (minutes after midnight)
  let baseStart = 360; // 6:00 AM
  let baseEnd = 510;   // 8:30 AM
  if (seasonLabel === 'Summer') { baseStart = 270; baseEnd = 450; }  // 4:30 AM - 7:30 AM

  // If very hot, shift to evening window
  if (weather.tempC >= 33) { baseStart = 1050; baseEnd = 1183; } // 5:30 PM - 7:43 PM

  // Avoid recommending late morning / noon windows when it's very cold.
  if (weather.tempC <= -5) {
    return { time: 'Not Recommended', day: 'Too cold for a safe hike window', season: seasonLabel };
  }

  const sunriseMins = timeToMinutes(weather.sunrise);
  const sunsetMins = timeToMinutes(weather.sunset);

  let start = baseStart;
  let end = baseEnd;
  if (sunriseMins != null) start = Math.max(start, sunriseMins + 15);
  if (sunsetMins != null) end = Math.min(end, sunsetMins - 90);

  // Keep morning guidance out of late-morning hours.
  if (baseStart < 1000) {
    end = Math.min(end, 10 * 60 + 30); // 10:30 AM hard cap
  }

  if (end <= start || (end - start) < 45) {
    start = baseStart;
    end = baseEnd;
  }

  const time = `${minutesTo12h(start)} - ${minutesTo12h(end)}`;

  let bestIdx = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < weather.forecastDates.length; i += 1) {
    const temp = weather.forecastMaxC[i] ?? weather.tempC;
    const min = weather.forecastMinC[i] ?? weather.dailyMinTemp;
    const tempPenalty = Math.max(0, temp - 28) + Math.max(0, 2 - min);
    const dayScore = tempPenalty;
    if (dayScore < bestScore) {
      bestScore = dayScore;
      bestIdx = i;
    }
  }

  const bestDate = weather.forecastDates[bestIdx];
  let day = bestDate
    ? new Date(`${bestDate}T12:00:00`).toLocaleDateString(getLocale(), { weekday: 'long' })
    : 'Today';

  if (selectedDate) {
    const target = selectedDate.slice(0, 10);
    const inForecast = Array.isArray(weather.forecastDates) && weather.forecastDates.includes(target);
    if (inForecast) {
      day = new Date(`${target}T12:00:00`).toLocaleDateString(getLocale(), {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
      });
    } else {
      day = `${formatSelectedDate(target)} (outside 7-day forecast)`;
    }
  }

  return { time, day, season: seasonLabel };
}

function formatSelectedDate(isoDate) {
  if (!isoDate) return 'Selected date';
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 'Selected date';
  return d.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
}

function localTodayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isUvRelevantForCurrentContext(weather, selectedDate = '') {
  const targetDate = selectedDate ? selectedDate.slice(0, 10) : localTodayIso();
  if (targetDate !== localTodayIso()) return true;

  const sunriseMins = timeToMinutes(weather.sunrise);
  const sunsetMins = timeToMinutes(weather.sunset);
  if (sunriseMins == null || sunsetMins == null) return true;

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return nowMins >= sunriseMins && nowMins <= sunsetMins;
}

function timeToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const trimmed = hhmm.trim();

  // Handles strings like "8:23 PM".
  const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    const minute = parseInt(ampmMatch[2], 10);
    const ampm = ampmMatch[3].toUpperCase();
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    return hour * 60 + minute;
  }

  // Handles ISO-like strings such as "2026-05-05T18:23".
  const timePart = trimmed.includes('T') ? trimmed.split('T')[1] : trimmed;
  if (!timePart || !timePart.includes(':')) return null;
  const [h, m] = timePart.split(':').map(n => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minutesTo12h(totalMins) {
  const mins = ((totalMins % 1440) + 1440) % 1440;
  const hour24 = Math.floor(mins / 60);
  const minute = mins % 60;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${ampm}`;
}

// --- RENDER ---
function renderResult(geo, weather, selectedSeason = 'auto', selectedDate = '') {
  const { verdict, message, warnings, tips, recommendation } = analyse(weather, selectedSeason, geo, selectedDate);
  const knownCautions = buildKnownCautions(geo, weather, verdict, recommendation, selectedSeason, selectedDate);
  const isNotRecommended = verdict === 'bad' || verdict === 'dangerous' || recommendation.time === 'Not Recommended';

  if (result) {
    result.classList.toggle('not-recommended', isNotRecommended);
  }

  document.getElementById('locationName').textContent = geo.name;
  document.getElementById('locationSub').textContent  = geo.sub;

  const seasonContext = document.getElementById('seasonContext');
  if (seasonContext) {
    if (selectedSeason === 'auto') {
      if (selectedDate) {
        seasonContext.textContent = `Planned hike date: ${formatSelectedDate(selectedDate)}`;
        seasonContext.classList.remove('hidden');
      } else {
        seasonContext.classList.add('hidden');
      }
    } else {
      const dateNote = selectedDate ? ` | Hike date: ${formatSelectedDate(selectedDate)}` : '';
      seasonContext.textContent = `Season profile: ${selectedSeason[0].toUpperCase()}${selectedSeason.slice(1)}${dateNote}`;
      seasonContext.classList.remove('hidden');
    }
  }

  const badge = document.getElementById('verdictBadge');
  badge.textContent = verdictDisplayLabel(verdict);
  badge.className = `verdict-badge ${verdict}`;

  const msgEl = document.getElementById('verdictMessage');
  msgEl.textContent = message;
  msgEl.className = `verdict-message ${verdict}`;

  const recTime = document.getElementById('recTime');
  const recDay = document.getElementById('recDay');
  const recSeason = document.getElementById('recSeason');
  if (recTime) recTime.textContent = recommendation.time;
  if (recDay) recDay.textContent = recommendation.day;
  if (recSeason) recSeason.textContent = recommendation.season;

  const tF = Math.round(cToF(weather.tempC));
  const tC = Math.round(weather.tempC);
  const flF = Math.round(cToF(weather.feelsLike ?? weather.tempC));
  const flC = Math.round(weather.feelsLike ?? weather.tempC);
  const minF = Math.round(cToF(weather.dailyMinTemp));
  const maxF = Math.round(cToF(weather.dailyMaxTemp));
  const minC = Math.round(weather.dailyMinTemp);
  const maxC = Math.round(weather.dailyMaxTemp);

  if (useMetricUnits()) {
    document.getElementById('heroTemp').innerHTML = `${tC}&deg;C<small class="hero-temp-c">${tF}&deg;F</small>`;
    document.getElementById('heroFeels').textContent = `${flC}\u00B0C`;
    document.getElementById('heroRange').textContent = `${minC}\u00B0C / ${maxC}\u00B0C`;
  } else {
    document.getElementById('heroTemp').innerHTML = `${tF}&deg;F<small class="hero-temp-c">${tC}&deg;C</small>`;
    document.getElementById('heroFeels').textContent = `${flF}\u00B0F`;
    document.getElementById('heroRange').textContent = `${minF}\u00B0F / ${maxF}\u00B0F`;
  }
  document.getElementById('heroIcon').textContent      = weatherIcon(weather.code, weather.isDay);
  document.getElementById('heroCondition').textContent = weatherLabel(weather.code);

  // Detail grid
  document.getElementById('dHumidity').textContent  = weather.humidity != null ? `${weather.humidity}%` : '--';
  document.getElementById('dWind').textContent      = formatWind(weather.windKph);
  document.getElementById('dPrecip').textContent    = formatPrecip(weather.dailyPrecip ?? 0);
  document.getElementById('dUV').textContent        = uvLabel(weather.uvIndex);
  document.getElementById('dElevation').textContent = weather.elevation ? formatElevation(weather.elevation) : '--';
  document.getElementById('dSunrise').textContent   = weather.sunrise;
  document.getElementById('dSunset').textContent    = weather.sunset;
  document.getElementById('dMaxWind').textContent   = formatWind(weather.dailyMaxWind);

  const warnSection = document.getElementById('warningsList');
  const warnUl      = document.getElementById('warningsUl');
  warnUl.innerHTML = '';
  if (warnings.length) {
    warnings.forEach(w => { const li = document.createElement('li'); li.textContent = w; warnUl.appendChild(li); });
    warnSection.classList.remove('hidden');
  } else {
    warnSection.classList.add('hidden');
  }

  renderKnownCautions(knownCautions);

  const tipsUl = document.getElementById('tipsUl');
  tipsUl.innerHTML = '';
  Array.from(new Set(tips)).forEach(t => { const li = document.createElement('li'); li.textContent = t; tipsUl.appendChild(li); });

  renderChart(weather);
  renderMoreInsights(geo, weather, verdict, selectedDate);
  setupPlannerLaunch(geo, selectedDate, selectedSeason);
  renderSafetyLifeline(geo, weather, verdict, recommendation);

}

function buildKnownCautions(geo, weather, verdict, recommendation, selectedSeason = 'auto', selectedDate = '') {
  const cautions = [];
  const uvRelevantNow = isUvRelevantForCurrentContext(weather, selectedDate);
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const sunriseMins = timeToMinutes(weather.sunrise);
  const sunsetMins = timeToMinutes(weather.sunset);
  const nearDark = sunsetMins != null ? nowMins >= (sunsetMins - 90) : false;
  const preDawn = sunriseMins != null ? nowMins < sunriseMins : false;
  const code = Number(weather.code) || 0;

  const add = (level, title, detail, action) => {
    cautions.push({ level, title, detail, action });
  };

  if (verdict === 'dangerous' || recommendation.time === 'Not Recommended') {
    add('critical', 'High-Risk Window', 'Current forecast profile is in a hazardous range for many hikers.', 'Postpone or switch to a low-exposure route and verify local advisories.');
  }

  if (weather.tempC <= -15 || weather.dailyMinTemp <= -15) {
    add('critical', 'Severe Cold Stress', `Temperatures are in severe-cold range (${fmt(weather.tempC)}).`, 'Use expedition-grade insulation and protect all exposed skin.');
  } else if (weather.tempC <= 0 || weather.dailyMinTemp <= 0) {
    add('high', 'Freeze / Ice Risk', 'Sub-freezing conditions increase slip and exposure risk.', 'Use traction, reduce pace, and avoid shaded icy slopes.');
  }

  if (weather.tempC >= 35 || weather.dailyMaxTemp >= 35) {
    add('critical', 'Heat Illness Risk', `Very hot conditions (${fmt(weather.tempC)}) can rapidly cause heat illness.`, 'Start at dawn, enforce hydration breaks, and stop if symptoms appear.');
  } else if (weather.tempC >= 30 || weather.dailyMaxTemp >= 30) {
    add('high', 'Heat Load', 'Warm conditions raise dehydration and fatigue risk.', 'Carry more water and shorten exposed ridge time.');
  }

  if (weather.dailyMaxWind >= 70 || weather.windKph >= 70) {
    add('critical', 'Severe Wind Hazard', `Peak winds around ${Math.round(kphToMph(weather.dailyMaxWind || weather.windKph))} mph may cause instability and debris risk.`, 'Avoid exposed ridges and turn around before gust fronts.');
  } else if (weather.dailyMaxWind >= 45 || weather.windKph >= 45) {
    add('high', 'Strong Wind Exposure', 'Wind can destabilize footing on narrow or exposed sections.', 'Use trekking poles and keep distance from cliff edges.');
  }

  if (code === 99 || code >= 95) {
    add('critical', 'Lightning / Thunderstorm', 'Convective storm pattern present with potential lightning hazard.', 'Do not remain on exposed high ground; descend immediately.');
  }

  if (weather.dailyPrecip >= 12) {
    add('high', 'Flood / Washout Potential', `${mmToInches(weather.dailyPrecip).toFixed(2)} in (${weather.dailyPrecip} mm) forecast can overwhelm drainage.`, 'Avoid canyons, creek crossings, and narrow drainages.');
  }

  if ((code >= 71 && code <= 77) || weather.dailyMinTemp <= -3) {
    add('high', 'Snow / Whiteout Conditions', 'Snow and low visibility can erase trail definition.', 'Carry navigation backup and set strict turnaround points.');
  }

  if (code >= 45 && code <= 48) {
    add('moderate', 'Fog / Low Visibility', 'Reduced visibility can cause route-finding mistakes.', 'Slow down, stay on mapped track, and avoid shortcuts.');
  }

  if (weather.precip > 0 && weather.tempC >= -2 && weather.tempC <= 2) {
    add('high', 'Black Ice Potential', 'Near-freezing wet conditions can form transparent ice patches.', 'Treat bridges, slabs, and boardwalks as slick surfaces.');
  }

  if (weather.elevation >= 3500) {
    add('high', 'Altitude Stress', `${formatElevation(weather.elevation)} can trigger altitude symptoms in unacclimatized hikers.`, 'Pace conservatively and descend if headache/nausea worsens.');
  } else if (weather.elevation >= 2400) {
    add('moderate', 'High-Elevation Fatigue', 'Thinner air increases effort and dehydration rate.', 'Take longer rest intervals and hydrate consistently.');
  }

  if (uvRelevantNow && weather.uvIndex != null && weather.uvIndex >= 10) {
    add('high', 'UV Exposure', `UV index ${weather.uvIndex.toFixed(1)} can burn skin quickly at elevation.`, 'Use hat, glasses, and broad-spectrum SPF on exposed skin.');
  }

  if (nearDark || preDawn) {
    add('high', 'Low-Light Navigation', 'Limited daylight increases navigation and injury risk.', 'Carry a headlamp with spare batteries and shorten objectives.');
  }

  if (selectedSeason === 'winter') {
    add('high', 'Winter Profile Active', 'Winter assumptions increase uncertainty in trail surfaces and daylight.', 'Use conservative route choices and plan early turnaround times.');
  }

  if ((weather.humidity || 0) >= 90 && weather.windKph >= 25 && weather.tempC <= 8) {
    add('moderate', 'Wind-Chill Stress', 'Cold, humid air plus wind can accelerate heat loss.', 'Add windproof shell and keep hands dry and insulated.');
  }

  if (!cautions.length) {
    add('low', 'Standard Backcountry Risk', 'No major red flags detected, but trail hazards are never zero.', 'Share your route plan and maintain conservative decision points.');
  }

  return cautions.slice(0, 12);
}

function renderKnownCautions(cautions) {
  const section = document.getElementById('knownCautionsList');
  const list = document.getElementById('knownCautionsUl');
  if (!section || !list) return;

  list.innerHTML = '';
  if (!Array.isArray(cautions) || !cautions.length) {
    section.classList.add('hidden');
    return;
  }

  cautions.forEach((caution) => {
    const li = document.createElement('li');
    li.className = `known-caution ${caution.level || 'moderate'}`;

    const top = document.createElement('div');
    top.className = 'known-caution-top';

    const title = document.createElement('strong');
    title.textContent = caution.title;

    const level = document.createElement('span');
    level.className = 'known-caution-level';
    level.textContent = String(caution.level || 'moderate').toUpperCase();

    const detail = document.createElement('p');
    detail.className = 'known-caution-detail';
    detail.textContent = caution.detail;

    const action = document.createElement('p');
    action.className = 'known-caution-action';
    action.textContent = `Action: ${caution.action}`;

    top.appendChild(title);
    top.appendChild(level);
    li.appendChild(top);
    li.appendChild(detail);
    li.appendChild(action);
    list.appendChild(li);
  });

  section.classList.remove('hidden');
}

function setupPlannerLaunch(geo, selectedDate = '', selectedSeason = 'auto') {
  if (!plannerOpenBtn || !geo) return;

  plannerOpenBtn.onclick = () => {
    const base = new URL('planner.html', window.location.href);
    base.searchParams.set('lat', String(geo.lat));
    base.searchParams.set('lon', String(geo.lon));
    base.searchParams.set('name', geo.name || 'Selected Location');
    base.searchParams.set('sub', geo.sub || '');
    base.searchParams.set('miles', '4');
    if (selectedDate) base.searchParams.set('date', selectedDate);
    if (selectedSeason) base.searchParams.set('season', selectedSeason);

    const url = base.toString();
    try {
      const tab = window.open(url, '_blank');
      if (!tab) {
        window.location.href = url;
      }
    } catch {
      window.location.href = url;
    }
  };
}

function renderMoreInsights(geo, weather, verdict, selectedDate = '') {
  const precipTitle = document.getElementById('precipChartTitle');
  const windTitle = document.getElementById('windChartTitle');
  if (precipTitle) precipTitle.textContent = `7-Day Rain (${useMetricUnits() ? 'mm' : 'in'})`;
  if (windTitle) windTitle.textContent = `7-Day Wind (${useMetricUnits() ? 'km/h' : 'mph'})`;

  const precipSeries = useMetricUnits()
    ? (weather.forecastPrecip || [])
    : (weather.forecastPrecip || []).map(v => mmToInches(v));
  const windSeries = useMetricUnits()
    ? (weather.forecastMaxWindKph || [])
    : (weather.forecastMaxWindKph || []).map(v => kphToMph(v));
  renderMiniChart('precipChart', weather.forecastDates, precipSeries, '#1976d2', useMetricUnits() ? 'mm' : 'in');
  renderMiniChart('windChart', weather.forecastDates, windSeries, '#ef6c00', useMetricUnits() ? 'km/h' : 'mph');

  const reviewsUl = document.getElementById('placeReviewsUl');
  if (reviewsUl) {
    reviewsUl.innerHTML = '';
    buildCredibleNotes(geo, weather, verdict, selectedDate).forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      reviewsUl.appendChild(li);
    });
  }

  const linksEl = document.getElementById('reviewLinks');
  if (linksEl) {
    const place = `${geo?.name || ''} ${geo?.sub || ''}`.trim();
    const encoded = encodeURIComponent(place);
    linksEl.innerHTML = [
      `<a href="https://www.google.com/search?q=${encoded}+trail+conditions" target="_blank" rel="noopener noreferrer">Google Search</a>`,
      `<a href="https://www.alltrails.com/search?q=${encoded}" target="_blank" rel="noopener noreferrer">AllTrails</a>`,
      `<a href="https://www.tripadvisor.com/Search?q=${encoded}" target="_blank" rel="noopener noreferrer">Tripadvisor</a>`
    ].join('');
  }
}

function setupSafetyCenterButton() {
  if (!safetyCenterBtn) return;
  safetyCenterBtn.addEventListener('click', () => {
    const section = document.getElementById('safetyLifeline');
    if (!section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js?v=3').then((reg) => reg.update()).catch(() => null);
  });
}

function renderSafetyLifeline(geo, weather, verdict, recommendation) {
  const section = document.getElementById('safetyLifeline');
  if (!section) return;

  renderTerrainDifficulty(weather, verdict);
  renderNoaaAlerts(geo);
  bindOfflinePack(geo, weather, verdict, recommendation);
  bindCoverageTracker();
  bindResourceCalculator(weather);
  renderEssentialsChecklist();
  renderCoverageHeatmap();
  renderBatteryModeStatus();
  renderPrivacyState();
}

function renderTerrainDifficulty(weather, verdict) {
  const target = document.getElementById('terrainDifficulty');
  if (!target) return;
  const elevation = Number(weather.elevation) || 0;
  const wind = Number(weather.dailyMaxWind || weather.windKph) || 0;
  const precip = Number(weather.dailyPrecip || weather.precip) || 0;
  const maxTemp = Number(weather.dailyMaxTemp || weather.tempC) || 0;
  const minTemp = Number(weather.dailyMinTemp || weather.tempC) || 0;

  let score = 1;
  score += Math.min(3, Math.floor(elevation / 1300));
  if (wind >= 35) score += 2;
  else if (wind >= 22) score += 1;
  if (precip >= 8) score += 2;
  else if (precip >= 3) score += 1;
  if (maxTemp >= 32 || minTemp <= 0) score += 1;
  if (verdict === 'bad') score += 1;
  if (verdict === 'dangerous') score += 2;
  score = Math.max(1, Math.min(10, score));

  const text = score <= 3 ? 'Easy to Moderate' : score <= 6 ? 'Moderate to Challenging' : 'High Consequence';
  target.textContent = `Terrain difficulty: ${score}/10 (${text})`;
}

async function renderNoaaAlerts(geo) {
  const panel = document.getElementById('weatherAlertsPanel');
  const list = document.getElementById('weatherAlertsUl');
  if (!panel || !list || !geo) return;

  list.innerHTML = '';
  const lat = Number(geo.lat);
  const lon = Number(geo.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  if (lat < 18 || lat > 72 || lon > -60 || lon < -170) {
    panel.classList.remove('hidden');
    const li = document.createElement('li');
    li.textContent = 'NOAA alerts are focused on U.S. areas. Use local weather authority alerts for this region.';
    list.appendChild(li);
    return;
  }

  try {
    const url = `https://api.weather.gov/alerts/active?point=${lat.toFixed(3)},${lon.toFixed(3)}`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/geo+json' } }, 7000);
    const data = await res.json();
    const features = Array.isArray(data.features) ? data.features.slice(0, 4) : [];
    panel.classList.remove('hidden');

    if (!features.length) {
      const li = document.createElement('li');
      li.textContent = 'No active NOAA alerts at this point right now.';
      list.appendChild(li);
      return;
    }

    features.forEach((item) => {
      const props = item.properties || {};
      const li = document.createElement('li');
      li.textContent = `${props.event || 'Weather Alert'}: ${props.headline || props.description || 'No details provided.'}`;
      list.appendChild(li);
    });
  } catch {
    panel.classList.remove('hidden');
    const li = document.createElement('li');
    li.textContent = 'Could not fetch NOAA alerts right now. Recheck before departure.';
    list.appendChild(li);
  }
}

function bindOfflinePack(geo, weather, verdict, recommendation) {
  const btnEl = document.getElementById('downloadOfflinePackBtn');
  const statusEl = document.getElementById('offlinePackStatus');
  if (!btnEl || !statusEl || !geo) return;

  renderOfflinePackList();

  btnEl.onclick = async () => {
    btnEl.disabled = true;
    statusEl.textContent = 'Downloading offline pack...';
    try {
      const tileCount = await prefetchTopoTiles(geo.lat, geo.lon);
      saveOfflinePack({
        id: `${geo.name}-${Date.now()}`,
        name: geo.name,
        sub: geo.sub,
        lat: geo.lat,
        lon: geo.lon,
        verdict,
        recommendation,
        downloadedAt: Date.now(),
        tileCount
      });
      statusEl.textContent = `Offline pack saved (${tileCount} tiles prefetched).`;
      renderOfflinePackList();
    } catch {
      statusEl.textContent = 'Offline pack failed. Try again with a stronger connection.';
    } finally {
      btnEl.disabled = false;
    }
  };
}

async function prefetchTopoTiles(lat, lon) {
  if (!('caches' in window)) return 0;
  const zoom = 12;
  const center = latLonToTile(lat, lon, zoom);
  const cache = await caches.open('hikeright-topo-v1');
  const tasks = [];

  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      const x = center.x + dx;
      const y = center.y + dy;
      const url = `https://tile.opentopomap.org/${zoom}/${x}/${y}.png`;
      tasks.push(fetch(url, { mode: 'no-cors' }).then((res) => cache.put(url, res)).catch(() => null));
    }
  }

  await Promise.all(tasks);
  return tasks.length;
}

function latLonToTile(lat, lon, zoom) {
  const latRad = lat * Math.PI / 180;
  const n = 2 ** zoom;
  const x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x, y };
}

function saveOfflinePack(pack) {
  const packs = getOfflinePacks();
  packs.unshift(pack);
  localStorage.setItem(OFFLINE_PACKS_KEY, JSON.stringify(packs.slice(0, 12)));
}

function getOfflinePacks() {
  try {
    const raw = localStorage.getItem(OFFLINE_PACKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderOfflinePackList() {
  const list = document.getElementById('offlinePackList');
  if (!list) return;
  list.innerHTML = '';
  const packs = getOfflinePacks();
  if (!packs.length) {
    const li = document.createElement('li');
    li.textContent = 'No offline packs saved yet.';
    list.appendChild(li);
    return;
  }

  packs.forEach((pack) => {
    const li = document.createElement('li');
    const when = new Date(pack.downloadedAt).toLocaleString(getLocale());
    li.textContent = `${pack.name} (${pack.sub || 'No subregion'}) - ${pack.tileCount || 0} tiles - saved ${when}`;
    list.appendChild(li);
  });
}

function bindCoverageTracker() {
  const startBtn = document.getElementById('startCoverageTrackBtn');
  const stopBtn = document.getElementById('stopCoverageTrackBtn');
  if (!startBtn || !stopBtn || !navigator.geolocation) return;

  startBtn.onclick = async () => {
    if (activeCoverageWatchId != null) return;
    const geoOpts = await getGeoOptions(true);
    activeCoverageWatchId = navigator.geolocation.watchPosition((pos) => {
      const points = getCoverageTrack();
      const connection = navigator.connection || {};
      points.push({
        lat: Number(pos.coords.latitude.toFixed(5)),
        lon: Number(pos.coords.longitude.toFixed(5)),
        accuracy: Math.round(pos.coords.accuracy || 0),
        effectiveType: connection.effectiveType || 'unknown',
        downlink: connection.downlink || 0,
        ts: Date.now()
      });
      localStorage.setItem(COVERAGE_TRACK_KEY, JSON.stringify(points.slice(-80)));
      renderCoverageHeatmap();
    }, () => null, geoOpts);
  };

  stopBtn.onclick = () => {
    if (activeCoverageWatchId != null) {
      navigator.geolocation.clearWatch(activeCoverageWatchId);
      activeCoverageWatchId = null;
    }
  };
}

function getCoverageTrack() {
  try {
    const raw = localStorage.getItem(COVERAGE_TRACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderCoverageHeatmap() {
  const list = document.getElementById('coverageHeatList');
  if (!list) return;
  list.innerHTML = '';
  const points = getCoverageTrack();
  if (!points.length) {
    const li = document.createElement('li');
    li.textContent = 'No coverage breadcrumbs yet. Start tracking on-trail.';
    list.appendChild(li);
    return;
  }

  points.slice(-8).reverse().forEach((point) => {
    const li = document.createElement('li');
    const quality = coverageQuality(point);
    const bar = '[' + '#'.repeat(quality) + '-'.repeat(5 - quality) + ']';
    li.textContent = `${bar} ${point.effectiveType} (${Number(point.downlink).toFixed(1)} Mbps) at ${new Date(point.ts).toLocaleTimeString(getLocale())}`;
    list.appendChild(li);
  });
}

function coverageQuality(point) {
  if (point.downlink >= 8) return 5;
  if (point.downlink >= 4) return 4;
  if (point.downlink >= 2) return 3;
  if (point.downlink >= 0.8) return 2;
  return 1;
}

function bindResourceCalculator(weather) {
  const tripInput = document.getElementById('tripHoursInput');
  const bufferInput = document.getElementById('bufferMinsInput');
  if (!tripInput || !bufferInput) return;

  const recalc = () => {
    const tripHours = Math.max(1, Math.min(48, Number(tripInput.value) || 4));
    const bufferMins = Math.max(15, Math.min(300, Number(bufferInput.value) || 90));
    const sunsetMins = timeToMinutes(weather.sunset);

    const turnAroundEl = document.getElementById('turnAroundTime');
    const waterEl = document.getElementById('waterTarget');

    if (turnAroundEl) {
      if (sunsetMins == null) {
        turnAroundEl.textContent = 'Need sunset data';
      } else {
        const outboundMins = Math.round((tripHours / 2) * 60);
        const latestTurn = sunsetMins - outboundMins - bufferMins;
        turnAroundEl.textContent = minutesTo12h(latestTurn);
      }
    }

    if (waterEl) {
      const temp = Number(weather.dailyMaxTemp || weather.tempC) || 15;
      const perHour = temp >= 30 ? 0.75 : temp <= 8 ? 0.4 : 0.55;
      const liters = Math.max(1, Math.round(tripHours * perHour * 10) / 10);
      const ounces = Math.round(liters * 33.814);
      waterEl.textContent = `${liters} L (~${ounces} oz)`;
    }
  };

  tripInput.oninput = recalc;
  bufferInput.oninput = recalc;
  recalc();
}

function renderEssentialsChecklist() {
  const wrap = document.getElementById('essentialsChecklist');
  const progress = document.getElementById('essentialsProgress');
  if (!wrap || !progress) return;

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(ESSENTIALS_KEY) || '{}');
  } catch {
    saved = {};
  }

  wrap.innerHTML = '';

  const update = () => {
    const completed = Object.values(saved).filter(Boolean).length;
    progress.textContent = `${completed}/10 complete`;
    localStorage.setItem(ESSENTIALS_KEY, JSON.stringify(saved));
  };

  TEN_ESSENTIALS.forEach((item, idx) => {
    const id = `ess-${idx}`;
    const label = document.createElement('label');
    label.className = 'essential-item';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = id;
    box.checked = Boolean(saved[id]);
    box.addEventListener('change', () => {
      saved[id] = box.checked;
      update();
    });
    const text = document.createElement('span');
    text.textContent = item;
    label.appendChild(box);
    label.appendChild(text);
    wrap.appendChild(label);
  });

  update();
}

async function renderBatteryModeStatus() {
  const el = document.getElementById('batteryModeStatus');
  if (!el) return;
  if ('getBattery' in navigator) {
    try {
      const bat = await navigator.getBattery();
      const pct = Math.round(bat.level * 100);
      const chg = bat.charging ? ' ⚡' : '';
      let label;
      if (pct <= 15) label = `Auto: Critical (${pct}%${chg}) — GPS reduced`;
      else if (pct <= 40) label = `Auto: Saver (${pct}%${chg}) — GPS balanced`;
      else label = `Auto: Full accuracy (${pct}%${chg})`;
      el.textContent = label;
      if (!batteryListenersBound) {
        batteryListenersBound = true;
        bat.addEventListener('levelchange', renderBatteryModeStatus);
        bat.addEventListener('chargingchange', renderBatteryModeStatus);
      }
      return;
    } catch { /* fall through */ }
  }
  el.textContent = userSettings.batterySaver === 'on' ? 'Manual: Extreme Saver' : 'Manual: Standard';
}

function renderPrivacyState() {
  const el = document.getElementById('privacyStateText');
  if (!el) return;
  const mode = userSettings.anonymousEmergency === 'on' ? 'minimal data mode' : 'standard local data mode';
  el.textContent = `Privacy mode: ${mode}. Data stays on this device.`;
}

function buildCredibleNotes(geo, weather, verdict, selectedDate = '') {
  const notes = [];
  const place = `${geo?.name || 'This location'}${geo?.sub ? ` (${geo.sub})` : ''}`;

  notes.push(`Forecast data source: Open-Meteo for ${place}.`);
  notes.push('Location matching uses Open-Meteo geocoding and may occasionally resolve to a nearby place instead of the exact trailhead.');
  if (selectedDate) {
    notes.push(`Planned hike date: ${formatSelectedDate(selectedDate)}.`);
  }
  notes.push(`Current safety verdict: ${verdict.toUpperCase()} from a simple rules-based check using weather fields such as temperature, precipitation, wind, UV, and elevation.`);
  notes.push('These notes are automated summaries, not official trail reports, ranger advice, or a guarantee of on-trail conditions.');
  notes.push('External links are provided for additional research only. Review quality and accuracy vary by source.');

  return notes;
}

function renderMiniChart(targetId, labels, values, color, unit) {
  const el = document.getElementById(targetId);
  if (!el || !Array.isArray(labels) || !Array.isArray(values) || !labels.length || !values.length) return;

  const cleanValues = values.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : 0));
  const max = Math.max(1, ...cleanValues);
  const W = 560;
  const H = 180;
  const PAD = { top: 20, right: 12, bottom: 30, left: 30 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;
  const barW = (cW / cleanValues.length) * 0.65;

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`;
  svg += `<line x1="${PAD.left}" y1="${H - PAD.bottom}" x2="${W - PAD.right}" y2="${H - PAD.bottom}" stroke="#d4e0d4" stroke-width="1"/>`;

  cleanValues.forEach((v, i) => {
    const x = PAD.left + (i + 0.5) * (cW / cleanValues.length) - barW / 2;
    const h = Math.max(2, (v / max) * cH);
    const y = H - PAD.bottom - h;
    const day = new Date(`${labels[i]}T12:00:00`).toLocaleDateString(getLocale(), { weekday: 'short' });
    svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${color}" opacity="0.86"/>`;
    svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#1a2e1a">${day}</text>`;
  });

  svg += `<text x="${W - PAD.right}" y="14" text-anchor="end" font-size="11" fill="#6b856b">Max: ${Math.round(max)} ${unit}</text>`;
  svg += '</svg>';
  el.innerHTML = svg;
}

// --- UTILS ---
function fmt(c) {
  return useMetricUnits()
    ? `${Math.round(c)}\u00B0C`
    : `${Math.round(cToF(c))}\u00B0F`;
}

function cToF(c) {
  return (Number(c) * 9 / 5) + 32;
}

function kphToMph(kph) {
  const n = Number(kph);
  if (!Number.isFinite(n)) return 0;
  return n * 0.621371;
}

function mmToInches(mm) {
  const n = Number(mm);
  if (!Number.isFinite(n)) return 0;
  return n * 0.0393701;
}

function metersToFeet(m) {
  const n = Number(m);
  if (!Number.isFinite(n)) return 0;
  return n * 3.28084;
}

function formatWind(kph) {
  const n = Number(kph);
  if (!Number.isFinite(n)) return '--';
  if (useMetricUnits()) return `${Math.round(n)} km/h`;
  return `${Math.round(kphToMph(n))} mph (${Math.round(n)} km/h)`;
}

function formatPrecip(mm) {
  const n = Number(mm);
  if (!Number.isFinite(n)) return '--';
  if (useMetricUnits()) return `${Math.round(n * 10) / 10} mm`;
  return `${mmToInches(n).toFixed(2)} in (${Math.round(n * 10) / 10} mm)`;
}

function formatElevation(meters) {
  const n = Number(meters);
  if (!Number.isFinite(n)) return '--';
  if (useMetricUnits()) return `${Math.round(n)} m`;
  return `${Math.round(metersToFeet(n)).toLocaleString(getLocale())} ft (${Math.round(n)} m)`;
}

function useMetricUnits() {
  return userSettings.units === 'metric';
}

function getLocale() {
  return userSettings.language || 'en-US';
}

function getLanguageCode() {
  return getLocale().split('-')[0];
}

function loadUserSettings() {
  const defaults = {
    language: 'en-US',
    units: 'us',
    localFocus: 'us',
    batterySaver: 'off',
    anonymousEmergency: 'off',
    emergencyWebhook: ''
  };

  try {
    const preferred = (navigator.language || '').toLowerCase();
    if (preferred.startsWith('es')) defaults.language = 'es-ES';
    if (preferred.startsWith('fr')) defaults.language = 'fr-FR';
  } catch {
    // Keep defaults when navigator is unavailable.
  }

  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      language: ['en-US', 'es-ES', 'fr-FR'].includes(parsed.language) ? parsed.language : defaults.language,
      units: ['us', 'metric'].includes(parsed.units) ? parsed.units : defaults.units,
      localFocus: ['us', 'global'].includes(parsed.localFocus) ? parsed.localFocus : defaults.localFocus,
      batterySaver: ['on', 'off'].includes(parsed.batterySaver) ? parsed.batterySaver : defaults.batterySaver,
      anonymousEmergency: ['on', 'off'].includes(parsed.anonymousEmergency) ? parsed.anonymousEmergency : defaults.anonymousEmergency,
      emergencyWebhook: typeof parsed.emergencyWebhook === 'string' ? parsed.emergencyWebhook : defaults.emergencyWebhook
    };
  } catch {
    return defaults;
  }
}

function saveUserSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures (private mode, quota, etc).
  }
}

function weatherIcon(code, isDay) {
  if (code === 0)  return isDay ? '\u2600\uFE0F' : '\uD83C\uDF19';
  if (code <= 2)   return isDay ? '\u26C5' : '\uD83C\uDF24\uFE0F';
  if (code === 3)  return '\u2601\uFE0F';
  if (code <= 49)  return '\uD83C\uDF2B\uFE0F';
  if (code <= 57)  return '\uD83C\uDF26\uFE0F';
  if (code <= 67)  return '\uD83C\uDF27\uFE0F';
  if (code <= 77)  return '\u2744\uFE0F';
  if (code <= 82)  return '\uD83C\uDF27\uFE0F';
  if (code <= 86)  return '\uD83C\uDF28\uFE0F';
  if (code >= 95)  return '\u26C8\uFE0F';
  return '\uD83C\uDF21\uFE0F';
}

function verdictDisplayLabel(verdict) {
  if (verdict === 'great') return 'Awesome';
  if (verdict === 'okay') return 'Excellent';
  if (verdict === 'bad') return 'Try Again Other Day';
  return 'Hazardous';
}

function uvLabel(uv) {
  if (uv == null) return '--';
  if (uv <= 2)  return `${uv.toFixed(1)} (Low)`;
  if (uv <= 5)  return `${uv.toFixed(1)} (Moderate)`;
  if (uv <= 7)  return `${uv.toFixed(1)} (High)`;
  if (uv <= 10) return `${uv.toFixed(1)} (Very High)`;
  return `${uv.toFixed(1)} (Extreme)`;
}

function formatTime(isoStr) {
  if (!isoStr) return '--';
  const d = new Date(isoStr);
  return d.toLocaleTimeString(getLocale(), { hour: 'numeric', minute: '2-digit', hour12: true });
}

function setState(state) {
  if (loading) loading.classList.add('hidden');
  if (errorEl) errorEl.classList.add('hidden');
  if (result) result.classList.add('hidden');
  if (state === 'loading' && loading) loading.classList.remove('hidden');
  if (state === 'result' && result) result.classList.remove('hidden');
}

function showError(msg) {
  setState('');
  if (errorMsg) errorMsg.textContent = msg;
  if (errorEl) errorEl.classList.remove('hidden');
}

// --- 7-DAY CHART ---
function renderChart(weather) {
  const { forecastDates, forecastMaxC, forecastMinC } = weather;
  const el = document.getElementById('forecastChart');
  if (!el || !forecastDates || !forecastMaxC || !forecastMinC) return;

  const W = 700;
  const H = 200;
  const PAD = { top: 28, right: 20, bottom: 34, left: 40 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const allC = [...forecastMaxC, ...forecastMinC];
  const tMinC = Math.floor(Math.min(...allC)) - 2;
  const tMaxC = Math.ceil(Math.max(...allC)) + 2;
  const tRange = Math.max(1, tMaxC - tMinC);

  const toY = c => PAD.top + cH * (1 - (c - tMinC) / tRange);
  const toX = i => PAD.left + (i + 0.5) * (cW / forecastDates.length);

  const days = forecastDates.map(d => {
    const dt = new Date(`${d}T12:00:00`);
    return dt.toLocaleDateString(getLocale(), { weekday: 'short' });
  });

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`;

  const stepC = tRange > 24 ? 10 : tRange > 12 ? 5 : 3;
  for (let c = Math.ceil(tMinC / stepC) * stepC; c <= tMaxC; c += stepC) {
    const y = toY(c).toFixed(1);
    const axisLabel = useMetricUnits() ? `${Math.round(c)}\u00B0` : `${Math.round(cToF(c))}\u00B0`;
    svg += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#d4e0d4" stroke-width="1"/>`;
    svg += `<text x="${PAD.left - 6}" y="${(parseFloat(y) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#6b856b">${axisLabel}</text>`;
  }

  const highPts = forecastMaxC.map((c, i) => `${toX(i).toFixed(1)},${toY(c).toFixed(1)}`).join(' ');
  const lowPts = forecastMinC.map((c, i) => `${toX(i).toFixed(1)},${toY(c).toFixed(1)}`).join(' ');

  svg += `<polyline points="${highPts}" fill="none" stroke="#e53935" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  svg += `<polyline points="${lowPts}" fill="none" stroke="#1976d2" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;

  forecastMaxC.forEach((c, i) => {
    const x = toX(i).toFixed(1);
    const y = toY(c).toFixed(1);
    svg += `<circle cx="${x}" cy="${y}" r="3.8" fill="#e53935"/>`;
  });

  forecastMinC.forEach((c, i) => {
    const x = toX(i).toFixed(1);
    const y = toY(c).toFixed(1);
    svg += `<circle cx="${x}" cy="${y}" r="3.8" fill="#1976d2"/>`;
  });

  days.forEach((day, i) => {
    svg += `<text x="${toX(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#1a2e1a" font-weight="600">${day}</text>`;
  });

  svg += '</svg>';
  el.innerHTML = svg;
}
