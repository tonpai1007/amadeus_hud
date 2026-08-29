// modules/weather.js - AMADEUS Real-time Ambient Weather Awareness
window.AMADEUS = window.AMADEUS || {};

(function() {
  const WEATHER_REFRESH_MS = 30 * 60 * 1000; // 30 mins
  let refreshTimer = null;

  async function fetchWeather() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch('https://wttr.in/?format=j1', { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('Weather status: ' + res.status);
      const data = await res.json();
      
      const current = data.current_condition && data.current_condition[0];
      if (!current) return;

      const area = data.nearest_area && data.nearest_area[0];
      const city = (area && area.areaName && area.areaName[0] && area.areaName[0].value) || 'Local Area';

      const desc = (current.weatherDesc && current.weatherDesc[0] && current.weatherDesc[0].value) || 'Clear';
      const tempC = current.temp_C || '25';
      const humidity = current.humidity || '60';
      const feelsLikeC = current.FeelsLikeC || tempC;

      const descLower = desc.toLowerCase();
      const isRaining = descLower.includes('rain') || descLower.includes('drizzle') || descLower.includes('shower');
      const isThunder = descLower.includes('thunder') || descLower.includes('storm');
      const isSnow = descLower.includes('snow');
      const isCloudy = descLower.includes('cloud') || descLower.includes('overcast');
      const isSunny = descLower.includes('sun') || descLower.includes('clear');

      window.AMADEUS.state.weather = {
        city,
        condition: desc,
        temp_C: tempC,
        feelsLike_C: feelsLikeC,
        humidity: humidity,
        isRaining,
        isThunder,
        isSnow,
        isCloudy,
        isSunny,
        updatedAt: Date.now(),
      };

      console.log(`[Weather] Synced: ${desc}, ${tempC}°C (Humidity: ${humidity}%)`);
    } catch (err) {
      console.warn('[Weather] Ambient weather fetch skipped:', err.message);
      // Sensible default
      if (!window.AMADEUS.state.weather) {
        window.AMADEUS.state.weather = {
          city: 'Local Area',
          condition: 'Clear',
          temp_C: '26',
          feelsLike_C: '26',
          humidity: '50',
          isRaining: false,
          isThunder: false,
          isSnow: false,
          isCloudy: false,
          isSunny: true,
          updatedAt: Date.now(),
        };
      }
    }
  }

  function initWeather() {
    fetchWeather();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(fetchWeather, WEATHER_REFRESH_MS);
  }

  function getWeatherSummary() {
    const w = window.AMADEUS.state.weather;
    if (!w) return null;
    return `${w.condition}, ${w.temp_C}°C`;
  }

  /**
   * AMADEUS ambient weather awareness (wttr.in).
   * @property {() => Promise<void>} fetchWeather - Fetches current conditions into state.weather (with rain/thunder/snow/cloud/sun flags); sensible default on failure.
   * @property {() => void} initWeather - Fetches immediately then every 30 minutes.
   * @property {() => string|null} getWeatherSummary - "Clear, 26°C" style summary for brain context.
   */
  window.AMADEUS.weather = {
    initWeather,
    fetchWeather,
    getWeatherSummary,
  };
})();
