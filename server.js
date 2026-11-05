require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit').rateLimit;
const { z } = require('zod');

const { pool, withTransaction, requireDatabase, hasDatabaseUrl } = require('./src/db');
const { enqueueEmail, processOutbox, ADMIN_EMAIL, emailConfigured } = require('./src/email');
const { uploadBuffer, deleteAsset, storageConfigured } = require('./src/storage');
const {
  DISTANCES, bibPrefix, makeBibNumber, feeForEvent, detectImageMime, validateActivityUrl, hashPasswordResetCode,
  escapeXml, safeFilename, normalizeName, generateCertificateSvg
} = require('./src/domain');
const { makeShadowSprintBibSvg, makeShadowSprintCertificateSvg, rasterizePng } = require('./src/designs');

const PORT = Number(process.env.PORT || 3000);
const FRONTEND_URL = process.env.FRONTEND_URL || ('http://localhost:' + PORT);
const SESSION_SECRET = process.env.SESSION_SECRET
  || (process.env.NODE_ENV === 'production' ? '' : crypto.randomBytes(32).toString('hex'));

if (process.env.NODE_ENV === 'production' && (!hasDatabaseUrl || !SESSION_SECRET)) {
  throw new Error('DATABASE_URL and SESSION_SECRET are required in production.');
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));

if (process.env.FRONTEND_URL) {
  let allowedOrigin = '';
  try { allowedOrigin = new URL(process.env.FRONTEND_URL).origin; } catch {}
  if (allowedOrigin) {
    app.use(cors({
      origin: (origin, callback) => {
        if (!origin || origin === allowedOrigin) return callback(null, true);
        return callback(new Error('Origin not allowed'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token']
    }));
  }
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

const PgSession = connectPgSimple(session);
const sessionStore = hasDatabaseUrl
  ? new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: false, pruneSessionInterval: 15 })
  : undefined;

app.use(session({
  name: 'ravenx.sid',
  secret: SESSION_SECRET || 'development-only-session-secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: undefined
  }
}));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function csrfProtection(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (safeEqual(req.session.csrfToken, req.get('X-CSRF-Token'))) return next();
  return res.status(403).json({ error: 'Request verification expired. Refresh the page and try again.' });
}

app.get('/api/csrf-token', (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  req.session.save((error) => {
    if (error) return res.status(500).json({ error: 'Unable to start a secure session.' });
    res.json({ csrfToken: req.session.csrfToken });
  });
});

app.use('/api', csrfProtection);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' }
});
const passwordResetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Try again later.' }
});
const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' }
});
const submissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Submission limit reached. Try again later.' }
});

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function validationError(res, parsed) {
  return res.status(400).json({
    error: 'Please check the highlighted fields.',
    fields: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }))
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
}

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}

function safeUser(row) {
  const isConfiguredAdmin = row.role === 'admin'
    && String(row.email).toLowerCase() === ADMIN_EMAIL.toLowerCase();
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: isConfiguredAdmin ? 'admin' : 'participant',
    createdAt: row.created_at
  };
}

const requireAuth = asyncRoute(async (req, res, next) => {
  if (!requireDatabase(res)) return;
  if (!req.session.userId) return res.status(401).json({ error: 'Sign in to continue.' });
  const result = await pool.query(
    'SELECT id, name, email, phone, role, created_at FROM users WHERE id=$1',
    [req.session.userId]
  );
  if (!result.rowCount) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
  }
  req.user = result.rows[0];
  return next();
});

const requireAdmin = [
  requireAuth,
  (req, res, next) => {
    if (req.user.role !== 'admin' || String(req.user.email).toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return res.status(403).json({ error: 'Administrator access is restricted to the configured RavenX admin account.' });
    }
    next();
  }
];

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  remember: z.boolean().optional().default(false)
});
const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(6).max(32),
  password: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128)
}).refine((value) => value.password === value.confirmPassword, {
  path: ['confirmPassword'], message: 'Passwords do not match.'
});
const profileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(6).max(32)
});
const registrationSchema = z.object({
  distance: z.string().trim().min(1).max(32),
  category: z.string().trim().min(1).max(40),
  gender: z.enum(['male', 'female', 'other']),
  payment_method: z.string().trim().min(1).max(40),
  payment_number: z.string().trim().min(8).max(32),
  transaction_id: z.string().trim().min(3).max(100)
});
const reviewRegistrationSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(1000).optional()
});
const reviewSubmissionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  feedback: z.string().trim().max(1000).optional()
});
const shopOrderSchema = z.object({
  productSlug: z.string().trim().min(1).max(80),
  customerName: z.string().trim().min(2).max(100),
  customerEmail: z.union([z.string().trim().email().max(254), z.literal('')]).optional().transform((value) => value || null),
  customerPhone: z.string().trim().regex(/^[+0-9() .-]{7,24}$/, 'Enter a valid phone number.'),
  district: z.string().trim().min(2).max(100),
  deliveryAddress: z.string().trim().min(8).max(1000),
  deliveryNote: z.string().trim().max(500).optional().default(''),
  size: z.enum(['S', 'M', 'L', 'XL', 'XXL']).optional(),
  quantity: z.coerce.number().int().min(1).max(10)
});
const adminEventDistanceSchema = z.object({
  value: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(60),
  category: z.string().trim().min(1).max(60),
  bib_prefix: z.string().trim().regex(/^[A-Z0-9]{2,12}$/),
  medal_image: z.string().trim().max(1200).optional().default('')
});
const adminEventSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  description: z.string().trim().min(5).max(6000),
  location: z.string().trim().min(2).max(180),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  distances: z.array(adminEventDistanceSchema).min(1).max(12),
  studentFee: z.number().int().min(0).max(1000000),
  regularFee: z.number().int().min(0).max(1000000),
  earlyBirdStudentDiscount: z.number().int().min(0).max(1000000),
  earlyBirdRegularDiscount: z.number().int().min(0).max(1000000),
  earlyBirdValidUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')),
  paymentMethods: z.array(z.enum(['Bkash', 'Nagad', 'Rocket'])).min(1).max(3),
  bkashNumber: z.string().trim().max(32).default(''),
  bkashMode: z.enum(['Payment', 'Send Money']),
  nagadNumber: z.string().trim().max(32).default(''),
  nagadMode: z.enum(['Payment', 'Send Money']),
  rocketNumber: z.string().trim().max(32).default(''),
  rocketMode: z.enum(['Payment', 'Send Money']),
  courierChargeApplies: z.boolean(),
  rules: z.array(z.string().trim().min(1).max(500)).max(30),
  rewards: z.array(z.string().trim().min(1).max(500)).max(30),
  registrationRequiresApproval: z.boolean(),
  registrationOpen: z.boolean(),
  allowMultipleRegistrations: z.boolean(),
  automaticBibAssignment: z.boolean(),
  runSubmissionEnabled: z.boolean(),
  runApprovalRequired: z.boolean(),
  certificateAfterApproval: z.boolean(),
  studentIdRequired: z.boolean(),
  bannerUrl: z.string().trim().max(1200).optional().default(''),
  bibTemplateUrl: z.string().trim().max(1200).optional().default(''),
  bibExampleUrl: z.string().trim().max(1200).optional().default(''),
  certificateTemplateUrl: z.string().trim().max(1200).optional().default(''),
  certificateExampleUrl: z.string().trim().max(1200).optional().default('')
}).superRefine((event, context) => {
  const values = event.distances.map((item) => item.value.toLowerCase());
  if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path: ['distances'], message: 'Each event distance must be unique.' });
  if (event.earlyBirdStudentDiscount > event.studentFee) context.addIssue({ code: 'custom', path: ['earlyBirdStudentDiscount'], message: 'Early-bird discount cannot exceed the student fee.' });
  if (event.earlyBirdRegularDiscount > event.regularFee) context.addIssue({ code: 'custom', path: ['earlyBirdRegularDiscount'], message: 'Early-bird discount cannot exceed the regular fee.' });
  const paymentNumbers = { Bkash: event.bkashNumber, Nagad: event.nagadNumber, Rocket: event.rocketNumber };
  for (const method of event.paymentMethods) {
    if (!/^[+0-9() .-]{8,32}$/.test(paymentNumbers[method] || '')) {
      context.addIssue({ code: 'custom', path: ['paymentMethods'], message: 'Enter a valid payment number for each enabled payment method.' });
      break;
    }
  }
});
const adminShopProductSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  description: z.string().trim().max(3000).default(''),
  unitPrice: z.number().int().min(0).max(1000000),
  isActive: z.boolean(),
  hasSizes: z.boolean(),
  imageUrl: z.string().trim().max(1200).optional().default('')
});
const shopOrderStatusSchema = z.object({
  status: z.enum(['NEW', 'READY_FOR_COURIER', 'DISPATCHED', 'DELIVERED', 'CANCELLED']),
  deliveryReference: z.string().trim().max(120).optional()
});
const shopOrderBulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(['READY_FOR_COURIER', 'DISPATCHED', 'DELIVERED'])
});

function participantNotification(client, userId, registrationId, title, message, linkPath) {
  return client.query(
    'INSERT INTO notifications (user_id, registration_id, audience, title, message, link_path) ' +
    'VALUES ($1,$2,$3,$4,$5,$6)',
    [userId, registrationId || null, 'PARTICIPANT', title, message, linkPath || null]
  );
}

function adminNotification(client, registrationId, title, message, linkPath) {
  return client.query(
    'INSERT INTO notifications (user_id, registration_id, audience, title, message, link_path) ' +
    'VALUES (NULL,$1,$2,$3,$4,$5)',
    [registrationId || null, 'ADMIN', title, message, linkPath || null]
  );
}

