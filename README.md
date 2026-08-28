# Quote A Coin

A single-page web app for creating professionally branded quotations and
invoices. Design a document in a live side-by-side editor and preview, then
either download it as a PDF (free tier) or save it to a cloud account (paid
tier) where documents and clients are stored, editable, and convertible from
quotation to invoice.

Amounts are displayed in Namibian dollars (N$).

## Stack

React 19 + TypeScript, Vite 6, Tailwind CSS v4, Firebase (Auth + Firestore),
react-hook-form, html2canvas + jsPDF, motion, lucide-react, date-fns.

There is no application server. All business logic runs in the browser and
Firestore security rules are the only server-side enforcement point.

## Getting started

Requires Node.js 18, 20 or 22+.

```bash
npm install
npm run dev      # Vite dev server on http://localhost:3000
```

Other scripts:

| Script | Does |
|---|---|
| `npm run build` | Production bundle into `dist/` |
| `npm run preview` | Serve the production bundle |
| `npm run lint` | `tsc --noEmit` type check (no ESLint configured) |
| `npm run clean` | Remove `dist/` |
| `npm run demo` | Emulators + app together (see Demo mode below) |
| `npm run emulators` | Firebase Auth + Firestore emulators only |
| `npm run seed` | Populate the emulators with a Pro demo account |
| `npm run test:rules` | Check `firestore.rules` against the emulator |
| `npm run rules:deploy` | Deploy rules to a real Firebase project |

**"Try as Guest" works with no configuration at all** — guest mode is entirely
client-side, so you can design a document and download the PDF before touching
Firebase.

## Demo mode (no cloud project, no billing)

The fastest way to see the whole app, Pro tier included, is the local Firebase
Emulator Suite. Nothing touches Google's servers and no payment details are
needed anywhere.

```bash
npm run demo     # starts the emulators + the app on http://localhost:3000
npm run seed     # in a second terminal: creates a Pro account with sample data
```

Then open http://localhost:3000, click **Continue with Google**, and pick
`demo@quoteacoin.app` in the emulator's account chooser. You land on a Tier 2
dashboard with 3 clients, 3 quotations and 2 invoices.

`npm run seed` is idempotent and seeds data for **whichever accounts already
exist**, so it works whether you run it before or after signing in. Re-run it
any time to reset the sample data.

Notes:

- The Firestore emulator needs a **JDK (17+)**. `npm run emulators` looks for
  one in the usual places even if it is not on your PATH, and tells you how to
  install one if it finds nothing.
- Emulator state is written to `.emulator-data/` on exit and re-imported on the
  next start, so your account and documents survive a restart. Delete that
  folder to start clean.
- Emulator UI (browse the data directly): http://localhost:4000
- `npm run test:rules` runs a 12-case check that `firestore.rules` really
  enforces ownership and the Tier 2 gate.

There is **no payment integration**. Tier 2 is self-assigned from the in-app
pricing screen and the rules permit a user to change their own `tier` field.
Wiring up real billing means moving tier changes somewhere the client cannot
write - a Cloud Function or a custom auth claim.

## Connecting a real Firebase project

When you want it on the internet rather than on localhost:

1. Create a Firebase project and register a **web app**.
2. Enable **Google** as a sign-in provider under Authentication.
3. Create a Cloud Firestore database. This app uses a **named** database (ID
   `quote-a-coin`, set in `firebase.json` and `firebase-applet-config.json`).
   Named databases beyond `(default)` require the Blaze plan - if you are on
   Spark, either upgrade or change `databaseId` to `(default)` in
   `firebase-applet-config.json` and drop the `database` key from
   `firebase.json`.
4. Fill in `firebase-applet-config.json` with your web app config, or copy
   `.env.example` to `.env` and set the `VITE_FIREBASE_*` variables (those win).
5. Put your own verified Google address in `adminEmail()` in `firestore.rules` -
   it ships as `admin@example.com`, so until you change it nobody has admin.
6. Deploy the rules:

   ```bash
   npx firebase login
   npx firebase use --add          # pick your project
   npm run rules:deploy
   ```

Rules must be deployed for the access model below to hold. The Firebase web
config is bundled client-side, which is normal - it identifies the project, it
does not authorise anything.

## Tiers

