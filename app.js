// HikeRight – app.js
// Uses: Nominatim (OpenStreetMap) for geocoding  [free, no key]
//       Open-Meteo for weather                   [free, no key]

const input   = document.getElementById('locationInput');
const btn     = document.getElementById('checkBtn');
const loading = document.getElementById('loadingState');
const errorEl = document.getElementById('errorState');
const errorMsg= document.getElementById('errorMsg');
const result  = document.getElementById('resultCard');

btn.addEventListener('click', run);
input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });

async function run() {
  const query = input.value.trim();
  if (!query) return;

  setState('loading');

  try {
    // 1. Geocode
    const geo = await geocode(query);
    if (!geo) { showError("Couldn't find that location. Try being more specific."); return; }

    // 2. Get weather
    const weather = await getWeather(geo.lat, geo.lon, geo.elevation);

    // 3. Analyse & render
    renderResult(geo, weather);
    setState('result');
  } catch (err) {
    console.error(err);
    showError("Something went wrong fetching data. Check your connection.");
  }
}

// ─── GEOCODING ────────────────────────────────────────────────────────────────
async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
  const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  if (!data.length) return null;

  const r = data[0];
  const addr = r.address || {};
  const sub  = [addr.country, addr.state || addr.region].filter(Boolean).join(', ');

  return {
    lat:       parseFloat(r.lat),
    lon:       parseFloat(r.lon),
    name:      r.name || r.display_name.split(',')[0],
    sub:       sub || r.display_name,
    elevation: null, // will be filled by Open-Meteo
  };
}

