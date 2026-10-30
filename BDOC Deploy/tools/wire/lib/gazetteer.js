// ============================================================
// gazetteer — free text to a place, with an honest radius
// ============================================================
// WHY THIS EXISTS
// LIVE WIRE rows fly the globe to `geo`, and clustering needs to know that
// "Guard deployed to Portland" and "Guard deployed to Chicago" are not the same
// story. A headline is all we have, so this is a table lookup, never a network
// call: the daemon has to hold 50+ posts a second and must keep working when
// every third-party API is down.
//
// DESIGN NOTES
// - The world table is copied from netlify/functions/proxy-newsgeo.js, numbers
//   untouched. `r` keeps that file's meaning: real locational uncertainty in
//   metres. A country is its centroid and we say so, a client draws the circle,
//   so we never imply a street corner when all we know is "somewhere in Lebanon".
// - One compiled alternation, longest name first. Because the regex consumes as
//   it goes, "New Mexico" can never also fire "Mexico", and "Kansas City" never
//   fires "Kansas".
// - Most specific wins: smallest radius across the headline, so "Long Beach,
//   California" lands on Long Beach, not the middle of the state.
// - Lookalikes are removed BEFORE matching (see EXCLUDE). That is cheaper and
//   easier to extend than teaching every entry about its own false friends.
// - Ambiguous names resolve conservatively. A wrong pin is worse than no pin, so
//   bare "Birmingham" (UK or Alabama) matches nothing unless a state is named.

'use strict';

const CITY = 15000;
const METRO = 25000;

// key -> record. `rg` is the region code (US state, else country) and `m` is the
// metro key, both used by clustering to tell whether two places can be the same.
const RECS = new Map();

function titleCase(s) {
  return s.replace(/\b[a-z]/g, c => c.toUpperCase());
}

function put(key, rec) {
  RECS.set(key, Object.assign({ k: key, weak: false }, rec));
}

