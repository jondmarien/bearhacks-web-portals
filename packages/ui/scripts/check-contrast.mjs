#!/usr/bin/env node
/**
 * Contrast audit for packages/ui/src/tokens.css.
 *
 * Reads :root and :root.dark palettes, resolves CSS var() references, then
 * checks every semantic fg/bg pair against:
 *   - WCAG 2.x contrast ratio (4.5:1 body, 3:1 large/UI).
 *   - APCA Lc (>=75 body, >=60 UI label, >=45 large).
 *
 * Exits non-zero if any required pair misses its target, which makes this
 * safe to wire into `bun run lint` or CI later.
 *
 * No deps: implements both algorithms inline.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tokensPath = resolve(here, "../src/tokens.css");
const source = readFileSync(tokensPath, "utf8");

/** Parse `:root { ... }` and `:root.dark { ... }` blocks into plain objects. */
function parseBlock(selector) {
  // `:root.dark` appears literally in the file; `:root` is the first block.
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\n\\}`,
    "m",
  );
  const match = source.match(re);
  if (!match) throw new Error(`Could not find ${selector} block in tokens.css`);
  const vars = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (!m) continue;
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

const light = parseBlock(":root");
const dark = { ...light, ...parseBlock(":root.dark") }; // dark inherits then overrides

/**
 * Convert a raw token value into an {r,g,b,a} object. Supports:
 *   #rgb / #rrggbb
 *   rgba(r,g,b,a) / rgb(r,g,b)
 *   var(--token) (recursive)
 */
function resolveColor(value, scope, seen = new Set()) {
  let v = value.trim();
  const varMatch = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (varMatch) {
    if (seen.has(varMatch[1])) return null;
    seen.add(varMatch[1]);
    return resolveColor(scope[varMatch[1]] ?? "", scope, seen);
  }
  if (v.startsWith("#")) {
    const hex = v.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    if (full.length !== 6) return null;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return { r, g, b, a: 1 };
  }
  const rgba = v.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i,
  );
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] !== undefined ? Number(rgba[4]) : 1,
    };
  }
  return null;
}

/** WCAG 2.x relative luminance. */
function wcagLuminance({ r, g, b }) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function wcagRatio(fg, bg) {
  const L1 = wcagLuminance(fg);
  const L2 = wcagLuminance(bg);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * APCA — Accessible Perceptual Contrast Algorithm (SAPC-8, W3 version for WCAG 3).
 * Implementation adapted from the public APCA 0.1.9 pseudo-code (BSD). Returns
 * a signed Lc score; callers take Math.abs().
 */
function apcaLc(fg, bg) {
  const sRGBtoY = ({ r, g, b }) => {
    const simpleExp = (c) => ((c / 255) ** 2.4);
    return (
      simpleExp(r) * 0.2126729 +
      simpleExp(g) * 0.7151522 +
      simpleExp(b) * 0.072175
    );
  };
  const mainTRC = 2.4;
  const normBG = 0.56;
  const normTXT = 0.57;
  const revTXT = 0.62;
  const revBG = 0.65;
  const blkThrs = 0.022;
  const blkClmp = 1.414;
  const scaleBoW = 1.14;
  const scaleWoB = 1.14;
  const loBoWoffset = 0.027;
  const loWoBoffset = 0.027;
  const deltaYmin = 0.0005;
  const loClip = 0.1;

  let Ytxt = sRGBtoY(fg);
  let Ybg = sRGBtoY(bg);
  if (Ytxt < blkThrs) Ytxt += (blkThrs - Ytxt) ** blkClmp;
  if (Ybg < blkThrs) Ybg += (blkThrs - Ybg) ** blkClmp;
  if (Math.abs(Ybg - Ytxt) < deltaYmin) return 0;

  let SAPC = 0;
  let outputContrast = 0;
  if (Ybg > Ytxt) {
    SAPC = (Ybg ** normBG - Ytxt ** normTXT) * scaleBoW;
    outputContrast = SAPC < loClip ? 0 : SAPC - loBoWoffset;
  } else {
    SAPC = (Ybg ** revBG - Ytxt ** revTXT) * scaleWoB;
    outputContrast = SAPC > -loClip ? 0 : SAPC + loWoBoffset;
  }
  return outputContrast * 100;
}

/** Scenarios we care about — keep this focused on pairs we actually render. */
const pairs = [
  // Body text on every surface
  { fg: "--bearhacks-fg", bg: "--bearhacks-bg", role: "body" },
  { fg: "--bearhacks-fg", bg: "--bearhacks-surface", role: "body" },
  { fg: "--bearhacks-fg", bg: "--bearhacks-surface-raised", role: "body" },
  { fg: "--bearhacks-fg", bg: "--bearhacks-surface-sunken", role: "body" },
  { fg: "--bearhacks-fg", bg: "--bearhacks-surface-alt", role: "body" },

  // Secondary / muted copy
  { fg: "--bearhacks-muted", bg: "--bearhacks-bg", role: "body" },
  { fg: "--bearhacks-muted", bg: "--bearhacks-surface", role: "body" },
  { fg: "--bearhacks-on-surface-muted", bg: "--bearhacks-surface", role: "body" },
  { fg: "--bearhacks-on-surface-muted", bg: "--bearhacks-surface-raised", role: "body" },

  // Headings
  { fg: "--bearhacks-title", bg: "--bearhacks-surface", role: "large" },
  { fg: "--bearhacks-title", bg: "--bearhacks-surface-raised", role: "large" },
  { fg: "--bearhacks-title", bg: "--bearhacks-bg", role: "large" },

  // Links (small text over any surface)
  { fg: "--bearhacks-link", bg: "--bearhacks-surface", role: "body" },
  { fg: "--bearhacks-link", bg: "--bearhacks-surface-raised", role: "body" },
  { fg: "--bearhacks-link", bg: "--bearhacks-bg", role: "body" },

  // Primary button label on primary fill
  { fg: "--bearhacks-on-primary", bg: "--bearhacks-primary", role: "ui-label" },
  { fg: "--bearhacks-on-primary", bg: "--bearhacks-primary-hover", role: "ui-label" },

  // Secondary button (text = primary, bg = accent)
  { fg: "--bearhacks-primary", bg: "--bearhacks-accent", role: "ui-label" },
  { fg: "--bearhacks-primary", bg: "--bearhacks-accent-soft", role: "ui-label" },

  // Header text — small tracking-wide labels on primary fill
  { fg: "--bearhacks-accent-soft", bg: "--bearhacks-primary", role: "body" },

  // Danger — error text on surfaces + destructive button fill
  { fg: "--bearhacks-danger", bg: "--bearhacks-surface", role: "body" },
  { fg: "--bearhacks-danger", bg: "--bearhacks-surface-raised", role: "body" },
  { fg: "--bearhacks-danger", bg: "--bearhacks-bg", role: "body" },
  { fg: "--bearhacks-on-danger", bg: "--bearhacks-danger-fill", role: "ui-label" },

  // Banner trios
  { fg: "--bearhacks-warning-fg", bg: "--bearhacks-warning-bg", role: "body" },
  { fg: "--bearhacks-success-fg", bg: "--bearhacks-success-bg", role: "body" },
  { fg: "--bearhacks-info-fg", bg: "--bearhacks-info-bg", role: "body" },
  { fg: "--bearhacks-danger", bg: "--bearhacks-danger-soft", role: "body" },

  // Banner borders are decorative framing (not interactive UI controls), so
  // WCAG 1.4.11 does not require 3:1. Intentionally omitted from the audit.

  // Non-text contrast (borders / focus ring vs every nearby surface) — role "ui"
  // Focus ring is only evaluated on bg/surfaces because :focus-visible sets
  // outline-offset: 2px, so the ring renders in the gap *outside* the focused
  // element (i.e. on the surrounding surface), not directly on the fill.
  { fg: "--bearhacks-border-strong", bg: "--bearhacks-surface", role: "ui" },
  { fg: "--bearhacks-border-strong", bg: "--bearhacks-surface-raised", role: "ui" },
  { fg: "--bearhacks-border-strong", bg: "--bearhacks-bg", role: "ui" },
  { fg: "--bearhacks-focus-ring", bg: "--bearhacks-surface", role: "ui" },
  { fg: "--bearhacks-focus-ring", bg: "--bearhacks-surface-raised", role: "ui" },
  { fg: "--bearhacks-focus-ring", bg: "--bearhacks-bg", role: "ui" },
];

/**
 * Each role declares the required contrast floor (hard fail) and an
 * aspirational APCA target (soft warn). User brief is "WCAG AA everywhere
 * + APCA Lc >=75 for body text", so body gates on both; other roles gate on
 * WCAG only and surface APCA as informational.
 */
const targets = {
  body: { wcag: 4.5, apca: 75, apcaHard: true },
  large: { wcag: 3.0, apca: 60, apcaHard: false },
  "ui-label": { wcag: 4.5, apca: 60, apcaHard: false },
  ui: { wcag: 3.0, apca: 45, apcaHard: false },
};

function evalPair(scope, pair) {
  const fg = resolveColor(scope[pair.fg] ?? "", scope);
  const bg = resolveColor(scope[pair.bg] ?? "", scope);
  if (!fg || !bg) {
    return {
      ...pair,
      wcag: null,
      apca: null,
      pass: false,
      note: "unresolved color",
    };
  }
  const wcag = wcagRatio(fg, bg);
  const apca = Math.abs(apcaLc(fg, bg));
  const { wcag: wcagMin, apca: apcaMin, apcaHard } = targets[pair.role];
  const wcagPass = wcag >= wcagMin;
  const apcaPass = apca >= apcaMin;
  const hardPass = wcagPass && (apcaHard ? apcaPass : true);
  return {
    ...pair,
    wcag,
    apca,
    wcagMin,
    apcaMin,
    wcagPass,
    apcaPass,
    hardPass,
    pass: wcagPass && apcaPass,
  };
}

function printReport(theme, scope) {
  console.log(`\n== ${theme} ==`);
  const rows = pairs.map((p) => evalPair(scope, p));
  const colW = Math.max(...rows.map((r) => `${r.fg} on ${r.bg}`.length));
  for (const r of rows) {
    const name = `${r.fg} on ${r.bg}`.padEnd(colW);
    const wcag = r.wcag === null ? "  n/a " : r.wcag.toFixed(2).padStart(5) + ":1";
    const apca = r.apca === null ? "  n/a" : `Lc ${r.apca.toFixed(1).padStart(5)}`;
    const role = r.role.padEnd(8);
    const status = r.hardPass
      ? r.pass
        ? "PASS"
        : "APCA-WARN"
      : !r.wcagPass
        ? "WCAG-FAIL"
        : "APCA-FAIL";
    console.log(`  ${status.padEnd(10)} ${role} ${name}  ${wcag}  ${apca}`);
  }
  return rows;
}

const lightRows = printReport("light", light);
const darkRows = printReport("dark", dark);

const all = [...lightRows, ...darkRows];
const hardFailures = all.filter((r) => !r.hardPass);
const softWarnings = all.filter((r) => r.hardPass && !r.pass);

if (softWarnings.length > 0) {
  console.log(`\n${softWarnings.length} APCA-only warning(s) (WCAG passes).`);
}
if (hardFailures.length > 0) {
  console.log(`\n${hardFailures.length} hard failure(s): WCAG AA or body-APCA below target.`);
  process.exit(1);
}
console.log("\nAll required pairs meet WCAG 2.x AA (and APCA Lc >=75 for body text).");