// ─── WEATHER ──────────────────────────────────────────────────────────────────
async function getWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,precipitation,weathercode,windspeed_10m,is_day`
    + `&daily=sunrise,sunset,precipitation_sum,windspeed_10m_max,temperature_2m_max,temperature_2m_min,weathercode`
    + `&elevation=true`
    + `&timezone=auto`
    + `&forecast_days=1`;

  const res  = await fetch(url);
  const data = await res.json();

  const c = data.current;
  const d = data.daily;

  return {
    elevation:    data.elevation,
    tempC:        c.temperature_2m,
    precip:       c.precipitation,
    windKph:      c.windspeed_10m,
    code:         c.weathercode,
    isDay:        c.is_day,
    sunrise:      formatTime(d.sunrise[0]),
    sunset:       formatTime(d.sunset[0]),
    dailyMaxTemp: d.temperature_2m_max[0],
    dailyMinTemp: d.temperature_2m_min[0],
    dailyPrecip:  d.precipitation_sum[0],
    dailyMaxWind: d.windspeed_10m_max[0],
    dailyCode:    d.weathercode[0],
  };
}

// ─── WEATHER CODE → LABEL ─────────────────────────────────────────────────────
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

// ─── ANALYSIS ─────────────────────────────────────────────────────────────────
function analyse(weather) {
  const { tempC, windKph, precip, code, elevation, dailyMaxWind, dailyMinTemp, dailyMaxTemp, dailyPrecip } = weather;
  const warnings = [];
  const tips     = [];
  let   score    = 0; // higher = worse

  // Temperature
  if (tempC <= -20 || dailyMinTemp <= -20) {
    score += 4;
    warnings.push(`Extremely cold — current ${fmt(tempC)}. Frostbite risk is HIGH.`);
  } else if (tempC <= -10 || dailyMinTemp <= -10) {
    score += 3;
    warnings.push(`Very cold temperatures (${fmt(tempC)}). Heavy insulation required.`);
  } else if (tempC <= 0 || dailyMinTemp <= 0) {
    score += 2;
    warnings.push(`Freezing temperatures — trails may be icy or snow-covered.`);
  } else if (tempC >= 38) {
    score += 3;
    warnings.push(`Extreme heat (${fmt(tempC)}). High risk of heat stroke.`);
  } else if (tempC >= 32) {
    score += 2;
    warnings.push(`Very hot (${fmt(tempC)}). Carry extra water and hike early.`);
  }

  // Wind
  if (dailyMaxWind >= 80 || windKph >= 80) {
    score += 4;
    warnings.push(`Dangerous wind speeds (${Math.round(windKph)} km/h). High risk of falling or flying debris.`);
  } else if (dailyMaxWind >= 50 || windKph >= 50) {
    score += 2;
    warnings.push(`Strong winds (${Math.round(windKph)} km/h) can make footing unstable on exposed ridges.`);
  } else if (windKph >= 30) {
    score += 1;
    warnings.push(`Moderate winds (${Math.round(windKph)} km/h). Be cautious on open terrain.`);
  }

  // Precipitation / weather code
  if (code === 99) {
    score += 5;
    warnings.push('Thunderstorm with hail reported. DO NOT hike — seek shelter immediately.');
  } else if (code >= 95) {
    score += 4;
    warnings.push('Active thunderstorm in the area. Lightning risk is severe on exposed trails.');
  } else if (code >= 71 && code <= 77) {
    score += 3;
    warnings.push('Snowfall reported. Trails may be buried and navigation very difficult.');
  } else if ((code >= 61 && code <= 67) || precip > 5) {
    score += 2;
    warnings.push('Moderate to heavy rain. Trails will be muddy and slippery.');
  } else if ((code >= 51 && code <= 57) || precip > 0) {
    score += 1;
    warnings.push('Light rain or drizzle. Waterproof gear recommended.');
  }

  // Elevation
  if (elevation >= 4000) {
    score += 2;
    warnings.push(`Very high elevation (${Math.round(elevation)} m). Altitude sickness risk — acclimatize first.`);
    tips.push('Ascend slowly and watch for symptoms of altitude sickness (headache, nausea, dizziness).');
  } else if (elevation >= 2500) {
    score += 1;
    warnings.push(`High elevation (${Math.round(elevation)} m). Weather can change rapidly.`);
    tips.push('Carry extra layers — high-altitude weather is unpredictable.');
  }

  // Tips based on conditions
  if (tempC <= 5) {
    tips.push('Wear moisture-wicking base layers and an insulating mid-layer.');
    tips.push('Pack hand warmers and keep your extremities covered.');
  }
  if (tempC >= 28) {
    tips.push('Start your hike at dawn to avoid peak heat.');
    tips.push('Carry at least 0.5L of water per hour of hiking.');
  }
  if (code >= 95) {
    tips.push('Check the forecast every hour on days with storm risk.');
  }
  if (windKph >= 30) {
    tips.push('Secure loose clothing and gear. Avoid exposed ridgelines if possible.');
  }
  if (precip > 0 || (code >= 51 && code <= 82)) {
    tips.push('Waterproof boots and a rain jacket are essential today.');
    tips.push('Trekking poles help on slippery, wet trails.');
  }

  // Default tips
  tips.push('Always tell someone your route and expected return time.');
  tips.push('Carry a fully charged phone and a paper map as backup.');
  if (tips.length < 4) tips.push('Check trail-specific conditions on AllTrails or local park websites.');

  // Verdict
  let verdict, message;
  if (score >= 7) {
    verdict = 'dangerous';
    message = `⛔ Do NOT hike here right now. Conditions at ${weatherLabel(code)} with ${fmt(tempC)} and ${Math.round(windKph)} km/h winds make this trail extremely dangerous. Postpone your trip.`;
  } else if (score >= 4) {
    verdict = 'bad';
    message = `🔴 Not a great day to hike here. ${weatherLabel(code)} conditions, ${fmt(tempC)} temperatures, and ${Math.round(windKph)} km/h winds create significant hazards. Consider rescheduling or pick a sheltered trail.`;
  } else if (score >= 2) {
    verdict = 'okay';
    message = `🟡 Hikeable, but proceed with caution. Conditions are ${weatherLabel(code).toLowerCase()} at ${fmt(tempC)}. Gear up properly and stay aware of changing weather.`;
  } else {
    verdict = 'great';
    message = `🟢 Great day to hit the trail! ${weatherLabel(code)} skies, ${fmt(tempC)} and light winds — enjoy your hike at this location!`;
  }

  return { verdict, message, warnings, tips };
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
function renderResult(geo, weather) {
  const { verdict, message, warnings, tips } = analyse(weather);

  document.getElementById('locationName').textContent = geo.name;
  document.getElementById('locationSub').textContent  = geo.sub;

  const badge = document.getElementById('verdictBadge');
  badge.textContent = verdict === 'great' ? '✅ Great'
    : verdict === 'okay' ? '⚠️ Use Caution'
    : verdict === 'bad'  ? '🚫 Not Recommended'
    : '⛔ Dangerous';
  badge.className = `verdict-badge ${verdict}`;

  const msgEl = document.getElementById('verdictMessage');
  msgEl.textContent = message;
  msgEl.className = `verdict-message ${verdict}`;

  document.getElementById('wTemp').textContent      = `${fmt(weather.tempC)} (feels ${fmt(weather.dailyMinTemp)}–${fmt(weather.dailyMaxTemp)})`;
  document.getElementById('wPrecip').textContent    = `${weather.precip} mm now / ${weather.dailyPrecip} mm today`;
  document.getElementById('wWind').textContent      = `${Math.round(weather.windKph)} km/h (max ${Math.round(weather.dailyMaxWind)} km/h)`;
  document.getElementById('wCondition').textContent = weatherLabel(weather.code);
  document.getElementById('wSunrise').textContent   = weather.sunrise;
  document.getElementById('wSunset').textContent    = weather.sunset;

  const warnSection = document.getElementById('warningsList');
  const warnUl      = document.getElementById('warningsUl');
  warnUl.innerHTML = '';
  if (warnings.length) {
    warnings.forEach(w => {
      const li = document.createElement('li');
      li.textContent = w;
      warnUl.appendChild(li);
    });
    warnSection.classList.remove('hidden');
  } else {
    warnSection.classList.add('hidden');
  }

  const tipsUl = document.getElementById('tipsUl');
  tipsUl.innerHTML = '';
  tips.slice(0, 5).forEach(t => {
    const li = document.createElement('li');
    li.textContent = t;
    tipsUl.appendChild(li);
  });

  document.getElementById('elevationNote').textContent =
    weather.elevation ? `📍 Elevation at this location: ~${Math.round(weather.elevation)} m above sea level` : '';
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function fmt(c) { return `${Math.round(c)}°C`; }

function formatTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function setState(state) {
  loading.classList.toggle('hidden', state !== 'loading');
  errorEl.classList.add('hidden');
  result.classList.toggle('hidden', state !== 'result');
}

function showError(msg) {
  errorMsg.textContent = msg;
  loading.classList.add('hidden');
  result.classList.add('hidden');
  errorEl.classList.remove('hidden');
}