// ── World: lon, lat, radius copied verbatim from proxy-newsgeo.js ─────────────
const WORLD = {
  UA: {
    'kyiv': [30.52, 50.45, 15000], 'kiev': [30.52, 50.45, 15000], 'kharkiv': [36.23, 49.99, 15000],
    'odesa': [30.73, 46.48, 15000], 'odessa': [30.73, 46.48, 15000], 'lviv': [24.03, 49.84, 15000],
    'donetsk': [37.80, 48.00, 25000], 'mariupol': [37.55, 47.10, 15000], 'kherson': [32.62, 46.64, 15000],
    'zaporizhzhia': [35.14, 47.84, 15000], 'crimea': [34.10, 45.30, 90000], 'sevastopol': [33.53, 44.62, 15000],
    'bakhmut': [38.00, 48.60, 12000], 'pokrovsk': [37.18, 48.28, 12000], 'sumy': [34.80, 50.91, 15000],
    'ukraine': [31.17, 48.38, 400000]
  },
  RU: {
    'moscow': [37.62, 55.75, 20000], 'belgorod': [36.59, 50.60, 15000], 'kursk': [36.19, 51.73, 15000],
    'st petersburg': [30.34, 59.93, 20000], 'novorossiysk': [37.77, 44.72, 12000],
    'russia': [60.00, 58.00, 400000]
  },
  PS: {
    'gaza': [34.47, 31.50, 12000], 'rafah': [34.25, 31.29, 8000], 'khan younis': [34.31, 31.35, 8000],
    'west bank': [35.30, 32.00, 45000], 'gaza strip': [34.47, 31.42, 20000]
  },
  IL: {
    'jerusalem': [35.21, 31.77, 12000], 'tel aviv': [34.78, 32.08, 12000], 'israel': [34.85, 31.05, 60000]
  },
  LB: {
    'beirut': [35.50, 33.89, 12000], 'south lebanon': [35.40, 33.30, 40000], 'lebanon': [35.86, 33.85, 50000]
  },
  SY: {
    'damascus': [36.29, 33.51, 15000], 'aleppo': [37.16, 36.20, 15000], 'idlib': [36.63, 35.93, 25000],
    'homs': [36.72, 34.73, 15000], 'latakia': [35.79, 35.52, 15000], 'syria': [38.00, 35.00, 180000]
  },
  IR: {
    'tehran': [51.39, 35.69, 20000], 'isfahan': [51.68, 32.65, 15000], 'natanz': [51.72, 33.72, 10000],
    'fordow': [50.99, 34.88, 8000], 'bandar abbas': [56.28, 27.19, 12000], 'iran': [53.69, 32.43, 400000]
  },
  IQ: {
    'baghdad': [44.36, 33.31, 18000], 'erbil': [44.01, 36.19, 12000], 'mosul': [43.12, 36.34, 12000],
    'iraq': [43.68, 33.22, 250000]
  },
  YE: {
    'sanaa': [44.21, 15.35, 15000], 'hodeidah': [42.95, 14.80, 12000], 'aden': [45.04, 12.79, 12000],
    'yemen': [48.52, 15.55, 250000]
  },
  ZZ: {
    'red sea': [38.00, 20.00, 300000], 'bab el mandeb': [43.35, 12.58, 60000],
    'strait of hormuz': [56.25, 26.57, 60000], 'south china sea': [114.00, 15.00, 400000],
    'sahel': [2.00, 15.00, 400000], 'taiwan strait': [119.50, 24.50, 90000]
  },
  EG: { 'suez canal': [32.35, 30.60, 50000], 'egypt': [30.80, 26.82, 300000] },
  TW: { 'taiwan': [121.00, 23.70, 90000], 'taipei': [121.56, 25.03, 15000] },
  CN: { 'beijing': [116.41, 39.90, 20000], 'tibet': [88.00, 31.00, 300000], 'china': [104.20, 35.86, 400000] },
  KP: { 'north korea': [127.50, 40.34, 200000], 'pyongyang': [125.75, 39.03, 15000] },
  KR: { 'seoul': [126.98, 37.57, 18000], 'south korea': [127.85, 36.50, 150000] },
  SD: {
    'khartoum': [32.53, 15.50, 18000], 'darfur': [24.90, 13.00, 250000], 'port sudan': [37.22, 19.62, 12000],
    'sudan': [30.22, 12.86, 400000]
  },
  SO: { 'mogadishu': [45.34, 2.04, 15000], 'somalia': [46.20, 5.15, 300000] },
  AF: { 'kabul': [69.21, 34.52, 15000], 'afghanistan': [67.71, 33.94, 250000] },
  PK: {
    'islamabad': [73.05, 33.68, 15000], 'karachi': [67.01, 24.86, 18000], 'pakistan': [69.35, 30.38, 300000]
  },
  IN: {
    'kashmir': [76.00, 34.00, 120000], 'delhi': [77.21, 28.61, 20000], 'new delhi': [77.21, 28.61, 20000],
    'india': [78.96, 20.59, 400000]
  },
  MM: { 'myanmar': [95.96, 21.91, 300000], 'rakhine': [93.50, 20.00, 120000] },
  HT: { 'port au prince': [-72.34, 18.54, 15000], 'haiti': [-72.29, 18.97, 90000] },
  VE: { 'caracas': [-66.90, 10.49, 15000], 'venezuela': [-66.58, 6.42, 300000] },
  ES: { 'ceuta': [-5.32, 35.89, 8000], 'spain': [-3.75, 40.46, 250000], 'madrid': [-3.70, 40.42, 18000] },
  IT: { 'lampedusa': [12.61, 35.50, 8000], 'italy': [12.57, 41.87, 250000], 'rome': [12.50, 41.90, 18000] },
  JP: { 'japan': [138.25, 36.20, 300000], 'tokyo': [139.69, 35.69, 20000] },
  NG: { 'nigeria': [8.68, 9.08, 300000], 'lagos': [3.38, 6.52, 20000], 'abuja': [7.40, 9.06, 15000] },
  ML: { 'mali': [-3.50, 17.57, 300000], 'bamako': [-8.00, 12.64, 15000] },
  LY: { 'libya': [17.23, 26.34, 400000], 'tripoli': [13.19, 32.89, 15000] },
  TR: {
    'turkey': [35.24, 38.96, 300000], 'turkiye': [35.24, 38.96, 300000], 'ankara': [32.85, 39.93, 15000],
    'istanbul': [28.98, 41.01, 20000]
  },
  PL: { 'poland': [19.15, 51.92, 180000], 'warsaw': [21.01, 52.23, 15000] },
  DE: { 'germany': [10.45, 51.17, 180000], 'berlin': [13.40, 52.52, 18000] },
  FR: { 'france': [2.21, 46.23, 200000], 'paris': [2.35, 48.86, 18000] },
  GB: {
    'united kingdom': [-1.55, 52.36, 180000], 'britain': [-1.55, 52.36, 180000], 'london': [-0.13, 51.51, 20000],
    'scotland': [-4.20, 56.49, 120000], 'wales': [-3.78, 52.13, 80000], 'northern ireland': [-6.49, 54.79, 60000],
    'belfast': [-5.93, 54.60, 12000]
  },
  NP: { 'nepal': [84.12, 28.39, 120000], 'kathmandu': [85.32, 27.72, 12000] },
  PH: { 'philippines': [122.88, 12.88, 250000], 'manila': [120.98, 14.60, 18000] },
  MX: { 'mexico': [-102.55, 23.63, 300000], 'mexico city': [-99.13, 19.43, 25000] },
  CO: { 'colombia': [-74.30, 4.57, 250000], 'bogota': [-74.07, 4.71, 18000] },
  // Added for LIVE WIRE: a foreign headline must be recognized as foreign, or the
  // "only in the US" severity gates in classify.js would have nothing to go on.
  CA: {
    'canada': [-106.35, 56.13, 400000], 'ottawa': [-75.70, 45.42, 15000], 'toronto': [-79.38, 43.65, 20000],
    'montreal': [-73.57, 45.50, 20000], 'vancouver': [-123.12, 49.28, 20000]
  },
  CU: { 'cuba': [-77.78, 21.52, 200000], 'havana': [-82.37, 23.11, 15000] },
  BY: { 'belarus': [27.95, 53.71, 180000], 'minsk': [27.57, 53.90, 15000] },
  JO: { 'amman': [35.93, 31.95, 15000] },
  SA: { 'saudi arabia': [45.08, 23.89, 400000], 'riyadh': [46.68, 24.71, 20000] },
  QA: { 'qatar': [51.18, 25.35, 60000], 'doha': [51.53, 25.29, 15000] },
  AE: { 'united arab emirates': [53.85, 23.42, 120000], 'uae': [53.85, 23.42, 120000], 'dubai': [55.27, 25.20, 18000] },
  KW: { 'kuwait': [47.48, 29.31, 60000] },
  BH: { 'bahrain': [50.56, 26.07, 25000] },
  OM: { 'oman': [55.92, 21.51, 180000] },
  GE: { 'tbilisi': [44.83, 41.72, 15000] },
  AM: { 'armenia': [45.04, 40.07, 90000], 'yerevan': [44.51, 40.18, 12000] },
  AZ: { 'azerbaijan': [47.58, 40.14, 120000], 'baku': [49.87, 40.41, 15000] },
  MD: { 'moldova': [28.37, 47.41, 90000] },
  RO: { 'romania': [24.97, 45.94, 180000] },
  HU: { 'hungary': [19.50, 47.16, 120000] },
  GR: { 'greece': [21.82, 39.07, 180000], 'athens': [23.73, 37.98, 15000] },
  RS: { 'serbia': [21.01, 44.02, 120000], 'belgrade': [20.46, 44.79, 15000] },
  XK: { 'kosovo': [20.90, 42.60, 60000] },
  NL: { 'netherlands': [5.29, 52.13, 90000], 'amsterdam': [4.90, 52.37, 12000] },
  BE: { 'belgium': [4.47, 50.50, 80000], 'brussels': [4.35, 50.85, 12000] },
  SE: { 'sweden': [18.64, 60.13, 300000], 'stockholm': [18.07, 59.33, 15000] },
  NO: { 'norway': [8.47, 60.47, 300000] },
  FI: { 'finland': [25.75, 61.92, 250000] },
  DK: { 'denmark': [9.50, 56.26, 120000] },
  IE: { 'ireland': [-8.24, 53.41, 120000], 'dublin': [-6.26, 53.35, 12000] },
  LT: { 'lithuania': [23.88, 55.17, 90000] },
  LV: { 'latvia': [24.60, 56.88, 90000] },
  EE: { 'estonia': [25.01, 58.60, 80000] },
  ET: { 'ethiopia': [40.49, 9.15, 350000], 'addis ababa': [38.76, 9.01, 15000] },
  KE: { 'kenya': [37.91, -0.02, 250000], 'nairobi': [36.82, -1.29, 15000] },
  ZA: { 'south africa': [22.94, -30.56, 400000], 'johannesburg': [28.05, -26.20, 18000] },
  CD: { 'congo': [21.76, -4.04, 400000], 'kinshasa': [15.27, -4.44, 18000] },
  BF: { 'burkina faso': [-1.56, 12.24, 250000] },
  NE: { 'niger': [8.08, 17.61, 400000] },
  DZ: { 'algeria': [1.66, 28.03, 400000] },
  MA: { 'morocco': [-7.09, 31.79, 250000] },
  TN: { 'tunisia': [9.54, 33.89, 150000] },
  BR: {
    'brazil': [-51.93, -14.24, 400000], 'sao paulo': [-46.63, -23.55, 25000],
    'rio de janeiro': [-43.17, -22.91, 20000], 'brasilia': [-47.88, -15.79, 15000]
  },
  AR: { 'argentina': [-63.62, -38.42, 400000], 'buenos aires': [-58.38, -34.60, 25000] },
  CL: { 'chile': [-71.54, -35.68, 300000], 'santiago': [-70.67, -33.45, 18000] },
  PE: { 'peru': [-75.02, -9.19, 300000], 'lima': [-77.04, -12.05, 18000] },
  EC: { 'ecuador': [-78.18, -1.83, 150000], 'quito': [-78.47, -0.18, 12000] },
  BO: { 'bolivia': [-63.59, -16.29, 300000] },
  NI: { 'nicaragua': [-85.21, 12.87, 120000] },
  HN: { 'honduras': [-86.24, 15.20, 120000] },
  GT: { 'guatemala': [-90.23, 15.78, 100000] },
  SV: { 'el salvador': [-88.90, 13.79, 60000] },
  PA: { 'panama': [-80.78, 8.54, 80000] },
  DO: { 'dominican republic': [-70.16, 18.74, 80000] },
  JM: { 'jamaica': [-77.30, 18.11, 50000] },
  BD: { 'bangladesh': [90.36, 23.68, 150000], 'dhaka': [90.41, 23.81, 15000] },
  LK: { 'sri lanka': [80.77, 7.87, 100000] },
  TH: { 'thailand': [100.99, 15.87, 250000], 'bangkok': [100.50, 13.76, 20000] },
  VN: { 'vietnam': [108.28, 14.06, 250000], 'hanoi': [105.83, 21.03, 15000] },
  MY: { 'malaysia': [101.98, 4.21, 250000] },
  SG: { 'singapore': [103.82, 1.35, 20000] },
  ID: { 'indonesia': [113.92, -0.79, 400000], 'jakarta': [106.85, -6.21, 20000] },
  AU: {
    'australia': [133.78, -25.27, 400000], 'sydney': [151.21, -33.87, 20000], 'melbourne': [144.96, -37.81, 20000],
    'canberra': [149.13, -35.28, 12000]
  },
  NZ: { 'new zealand': [174.89, -40.90, 200000] }
};

