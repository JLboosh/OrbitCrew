/**
 * Imports gyms from OpenStreetMap into the `gyms` table.
 *
 * WHY THIS IS A BATCH IMPORTER AND NOT A LIVE PROXY
 * -------------------------------------------------
 * The public Overpass API's usage policy allows roughly 10,000 requests and 1 GB
 * per day for an ENTIRE application — not per user. Calling it whenever a user
 * pans the map would blow through that in minutes and get the app blocked.
 *
 * So gyms are imported in bulk, keyed on `osm_id` for idempotency, and the app
 * only ever queries our own GIST-indexed table via `nearby_gyms()`. That is
 * faster, keeps the map working when Overpass is unavailable, and stays well
 * inside the free usage policy.
 *
 * Data is © OpenStreetMap contributors, ODbL. Attribution is required wherever
 * this data is displayed.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/ingest-osm-gyms.mjs waterloo
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/ingest-osm-gyms.mjs 43.42 -80.60 43.52 -80.46
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

/**
 * Overpass endpoints, tried in order.
 *
 * The main instance is frequently overloaded and returns 504 or 429. Each
 * endpoint gets exactly ONE attempt before moving to the next: retry-looping a
 * single endpoint is what gets clients banned, whereas trying an alternative
 * mirror once is normal, policy-compliant behaviour.
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Overpass asks that clients identify themselves so operators can contact the
// author of a misbehaving script rather than blanket-ban an IP range.
const USER_AGENT = 'gymcrew/0.1 (gym directory import; contact: dev@gymcrew.app)';

/** Convenience bounding boxes: [south, west, north, east]. */
const PRESETS = {
  waterloo: [43.42, -80.6, 43.52, -80.46],
  toronto: [43.58, -79.55, 43.75, -79.25],
};

function loadEnv() {
  const out = {};
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2];
    }
  } catch {
    /* optional */
  }
  return out;
}

/**
 * Builds the Overpass QL query.
 *
 * Tag choices reflect how gyms are actually mapped in OSM, which is
 * inconsistent:
 *   * `leisure=fitness_centre` is the current recommended tag.
 *   * `amenity=gym` is deprecated but still widespread in older data.
 *   * `leisure=sports_centre` + `sport=fitness` catches multi-sport venues that
 *     contain a gym.
 *
 * `out center` returns a representative point for ways and relations, so
 * building footprints yield usable coordinates rather than being skipped.
 */
function buildQuery([south, west, north, east]) {
  const bbox = `${south},${west},${north},${east}`;
  return `
[out:json][timeout:90];
(
  node["leisure"="fitness_centre"](${bbox});
  way["leisure"="fitness_centre"](${bbox});
  relation["leisure"="fitness_centre"](${bbox});
  node["amenity"="gym"](${bbox});
  way["amenity"="gym"](${bbox});
  node["leisure"="sports_centre"]["sport"~"fitness|weightlifting"](${bbox});
  way["leisure"="sports_centre"]["sport"~"fitness|weightlifting"](${bbox});
);
out center tags;
`.trim();
}

/** Composes an OSM address from its constituent tags. */
function formatAddress(tags) {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:city'],
    tags['addr:state'] ?? tags['addr:province'],
    tags['addr:postcode'],
  ].filter((p) => p && p.trim());

  return parts.length ? parts.join(', ') : null;
}

function normaliseCountry(tags) {
  const code = tags['addr:country'];
  return code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null;
}

async function fetchFromOverpass(bbox) {
  const query = buildQuery(bbox);
  console.log(`Querying Overpass for bbox [${bbox.join(', ')}]...`);

  const problems = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const host = new URL(endpoint).host;
    process.stdout.write(`  trying ${host} ... `);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
        // Overpass can legitimately take a while; give up rather than hang.
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        // 429 = rate limited, 504 = server overloaded. Both mean "try elsewhere",
        // never "hammer this endpoint again".
        console.log(`HTTP ${response.status}`);
        problems.push(`${host}: HTTP ${response.status}`);
        continue;
      }

      const payload = await response.json();
      const elements = payload.elements ?? [];
      console.log(`OK (${elements.length} elements)`);
      return elements;
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? 'timed out' : err.message;
      console.log(reason);
      problems.push(`${host}: ${reason}`);
    }
  }

  throw new Error(
    `All Overpass endpoints failed:\n  ${problems.join('\n  ')}\n` +
      'These are free community servers and are often busy. Wait a few minutes and retry.',
  );
}

function toGymRecords(elements) {
  const records = [];
  let skippedUnnamed = 0;
  let skippedNoCoords = 0;

  for (const el of elements) {
    const tags = el.tags ?? {};

    // An unnamed gym is not useful to show on a map or check into.
    const name = tags.name?.trim();
    if (!name) {
      skippedUnnamed += 1;
      continue;
    }

    // Nodes carry lat/lon directly; ways and relations carry `center`.
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      skippedNoCoords += 1;
      continue;
    }

    records.push({
      osm_id: `${el.type}/${el.id}`,
      name,
      latitude: lat,
      longitude: lon,
      address: formatAddress(tags),
      city: tags['addr:city'] ?? null,
      country_code: normaliseCountry(tags),
      opening_hours: tags.opening_hours ?? null,
      phone: tags.phone ?? tags['contact:phone'] ?? null,
      website: tags.website ?? tags['contact:website'] ?? null,
    });
  }

  return { records, skippedUnnamed, skippedNoCoords };
}

async function main() {
  const args = process.argv.slice(2);
  const fileEnv = loadEnv();

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? fileEnv.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    console.error('Missing EXPO_PUBLIC_SUPABASE_URL');
    process.exit(1);
  }
  if (!serviceKey) {
    console.error(
      'Missing SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Writing to the shared gym directory is service-role only by design.',
    );
    process.exit(1);
  }

  let bbox;
  if (args.length === 1 && PRESETS[args[0]]) {
    bbox = PRESETS[args[0]];
  } else if (args.length === 4 && args.every((a) => !Number.isNaN(Number(a)))) {
    bbox = args.map(Number);
  } else {
    console.error(
      'Usage:\n' +
        `  node scripts/ingest-osm-gyms.mjs <${Object.keys(PRESETS).join('|')}>\n` +
        '  node scripts/ingest-osm-gyms.mjs <south> <west> <north> <east>',
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const elements = await fetchFromOverpass(bbox);
  console.log(`Overpass returned ${elements.length} elements.`);

  const { records, skippedUnnamed, skippedNoCoords } = toGymRecords(elements);
  console.log(
    `Usable: ${records.length}  (skipped ${skippedUnnamed} unnamed, ${skippedNoCoords} without coordinates)`,
  );

  let imported = 0;
  const errors = [];

  for (const gym of records) {
    const { error } = await supabase.rpc('upsert_osm_gym', {
      p_osm_id: gym.osm_id,
      p_name: gym.name,
      p_latitude: gym.latitude,
      p_longitude: gym.longitude,
      p_address: gym.address,
      p_city: gym.city,
      p_country_code: gym.country_code,
      p_opening_hours: gym.opening_hours,
      p_phone: gym.phone,
      p_website: gym.website,
    });

    if (error) {
      errors.push(`${gym.osm_id} (${gym.name}): ${error.message}`);
    } else {
      imported += 1;
    }
  }

  console.log(`\nUpserted ${imported}/${records.length} gyms.`);
  if (errors.length) {
    console.log(`${errors.length} failed:`);
    errors.slice(0, 10).forEach((e) => console.log(`  - ${e}`));
  }
  console.log('\nData © OpenStreetMap contributors, ODbL.');

  process.exit(errors.length && imported === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
