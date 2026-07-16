import { chromium } from 'playwright';
import * as path from 'path';

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true
  });
  
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));
  await page.setViewportSize({ width: 800, height: 600 });
  
  console.log('Navigating to game...');
  await page.goto('http://localhost:5173/hitstop.html');
  
  // Wait for the game to boot and title screen to display
  console.log('Waiting for title screen...');
  await page.waitForTimeout(2000);
  
  // Save title screen screenshot to check unequipped character look (hair)
  const titlePath = path.resolve('C:\\Users\\scott\\.gemini\\antigravity\\brain\\6a49c145-d3a6-4cfa-ab9a-7220b5935ec2\\title_screenshot.png');
  console.log(`Saving title screenshot to ${titlePath}...`);
  await page.screenshot({ path: titlePath });
  
  // Select "NEW GAME" (press Enter)
  console.log('Selecting NEW GAME...');
  await page.keyboard.press('Enter');
  
  // Wait for intro scene to load
  await page.waitForTimeout(2000);
  
  // Press Enter/Space a few times to skip dialogue/intro if any
  console.log('Dismissing intro...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  
  // Wait for test room to load and player to spawn
  console.log('Waiting for gameplay...');
  await page.waitForTimeout(2000);
  
  // Press '9' three times to cycle to BOTH Helmet and Armor
  console.log('Cycling equipment to Helmet & Armor...');
  await page.keyboard.press('Backquote'); // Enable cheats
  await page.waitForTimeout(200);
  await page.keyboard.press('9');
  await page.waitForTimeout(200);
  await page.keyboard.press('9');
  await page.waitForTimeout(200);
  await page.keyboard.press('9');
  await page.waitForTimeout(200);
  await page.keyboard.press('Backquote'); // Hide cheats legend for a clean screenshot
  await page.waitForTimeout(1000);
  
  // Take screenshot
  const screenshotPath = path.resolve('C:\\Users\\scott\\.gemini\\antigravity\\brain\\6a49c145-d3a6-4cfa-ab9a-7220b5935ec2\\gameplay_screenshot.png');
  console.log(`Saving screenshot to ${screenshotPath}...`);
  await page.screenshot({ path: screenshotPath });
  
  await browser.close();
  console.log('Done!');
}

main().catch(console.error);