for (const cc of Object.keys(WORLD)) {
  for (const [key, v] of Object.entries(WORLD[cc])) {
    put(key, { p: titleCase(key), lon: v[0], lat: v[1], r: v[2], cc, rg: cc, m: v[2] <= METRO ? key : null });
  }
}
RECS.get('st petersburg').p = 'St. Petersburg';
RECS.get('port au prince').p = 'Port-au-Prince';
RECS.get('bab el mandeb').p = 'Bab el-Mandeb';
RECS.get('sao paulo').p = 'Sao Paulo';
RECS.get('uae').p = 'UAE';

// ── United States ─────────────────────────────────────────────────────────────
// State centroid and a radius sized to the state, so the circle tells the truth.
const STATES = [
  ['alabama', 'AL', 32.8, -86.8, 200000], ['alaska', 'AK', 64.0, -152.0, 400000],
  ['arizona', 'AZ', 34.2, -111.7, 280000], ['arkansas', 'AR', 34.9, -92.4, 200000],
  ['california', 'CA', 37.2, -119.4, 400000], ['colorado', 'CO', 39.0, -105.5, 270000],
  ['connecticut', 'CT', 41.6, -72.7, 70000], ['delaware', 'DE', 39.0, -75.5, 60000],
  ['florida', 'FL', 28.6, -82.4, 300000], ['hawaii', 'HI', 20.8, -156.3, 200000],
  ['idaho', 'ID', 44.4, -114.6, 280000], ['illinois', 'IL', 40.0, -89.2, 250000],
  ['indiana', 'IN', 39.9, -86.3, 200000], ['iowa', 'IA', 42.0, -93.5, 220000],
  ['kansas', 'KS', 38.5, -98.4, 250000], ['kentucky', 'KY', 37.5, -85.3, 220000],
  ['louisiana', 'LA', 31.0, -92.0, 220000], ['maine', 'ME', 45.4, -69.2, 180000],
  ['maryland', 'MD', 39.0, -76.8, 120000], ['massachusetts', 'MA', 42.3, -71.8, 110000],
  ['michigan', 'MI', 44.3, -85.4, 280000], ['minnesota', 'MN', 46.3, -94.3, 280000],
  ['mississippi', 'MS', 32.7, -89.7, 220000], ['missouri', 'MO', 38.4, -92.5, 250000],
  ['montana', 'MT', 47.0, -109.6, 350000], ['nebraska', 'NE', 41.5, -99.8, 280000],
  ['nevada', 'NV', 39.3, -116.6, 300000], ['new hampshire', 'NH', 43.7, -71.6, 90000],
  ['new jersey', 'NJ', 40.2, -74.7, 90000], ['new mexico', 'NM', 34.4, -106.1, 280000],
  ['new york state', 'NY', 42.9, -75.5, 220000], ['north carolina', 'NC', 35.6, -79.4, 250000],
  ['north dakota', 'ND', 47.5, -100.5, 240000], ['ohio', 'OH', 40.3, -82.8, 200000],
  ['oklahoma', 'OK', 35.6, -97.5, 250000], ['oregon', 'OR', 44.0, -120.5, 280000],
  ['pennsylvania', 'PA', 40.9, -77.8, 220000], ['rhode island', 'RI', 41.7, -71.5, 40000],
  ['south carolina', 'SC', 33.9, -80.9, 170000], ['south dakota', 'SD', 44.4, -100.2, 240000],
  ['tennessee', 'TN', 35.9, -86.4, 220000], ['texas', 'TX', 31.5, -99.3, 400000],
  ['utah', 'UT', 39.3, -111.7, 250000], ['vermont', 'VT', 44.1, -72.7, 90000],
  ['virginia', 'VA', 37.5, -78.8, 220000], ['washington state', 'WA', 47.4, -120.4, 250000],
  ['west virginia', 'WV', 38.6, -80.6, 150000], ['wisconsin', 'WI', 44.6, -89.9, 230000],
  ['wyoming', 'WY', 43.0, -107.6, 250000]
];

