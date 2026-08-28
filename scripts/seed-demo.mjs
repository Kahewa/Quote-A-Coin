/**
 * Seeds the local Firebase emulators with a demo Pro account.
 *
 * Creates a signed-in-able Google account, upgrades it to Tier 2, and gives it
 * a handful of clients plus quotations and invoices so the dashboard has
 * something to show. Talks to the emulators' REST APIs directly - the
 * `Authorization: Bearer owner` header bypasses security rules, which is an
 * emulator-only affordance.
 *
 * Usage:  npm run seed          (emulators must already be running)
 */

const PROJECT_ID = process.env.DEMO_PROJECT_ID ?? 'demo-quote-a-coin';
const DATABASE_ID = process.env.DEMO_DATABASE_ID ?? 'quote-a-coin';
const HOST = process.env.DEMO_EMULATOR_HOST ?? '127.0.0.1';
const AUTH = `http://${HOST}:9099`;
const FIRESTORE = `http://${HOST}:8080`;

const DEMO_EMAIL = 'demo@quoteacoin.app';
const DEMO_NAME = 'Demo User';

const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...OWNER, ...options.headers } });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${url} -> ${response.status}\n${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function assertEmulatorsUp() {
  try {
    await fetch(`${FIRESTORE}/`, { signal: AbortSignal.timeout(3000) });
    await fetch(`${AUTH}/`, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error(
      '\n  Could not reach the emulators on ' +
        `${HOST}:8080 / ${HOST}:9099.\n\n  Start them first:  npm run emulators\n`,
    );
    process.exit(1);
  }
}

/* --- Firestore REST value encoding --------------------------------------- */

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toValue) } };
  }
  return { mapValue: { fields: toFields(value) } };
}

function toFields(object) {
  return Object.fromEntries(
    Object.entries(object)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, toValue(v)]),
  );
}

const documentsUrl = `${FIRESTORE}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

/**
 * Upsert. `POST .../{collection}?documentId=` is create-only and 409s on a
 * re-run, so patch the document path instead - seeding needs to be repeatable.
 */
function writeDoc(collection, id, data) {
  return api(`${documentsUrl}/${collection}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: toFields(data) }),
  });
}

