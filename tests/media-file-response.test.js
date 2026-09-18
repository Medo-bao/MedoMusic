const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createMediaFileResponse, parseSingleRange } = require("../src/media-file-response");

async function responseText(response) {
  return Buffer.from(await response.arrayBuffer()).toString();
}

async function run() {
  assert.deepEqual(parseSingleRange(null, 10), { start: 0, end: 9, partial: false });
  assert.deepEqual(parseSingleRange("bytes=2-", 10), { start: 2, end: 9, partial: true });
  assert.deepEqual(parseSingleRange("bytes=-3", 10), { start: 7, end: 9, partial: true });
  assert.equal(parseSingleRange("bytes=0-1,3-4", 10), null);

  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "medo-media-test-"));
  try {
    const file = path.join(temporary, "sample.mp3");
    await fs.writeFile(file, "0123456789");

    const full = await createMediaFileResponse(file, null);
    assert.equal(full.status, 200);
    assert.ok(full.body instanceof ReadableStream);
    assert.equal(full.headers.get("content-length"), "10");
    assert.equal(await responseText(full), "0123456789");

    const openEnded = await createMediaFileResponse(file, "bytes=4-");
    assert.equal(openEnded.status, 206);
    assert.equal(openEnded.headers.get("content-range"), "bytes 4-9/10");
    assert.equal(await responseText(openEnded), "456789");

    const suffix = await createMediaFileResponse(file, "bytes=-3");
    assert.equal(await responseText(suffix), "789");

    const invalid = await createMediaFileResponse(file, "bytes=20-");
    assert.equal(invalid.status, 416);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
  console.log("Media file response tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