function auditLog(client, adminId, action, targetType, targetId, details = {}) {
  return client.query(
    'INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, details) ' +
    'VALUES ($1,$2,$3,$4,$5::jsonb)',
    [adminId, action, targetType, String(targetId), JSON.stringify(details)]
  );
}

function safeDate(value) {
  return value ? new Date(value).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Dhaka' }) : '';
}

const legacyBibAssets = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'data/legacy-bib-assets.json'), 'utf8')));
const legacyCertificates = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/legacy-certificate-assets.json'), 'utf8'));

async function eventBySlug(slug) {
  const result = await pool.query(
    'SELECT e.*, w.registration_requires_approval, w.registration_open, w.allow_multiple_registrations, ' +
    'w.automatic_bib_assignment, w.run_submission_enabled, w.run_approval_required, w.certificate_after_approval ' +
    'FROM events e JOIN event_workflows w ON w.event_id=e.id ' +
    'WHERE e.slug=$1 AND e.status=$2',
    [slug, 'PUBLISHED']
  );
  return result.rows[0] || null;
}

function isAllowedMediaUrl(value) {
  if (!value) return false;
  if (/^\/assets\/[a-z0-9_./-]+$/i.test(value) && !value.includes('..')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com';
  } catch {
    return false;
  }
}

async function uploadAdminAssets(files, folder) {
  const uploaded = {};
  if (!files?.length) return uploaded;
  if (!storageConfigured) throw new HttpError(503, 'Image uploads are not configured. Add the Cloudinary settings in Render first.');
  const allowedFields = new Set(['banner', 'bibTemplate', 'bibExample', 'certificateTemplate', 'certificateExample', 'image']);
  const uploadedItems = [];
  try {
    for (const file of files) {
      if (!allowedFields.has(file.fieldname) && !/^medal_\d{1,2}$/.test(file.fieldname)) {
        throw new HttpError(400, 'An uploaded image field was not recognized.');
      }
      const detectedMime = detectImageMime(file.buffer);
      if (!detectedMime || detectedMime !== file.mimetype) throw new HttpError(415, 'One of the selected files is not a valid PNG, JPEG, or WebP image.');
      if (uploaded[file.fieldname]) throw new HttpError(400, 'Choose only one image for each image field.');
      const asset = await uploadBuffer(file.buffer, { folder, format: 'png' });
      uploadedItems.push(asset);
      uploaded[file.fieldname] = asset.url;
    }
    return uploaded;
  } catch (error) {
    await Promise.allSettled(uploadedItems.map((asset) => deleteAsset(asset.publicId)));
    throw error;
  }
}

function parseAdminFormJson(req, key, schema) {
  let value;
  try { value = JSON.parse(req.body[key] || ''); }
  catch { throw new HttpError(400, 'The submitted form data could not be read.'); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join(' '));
  return parsed.data;
}

function buildEventMetadata(input, uploaded, previous = {}) {
  const previousDesigns = previous.designs || {};
  const defaultBib = input.slug === 'shadow-sprint-2026' ? '/assets/shadow-sprint-bib-template.png' : '';
  const defaultCertificate = input.slug === 'shadow-sprint-2026' ? '/assets/shadow-sprint-certificate-template.png' : '';
  const designs = {
    bib_template_url: uploaded.bibTemplate || input.bibTemplateUrl || previousDesigns.bib_template_url || defaultBib,
    bib_example_url: uploaded.bibExample || input.bibExampleUrl || previousDesigns.bib_example_url || '',
    certificate_template_url: uploaded.certificateTemplate || input.certificateTemplateUrl || previousDesigns.certificate_template_url || defaultCertificate,
    certificate_example_url: uploaded.certificateExample || input.certificateExampleUrl || previousDesigns.certificate_example_url || ''
  };
  const distances = input.distances.map((distance, index) => ({
    ...distance,
    medal_image: uploaded['medal_' + index] || distance.medal_image || ''
  }));
  return {
    ...previous,
    location: input.location,
    distances,
    early_bird: {
      student_discount_tk: input.earlyBirdStudentDiscount,
      regular_discount_tk: input.earlyBirdRegularDiscount,
      valid_until: input.earlyBirdValidUntil || null
    },
    payment_methods: input.paymentMethods,
    payment_accounts: Object.fromEntries(input.paymentMethods.map((method) => {
      const key = method.toLowerCase();
      return [method, { number: input[key + 'Number'], mode: input[key + 'Mode'] }];
    })),
    fees: {
      ...previous.fees, student: input.studentFee, regular: input.regularFee,
      currency: 'BDT', courier_charge_applies: input.courierChargeApplies
    },
    designs,
    rules: input.rules,
    rewards: input.rewards,
    student_id_categories: input.studentIdRequired ? ['student'] : []
  };
}

function deleteUploadedUrl(url) {
  const match = String(url || '').match(/^https:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|video|raw)\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?(?:\?.*)?$/i);
  return match ? deleteAsset(match[1]) : Promise.resolve(null);
}

async function persistAdminEvent(req, res, existingId = null) {
  if (!requireDatabase(res)) return;
  const input = parseAdminFormJson(req, 'eventData', adminEventSchema);
  const uploaded = await uploadAdminAssets(req.files, 'events');
  let savedAssets = Object.values(uploaded);
  try {
    const result = await withTransaction(async (client) => {
      const previousResult = existingId
        ? await client.query('SELECT * FROM events WHERE id=$1 FOR UPDATE', [existingId])
        : { rowCount: 0, rows: [] };
      if (existingId && !previousResult.rowCount) throw new HttpError(404, 'Event not found.');
      const previous = previousResult.rows[0] || null;
      const metadata = buildEventMetadata(input, uploaded, previous?.metadata || {});
      const bannerUrl = uploaded.banner || input.bannerUrl || previous?.banner_url || '';
      const requiredAssets = [bannerUrl, ...metadata.distances.map((item) => item.medal_image),
        metadata.designs.bib_template_url, metadata.designs.certificate_template_url];
      const exampleAssets = [metadata.designs.bib_example_url, metadata.designs.certificate_example_url];
      if (requiredAssets.some((url) => !isAllowedMediaUrl(url))
        || (!previous && exampleAssets.some((url) => !isAllowedMediaUrl(url)))
        || exampleAssets.some((url) => url && !isAllowedMediaUrl(url))) {
        throw new HttpError(400, 'Add the event cover, every medal image, and clean BIB and certificate templates. New events also need both example images.');
      }
      const eventValues = [input.name, input.slug, input.description, bannerUrl,
        input.startDate || null, input.endDate, input.status, JSON.stringify(metadata)];
      const saved = previous
        ? await client.query(
          'UPDATE events SET name=$1,slug=$2,description=$3,banner_url=$4,start_date=$5,end_date=$6,status=$7,metadata=$8::jsonb,updated_at=NOW() WHERE id=$9 RETURNING *',
          [...eventValues, existingId]
        )
        : await client.query(
          'INSERT INTO events (name,slug,description,banner_url,start_date,end_date,status,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *',
          eventValues
        );
      const event = saved.rows[0];
      const workflowValues = [event.id, input.registrationRequiresApproval, input.registrationOpen,
        input.allowMultipleRegistrations, input.automaticBibAssignment, input.runSubmissionEnabled,
        input.runApprovalRequired, input.certificateAfterApproval];
      await client.query(
        'INSERT INTO event_workflows (event_id,registration_requires_approval,registration_open,allow_multiple_registrations,automatic_bib_assignment,run_submission_enabled,run_approval_required,certificate_after_approval) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (event_id) DO UPDATE SET ' +
        'registration_requires_approval=EXCLUDED.registration_requires_approval,registration_open=EXCLUDED.registration_open,' +
        'allow_multiple_registrations=EXCLUDED.allow_multiple_registrations,automatic_bib_assignment=EXCLUDED.automatic_bib_assignment,' +
        'run_submission_enabled=EXCLUDED.run_submission_enabled,run_approval_required=EXCLUDED.run_approval_required,' +
        'certificate_after_approval=EXCLUDED.certificate_after_approval,updated_at=NOW()',
        workflowValues
      );
      await auditLog(client, req.user.id, previous ? 'EVENT_UPDATED' : 'EVENT_CREATED', 'event', event.id, {
        name: event.name, slug: event.slug, status: event.status
      });
      return event;
    });
    const full = await pool.query(
      'SELECT e.*,w.registration_requires_approval,w.registration_open,w.allow_multiple_registrations,w.automatic_bib_assignment,w.run_submission_enabled,w.run_approval_required,w.certificate_after_approval ' +
      'FROM events e JOIN event_workflows w ON w.event_id=e.id WHERE e.id=$1', [result.id]
    );
    res.status(existingId ? 200 : 201).json({ event: serializeEvent(full.rows[0]) });
  } catch (error) {
    await Promise.allSettled(savedAssets.map(deleteUploadedUrl));
    if (error.code === '23505') throw new HttpError(409, 'An event with this URL name already exists.');
    throw error;
  }
}

function serializeEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    bannerUrl: row.banner_url,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    metadata: row.metadata,
    workflow: {
      registrationRequiresApproval: row.registration_requires_approval,
      registrationOpen: row.registration_open,
      allowMultipleRegistrations: row.allow_multiple_registrations,
      automaticBibAssignment: row.automatic_bib_assignment,
      runSubmissionEnabled: row.run_submission_enabled,
      runApprovalRequired: row.run_approval_required,
      certificateAfterApproval: row.certificate_after_approval
    }
  };
}

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

