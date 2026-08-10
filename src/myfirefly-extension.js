const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const API_VERSION = 1;
const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request-body-too-large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function authorized(request, token) {
  const value = String(request.headers.authorization || "");
  if (!value.startsWith("Bearer ")) return false;
  const received = Buffer.from(value.slice(7));
  const expected = Buffer.from(token);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function routeFor(method, pathname) {
  if (method === "GET" && pathname === "/v1/health") return { command: "health" };
  if (method === "GET" && pathname === "/v1/state") return { command: "get-state" };
  if (method === "GET" && pathname === "/v1/library") return { command: "get-library" };
  if (method === "POST" && pathname === "/v1/control") return { command: "control" };
  if (method === "POST" && pathname === "/v1/tracks") return { command: "add-tracks" };
  if (method === "POST" && pathname === "/v1/playlists") return { command: "create-playlist" };
  if (method === "POST" && pathname === "/v1/native") return { command: "native" };
  const favorite = pathname.match(/^\/v1\/favorites\/([^/]+)$/);
  if (method === "PUT" && favorite) return { command: "set-favorite", trackId: decodeURIComponent(favorite[1]) };
  const playlist = pathname.match(/^\/v1\/playlists\/([^/]+)$/);
  if (method === "PATCH" && playlist) return { command: "update-playlist", name: decodeURIComponent(playlist[1]) };
  if (method === "DELETE" && playlist) return { command: "delete-playlist", name: decodeURIComponent(playlist[1]) };
  return null;
}

function createExtensionServer({ token, version, dispatch, nativeControl }) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (!authorized(request, token)) {
        sendJson(response, 401, { ok: false, error: "unauthorized" });
        return;
      }
      const route = routeFor(request.method, url.pathname);
      if (!route) {
        sendJson(response, 404, { ok: false, error: "not-found" });
        return;
      }
      if (route.command === "health") {
        sendJson(response, 200, {
          ok: true,
          id: "medomusic",
          name: "MedoMusic",
          version,
          apiVersion: API_VERSION,
          capabilities: ["state", "library", "playback", "volume", "seek", "favorites", "playlists", "tracks", "window"]
        });
        return;
      }
      const body = ["GET", "DELETE"].includes(request.method) ? {} : await readJson(request);
      const payload = { ...body, ...route };
      const result = route.command === "native"
        ? await nativeControl(String(body.action || "show"))
        : await dispatch(payload);
      sendJson(response, 200, { ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === "request-body-too-large" ? 413 :
        message === "renderer-timeout" ? 504 : 400;
      sendJson(response, status, { ok: false, error: message });
    }
  });
}

async function startMyFireflyExtension({ app, dispatch, nativeControl }) {
  const token = crypto.randomBytes(32).toString("hex");
  const server = createExtensionServer({ token, version: app.getVersion(), dispatch, nativeControl });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}`;
  const root = process.env.LOCALAPPDATA || path.dirname(app.getPath("userData"));
  const manifestPath = path.join(root, "MyFirefly", "extensions", "medomusic.json");
  const manifest = {
    schemaVersion: 1,
    id: "medomusic",
    name: "MedoMusic",
    version: app.getVersion(),
    apiVersion: API_VERSION,
    endpoint,
    token,
    pid: process.pid,
    executable: app.getPath("exe"),
    updatedAt: new Date().toISOString()
  };
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return {
    endpoint,
    manifestPath,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      try {
        const current = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        if (current.pid === process.pid) await fs.rm(manifestPath, { force: true });
      } catch {}
    }
  };
}

module.exports = { API_VERSION, createExtensionServer, startMyFireflyExtension };
