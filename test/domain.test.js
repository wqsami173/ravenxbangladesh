const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DISTANCES, feeForCategory, feeForEvent, bibPrefix, makeBibNumber, validateStravaUrl, validateActivityUrl, validateStravaProfileUrl,
  detectImageMime, generateCertificateSvg, normalizeName, hashPasswordResetCode
} = require('../src/domain');
const { makeShadowSprintBibSvg, makeShadowSprintCertificateSvg, rasterizePng } = require('../src/designs');
const { template: emailTemplate } = require('../src/email');
const sharp = require('sharp');

test('Shadow Sprint distances map to the supplied medal categories and assets', () => {
  assert.deepEqual(Object.values(DISTANCES).map(({ label, category }) => [label, category]), [
    ['3.1 KM', 'Silver'], ['6.66 KM', 'Golden'], ['13 KM', 'Black']
  ]);
  assert.equal(DISTANCES['13km'].image, '/assets/13KM.jpg');
});

test('registration fees are determined by participant category', () => {
  assert.equal(feeForCategory('student'), 599);
  assert.equal(feeForCategory('regular'), 649);
  assert.equal(feeForCategory('unknown'), null);
});

test('event early-bird prices expire on their configured Dhaka date', () => {
  const metadata = {
    fees: { student: 600, regular: 800 },
    early_bird: { student_discount_tk: 100, regular_discount_tk: 150, valid_until: '2026-11-05' }
  };
  assert.equal(feeForEvent(metadata, 'student', new Date('2026-11-05T12:00:00+06:00')), 500);
  assert.equal(feeForEvent(metadata, 'regular', new Date('2026-11-05T12:00:00+06:00')), 650);
  assert.equal(feeForEvent(metadata, 'student', new Date('2026-11-06T12:00:00+06:00')), 600);
  assert.equal(feeForEvent(metadata, 'unknown', new Date('2026-11-05T12:00:00+06:00')), null);
});

test('BIB assignment uses distance prefixes and padded sequence numbers', () => {
  assert.equal(bibPrefix('3.1km'), 'SR31');
  assert.equal(bibPrefix('6.66km'), 'SR66');
  assert.equal(bibPrefix('13km'), 'SR13');
  assert.equal(makeBibNumber('SR31', 1), 'SR31-A001');
  assert.equal(makeBibNumber('SR66', 702), 'SR66-A702');
  assert.equal(bibPrefix('half-marathon', [{ value: 'half-marathon', bib_prefix: 'SS26' }]), 'SS26');
  assert.throws(() => makeBibNumber('SR31', 0), /positive integer/);
});

test('Strava validation accepts activity links and rejects other hosts or paths', () => {
  assert.equal(validateStravaUrl('https://www.strava.com/activities/123456'), true);
  assert.equal(validateStravaUrl('https://strava.com/activities/123456/'), true);
  assert.equal(validateStravaUrl('https://strava.com/athletes/123456'), false);
  assert.equal(validateStravaUrl('https://example.com/activities/123456'), false);
  assert.equal(validateStravaUrl('javascript:alert(1)'), false);
});

test('activity link validation accepts other running apps while limiting links to web URLs', () => {
  assert.equal(validateActivityUrl('https://connect.garmin.com/modern/activity/123456'), true);
  assert.equal(validateActivityUrl('https://www.nike.com/activities/abc'), true);
  assert.equal(validateActivityUrl('http://example.com/run/1'), true);
  assert.equal(validateActivityUrl('javascript:alert(1)'), false);
  assert.equal(validateActivityUrl('ftp://example.com/run'), false);
});

test('Strava profile validation only accepts Strava athlete profile URLs', () => {
  assert.equal(validateStravaProfileUrl('https://www.strava.com/athletes/123456'), true);
  assert.equal(validateStravaProfileUrl('https://strava.com/athletes/runner-name/'), true);
  assert.equal(validateStravaProfileUrl('https://www.strava.com/activities/123456'), false);
  assert.equal(validateStravaProfileUrl('https://example.com/athletes/123456'), false);
  assert.equal(validateStravaProfileUrl('javascript:alert(1)'), false);
});