app.get('/api/events', asyncRoute(async (req, res) => {
  if (!requireDatabase(res)) return;
  const result = await pool.query(
    'SELECT e.*, w.registration_requires_approval, w.registration_open, w.allow_multiple_registrations, ' +
    'w.automatic_bib_assignment, w.run_submission_enabled, w.run_approval_required, w.certificate_after_approval ' +
    'FROM events e JOIN event_workflows w ON w.event_id=e.id WHERE e.status=$1 ORDER BY e.start_date DESC',
    ['PUBLISHED']
  );
  res.json({ events: result.rows.map(serializeEvent) });
}));

app.get('/api/events/:slug', asyncRoute(async (req, res) => {
  if (!requireDatabase(res)) return;
  const row = await eventBySlug(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Event not found.' });
  res.json({ event: serializeEvent(row) });
}));

app.get('/api/shop/products', asyncRoute(async (req, res) => {
  if (!requireDatabase(res)) return;
  const result = await pool.query(
    'SELECT id,slug,name,description,image_url,unit_price_tk,currency,has_sizes FROM shop_products ' +
    'WHERE is_active=TRUE ORDER BY created_at'
  );
  res.json({ products: result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    unitPrice: row.unit_price_tk,
    currency: row.currency,
    hasSizes: row.has_sizes
  })) });
}));

app.post('/api/shop/orders', writeLimiter, asyncRoute(async (req, res) => {
  if (!requireDatabase(res)) return;
  const parsed = shopOrderSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  const values = parsed.data;
  const orderCode = 'RX-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const order = await withTransaction(async (client) => {
    const productResult = await client.query(
      'SELECT id,slug,name,unit_price_tk,has_sizes FROM shop_products WHERE slug=$1 AND is_active=TRUE FOR SHARE',
      [values.productSlug]
    );
    if (!productResult.rowCount) throw new HttpError(404, 'This shop item is no longer available.');
    const product = productResult.rows[0];
    if (product.has_sizes && !values.size) throw new HttpError(400, 'Choose an item size.');
    const selectedSize = product.has_sizes ? values.size : 'ONE_SIZE';
    const total = product.unit_price_tk * values.quantity;
    const created = await client.query(
      'INSERT INTO shop_orders (order_code,user_id,customer_name,customer_email,customer_phone,district,delivery_address,delivery_note,status,total_tk) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,created_at',
      [orderCode, req.session.userId || null, values.customerName, values.customerEmail, values.customerPhone,
        values.district, values.deliveryAddress, values.deliveryNote || null, 'NEW', total]
    );
    const saved = created.rows[0];
    await client.query(
      'INSERT INTO shop_order_items (order_id,product_id,product_name,product_slug,size,quantity,unit_price_tk) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [saved.id, product.id, product.name, product.slug, selectedSize, values.quantity, product.unit_price_tk]
    );
    const mailData = {
      orderCode, productName: product.name, size: selectedSize === 'ONE_SIZE' ? 'One size' : selectedSize, quantity: values.quantity,
      total, name: values.customerName, email: values.customerEmail || 'Not provided',
      phone: values.customerPhone, district: values.district, address: values.deliveryAddress
    };
    await adminNotification(client, null, 'New shop order', orderCode + ' · ' + values.customerName + ' ordered ' + product.name + '.', '/#/admin/shop-orders');
    await enqueueEmail(client, ADMIN_EMAIL, 'shop_order_admin', mailData);
    if (values.customerEmail) await enqueueEmail(client, values.customerEmail, 'shop_order_received', mailData);
    return { id: saved.id, createdAt: saved.created_at, total };
  });
  res.status(201).json({ message: 'Your item order has been received.', orderCode, total: order.total, currency: 'BDT' });
}));

app.post('/api/auth/signup', authLimiter, asyncRoute(async (req, res) => {
  if (!requireDatabase(res)) return;
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  const values = parsed.data;
  const email = values.email.toLowerCase();
  const existing = await pool.query('SELECT id, password_hash FROM users WHERE LOWER(email)=LOWER($1)', [email]);
  if (existing.rowCount) {
    return res.status(409).json({
      error: existing.rows[0].password_hash
        ? 'An account already uses this email. Sign in or reset the password.'
        : 'An existing RavenX registration uses this email. Request a password setup link.'
    });
  }

  const passwordHash = await bcrypt.hash(values.password, 12);
  let user;
  await withTransaction(async (client) => {
    const created = await client.query(
      'INSERT INTO users (name,email,phone,password_hash,role) VALUES ($1,$2,$3,$4,$5) ' +
      'RETURNING id,name,email,phone,role,created_at',
      [values.name, email, values.phone, passwordHash, 'participant']
    );
    user = created.rows[0];
    await participantNotification(client, user.id, null, 'Welcome to RavenX', 'Your account is ready.', '/#/dashboard');
    await enqueueEmail(client, user.email, 'welcome', { name: user.name });
  });
  await establishSession(req, user.id, false);
  res.status(201).json({ user: safeUser(user), csrfToken: req.session.csrfToken });
}));

async function establishSession(req, userId, remember) {
  await regenerateSession(req);
  req.session.userId = userId;
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  if (remember) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
  await saveSession(req);
}

app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
  if (!requireDatabase(res)) return;
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  const email = parsed.data.email.toLowerCase();
  const result = await pool.query(
    'SELECT id,name,email,phone,role,created_at,password_hash FROM users WHERE LOWER(email)=LOWER($1)',
    [email]
  );
  const user = result.rows[0];
  if (!user?.password_hash || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
    return res.status(401).json({ error: 'Email or password is incorrect. Use password setup if this is an older account.' });
  }
  await establishSession(req, user.id, parsed.data.remember);
  res.json({ user: safeUser(user), csrfToken: req.session.csrfToken });
}));

app.post('/api/auth/password-reset/request', passwordResetRequestLimiter, asyncRoute(async (req, res) => {
  if (!requireDatabase(res)) return;
  const startedAt = Date.now();
  const parsed = z.object({ email: z.string().trim().email().max(254) }).safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  const userResult = await pool.query(
    'SELECT id,email FROM users WHERE LOWER(email)=LOWER($1)',
    [parsed.data.email.toLowerCase()]
  );
  if (userResult.rowCount) {
    await withTransaction(async (client) => {
      const user = userResult.rows[0];
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
      const cooldown = await client.query(
        "SELECT 1 FROM password_reset_tokens WHERE user_id=$1 AND created_at>NOW()-INTERVAL '1 minute' LIMIT 1",
        [user.id]
      );
      if (cooldown.rowCount) return;

      await client.query(
        'UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',
        [user.id]
      );
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      const tokenId = crypto.randomUUID();
      const codeHash = hashPasswordResetCode(user.id, tokenId, code, SESSION_SECRET || 'development-only-password-reset-secret');
      const token = await client.query(
        "INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,attempts) VALUES ($1,$2,$3,NOW()+INTERVAL '10 minutes',0) RETURNING id",
        [tokenId, user.id, codeHash]
      );
      await enqueueEmail(client, user.email, 'password_reset_code', { code, tokenId: token.rows[0].id });
    });
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, 250 - (Date.now() - startedAt))));
  res.status(202).json({ message: 'If the account exists, a password reset code will be sent to its email address.' });
}));

app.post('/api/auth/password-reset/verify-code', authLimiter, asyncRoute(async (req, res) => {
  if (!requireDatabase(res)) return;
  const parsed = z.object({
    email: z.string().trim().email().max(254),
    code: z.string().regex(/^\d{6}$/),
    password: z.string().min(8).max(128),
    confirmPassword: z.string().min(8).max(128)
  }).refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'], message: 'Passwords do not match.'
  }).safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);

  const userResult = await pool.query(
    'SELECT id FROM users WHERE LOWER(email)=LOWER($1)',
    [parsed.data.email.toLowerCase()]
  );
  if (!userResult.rowCount) {
    return res.status(400).json({ error: 'The code is invalid, expired, or already used. Request a new code and try again.' });
  }

  const userId = userResult.rows[0].id;
  const updated = await withTransaction(async (client) => {
    const token = await client.query(
      'SELECT id,token_hash,attempts FROM password_reset_tokens ' +
      'WHERE user_id=$1 AND used_at IS NULL AND expires_at>NOW() AND attempts<5 ' +
      'ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
      [userId]
    );
    if (!token.rowCount) return false;
    const codeHash = hashPasswordResetCode(
      userId, token.rows[0].id, parsed.data.code,
      SESSION_SECRET || 'development-only-password-reset-secret'
    );
    if (!safeEqual(token.rows[0].token_hash, codeHash)) {
      const attempts = Number(token.rows[0].attempts) + 1;
      await client.query(
        'UPDATE password_reset_tokens SET attempts=$2, used_at=CASE WHEN $2>=5 THEN NOW() ELSE used_at END WHERE id=$1',
        [token.rows[0].id, attempts]
      );
      return false;
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await client.query('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2', [passwordHash, userId]);
    await client.query("DELETE FROM user_sessions WHERE sess->>'userId'=$1", [userId]);
    await client.query(
      'UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',
      [userId]
    );
    return true;
  });
  if (!updated) return res.status(400).json({ error: 'The code is invalid, expired, or already used. Request a new code and try again.' });
  res.json({ message: 'Password updated. Sign in with your new password.' });
}));

app.post('/api/auth/password-reset/confirm', authLimiter, asyncRoute(async (req, res) => {
  if (!requireDatabase(res)) return;
  const parsed = z.object({
    token: z.string().min(32).max(128),
    password: z.string().min(8).max(128),
    confirmPassword: z.string().min(8).max(128)
  }).refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'], message: 'Passwords do not match.'
  }).safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  const tokenHash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const updated = await withTransaction(async (client) => {
    const token = await client.query(
      'SELECT id,user_id FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE',
      [tokenHash]
    );
    if (!token.rowCount) return false;
    await client.query('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2', [passwordHash, token.rows[0].user_id]);
    await client.query("DELETE FROM user_sessions WHERE sess->>'userId'=$1", [token.rows[0].user_id]);
    await client.query(
      'UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',
      [token.rows[0].user_id]
    );
    return true;
  });
  if (!updated) return res.status(400).json({ error: 'This password setup link has expired or was already used.' });
  res.json({ message: 'Password updated. You can sign in now.' });
}));

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: safeUser(req.user), csrfToken: req.session.csrfToken || null });
});

