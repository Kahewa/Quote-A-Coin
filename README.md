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

**"Try as Guest" works with no configuration at all** — guest mode is entirely
client-side, so you can design a document and download the PDF before touching
Firebase.

## Firebase setup

Google sign-in and cloud storage need a real Firebase project.

1. Create a Firebase project and register a **web app**.
2. Enable **Google** as a sign-in provider under Authentication.
3. Create a Cloud Firestore database. This app uses a **named** database (not
   `(default)`); note its database ID.
4. Fill in `firebase-applet-config.json` with your web app config plus the
   `databaseId`. Alternatively, copy `.env.example` to `.env` and set the
   `VITE_FIREBASE_*` variables — those override the JSON file.
5. Open `firestore.rules`, replace the `adminEmail()` placeholder with your own
   verified Google address, and deploy the rules:

   ```bash
   firebase deploy --only firestore:rules
   ```

Rules must be deployed for the access model below to hold. The Firebase web
config is bundled client-side, which is normal — it identifies the project, it
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
