# Medo Music

一个神秘的本地桌面音乐播放器，旨在完善重置Groove播放器
采用 Electron 技术栈独立实现。

## 1.5.0 · MyFirefly 扩展版本

`myfirefly-extension-v1.5.0` 分支可作为 MyFirefly 的本机音乐扩展程序运行，原有播放器功能保持不变。

- 仅在 `127.0.0.1` 随机端口提供 API，不接受局域网连接。
- 每次启动生成 256 位随机令牌，并通过 `%LOCALAPPDATA%\MyFirefly\extensions\medomusic.json` 向 MyFirefly 发布发现清单。
- 提供播放状态、音乐库、播放列表、收藏和本地歌曲的数据访问与修改能力。
- 提供打开、隐藏、最小化、播放、暂停、切歌、音量、静音、跳转进度、指定歌曲和播放模式控制。
- MedoMusic 渲染进程仍是音乐库数据的唯一写入者，避免外部程序直接修改 LocalStorage 导致覆盖或损坏。

开发运行：

```powershell
npm install
npm start
```

在当前 MyFirefly 开发工作区中，启动器会优先复用 `E:\Medo_music\.electron-dist\electron.exe`，避免重复保存一份 200MB 以上的 Electron 运行时。