app.post('/api/auth/logout', requireAuth, asyncRoute(async (req, res) => {
  await new Promise((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie('ravenx.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.json({ ok: true });
}));

app.get('/api/me/profile', requireAuth, (req, res) => res.json({ profile: safeUser(req.user) }));

app.patch('/api/me/profile', requireAuth, writeLimiter, asyncRoute(async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  const result = await pool.query(
    'UPDATE users SET name=$1,phone=$2,updated_at=NOW() WHERE id=$3 RETURNING id,name,email,phone,role,created_at',
    [parsed.data.name, parsed.data.phone, req.user.id]
  );
  res.json({ profile: safeUser(result.rows[0]) });
}));

const formFieldsOnly = multer({
  storage: multer.memoryStorage(),
  limits: { fields: 40, fieldSize: 64 * 1024, files: 0 }
}).none();

const adminAssetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fields: 10, fieldSize: 1024 * 1024, files: 20, fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      return callback(new HttpError(415, 'Upload a PNG, JPEG, or WebP image.'));
    }
    callback(null, true);
  }
}).any();

async function submitRegistration(req, res) {
  if (!requireDatabase(res)) return;
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  const event = await eventBySlug(req.params.slug || 'shadow-sprint-2026');
  if (!event) throw new HttpError(404, 'Event not found.');
  if (!event.registration_open) throw new HttpError(409, 'Registration is currently closed.');
  const metadata = event.metadata || {};
  const distances = Array.isArray(metadata.distances) ? metadata.distances : [];
  if (!distances.some((item) => item.value === parsed.data.distance)) throw new HttpError(400, 'Choose a distance offered by this event.');
  const fee = feeForEvent(metadata, parsed.data.category);
  if (!Number.isFinite(fee) || fee < 0) throw new HttpError(400, 'Choose a registration category offered by this event.');
  const paymentMethods = Array.isArray(metadata.payment_methods) ? metadata.payment_methods : ['Bkash', 'Nagad', 'Rocket'];
  if (!paymentMethods.includes(parsed.data.payment_method)) throw new HttpError(400, 'Choose a payment method offered by this event.');
  try {
    const registration = await withTransaction(async (client) => {
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
      const duplicate = await client.query(
        'SELECT 1 FROM registrations WHERE user_id=$1 AND event_id=$2 ' +
        'AND registration_status IN ($3,$4) AND ($5::boolean=FALSE OR selected_distance=$6) LIMIT 1',
        [req.user.id, event.id, 'PENDING_APPROVAL', 'APPROVED', event.allow_multiple_registrations, parsed.data.distance]
      );
      if (duplicate.rowCount) {
        throw new HttpError(409, event.allow_multiple_registrations
          ? 'You already have an active registration for this distance.'
          : 'You already have an active registration for this event.');
      }

      const requiresApproval = event.registration_requires_approval !== false;
      const status = requiresApproval ? 'PENDING_APPROVAL' : 'APPROVED';
      const bib = !requiresApproval && event.automatic_bib_assignment
        ? await allocateBib(client, { event_id: event.id, selected_distance: parsed.data.distance, event_metadata: metadata })
        : null;

      const inserted = await client.query(
        'INSERT INTO registrations ' +
        '(platform_id,user_id,event_id,name,email,phone,distance,selected_distance,category,gender,payment_method,payment_number,trx_id,transaction_id,registration_fee,registration_status,bib_number,approved_at) ' +
        'VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,CASE WHEN $15::boolean THEN NOW() ELSE NULL END) ' +
        'RETURNING platform_id,created_at,bib_number,registration_status',
        [
          req.user.id, event.id, req.user.name, req.user.email, req.user.phone,
          parsed.data.distance, parsed.data.category, parsed.data.gender,
          parsed.data.payment_method, parsed.data.payment_number, parsed.data.transaction_id,
          fee, status, bib, !requiresApproval
        ]
      );
      const row = inserted.rows[0];
      const link = '/#/my-events/' + row.platform_id;
      if (status === 'PENDING_APPROVAL') {
        await participantNotification(client, req.user.id, row.platform_id, 'Registration submitted', 'Your registration is waiting for administrator approval.', link);
      } else {
        await participantNotification(client, req.user.id, row.platform_id, 'Registration approved', 'Your registration was automatically approved.' + (bib ? ' Your BIB is ' + bib + '.' : ''), link);
        if (bib) await participantNotification(client, req.user.id, row.platform_id, 'BIB assigned', 'Your BIB number is ' + bib + '.', link);
        await enqueueEmail(client, req.user.email, 'registration_approved', {
          name: req.user.name, bib: bib || 'Pending assignment', eventName: event.name
        });
      }
      await adminNotification(client, row.platform_id, 'New registration', req.user.name + ' registered for ' + event.name + '.', '/#/admin/registrations');
      const mailData = {
        name: req.user.name, email: req.user.email, phone: req.user.phone,
        registrationId: row.platform_id, distance: parsed.data.distance,
        paymentMethod: parsed.data.payment_method, transactionId: parsed.data.transaction_id,
        submittedAt: safeDate(row.created_at), eventName: event.name, status,
        bib: row.bib_number || ''
      };
      await enqueueEmail(client, ADMIN_EMAIL, 'registration_admin', mailData);
      return row;
    });
    sendMetaConversion(req, req.user, fee, registration.platform_id).catch((error) => {
      console.error('Meta conversion notification failed', { code: error.code || 'UNKNOWN' });
    });
    res.status(201).json({
      registrationId: registration.platform_id,
      status: registration.registration_status,
      bibNumber: registration.bib_number,
      message: registration.registration_status === 'APPROVED'
        ? 'Registration approved.' + (registration.bib_number ? ' Your BIB is ' + registration.bib_number + '.' : '')
        : 'Registration submitted and waiting for approval.'
    });
  } catch (error) {
    if (uploaded?.publicId) {
      const { deleteAsset } = require('./src/storage');
      await deleteAsset(uploaded.publicId, 'image', 'authenticated').catch(() => {});
    }
    throw error;
  }
}

app.post('/api/events/:slug/registrations', requireAuth, writeLimiter, formFieldsOnly, asyncRoute(submitRegistration));
app.post('/api/register', requireAuth, writeLimiter, formFieldsOnly, asyncRoute(submitRegistration));

function sendMetaConversion(req, user, fee, registrationId) {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!pixelId || !accessToken) return Promise.resolve();
  const hash = (value) => crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
  const userData = { em: [hash(user.email)], ph: [hash(user.phone)] };
  const fbp = String(req.body.fbp || '').slice(0, 200);
  const fbc = String(req.body.fbc || '').slice(0, 200);
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;
  const event = {
    event_name: 'CompleteRegistration',
    event_time: Math.floor(Date.now() / 1000),
    event_id: 'registration_' + registrationId,
    action_source: 'website',
    event_source_url: FRONTEND_URL,
    user_data: {
      ...userData,
      client_ip_address: req.ip,
      client_user_agent: String(req.get('user-agent') || '').slice(0, 300)
    },
    custom_data: { currency: 'BDT', value: Number(fee) }
  };
  const apiVersion = process.env.META_API_VERSION || 'v23.0';
  const url = 'https://graph.facebook.com/' + apiVersion + '/' + encodeURIComponent(pixelId)
    + '/events?access_token=' + encodeURIComponent(accessToken);
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [event] })
  }).then((response) => {
    if (!response.ok) throw new Error('Meta returned HTTP ' + response.status);
  });
}

function registrationQuery(whereClause, params) {
  return pool.query(
    'SELECT r.platform_id AS id,r.name,r.email,r.phone,r.selected_distance AS distance,r.category,r.gender,' +
    'r.payment_method,r.payment_number,r.transaction_id,r.registration_fee,' +
    'r.registration_status AS status,' +
    'r.rejection_reason,r.bib_number,r.created_at,r.approved_at,e.id AS event_id,e.name AS event_name,e.slug AS event_slug,e.banner_url,e.metadata AS event_metadata,' +
    'w.run_submission_enabled,w.certificate_after_approval,' +
    's.id AS submission_id,s.activity_url,s.strava_profile_url,s.delivery_address,s.district,s.additional_information,' +
    's.submission_status,s.admin_feedback,s.submitted_at,' +
    'c.issued_at AS certificate_issued_at ' +
    'FROM registrations r JOIN events e ON e.id=r.event_id JOIN event_workflows w ON w.event_id=e.id ' +
    'LEFT JOIN LATERAL (SELECT * FROM submissions x WHERE x.registration_id=r.platform_id ORDER BY x.submitted_at DESC LIMIT 1) s ON TRUE ' +
    'LEFT JOIN certificates c ON c.registration_id=r.platform_id ' + whereClause,
    params
  );
}

