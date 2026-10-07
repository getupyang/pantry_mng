const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  assertSuccessfulResponse,
  createEvidencePaths,
  parseAdminToken,
  parseExpectedConflict,
  parseExpectedPackageSize,
  verifyAdminReview,
  validateImagePaths
} = require('./test-photo-live.cjs');
const {
  ALLOWED_API_PATHS,
  FORWARDED_HEADERS,
  getForwardedHeaders
} = require('./dev-server.cjs');

test('live smoke accepts one to three readable regular image paths', async t => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantry-live-args-'));
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  const fixtures = ['front.jpg', 'side.png', 'expiry.webp'].map(name => {
    const fixturePath = path.join(fixtureDir, name);
    fs.writeFileSync(fixturePath, 'fixture');
    return fixturePath;
  });

  assert.deepEqual(await validateImagePaths(fixtures.slice(0, 1)), fixtures.slice(0, 1));
  assert.deepEqual(await validateImagePaths(fixtures.slice(0, 2)), fixtures.slice(0, 2));
  assert.deepEqual(await validateImagePaths(fixtures), fixtures);
});

test('live smoke rejects invalid counts before touching the browser', async () => {
  await assert.rejects(() => validateImagePaths([]), /1 to 3 image paths/i);
  await assert.rejects(
    () => validateImagePaths(['one.jpg', 'two.jpg', 'three.jpg', 'four.jpg']),
    /1 to 3 image paths/i
  );
});

test('live smoke rejects empty, flag-like, missing, and directory paths', async t => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantry-live-invalid-'));
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  for (const [value, expected] of [
    ['', /non-empty/i],
    ['   ', /non-empty/i],
    ['--help', /flag-like/i],
    [path.join(fixtureDir, 'missing.jpg'), /does not exist|cannot be read/i],
    [fixtureDir, /regular file/i]
  ]) {
    await assert.rejects(() => validateImagePaths([value]), expected);
  }
});

test('every live smoke requires a non-empty admin token', () => {
  assert.equal(parseAdminToken('secret-from-env'), 'secret-from-env');
  assert.throws(() => parseAdminToken(undefined), /PANTRY_ADMIN_TOKEN is required/);
  assert.throws(() => parseAdminToken('  '), /PANTRY_ADMIN_TOKEN is required/);
});

test('expected package size is optional but must be a positive number', () => {
  assert.equal(parseExpectedPackageSize(undefined), null);
  assert.equal(parseExpectedPackageSize(''), null);
  assert.equal(parseExpectedPackageSize('12'), 12);
  assert.equal(parseExpectedPackageSize('12.5'), 12.5);
  for (const value of ['0', '-1', 'twelve', 'Infinity']) {
    assert.throws(() => parseExpectedPackageSize(value), /PANTRY_EXPECTED_PACKAGE_SIZE/);
  }
});

test('conflict smoke mode is parsed only from PANTRY_EXPECT_CONFLICT', () => {
  assert.equal(parseExpectedConflict(undefined), false);
  assert.equal(parseExpectedConflict(''), false);
  assert.equal(parseExpectedConflict('no'), false);
  assert.equal(parseExpectedConflict(' yes '), true);
  for (const value of ['true', '1', 'maybe']) {
    assert.throws(() => parseExpectedConflict(value), /PANTRY_EXPECT_CONFLICT/);
  }
});

test('each live run gets unique evidence paths with no stale success file', async t => {
  const first = await createEvidencePaths();
  const second = await createEvidencePaths();
  t.after(() => {
    fs.rmSync(first.directory, { recursive: true, force: true });
    fs.rmSync(second.directory, { recursive: true, force: true });
  });
  assert.notEqual(first.directory, second.directory);
  assert.equal(path.dirname(first.evidence), first.directory);
  assert.equal(path.dirname(first.screenshot), first.directory);
  assert.equal(fs.existsSync(first.evidence), false);
  assert.equal(fs.existsSync(first.screenshot), false);
});

test('PUT verification surfaces non-200 status and response body immediately', async () => {
  const ok = await assertSuccessfulResponse({
    status: () => 200,
    text: async () => '{"version":2}'
  }, 'family PUT');
  assert.deepEqual(ok, { status: 200, body: '{"version":2}' });
  await assert.rejects(
    () => assertSuccessfulResponse({
      status: () => 500,
      text: async () => '{"error":"write failed"}'
    }, 'family PUT'),
    /family PUT.*500.*write failed/i
  );
});

test('admin review proof requires exact review ID, family ID, and image count', () => {
  const payload = {
    reviews: [{ id: 'review-a', familyId: 'family-a', imageDataUrls: ['one', 'two'] }]
  };
  assert.deepEqual(verifyAdminReview(payload, 'family-a', 'review-a', 2), payload.reviews[0]);
  assert.throws(() => verifyAdminReview(payload, 'family-b', 'review-a', 2), /family-b|not returned/i);
  assert.throws(() => verifyAdminReview(payload, 'family-a', 'review-b', 2), /review-b|not returned/i);
  assert.throws(() => verifyAdminReview(payload, 'family-a', 'review-a', 1), /image/i);
});

test('dev proxy exports its narrow API and header policy without starting a server', () => {
  assert.equal(ALLOWED_API_PATHS.test('/api/openrouter'), true);
  assert.equal(ALLOWED_API_PATHS.test('/api/admin/recognition-reviews'), true);
  assert.equal(ALLOWED_API_PATHS.test('/api/admin/backups'), false);
  for (const header of [
    'content-type',
    'x-client-id',
    'x-family-id',
    'x-recognition-type',
    'x-review-consent'
  ]) {
    assert.equal(FORWARDED_HEADERS.includes(header), true, `missing forwarded header ${header}`);
  }
});

test('dev proxy forwards x-admin-token only to recognition review admin reads', () => {
  const requestHeaders = {
    'content-type': 'application/json',
    'x-client-id': 'client',
    'x-admin-token': 'admin-secret'
  };
  assert.deepEqual(getForwardedHeaders('/api/openrouter', requestHeaders), {
    'content-type': 'application/json',
    'x-client-id': 'client'
  });
  assert.deepEqual(getForwardedHeaders('/api/admin/recognition-reviews', requestHeaders), {
    'content-type': 'application/json',
    'x-client-id': 'client',
    'x-admin-token': 'admin-secret'
  });
});
