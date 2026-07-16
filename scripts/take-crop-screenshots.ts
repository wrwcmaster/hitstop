/**
 * Take zoomed-in screenshots of the player character in different equipment states.
 * Uses Playwright with Edge browser.
 */
import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const ARTIFACT_DIR = 'C:\\Users\\scott\\.gemini\\antigravity\\brain\\6a49c145-d3a6-4cfa-ab9a-7220b5935ec2';

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));
  await page.setViewportSize({ width: 800, height: 600 });

  console.log('Navigating to game...');
  await page.goto('http://localhost:5173', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  // Start game
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  // Dismiss dialogues
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);

  // Enable cheats
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(200);

  // --- State 1: No Equipment (base body) ---
  console.log('State 1: No equipment...');
  await page.waitForTimeout(500);

  // Use page.evaluate to freeze the game and crop the player
  const crop1 = await page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) return null;
    // Get the canvas data
    const ctx = canvas.getContext('2d')!;
    // The player is roughly centered. Extract center region.
    const cw = canvas.width;
    const ch = canvas.height;
    // Player is at center-ish, roughly at x=400, y=380 in 800x600 viewport
    // Canvas is rendered at 1920x1080 internal, so scale factor is ~2.4x
    // Let's grab a 200x200 region around center
    const cropX = Math.floor(cw / 2) - 100;
    const cropY = Math.floor(ch * 0.6) - 120;
    const cropW = 200;
    const cropH = 240;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = cropW * 2;
    tempCanvas.height = cropH * 2;
    const tCtx = tempCanvas.getContext('2d')!;
    tCtx.imageSmoothingEnabled = false;
    tCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW * 2, cropH * 2);
    return tempCanvas.toDataURL('image/png');
  });

  if (crop1) {
    const buf1 = Buffer.from(crop1.split(',')[1], 'base64');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'crop_no_equip.png'), buf1);
    console.log('Saved crop_no_equip.png');
  }

  // --- State 2: Helmet only ---
  console.log('State 2: Helmet only...');
  await page.keyboard.press('9');
  await page.waitForTimeout(800);

  const crop2 = await page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d')!;
    const cw = canvas.width;
    const ch = canvas.height;
    const cropX = Math.floor(cw / 2) - 100;
    const cropY = Math.floor(ch * 0.6) - 120;
    const cropW = 200;
    const cropH = 240;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = cropW * 2;
    tempCanvas.height = cropH * 2;
    const tCtx = tempCanvas.getContext('2d')!;
    tCtx.imageSmoothingEnabled = false;
    tCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW * 2, cropH * 2);
    return tempCanvas.toDataURL('image/png');
  });

  if (crop2) {
    const buf2 = Buffer.from(crop2.split(',')[1], 'base64');

    fs.writeFileSync(path.join(ARTIFACT_DIR, 'crop_helmet.png'), buf2);
    console.log('Saved crop_helmet.png');
  }

  // --- State 3: Armor only ---
  console.log('State 3: Armor only...');
  await page.keyboard.press('9');
  await page.waitForTimeout(800);

  const crop3 = await page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d')!;
    const cw = canvas.width;
    const ch = canvas.height;
    const cropX = Math.floor(cw / 2) - 100;
    const cropY = Math.floor(ch * 0.6) - 120;
    const cropW = 200;
    const cropH = 240;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = cropW * 2;
    tempCanvas.height = cropH * 2;
    const tCtx = tempCanvas.getContext('2d')!;
    tCtx.imageSmoothingEnabled = false;
    tCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW * 2, cropH * 2);
    return tempCanvas.toDataURL('image/png');
  });

  if (crop3) {
    const buf3 = Buffer.from(crop3.split(',')[1], 'base64');

    fs.writeFileSync(path.join(ARTIFACT_DIR, 'crop_armor.png'), buf3);
    console.log('Saved crop_armor.png');
  }

  // --- State 4: Helmet + Armor ---
  console.log('State 4: Helmet + Armor...');
  await page.keyboard.press('9');
  await page.waitForTimeout(800);

  const crop4 = await page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d')!;
    const cw = canvas.width;
    const ch = canvas.height;
    const cropX = Math.floor(cw / 2) - 100;
    const cropY = Math.floor(ch * 0.6) - 120;
    const cropW = 200;
    const cropH = 240;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = cropW * 2;
    tempCanvas.height = cropH * 2;
    const tCtx = tempCanvas.getContext('2d')!;
    tCtx.imageSmoothingEnabled = false;
    tCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW * 2, cropH * 2);
    return tempCanvas.toDataURL('image/png');
  });

  if (crop4) {
    const buf4 = Buffer.from(crop4.split(',')[1], 'base64');

    fs.writeFileSync(path.join(ARTIFACT_DIR, 'crop_both.png'), buf4);
    console.log('Saved crop_both.png');
  }

  await browser.close();
  console.log('Done!');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
