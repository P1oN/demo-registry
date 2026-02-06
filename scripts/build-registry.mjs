import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const INPUT_MD = path.join(ROOT, "registry.md");
const OUT_DIR = path.join(ROOT, "dist");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function sha256hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function tsvEscape(s) {
  return String(s ?? "")
    .replaceAll("\t", " ")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

function parseMarkdownTable(mdText) {
  const lines = mdText.split(/\r?\n/);

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("|") && line.includes("|")) {
      if (i + 1 < lines.length && lines[i + 1].trim().startsWith("|")) {
        start = i;
        break;
      }
    }
  }
  if (start === -1) throw new Error("No markdown table found in registry.md");

  const headerLine = lines[start].trim();
  const delimLine = lines[start + 1].trim();
  if (!delimLine.includes("---"))
    throw new Error("Markdown delimiter line not found after header");

  const headers = headerLine
    .split("|")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

  const rows = [];
  for (let i = start + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) break;

    const cells = line
      .split("|")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);

    if (cells.length === 0) continue;
    while (cells.length < headers.length) cells.push("");

    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = cells[c] ?? "";
    rows.push(row);
  }

  return { headers, rows };
}

function validateRows(rows) {
  const required = ["slug", "title", "url", "tags"];
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    for (const k of required) {
      if (!(k in r)) errors.push(`Row ${i + 1}: missing column "${k}"`);
    }

    const slug = String(r.slug ?? "").trim();
    const title = String(r.title ?? "").trim();
    const url = String(r.url ?? "").trim();

    if (!slug) errors.push(`Row ${i + 1}: empty slug`);
    if (/\s/.test(slug))
      errors.push(`Row ${i + 1}: slug has whitespace: "${slug}"`);
    if (!title) errors.push(`Row ${i + 1}: empty title`);
    if (!url) errors.push(`Row ${i + 1}: empty url`);
    if (url && !isHttpUrl(url))
      errors.push(`Row ${i + 1}: url is not http(s): "${url}"`);
  }

  const seen = new Map();
  for (let i = 0; i < rows.length; i++) {
    const slug = String(rows[i].slug ?? "").trim();
    if (!slug) continue;
    if (seen.has(slug))
      errors.push(
        `Duplicate slug "${slug}" at rows ${seen.get(slug)} and ${i + 1}`,
      );
    else seen.set(slug, i + 1);
  }

  if (errors.length) {
    throw new Error(
      `Registry validation failed:\n${errors.map((e) => `- ${e}`).join("\n")}`,
    );
  }
}

function buildTSVBody(rows) {
  const header = ["slug", "title", "url", "tags"].join("\t");
  const lines = [header];

  for (const r of rows) {
    const slug = tsvEscape(String(r.slug ?? "").trim());
    const title = tsvEscape(String(r.title ?? "").trim());
    const url = tsvEscape(String(r.url ?? "").trim());
    const tags = tsvEscape(
      String(r.tags ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .join(","),
    );
    lines.push([slug, title, url, tags].join("\t"));
  }

  return lines.join("\n") + "\n";
}

function main() {
  ensureDir(OUT_DIR);

  const md = fs.readFileSync(INPUT_MD, "utf8");
  const { rows } = parseMarkdownTable(md);
  validateRows(rows);

  const body = buildTSVBody(rows);

  // version is hash of BODY only (stable if meta changes)
  const version = sha256hex(Buffer.from(body, "utf8")).slice(0, 16);

  const meta = `#v=${version}\n`;

  const full = meta + body;
  const fullBuf = Buffer.from(full, "utf8");

  const hashedName = `registry.${version}.tsv`;

  fs.writeFileSync(path.join(OUT_DIR, "registry.tsv"), fullBuf);
  fs.writeFileSync(path.join(OUT_DIR, hashedName), fullBuf);

  console.log(`Built ${rows.length} entries`);
  console.log(`version: ${version}`);
  console.log(`dist/registry.tsv`);
  console.log(`dist/${hashedName}`);
}

main();