| | Guest | Tier 1 — Basic | Tier 2 — Pro |
|---|---|---|---|
| Sign-in | none | Google | Google |
| Branded editor + live preview | yes | yes | yes |
| Download PDF | yes | yes | yes |
| Documents saved to account | no | no | yes |
| Client database + autofill | no | no | yes |
| Edit saved documents | no | no | yes |
| Quotation → invoice conversion | no | no | yes |

Guests get an in-memory Tier 1 profile (`uid: 'guest'`). Nothing is persisted:
documents exist only until download, and settings apply to the session only.

**There is no billing integration.** Pro is displayed at `$3 / month` but is
self-assigned from the in-app pricing screen, and the security rules permit a
user to update their own `tier` field. Adding real payments means gating tier
changes behind something the client cannot write — a Cloud Function or a
custom auth claim.

## Data model

Three top-level Firestore collections, described in `firebase-blueprint.json`
and typed in [`src/types.ts`](src/types.ts):

- **`users/{uid}`** — profile, tier, business details, default branding and
  terms. Document ID is the auth UID.
- **`clients/{clientId}`** — saved clients (`ownerId`, name, email, phone,
  address). Auto-IDs.
- **`documents/{documentId}`** — quotations and invoices. The client-generated
  `id` field doubles as the document ID.

Access control (`firestore.rules`):

| Collection | read | create | update | delete |
|---|---|---|---|---|
| `users/{uid}` | owner or admin | owner | owner or admin | denied |
| `clients/{id}` | owner or admin | Tier 2 owner | Tier 2 owner or admin | Tier 2 owner or admin |
| `documents/{id}` | owner or admin | Tier 2 owner | Tier 2 owner or admin | Tier 2 owner or admin |

Every gated write performs a `get()` of the caller's user document to check the
tier, costing one extra read.

## Repository layout

| Path | Purpose |
|---|---|
| `src/App.tsx` | The entire application: auth, tier selector, editor + preview, dashboard, clients, settings, shell |
| `src/main.tsx` | React entry point |
| `src/firebase.ts` | Firebase initialisation (Auth + named Firestore database) |
| `src/types.ts` | Domain types |
| `src/index.css` | Tailwind entry, Google Fonts, theme font variables |
| `firestore.rules` | Security rules |
| `firebase-blueprint.json` | Schema description of the three collections |
| `firebase-applet-config.json` | Firebase web config + named database ID |
| `firebase.json` / `.firebaserc` | CLI config: rules, indexes, emulator ports, hosting |
| `.env.demo` | Demo-mode env, committed on purpose - points at the emulators |
| `scripts/emulators.mjs` | Starts the emulators, locating a JDK if one is not on PATH |
| `scripts/seed-demo.mjs` | Seeds a Pro account with sample clients and documents |
| `scripts/test-rules.mjs` | Ownership / Tier 2 checks against `firestore.rules` |

## Known limitations

These are deliberate properties of the current design, not open bugs:

1. **No billing.** Tier 2 is self-assignable (see above).
2. **Minimal validation.** Apart from a required client name, nothing prevents
   empty documents or malformed emails. Numeric inputs are coerced so totals
   never render as `NaN`.
3. **PDF fidelity.** Output is a single-page raster image of the preview: text
   is not selectable or searchable, long item lists are not paginated, and
   rendering needs Google Fonts to be reachable at generation time.
4. **Identifier weakness.** Document IDs come from `Math.random` and numbers
   from a 6-digit timestamp suffix; neither is guaranteed unique.
5. **Status lifecycle unused.** `status` supports `pending`/`paid`/`sent` but
   no UI changes it from `pending`.
6. **Clients are add/delete only** — no edit — and no list is searchable,
   filterable or paginated. Listeners are unbounded, so every owned document
   and client is loaded into memory.
7. **Inline logos.** Logos are stored as base64 data URLs inside the profile
   and document, so Firestore's 1 MiB per-document limit caps their size. Note
   the schema drift: the rules and blueprint call this field `logoUrl`, the
   code uses `logoData`.
8. **Admin is rules-only.** There is no admin UI or audit trail; admin is a
   `role == 'admin'` user document or the hardcoded address in
   `firestore.rules`.
9. **No routing.** View state is in memory, so refreshing always returns to the
   dashboard. There is no deep-linking, offline persistence, test suite or CI.
10. **English and N$ only.** No internationalisation; the currency symbol and
    two-decimal formatting are hardcoded.
