const assert = require("node:assert/strict");
const { createExtensionServer } = require("../src/myfirefly-extension");

async function request(endpoint, path, token, options = {}) {
  return fetch(`${endpoint}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

(async () => {
  const received = [];
  const server = createExtensionServer({
    token: "test-token",
    version: "1.5.0",
    dispatch: async (payload) => {
      received.push(payload);
      return payload;
    },
    nativeControl: async (action) => ({ action })
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  try {
    const unauthorized = await fetch(`${endpoint}/v1/health`);
    assert.equal(unauthorized.status, 401);

    const health = await request(endpoint, "/v1/health", "test-token");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).version, "1.5.0");

    const control = await request(endpoint, "/v1/control", "test-token", {
      method: "POST",
      body: JSON.stringify({ action: "set-volume", value: 0.4 })
    });
    assert.equal(control.status, 200);
    assert.equal(received.at(-1).command, "control");
    assert.equal(received.at(-1).value, 0.4);

    await request(endpoint, "/v1/playlists/My%20List", "test-token", {
      method: "PATCH",
      body: JSON.stringify({ newName: "Renamed" })
    });
    assert.equal(received.at(-1).name, "My List");

    const native = await request(endpoint, "/v1/native", "test-token", {
      method: "POST",
      body: JSON.stringify({ action: "show" })
    });
    assert.deepEqual((await native.json()).result, { action: "show" });
    console.log("myfirefly-extension tests passed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
