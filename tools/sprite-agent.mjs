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
  const { path: spritePath, revision, source, updatedAt, dirty, cursor } = value;
  print({ path: spritePath, revision, source, updatedAt, dirty, cursor });
}

function printCommandSummary(value) {
  print({
    dryRun: value.dryRun,
    changed: value.changed,
    cursor: value.cursor,
    results: value.results,
    inspection: value.inspection,
    state: value.state && {
      path: value.state.path,
      revision: value.state.revision,
      source: value.state.source,
      updatedAt: value.state.updatedAt,
      dirty: value.state.dirty,
      cursor: value.state.cursor,
    },
  });
}

async function state() {
  return request('/state');
}

switch (command) {
  case 'list':
    print(await request('/sprites'));
    break;

  case 'capabilities':
    print(await request('/capabilities'));
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
    if (args.includes('--full')) print(await state());
    else printStateSummary(await state());
    break;

  case 'selection':
    print(await request('/selection'));
    break;

  case 'inspect': {
    const current = await state();
    const positional = args.filter((arg) => !arg.startsWith('--'));
    const animation = positional[0];
    const range = positional[1];
    const layerId = positional[2];
    let frames = [];
    if (animation) {
      const match = /^(\d+)(?:-(\d+))?$/.exec(range ?? '1');
      if (!match) throw new Error('frame range must look like 1 or 3-5 (displayed frame numbers are 1-based)');
      const start = Number(match[1]);
      const end = Number(match[2] ?? match[1]);
      if (start < 1 || end < start || end - start > 127) throw new Error('invalid frame range');
      frames = Array.from({ length: end - start + 1 }, (_, index) => ({
        animation,
        frame: start + index - 1,
        ...(layerId ? { layerId } : {}),
        components: !args.includes('--no-components'),
        colors: !args.includes('--no-colors'),
      }));
    }
    print(await request('/inspect', jsonInit('POST', { path: current.path, frames })));
    break;
  }

  case 'run': {
    const sourceFile = args.find((arg) => !arg.startsWith('--'));
    if (!sourceFile) throw new Error('usage: agent-sprite run <transaction.json> [--dry-run]');
    const transaction = JSON.parse(await fs.readFile(path.resolve(sourceFile), 'utf8'));
    const current = await state();
    const capabilities = await request('/capabilities');
    const body = Array.isArray(transaction) ? { commands: transaction } : transaction;
    const response = await request('/commands', jsonInit('POST', {
      ...body,
      protocolVersion: body.protocolVersion ?? capabilities.protocolVersion,
      dryRun: args.includes('--dry-run') || body.dryRun === true,
      includeFile: args.includes('--full'),
      baseRevision: current.revision,
      source: 'agent-sprite',
    }));
    if (args.includes('--full')) print(response);
    else printCommandSummary(response);
    break;
  }

  case 'preview': {
    const destination = path.resolve(args[0] ?? 'sprite-preview.png');
    const deadline = Date.now() + 3000;
    let bytes;
    while (!bytes) {
      try {
        bytes = await request('/preview.png');
      } catch (error) {
        if (Date.now() >= deadline || !/^Error: 404 /.test(String(error))) throw error;
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
    }
    await fs.writeFile(destination, Buffer.from(bytes));
    console.log(destination);
    break;
  }

  case 'comparison': {
    const destination = path.resolve(args[0] ?? 'sprite-comparison.png');
    const deadline = Date.now() + 3000;
    let bytes;
    while (!bytes) {
      try {
        bytes = await request('/comparison.png');
      } catch (error) {
        if (Date.now() >= deadline || !/^Error: 404 /.test(String(error))) throw error;
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
    }
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
  npm run agent-sprite -- capabilities
  npm run agent-sprite -- open knight-v2.json [--force]
  npm run agent-sprite -- state [--full]
  npm run agent-sprite -- selection
  npm run agent-sprite -- inspect [animation] [display-frame|range] [layer-id] [--no-colors] [--no-components]
  npm run agent-sprite -- run transaction.json [--dry-run] [--full]
  npm run agent-sprite -- preview sprite-preview.png
  npm run agent-sprite -- comparison sprite-comparison.png
  npm run agent-sprite -- apply edited.json [repo-path]
  npm run agent-sprite -- save [repo-path]

Command JSON uses zero-based frame indexes; inspect ranges use the editor's
one-based frame labels. Transactions are atomic and revision checked.

Set SPRITE_EDITOR_URL when Vite is not on http://127.0.0.1:5173.`);
}
