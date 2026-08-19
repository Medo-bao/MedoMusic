# Medo Music

一个神秘的本地桌面音乐播放器，旨在完善重置Groove播放器
采用 Electron 技术栈独立实现。

## Agent 通用控制（MCP）

MedoMusic 启动后会在本机提供符合 Model Context Protocol（MCP）的
Streamable HTTP 接口。任何支持 MCP Streamable HTTP 的 Agent 或自动化程序都可以使用，
不依赖特定 AI 客户端。

### 发现连接信息

服务只监听 `127.0.0.1`，端口由系统在每次启动时动态分配。客户端不应写死端口，
而应读取以下发现文件：

```text
%LOCALAPPDATA%\MyFirefly\extensions\medomusic.json
```

发现文件包含 MCP 地址、兼容 REST 地址、Bearer Token、进程 ID 和应用版本，例如：

```json
{
  "schemaVersion": 1,
  "id": "medomusic",
  "version": "1.5.1",
  "protocols": {
    "mcp": {
      "transport": "streamable-http",
      "endpoint": "http://127.0.0.1:49152/mcp",
      "protocolVersion": "2025-03-26"
    }
  },
  "token": "每次启动随机生成的令牌"
}
```

应用退出时会清理属于当前进程的发现文件。Agent 应在连接前重新读取该文件，
并可通过其中的 `pid` 判断服务是否仍然有效。

### 连接与鉴权

向 `protocols.mcp.endpoint` 发送 HTTP `POST` 请求，并在每个请求中携带：

```http
Authorization: Bearer <发现文件中的 token>
Content-Type: application/json
```

初始化请求示例：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": { "name": "my-agent", "version": "1.0.0" }
  }
}
```

当前支持 `initialize`、`notifications/initialized`、`ping`、`tools/list` 和
`tools/call`。建议 Agent 在连接后先调用 `tools/list`，以运行时返回的工具描述为准。

### 可用工具

- `medomusic_get_state`：读取当前歌曲、播放状态、音量、进度和窗口状态。
- `medomusic_get_library`：读取本地曲库、歌单与收藏。
- `medomusic_control`：播放、暂停、切歌、跳转进度、调节音量和切换播放模式。
- `medomusic_add_tracks`：向曲库添加本地音频文件。
- `medomusic_create_playlist`：创建歌单。
- `medomusic_update_playlist`：重命名歌单或更新歌单曲目。
- `medomusic_delete_playlist`：删除歌单。
- `medomusic_set_favorite`：添加或取消收藏。
- `medomusic_window`：显示、隐藏或最小化主窗口。

工具调用示例：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "medomusic_control",
    "arguments": { "action": "toggle" }
  }
}
```

### 安全说明

- 服务仅绑定本机回环地址，不接受局域网或互联网连接。
- 每次启动都会生成新的 256 位随机令牌，旧令牌不会继续有效。
- 不要上传、记录或向其他进程公开发现文件中的 Token。
- Agent 对歌单、收藏和曲库的修改最终仍由 MedoMusic 渲染进程执行，避免直接修改应用数据。
- `/v1` REST 路由只作为旧客户端兼容层保留，新接入应优先使用 MCP。