async function clearCollection(collection) {
  let removed = 0;
  let pageToken;
  do {
    const url = new URL(`${documentsUrl}/${collection}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await api(url.toString());
    for (const document of page.documents ?? []) {
      await api(`${FIRESTORE}/v1/${document.name}`, { method: 'DELETE' });
      removed += 1;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return removed;
}

/* --- Auth ---------------------------------------------------------------- */

async function listAccounts() {
  const result = await api(
    `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:query`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return result.userInfo ?? [];
}

/**
 * Returns the UIDs to seed data for.
 *
 * Seeds for every account that already exists, so it does not matter whether
 * you sign in before or after running this. Only when the emulator has no
 * accounts at all does it mint the canned demo one.
 */
async function resolveTargetUids() {
  const accounts = await listAccounts();
  if (accounts.length > 0) {
    return accounts.map((u) => ({ uid: u.localId, email: u.email ?? DEMO_EMAIL }));
  }

  // Register against the Google provider so the emulator's "Continue with
  // Google" chooser offers the account instead of forcing "Add new account".
  const created = await api(
    `${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-api-key`,
    {
      method: 'POST',
      body: JSON.stringify({
        postBody: new URLSearchParams({
          providerId: 'google.com',
          id_token: JSON.stringify({
            sub: 'demo-google-uid',
            email: DEMO_EMAIL,
            email_verified: true,
            name: DEMO_NAME,
          }),
        }).toString(),
        requestUri: 'http://localhost',
        returnSecureToken: true,
      }),
    },
  );
  return [{ uid: created.localId, email: DEMO_EMAIL }];
}

/* --- Demo content --------------------------------------------------------- */

const DEFAULT_TERMS =
  'Valid for 30 days from the date of issue.\n50% deposit required before work begins.';

const BRANDING = {
  primaryColor: '#0d9488',
  fontFamily: 'font-sans',
  logoData: '',
};

const BUSINESS = {
  businessName: 'Kalahari Works CC',
  businessEmail: 'hello@kalahariworks.na',
  businessAddress: '14 Independence Avenue\nWindhoek, Namibia',
};

const CLIENTS = [
  {
    id: 'demo-client-namib',
    name: 'Namib Logistics Ltd',
    email: 'accounts@namiblogistics.na',
    phone: '+264 61 220 118',
    address: '2 Hafen Street\nWalvis Bay, Namibia',
  },
  {
    id: 'demo-client-etosha',
    name: 'Etosha Safari Lodge',
    email: 'bookings@etoshasafari.na',
    phone: '+264 67 229 400',
    address: 'C38 Road, Okaukuejo\nEtosha, Namibia',
  },
  {
    id: 'demo-client-swakop',
    name: 'Swakop Coffee Roasters',
    email: 'hi@swakoproast.na',
    phone: '+264 64 405 771',
    address: '9 Sam Nujoma Avenue\nSwakopmund, Namibia',
  },
];

function lineItem(description, quantity, unitPrice) {
  return {
    id: `item-${description.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}`,
    description,
    quantity,
    unitPrice,
    total: quantity * unitPrice,
  };
}

function buildDocument({ id, type, number, date, client, items, status, relatedQuotationId }) {
  return {
    id,
    type,
    number,
    date,
    status: status ?? 'pending',
    items,
    total: items.reduce((sum, item) => sum + item.total, 0),
    clientId: client.id,
    clientName: client.name,
    clientEmail: client.email,
    clientAddress: client.address,
    ...BUSINESS,
    termsAndConditions:
      type === 'invoice'
        ? 'Payment due within 30 days of the invoice date.\nBanking details on request.'
        : 'Valid for 30 days from the date of issue.\n50% deposit required before work begins.',
    branding: BRANDING,
    ...(relatedQuotationId ? { relatedQuotationId } : {}),
  };
}

const [namib, etosha, swakop] = CLIENTS;

const DOCUMENTS = [
  buildDocument({
    id: 'demo-qt-branding',
    type: 'quotation',
    number: 'QT-100241',
    date: '2026-08-24',
    client: namib,
    items: [
      lineItem('Brand identity & logo design', 1, 18500),
      lineItem('Stationery pack (letterhead, cards)', 2, 3250),
      lineItem('Vehicle livery mockups', 3, 1400),
    ],
  }),
  buildDocument({
    id: 'demo-qt-website',
    type: 'quotation',
    number: 'QT-100238',
    date: '2026-08-19',
    client: etosha,
    items: [
      lineItem('Website design & build', 1, 42000),
      lineItem('Photography day rate', 2, 6500),
      lineItem('Copywriting', 6, 950),
    ],
  }),
  buildDocument({
    id: 'demo-qt-packaging',
    type: 'quotation',
    number: 'QT-100230',
    date: '2026-08-11',
    client: swakop,
    items: [
      lineItem('Packaging design (3 SKUs)', 3, 7800),
      lineItem('Print supervision', 1, 4200),
    ],
  }),
  buildDocument({
    id: 'demo-inv-branding',
    type: 'invoice',
    number: 'INV-100244',
    date: '2026-08-25',
    client: namib,
    relatedQuotationId: 'demo-qt-branding',
    items: [
      lineItem('Brand identity & logo design', 1, 18500),
      lineItem('Stationery pack (letterhead, cards)', 2, 3250),
      lineItem('Vehicle livery mockups', 3, 1400),
    ],
  }),
  buildDocument({
    id: 'demo-inv-packaging',
    type: 'invoice',
    number: 'INV-100233',
    date: '2026-08-14',
    client: swakop,
    relatedQuotationId: 'demo-qt-packaging',
    items: [
      lineItem('Packaging design (3 SKUs)', 3, 7800),
      lineItem('Print supervision', 1, 4200),
    ],
  }),
];

/* --- Run ------------------------------------------------------------------ */

await assertEmulatorsUp();

const targets = await resolveTargetUids();
const cleared = (await clearCollection('documents')) + (await clearCollection('clients'));
if (cleared) console.log(`Cleared      : ${cleared} existing document(s)`);

for (const { uid, email } of targets) {
  await writeDoc('users', uid, {
    uid,
    email,
    tier: 2,
    ...BUSINESS,
    branding: BRANDING,
    termsAndConditions: DEFAULT_TERMS,
  });

  for (const client of CLIENTS) {
    const { id, ...rest } = client;
    await writeDoc('clients', `${id}-${uid.slice(0, 6)}`, { ownerId: uid, ...rest });
  }

  for (const document of DOCUMENTS) {
    await writeDoc('documents', `${document.id}-${uid.slice(0, 6)}`, {
      ownerId: uid,
      ...document,
      id: `${document.id}-${uid.slice(0, 6)}`,
    });
  }

  console.log(`Seeded       : ${email} (uid ${uid}) -> Tier 2, ${CLIENTS.length} clients, ${DOCUMENTS.length} documents`);
}

console.log(
  [
    '',
    'Done. Open http://localhost:3000, click "Continue with Google", and pick',
    `an account in the emulator chooser${targets.length === 1 ? ` ("${targets[0].email}")` : ''}.`,
    '',
  ].join('\n'),
);
