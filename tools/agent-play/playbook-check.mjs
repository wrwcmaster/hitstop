/**
 * Keep the playbook short enough that the next agent reads it.
 *
 *   npm run playbook
 *
 * A handover doc with no ceiling becomes a changelog: every agent
 * appends, nobody deletes, and by the tenth one it is cheaper to
 * rediscover a lesson than to find it. The cap is the whole mechanism —
 * it forces the question "is this worth more than the line it replaces",
 * which is the only thing that keeps the file worth loading.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 120;
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'PLAYBOOK.md');
const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
// A trailing newline is one empty element, not a line of content.
while (lines.length && lines[lines.length - 1] === '') lines.pop();

if (lines.length > LIMIT) {
  console.error(`PLAYBOOK.md is ${lines.length} lines, over the ${LIMIT}-line cap.`);
  console.error('Delete something. A lesson nobody reads is not a lesson.');
  process.exit(1);
}
console.log(`PLAYBOOK.md ${lines.length}/${LIMIT} lines`);
