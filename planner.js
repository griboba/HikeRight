const plannerCard = document.getElementById('plannerCard');
const plannerError = document.getElementById('plannerError');
const plannerErrorText = document.getElementById('plannerErrorText');
const plannerLocationName = document.getElementById('plannerLocationName');
const plannerLocationSub = document.getElementById('plannerLocationSub');
const plannerCalendarGrid = document.getElementById('plannerCalendarGrid');
const plannerDateInput = document.getElementById('plannerDateInput');
const plannerVerdict = document.getElementById('plannerVerdict');
const plannerChosenDate = document.getElementById('plannerChosenDate');
const plannerSafetyLevel = document.getElementById('plannerSafetyLevel');
const plannerBetterDate = document.getElementById('plannerBetterDate');
const plannerWarnings = document.getElementById('plannerWarnings');
const plannerWarningsUl = document.getElementById('plannerWarningsUl');

let weather = null;
let selectedIsoDate = '';

initPlanner();

async function initPlanner() {
  let payload = null;

  const params = new URLSearchParams(window.location.search);
  const latRaw = params.get('lat');
  const lonRaw = params.get('lon');

  if (latRaw && lonRaw) {
    const lat = Number.parseFloat(latRaw);
    const lon = Number.parseFloat(lonRaw);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const weatherFromCoords = await getWeatherForPlanner(lat, lon);
      if (weatherFromCoords) {
        payload = {
          geo: {
            lat,
            lon,
            name: params.get('name') || 'Selected Location',
            sub: params.get('sub') || ''
          },
          weather: weatherFromCoords,
          selectedDate: params.get('date') || ''
        };
      }
    }
  }

  if (!payload) {
    const raw = sessionStorage.getItem('hikeRightResult');
    if (!raw) {
      showPlannerError('No result data found. Go back and check a location first.');
      return;
    }

    try {
      payload = JSON.parse(raw);
    } catch {
      showPlannerError('Could not read saved result data. Go back and run a new check.');
      return;
    }
  }

  if (!payload.geo || !payload.weather || !Array.isArray(payload.weather.forecastDates)) {
    showPlannerError('Saved result is incomplete for date planning. Run a new location check first.');
    return;
  }

  weather = payload.weather;

  plannerLocationName.textContent = `Date Planner: ${payload.geo.name || 'Selected Location'}`;
  plannerLocationSub.textContent = payload.geo.sub || 'Select a date below';

  setupDateInput(payload.selectedDate || payload.weather.forecastDates[0]);
  renderCalendar(payload.weather.forecastDates);

  const defaultDate = payload.selectedDate && payload.selectedDate.length >= 10
    ? payload.selectedDate.slice(0, 10)
    : payload.weather.forecastDates[0];

  selectDate(defaultDate);

  plannerDateInput.addEventListener('change', () => {
    selectDate(plannerDateInput.value);
  });

  plannerCard.classList.remove('hidden');
}