app.get('/api/me/events', requireAuth, asyncRoute(async (req, res) => {
  const result = await registrationQuery('WHERE r.user_id=$1 ORDER BY r.created_at DESC', [req.user.id]);
  const events = result.rows.map((row) => ({
    id: row.id, registrationId: row.id, eventId: row.event_id, eventName: row.event_name, eventSlug: row.event_slug,
    bannerUrl: row.banner_url, participantName: row.name, email: row.email, phone: row.phone,
    workflow: { runSubmissionEnabled: row.run_submission_enabled, certificateAfterApproval: row.certificate_after_approval },
    distance: row.distance, category: row.category, status: row.status, rejectionReason: row.rejection_reason,
    bibNumber: row.bib_number, registrationDate: row.created_at, approvedAt: row.approved_at,
    submission: row.submission_id ? {
      id: row.submission_id, activityUrl: row.activity_url,
      stravaProfileUrl: row.strava_profile_url, deliveryAddress: row.delivery_address,
      district: row.district, additionalInformation: row.additional_information,
      status: row.submission_status, feedback: row.admin_feedback, submittedAt: row.submitted_at
    } : null,
    certificateIssuedAt: row.certificate_issued_at
  }));
  res.json({
    approved: events.filter((item) => item.status === 'APPROVED'),
    pending: events.filter((item) => item.status === 'PENDING_APPROVAL'),
    rejected: events.filter((item) => item.status === 'REJECTED')
  });
}));

async function ownedRegistration(userId, registrationId) {
  const result = await registrationQuery('WHERE r.user_id=$1 AND r.platform_id=$2', [userId, registrationId]);
  return result.rows[0] || null;
}

async function sendPng(res, imageBytes, downloadName) {
  const png = await rasterizePng(imageBytes);
  res.type('image/png');
  if (downloadName) res.setHeader('Content-Disposition', 'attachment; filename="' + safeFilename(downloadName) + '.png"');
  return res.send(png);
}

app.get('/api/me/events/:registrationId', requireAuth, asyncRoute(async (req, res) => {
  const row = await ownedRegistration(req.user.id, req.params.registrationId);
  if (!row) throw new HttpError(404, 'Registration not found.');
  res.json({ registration: row });
}));

app.get('/api/me/events/:registrationId/bib', requireAuth, asyncRoute(async (req, res) => {
  const row = await ownedRegistration(req.user.id, req.params.registrationId);
  if (!row || row.status !== 'APPROVED' || !row.bib_number) throw new HttpError(404, 'BIB is not available.');
  const fileName = row.bib_number + '.png';
  if (row.event_slug !== 'shadow-sprint-2026' && legacyBibAssets.has(fileName)) {
    const base = process.env.BIB_ASSET_BASE_URL || 'https://raw.githubusercontent.com/wqsami173/shadowsprintrun2026/main';
    const remote = await fetch(base.replace(/\/$/, '') + '/' + encodeURIComponent(fileName));
    if (remote.ok) {
      return sendPng(res, Buffer.from(await remote.arrayBuffer()), req.query.download === '1' ? row.bib_number + '-ravenx-bib' : null);
    }
  }
  const svg = await makeBibSvg(row);
  return sendPng(res, svg, req.query.download === '1' ? row.bib_number + '-ravenx-bib' : null);
}));

async function eventTemplateBuffer(url, fallback) {
  if (!url) return fallback;
  try {
    if (url.startsWith('/assets/')) {
      const assetPath = path.resolve(publicDir, decodeURIComponent(url.slice(1)));
      const assetsRoot = path.resolve(publicDir, 'assets') + path.sep;
      if (!assetPath.startsWith(assetsRoot)) return fallback;
      return await fs.promises.readFile(assetPath);
    }
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') return fallback;
    const response = await fetch(parsed, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return fallback;
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > 12 * 1024 * 1024) return fallback;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= 12 * 1024 * 1024 && detectImageMime(buffer) ? buffer : fallback;
  } catch {
    return fallback;
  }
}

async function makeBibSvg(row) {
  const metadata = row.event_metadata || {};
  const designs = metadata.designs || {};
  const distanceInfo = (metadata.distances || []).find((item) => String(item.value).toLowerCase() === String(row.distance || '').toLowerCase());
  const templateUrl = designs.bib_template_url;
  if (row.event_slug === 'shadow-sprint-2026' || templateUrl) {
    const distance = distanceInfo
      ? [distanceInfo.label, distanceInfo.category].filter(Boolean).join(' · ')
      : DISTANCES[String(row.distance || '').toLowerCase()]?.label || row.distance;
    const templateBuffer = await eventTemplateBuffer(templateUrl, undefined);
    return makeShadowSprintBibSvg({ name: row.name, bib: row.bib_number, distance, ...(templateBuffer ? { templateBuffer } : {}) });
  }
  const data = {
    name: escapeXml(row.name), bib: escapeXml(row.bib_number), event: escapeXml(row.event_name),
    distance: escapeXml(row.distance), created: escapeXml(safeDate(row.created_at))
  };
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="700" viewBox="0 0 1100 700">',
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111915"/><stop offset="1" stop-color="#26362c"/></linearGradient><linearGradient id="line"><stop stop-color="#ff5420"/><stop offset="1" stop-color="#ffc534"/></linearGradient></defs>',
    '<rect width="1100" height="700" rx="32" fill="url(#bg)"/><rect x="20" y="20" width="1060" height="660" rx="24" fill="none" stroke="url(#line)" stroke-width="4"/>',
    '<text x="72" y="105" fill="#ff9c30" font-family="Arial,sans-serif" font-size="30" font-weight="700" letter-spacing="8">RAVENX</text>',
    '<text x="72" y="205" fill="#f5f6f0" font-family="Arial,sans-serif" font-size="26">PARTICIPANT BIB</text>',
    '<text x="72" y="350" fill="#fff" font-family="Arial,sans-serif" font-size="98" font-weight="800">' + data.bib + '</text>',
    '<text x="72" y="430" fill="#f5f6f0" font-family="Arial,sans-serif" font-size="38">' + data.name + '</text>',
    '<text x="72" y="495" fill="#bec9bf" font-family="Arial,sans-serif" font-size="28">' + data.event + ' · ' + data.distance + '</text>',
    '<text x="72" y="615" fill="#9fac9f" font-family="Arial,sans-serif" font-size="20">Registration approved · ' + data.created + '</text>',
    '</svg>'
  ].join('\n');
}

const submissionSchema = z.object({
  activity_url: z.string().trim().url().max(500),
  strava_profile_url: z.string().trim().url().max(500).optional().or(z.literal('')),
  delivery_address: z.string().trim().max(1000).optional().or(z.literal('')),
  district: z.string().trim().max(100).optional().or(z.literal('')),
  additional_information: z.string().trim().max(2000).optional().or(z.literal(''))
});

app.post('/api/me/events/:registrationId/submissions', requireAuth, submissionLimiter, formFieldsOnly, asyncRoute(async (req, res) => {
  if (!requireDatabase(res)) return;
  const parsed = submissionSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  if (!validateActivityUrl(parsed.data.activity_url)) throw new HttpError(400, 'Enter a valid activity link from your running app.');
  const registration = await ownedRegistration(req.user.id, req.params.registrationId);
  if (!registration || registration.status !== 'APPROVED') throw new HttpError(404, 'Approved registration not found.');
  const event = await eventBySlug(registration.event_slug);
  if (!event?.run_submission_enabled) throw new HttpError(409, 'Run submission is not enabled for this event.');
  if (registration.submission_status === 'PENDING') throw new HttpError(409, 'A run submission is already waiting for review.');
  if (registration.submission_status === 'APPROVED') throw new HttpError(409, 'This run has already been approved.');
  try {
    const created = await withTransaction(async (client) => {
      const requiresApproval = event.run_approval_required !== false;
      const status = requiresApproval ? 'PENDING' : 'APPROVED';
      const inserted = await client.query(
        'INSERT INTO submissions (registration_id,activity_url,strava_profile_url,delivery_address,district,additional_information,submission_status,reviewed_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7::text=$8 THEN NOW() ELSE NULL END) RETURNING id,submitted_at',
        [registration.id, parsed.data.activity_url, parsed.data.strava_profile_url || null,
          parsed.data.delivery_address || null, parsed.data.district || null,
          parsed.data.additional_information || null, status, 'APPROVED']
      );
      let certificateUnlocked = false;
      if (!requiresApproval && event.certificate_after_approval) {
        const verificationCode = 'RVX-' + registration.id.replace(/-/g, '').slice(0, 10).toUpperCase();
        await client.query(
          'INSERT INTO certificates (registration_id,certificate_url,source_type,verification_code) VALUES ($1,$2,$3,$4) ON CONFLICT (registration_id) DO NOTHING',
          [registration.id, '/api/me/events/' + registration.id + '/certificate', 'GENERATED', verificationCode]
        );
        certificateUnlocked = true;
      }
      if (requiresApproval) {
        await participantNotification(client, req.user.id, registration.id, 'Run submission received', 'Your activity is waiting for administrator review.', '/#/my-events/' + registration.id);
      } else {
        await participantNotification(client, req.user.id, registration.id, 'Run approved', 'Your run was automatically approved by this event’s workflow.', '/#/my-events/' + registration.id);
        if (certificateUnlocked) await participantNotification(client, req.user.id, registration.id, 'Certificate unlocked', 'Your verified finisher certificate is available.', '/#/my-events/' + registration.id + '?section=certificate');
      }
      await adminNotification(client, registration.id, 'New run submission', req.user.name + ' submitted a run for BIB ' + registration.bib_number + '.', '/#/admin/submissions');
      await enqueueEmail(client, ADMIN_EMAIL, 'submission_admin', {
        name: req.user.name, email: req.user.email, bib: registration.bib_number,
        phone: registration.phone, distance: registration.distance,
        registrationId: registration.id, eventName: registration.event_name,
        activityUrl: parsed.data.activity_url,
        submittedAt: safeDate(inserted.rows[0].submitted_at)
      });
      await enqueueEmail(client, req.user.email, 'submission_received', {
        name: req.user.name, bib: registration.bib_number, eventName: registration.event_name
      });
      if (!requiresApproval) {
        await enqueueEmail(client, req.user.email, 'run_approved', {
          name: req.user.name, bib: registration.bib_number, eventName: registration.event_name
        });
        if (certificateUnlocked) await enqueueEmail(client, req.user.email, 'certificate_available', {
          name: req.user.name, bib: registration.bib_number, eventName: registration.event_name
        });
      }
      return { ...inserted.rows[0], status, certificateUnlocked };
    });
    res.status(201).json({
      submissionId: created.id,
      status: created.status,
      certificateUnlocked: created.certificateUnlocked,
      message: created.status === 'PENDING' ? 'Run submission received.' : 'Run submission approved by the event workflow.'
    });
  } catch (error) {
    if (error.code === '23505' && ['submissions_one_pending_per_registration_uidx', 'submissions_one_approved_per_registration_uidx'].includes(error.constraint)) {
      throw new HttpError(409, 'This registration already has a run submission in review or approved.');
    }
    throw error;
  }
}));

