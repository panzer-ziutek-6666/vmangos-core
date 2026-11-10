import { statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { readConfigFile } from '../server/config.js';

// A separate server from the panel, not a route on it: the asset root can be
// tens of megabytes of PNGs the panel itself never needs to serve, and this
// tool is meant to run only while a human is looking at the contact sheet,
// not for the panel's whole lifetime.
//
// Security model: loopback only, one operator, and a root this repository's
// own extractor wrote. `..` traversal is refused by the static plugin either
// way, but the options are stated rather than left at their defaults -
// `dotfiles` defaults to 'allow', which would serve anything hidden that ends
// up under the root. A symlink inside the root is still followed; the root is
// trusted because the extractor is the only thing that writes it.
export function buildAssetServer({ root }) {
  // The plugin throws a raw registration error for a root that is missing or
  // is not a directory, naming its own option rather than the config key an
  // operator would have to change. The likeliest cause by far is running this
  // before extract-art.
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`assets.root is not a directory: ${root}. Run "npm run extract-art" first.`);
  }
  const app = Fastify({ logger: false });
  app.register(fastifyStatic, { root, prefix: '/', index: 'contact-sheet.html', dotfiles: 'deny' });
  return app;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const here = dirname(fileURLToPath(import.meta.url));
  const cfg = readConfigFile(join(here, '..', 'config.json'));
  if (!cfg.assets) {
    console.error('config.json needs an "assets" section. See config.example.json.');
    process.exit(1);
  }
  let app;
  try {
    app = buildAssetServer({ root: cfg.assets.root });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  await app.listen({ host: '127.0.0.1', port: cfg.assets.port });
  console.log(`contact sheet: http://127.0.0.1:${cfg.assets.port}/`);
}
