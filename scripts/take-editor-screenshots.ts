import { chromium } from 'playwright';
import * as path from 'path';

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
  await page.setViewportSize({ width: 1200, height: 800 });

  console.log('Navigating to sprite editor...');
  await page.goto('http://localhost:5173/tools/sprite-editor.html', { waitUntil: 'load' });
  await page.waitForTimeout(1000);

  // Take screenshot 1: slime
  console.log('Selecting slime...');
  await page.selectOption('#selectSprite', 'slime.json');
  await page.waitForTimeout(500);
  console.log('Taking slime screenshot...');
  const previewEl = await page.$('#preview');
  if (previewEl) {
    await previewEl.screenshot({ path: path.join(ARTIFACT_DIR, 'sprite_editor_slime_fixed.png') });
  } else {
    console.error('Preview element not found');
  }

  // Take screenshot 2: knight
  console.log('Selecting knight...');
  await page.selectOption('#selectSprite', 'knight.json');
  await page.waitForTimeout(500);
  console.log('Taking knight screenshot...');
  if (previewEl) {
    await previewEl.screenshot({ path: path.join(ARTIFACT_DIR, 'sprite_editor_knight_fixed.png') });
  } else {
    console.error('Preview element not found');
  }

  // Read and log the physical/hitbox field values
  const fieldValues = await page.evaluate(`(function() {
    function v(id) { var el = document.getElementById(id); return el ? el.value : 'N/A'; }
    return { physW: v('physW'), physH: v('physH'), boxX: v('boxX'), boxY: v('boxY'), boxW: v('boxW'), boxH: v('boxH') };
  })()`);
  console.log('Physical size:', fieldValues.physW, 'x', fieldValues.physH);
  console.log('Hitbox:', `(${fieldValues.boxX}, ${fieldValues.boxY}) ${fieldValues.boxW}x${fieldValues.boxH}`);

  // Scroll the right panel to show physical/hitbox fields
  await page.evaluate(`(function() {
    var rightPanel = document.querySelector('main > div:last-child');
    if (rightPanel) rightPanel.scrollTop = rightPanel.scrollHeight;
  })()`);
  await page.waitForTimeout(300);

  // Full page screenshot showing the physical/hitbox fields
  console.log('Taking full page screenshot...');
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'sprite_editor_full.png') });

  console.log('Closing browser...');
  await browser.close();
  console.log('Done!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
