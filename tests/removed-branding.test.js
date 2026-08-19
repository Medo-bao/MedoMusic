const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sourceRoot = path.join(__dirname, "..", "src");
const html = fs.readFileSync(path.join(sourceRoot, "index.html"), "utf8");
const css = fs.readFileSync(path.join(sourceRoot, "styles.css"), "utf8");

assert.doesNotMatch(html, /class=["'][^"']*\bapp-name\b/);
assert.doesNotMatch(html, /class=["'][^"']*\bgroove-logo\b/);
assert.doesNotMatch(css, /\.settings-view\s+\.app-name\b/);
assert.doesNotMatch(css, /\.groove-logo\b/);

console.log("Removed branding regression test passed");