for (const [key, rg, lat, lon, r] of STATES) {
  put(key, { p: titleCase(key.replace(/ state$/, '')), lat, lon, r, cc: 'US', rg, m: null });
}

// Metros: [key, display, lat, lon, state, metro key]. The metro key means "Long
// Beach" and "Los Angeles" can describe one story, as they do for the port strike.
const CITIES = [
  ['new york', 'New York, NY', 40.71, -74.01, 'NY'], ['new york city', 'New York, NY', 40.71, -74.01, 'NY', 'new york'],
  ['nyc', 'New York, NY', 40.71, -74.01, 'NY', 'new york'], ['manhattan', 'Manhattan, NY', 40.78, -73.97, 'NY', 'new york'],
  ['brooklyn', 'Brooklyn, NY', 40.65, -73.95, 'NY', 'new york'], ['bronx', 'Bronx, NY', 40.84, -73.87, 'NY', 'new york'],
  ['staten island', 'Staten Island, NY', 40.58, -74.15, 'NY', 'new york'],
  ['los angeles', 'Los Angeles, CA', 34.05, -118.24, 'CA'], ['long beach', 'Long Beach, CA', 33.77, -118.19, 'CA', 'los angeles'],
  ['anaheim', 'Anaheim, CA', 33.84, -117.91, 'CA', 'los angeles'], ['san pedro', 'San Pedro, CA', 33.74, -118.29, 'CA', 'los angeles'],
  ['chicago', 'Chicago, IL', 41.88, -87.63, 'IL'], ['houston', 'Houston, TX', 29.76, -95.37, 'TX'],
  ['phoenix', 'Phoenix, AZ', 33.45, -112.07, 'AZ'], ['maricopa county', 'Maricopa County, AZ', 33.35, -112.49, 'AZ', 'phoenix'],
  ['philadelphia', 'Philadelphia, PA', 39.95, -75.17, 'PA'], ['san antonio', 'San Antonio, TX', 29.42, -98.49, 'TX'],
  ['san diego', 'San Diego, CA', 32.72, -117.16, 'CA'], ['dallas', 'Dallas, TX', 32.78, -96.80, 'TX'],
  ['fort worth', 'Fort Worth, TX', 32.76, -97.33, 'TX', 'dallas'], ['san jose', 'San Jose, CA', 37.34, -121.89, 'CA', 'san francisco'],
  ['austin', 'Austin, TX', 30.27, -97.74, 'TX'], ['jacksonville', 'Jacksonville, FL', 30.33, -81.66, 'FL'],
  ['columbus', 'Columbus, OH', 39.96, -83.00, 'OH'], ['charlotte', 'Charlotte, NC', 35.23, -80.84, 'NC'],
  ['indianapolis', 'Indianapolis, IN', 39.77, -86.16, 'IN'], ['san francisco', 'San Francisco, CA', 37.77, -122.42, 'CA'],
  ['oakland', 'Oakland, CA', 37.80, -122.27, 'CA', 'san francisco'], ['seattle', 'Seattle, WA', 47.61, -122.33, 'WA'],
  ['tacoma', 'Tacoma, WA', 47.25, -122.44, 'WA', 'seattle'], ['denver', 'Denver, CO', 39.74, -104.99, 'CO'],
  ['nashville', 'Nashville, TN', 36.16, -86.78, 'TN'], ['oklahoma city', 'Oklahoma City, OK', 35.47, -97.52, 'OK'],
  ['el paso', 'El Paso, TX', 31.76, -106.49, 'TX'], ['boston', 'Boston, MA', 42.36, -71.06, 'MA'],
  ['portland', 'Portland, OR', 45.52, -122.68, 'OR'], ['las vegas', 'Las Vegas, NV', 36.17, -115.14, 'NV'],
  ['detroit', 'Detroit, MI', 42.33, -83.05, 'MI'], ['memphis', 'Memphis, TN', 35.15, -90.05, 'TN'],
  ['louisville', 'Louisville, KY', 38.25, -85.76, 'KY'], ['baltimore', 'Baltimore, MD', 39.29, -76.61, 'MD'],
  ['milwaukee', 'Milwaukee, WI', 43.04, -87.91, 'WI'], ['albuquerque', 'Albuquerque, NM', 35.08, -106.65, 'NM'],
  ['tucson', 'Tucson, AZ', 32.22, -110.97, 'AZ'], ['fresno', 'Fresno, CA', 36.74, -119.79, 'CA'],
  ['sacramento', 'Sacramento, CA', 38.58, -121.49, 'CA'], ['kansas city', 'Kansas City, MO', 39.10, -94.58, 'MO'],
  ['atlanta', 'Atlanta, GA', 33.75, -84.39, 'GA'], ['miami', 'Miami, FL', 25.76, -80.19, 'FL'],
  ['fort lauderdale', 'Fort Lauderdale, FL', 26.12, -80.14, 'FL', 'miami'], ['west palm beach', 'West Palm Beach, FL', 26.71, -80.05, 'FL', 'miami'],
  ['mar a lago', 'Mar-a-Lago, FL', 26.68, -80.04, 'FL', 'miami'], ['raleigh', 'Raleigh, NC', 35.78, -78.64, 'NC'],
  ['omaha', 'Omaha, NE', 41.26, -95.93, 'NE'], ['minneapolis', 'Minneapolis, MN', 44.98, -93.27, 'MN'],
  ['st paul', 'St. Paul, MN', 44.95, -93.09, 'MN', 'minneapolis'], ['tulsa', 'Tulsa, OK', 36.15, -95.99, 'OK'],
  ['cleveland', 'Cleveland, OH', 41.50, -81.69, 'OH'], ['tampa', 'Tampa, FL', 27.95, -82.46, 'FL'],
  ['new orleans', 'New Orleans, LA', 29.95, -90.07, 'LA'], ['honolulu', 'Honolulu, HI', 21.31, -157.86, 'HI'],
  ['pittsburgh', 'Pittsburgh, PA', 40.44, -80.00, 'PA'], ['st louis', 'St. Louis, MO', 38.63, -90.20, 'MO'],
  ['cincinnati', 'Cincinnati, OH', 39.10, -84.51, 'OH'], ['orlando', 'Orlando, FL', 28.54, -81.38, 'FL'],
  ['salt lake city', 'Salt Lake City, UT', 40.76, -111.89, 'UT'], ['richmond', 'Richmond, VA', 37.54, -77.44, 'VA'],
  ['virginia beach', 'Virginia Beach, VA', 36.85, -75.98, 'VA'], ['norfolk', 'Norfolk, VA', 36.85, -76.29, 'VA', 'virginia beach'],
  ['buffalo', 'Buffalo, NY', 42.89, -78.88, 'NY'], ['madison', 'Madison, WI', 43.07, -89.40, 'WI'],
  ['boise', 'Boise, ID', 43.62, -116.21, 'ID'], ['reno', 'Reno, NV', 39.53, -119.81, 'NV'],
  ['spokane', 'Spokane, WA', 47.66, -117.43, 'WA'], ['anchorage', 'Anchorage, AK', 61.22, -149.90, 'AK'],
  ['birmingham alabama', 'Birmingham, AL', 33.52, -86.80, 'AL'], ['birmingham al', 'Birmingham, AL', 33.52, -86.80, 'AL', 'birmingham alabama'],
  ['hartford', 'Hartford, CT', 41.76, -72.67, 'CT'], ['providence', 'Providence, RI', 41.82, -71.41, 'RI'],
  ['des moines', 'Des Moines, IA', 41.59, -93.62, 'IA'], ['little rock', 'Little Rock, AR', 34.75, -92.29, 'AR'],
  ['savannah', 'Savannah, GA', 32.08, -81.09, 'GA'], ['harrisburg', 'Harrisburg, PA', 40.27, -76.88, 'PA'],
  ['lansing', 'Lansing, MI', 42.73, -84.56, 'MI'], ['flint', 'Flint, MI', 43.01, -83.69, 'MI'],
  ['grand rapids', 'Grand Rapids, MI', 42.96, -85.67, 'MI'], ['ventura county', 'Ventura County, CA', 34.36, -119.13, 'CA', 'los angeles'],
  // Unambiguous US twins of foreign names. Longest match first makes these win.
  ['paris texas', 'Paris, TX', 33.66, -95.56, 'TX'], ['paris tennessee', 'Paris, TN', 36.30, -88.33, 'TN'],
  ['paris kentucky', 'Paris, KY', 38.21, -84.25, 'KY'], ['moscow idaho', 'Moscow, ID', 46.73, -117.00, 'ID'],
  ['odessa texas', 'Odessa, TX', 31.85, -102.37, 'TX'], ['athens georgia', 'Athens, GA', 33.96, -83.38, 'GA'],
  ['rome georgia', 'Rome, GA', 34.26, -85.16, 'GA'], ['lima ohio', 'Lima, OH', 40.74, -84.11, 'OH'],
  ['panama city florida', 'Panama City, FL', 30.16, -85.66, 'FL']
];

