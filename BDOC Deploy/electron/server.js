// KGS BDOC — Local API Server (Electron)
// Replaces Netlify Functions for offline/desktop operation.
// Serves static files AND proxies API calls. Caches responses to disk
// so last-known data is available when the grid goes down.

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const https_mod = require('https');
const http_mod  = require('http');
const os        = require('os');

// Disk cache dir for API responses
const CACHE_DIR = path.join(os.homedir(), '.bdoc', 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── Simple disk cache ─────────────────────────────────────────────────────────
function cacheKey(str) {
  return str.replace(/[^a-z0-9_-]/gi, '_').slice(0, 120) + '.json';
}
function diskRead(key) {
  try {
    const f = path.join(CACHE_DIR, cacheKey(key));
    if (!fs.existsSync(f)) return null;
    const { ts, data, maxAge } = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Date.now() - ts > (maxAge || 3600000)) return null; // expired
    return data;
  } catch { return null; }
}
function diskWrite(key, data, maxAgeMs = 3600000) {
  try {
    fs.writeFileSync(
      path.join(CACHE_DIR, cacheKey(key)),
      JSON.stringify({ ts: Date.now(), maxAge: maxAgeMs, data })
    );
  } catch(e) { console.warn('[Cache write]', e.message); }
}
function diskReadStale(key) {
  try {
    const f = path.join(CACHE_DIR, cacheKey(key));
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8')).data;
  } catch { return null; }
}

