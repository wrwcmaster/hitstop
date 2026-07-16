import { chromium } from 'playwright';
import * as path from 'path';

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true
  });
  
  const page = await browser.newPage();
  await page.setViewportSize({ width: 800, height: 600 });
  
  console.log('Navigating to game...');
  await page.goto('http://localhost:5173/hitstop.html');
  await page.waitForTimeout(2000);
  
  console.log('Selecting NEW GAME...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  
  console.log('Dismissing intro...');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  
  console.log('Drawing marker on canvas...');
  await page.evaluate(() => {
    // Stop the game loop to freeze rendering
    (window as any).hitstop.loop.stop();
    
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Reset transform to identity matrix to draw in screen space
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    // Coordinates in the physical 1920x1080 canvas backing store
    const cx = 980;
    const cy = 685;
    
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 6;
    
    // Circle the helmet (head area)
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.stroke();
    
    // Draw arrow pointing to the helmet
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.moveTo(cx - 50, cy - 50);
    ctx.lineTo(cx - 15, cy - 15);
    ctx.lineTo(cx - 25, cy - 45);
    ctx.closePath();
    ctx.fill();
    
    // Draw line for arrow
    ctx.beginPath();
    ctx.moveTo(cx - 80, cy - 80);
    ctx.lineTo(cx - 30, cy - 30);
    ctx.stroke();
  });
  
  const screenshotPath = path.resolve('C:\\Users\\scott\\.gemini\\antigravity\\brain\\6a49c145-d3a6-4cfa-ab9a-7220b5935ec2\\marked_screenshot.png');
  console.log(`Saving marked screenshot to ${screenshotPath}...`);
  await page.screenshot({ path: screenshotPath });
  
  await browser.close();
  console.log('Done!');
}

main().catch(console.error);
