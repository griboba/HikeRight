👋 Hi I'm Griboba
I Am Going To Present... HikeRight!

HikeRight is a lightweight hiking weather and safety web app.

It helps you:
- Search a hiking location
- View current conditions and 7-day forecast-based guidance
- Pick a safer hike date in the built-in planner
- Export a planned date to calendar (.ics)
- Use a Safety Lifeline center for offline packs, check-ins, and emergency prep

## Live Site

https://griboba.github.io/HikeRight/

## Features

- Fast location search with Open-Meteo geocoding
- Weather-based safety verdicts (Great, Okay, Bad)
- Date planner with per-day risk evaluation
- Warnings for rain, wind, heat, cold, and storm signals
- "Save to Calendar" export for hike dates
- Progressive Web App manifest + service worker shell caching for offline use
- Offline-first safety pack save (trail briefing + prefetched topo tiles)
- NOAA active weather alert overlay (U.S. coverage)
- Terrain difficulty scoring (1-10) based on weather + elevation risk
- Cell coverage breadcrumb tracker (signal-quality trail)
- Extreme battery saver mode (lower-accuracy, lower-frequency GPS behavior)
- Turn-around timer + water target calculator
- Interactive "10 Essentials" checklist with local persistence
- Offline survival guide cards
- Privacy controls for anonymous emergency payload mode

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript
- Open-Meteo APIs (geocoding + forecast)

## Project Structure

- `index.html`: Search page
- `result.html`: Main result and recommendations
- `planner.html`: Date planner page
- `app.js`: Core search + weather + recommendation logic
- `planner.js`: Planner/date-risk logic and .ics export
- `style.css`: Shared styling

## Local Development

Open `index.html` directly in your browser, or use a local static server.

Example (Python):

```bash
python -m http.server 8000
```

Then open:

http://localhost:8000/

## Notes

- Forecast guidance is based on a 7-day weather window.
- For dates outside the forecast range, safety will be shown as limited/unknown until forecast data is available.
- Dead Man's Switch alert escalation is server-assisted when using an emergency webhook URL. For guaranteed out-of-range or phone-dead escalation, pair HikeRight with a dedicated backend/SMS service and satellite communicator.

## Safety Disclaimer

HikeRight is for informational purposes only and is not an authoritative safety source.
Weather and trail conditions can change quickly. Always verify forecasts, official advisories,
trail closures, and local ranger guidance before hiking. You are responsible for your own
planning decisions and personal safety.

## License

Add your preferred license in a `LICENSE` file (MIT is a common choice for public projects).
