const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const API_VERSION = 1;
const MCP_PROTOCOL_VERSION = "2025-03-26";
const MAX_BODY_BYTES = 1024 * 1024;

const MCP_TOOLS = [
  { name: "medomusic_get_state", description: "Get the current MedoMusic playback and window state.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "medomusic_get_library", description: "Get tracks, playlists and favorites from the MedoMusic library.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "medomusic_control", description: "Control playback. Supported actions include play, pause, toggle, next, previous, set-volume, mute, seek, play-track and set-playback-mode.", inputSchema: { type: "object", required: ["action"], properties: { action: { type: "string" }, value: {}, trackId: { type: "string" }, mode: { type: "string" } }, additionalProperties: true } },
  { name: "medomusic_add_tracks", description: "Add local audio tracks to the MedoMusic library.", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" } }, tracks: { type: "array", items: { type: "object" } } }, additionalProperties: true } },
  { name: "medomusic_create_playlist", description: "Create a playlist.", inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" }, trackIds: { type: "array", items: { type: "string" } } }, additionalProperties: true } },
  { name: "medomusic_update_playlist", description: "Rename a playlist or update its tracks.", inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" }, newName: { type: "string" }, trackIds: { type: "array", items: { type: "string" } } }, additionalProperties: true } },
  { name: "medomusic_delete_playlist", description: "Delete a playlist.", inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } }, additionalProperties: false } },
  { name: "medomusic_set_favorite", description: "Add or remove a track from favorites.", inputSchema: { type: "object", required: ["trackId", "favorite"], properties: { trackId: { type: "string" }, favorite: { type: "boolean" } }, additionalProperties: false } },
  { name: "medomusic_window", description: "Control the native MedoMusic window.", inputSchema: { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["show", "hide", "minimize"] } }, additionalProperties: false } }
];

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

function mcpResult(result) {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result
  };
}

async function callMcpTool(name, args, dispatch, nativeControl) {
  const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const commands = {
    medomusic_get_state: "get-state",
    medomusic_get_library: "get-library",
    medomusic_control: "control",
    medomusic_add_tracks: "add-tracks",
    medomusic_create_playlist: "create-playlist",
    medomusic_update_playlist: "update-playlist",
    medomusic_delete_playlist: "delete-playlist",
    medomusic_set_favorite: "set-favorite"
  };
  if (name === "medomusic_window") return nativeControl(String(input.action || "show"));
  const command = commands[name];
  if (!command) throw new Error(`unknown-tool:${name}`);
  return dispatch({ ...input, command });
}

async function handleMcpRequest(body, { version, dispatch, nativeControl }) {
  const id = body?.id ?? null;
  const success = (result) => ({ jsonrpc: "2.0", id, result });
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return { status: 400, payload: { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } } };
  }
  if (body.method === "initialize") {
    return { status: 200, payload: success({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "medomusic", title: "MedoMusic", version }
    }) };
  }
  if (body.method === "notifications/initialized") return { status: 202, payload: null };
  if (body.method === "ping") return { status: 200, payload: success({}) };
  if (body.method === "tools/list") return { status: 200, payload: success({ tools: MCP_TOOLS }) };
  if (body.method === "tools/call") {
    try {
      const result = await callMcpTool(body.params?.name, body.params?.arguments, dispatch, nativeControl);
      return { status: 200, payload: success(mcpResult(result)) };
    } catch (error) {
      return { status: 200, payload: success({
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true
      }) };
    }
  }
  return { status: 404, payload: { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } } };
}

function createExtensionServer({ token, version, dispatch, nativeControl }) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (!authorized(request, token)) {
        sendJson(response, 401, { ok: false, error: "unauthorized" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/mcp") {
        const result = await handleMcpRequest(await readJson(request), { version, dispatch, nativeControl });
        if (result.payload === null) {
          response.writeHead(result.status, { "Cache-Control": "no-store" });
          response.end();
        } else {
          sendJson(response, result.status, result.payload);
        }
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
    protocols: {
      mcp: { transport: "streamable-http", endpoint: `${endpoint}/mcp`, protocolVersion: MCP_PROTOCOL_VERSION },
      rest: { endpoint: `${endpoint}/v1`, apiVersion: API_VERSION, deprecated: true }
    },
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

module.exports = { API_VERSION, MCP_PROTOCOL_VERSION, MCP_TOOLS, createExtensionServer, startMyFireflyExtension };