for (const [key, p, lat, lon, rg, m] of CITIES) {
  put(key, { p, lat, lon, r: CITY, cc: 'US', rg, m: m || key });
}

// Ports get a tighter circle than the city. They are the one named watch target.
const LB_PORTS = { p: 'LA/Long Beach ports', lat: 33.74, lon: -118.24, r: 12000, cc: 'US', rg: 'CA', m: 'los angeles' };
put('port of los angeles', { p: 'Port of Los Angeles', lat: 33.73, lon: -118.26, r: 6000, cc: 'US', rg: 'CA', m: 'los angeles' });
put('port of la', { p: 'Port of Los Angeles', lat: 33.73, lon: -118.26, r: 6000, cc: 'US', rg: 'CA', m: 'los angeles' });
put('port of long beach', { p: 'Port of Long Beach', lat: 33.75, lon: -118.21, r: 6000, cc: 'US', rg: 'CA', m: 'los angeles' });
put('long beach port', { p: 'Port of Long Beach', lat: 33.75, lon: -118.21, r: 6000, cc: 'US', rg: 'CA', m: 'los angeles' });
put('terminal island', { p: 'Terminal Island, CA', lat: 33.75, lon: -118.24, r: 6000, cc: 'US', rg: 'CA', m: 'los angeles' });
for (const k of ['la lb', 'la long beach', 'los angeles long beach', 'la long beach ports', 'los angeles long beach ports',
  'la lb ports', 'port of los angeles and long beach', 'ports of los angeles and long beach', 'ports of la and long beach']) {
  put(k, Object.assign({}, LB_PORTS));
}

