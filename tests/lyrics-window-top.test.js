const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const helper = source.match(/function keepLyricsWindowOnTop\([^]*?\n\}/)[0];
let visible = true;
let destroyed = false;
let reorderCount = 0;
const calls = [];
const window = {
  isDestroyed: () => destroyed,
  isVisible: () => visible,
  setAlwaysOnTop: (...args) => { calls.push(args); },
  moveTop: () => { reorderCount += 1; }
};
const context = vm.createContext({ lyricsWindow: window });
vm.runInContext(helper, context);
for (let i = 0; i < 20; i++) context.keepLyricsWindowOnTop();
assert.equal(calls.length, 20);
assert.equal(reorderCount, 20);
assert.ok(calls.every(args => args[0] === true && args[1] === "screen-saver"));
visible = false;
context.keepLyricsWindowOnTop();
assert.equal(reorderCount, 20);
destroyed = true;
context.keepLyricsWindowOnTop();
assert.equal(calls.length, 21);
console.log("Desktop lyrics topmost guard passed: forced reordering retained for visible windows");
