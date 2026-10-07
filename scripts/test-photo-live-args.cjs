const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseImagePaths, requiresAdminToken } = require('./test-photo-live.cjs');

test('live smoke accepts one to three image paths', () => {
  assert.deepEqual(parseImagePaths(['/tmp/front.jpg']), ['/tmp/front.jpg']);
  assert.deepEqual(
    parseImagePaths(['/tmp/front.jpg', '/tmp/expiry.jpg']),
    ['/tmp/front.jpg', '/tmp/expiry.jpg']
  );
  assert.deepEqual(
    parseImagePaths(['/tmp/front.jpg', '/tmp/side.jpg', '/tmp/expiry.jpg']),
    ['/tmp/front.jpg', '/tmp/side.jpg', '/tmp/expiry.jpg']
  );
});

test('live smoke rejects zero or more than three image paths', () => {
  assert.throws(() => parseImagePaths([]), /1 to 3 image paths/i);
  assert.throws(
    () => parseImagePaths(['one.jpg', 'two.jpg', 'three.jpg', 'four.jpg']),
    /1 to 3 image paths/i
  );
});

test('preview and production URLs require an admin token', () => {
  assert.equal(requiresAdminToken('https://preview.example.test'), true);
  assert.equal(requiresAdminToken('https://pantry-mng.vercel.app'), true);
  assert.equal(requiresAdminToken('http://127.0.0.1:8031'), false);
  assert.equal(requiresAdminToken('http://localhost:8031'), false);
});

test('dev proxy forwards recognition metadata headers', () => {
  const source = fs.readFileSync(path.join(__dirname, 'dev-server.cjs'), 'utf8');
  for (const header of [
    'content-type',
    'x-client-id',
    'x-family-id',
    'x-recognition-type',
    'x-review-consent'
  ]) {
    assert.match(source, new RegExp(`['"]${header}['"]`), `missing forwarded header ${header}`);
  }
});