// Federal landmarks read as DC, and "D.C." normalizes to "dc" in prep().
const DC = { p: 'Washington, DC', lat: 38.91, lon: -77.04, r: 20000, cc: 'US', rg: 'DC', m: 'dc' };
for (const k of ['dc', 'washington dc', 'washington d c', 'district of columbia', 'white house', 'capitol hill', 'pentagon', 'us capitol']) {
  put(k, Object.assign({}, DC));
}
put('united states', { p: 'United States', lat: 39.83, lon: -98.58, r: 400000, cc: 'US', rg: 'US', m: null });
put('gulf of mexico', { p: 'Gulf of Mexico', lat: 25.0, lon: -90.0, r: 400000, cc: 'ZZ', rg: 'ZZ', m: null });

// ── Names that need the surrounding text to mean anything ─────────────────────
const GEORGIA_US = { k: 'georgia', p: 'Georgia', lat: 32.7, lon: -83.4, r: 220000, cc: 'US', rg: 'GA', m: null, weak: false };
const GEORGIA_GE = { k: 'georgia country', p: 'Georgia (country)', lat: 42.32, lon: 43.36, r: 120000, cc: 'GE', rg: 'GE', m: null, weak: false };
const GEORGIA_CTX = /\b(?:tbilisi|caucasus|abkhazia|south ossetia|georgian dream|kobakhidze|kavelashvili|zourabichvili|batumi|russian border|georgian (?:government|parliament|president|prime minister|opposition|capital|protesters?))\b/;

