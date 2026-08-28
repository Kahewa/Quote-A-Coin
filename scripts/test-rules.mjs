/**
 * Smoke test for firestore.rules against the Firestore emulator.
 *
 * The rules are the only server-side enforcement this app has, so it is worth
 * checking that ownership and the Tier 2 gate actually hold. Runs against the
 * emulator using forged ID tokens - the emulator does not verify signatures,
 * which lets us act as arbitrary users without real credentials.
 *
 * Usage:  npm run test:rules      (emulators must already be running)
 */

const PROJECT_ID = process.env.DEMO_PROJECT_ID ?? 'demo-quote-a-coin';
const DATABASE_ID = process.env.DEMO_DATABASE_ID ?? 'quote-a-coin';
const HOST = process.env.DEMO_EMULATOR_HOST ?? '127.0.0.1';
const BASE = `http://${HOST}:8080/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

const ALICE = 'rules-test-alice';
const BOB = 'rules-test-bob';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** An unsigned JWT. Accepted by the emulator, rejected by real Firestore. */
function idToken(uid, email = `${uid}@example.com`) {
  return [
    b64({ alg: 'none', typ: 'JWT' }),
    b64({
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      aud: PROJECT_ID,
      sub: uid,
      user_id: uid,
      email,
      email_verified: true,
      firebase: { sign_in_provider: 'google.com', identities: { email: [email] } },
    }),
    '',
  ].join('.');
}

async function request(method, pathname, { as, body, query } = {}) {
  const url = new URL(`${BASE}${pathname}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.append(k, v);
  const headers = { 'Content-Type': 'application/json' };
  if (as === 'owner') headers.Authorization = 'Bearer owner';
  else if (as) headers.Authorization = `Bearer ${idToken(as)}`;
  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.text() };
}

const toFields = (o) =>
  Object.fromEntries(
    Object.entries(o).map(([k, v]) => [
      k,
      typeof v === 'number'
        ? Number.isInteger(v)
          ? { integerValue: String(v) }
          : { doubleValue: v }
        : { stringValue: String(v) },
    ]),
  );

const results = [];
const expect = (name, actual, wanted) => {
  const pass = wanted === 'allow' ? actual < 400 : actual === 403;
  results.push({ pass, name, detail: `HTTP ${actual}, wanted ${wanted}` });
};

/* --- fixtures (written as emulator owner, bypassing rules) ---------------- */

await request('PATCH', `/users/${ALICE}`, {
  as: 'owner',
  body: { fields: toFields({ uid: ALICE, email: `${ALICE}@example.com`, tier: 2 }) },
});
await request('PATCH', `/users/${BOB}`, {
  as: 'owner',
  body: { fields: toFields({ uid: BOB, email: `${BOB}@example.com`, tier: 1 }) },
});
await request('PATCH', '/documents/rules-test-doc', {
  as: 'owner',
  body: {
    fields: toFields({
      id: 'rules-test-doc',
      ownerId: ALICE,
      type: 'quotation',
      number: 'QT-000001',
      date: '2026-08-26',
      total: 100,
      status: 'pending',
    }),
  },
});

/* --- users ---------------------------------------------------------------- */

expect('owner reads own profile', (await request('GET', `/users/${ALICE}`, { as: ALICE })).status, 'allow');
expect("user cannot read another's profile", (await request('GET', `/users/${BOB}`, { as: ALICE })).status, 'deny');
expect('unauthenticated cannot read a profile', (await request('GET', `/users/${ALICE}`)).status, 'deny');

/* --- documents ------------------------------------------------------------ */

expect('owner reads own document', (await request('GET', '/documents/rules-test-doc', { as: ALICE })).status, 'allow');
expect("non-owner cannot read the document", (await request('GET', '/documents/rules-test-doc', { as: BOB })).status, 'deny');
expect('unauthenticated cannot read the document', (await request('GET', '/documents/rules-test-doc')).status, 'deny');

// Tier 2 may write; Tier 1 may not - the gate the app relies on for Pro.
const newDoc = (owner) => ({
  fields: toFields({
    id: `rules-test-${owner}-new`,
    ownerId: owner,
    type: 'quotation',
    number: 'QT-000002',
    date: '2026-08-26',
    total: 50,
    status: 'pending',
  }),
});

expect(
  'Tier 2 owner may create a document',
  (await request('PATCH', `/documents/rules-test-${ALICE}-new`, { as: ALICE, body: newDoc(ALICE) })).status,
  'allow',
);
expect(
  'Tier 1 owner may NOT create a document',
  (await request('PATCH', `/documents/rules-test-${BOB}-new`, { as: BOB, body: newDoc(BOB) })).status,
  'deny',
);
expect(
  'cannot create a document owned by someone else',
  (await request('PATCH', '/documents/rules-test-spoof', {
    as: ALICE,
    body: newDoc(BOB),
  })).status,
  'deny',
);
expect(
  "non-owner cannot delete another's document",
  (await request('DELETE', '/documents/rules-test-doc', { as: BOB })).status,
  'deny',
);

/* --- clients -------------------------------------------------------------- */

const newClient = (owner) => ({ fields: toFields({ ownerId: owner, name: 'Rules Test Co' }) });

expect(
  'Tier 2 owner may create a client',
  (await request('PATCH', `/clients/rules-test-${ALICE}-client`, { as: ALICE, body: newClient(ALICE) })).status,
  'allow',
);
expect(
  'Tier 1 owner may NOT create a client',
  (await request('PATCH', `/clients/rules-test-${BOB}-client`, { as: BOB, body: newClient(BOB) })).status,
  'deny',
);

/* --- cleanup & report ----------------------------------------------------- */

for (const p of [
  `/users/${ALICE}`,
  `/users/${BOB}`,
  '/documents/rules-test-doc',
  `/documents/rules-test-${ALICE}-new`,
  `/clients/rules-test-${ALICE}-client`,
]) {
  await request('DELETE', p, { as: 'owner' });
}

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}  (${r.detail})`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
