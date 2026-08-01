# Medo Music

一个隐私优先的本地桌面音乐播放器，界面与实现参考了
[Myune Music](https://github.com/xiaobaimc/myune_music)，但采用 Electron 技术栈独立实现。

## 当前功能

- 导入单个或多个音频文件
- 递归扫描音乐文件夹
- 播放、暂停、上一首、下一首
- 进度与音量控制
- 随机播放、单曲循环
- 搜索曲目与文件夹
- 收藏曲目
- 自动保存本地音乐库
- 系统媒体快捷控制
- 读取 Groove / Zune `.zpl` 播放列表（UTF-8、UTF-16、绝对和相对路径）
- 使用 Groove 解包材料中的图标字体、缺省专辑封面与经典布局
- 读取 MP3、FLAC、M4A 等音频的内嵌封面、歌曲名、歌手与专辑信息

## 启动

```powershell
npm install
npm start
```

## 导出 Windows 软件

```powershell
npm run dist
```

安装程序与免安装版将输出到 `release` 文件夹。

## 后续规划

1. 读取 ID3 / Vorbis 元数据与专辑封面
2. 本地 LRC 歌词与逐字歌词
3. 自定义歌单和播放队列
4. ReplayGain、均衡器和输出设备选择
5. Windows 安装包与自动更新