const JORDAN_REC = { k: 'jordan', p: 'Jordan', lat: 30.59, lon: 36.24, r: 120000, cc: 'JO', rg: 'JO', m: null, weak: false };
// "Jordan" is far more often a person. Whitelist the contexts where it is a country.
const JORDAN_CTX = /(?:\b(?:in|to|from|of|near|across|into|through|over|and|between|with|neighboring|neighbouring)\s+jordan\b(?!\s+(?:peterson|spieth|love|poole|clarkson|belfort|peele|chiles|mailata|davis|addison|montgomery|hicks))|\bjordan\s+(?:river|valley|border|king|closes?|reopens?|condemns?|intercepts?|shoots? down|airspace)\b|\bking abdullah\b|\bamman\b)/;

const WA_STATE = { k: 'washington state', p: 'Washington', lat: 47.4, lon: -120.4, r: 250000, cc: 'US', rg: 'WA', m: null, weak: false };
const WA_CTX = /\b(?:washington state|state of washington|eastern washington|western washington|seattle|spokane|tacoma|olympia)\b/;

// ── Adjectives. Weak: used only when the text names no actual place. ──────────
const DEMONYMS = {
  'russian': 'russia', 'russians': 'russia', 'ukrainian': 'ukraine', 'ukrainians': 'ukraine',
  'iranian': 'iran', 'iranians': 'iran', 'israeli': 'israel', 'israelis': 'israel',
  'chinese': 'china', 'taiwanese': 'taiwan', 'japanese': 'japan', 'lebanese': 'lebanon',
  'syrian': 'syria', 'syrians': 'syria', 'iraqi': 'iraq', 'iraqis': 'iraq', 'yemeni': 'yemen',
  'houthi': 'yemen', 'houthis': 'yemen', 'palestinian': 'gaza', 'palestinians': 'gaza',
  'north korean': 'north korea', 'south korean': 'south korea', 'pakistani': 'pakistan',
  'afghan': 'afghanistan', 'sudanese': 'sudan', 'somali': 'somalia', 'nigerian': 'nigeria',
  'egyptian': 'egypt', 'turkish': 'turkey', 'german': 'germany', 'french': 'france',
  'british': 'united kingdom', 'mexican': 'mexico', 'venezuelan': 'venezuela', 'colombian': 'colombia',
  'cuban': 'cuba', 'canadian': 'canada', 'canadians': 'canada', 'greek': 'greece', 'spanish': 'spain',
  'italian': 'italy', 'hungarian': 'hungary', 'serbian': 'serbia', 'belarusian': 'belarus',
  'saudi': 'saudi arabia', 'saudis': 'saudi arabia', 'emirati': 'united arab emirates', 'qatari': 'qatar',
  'filipino': 'philippines', 'indonesian': 'indonesia', 'thai': 'thailand', 'vietnamese': 'vietnam',
  'bangladeshi': 'bangladesh', 'haitian': 'haiti', 'brazilian': 'brazil', 'argentine': 'argentina'
};
for (const [word, target] of Object.entries(DEMONYMS)) {
  put(word, Object.assign({}, RECS.get(target), { k: word, weak: true }));
}