// ── Generic HTTPS fetcher ─────────────────────────────────────────────────────
function fetchUrl(url, headers = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https_mod : http_mod;
    const req = mod.get(url, { headers: { 'User-Agent': 'KITSUNE-BDOC/8.0-Electron', ...headers }, timeout: timeoutMs }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Proxy handler factory ─────────────────────────────────────────────────────
function proxyHandler(apiUrlFn, cacheKeyFn, maxAgeMs = 600000, headers = {}) {
  return async (req, res) => {
    const cKey = cacheKeyFn ? cacheKeyFn(req) : req.originalUrl;
    // Fresh cache
    const fresh = diskRead(cKey);
    if (fresh) return res.json(fresh);
    // Fetch live
    try {
      const url = apiUrlFn(req);
      const { status, body } = await fetchUrl(url, headers);
      if (status === 200) {
        let parsed;
        try { parsed = JSON.parse(body); } catch { parsed = body; }
        diskWrite(cKey, parsed, maxAgeMs);
        return res.status(200).json(parsed);
      }
      throw new Error(`HTTP ${status}`);
    } catch (e) {
      // Network error — serve stale cache if available
      const stale = diskReadStale(cKey);
      if (stale) {
        res.setHeader('X-BDOC-Stale', '1');
        return res.status(200).json(stale);
      }
      return res.status(503).json({ error: 'Offline — no cached data available', offline: true });
    }
  };
}

// ── Build Express app ─────────────────────────────────────────────────────────
function createServer() {
  const app = express();
  const STATIC_DIR = path.join(__dirname, '..');

  // ── Health check ─────────────────────────────────────────────────────────────
  app.get('/api/health', (_, res) => res.json({
    status: 'ok', mode: 'electron-offline', version: '8.0', ts: Date.now()
  }));

  // ── CelesTrak (satellite TLEs) ────────────────────────────────────────────────
  app.get('/.netlify/functions/proxy-celestrak', proxyHandler(
    req => {
      const g = (req.query.group || 'stations').slice(0, 40);
      const f = req.query.format === 'json' ? 'json' : 'text';
      return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(g)}&FORMAT=${f}`;
    },
    req => `celestrak_${req.query.group || 'stations'}_${req.query.format || 'json'}`,
    600000
  ));

  // ── GDELT (conflict news) ─────────────────────────────────────────────────────
  app.get('/.netlify/functions/proxy-gdelt', proxyHandler(
    req => {
      const q = encodeURIComponent((req.query.q || 'military conflict').slice(0, 80));
      const mp = Math.min(parseInt(req.query.maxpoints) || 100, 200);
      return `https://api.gdeltproject.org/api/v2/geo/geo?query=${q}&mode=artlist&maxrecords=${mp}&timespan=1h&outputtype=geojson&format=json`;
    },
    req => `gdelt_${req.query.q || 'military'}_${req.query.maxpoints || 100}`,
    900000
  ));

  // ── GDACS (floods, volcanoes, earthquakes) ────────────────────────────────────
  app.get('/.netlify/functions/proxy-gdacs', proxyHandler(
    req => {
      const type = (req.query.type || 'floods').slice(0, 20);
      const urls = {
        floods: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/FLOODS?pagesize=10&alertlevel=Green',
        volcanoes: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/VO?pagesize=10',
        tsunamis: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/TS?pagesize=5'
      };
      return urls[type] || urls.floods;
    },
    req => `gdacs_${req.query.type || 'floods'}`,
    1800000
  ));

  // ── AviationWeather (METAR/SIGMET/TAF) ───────────────────────────────────────
  app.get('/.netlify/functions/proxy-aw', proxyHandler(
    req => {
      const type = (req.query.type || 'metar').slice(0, 10);
      const icao = (req.query.icao || 'KORD').slice(0, 4).toUpperCase();
      if (type === 'metar') return `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`;
      if (type === 'sigmet') return `https://aviationweather.gov/api/data/isigmet?format=json&hazard=${req.query.hazard || 'VA'}`;
      return `https://aviationweather.gov/api/data/taf?ids=${icao}&format=json`;
    },
    req => `aw_${req.query.type || 'metar'}_${req.query.icao || 'none'}_${req.query.hazard || ''}`,
    300000
  ));

  // ── CISA KEV ──────────────────────────────────────────────────────────────────
  app.get('/.netlify/functions/proxy-cisa', proxyHandler(
    () => 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    () => 'cisa_kev',
    3600000
  ));

  // ── Space weather (SWPC) ──────────────────────────────────────────────────────
  app.get('/.netlify/functions/proxy-swpc', proxyHandler(
    () => 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
    () => 'swpc_kindex',
    900000
  ));

  // ── Polymarket geopolitics ────────────────────────────────────────────────────
  app.get('/.netlify/functions/proxy-polymarket', proxyHandler(
    () => 'https://gamma-api.polymarket.com/events?tag_slug=geopolitics&limit=20',
    () => 'polymarket_geo',
    300000
  ));

  // ── US Treasury (national debt) ───────────────────────────────────────────────
  app.get('/.netlify/functions/proxy-treasury', proxyHandler(
    req => {
      const endpoints = {
        debt_to_penny: 'accounting/od/debt_to_penny',
        avg_interest_rates: 'accounting/od/avg_interest_rates'
      };
      const ep = endpoints[req.query.endpoint] || endpoints.debt_to_penny;
      return `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/${ep}?sort=-record_date&page%5Bsize%5D=1`;
    },
    req => `treasury_${req.query.endpoint || 'debt_to_penny'}`,
    86400000
  ));

  // ── OpenSky aircraft ──────────────────────────────────────────────────────────
  app.get('/.netlify/functions/proxy-opensky', proxyHandler(
    req => {
      const { lamin = 25, lamax = 50, lomin = -130, lomax = -65 } = req.query;
      return `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
    },
    req => `opensky_${req.query.lamin}_${req.query.lamax}`,
    60000
  ));

  // ── ADS-B aircraft (adsb.lol) ─────────────────────────────────────────────────
  app.get('/.netlify/functions/proxy-adsb', proxyHandler(
    req => `https://api.adsb.lol/v2/lat/${req.query.lat || 38.9}/lon/${req.query.lon || -77.0}/dist/${req.query.dist || 500}`,
    req => `adsb_${req.query.lat}_${req.query.lon}`,
    60000
  ));

  // ── NASA FIRMS fires ──────────────────────────────────────────────────────────
  app.get('/.netlify/functions/proxy-firms', proxyHandler(
    req => {
      const key = process.env.NASA_FIRMS_KEY || 'DEMO_KEY';
      return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/-180,-90,180,90/1`;
    },
    () => 'firms_viirs',
    900000
  ));

  // ── Generic status proxy (outages) ───────────────────────────────────────────
  app.get('/.netlify/functions/proxy-status', async (req, res) => {
    const url = (req.query.url || '').slice(0, 200);
    if (!url.startsWith('https://')) return res.status(400).json({ error: 'Invalid URL' });
    try {
      const { status, body } = await fetchUrl(url, {}, 8000);
      res.status(status).send(body);
    } catch (e) {
      const stale = diskReadStale(`status_${url}`);
      if (stale) return res.json(stale);
      res.status(503).json({ error: 'Offline' });
    }
  });

  // ── OSRM routing ──────────────────────────────────────────────────────────────
  app.get('/.netlify/functions/proxy-osrm', proxyHandler(
    req => {
      const coords = (req.query.coords || '').slice(0, 200);
      return `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    },
    req => `osrm_${req.query.coords}`,
    600000
  ));

  // ── News (NewsAPI fallback to GDELT) ──────────────────────────────────────────
  app.get('/.netlify/functions/proxy-news', proxyHandler(
    req => {
      const key = process.env.NEWSAPI_KEY || '';
      const q = encodeURIComponent((req.query.q || 'military').slice(0, 80));
      if (key) return `https://newsapi.org/v2/everything?q=${q}&sortBy=publishedAt&pageSize=20&language=en&apiKey=${key}`;
      // Fallback: GDELT v2 article list (no key)
      return `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&maxrecords=20&format=json`;
    },
    req => `news_${req.query.q || 'military'}`,
    600000
  ));

  // ── Serve static BDOC files ───────────────────────────────────────────────────
  app.use(express.static(STATIC_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });

  return require('http').createServer(app);
}

module.exports = { createServer };