async function getWeatherForPlanner(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast`
      + `?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day,relative_humidity_2m`
      + `&daily=sunrise,sunset,precipitation_sum,wind_speed_10m_max,temperature_2m_max,temperature_2m_min,weather_code,uv_index_max`
      + `&timezone=auto`
      + `&forecast_days=7`;

    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const c = data.current;
    const d = data.daily;
    if (!c || !d || !Array.isArray(d.time)) return null;

    return {
      tempC: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      precip: c.precipitation,
      windKph: c.wind_speed_10m,
      code: c.weather_code,
      isDay: c.is_day,
      humidity: c.relative_humidity_2m,
      uvIndex: d.uv_index_max ? d.uv_index_max[0] : null,
      sunrise: d.sunrise ? d.sunrise[0] : null,
      sunset: d.sunset ? d.sunset[0] : null,
      dailyMaxTemp: d.temperature_2m_max ? d.temperature_2m_max[0] : null,
      dailyMinTemp: d.temperature_2m_min ? d.temperature_2m_min[0] : null,
      dailyPrecip: d.precipitation_sum ? d.precipitation_sum[0] : null,
      dailyMaxWind: d.wind_speed_10m_max ? d.wind_speed_10m_max[0] : null,
      dailyCode: d.weather_code ? d.weather_code[0] : null,
      forecastDates: d.time,
      forecastMaxC: d.temperature_2m_max || [],
      forecastMinC: d.temperature_2m_min || [],
      forecastPrecip: d.precipitation_sum || [],
      forecastMaxWindKph: d.wind_speed_10m_max || [],
      forecastWeatherCode: d.weather_code || []
    };
  } catch {
    return null;
  }
}

function setupDateInput(defaultIsoDate) {
  if (!plannerDateInput) return;
  const today = new Date();
  const isoToday = toIsoDate(today);
  plannerDateInput.min = isoToday;
  plannerDateInput.value = defaultIsoDate && defaultIsoDate.length >= 10 ? defaultIsoDate.slice(0, 10) : isoToday;
}

function renderCalendar(forecastDates) {
  plannerCalendarGrid.innerHTML = '';

  forecastDates.forEach(isoDate => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'planner-day-btn';
    btn.dataset.date = isoDate;

    const dateObj = new Date(`${isoDate}T12:00:00`);
    const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
    const label = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    btn.innerHTML = `<span class="planner-day-week">${weekday}</span><span class="planner-day-date">${label}</span>`;
    btn.addEventListener('click', () => {
      plannerDateInput.value = isoDate;
      selectDate(isoDate);
    });

    plannerCalendarGrid.appendChild(btn);
  });
}

function selectDate(isoDate) {
  if (!isoDate) return;
  selectedIsoDate = isoDate.slice(0, 10);
  updateCalendarSelection();

  const inForecast = weather.forecastDates.some(d => String(d).slice(0, 10) === selectedIsoDate);
  const profile = inForecast ? evaluateForecastDate(selectedIsoDate) : null;

  plannerChosenDate.textContent = formatDateLong(selectedIsoDate);

  if (!inForecast) {
    plannerSafetyLevel.textContent = 'Unknown';
    plannerBetterDate.textContent = closestGoodDateText(weather.forecastDates[0], weather);
    plannerVerdict.className = 'verdict-message okay';
    plannerVerdict.textContent = 'Chosen date is outside the 7-day forecast. Safety cannot be verified yet. Pick a nearby forecast date for a reliable warning.';
    renderWarnings([
      'This date is outside the available forecast range.',
      'Weather can shift quickly before this date.',
      'Use a date inside the custom forecast calendar for credible warning output.'
    ]);
    return;
  }

  plannerSafetyLevel.textContent = profile.level;

  if (profile.level === 'Good') {
    plannerBetterDate.textContent = 'Your chosen date is already strong';
    plannerVerdict.className = 'verdict-message great';
    plannerVerdict.textContent = 'This date looks like one of the safer options in the current forecast window.';
  } else if (profile.level === 'Caution') {
    plannerBetterDate.textContent = closestGoodDateText(selectedIsoDate, weather);
    plannerVerdict.className = 'verdict-message okay';
    plannerVerdict.textContent = 'This date is hikeable with caution. Review warnings and consider a nearby safer date.';
  } else {
    plannerBetterDate.textContent = closestGoodDateText(selectedIsoDate, weather);
    plannerVerdict.className = 'verdict-message bad';
    plannerVerdict.textContent = 'This is a bad hike date based on forecast risk factors. Consider the closest better date shown.';
  }

  renderWarnings(profile.warnings);
  if (plannerSaveRow) plannerSaveRow.classList.remove('hidden');
}

function updateCalendarSelection() {
  document.querySelectorAll('.planner-day-btn').forEach(btn => {
    btn.classList.toggle('selected', String(btn.dataset.date).slice(0, 10) === selectedIsoDate);
  });
}

function evaluateForecastDate(isoDate) {
  const i = weather.forecastDates.findIndex(d => String(d).slice(0, 10) === isoDate);
  const maxC = weather.forecastMaxC?.[i] ?? weather.tempC;
  const minC = weather.forecastMinC?.[i] ?? weather.dailyMinTemp;
  const precip = weather.forecastPrecip?.[i] ?? weather.dailyPrecip ?? 0;
  const wind = weather.forecastMaxWindKph?.[i] ?? weather.dailyMaxWind ?? 0;
  const code = weather.forecastWeatherCode?.[i] ?? weather.dailyCode ?? weather.code ?? 0;

  let score = 0;
  const warnings = [];

  if (minC <= 0) { score += 2; warnings.push('Freezing overnight temperatures increase ice risk.'); }
  else if (minC <= 5) { score += 1; warnings.push('Cold morning temperatures may require extra layers.'); }

  if (maxC >= 32) { score += 2; warnings.push('Very hot daytime temperatures increase heat stress risk.'); }
  else if (maxC >= 28) { score += 1; warnings.push('Warm daytime conditions require hydration planning.'); }

  if (wind >= 50) { score += 2; warnings.push('Strong winds can be dangerous on exposed sections.'); }
  else if (wind >= 35) { score += 1; warnings.push('Noticeable wind may reduce stability on ridges.'); }

  if (precip >= 8) { score += 2; warnings.push('Heavy rain forecast can make trails slippery and unsafe.'); }
  else if (precip >= 3) { score += 1; warnings.push('Rain forecast may cause muddy trail surfaces.'); }

  if (code >= 95) { score += 3; warnings.push('Thunderstorm risk forecast for this date.'); }
  else if (code >= 71 && code <= 77) { score += 2; warnings.push('Snow forecast can impact visibility and traction.'); }
  else if (code >= 61 && code <= 67) { score += 1; warnings.push('Rain conditions expected during this date.'); }

  if (!warnings.length) warnings.push('No major weather red flags detected in the current forecast.');

  const level = score <= 1 ? 'Good' : score <= 3 ? 'Caution' : 'Bad';
  return { level, score, warnings };
}

function closestGoodDateText(chosenIsoDate, wx) {
  const chosenIndex = wx.forecastDates.findIndex(d => String(d).slice(0, 10) === chosenIsoDate);
  const profiles = wx.forecastDates.map(date => ({
    date,
    ...evaluateForecastDate(date)
  }));

  const goodDates = profiles.filter(p => p.level === 'Good');
  if (goodDates.length) {
    let best = goodDates[0];
    let bestDistance = Math.abs(wx.forecastDates.indexOf(best.date) - Math.max(chosenIndex, 0));

    goodDates.forEach(item => {
      const dist = Math.abs(wx.forecastDates.indexOf(item.date) - Math.max(chosenIndex, 0));
      if (dist < bestDistance) {
        best = item;
        bestDistance = dist;
      }
    });

    return `${formatDateLong(best.date)} (${best.level})`;
  }

  const sorted = profiles
    .slice()
    .sort((a, b) => a.score - b.score);

  if (!sorted.length) return 'No nearby forecast date available';
  return `${formatDateLong(sorted[0].date)} (${sorted[0].level})`;
}

function renderWarnings(items) {
  plannerWarningsUl.innerHTML = '';
  items.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    plannerWarningsUl.appendChild(li);
  });
  plannerWarnings.classList.remove('hidden');
}

function showPlannerError(message) {
  plannerErrorText.textContent = message;
  plannerError.classList.remove('hidden');
  plannerCard.classList.add('hidden');
}

function formatDateLong(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function toIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- SAVE TO CALENDAR ---
const plannerSaveRow = document.getElementById('plannerSaveRow');
const plannerSaveCalBtn = document.getElementById('plannerSaveCalBtn');

if (plannerSaveCalBtn) {
  plannerSaveCalBtn.addEventListener('click', () => {
    if (!selectedIsoDate) return;
    const locationName = plannerLocationName
      ? plannerLocationName.textContent.replace(/^Date Planner:\s*/i, '').trim()
      : 'Hike';
    const safetyText = plannerSafetyLevel ? plannerSafetyLevel.textContent : '';
    const warnings = Array.from(plannerWarningsUl ? plannerWarningsUl.querySelectorAll('li') : []).map(li => li.textContent);
    downloadIcs(selectedIsoDate, locationName, safetyText, warnings);
  });
}

function downloadIcs(isoDate, locationName, safetyLevel, warnings) {
  const dateStamp = isoDate.replace(/-/g, '');
  const now = new Date();
  const dtstamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const summary = `Hike: ${locationName}`;
  const descLines = [`Safety Level: ${safetyLevel || 'Unknown'}`];
  if (warnings && warnings.length) {
    descLines.push('Warnings:');
    warnings.forEach(w => descLines.push(`- ${w}`));
  }
  const description = descLines.join('\n').replace(/\n/g, '\\n');

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HikeRight//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `DTSTART;VALUE=DATE:${dateStamp}`,
    `DTEND;VALUE=DATE:${dateStamp}`,
    `DTSTAMP:${dtstamp}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `UID:hikeright-${dateStamp}-${Math.random().toString(36).slice(2)}@hikeright`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hike-${locationName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${isoDate}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
