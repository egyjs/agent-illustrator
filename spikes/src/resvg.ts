import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const fontPath = (file: string): string =>
  fileURLToPath(new URL(`../../packages/engine/assets/fonts/${file}`, import.meta.url));

/** Bundled fonts only: rendering never depends on what the host machine has installed. */
export const FONT = {
  fontFiles: [fontPath('Tajawal-Regular.ttf'), fontPath('Tajawal-Bold.ttf')],
  loadSystemFonts: false,
  defaultFontFamily: 'Tajawal',
};

export function svgDoc(body: string, width = 400, height = 120): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
  );
}

export function textSvg(content: string, attrs = ''): string {
  return svgDoc(`<text x="10" y="70" font-family="Tajawal" font-size="40" ${attrs}>${content}</text>`);
}

export function bbox(svg: string) {
  return new Resvg(svg, { font: FONT }).getBBox();
}

export function renderPng(svg: string): Buffer {
  return new Resvg(svg, { font: FONT }).render().asPng();
}

export function inkPixels(svg: string): number {
  const { pixels } = new Resvg(svg, { font: FONT }).render();
  let count = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) count++;
  return count;
}

const OUT_DIR = fileURLToPath(new URL('../out/', import.meta.url));

/** Writes spikes/out/<name>.png for human review (gitignored). */
export function savePng(name: string, svg: string): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${name}.png`), renderPng(svg));
}