app.get('/api/me/certificates', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT c.registration_id AS id,c.issued_at,r.bib_number,r.name AS participant_name,r.selected_distance AS distance,e.name AS event_name ' +
    'FROM certificates c JOIN registrations r ON r.platform_id=c.registration_id JOIN events e ON e.id=r.event_id ' +
    'WHERE r.user_id=$1 ORDER BY c.issued_at DESC',
    [req.user.id]
  );
  res.json({
    certificates: result.rows.map((row) => ({
      registrationId: row.id, eventName: row.event_name, bibNumber: row.bib_number,
      participantName: row.participant_name, distance: row.distance, issueDate: row.issued_at,
      previewUrl: '/api/me/events/' + row.id + '/certificate',
      downloadUrl: '/api/me/events/' + row.id + '/certificate?download=1'
    }))
  });
}));

function legacyCertificateFor(row) {
  const fileName = legacyCertificates[row.bib_number];
  if (!fileName) return null;
  const baseName = path.basename(fileName, path.extname(fileName));
  return normalizeName(baseName) === normalizeName(row.name) ? fileName : null;
}

app.get('/api/me/events/:registrationId/certificate', requireAuth, asyncRoute(async (req, res) => {
  const row = await ownedRegistration(req.user.id, req.params.registrationId);
  if (!row || row.status !== 'APPROVED' || row.submission_status !== 'APPROVED') {
    throw new HttpError(404, 'Certificate is not available.');
  }
  const certificate = await pool.query(
    'SELECT certificate_url,cloudinary_public_id,verification_code,issued_at FROM certificates WHERE registration_id=$1',
    [row.id]
  );
  if (!certificate.rowCount) throw new HttpError(404, 'Certificate is not available.');
  const saved = certificate.rows[0];

  const legacyFile = row.event_slug === 'shadow-sprint-2026' ? null : legacyCertificateFor(row);
  if (legacyFile) {
    const base = process.env.CERTIFICATE_ASSET_BASE_URL || 'https://raw.githubusercontent.com/wqsami173/shadowsprintrun2026certificate/main';
    try {
      const assetUrl = base.replace(/\/$/, '') + '/' + encodeURIComponent(legacyFile);
      const asset = await fetch(assetUrl);
      if (asset.ok) {
        return sendPng(res, Buffer.from(await asset.arrayBuffer()), req.query.download === '1' ? row.bib_number + '-certificate' : null);
      }
    } catch {}
  }

  if (row.event_slug !== 'shadow-sprint-2026' && saved.cloudinary_public_id && saved.certificate_url) {
    try {
      const assetUrl = new URL(saved.certificate_url);
      if (assetUrl.protocol === 'https:' && assetUrl.hostname === 'res.cloudinary.com') {
        const asset = await fetch(assetUrl);
        if (asset.ok) {
          return sendPng(res, Buffer.from(await asset.arrayBuffer()), req.query.download === '1' ? row.bib_number + '-certificate' : null);
        }
      }
    } catch {}
  }

  const certificateTemplate = await eventTemplateBuffer(row.event_metadata?.designs?.certificate_template_url, undefined);
  const certSvg = row.event_slug === 'shadow-sprint-2026' || certificateTemplate
    ? makeShadowSprintCertificateSvg({ name: row.name, ...(certificateTemplate ? { templateBuffer: certificateTemplate } : {}) })
    : generateCertificateSvg({
      name: row.name, eventName: row.event_name, bib: row.bib_number, distance: row.distance,
      issuedAt: safeDate(saved.issued_at), verificationCode: saved.verification_code
    });
  return sendPng(res, certSvg, req.query.download === '1' ? row.bib_number + '-certificate' : null);
}));

app.get('/api/me/notifications', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT id,title,message,link_path,is_read,created_at FROM notifications ' +
    'WHERE audience=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100',
    ['PARTICIPANT', req.user.id]
  );
  res.json({ notifications: result.rows });
}));

app.patch('/api/me/notifications/:id/read', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2 AND audience=$3 RETURNING id',
    [req.params.id, req.user.id, 'PARTICIPANT']
  );
  if (!result.rowCount) throw new HttpError(404, 'Notification not found.');
  res.json({ ok: true });
}));

app.post('/api/me/notifications/read-all', requireAuth, asyncRoute(async (req, res) => {
  await pool.query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND audience=$2', [req.user.id, 'PARTICIPANT']);
  res.json({ ok: true });
}));

app.get('/api/admin/summary', requireAdmin, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT ' +
    '(SELECT COUNT(*) FROM users WHERE role=$1) AS participants,' +
    '(SELECT COUNT(*) FROM registrations) AS registrations,' +
    '(SELECT COUNT(*) FROM registrations WHERE registration_status=$2) AS pending_registrations,' +
    '(SELECT COUNT(*) FROM registrations WHERE registration_status=$3) AS approved_registrations,' +
    '(SELECT COUNT(*) FROM submissions) AS submissions,' +
    '(SELECT COUNT(*) FROM submissions WHERE submission_status=$4) AS pending_submissions,' +
    '(SELECT COUNT(*) FROM submissions WHERE submission_status=$5) AS approved_runs,' +
    '(SELECT COUNT(*) FROM certificates) AS certificates_issued,' +
    '(SELECT COUNT(*) FROM shop_orders) AS shop_orders',
    ['participant', 'PENDING_APPROVAL', 'APPROVED', 'PENDING', 'APPROVED']
  );
  res.json({ stats: result.rows[0] });
}));

app.get('/api/admin/events', requireAdmin, asyncRoute(async (req, res) => {
  if (!requireDatabase(res)) return;
  const result = await pool.query(
    'SELECT e.*,w.registration_requires_approval,w.registration_open,w.allow_multiple_registrations,' +
    'w.automatic_bib_assignment,w.run_submission_enabled,w.run_approval_required,w.certificate_after_approval ' +
    'FROM events e JOIN event_workflows w ON w.event_id=e.id ORDER BY e.created_at DESC'
  );
  res.json({ events: result.rows.map(serializeEvent) });
}));

app.post('/api/admin/events', requireAdmin, writeLimiter, adminAssetUpload, asyncRoute(async (req, res) => {
  await persistAdminEvent(req, res);
}));

app.patch('/api/admin/events/:eventId', requireAdmin, writeLimiter, adminAssetUpload, asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.eventId);
  if (!id.success) throw new HttpError(400, 'Choose a valid event.');
  await persistAdminEvent(req, res, id.data);
}));

app.get('/api/admin/shop/products', requireAdmin, asyncRoute(async (req, res) => {
  if (!requireDatabase(res)) return;
  const result = await pool.query(
    'SELECT id,slug,name,description,image_url,unit_price_tk,currency,is_active,has_sizes,created_at,updated_at ' +
    'FROM shop_products ORDER BY created_at DESC'
  );
  res.json({ products: result.rows.map((row) => ({
    id: row.id, slug: row.slug, name: row.name, description: row.description,
    imageUrl: row.image_url, unitPrice: row.unit_price_tk, currency: row.currency,
    isActive: row.is_active, hasSizes: row.has_sizes, createdAt: row.created_at, updatedAt: row.updated_at
  })) });
}));

async function persistShopProduct(req, res, productId = null) {
  if (!requireDatabase(res)) return;
  const input = parseAdminFormJson(req, 'productData', adminShopProductSchema);
  const uploaded = await uploadAdminAssets(req.files, 'shop-products');
  const imageUrl = uploaded.image || input.imageUrl;
  if (!isAllowedMediaUrl(imageUrl)) throw new HttpError(400, 'Upload a product image before saving.');
  try {
    const result = await withTransaction(async (client) => {
      const previous = productId
        ? await client.query('SELECT id,image_url FROM shop_products WHERE id=$1 FOR UPDATE', [productId])
        : { rowCount: 0, rows: [] };
      if (productId && !previous.rowCount) throw new HttpError(404, 'Shop item not found.');
      const saved = productId
        ? await client.query(
          'UPDATE shop_products SET slug=$1,name=$2,description=$3,image_url=$4,unit_price_tk=$5,is_active=$6,has_sizes=$7,updated_at=NOW() WHERE id=$8 ' +
          'RETURNING id,slug,name,description,image_url,unit_price_tk,currency,is_active,has_sizes',
          [input.slug, input.name, input.description, imageUrl, input.unitPrice, input.isActive, input.hasSizes, productId]
        )
        : await client.query(
          'INSERT INTO shop_products (slug,name,description,image_url,unit_price_tk,currency,is_active,has_sizes) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,slug,name,description,image_url,unit_price_tk,currency,is_active,has_sizes',
          [input.slug, input.name, input.description, imageUrl, input.unitPrice, 'BDT', input.isActive, input.hasSizes]
        );
      const item = saved.rows[0];
      await auditLog(client, req.user.id, productId ? 'SHOP_PRODUCT_UPDATED' : 'SHOP_PRODUCT_CREATED', 'shop_product', item.id, {
        slug: item.slug, active: item.is_active, unitPrice: item.unit_price_tk
      });
      return item;
    });
    res.status(productId ? 200 : 201).json({ product: {
      id: result.id, slug: result.slug, name: result.name, description: result.description,
      imageUrl: result.image_url, unitPrice: result.unit_price_tk, currency: result.currency,
      isActive: result.is_active, hasSizes: result.has_sizes
    } });
  } catch (error) {
    if (uploaded.image) await deleteUploadedUrl(uploaded.image).catch(() => {});
    if (error.code === '23505') throw new HttpError(409, 'An item with this URL name already exists.');
    throw error;
  }
}

