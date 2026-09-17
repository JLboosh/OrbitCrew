/**
 * Verifies gym search and ratings against the REAL Supabase project, using the
 * real OpenStreetMap data imported by scripts/ingest-osm-gyms.mjs.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-gyms.mjs
 */

import { createHarness, loadConfig } from './lib/harness.mjs';

const config = loadConfig(import.meta.url);
const harness = createHarness(config);

// University of Waterloo campus — the centre of the imported bounding box.
const ORIGIN = { lat: 43.4723, lon: -80.5449 };

await harness.run(async ({ admin, createUser, check, section }) => {
  const alex = await createUser('gymalex');
  const sam = await createUser('gymsam');

  // -------------------------------------------------------------------------
  section('1. Imported OpenStreetMap data is present');

  const { data: allGyms, error: listErr } = await alex.client.from('gyms').select('id,name,osm_id');
  check('authenticated member can read the gym directory', !listErr, listErr?.message);
  check('gyms were imported', (allGyms?.length ?? 0) > 0, `found ${allGyms?.length}`);
  check(
    'every imported gym carries its OSM identity',
    allGyms?.every((g) => !!g.osm_id),
    'some gyms lack osm_id',
  );
  check(
    'OSM ids use the type/id form so ways and nodes cannot collide',
    allGyms?.every((g) => /^(node|way|relation)\/\d+$/.test(g.osm_id)),
  );

  // -------------------------------------------------------------------------
  section('2. PostGIS nearby search');

  const { data: nearby, error: nearbyErr } = await alex.client.rpc('nearby_gyms', {
    p_latitude: ORIGIN.lat,
    p_longitude: ORIGIN.lon,
    p_radius_metres: 5000,
    p_limit: 50,
  });

  check('nearby_gyms executes', !nearbyErr, nearbyErr?.message);
  check('nearby_gyms returns results', (nearby?.length ?? 0) > 0, `got ${nearby?.length}`);

  const distances = (nearby ?? []).map((g) => g.distance_metres);
  const sortedAscending = distances.every((d, i) => i === 0 || d >= distances[i - 1]);
  check('results are ordered nearest first', sortedAscending);

  check(
    'all results fall inside the requested radius',
    distances.every((d) => d <= 5000),
    `max distance ${Math.max(...distances).toFixed(0)}m`,
  );

  check(
    'distances are in metres on the spheroid, not degrees',
    distances[0] > 1 && distances[0] < 5000,
    `nearest is ${distances[0]?.toFixed(0)}`,
  );

  check(
    'coordinates round-trip correctly',
    nearby?.every(
      (g) => Math.abs(g.latitude - ORIGIN.lat) < 0.5 && Math.abs(g.longitude - ORIGIN.lon) < 0.5,
    ),
  );

  console.log(
    `     nearest three: ${(nearby ?? [])
      .slice(0, 3)
      .map((g) => `${g.name} (${g.distance_metres.toFixed(0)}m)`)
      .join(', ')}`,
  );

  // A tighter radius must be a strict subset.
  const { data: tight } = await alex.client.rpc('nearby_gyms', {
    p_latitude: ORIGIN.lat,
    p_longitude: ORIGIN.lon,
    p_radius_metres: 800,
  });
  check(
    'a smaller radius returns no more than a larger one',
    (tight?.length ?? 0) <= (nearby?.length ?? 0),
    `800m: ${tight?.length}, 5000m: ${nearby?.length}`,
  );
  check(
    'every result within the tight radius respects it',
    (tight ?? []).every((g) => g.distance_metres <= 800),
  );

  // Limit is clamped server-side so a client cannot request the whole table.
  const { data: capped } = await alex.client.rpc('nearby_gyms', {
    p_latitude: ORIGIN.lat,
    p_longitude: ORIGIN.lon,
    p_radius_metres: 50000,
    p_limit: 999999,
  });
  check('limit is clamped server-side', (capped?.length ?? 0) <= 200, `got ${capped?.length}`);

  const { data: remote } = await alex.client.rpc('nearby_gyms', {
    p_latitude: -33.8688,
    p_longitude: 151.2093,
    p_radius_metres: 1000,
  });
  check('a far-away location returns nothing', remote?.length === 0, `got ${remote?.length}`);

  // -------------------------------------------------------------------------
  section('3. Import is idempotent');

  // Re-import using the gym's OWN coordinates. An earlier version of this test
  // passed ORIGIN here, which silently relocated a real gym to the campus
  // centre and made "nearest" 0 m on subsequent runs. A verification script must
  // not corrupt the data it is verifying.
  const sample = nearby[0];
  const beforeCount = allGyms.length;

  const { error: reimportErr } = await admin.rpc('upsert_osm_gym', {
    p_osm_id: allGyms.find((g) => g.id === sample.id).osm_id,
    p_name: sample.name,
    p_latitude: sample.latitude,
    p_longitude: sample.longitude,
  });
  check('re-importing an existing gym succeeds', !reimportErr, reimportErr?.message);

  const { data: afterReimport } = await alex.client.from('gyms').select('id');
  check(
    're-import updates in place rather than duplicating',
    afterReimport?.length === beforeCount,
    `${beforeCount} -> ${afterReimport?.length}`,
  );

  const { data: afterCoords } = await alex.client.rpc('nearby_gyms', {
    p_latitude: ORIGIN.lat,
    p_longitude: ORIGIN.lon,
    p_radius_metres: 5000,
  });
  check(
    're-import preserved the location rather than moving the gym',
    Math.abs((afterCoords?.[0]?.distance_metres ?? 0) - distances[0]) < 1,
    `was ${distances[0]?.toFixed(0)}m, now ${afterCoords?.[0]?.distance_metres?.toFixed(0)}m`,
  );

  // -------------------------------------------------------------------------
  section('4. Clients cannot write to the shared directory');

  const { error: gymInsertErr, data: gymInserted } = await alex.client
    .from('gyms')
    .insert({ name: 'Fake Gym', location: 'POINT(0 0)' })
    .select();
  check(
    'member cannot insert a gym directly',
    !!gymInsertErr || !gymInserted?.length,
    'insert unexpectedly succeeded',
  );

  const { data: gymUpdated } = await alex.client
    .from('gyms')
    .update({ name: 'Vandalised' })
    .eq('id', sample.id)
    .select();
  check('member cannot rename a gym', !gymUpdated || gymUpdated.length === 0);

  const { error: rpcErr } = await alex.client.rpc('upsert_osm_gym', {
    p_osm_id: 'node/999999999',
    p_name: 'Sneaky Gym',
    p_latitude: 0,
    p_longitude: 0,
  });
  check('the importer RPC is not callable by members', !!rpcErr, 'RPC unexpectedly succeeded');

  // -------------------------------------------------------------------------
  section('5. Structured ratings');

  const { data: rating, error: ratingErr } = await alex.client
    .from('gym_ratings')
    .insert({
      gym_id: sample.id,
      user_id: alex.id,
      overall: 4,
      air_conditioning: 2,
      equipment_quality: 5,
      equipment_availability: 3,
      cleanliness: 4,
      crowding: 2,
      value_for_money: 5,
      review_text: 'Great squat racks, gets busy after 5pm and the AC struggles.',
    })
    .select()
    .single();
  check('member can rate a gym', !ratingErr && !!rating, ratingErr?.message);

  const { error: outOfRangeErr } = await alex.client
    .from('gym_ratings')
    .insert({ gym_id: allGyms[1].id, user_id: alex.id, overall: 9 });
  check('out-of-range score is rejected', !!outOfRangeErr);

  const { error: zeroErr } = await alex.client
    .from('gym_ratings')
    .insert({ gym_id: allGyms[1].id, user_id: alex.id, overall: 0 });
  check('a zero score is rejected (scale starts at 1)', !!zeroErr);

  // -------------------------------------------------------------------------
  section('6. One rating per gym per member per 30 days');

  const { error: dupErr } = await alex.client
    .from('gym_ratings')
    .insert({ gym_id: sample.id, user_id: alex.id, overall: 1 });
  check('a second rating within 30 days is blocked', !!dupErr, 'duplicate rating allowed');
  check(
    'the rejection explains the 30-day rule',
    dupErr?.message?.includes('30 days'),
    `got "${dupErr?.message}"`,
  );

  const { error: editErr } = await alex.client
    .from('gym_ratings')
    .update({ overall: 5 })
    .eq('id', rating.id);
  check('a member can still revise their own existing rating', !editErr, editErr?.message);

  const { error: otherUserErr } = await sam.client
    .from('gym_ratings')
    .insert({ gym_id: sample.id, user_id: sam.id, overall: 3 });
  check('the limit is per member, not per gym', !otherUserErr, otherUserErr?.message);

  // -------------------------------------------------------------------------
  section('7. Rating ownership');

  const { error: forgedErr, data: forged } = await sam.client
    .from('gym_ratings')
    .insert({ gym_id: allGyms[2].id, user_id: alex.id, overall: 1 })
    .select();
  check(
    "cannot post a rating in another member's name",
    !!forgedErr || !forged?.length,
    'forged rating accepted',
  );

  const { data: hijacked } = await sam.client
    .from('gym_ratings')
    .update({ overall: 1 })
    .eq('id', rating.id)
    .select();
  check("cannot edit another member's rating", !hijacked || hijacked.length === 0);

  const { data: deleted } = await sam.client
    .from('gym_ratings')
    .delete()
    .eq('id', rating.id)
    .select();
  check("cannot delete another member's rating", !deleted || deleted.length === 0);

  // Ratings are shared value, so they are readable by all members.
  const { data: samReads } = await sam.client
    .from('gym_ratings')
    .select('overall')
    .eq('id', rating.id);
  check('ratings are readable by other members', samReads?.length === 1);

  // -------------------------------------------------------------------------
  section('8. Aggregated summaries');

  const { data: summary, error: summaryErr } = await alex.client
    .from('gym_rating_summaries')
    .select('*')
    .eq('gym_id', sample.id)
    .single();

  check('summary view is queryable', !summaryErr && !!summary, summaryErr?.message);
  check(
    'summary counts both ratings',
    Number(summary?.rating_count) === 2,
    `got ${summary?.rating_count}`,
  );
  check(
    'average reflects the revised score (5 and 3 -> 4.00)',
    Number(summary?.avg_overall) === 4,
    `got ${summary?.avg_overall}`,
  );
  check(
    'per-axis averages are computed independently',
    Number(summary?.avg_air_conditioning) === 2,
    `got ${summary?.avg_air_conditioning}`,
  );

  // -------------------------------------------------------------------------
  section('9. Reports');

  const { error: reportErr } = await alex.client.from('gym_reports').insert({
    gym_id: sample.id,
    reporter_id: alex.id,
    reason: 'permanently_closed',
    detail: 'Closed last month.',
  });
  check('member can report a gym', !reportErr, reportErr?.message);

  const { data: samSeesReports } = await sam.client.from('gym_reports').select('id');
  check('reports are not visible to other members', samSeesReports?.length === 0);

  const { error: targetlessErr } = await alex.client
    .from('gym_reports')
    .insert({ reporter_id: alex.id, reason: 'spam' });
  check('a report must reference a gym or a rating', !!targetlessErr);

  // -------------------------------------------------------------------------
  section('10. Member-submitted gyms');

  // A point well away from the imported campus data, so the duplicate checks below
  // are testing this suite's own rows rather than colliding with real gyms.
  const SUBMIT = { lat: 43.3, lon: -80.3 };
  const uniqueName = `Verify Gym ${Date.now()}`;
  const submitted = [];

  const { data: createdId, error: createErr } = await alex.client.rpc('create_user_gym', {
    p_name: uniqueName,
    p_latitude: SUBMIT.lat,
    p_longitude: SUBMIT.lon,
    p_address: '1 Verification Road',
    p_city: 'Waterloo',
    p_description: 'Created by verify-gyms.mjs',
    p_website: 'https://example.com/gym',
  });
  check('member can submit a gym through the moderated RPC', !createErr, createErr?.message);
  check('the RPC returns the new gym id', typeof createdId === 'string', String(createdId));
  if (typeof createdId === 'string') submitted.push(createdId);

  const { data: createdGym } = await alex.client
    .from('gyms')
    .select('*')
    .eq('id', createdId)
    .maybeSingle();

  check('the submitted gym is readable by its author', !!createdGym);
  check(
    "source is forced to 'user' rather than taken from the caller",
    createdGym?.source === 'user',
    `source=${createdGym?.source}`,
  );
  check('created_by records who submitted it', createdGym?.created_by === alex.id);
  check('the description is stored', createdGym?.description === 'Created by verify-gyms.mjs');

  // The whole point of the feature: it behaves like any other gym.
  const { data: sameSees } = await sam.client.from('gyms').select('id').eq('id', createdId);
  check('another member can see a submitted gym', sameSees?.length === 1);

  const { data: submittedNearby } = await sam.client.rpc('nearby_gyms', {
    p_latitude: SUBMIT.lat,
    p_longitude: SUBMIT.lon,
    p_radius_metres: 1000,
    p_limit: 10,
  });
  check(
    'a submitted gym is returned by nearby_gyms like any other',
    (submittedNearby ?? []).some((g) => g.id === createdId),
  );

  const { error: submittedCheckInErr } = await sam.client.rpc('check_in', {
    p_gym_id: createdId,
    p_duration_minutes: 30,
  });
  check(
    'a member can check in at a submitted gym',
    !submittedCheckInErr,
    submittedCheckInErr?.message,
  );
  await sam.client.rpc('check_out');

  // -------------------------------------------------------------------------
  section('11. Submitted gyms are validated server-side');

  const { error: noNameErr } = await alex.client.rpc('create_user_gym', {
    p_name: 'x',
    p_latitude: SUBMIT.lat,
    p_longitude: SUBMIT.lon,
  });
  check('a one-character name is rejected', !!noNameErr);

  const { error: badLatErr } = await alex.client.rpc('create_user_gym', {
    p_name: `Verify Bad Coords ${Date.now()}`,
    p_latitude: 999,
    p_longitude: 0,
  });
  check('an out-of-range latitude is rejected', !!badLatErr);

  const { error: badSiteErr } = await alex.client.rpc('create_user_gym', {
    p_name: `Verify Bad Site ${Date.now()}`,
    p_latitude: SUBMIT.lat + 0.05,
    p_longitude: SUBMIT.lon + 0.05,
    p_website: 'javascript:alert(1)',
  });
  check('a website without an http(s) scheme is rejected', !!badSiteErr);

  const { error: badImageErr } = await alex.client.rpc('create_user_gym', {
    p_name: `Verify Bad Image ${Date.now()}`,
    p_latitude: SUBMIT.lat + 0.06,
    p_longitude: SUBMIT.lon + 0.06,
    p_image_url: 'not-a-url',
  });
  check('an image link without an http(s) scheme is rejected', !!badImageErr);

  // -------------------------------------------------------------------------
  section('12. Duplicate detection');

  const { data: similar, error: similarErr } = await sam.client.rpc('find_similar_gyms', {
    p_name: uniqueName,
    p_latitude: SUBMIT.lat,
    p_longitude: SUBMIT.lon,
    p_limit: 5,
  });
  check('find_similar_gyms executes for a normal member', !similarErr, similarErr?.message);
  check(
    'an identical name at the same point is found',
    (similar ?? []).some((g) => g.id === createdId),
  );
  check(
    'and is flagged as a probable duplicate',
    (similar ?? []).find((g) => g.id === createdId)?.is_probable_duplicate === true,
  );
  check(
    'the reason is reported so the member can judge it',
    (similar ?? []).find((g) => g.id === createdId)?.match_reason === 'same_name',
  );

  // Normalisation: punctuation, casing, and filler words must not defeat the check.
  const { data: normalised } = await sam.client.rpc('find_similar_gyms', {
    p_name: `${uniqueName.toUpperCase()} FITNESS CENTRE!`,
    p_latitude: SUBMIT.lat,
    p_longitude: SUBMIT.lon,
    p_limit: 5,
  });
  check(
    'casing, punctuation, and filler words do not defeat duplicate detection',
    (normalised ?? []).some((g) => g.id === createdId),
  );

  const { error: certainDupErr } = await sam.client.rpc('create_user_gym', {
    p_name: uniqueName,
    p_latitude: SUBMIT.lat,
    p_longitude: SUBMIT.lon,
    // Even with confirmation: a same-named gym within 400 m is not a judgement call.
    p_confirm_possible_duplicate: true,
  });
  check(
    'a near-certain duplicate is refused even when confirmed',
    !!certainDupErr,
    'duplicate was created',
  );
  check(
    'and the refusal names the existing gym so it can be opened instead',
    certainDupErr?.message?.includes(uniqueName) ?? false,
    certainDupErr?.message,
  );

  // Far enough away to be a genuinely different gym with the same name — a chain.
  const chainName = uniqueName;
  const { data: chainId, error: chainErr } = await sam.client.rpc('create_user_gym', {
    p_name: chainName,
    p_latitude: SUBMIT.lat + 0.2,
    p_longitude: SUBMIT.lon + 0.2,
  });
  check('the same name far away is allowed, because chains exist', !chainErr, chainErr?.message);
  if (typeof chainId === 'string') submitted.push(chainId);

  // -------------------------------------------------------------------------
  section('13. Submission rate limit');

  let limitHit = false;
  for (let index = 0; index < 6; index += 1) {
    const { data: id, error } = await alex.client.rpc('create_user_gym', {
      p_name: `Verify Ratelimit ${Date.now()}-${index}`,
      // Spread out so the duplicate checks do not fire instead of the rate limit.
      p_latitude: SUBMIT.lat + 0.4 + index * 0.05,
      p_longitude: SUBMIT.lon + 0.4 + index * 0.05,
    });
    if (typeof id === 'string') submitted.push(id);
    if (error?.message?.includes('five gyms today')) {
      limitHit = true;
      break;
    }
  }
  check('a member cannot submit more than five gyms a day', limitHit);

  // -------------------------------------------------------------------------
  // Verification must not leave data behind, and must never mutate rows it did
  // not create — a previous script overwrote two real gyms with test
  // coordinates. Only ids captured above are removed, with the service role,
  // because members deliberately have no DELETE policy on gyms.
  for (const id of submitted) {
    await admin.from('gyms').delete().eq('id', id);
  }
  console.log(`     cleaned up ${submitted.length} submitted gyms`);
});
