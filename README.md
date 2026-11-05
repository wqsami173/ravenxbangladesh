# RavenX Event Platform

RavenX’s registration, BIB collection, run review, certificate, and admin tools in one Express application with a responsive browser interface. This unified codebase combines the existing RavenX registration, BIB, and certificate workflows while retaining their Neon schema and event data.

The initial public event collection contains only **Shadow Sprint Run 2026**. Its registration window remains open as requested. The Shop currently lists the supplied Shadow Sprint jersey for ৳299 and collects delivery orders. Database migrations are additive and preserve existing tables and rows.

## Inspected RavenX repositories

| Project | Default branch | Existing structure |
| --- | --- | --- |
| [RavenX registration](https://github.com/wqsami173/ravenxbangladesh) | `main` | Root `index.html`, Express `server.js`, `package.json`, PostgreSQL registration, medal images, and the original form fields: name, email, phone, gender, distance, Student/Regular category, student ID image, payment method, payment sender number, and transaction ID. |
| [Shadow Sprint BIB collection](https://github.com/wqsami173/shadowsprintrun2026) | `main` | Static root `index.html` and 126 BIB PNGs. The page looks up a BIB image by BIB number. |
| [Shadow Sprint certificate collection](https://github.com/wqsami173/shadowsprintrun2026certificate) | `main` | Static root `index.html`, a BIB-to-certificate map, and 125 participant certificate images. |

The older registration variant [ravenxbangladeshpromo](https://github.com/wqsami173/ravenxbangladeshpromo) uses `master` and adds a promo-code field. The platform retains the newer `ravenxbangladesh` registration/payment flow. Run submission accepts a valid web activity link from Strava or another running app, plus the prior profile, delivery, and optional notes fields. Student ID and run screenshot inputs are required in the browser where applicable, preview locally, and are deliberately omitted from API requests and storage. Participant details and BIB come from the approved registration.

Shadow Sprint BIBs and certificates use the supplied clean RavenX templates in `public/assets`; the server overlays the assigned distance, BIB, and participant name on the BIB, and only the participant name on the certificate. Both preview and download endpoints rasterize to native-resolution PNG. Other event workflows can still use their configured legacy assets or generated certificate fallback, converted to PNG on delivery.

The inspected public registration and promo repositories both track a `.env` file. Review and rotate any database or Meta credentials that were ever real, then remove them from Git history. This project does not copy those files or their contents.

## Included event assets

- `public/assets/ravenx-logo.png` — supplied RavenX page logo.
- `public/assets/shadow-sprint-banner.png` — supplied Shadow Sprint cover photo.
- `public/assets/3.1KM.jpeg`, `public/assets/6.66km.jpg`, `public/assets/13KM.jpg` — supplied medal photos, shown as Silver, Golden, and Black categories.
- `public/assets/shadow-sprint-jersey.png` — supplied jersey front/back photo for the shop.

## Files created

- Root: `.env.example`, `.gitignore`, `README.md`, `package.json`, `package-lock.json`, `server.js`.
- Database: ordered, additive migrations in `db/migrations/001_ravenx_platform.sql` through `db/migrations/005_shop_product_options.sql`.
- Server modules: `src/db.js`, `src/domain.js`, `src/email.js`, `src/storage.js`.
- Operations: `scripts/migrate.js`, `scripts/promote-admin.js`.
- Browser app: `public/index.html`, `public/app.js`, `public/styles.css`, and the six files in `public/assets/`.
- Legacy lookups: `data/legacy-bib-assets.json`, `data/legacy-certificate-assets.json`.
- Tests: `test/domain.test.js`.

The workspace had no source files at the start, so all platform files above were created here; there were no existing local site files to modify. `work/review/` contains unmodified sparse inspection copies of the three GitHub sites and is excluded from version control.

## Requirements and local setup

- Node.js 20 or newer.
- A Neon PostgreSQL database.
- A Resend sender or Gmail account configured for backend email delivery.
- Cloudinary is optional and used only to persist generated certificate artwork when configured.

Install dependencies and create a local environment file without overwriting an existing one:

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Fill in `.env` with the values below, then apply the additive database migration and start the app:

```powershell
npm run migrate
npm start
```

Open `http://localhost:3000`. `npm run dev` starts the server in Node watch mode. The public pages render without a database, but signup, registration, dashboards, uploads, and admin features require the database migration and appropriate service credentials.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string. Use the pooled connection string supplied by Neon for Render. |
| `SESSION_SECRET` | Yes in production | Long random secret for signed, HTTP-only session cookies. |
| `ADMIN_EMAIL` | Defaults to `wqsami173@gmail.com` | Inbox for registration and run-submission alerts. |
| `ADMIN_SETUP_SECRET` | Yes for admin promotion | Must be present before running the protected one-time admin promotion command. |
| `RESEND_API_KEY` | Optional email provider | Resend API key; use this with a verified `EMAIL_FROM` if you are not using Gmail SMTP. |
| `GMAIL_USER` | For Gmail delivery | Defaults to `ravenxbdofficial@gmail.com`. |
| `GMAIL_APP_PASSWORD` | For Gmail delivery | Google App Password; do not use the regular account password. |
| `EMAIL_FROM` | For delivery | Optional with Gmail (defaults to RavenX + `GMAIL_USER`); required and verified with Resend. |
| `CLOUDINARY_CLOUD_NAME` | Optional | Cloudinary cloud name for storing generated certificate artwork. |
| `CLOUDINARY_API_KEY` | Optional | Cloudinary API key for generated certificate artwork. |
| `CLOUDINARY_API_SECRET` | Optional | Cloudinary API secret for generated certificate artwork. |
| `CLOUDINARY_FOLDER` | Optional | Root folder prefix; defaults to `ravenx`. |
| `FRONTEND_URL` | Recommended | Public site origin used in email links and CORS. Defaults to the local server URL. |
| `BIB_ASSET_BASE_URL` | Optional | Base URL for existing BIB assets. A public GitHub raw URL is supplied in `.env.example`. |
| `CERTIFICATE_ASSET_BASE_URL` | Optional | Base URL for legacy certificate images. A public GitHub raw URL is supplied in `.env.example`. |
| `META_PIXEL_ID`, `META_ACCESS_TOKEN`, `META_API_VERSION` | Optional | Existing Meta Conversions API integration; Pixel ID and access token must both be supplied to enable it. |
| `PG_POOL_MAX` | Optional | PostgreSQL pool size; defaults to 10. |

Generate secrets locally, for example with PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Use separate generated values for `SESSION_SECRET` and `ADMIN_SETUP_SECRET`. Never commit `.env`; `.gitignore` excludes it. `.env.example` contains placeholders only.

### Email setup

To send from `ravenxbdofficial@gmail.com`, enable Google 2-Step Verification and create a separate App Password for RavenX. Set `GMAIL_USER` and `GMAIL_APP_PASSWORD` in `.env` or Render, then restart the server. Never use or share the account's regular password. App Password availability and setup requirements are described in [Google's App Password guidance](https://support.google.com/mail/answer/185833?hl=en). Alternatively, set a Resend API key and verified sender. The backend places messages in `email_outbox` in the same database transaction as registrations, reviews, and shop orders, then retries delivery with backoff up to 12 attempts. Existing queued messages send after a provider is configured and the server restarts. Failed deliveries can be retried in Admin. Admin alerts go to `wqsami173@gmail.com` by default. Outlook automation is not needed for Gmail sending.

### Cloudinary setup

Cloudinary remains optional for future event assets. Shadow Sprint certificate artwork is rendered from the supplied template at request time. Participant image selections are not uploaded or stored.

## Participant and admin setup

1. Sign up at `/#/signup` with the configured `ADMIN_EMAIL` using a strong password.
2. In the deployment shell, set `ADMIN_SETUP_SECRET` and run:

   ```powershell
   npm run admin:promote -- wqsami173@gmail.com
   ```

3. Sign out and sign back in. The account now has administrator routes. Public signup always creates participant accounts.
4. Participants create accounts at `/#/signup`, sign in at `/#/login`, and use **Events → Shadow Sprint Run 2026** to register. A participant can request a password reset from the login page; legacy registrations that were backfilled without a password can use that flow to set one.

## Workflow and routes

### Participant workflow

- Signup/login use bcrypt password hashes, server sessions, HTTP-only cookies, CSRF tokens, and rate limits.
- Profile and registration access are scoped to the authenticated user on the server.
- New Shadow Sprint registrations start as `PENDING_APPROVAL`; they appear in **Pending Registrations**, not among approved events.
- Payment follows the existing manual Bkash/Nagad/Rocket flow: the page shows the existing RavenX payment numbers, offers copy, and collects the sender number and transaction ID for admin review. No payment gateway was present in the inspected codebase.
- Approval assigns a unique distance-prefixed BIB (`SR31`, `SR66`, or `SR13`) in a transaction. BIB numbers are unique in PostgreSQL and skip existing legacy BIB assets.
- Approved registration pages provide a BIB PNG preview/download, run submission form, submission status, and certificate section. Rejected run submissions can be submitted again.
- Certificate access is private to the owning participant and unlocks after an approved run. Shadow Sprint uses the supplied personalized certificate template; other events can use a matching legacy certificate or a generated certificate fallback.
- Registration notifications, run-status notifications, certificate notices, and email status are stored independently.
- The Shop lists active products created in Admin. Customers submit name, phone, optional email, district, delivery address, quantity, and size when the item requires one. The backend calculates the amount from the product record.

### Admin workflow

- `/admin` shows participant, registration, pending queue, run, and certificate counts.
- `/admin/events` lets the single configured administrator create, publish, edit, pause, or archive events; configure categories, medal art, fees, early-bird dates, workflows, event covers, and the clean/example BIB and certificate images. Published changes are read by the public event pages and participant registration forms from the same Neon database.
- `/admin/shop-products` manages item names, descriptions, images, prices, size selection, and public visibility. Items with no size choice use a single `ONE_SIZE` order option.
- Registration management supports status filters, search, participant details, approval, and rejection with a saved reason.
- Run review shows the submitted activity link from any running app with approve or reject controls; rejection requires feedback. Screenshot files are browser-only and are not available to the administrator.
- Exactly one configured admin email can access admin APIs and the admin interface. Public signup cannot grant this role.
- Shop delivery lists order/customer/address details, supports search and status filters, and lets admins select orders for handoff to an external courier platform. RavenX tracks ready-for-courier, dispatched, delivered, and cancelled states; there is no courier API integration.
- Email delivery failures are visible on the overview and can be retried.
- Approval actions write audit rows. Participants cannot reach admin routes or approve records.

### API reference

All API responses are JSON unless an endpoint explicitly returns a protected image/document. Mutating requests require the `X-CSRF-Token` header returned by `GET /api/csrf-token`; the browser app handles this automatically. Authenticated requests use the HTTP-only `ravenx.sid` cookie.

| Method | Endpoint | Purpose / access |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness check. |
| `GET` | `/api/csrf-token` | Start a session and return a CSRF token. |
| `GET` | `/api/events`, `/api/events/:slug` | Published event collection and details. |
| `GET` | `/api/shop/products` | Active products, prices, and size options. |
| `POST` | `/api/shop/orders` | Public order request; prices are looked up server-side and mutations require CSRF. |
| `POST` | `/api/auth/signup` | Create a participant account (`name`, `email`, `phone`, `password`, `confirmPassword`). |
| `POST` | `/api/auth/login`, `/api/auth/logout` | Sign in (`email`, `password`, optional `remember`) and sign out. |
| `GET` | `/api/auth/me`, `/api/me/profile` | Current account/profile. |
| `PATCH` | `/api/me/profile` | Edit participant name and phone. |
| `POST` | `/api/auth/password-reset/request`, `/api/auth/password-reset/confirm` | Request and consume a one-time reset link. |
| `POST` | `/api/events/:slug/registrations` | Authenticated registration form data; file uploads are rejected. |
| `GET` | `/api/me/events`, `/api/me/events/:registrationId` | Own approved, pending, and rejected registrations; detail is ownership-checked. |
| `GET` | `/api/me/events/:registrationId/bib` | Own approved BIB preview as PNG; add `?download=1` to download PNG. |
| `POST` | `/api/me/events/:registrationId/submissions` | Own approved registration run submission (`activity_url` required). Participant details and BIB come from the owned registration; file uploads are rejected. |
| `GET` | `/api/me/certificates`, `/api/me/events/:registrationId/certificate` | Own available certificate previews as PNG; add `?download=1` to download PNG. |
| `GET`, `PATCH`, `POST` | `/api/me/notifications`, `/api/me/notifications/:id/read`, `/api/me/notifications/read-all` | Participant notification list/read actions. |
| `GET` | `/api/admin/summary`, `/api/admin/registrations`, `/api/admin/submissions` | Admin statistics, searchable/filterable registration and run queues. |
| `GET` | `/api/admin/events` | All events, including drafts and archived events, for the admin editor. |
| `POST`, `PATCH` | `/api/admin/events`, `/api/admin/events/:eventId` | Create/update event details, workflows, categories, prices, and artwork. Multipart image uploads go to Cloudinary; event settings go to Neon. |
| `GET` | `/api/admin/shop/products` | All shop items, including paused items. |
| `POST`, `PATCH` | `/api/admin/shop/products`, `/api/admin/shop/products/:productId` | Create/update shop items and upload images. Items are deactivated rather than deleted so historical orders remain intact. |
| `GET` | `/api/admin/registrations/:registrationId` | Admin registration detail. |
| `PATCH` | `/api/admin/registrations/:registrationId` | Admin approval/rejection (`action`; `reason` when rejecting). |
| `PATCH` | `/api/admin/submissions/:submissionId` | Admin approval/rejection (`action`; `feedback` when rejecting). |
| `GET`, `PATCH` | `/api/admin/notifications`, `/api/admin/notifications/:id/read` | Admin notification list/read actions. |
| `GET`, `POST` | `/api/admin/email-outbox/failed`, `/api/admin/email-outbox/:id/retry` | View failed messages and retry one. |
| `GET` | `/api/admin/shop/orders` | Admin-only delivery queue with status/search filters. |
| `PATCH` | `/api/admin/shop/orders/bulk-status` | Admin-only status update for selected orders. |
| `PATCH` | `/api/admin/shop/orders/:orderId` | Admin-only status and optional courier reference update. |

## Database migration

Migration files: `db/migrations/001_ravenx_platform.sql` through `db/migrations/005_shop_product_options.sql`.

`npm run migrate` uses the configured `DATABASE_URL`, records applied files in `schema_migrations`, and applies each SQL file transactionally. The migrations preserve legacy registration tables, payment columns, and historical image references; backfill users without inventing passwords; and create event workflows, shop products/orders, submissions, certificates, notifications, audit, session, BIB-counter, and email-outbox structures. Migration 005 adds optional size selection to products while retaining existing jersey sizes. Current participant screenshot and student ID files remain local to the browser and are excluded from requests and storage. As a result, the browser requirement is a convenience only; participants can bypass it, and the administrator cannot inspect those images.

The provided Neon database was inspected in a read-only transaction before migration; it initially had no application tables or participant records. The additive migration was then applied successfully and the resulting schema verified. It creates the event and platform tables without deleting or truncating data.

## Render deployment

1. Connect the project directory/repository to a Render **Web Service** using Node.
2. Set Node 20+, build command `npm ci`, and start command `npm start`.
3. Add production environment variables in Render (`DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAIL`, `FRONTEND_URL`, and Gmail or Resend/Cloudinary values needed for delivery and uploads). Do not add `.env` to Git.
4. Back up Neon, then run `npm run migrate` from the Render shell.
5. Create/promote the admin account using the instructions above.
6. Verify `/healthz`, sign up a test participant, register, approve, and test uploads/email using real service credentials.

The app honors Render's `PORT`, trusts the Render proxy for secure cookies, and sets `SameSite=Lax`/`HttpOnly` session cookies. `FRONTEND_URL` should be the exact public origin; it controls CORS and email links. The local Neon URL is stored in the ignored `.env` and must be added separately to Render's environment settings.

## Checks and known limits

Run the local checks with:

```powershell
node --check server.js
node --check public/app.js
npm test
npm audit --omit=dev
```

The committed tests cover distance/category mappings, fee rules, BIB formatting, accepted activity link schemes, image signature checks, template-backed BIB/certificate output and PNG rasterization, certificate escaping, and legacy name matching. They are unit checks, not the complete live registration/approval workflow. Run `npm run migrate` to apply any unapplied migrations, including the frontend-only image selection metadata. Provider email delivery and Cloudinary uploads depend on their configured credentials.

The three inspected source sites are separate public repositories. This implementation is in the current workspace and has not been pushed to or deployed from any of them. The existing legacy BIB/certificate image collections remain hosted in their source repositories and depend on those repositories staying public or on replacing the asset-base environment variables with an owned storage location.