app.post('/api/admin/shop/products', requireAdmin, writeLimiter, adminAssetUpload, asyncRoute(async (req, res) => {
  await persistShopProduct(req, res);
}));

app.patch('/api/admin/shop/products/:productId', requireAdmin, writeLimiter, adminAssetUpload, asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.productId);
  if (!id.success) throw new HttpError(400, 'Choose a valid shop item.');
  await persistShopProduct(req, res, id.data);
}));

app.get('/api/admin/shop/orders', requireAdmin, asyncRoute(async (req, res) => {
  const status = String(req.query.status || 'ALL').toUpperCase();
  const search = String(req.query.search || '').trim().slice(0, 100);
  const allowed = ['ALL', 'NEW', 'READY_FOR_COURIER', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];
  if (!allowed.includes(status)) throw new HttpError(400, 'Choose a valid order status.');
  const clauses = [];
  const params = [];
  if (status !== 'ALL') {
    params.push(status);
    clauses.push('o.status=$' + params.length);
  }
  if (search) {
    params.push('%' + search.replace(/[%_]/g, '\\$&') + '%');
    const p = '$' + params.length;
    clauses.push('(o.order_code ILIKE ' + p + ' OR o.customer_name ILIKE ' + p + ' OR o.customer_phone ILIKE ' + p +
      ' OR COALESCE(o.customer_email,\'\') ILIKE ' + p + ' OR o.district ILIKE ' + p + ' OR o.delivery_address ILIKE ' + p + ')');
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const result = await pool.query(
    'SELECT o.id,o.order_code,o.customer_name,o.customer_email,o.customer_phone,o.district,o.delivery_address,' +
    'o.delivery_note,o.status,o.total_tk,o.delivery_reference,o.created_at,o.updated_at,' +
    'json_agg(jsonb_build_object(\'productName\',i.product_name,\'productSlug\',i.product_slug,\'imageUrl\',p.image_url,' +
    '\'size\',i.size,\'quantity\',i.quantity,\'unitPrice\',i.unit_price_tk) ORDER BY i.created_at) AS items ' +
    'FROM shop_orders o JOIN shop_order_items i ON i.order_id=o.id JOIN shop_products p ON p.id=i.product_id ' +
    where + ' GROUP BY o.id ORDER BY o.created_at DESC LIMIT 500',
    params
  );
  res.json({ orders: result.rows });
}));

app.patch('/api/admin/shop/orders/bulk-status', requireAdmin, writeLimiter, asyncRoute(async (req, res) => {
  const parsed = shopOrderBulkSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  const updated = await withTransaction(async (client) => {
    const result = await client.query(
      "UPDATE shop_orders SET status=$1,updated_at=NOW() WHERE id=ANY($2::uuid[]) AND status <> 'CANCELLED' " +
      'RETURNING id,order_code,status',
      [parsed.data.status, parsed.data.ids]
    );
    if (!result.rowCount) throw new HttpError(404, 'No selected orders are available for this update.');
    for (const order of result.rows) {
      await auditLog(client, req.user.id, 'SHOP_ORDER_STATUS_UPDATED', 'shop_order', order.id, {
        orderCode: order.order_code, status: parsed.data.status, bulk: true
      });
    }
    return result.rows;
  });
  res.json({ updated: updated.length, orders: updated });
}));

app.patch('/api/admin/shop/orders/:orderId', requireAdmin, writeLimiter, asyncRoute(async (req, res) => {
  const parsed = shopOrderStatusSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  const result = await withTransaction(async (client) => {
    const current = await client.query('SELECT id,order_code,status FROM shop_orders WHERE id=$1 FOR UPDATE', [req.params.orderId]);
    if (!current.rowCount) throw new HttpError(404, 'Shop order not found.');
    const previous = current.rows[0];
    const updated = await client.query(
      'UPDATE shop_orders SET status=$1,delivery_reference=COALESCE($2,delivery_reference),updated_at=NOW() ' +
      'WHERE id=$3 RETURNING id,order_code,status,delivery_reference',
      [parsed.data.status, parsed.data.deliveryReference || null, previous.id]
    );
    await auditLog(client, req.user.id, 'SHOP_ORDER_STATUS_UPDATED', 'shop_order', previous.id, {
      orderCode: previous.order_code, from: previous.status, to: parsed.data.status,
      deliveryReference: parsed.data.deliveryReference || null
    });
    return updated.rows[0];
  });
  res.json({ order: result });
}));

app.get('/api/admin/registrations', requireAdmin, asyncRoute(async (req, res) => {
  const status = String(req.query.status || 'ALL').toUpperCase();
  const search = String(req.query.search || '').trim().slice(0, 100);
  const clauses = [];
  const params = [];
  if (['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(status)) {
    params.push(status);
    clauses.push('r.registration_status=$' + params.length);
  }
  if (search) {
    params.push('%' + search.replace(/[%_]/g, '\\$&') + '%');
    clauses.push('(r.name ILIKE $' + params.length + ' OR r.email ILIKE $' + params.length + ' OR r.phone ILIKE $' + params.length + ' OR r.bib_number ILIKE $' + params.length + ')');
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const result = await registrationQuery(where + ' ORDER BY r.created_at DESC LIMIT 500', params);
  res.json({ registrations: result.rows });
}));

app.get('/api/admin/registrations/:registrationId', requireAdmin, asyncRoute(async (req, res) => {
  const result = await registrationQuery('WHERE r.platform_id=$1', [req.params.registrationId]);
  if (!result.rowCount) throw new HttpError(404, 'Registration not found.');
  res.json({ registration: result.rows[0] });
}));

async function allocateBib(client, registration) {
  const prefix = bibPrefix(registration.selected_distance, registration.event_metadata?.distances);
  for (let tries = 0; tries < 10000; tries += 1) {
    const counter = await client.query(
      'INSERT INTO bib_counters (event_id,distance_prefix,next_number) VALUES ($1,$2,1) ' +
      'ON CONFLICT (event_id,distance_prefix) DO UPDATE SET next_number=bib_counters.next_number+1 ' +
      'RETURNING next_number',
      [registration.event_id, prefix]
    );
    const bib = makeBibNumber(prefix, counter.rows[0].next_number);
    if (legacyBibAssets.has(bib + '.png')) continue;
    const used = await client.query('SELECT 1 FROM registrations WHERE bib_number=$1 LIMIT 1', [bib]);
    if (!used.rowCount) return bib;
  }
  throw new HttpError(500, 'Unable to allocate a unique BIB number.');
}

app.patch('/api/admin/registrations/:registrationId', requireAdmin, writeLimiter, asyncRoute(async (req, res) => {
  const parsed = reviewRegistrationSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  if (parsed.data.action === 'reject' && !parsed.data.reason) throw new HttpError(400, 'Add a rejection reason.');
  const result = await withTransaction(async (client) => {
    const selected = await client.query(
      'SELECT r.*,e.name AS event_name,e.slug AS event_slug,e.metadata AS event_metadata,w.automatic_bib_assignment ' +
      'FROM registrations r JOIN events e ON e.id=r.event_id JOIN event_workflows w ON w.event_id=e.id ' +
      'WHERE r.platform_id=$1 FOR UPDATE OF r',
      [req.params.registrationId]
    );
    if (!selected.rowCount) throw new HttpError(404, 'Registration not found.');
    const registration = selected.rows[0];
    if (registration.registration_status !== 'PENDING_APPROVAL') throw new HttpError(409, 'This registration has already been reviewed.');

    if (parsed.data.action === 'reject') {
      await client.query(
        'UPDATE registrations SET registration_status=$1,rejection_reason=$2,updated_at=NOW() WHERE platform_id=$3',
        ['REJECTED', parsed.data.reason, registration.platform_id]
      );
      await participantNotification(client, registration.user_id, registration.platform_id, 'Registration not approved', parsed.data.reason, '/#/my-events/' + registration.platform_id);
      await enqueueEmail(client, registration.email, 'registration_rejected', {
        name: registration.name, reason: parsed.data.reason, eventName: registration.event_name
      });
      await auditLog(client, req.user.id, 'REGISTRATION_REJECTED', 'registration', registration.platform_id, { reason: parsed.data.reason });
      return { id: registration.platform_id, status: 'REJECTED' };
    }

    let bib = registration.bib_number;
    if (!bib && registration.automatic_bib_assignment) bib = await allocateBib(client, registration);
    await client.query(
      'UPDATE registrations SET registration_status=$1,bib_number=$2,approved_at=NOW(),updated_at=NOW() WHERE platform_id=$3',
      ['APPROVED', bib, registration.platform_id]
    );
    await participantNotification(client, registration.user_id, registration.platform_id, 'Registration approved', 'Your event registration has been approved.', '/#/my-events/' + registration.platform_id);
    await participantNotification(client, registration.user_id, registration.platform_id, 'BIB assigned', 'Your BIB number is ' + bib + '.', '/#/my-events/' + registration.platform_id);
    await enqueueEmail(client, registration.email, 'registration_approved', {
      name: registration.name, bib: bib || 'Pending assignment', eventName: registration.event_name
    });
    await auditLog(client, req.user.id, 'REGISTRATION_APPROVED', 'registration', registration.platform_id, { bib });
    return { id: registration.platform_id, status: 'APPROVED', bibNumber: bib };
  });
  res.json(result);
}));

app.get('/api/admin/submissions', requireAdmin, asyncRoute(async (req, res) => {
  const status = String(req.query.status || 'ALL').toUpperCase();
  const search = String(req.query.search || '').trim().slice(0, 100);
  const params = [];
  const clauses = [];
  if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    params.push(status);
    clauses.push('s.submission_status=$' + params.length);
  }
  if (search) {
    params.push('%' + search.replace(/[%_]/g, '\\$&') + '%');
    clauses.push('(r.name ILIKE $' + params.length + ' OR r.email ILIKE $' + params.length + ' OR r.bib_number ILIKE $' + params.length + ')');
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const result = await pool.query(
    'SELECT s.id,s.registration_id,s.activity_url,s.strava_profile_url,s.delivery_address,s.district,s.additional_information,' +
    's.submission_status,s.admin_feedback,s.submitted_at,s.reviewed_at,' +
    'r.name,r.email,r.phone,r.bib_number,r.selected_distance AS distance,r.category,e.name AS event_name ' +
    'FROM submissions s JOIN registrations r ON r.platform_id=s.registration_id JOIN events e ON e.id=r.event_id ' +
    where + ' ORDER BY s.submitted_at DESC LIMIT 500',
    params
  );
  res.json({
    submissions: result.rows.map((row) => ({
      ...row,
    }))
  });
}));

app.patch('/api/admin/submissions/:submissionId', requireAdmin, writeLimiter, asyncRoute(async (req, res) => {
  const parsed = reviewSubmissionSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed);
  if (parsed.data.action === 'reject' && !parsed.data.feedback) throw new HttpError(400, 'Add rejection feedback.');
  const result = await withTransaction(async (client) => {
    const selected = await client.query(
      'SELECT s.*,r.user_id,r.name,r.email,r.bib_number,r.platform_id,r.selected_distance,e.name AS event_name,e.slug AS event_slug,w.certificate_after_approval ' +
      'FROM submissions s JOIN registrations r ON r.platform_id=s.registration_id ' +
      'JOIN events e ON e.id=r.event_id JOIN event_workflows w ON w.event_id=e.id ' +
      'WHERE s.id=$1 FOR UPDATE OF s,r',
      [req.params.submissionId]
    );
    if (!selected.rowCount) throw new HttpError(404, 'Run submission not found.');
    const submission = selected.rows[0];
    if (submission.submission_status !== 'PENDING') throw new HttpError(409, 'This submission has already been reviewed.');
    const status = parsed.data.action === 'approve' ? 'APPROVED' : 'REJECTED';
    await client.query(
      'UPDATE submissions SET submission_status=$1,admin_feedback=$2,reviewed_at=NOW() WHERE id=$3',
      [status, parsed.data.feedback || null, submission.id]
    );

    if (status === 'APPROVED' && submission.certificate_after_approval) {
      const verificationCode = 'RVX-' + submission.platform_id.replace(/-/g, '').slice(0, 10).toUpperCase();
      await client.query(
        'INSERT INTO certificates (registration_id,certificate_url,source_type,verification_code) ' +
        'VALUES ($1,$2,$3,$4) ON CONFLICT (registration_id) DO NOTHING',
        [submission.platform_id, '/api/me/events/' + submission.platform_id + '/certificate', 'GENERATED', verificationCode]
      );
      const certificate = await client.query(
        'SELECT verification_code,issued_at FROM certificates WHERE registration_id=$1',
        [submission.platform_id]
      );
      await participantNotification(client, submission.user_id, submission.platform_id, 'Run approved', 'Your run submission passed review.', '/#/my-events/' + submission.platform_id);
      await participantNotification(client, submission.user_id, submission.platform_id, 'Certificate unlocked', 'Your verified finisher certificate is available.', '/#/my-events/' + submission.platform_id + '?section=certificate');
      await enqueueEmail(client, submission.email, 'run_approved', {
        name: submission.name, bib: submission.bib_number, eventName: submission.event_name
      });
      await enqueueEmail(client, submission.email, 'certificate_available', {
        name: submission.name, bib: submission.bib_number, eventName: submission.event_name
      });
      await auditLog(client, req.user.id, 'RUN_APPROVED', 'submission', submission.id, { registrationId: submission.platform_id, feedback: parsed.data.feedback || null });
      await auditLog(client, req.user.id, 'CERTIFICATE_UNLOCKED', 'certificate', submission.platform_id, { registrationId: submission.platform_id });
      return {
        id: submission.id,
        status,
        certificate: {
          registrationId: submission.platform_id,
          name: submission.name,
          eventName: submission.event_name,
          eventSlug: submission.event_slug,
          bib: submission.bib_number,
          distance: submission.selected_distance,
          verificationCode: certificate.rows[0].verification_code,
          issuedAt: certificate.rows[0].issued_at
        }
      };
    } else {
      await participantNotification(client, submission.user_id, submission.platform_id, 'Run submission needs an update', parsed.data.feedback, '/#/my-events/' + submission.platform_id);
      await enqueueEmail(client, submission.email, 'run_rejected', {
        name: submission.name, bib: submission.bib_number, feedback: parsed.data.feedback, eventName: submission.event_name
      });
    }
    if (status === 'REJECTED') {
      await auditLog(client, req.user.id, 'RUN_REJECTED', 'submission', submission.id, { registrationId: submission.platform_id, feedback: parsed.data.feedback || null });
    }
    return { id: submission.id, status };
  });

  if (result.certificate && storageConfigured && result.certificate.eventSlug !== 'shadow-sprint-2026') {
    try {
      const svg = generateCertificateSvg({
        name: result.certificate.name,
        eventName: result.certificate.eventName,
        bib: result.certificate.bib,
        distance: result.certificate.distance,
        issuedAt: safeDate(result.certificate.issuedAt),
        verificationCode: result.certificate.verificationCode
      });
      const stored = await uploadBuffer(Buffer.from(svg), {
        folder: 'certificates',
        publicId: 'certificate-' + result.certificate.registrationId,
        format: 'svg'
      });
      await pool.query(
        'UPDATE certificates SET certificate_url=$1,cloudinary_public_id=$2 WHERE registration_id=$3',
        [stored.url, stored.publicId, result.certificate.registrationId]
      );
    } catch (error) {
      console.error('Certificate storage failed; protected generation remains available', { code: error.code || 'UPLOAD_FAILED' });
    }
  }
  const response = { id: result.id, status: result.status };
  if (result.certificate) response.certificateUnlocked = true;
  res.json(response);
}));

app.get('/api/admin/notifications', requireAdmin, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT id,title,message,link_path,is_read,created_at FROM notifications WHERE audience=$1 ORDER BY created_at DESC LIMIT 100',
    ['ADMIN']
  );
  res.json({ notifications: result.rows });
}));

