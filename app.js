// HikeRight -- app.js
// Uses: Nominatim (OpenStreetMap) for geocoding  [free, no key]
//       Open-Meteo for weather                   [free, no key]

const input   = document.getElementById('locationInput');
const btn     = document.getElementById('checkBtn');
const hikeDateInput = document.getElementById('hikeDateInput');
const seasonSelect = document.getElementById('seasonSelect');
const loading = document.getElementById('loadingState');
const errorEl = document.getElementById('errorState');
const errorMsg= document.getElementById('errorMsg');
const result  = document.getElementById('resultCard');
const moreBtn = document.getElementById('moreBtn');
const morePanel = document.getElementById('morePanel');
const plannerOpenBtn = document.getElementById('plannerOpenBtn');
const continentSelect = document.getElementById('placeContinent');
const countrySelect = document.getElementById('placeCountry');
const placeCountEl = document.getElementById('placeCount');
const isResultPage = document.body && document.body.dataset.page === 'result';
const isFileOrigin = window.location.protocol === 'file:';

let runInFlight = false;

if (btn) btn.addEventListener('click', run);
if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });

document.querySelectorAll('.hike-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (!input) return;
    markSelectedTab(tab);
    input.value = tab.dataset.query;
    run();
  });
});

setupPlaceOrganizer();
setupMoreToggle();
setupHikeDateInput();

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

    placeCountEl.textContent = `Showing ${shown} place${shown === 1 ? '' : 's'}`;
  };

  continentSelect.addEventListener('change', () => {
    updateCountryOptions();
    applyPlaceFilter();
  });

  countrySelect.addEventListener('change', applyPlaceFilter);

  updateCountryOptions();
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

  // Open-Meteo geocoding is browser-friendly and should be used first.
  for (const q of queries) {
    const hit = await geocodeWithOpenMeteo(q);
    if (hit) return hit;
  }

  // Nominatim often blocks file:// origins and can rate-limit; keep as best-effort fallback.
  if (isFileOrigin) return null;

  for (const q of queries) {
    const hit = await geocodeWithNominatim(q);
    if (hit) return hit;
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
      res = await fetch(url, { headers: { 'Accept-Language': 'en' }, signal: controller.signal });
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
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
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
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day,relative_humidity_2m`
    + `&daily=sunrise,sunset,precipitation_sum,wind_speed_10m_max,temperature_2m_max,temperature_2m_min,weather_code,uv_index_max`
    + `&timezone=auto`
    + `&forecast_days=7`;
  const res  = await fetch(url);
  const data = await res.json();
  const c = data.current;
  const d = data.daily;
  return {
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

  if (tempC <= -20 || dailyMinTemp <= -20) {
    score += 4; warnings.push(`Extremely cold -- current ${fmt(tempC)}. Frostbite risk is HIGH.`);
  } else if (tempC <= -10 || dailyMinTemp <= -10) {
    score += 3; warnings.push(`Very cold temperatures (${fmt(tempC)}). Heavy insulation required.`);
  } else if (tempC <= 0 || dailyMinTemp <= 0) {
    score += 2; warnings.push(`Freezing temperatures -- trails may be icy or snow-covered.`);
  } else if (tempC <= 8 || dailyMinTemp <= 5) {
    score += 1; warnings.push(`Cold hiking window (${fmt(tempC)}). Warm layers and gloves are recommended.`);
  } else if (tempC >= 38) {
    score += 3; warnings.push(`Extreme heat (${fmt(tempC)}). High risk of heat stroke.`);
  } else if (tempC >= 32) {
    score += 2; warnings.push(`Very hot (${fmt(tempC)}). Carry extra water and hike early.`);
  }

  if (weather.uvIndex != null) {
    if (weather.uvIndex >= 11) {
      score += 2;
      warnings.push(`Extreme UV index (${weather.uvIndex.toFixed(1)}). Sun exposure risk is high.`);
    } else if (weather.uvIndex >= 8) {
      score += 1;
      warnings.push(`Very high UV index (${weather.uvIndex.toFixed(1)}). Sun protection is required.`);
    }
  }

  if (dailyMaxWind >= 80 || windKph >= 80) {
    score += 4; warnings.push(`Dangerous wind speeds (${Math.round(windKph)} km/h). High risk of falling or flying debris.`);
  } else if (dailyMaxWind >= 50 || windKph >= 50) {
    score += 2; warnings.push(`Strong winds (${Math.round(windKph)} km/h) can make footing unstable on exposed ridges.`);
  } else if (windKph >= 30) {
    score += 1; warnings.push(`Moderate winds (${Math.round(windKph)} km/h). Be cautious on open terrain.`);
  }

  if (code === 99) {
    score += 5; warnings.push('Thunderstorm with hail reported. DO NOT hike -- seek shelter immediately.');
  } else if (code >= 95) {
    score += 4; warnings.push('Active thunderstorm in the area. Lightning risk is severe on exposed trails.');
  } else if (code >= 71 && code <= 77) {
    score += 3; warnings.push('Snowfall reported. Trails may be buried and navigation very difficult.');
  } else if ((code >= 61 && code <= 67) || precip > 5) {
    score += 2; warnings.push('Moderate to heavy rain. Trails will be muddy and slippery.');
  } else if ((code >= 51 && code <= 57) || precip > 0) {
    score += 1; warnings.push('Light rain or drizzle. Waterproof gear recommended.');
  }

  if (dailyPrecip >= 6 && code < 61) {
    score += 2;
    warnings.push(`Forecast suggests notable rainfall later today (${dailyPrecip} mm).`);
  } else if (dailyPrecip >= 2 && code < 51) {
    score += 1;
    warnings.push(`Rain is likely later today (${dailyPrecip} mm forecast).`);
  }

  if (elevation >= 4000) {
    score += 2;
    warnings.push(`Very high elevation (${Math.round(elevation)} m). Altitude sickness risk -- acclimatize first.`);
    tips.push('Ascend slowly and watch for symptoms of altitude sickness (headache, nausea, dizziness).');
  } else if (elevation >= 2500) {
    score += 1;
    warnings.push(`High elevation (${Math.round(elevation)} m). Weather can change rapidly.`);
    tips.push('Carry extra layers -- high-altitude weather is unpredictable.');
  }

  if (tempC <= 5) { tips.push('Wear moisture-wicking base layers and an insulating mid-layer.'); tips.push('Pack hand warmers and keep your extremities covered.'); }
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
    message = `Do NOT hike here right now. Conditions at ${weatherLabel(code)} with ${fmt(tempC)} and ${Math.round(windKph)} km/h winds make this trail extremely dangerous. Postpone your trip.`;
  } else if (score >= 4) {
    verdict = 'bad';
    message = `Not a great day to hike here. ${weatherLabel(code)} conditions, ${fmt(tempC)} temperatures, and ${Math.round(windKph)} km/h winds create significant hazards. Consider rescheduling or pick a sheltered trail.`;
  } else if (score >= 2) {
    verdict = 'okay';
    message = `Hikeable, but proceed with caution. Conditions are ${weatherLabel(code).toLowerCase()} at ${fmt(tempC)}. Gear up properly and stay aware of changing weather.`;
  } else {
    verdict = 'great';
    message = `Great day to hit the trail! ${weatherLabel(code)} skies, ${fmt(tempC)} and light winds -- enjoy your hike at this location!`;
  }

  if (selectedSeason === 'winter') {
    if (verdict === 'great' || verdict === 'okay') {
      verdict = 'bad';
      message = 'Winter profile selected: hiking is not recommended right now for most trails unless you have full winter gear and route-specific experience.';
    }
  }

  if (rainLikely && verdict === 'great') {
    verdict = 'okay';
    message = 'Rain is likely, so this is not a great hiking window. If you still go, use waterproof gear and choose safer trail surfaces.';
  }

  if ((tempC <= 10 || dailyMinTemp <= 5 || (weather.uvIndex != null && weather.uvIndex >= 8)) && verdict === 'great') {
    verdict = 'okay';
    message = 'Conditions are not ideal enough for a Great rating. Use caution, protect against temperature and UV exposure, and choose route difficulty carefully.';
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

  if (desertLike) {
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
  const recommendedLabel = uniqueRecommended.join(' / ');

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

  if (end <= start) {
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
    ? new Date(`${bestDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })
    : 'Today';

  if (selectedDate) {
    const target = selectedDate.slice(0, 10);
    const inForecast = Array.isArray(weather.forecastDates) && weather.forecastDates.includes(target);
    if (inForecast) {
      day = new Date(`${target}T12:00:00`).toLocaleDateString('en-US', {
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeToMinutes(hhmm) {
  if (!hhmm || !hhmm.includes(':')) return null;
  const [h, m] = hhmm.split(':').map(n => parseInt(n, 10));
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
  badge.textContent = verdict === 'great' ? 'Great' : verdict === 'okay' ? 'Use Caution' : verdict === 'bad' ? 'Not Recommended' : 'Dangerous';
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

  // Hero -- Fahrenheit primary, Celsius small below
  const tF   = Math.round(weather.tempC * 9 / 5 + 32);
  const tC   = Math.round(weather.tempC);
  const flF  = Math.round((weather.feelsLike ?? weather.tempC) * 9 / 5 + 32);
  const minF = Math.round(weather.dailyMinTemp * 9 / 5 + 32);
  const maxF = Math.round(weather.dailyMaxTemp * 9 / 5 + 32);

  document.getElementById('heroTemp').innerHTML    = `${tF}&deg;F<small class="hero-temp-c">${tC}&deg;C</small>`;
  document.getElementById('heroFeels').textContent = `${flF}\u00B0F`;
  document.getElementById('heroRange').textContent = `${minF}\u00B0F / ${maxF}\u00B0F`;
  document.getElementById('heroIcon').textContent      = weatherIcon(weather.code, weather.isDay);
  document.getElementById('heroCondition').textContent = weatherLabel(weather.code);

  // Detail grid
  document.getElementById('dHumidity').textContent  = weather.humidity != null ? `${weather.humidity}%` : '--';
  document.getElementById('dWind').textContent      = `${Math.round(weather.windKph)} km/h`;
  document.getElementById('dPrecip').textContent    = `${weather.dailyPrecip ?? 0} mm`;
  document.getElementById('dUV').textContent        = uvLabel(weather.uvIndex);
  document.getElementById('dElevation').textContent = weather.elevation ? `${Math.round(weather.elevation)} m` : '--';
  document.getElementById('dSunrise').textContent   = weather.sunrise;
  document.getElementById('dSunset').textContent    = weather.sunset;
  document.getElementById('dMaxWind').textContent   = `${Math.round(weather.dailyMaxWind)} km/h`;

  const warnSection = document.getElementById('warningsList');
  const warnUl      = document.getElementById('warningsUl');
  warnUl.innerHTML = '';
  if (warnings.length) {
    warnings.forEach(w => { const li = document.createElement('li'); li.textContent = w; warnUl.appendChild(li); });
    warnSection.classList.remove('hidden');
  } else {
    warnSection.classList.add('hidden');
  }

  const tipsUl = document.getElementById('tipsUl');
  tipsUl.innerHTML = '';
  tips.slice(0, 5).forEach(t => { const li = document.createElement('li'); li.textContent = t; tipsUl.appendChild(li); });

  renderChart(weather);
  renderMoreInsights(geo, weather, verdict, selectedDate);
  setupPlannerLaunch(geo, selectedDate, selectedSeason);

}

function setupPlannerLaunch(geo, selectedDate = '', selectedSeason = 'auto') {
  if (!plannerOpenBtn || !geo) return;

  plannerOpenBtn.onclick = () => {
    const base = new URL('planner.html', window.location.href);
    base.searchParams.set('lat', String(geo.lat));
    base.searchParams.set('lon', String(geo.lon));
    base.searchParams.set('name', geo.name || 'Selected Location');
    base.searchParams.set('sub', geo.sub || '');
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
  renderMiniChart('precipChart', weather.forecastDates, weather.forecastPrecip, '#1976d2', 'mm');
  renderMiniChart('windChart', weather.forecastDates, weather.forecastMaxWindKph, '#ef6c00', 'km/h');

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
      `<a href="https://www.google.com/search?q=${encoded}+trail+reviews" target="_blank" rel="noopener noreferrer">Google Reviews</a>`,
      `<a href="https://www.alltrails.com/search?q=${encoded}" target="_blank" rel="noopener noreferrer">AllTrails</a>`,
      `<a href="https://www.tripadvisor.com/Search?q=${encoded}" target="_blank" rel="noopener noreferrer">Tripadvisor</a>`
    ].join('');
  }
}

function buildCredibleNotes(geo, weather, verdict, selectedDate = '') {
  const notes = [];
  const place = `${geo?.name || 'This location'}${geo?.sub ? ` (${geo.sub})` : ''}`;

  notes.push(`Data source: Open-Meteo forecast for ${place}.`);
  notes.push('Geocoding source: Nominatim/Open-Meteo place matching.');
  if (selectedDate) {
    notes.push(`Planned hike date: ${formatSelectedDate(selectedDate)}.`);
  }
  notes.push(`Current safety verdict: ${verdict.toUpperCase()} based on measurable weather fields (temperature, precipitation, wind, UV, and elevation).`);
  notes.push('Community reviews are not generated in-app. Use the links below to read real user reviews and trail reports.');

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
    const day = new Date(`${labels[i]}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
    svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${color}" opacity="0.86"/>`;
    svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#1a2e1a">${day}</text>`;
  });

  svg += `<text x="${W - PAD.right}" y="14" text-anchor="end" font-size="11" fill="#6b856b">Max: ${Math.round(max)} ${unit}</text>`;
  svg += '</svg>';
  el.innerHTML = svg;
}

// --- UTILS ---
function fmt(c) { return `${Math.round(c * 9 / 5 + 32)}\u00B0F`; }

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
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
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
    return dt.toLocaleDateString('en-US', { weekday: 'short' });
  });

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`;

  const stepC = tRange > 24 ? 10 : tRange > 12 ? 5 : 3;
  for (let c = Math.ceil(tMinC / stepC) * stepC; c <= tMaxC; c += stepC) {
    const y = toY(c).toFixed(1);
    const f = Math.round(c * 9 / 5 + 32);
    svg += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#d4e0d4" stroke-width="1"/>`;
    svg += `<text x="${PAD.left - 6}" y="${(parseFloat(y) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#6b856b">${f}°</text>`;
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
