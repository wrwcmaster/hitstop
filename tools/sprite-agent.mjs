#!/usr/bin/env node

/**
 * Small CLI for the sprite editor's live collaboration bridge.
 * It intentionally speaks ordinary HTTP so any agent can use the same
 * revision/conflict contract without browser automation.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const base = (process.env.SPRITE_EDITOR_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const api = `${base}/__sprite-editor`;
const [command = 'help', ...args] = process.argv.slice(2);

async function request(route, init) {
  const response = await fetch(`${api}${route}`, init);
  const type = response.headers.get('content-type') ?? '';
  const body = type.includes('application/json') ? await response.json() : await response.arrayBuffer();
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'error' in body ? body.error : response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return body;
}

function jsonInit(method, body) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printStateSummary(value) {
  const { path: spritePath, revision, source, updatedAt, dirty } = value;
  print({ path: spritePath, revision, source, updatedAt, dirty });
}

async function state() {
  return request('/state');
}

switch (command) {
  case 'list':
    print(await request('/sprites'));
    break;

  case 'open': {
    const sprite = args[0];
    if (!sprite) throw new Error('usage: agent-sprite open <sprite-path>');
    printStateSummary(await request('/open', jsonInit('POST', {
      path: sprite,
      source: 'agent-sprite',
      force: args.includes('--force'),
    })));
    break;
  }

  case 'state':
    print(await state());
    break;

  case 'selection':
    print(await request('/selection'));
    break;

  case 'preview': {
    const destination = path.resolve(args[0] ?? 'sprite-preview.png');
    const bytes = await request('/preview.png');
    await fs.writeFile(destination, Buffer.from(bytes));
    console.log(destination);
    break;
  }

  case 'apply': {
    const sourceFile = args[0];
    if (!sourceFile) throw new Error('usage: agent-sprite apply <sprite.json> [repo-path]');
    const current = await state();
    const file = JSON.parse(await fs.readFile(path.resolve(sourceFile), 'utf8'));
    printStateSummary(await request('/state', jsonInit('PUT', {
      path: args[1] ?? current.path,
      file,
      baseRevision: current.revision,
      source: 'agent-sprite',
    })));
    break;
  }

  case 'save': {
    const current = await state();
    printStateSummary(await request('/save', jsonInit('POST', {
      path: args[0] ?? current.path,
      baseRevision: current.revision,
      source: 'agent-sprite',
    })));
    break;
  }

  case 'help':
  default:
    console.log(`hitstop sprite agent (${api})

usage:
  npm run agent-sprite -- list
  npm run agent-sprite -- open knight.json [--force]
  npm run agent-sprite -- state
  npm run agent-sprite -- selection
  npm run agent-sprite -- preview sprite-preview.png
  npm run agent-sprite -- apply edited.json [repo-path]
  npm run agent-sprite -- save [repo-path]

Set SPRITE_EDITOR_URL when Vite is not on http://127.0.0.1:5173.`);
}