app.patch('/api/admin/notifications/:id/read', requireAdmin, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'UPDATE notifications SET is_read=TRUE WHERE id=$1 AND audience=$2 RETURNING id',
    [req.params.id, 'ADMIN']
  );
  if (!result.rowCount) throw new HttpError(404, 'Notification not found.');
  res.json({ ok: true });
}));

app.get('/api/admin/email-outbox/failed', requireAdmin, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT id,recipient,template_name,status,attempts,last_error,created_at ' +
    'FROM email_outbox WHERE status=$1 ORDER BY created_at DESC LIMIT 100',
    ['FAILED']
  );
  res.json({ messages: result.rows });
}));

app.post('/api/admin/email-outbox/:id/retry', requireAdmin, writeLimiter, asyncRoute(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const updated = await client.query(
      "UPDATE email_outbox SET status='PENDING',attempts=0,next_attempt_at=NOW(),locked_at=NULL,last_error=NULL " +
      "WHERE id=$1 AND status='FAILED' RETURNING id,recipient,template_name",
      [req.params.id]
    );
    if (!updated.rowCount) throw new HttpError(404, 'Failed email delivery was not found.');
    await auditLog(client, req.user.id, 'EMAIL_RETRY_REQUESTED', 'email_outbox', updated.rows[0].id, {
      recipient: updated.rows[0].recipient,
      template: updated.rows[0].template_name
    });
    return updated.rows[0];
  });
  res.json({ id: result.id, status: 'PENDING', message: 'Email queued for retry.' });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? 'The uploaded file is too large.' : 'The upload could not be processed.' });
  }
  const status = Number(error.status) || 500;
  if (status >= 500) console.error('Request failed', { path: req.path, code: error.code || 'INTERNAL_ERROR' });
  res.status(status).json({
    error: status >= 500 ? 'The request could not be completed. Try again later.' : error.message,
    code: error.code || undefined
  });
});

const server = app.listen(PORT, () => {
  console.log('RavenX platform listening on port ' + server.address().port);
  if (!hasDatabaseUrl) console.warn('DATABASE_URL is not configured; only static pages and CSRF setup are available.');
  if (!emailConfigured) console.warn('No email sender is configured; messages will remain in the email outbox.');
  if (!storageConfigured) console.warn('Cloudinary is not configured; generated certificates will not be persisted remotely.');
});

const outboxTimer = setInterval(() => {
  processOutbox().catch((error) => console.error('Email outbox worker failed', { code: error.code || 'UNKNOWN' }));
}, 15000);
outboxTimer.unref();

function shutdown() {
  clearInterval(outboxTimer);
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { app, server, allocateBib, makeBibSvg, legacyBibAssets, legacyCertificates };

