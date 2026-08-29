import { test, expect } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = 9876;

let server;
let serverUrl;

test.beforeAll(async () => {
  await new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url);
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath);
        const contentType = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.json': 'application/json',
          '.png': 'image/png',
          '.woff2': 'font/woff2',
          '.svg': 'image/svg+xml',
        }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', resolve);
  });
  serverUrl = 'http://127.0.0.1:' + PORT;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test.describe('HUD Layout Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(serverUrl);
    // page.goto waits for load by default; give fonts/layout extra settle time
    await page.waitForTimeout(2000);
  });

  test('desktop 1920x1080', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page).toHaveScreenshot({
      timeout: 60000,
      threshold: 0.4,
      maxDiffPixels: 25000,
    });
  });

  test('ultrawide 2560x1080', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1080 });
    await expect(page).toHaveScreenshot({
      timeout: 60000,
      threshold: 0.4,
      maxDiffPixels: 30000,
    });
  });

  test('laptop 1366x768', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(page).toHaveScreenshot({
      timeout: 60000,
      threshold: 0.5,
      maxDiffPixels: 35000,
    });
  });

  test('mobile 375x812', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page).toHaveScreenshot({
      timeout: 60000,
      threshold: 0.6,
      maxDiffPixels: 40000,
    });
  });
});
