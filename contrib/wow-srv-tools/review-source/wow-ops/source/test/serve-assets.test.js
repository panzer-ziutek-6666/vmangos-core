import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildAssetServer } from '../tools/serve-assets.js';

// A root with one real asset, one dotfile, and a secret one level above it -
// the file an escape would reach.
function withRoot(run) {
  const dir = mkdtempSync(join(tmpdir(), 'wow-ops-assets-'));
  const root = join(dir, 'root');
  mkdirSync(join(root, 'icons'), { recursive: true });
  writeFileSync(join(root, 'icons', 'a.png'), 'PNG');
  writeFileSync(join(root, 'contact-sheet.html'), '<h1>2 icons</h1>');
  writeFileSync(join(root, '.env'), 'SECRET=1');
  writeFileSync(join(dir, 'secret.txt'), 'SECRET');
  return run(root).finally(() => rmSync(dir, { recursive: true, force: true }));
}

async function withServer(run) {
  return withRoot(async (root) => {
    const app = buildAssetServer({ root });
    try {
      await app.ready();
      await run(app, root);
    } finally {
      await app.close();
    }
  });
}

test('a file inside the asset root is served', async () => {
  await withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/icons/a.png' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'PNG');
  });
});

test('the root URL lands on the contact sheet rather than a 404', async () => {
  await withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /2 icons/);
  });
});

// This is the property that would regress invisibly: the server is only ever
// run by hand on loopback, so nothing else would notice if a later change to
// the static options opened the enclosing directory.
test('a path escaping the asset root is refused', async () => {
  await withServer(async (app) => {
    const escapes = [
      '/../secret.txt',
      '/icons/../../secret.txt',
      '/%2e%2e/secret.txt',
      '/%2e%2e%2fsecret.txt',
      '/icons/%2e%2e%2f%2e%2e%2fsecret.txt',
      '/..%5csecret.txt'
    ];
    for (const url of escapes) {
      const res = await app.inject({ method: 'GET', url });
      assert.notEqual(res.statusCode, 200, url);
      assert.doesNotMatch(res.body, /SECRET/, url);
    }
  });
});

test('a dotfile in the asset root is not served', async () => {
  await withServer(async (app) => {
    const res = await app.inject({ method: 'GET', url: '/.env' });
    assert.notEqual(res.statusCode, 200);
  });
});

test('a missing asset root is reported by name rather than as a stack trace', () => {
  assert.throws(
    () => buildAssetServer({ root: join(tmpdir(), 'wow-ops-no-such-root') }),
    /assets\.root/
  );
});

// A path that exists but is a file gets the same raw registration error out
// of the plugin, so it needs the same sentence.
test('an asset root that is a file rather than a directory is reported too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wow-ops-assets-'));
  const path = join(dir, 'not-a-directory');
  try {
    writeFileSync(path, 'x');
    assert.throws(() => buildAssetServer({ root: path }), /assets\.root/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
