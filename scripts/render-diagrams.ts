import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

/** Render docs/*.mmd to SVG with the locally installed mermaid package inside headless Chromium. */
async function main() {
  const mermaidJs = fs.readFileSync(path.resolve("node_modules/mermaid/dist/mermaid.min.js"), "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: mermaidJs });
  await page.evaluate(() => (window as any).mermaid.initialize({ startOnLoad: false, theme: "neutral", flowchart: { htmlLabels: true, wrappingWidth: 240 } }));
  for (const name of ["components-map", "workflow-flowchart"]) {
    const src = fs.readFileSync(path.resolve(`docs/${name}.mmd`), "utf8");
    const raw = await page.evaluate(async ([id, code]) => (await (window as any).mermaid.render(id, code)).svg, [name.replace(/-/g, ""), src]);
    // Mermaid's HTML labels emit "<br>", which is invalid XML and breaks the SVG when loaded via <img>.
    // Give the root explicit dimensions from the viewBox so it sizes correctly as an image.
    const [, , vw, vh] = (raw.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 1200 800").split(/\s+/).map(Number);
    const svg = raw
      .replace(/<br\s*>/g, "<br/>")
      .replace(/^<svg([^>]*?)\swidth="100%"/, `<svg$1 width="${Math.ceil(vw)}" height="${Math.ceil(vh)}"`)
      .replace(/^(<svg[^>]*?)\sstyle="max-width:[^"]*"/, "$1");
    for (const out of [`docs/${name}.svg`, `public/diagrams/${name}.svg`]) fs.writeFileSync(path.resolve(out), svg);
    console.log(`rendered ${name}.svg (${svg.length} bytes)`);
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
