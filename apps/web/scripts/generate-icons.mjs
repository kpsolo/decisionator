import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Master Vector SVG (Badge Format)
const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <defs>
    <linearGradient id="deci-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#2563eb" />
      <stop offset="55%" stop-color="#4f46e5" />
      <stop offset="100%" stop-color="#7c3aed" />
    </linearGradient>
    <linearGradient id="deci-sheen" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.08" />
    </linearGradient>
  </defs>

  <!-- Squircle Base -->
  <rect width="64" height="64" rx="16" fill="url(#deci-bg)" />
  <rect width="64" height="64" rx="16" fill="url(#deci-sheen)" />

  <!-- D Monogram with Integrated Chevron Counter -->
  <path d="M15 11 C15 9.34 16.34 8 18 8 H32 C45.25 8 56 18.75 56 32 C56 45.25 45.25 56 32 56 H18 C16.34 56 15 54.66 15 53 V11 Z M22.5 17.5 H30 L43 32 L30 46.5 H22.5 L34.5 32 L22.5 17.5 Z" fill="#ffffff" fill-rule="evenodd" />

  <!-- Decision Apex Node -->
  <polygon points="43.5,32 48.5,28 53.5,32 48.5,36" fill="#38bdf8" />
</svg>`;

// Transparent Vector SVG (Pure Glyph Format)
const glyphSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <defs>
    <linearGradient id="deci-glyph-grad" x1="12" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="45%" stop-color="#2563eb" />
      <stop offset="100%" stop-color="#7c3aed" />
    </linearGradient>
  </defs>

  <!-- D Monogram with Integrated Chevron Counter -->
  <path d="M14 10 C14 8.34 15.34 7 17 7 H32 C45.8 7 57 18.2 57 32 C57 45.8 45.8 57 32 57 H17 C15.34 57 14 55.66 14 54 V10 Z M22 17 H29.5 L42.5 32 L29.5 47 H22 L34 32 L22 17 Z" fill="url(#deci-glyph-grad)" fill-rule="evenodd" />

  <!-- Decision Apex Node -->
  <polygon points="43.5,32 48.5,28 53.5,32 48.5,36" fill="#ffffff" />
</svg>`;

// Write SVGs
fs.writeFileSync(path.join(publicDir, 'favicon.svg'), badgeSvg);
fs.writeFileSync(path.join(publicDir, 'logo.svg'), badgeSvg);
fs.writeFileSync(path.join(publicDir, 'logo-glyph.svg'), glyphSvg);
console.log('SVGs written successfully');

// Rasterize PNGs with Playwright
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const sizes = [
    { name: 'favicon-32x32.png', size: 32 },
    { name: 'favicon.png', size: 32 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'icon-192.png', size: 192 },
    { name: 'icon-512.png', size: 512 },
  ];

  for (const { name, size } of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${size}px; height: ${size}px; overflow: hidden; background: transparent; }
    svg { width: ${size}px; height: ${size}px; display: block; }
  </style>
</head>
<body>
${badgeSvg}
</body>
</html>`);

    await page.screenshot({
      path: path.join(publicDir, name),
      omitBackground: true,
    });
    console.log(`Generated ${name} (${size}x${size})`);
  }

  await browser.close();
  console.log('All icons generated successfully!');
})();
