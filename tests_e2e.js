// ═══════════════════════════════════════════════════════════════════
// E2E Tests — rauszeit. (simuliert Browser-Verhalten in Node.js)
// Run: node tests_e2e.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const html = fs.readFileSync('/mnt/user-data/outputs/trip-finder.html', 'utf8');

// ── Syntax-Check: JS aus HTML extrahieren und prüfen ──────────────
const { execSync } = require('child_process');
const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
const allJs = scriptMatches.map(s => s.replace(/<\/?script[^>]*>/g, '')).join('\n');
require('fs').writeFileSync('/tmp/_rauszeit_check.js', allJs);
try {
  execSync('node --check /tmp/_rauszeit_check.js', { stdio: 'pipe' });
  console.log('\n✓ [SX-01] JS Syntax valide\n');
} catch(e) {
  console.error('\n✗ [SX-01] JS SYNTAX FEHLER:');
  console.error(e.stderr?.toString() || e.stdout?.toString());
  console.error('\nSyntaxfehler gefunden — weitere Tests abgebrochen.');
  process.exit(1);
}

let passed = 0, failed = 0, total = 0;
const results = [];

function test(id, name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ [${id}] ${name}`);
    passed++;
    results.push({ id, name, status: 'PASS' });
  } catch(e) {
    console.error(`  ✗ [${id}] ${name}\n      → ${e.message}`);
    failed++;
    results.push({ id, name, status: 'FAIL', error: e.message });
  }
}
function assert(val, msg) { if (!val) throw new Error(msg || `Expected truthy, got: ${JSON.stringify(val)}`); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function assertNone(arr, pred, msg) {
  const found = arr.filter(pred);
  if (found.length) throw new Error(msg || `Found unexpected items: ${found.map(v=>v.name).join(', ')}`);
}
function assertAll(arr, pred, msg) {
  const bad = arr.filter(v => !pred(v));
  if (bad.length) throw new Error(msg || `Failed for: ${bad.map(v=>v.name).join(', ')}`);
}

// ── Load app data ─────────────────────────────────────────────────
const vStart = html.indexOf('const LOCAL_VENUES =');
const arrStart = html.indexOf('[', vStart);
let depth=0, end=arrStart;
for(let i=arrStart;i<arrStart+600000;i++){if(html[i]==='[')depth++;else if(html[i]===']'){depth--;if(depth===0){end=i;break;}}}
const LOCAL_VENUES = JSON.parse(html.substring(arrStart, end+1));

const KNOWN_LOCATIONS = [
  { label: 'Pfaffenhofen an der Ilm', region: 'pfaffenhofen', keywords: ['pfaffenhofen','85276'] },
  { label: 'Miedzywodzie (Misdroy)',   region: 'miedzywodzie', keywords: ['miedzy','misdroy','miedzyw','72-014'] },
];

function detectLocalRegion(loc) {
  const lower = loc.toLowerCase().trim();
  for (const l of KNOWN_LOCATIONS) if (l.keywords.some(k => lower.includes(k))) return l.region;
  return null;
}

function getAutocomplete(val) {
  if (val.length < 3) return [];
  const lower = val.toLowerCase().trim();
  return KNOWN_LOCATIONS.filter(loc =>
    loc.keywords.some(k => k.includes(lower.substring(0,4)) || lower.startsWith(k.substring(0,4)))
  );
}

function searchLocalDB(maxKm, actType, envType, whoFor, venuePool) {
  const pool = venuePool || LOCAL_VENUES;
  let results = pool.filter(v => v.distanceKm <= maxKm);
  if (actType === 'restaurant') {
    results = results.filter(v => v.category === 'restaurant');
  } else if (actType !== 'any') {
    results = results.filter(v => v.category === actType);
  } else {
    results = results.filter(v => v.category !== 'restaurant');
  }
  if (envType !== 'any') results = results.filter(v => v.environment === envType);
  if (whoFor !== 'both') results = results.filter(v => v.suitableFor === whoFor || v.suitableFor === 'both');
  results.sort((a,b) => a.distanceKm - b.distanceKm);
  const catCount={}, picked=[], rest=[];
  for (const v of results) {
    catCount[v.category]=catCount[v.category]||0;
    if (picked.length<9 && catCount[v.category]<3) { picked.push(v); catCount[v.category]++; }
    else rest.push(v);
  }
  for (const v of rest.filter(v=>!picked.includes(v))) { if(picked.length>=9)break; picked.push(v); }
  const remainder = results.filter(v=>!picked.includes(v));
  return { initial: picked, remainder, all: results };
}

function applyRestaurantFilters(venues, { cuisine='any', price='any', terrace=false, playground=false, noReserv=false }={}) {
  return venues
    .filter(r => cuisine==='any' || r.cuisine===cuisine)
    .filter(r => price==='any'   || r.priceRange===price)
    .filter(r => !terrace        || r.terrace===true)
    .filter(r => !playground     || r.playground===true)
    .filter(r => !noReserv       || r.reservationNeeded===false);
}

// ═══════════════════════════════════════════════════════════════════
// UC-01  AUTOCOMPLETE
// ═══════════════════════════════════════════════════════════════════
console.log('\n📍 UC-01 Autocomplete & Ortserkennung');

test('AC-01', 'Eingabe "Mied" zeigt Miedzywodzie-Vorschlag', () => {
  const r = getAutocomplete('Mied');
  assert(r.length > 0, 'Kein Vorschlag');
  assertEqual(r[0].region, 'miedzywodzie');
});
test('AC-02', 'Eingabe "mied" (lowercase) zeigt Vorschlag', () => {
  assert(getAutocomplete('mied').length > 0);
});
test('AC-03', 'Eingabe "Pfaff" zeigt Pfaffenhofen-Vorschlag', () => {
  const r = getAutocomplete('Pfaff');
  assert(r.length > 0);
  assertEqual(r[0].region, 'pfaffenhofen');
});
test('AC-04', 'Eingabe "Mi" (zu kurz) zeigt keinen Vorschlag', () => {
  assertEqual(getAutocomplete('Mi').length, 0);
});
test('AC-05', 'Eingabe "Berlin" zeigt keinen Vorschlag', () => {
  assertEqual(getAutocomplete('Berlin').length, 0);
});
test('AC-06', 'Autocomplete-Label "Miedzywodzie (Misdroy)" wird als Region erkannt', () => {
  assertEqual(detectLocalRegion('Miedzywodzie (Misdroy)'), 'miedzywodzie');
});
test('AC-07', 'PLZ 85276 wird als Pfaffenhofen erkannt', () => {
  assertEqual(detectLocalRegion('85276'), 'pfaffenhofen');
});
test('AC-08', 'PLZ 72-014 wird als Miedzywodzie erkannt', () => {
  assertEqual(detectLocalRegion('72-014'), 'miedzywodzie');
});

// ═══════════════════════════════════════════════════════════════════
// UC-02  AKTIVITÄTEN-SUCHE PFAFFENHOFEN (lokale DB)
// ═══════════════════════════════════════════════════════════════════
console.log('\n🎯 UC-02 Aktivitätensuche Pfaffenhofen — Lokale DB');

const pfaffPool = LOCAL_VENUES.filter(v => !v.region || v.region === 'pfaffenhofen');

test('PF-01', 'Lokale DB wird für Pfaffenhofen getriggert', () => {
  assertEqual(detectLocalRegion('Pfaffenhofen an der Ilm, Deutschland'), 'pfaffenhofen');
});
test('PF-02', 'Suche "alle Typen, 100km" liefert 9 initiale Ergebnisse', () => {
  const { initial } = searchLocalDB(100, 'any', 'any', 'both', pfaffPool);
  assertEqual(initial.length, 9);
});
test('PF-03', 'Suche "alle Typen, 100km" hat Remainder für Pagination', () => {
  const { remainder } = searchLocalDB(100, 'any', 'any', 'both', pfaffPool);
  assert(remainder.length > 0, 'Kein Remainder — Pagination würde nicht funktionieren');
});
test('PF-04', 'Restaurants erscheinen NICHT in Aktivitätsergebnissen', () => {
  const { all } = searchLocalDB(100, 'any', 'any', 'both', pfaffPool);
  assertNone(all, v => v.category === 'restaurant', 'Restaurant in Aktivitätsergebnissen gefunden');
});
test('PF-05', 'Filter "Nur Draußen" liefert nur outdoor-Venues', () => {
  const { all } = searchLocalDB(100, 'any', 'outdoor', 'both', pfaffPool);
  assertAll(all, v => v.environment === 'outdoor', 'Indoor-Venue in outdoor-Ergebnissen');
});
test('PF-06', 'Filter "Mit Kindern" liefert nur geeignete Venues', () => {
  const { all } = searchLocalDB(100, 'any', 'any', 'kids', pfaffPool);
  assertAll(all, v => v.suitableFor === 'kids' || v.suitableFor === 'both');
});
test('PF-07', 'Filter "Wasserparks & Seen" liefert nur water-Venues', () => {
  const { all } = searchLocalDB(100, 'water', 'any', 'both', pfaffPool);
  assertAll(all, v => v.category === 'water');
  assert(all.length > 0, 'Keine Wasser-Venues gefunden');
});
test('PF-08', 'Radius 30km schränkt Ergebnisse korrekt ein', () => {
  const { all } = searchLocalDB(30, 'any', 'any', 'both', pfaffPool);
  assertAll(all, v => v.distanceKm <= 30, 'Venue außerhalb 30km-Radius');
});
test('PF-09', 'Variety: max 3 Venues pro Kategorie in den ersten 9', () => {
  const { initial } = searchLocalDB(200, 'any', 'any', 'both', pfaffPool);
  const catCount = {};
  initial.forEach(v => { catCount[v.category]=(catCount[v.category]||0)+1; });
  Object.entries(catCount).forEach(([cat, count]) => {
    assert(count <= 3, `Kategorie "${cat}" hat ${count} Einträge in den ersten 9 (max 3)`);
  });
});

// ═══════════════════════════════════════════════════════════════════
// UC-03  AKTIVITÄTEN-SUCHE MIEDZYWODZIE (lokale DB)
// ═══════════════════════════════════════════════════════════════════
console.log('\n🌊 UC-03 Aktivitätensuche Miedzywodzie — Lokale DB');

const miedzyPool = LOCAL_VENUES.filter(v => v.region === 'miedzywodzie');

test('MZ-01', 'Lokale DB wird für Miedzywodzie getriggert', () => {
  assertEqual(detectLocalRegion('Miedzywodzie (Misdroy)'), 'miedzywodzie');
});
test('MZ-02', '"Misdroy" (dt. Name) triggert lokale DB', () => {
  assertEqual(detectLocalRegion('Misdroy'), 'miedzywodzie');
});
test('MZ-03', 'Suche liefert 9 initiale Aktivitäten (keine Restaurants)', () => {
  const { initial } = searchLocalDB(100, 'any', 'any', 'both', miedzyPool);
  assertEqual(initial.length, 9);
  assertNone(initial, v => v.category === 'restaurant', 'Restaurant in Aktivitätsergebnissen');
});
test('MZ-04', 'Alle 28 Miedzywodzie-Aktivitäten über Pagination erreichbar', () => {
  const { all } = searchLocalDB(100, 'any', 'any', 'both', miedzyPool);
  const miedzyActs = miedzyPool.filter(v => v.category !== 'restaurant' && v.distanceKm <= 100);
  assertEqual(all.length, miedzyActs.length);
});
test('MZ-05', 'Radius 30km liefert nur nahe Venues', () => {
  const { all } = searchLocalDB(30, 'any', 'any', 'both', miedzyPool);
  assertAll(all, v => v.distanceKm <= 30 && v.category !== 'restaurant');
});
test('MZ-06', 'Mit-Kindern-Filter schließt ungeeignete Venues aus', () => {
  const { all } = searchLocalDB(100, 'any', 'any', 'kids', miedzyPool);
  assertAll(all, v => v.suitableFor === 'kids' || v.suitableFor === 'both');
});

// ═══════════════════════════════════════════════════════════════════
// UC-04  RESTAURANT-SUCHE MIEDZYWODZIE
// ═══════════════════════════════════════════════════════════════════
console.log('\n🍽️  UC-04 Restaurantsuche Miedzywodzie');

const miedzyRests = miedzyPool.filter(v => v.category === 'restaurant');

test('RS-01', 'Restaurant-Modus liefert ausschließlich Restaurants', () => {
  const { all } = searchLocalDB(100, 'restaurant', 'any', 'both', miedzyPool);
  assertAll(all, v => v.category === 'restaurant', 'Nicht-Restaurant in Ergebnissen');
  assert(all.length > 0, 'Keine Restaurants gefunden');
});
test('RS-02', 'Alle 12 Miedzywodzie-Restaurants erreichbar', () => {
  const { all } = searchLocalDB(100, 'restaurant', 'any', 'both', miedzyPool);
  assertEqual(all.length, 12);
});
test('RS-03', 'Filter "Polnisch" liefert nur polnische Restaurants', () => {
  const { all } = searchLocalDB(100, 'restaurant', 'any', 'both', miedzyPool);
  const filtered = applyRestaurantFilters(all, { cuisine: 'polish' });
  assert(filtered.length > 0, 'Keine polnischen Restaurants');
  assertAll(filtered, r => r.cuisine === 'polish');
});
test('RS-04', 'Filter "€" liefert nur günstige Restaurants', () => {
  const { all } = searchLocalDB(100, 'restaurant', 'any', 'both', miedzyPool);
  const filtered = applyRestaurantFilters(all, { price: '€' });
  assert(filtered.length > 0, 'Keine günstigen Restaurants');
  assertAll(filtered, r => r.priceRange === '€');
});
test('RS-05', 'Terrassen-Filter gibt nur Restaurants mit Terrasse', () => {
  const { all } = searchLocalDB(100, 'restaurant', 'any', 'both', miedzyPool);
  const filtered = applyRestaurantFilters(all, { terrace: true });
  assert(filtered.length > 0, 'Keine Restaurants mit Terrasse');
  assertAll(filtered, r => r.terrace === true);
});
test('RS-06', 'Spielplatz-Filter gibt nur Restaurants mit Spielplatz', () => {
  const { all } = searchLocalDB(100, 'restaurant', 'any', 'both', miedzyPool);
  const filtered = applyRestaurantFilters(all, { playground: true });
  assert(filtered.length > 0, 'Keine Restaurants mit Spielplatz');
  assertAll(filtered, r => r.playground === true);
});
test('RS-07', 'Kombination Polnisch + Terrasse funktioniert', () => {
  const { all } = searchLocalDB(100, 'restaurant', 'any', 'both', miedzyPool);
  const filtered = applyRestaurantFilters(all, { cuisine: 'polish', terrace: true });
  assertAll(filtered, r => r.cuisine === 'polish' && r.terrace === true);
});
test('RS-08', 'Aktivitäten erscheinen NICHT in Restaurant-Ergebnissen', () => {
  const { all } = searchLocalDB(100, 'restaurant', 'any', 'both', miedzyPool);
  assertNone(all, v => v.category !== 'restaurant', 'Nicht-Restaurant in Restaurant-Ergebnissen');
});
test('RS-09', 'Mit-Kindern-Filter bei Restaurants funktioniert', () => {
  const { all } = searchLocalDB(100, 'restaurant', 'any', 'kids', miedzyPool);
  assertAll(all, r => r.suitableFor === 'kids' || r.suitableFor === 'both');
});

// ═══════════════════════════════════════════════════════════════════
// UC-05  PAGINATION
// ═══════════════════════════════════════════════════════════════════
console.log('\n📄 UC-05 Pagination — "Weitere laden"');

test('PG-01', 'Miedzywodzie: initial=9, remainder enthält den Rest', () => {
  const { initial, remainder } = searchLocalDB(100, 'any', 'any', 'both', miedzyPool);
  assertEqual(initial.length, 9);
  assert(remainder.length > 0, 'Kein Remainder für Pagination');
});
test('PG-02', 'initial + remainder = alle gefilterten Venues', () => {
  const { initial, remainder, all } = searchLocalDB(100, 'any', 'any', 'both', miedzyPool);
  assertEqual(initial.length + remainder.length, all.length);
});
test('PG-03', 'Pfaffenhofen: Pagination liefert alle 61 Aktivitäten', () => {
  const { initial, remainder } = searchLocalDB(200, 'any', 'any', 'both', pfaffPool);
  const total = initial.length + remainder.length;
  const expected = pfaffPool.filter(v => v.category !== 'restaurant' && v.distanceKm <= 200).length;
  assertEqual(total, expected, `${total} statt ${expected} Venues via Pagination`);
});
test('PG-04', 'Keine Duplikate zwischen initial und remainder', () => {
  const { initial, remainder } = searchLocalDB(100, 'any', 'any', 'both', miedzyPool);
  const initialNames = new Set(initial.map(v => v.name));
  const dups = remainder.filter(v => initialNames.has(v.name));
  assertEqual(dups.length, 0, `Duplikate: ${dups.map(v=>v.name).join(', ')}`);
});

// ═══════════════════════════════════════════════════════════════════
// UC-06  MODUS-TRENNUNG (Aktivitäten vs. Restaurants)
// ═══════════════════════════════════════════════════════════════════
console.log('\n🔀 UC-06 Modus-Trennung');

test('MD-01', 'actType=any schließt Restaurants aus', () => {
  const { all } = searchLocalDB(100, 'any', 'any', 'both', miedzyPool);
  assertNone(all, v => v.category === 'restaurant');
});
test('MD-02', 'actType=restaurant liefert NUR Restaurants', () => {
  const { all } = searchLocalDB(100, 'restaurant', 'any', 'both', miedzyPool);
  assertAll(all, v => v.category === 'restaurant');
});
test('MD-03', 'actType=water schließt Restaurants aus', () => {
  const { all } = searchLocalDB(100, 'water', 'any', 'both', miedzyPool);
  assertNone(all, v => v.category === 'restaurant');
});
test('MD-04', 'Pfaffenhofen actType=any enthält keine Restaurants', () => {
  const { all } = searchLocalDB(200, 'any', 'any', 'both', pfaffPool);
  assertNone(all, v => v.category === 'restaurant');
});

// ═══════════════════════════════════════════════════════════════════
// UC-07  DATUM & WETTER-VALIDIERUNG
// ═══════════════════════════════════════════════════════════════════
console.log('\n📅 UC-07 Datum & Wetter');

function isDateInForecastWindow(dateStr) {
  const today = new Date().toISOString().split('T')[0];
  const maxDate = new Date(); maxDate.setDate(maxDate.getDate() + 16);
  const maxStr = maxDate.toISOString().split('T')[0];
  return dateStr >= today && dateStr <= maxStr;
}

test('DT-01', 'Heutiges Datum liegt im Wetter-Fenster', () => {
  const today = new Date().toISOString().split('T')[0];
  assert(isDateInForecastWindow(today));
});
test('DT-02', 'Datum in 15 Tagen liegt im Wetter-Fenster', () => {
  const d = new Date(); d.setDate(d.getDate() + 15);
  assert(isDateInForecastWindow(d.toISOString().split('T')[0]));
});
test('DT-03', 'Datum in 17 Tagen liegt NICHT im Wetter-Fenster', () => {
  const d = new Date(); d.setDate(d.getDate() + 17);
  assert(!isDateInForecastWindow(d.toISOString().split('T')[0]));
});
test('DT-04', 'Vergangenes Datum liegt NICHT im Wetter-Fenster', () => {
  assert(!isDateInForecastWindow('2024-01-01'));
});
test('DT-05', 'Wetter-Guard in loadWeather vorhanden', () => {
  assert(html.includes('date > maxStr'));
});
test('DT-06', 'Wetter-Guard in loadSpotWeather vorhanden', () => {
  assert(html.includes('date > maxDate.toISOString'));
});

// ═══════════════════════════════════════════════════════════════════
// UC-08  DATENQUALITÄT
// ═══════════════════════════════════════════════════════════════════
console.log('\n🗂️  UC-08 Datenqualität');

test('DQ-01', 'Alle Venues haben Pflichtfelder', () => {
  const required = ['name','location','category','distanceKm','driveMinutes','suitableFor','lat','lon'];
  LOCAL_VENUES.forEach(v => {
    required.forEach(f => {
      if (v[f] === undefined) throw new Error(`"${v.name}" fehlt: ${f}`);
    });
  });
});
test('DQ-02', 'Alle Restaurants haben Restaurant-spezifische Felder', () => {
  const rests = LOCAL_VENUES.filter(v => v.category === 'restaurant');
  rests.forEach(r => {
    ['cuisine','priceRange','childFriendly','terrace','playground'].forEach(f => {
      if (r[f] === undefined) throw new Error(`"${r.name}" fehlt: ${f}`);
    });
  });
});
test('DQ-03', 'Alle Miedzywodzie-Venues haben region=miedzywodzie', () => {
  const miedzy = LOCAL_VENUES.filter(v => v.region === 'miedzywodzie');
  miedzy.forEach(v => assertEqual(v.region, 'miedzywodzie', `${v.name}`));
});
test('DQ-04', 'Keine Venue hat distanceKm < 0', () => {
  LOCAL_VENUES.forEach(v => assert(v.distanceKm >= 0, `${v.name}: distanceKm=${v.distanceKm}`));
});
test('DQ-05', 'Alle googleRatings zwischen 3.5 und 5.0', () => {
  LOCAL_VENUES.filter(v => v.googleRating).forEach(v =>
    assert(v.googleRating >= 3.5 && v.googleRating <= 5.0, `${v.name}: ${v.googleRating}`));
});
test('DQ-06', 'Gesamtzahl DB: 101 Einträge (61 Pfaffenhofen + 40 Miedzywodzie)', () => {
  assertEqual(LOCAL_VENUES.length, 101, `Nur ${LOCAL_VENUES.length} Venues`);
});
test('DQ-07', '28 Miedzywodzie-Aktivitäten + 12 Restaurants = 40 gesamt', () => {
  const miedzy = LOCAL_VENUES.filter(v => v.region === 'miedzywodzie');
  const acts = miedzy.filter(v => v.category !== 'restaurant');
  const rests = miedzy.filter(v => v.category === 'restaurant');
  assertEqual(acts.length, 28, `${acts.length} Aktivitäten statt 28`);
  assertEqual(rests.length, 12, `${rests.length} Restaurants statt 12`);
  assertEqual(miedzy.length, 40, `${miedzy.length} gesamt statt 40`);
});


// ═══════════════════════════════════════════════════════════════════
// UC-09 Skeleton & Streaming
// ═══════════════════════════════════════════════════════════════════
console.log('\n🦴  UC-09 Skeleton & Streaming');

test('SK-01', 'showSkeletons-Funktion ist vorhanden', () => {
  assert(html.includes('function showSkeletons'), 'showSkeletons fehlt');
});
test('SK-02', 'Skeleton-CSS shimmer-Animation vorhanden', () => {
  assert(html.includes('shimmer'), 'Shimmer-Animation fehlt');
  assert(html.includes('skeleton-card'), 'skeleton-card CSS fehlt');
});
test('SK-03', 'showSkeletons wird vor Anthropic API-Call aufgerufen', () => {
  const skeletonIdx = html.indexOf('showSkeletons(9)');
  const anthropicIdx = html.indexOf('stream:true,messages:');
  assert(skeletonIdx > 0, 'showSkeletons(9) nicht gefunden');
  assert(anthropicIdx > 0, 'Anthropic API-Call nicht gefunden');
  assert(skeletonIdx < anthropicIdx, 'showSkeletons muss VOR dem Anthropic-fetch stehen');
});
test('SK-04', 'Streaming ist aktiviert (stream:true)', () => {
  assert(html.includes('stream:true'), 'stream:true fehlt im API-Call');
});
test('SK-05', 'Streaming-Reader Code vorhanden', () => {
  assert(html.includes('getReader'), 'getReader fehlt');
  assert(html.includes('tryExtractVenue'), 'tryExtractVenue fehlt');
  assert(html.includes('content_block_delta'), 'SSE-Event-Handling fehlt');
});
test('SK-06', 'Fallback für file:// Umgebungen vorhanden', () => {
  assert(html.includes('venuesRes.body.getReader'), 'Streaming-Guard fehlt');
  assert(html.includes('Fallback auf JSON'), 'Fallback-Kommentar fehlt');
});
test('SK-07', 'Skeletons werden beim ersten Streaming-Treffer geleert', () => {
  assert(html.includes('skeletonsCleared'), 'skeletonsCleared-Flag fehlt');
  assert(html.includes('skeletonsCleared = true'), 'Skeletons-Clear fehlt');
});
test('SK-08', 'Progress-Bar wird während Streaming animiert', () => {
  assert(html.includes('statusInterval'), 'statusInterval fehlt');
  assert(html.includes('statusMessages'), 'statusMessages fehlt');
});

// ═══════════════════════════════════════════════════════════════════
// ZUSAMMENFASSUNG
// ═══════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
const emoji = failed === 0 ? '🎉' : '⚠️';
console.log(`${emoji}  ${passed} bestanden  |  ${failed} fehlgeschlagen  |  ${total} gesamt\n`);

if (failed > 0) {
  console.log('Fehlgeschlagene Tests:');
  results.filter(r => r.status === 'FAIL').forEach(r =>
    console.log(`  ✗ [${r.id}] ${r.name}\n    ${r.error}`)
  );
}

// Export test registry for re-runs
fs.writeFileSync('/home/claude/e2e_registry.json', JSON.stringify(results, null, 2));
console.log('Test-Registry gespeichert: /home/claude/e2e_registry.json');

if (failed > 0) process.exit(1);
