import * as fs from 'fs';
import * as path from 'path';

const htmlPath = path.resolve('dist-single/index.html');
const content = fs.readFileSync(htmlPath, 'utf8');

console.log('File size:', content.length);
console.log('Contains RUSTY SWORD:', content.includes('RUSTY SWORD'));
console.log('Contains IRON HELMET V5:', content.includes('IRON HELMET V5'));
console.log('Contains IRON HELMET (without V5):', content.includes('IRON HELMET') && !content.includes('IRON HELMET V5'));
