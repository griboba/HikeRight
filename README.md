# HikeRight

HikeRight is a lightweight hiking weather and safety web app.

It helps you:
- Search a hiking location
- View current conditions and 7-day forecast-based guidance
- Pick a safer hike date in the built-in planner
- Export a planned date to calendar (.ics)

## Live Site

https://griboba.github.io/HikeRight/

## Features

- Fast location search with Open-Meteo geocoding
- Weather-based safety verdicts (Great, Okay, Bad)
- Date planner with per-day risk evaluation
- Warnings for rain, wind, heat, cold, and storm signals
- "Save to Calendar" export for hike dates

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

## Safety Disclaimer

HikeRight is for informational purposes only and is not an authoritative safety source.
Weather and trail conditions can change quickly. Always verify forecasts, official advisories,
trail closures, and local ranger guidance before hiking. You are responsible for your own
planning decisions and personal safety.

## License

Add your preferred license in a `LICENSE` file (MIT is a common choice for public projects).
