const DISTANCES = Object.freeze({
  '3.1km': { label: '3.1 KM', category: 'Silver', prefix: 'SR31', image: '/assets/3.1KM.jpeg' },
  '6.66km': { label: '6.66 KM', category: 'Golden', prefix: 'SR66', image: '/assets/6.66km.jpg' },
  '13km': { label: '13 KM', category: 'Black', prefix: 'SR13', image: '/assets/13KM.jpg' }
});

const REGISTRATION_FEES = Object.freeze({ student: 599, regular: 649 });

function feeForCategory(category) {
  return REGISTRATION_FEES[String(category || '').toLowerCase()] ?? null;
}

function feeForEvent(metadata, category, now = new Date()) {
  const fees = metadata?.fees || {};
  const base = fees[String(category || '').toLowerCase()];
  if (!Number.isFinite(Number(base))) return null;
  const earlyBird = metadata?.early_bird || {};
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  const validUntil = String(earlyBird.valid_until || '');
  const discount = validUntil && validUntil >= today
    ? Number(earlyBird[String(category || '').toLowerCase() + '_discount_tk'] || 0)
    : 0;
  return Math.max(0, Number(base) - (Number.isFinite(discount) ? Math.max(0, discount) : 0));
}

function bibPrefix(distance, definitions = Object.values(DISTANCES)) {
  const normalized = String(distance || '').toLowerCase();
  const match = (Array.isArray(definitions) ? definitions : Object.values(DISTANCES))
    .find((item) => String(item.value || '').toLowerCase() === normalized);
  return match?.bib_prefix || match?.prefix || DISTANCES[normalized]?.prefix || 'SRX';
}

function makeBibNumber(prefix, number) {
  const sequence = Number(number);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError('BIB sequence must be a positive integer');
  return String(prefix) + '-A' + String(sequence).padStart(3, '0');
}

function validateStravaUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['strava.com', 'www.strava.com'].includes(url.hostname.toLowerCase())
      && /^\/activities\/\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function validateActivityUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol)
      && Boolean(url.hostname)
      && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateStravaProfileUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['strava.com', 'www.strava.com'].includes(url.hostname.toLowerCase())
      && /^\/athletes\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
}

function safeFilename(value) {
  return String(value || 'ravenx')
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'ravenx';
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function generateCertificateSvg({ name, eventName, bib, distance, issuedAt, verificationCode }) {
  const safe = {
    name: escapeXml(name),
    eventName: escapeXml(eventName),
    bib: escapeXml(bib),
    distance: escapeXml(distance),
    issuedAt: escapeXml(issuedAt),
    verificationCode: escapeXml(verificationCode)
  };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850" role="img" aria-labelledby="title desc">',
    '<title id="title">RavenX Certificate of Achievement</title>',
    '<desc id="desc">A verified finisher certificate issued after administrator approval of a RavenX run submission.</desc>',
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#101814"/><stop offset="1" stop-color="#1d2d25"/></linearGradient><linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ff5b21"/><stop offset="1" stop-color="#ffbd34"/></linearGradient></defs>',
    '<rect width="1200" height="850" rx="34" fill="#0b100e"/><rect x="22" y="22" width="1156" height="806" rx="24" fill="url(#bg)" stroke="url(#accent)" stroke-width="4"/>',
    '<path d="M76 180h1048M76 670h1048" stroke="#9cae9f" stroke-opacity=".35"/>',
    '<text x="600" y="130" text-anchor="middle" fill="#ff9b2e" font-family="Arial,sans-serif" font-size="28" font-weight="700" letter-spacing="10">RAVENX · VERIFIED FINISHER</text>',
    '<text x="600" y="260" text-anchor="middle" fill="#f2f5ee" font-family="Georgia,serif" font-size="56" font-weight="700">Certificate of Achievement</text>',
    '<text x="600" y="335" text-anchor="middle" fill="#b7c3b8" font-family="Arial,sans-serif" font-size="24">This certifies that</text>',
    '<text x="600" y="430" text-anchor="middle" fill="#f1a43a" font-family="Georgia,serif" font-size="60" font-weight="700">' + safe.name + '</text>',
    '<text x="600" y="495" text-anchor="middle" fill="#d8e0d7" font-family="Arial,sans-serif" font-size="25">completed and passed review for</text>',
    '<text x="600" y="552" text-anchor="middle" fill="#f2f5ee" font-family="Arial,sans-serif" font-size="34" font-weight="700">' + safe.eventName + '</text>',
    '<text x="600" y="612" text-anchor="middle" fill="#b7c3b8" font-family="Arial,sans-serif" font-size="22">' + safe.distance + ' · BIB ' + safe.bib + '</text>',
    '<text x="600" y="726" text-anchor="middle" fill="#d5dfd5" font-family="Arial,sans-serif" font-size="20">Issued ' + safe.issuedAt + ' · Verification ' + safe.verificationCode + '</text>',
    '</svg>'
  ].join('\n');
}

module.exports = {
  DISTANCES, REGISTRATION_FEES, feeForCategory, feeForEvent, bibPrefix, makeBibNumber,
  validateStravaUrl, validateActivityUrl, validateStravaProfileUrl, detectImageMime, escapeXml,
  safeFilename, normalizeName, generateCertificateSvg
};