// ── False friends removed before matching ─────────────────────────────────────
// Runs on prep()'d text: lowercase, no punctuation, hyphens as spaces.
const EXCLUDE = new RegExp('\\b(?:' + [
  'paris hilton', 'paris jackson', 'paris saint germain', 'paris agreement', 'paris accord', 'paris climate',
  'paris fashion week', 'paris olympics', 'plaster of paris',
  'washington post', 'washington times', 'washington examiner', 'washington commanders', 'washington nationals',
  'washington wizards', 'washington capitals', 'washington mystics', 'washington huskies', 'washington university',
  'university of washington', 'george washington', 'denzel washington', 'kerry washington', 'booker t washington',
  'mount washington', 'mt washington',
  'lloyd austin', 'austin powers', 'austin butler', 'austin reaves', 'steve austin', 'stone cold austin',
  'whitney houston', 'river phoenix', 'joaquin phoenix', 'phoenix suns', 'phoenix mercury', 'john denver',
  'orlando bloom', 'princess charlotte', 'charlotte hornets', 'christopher columbus', 'columbus day',
  'james madison', 'madison square garden', 'madison avenue', 'madison beer',
  'buffalo wings?', 'buffalo bills', 'buffalo sabres', 'buffalo sauce', 'buffalo chicken', 'buffalo trace',
  'turkey (?:recall|dinner|sandwich|burger|trot|day|legs?|breast|bacon|hunt|hunting|farm|shortage|prices?|pardon|bowl|stuffing|gravy)',
  '(?:thanksgiving|wild|roast|roasted|smoked|butterball|fried|ground|cold|pardoned) turkey',
  'guinea pigs?', 'chile (?:peppers?|relleno|sauce|powder|crunch)', 'panama hats?', 'cuba gooding',
  'china (?:shop|cabinet|doll|plate|plates|pattern|set)', 'bone china', 'fine china',
  'new mexico lobos', 'indiana jones', 'indiana pacers', 'montana cans', 'hannah montana', 'virginia woolf',
  'french fries', 'french toast', 'french press', 'french bulldogs?', 'french open', 'german shepherds?',
  'greek yogurt', 'greek salad', 'thai food', 'thai restaurant', 'russian roulette', 'russian doll', 'spanish flu'
].join('|') + ')\\b', 'g');

// Longest first, so the engine tries "new mexico" before "mexico" at each position.
const ALL_KEYS = [...RECS.keys(), 'georgia', 'jordan', 'washington'].sort((a, b) => b.length - a.length);
const PLACE_RE = new RegExp('\\b(?:' + ALL_KEYS.join('|').replace(/\./g, '\\.') + ')\\b', 'g');

function prep(text) {
  return String(text == null ? '' : text).slice(0, 800)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/'s\b/g, '')
    .replace(/['.,]/g, '')
    .replace(/[-‐-―/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolve(key, t) {
  if (key === 'georgia') return GEORGIA_CTX.test(t) ? GEORGIA_GE : GEORGIA_US;
  if (key === 'jordan') return JORDAN_CTX.test(t) ? JORDAN_REC : null;
  if (key === 'washington') return WA_CTX.test(t) ? WA_STATE : RECS.get('dc');
  return RECS.get(key) || null;
}

function scan(text) {
  const t = prep(text).replace(EXCLUDE, ' ');
  const hits = [];
  if (!t) return hits;
  for (const m of t.matchAll(PLACE_RE)) {
    const rec = resolve(m[0], t);
    if (rec) hits.push(rec);
  }
  return hits;
}

/**
 * geocode(text) -> { p, lat, lon, r, cc } | null
 * The most specific place named in the text. Always a fresh object, so a caller
 * can never corrupt the table by mutating what it gets back.
 */
function geocode(text) {
  let best = null;
  for (const h of scan(text)) {
    if (!best) { best = h; continue; }
    if (best.weak && !h.weak) { best = h; continue; }
    if (h.weak && !best.weak) continue;
    if (h.r < best.r) best = h;
  }
  return best ? { p: best.p, lat: best.lat, lon: best.lon, r: best.r, cc: best.cc } : null;
}

/**
 * places(text) -> { metros, regions, us, foreign }
 * What the text names, at two levels of detail. Clustering compares metros when
 * both sides have one, otherwise regions. classify.js reads us/foreign.
 */
function places(text) {
  const metros = new Set();
  const regions = new Set();
  let us = false;
  let foreign = false;
  for (const h of scan(text)) {
    if (h.cc === 'US') us = true;
    else foreign = true;
    if (h.weak) continue;   // "Russian hackers hit Texas" is not a story about Russia's location
    regions.add(h.rg);
    if (h.m) metros.add(h.m);
  }
  return { metros, regions, us, foreign };
}

module.exports = { geocode, places, prep };