test('image upload checks actual PNG, JPEG, and WEBP file signatures', () => {
  const png = Buffer.from([137,80,78,71,13,10,26,10]);
  const jpeg = Buffer.from([0xff,0xd8,0xff,0x00]);
  const webp = Buffer.from('RIFF0000WEBP', 'ascii');
  assert.equal(detectImageMime(png), 'image/png');
  assert.equal(detectImageMime(jpeg), 'image/jpeg');
  assert.equal(detectImageMime(webp), 'image/webp');
  assert.equal(detectImageMime(Buffer.from('not an image')), null);
});

test('certificates escape user content and include the assigned event and BIB', () => {
  const svg = generateCertificateSvg({
    name: '<script>alert("x")</script>', eventName: 'Shadow Sprint Run 2026',
    bib: 'SR31-A001', distance: '3.1 KM', issuedAt: 'Nov 5, 2026', verificationCode: 'RVX-123'
  });
  assert.match(svg, /&lt;script&gt;/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /Shadow Sprint Run 2026/);
  assert.match(svg, /SR31-A001/);
});

test('Shadow Sprint designs use the supplied backgrounds and overlay requested fields', () => {
  const bib = makeShadowSprintBibSvg({ name: 'Annaf Sajid', bib: 'SR66-C947', distance: '6.66 KM' });
  assert.match(bib, /width="1080" height="1350"/);
  assert.match(bib, /6\.66 KM/);
  assert.match(bib, /SR66-C947/);
  assert.match(bib, /Annaf Sajid/);
  assert.match(bib, /data:image\/png;base64,/);
  const certificate = makeShadowSprintCertificateSvg({ name: 'Annaf Sajid' });
  assert.match(certificate, /width="1536" height="1024"/);
  assert.match(certificate, /Annaf Sajid/);
  assert.doesNotMatch(certificate, /SR66-C947|6\.66 KM/);
});

test('personalized BIB and certificate output rasterizes to PNG at template resolution', async () => {
  const bib = await rasterizePng(makeShadowSprintBibSvg({ name: 'Raven Runner', bib: 'SR31-A001', distance: '3.1 KM' }));
  const certificate = await rasterizePng(makeShadowSprintCertificateSvg({ name: 'Raven Runner' }));
  const [bibInfo, certificateInfo] = await Promise.all([sharp(bib).metadata(), sharp(certificate).metadata()]);
  assert.deepEqual([bibInfo.format, bibInfo.width, bibInfo.height], ['png', 1080, 1350]);
  assert.deepEqual([certificateInfo.format, certificateInfo.width, certificateInfo.height], ['png', 1536, 1024]);
});

test('participant-name normalization is case and punctuation insensitive', () => {
  assert.equal(normalizeName('  Raven-X  Runner '), normalizeName('raven x runner'));
});

test('password reset code hashes are keyed and bound to one account', () => {
  const first = hashPasswordResetCode('user-a', 'request-a', '012345', 'session-secret');
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, hashPasswordResetCode('user-b', 'request-a', '012345', 'session-secret'));
  assert.notEqual(first, hashPasswordResetCode('user-a', 'request-a', '012346', 'session-secret'));
  assert.notEqual(first, hashPasswordResetCode('user-a', 'request-b', '012345', 'session-secret'));
  assert.notEqual(first, hashPasswordResetCode('user-a', 'request-a', '012345', 'another-secret'));
});

test('password reset email contains the one-time code and expiry guidance', () => {
  const email = emailTemplate('password_reset_code', { code: '012345' });
  assert.match(email.subject, /RavenX password reset code/);
  assert.match(email.html, /012345/);
  assert.match(email.html, /expires in 10 minutes/);
  assert.match(email.html, /ignore this email/);
});
