<p align="center">
  <img src="docs/banner.png" alt="Wallpeel — Unleash your Wallpaper Engine" width="100%">
</p>

<div align="center">

<img src="docs/logo.svg" alt="Wallpeel Logo" width="100">

# Wallpeel

**你的壁纸，不止于壁纸。**

Wallpaper Engine 壁纸资源提取工具。<br/>
自动识别、批量提取、轻松管理 — 让每一份创意都触手可及。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/XA-anjiu/wallpeel?style=flat)](https://github.com/XA-anjiu/wallpeel/stargazers)

[下载](#-快速开始) · [使用说明](#-使用说明) · [反馈问题](https://github.com/Zhenyu-Sun-86587/wallpeel/issues)

</div>

---

## Wallpeel 是什么？

Wallpeel 让你轻松提取 Wallpaper Engine 的壁纸资源。不管是视频壁纸还是场景壁纸，只需一键，就能把喜欢的素材保存到本地。

告别手动翻找文件夹的日子。Wallpeel 自动扫描 Steam 库，智能识别壁纸类型，批量提取视频、图片等资源。你的创意库，从此井井有条。

---

## ✨ 功能特性

- 🖼️ **导出静态壁纸** - 根据场景布局把图层合成为一张 PNG / JPG，也可手动合并已有散图
- 🎞️ **视频选帧** - 拖动视频选择多个时间点，按视频原始分辨率导出静态图片

- 🔍 **自动搜索** - 启动时自动检测 Steam 库中的 Wallpaper Engine 壁纸目录
- 📦 **PKG 提取** - 解包场景壁纸，提取纹理图片（TEX → PNG）
- 🎬 **MPKG 提取** - 解包视频壁纸，提取 MP4 视频文件
- 🖼️ **壁纸预览** - 网格展示所有壁纸，支持预览图加载
- 📁 **批量操作** - 多选壁纸，一键复制/提取
- 🌙 **暗色主题** - 支持亮色/暗色主题切换
- 🖱️ **右键菜单** - 快速查看详情、打开目录、复制预览图
- ⚙️ **全局设置** - 统一配置输出路径、自动清理等

---

## 📸 截图

<p align="center">
  <img src="docs/screenshot-main.png" alt="主界面 - 壁纸网格展示" width="100%">
</p>

<p align="center">
  <em>网格展示所有壁纸，一目了然</em>
</p>

<br/>

<p align="center">
  <img src="docs/screenshot-detail.png" alt="详情面板 - 资源信息" width="100%">
</p>

<p align="center">
  <em>详情面板显示资源信息，一键提取</em>
</p>

<br/>

<p align="center">
  <img src="docs/screenshot-dark.png" alt="暗色主题" width="100%">
</p>

<p align="center">
  <em>支持亮色/暗色主题切换，护眼更舒适</em>
</p>

---

## 🚀 快速开始

### 方式一：直接下载安装（推荐）

1. 前往 [Releases](https://github.com/Zhenyu-Sun-86587/wallpeel/releases) 下载最新安装包
2. 双击运行 `Wallpeel.Setup.0.2.1.x64.exe`
3. 按照提示完成安装

**系统要求：**
- Windows 10 1803+ 或 Windows 11
- .NET Framework 4.7.2（Windows 10/11 已预装）

### 方式二：从源码构建

#### 安装依赖

```bash
npm install
```

#### 开发模式

```bash
npm run dev
```

#### 构建生产版本

```bash
npm run build
```

#### 打包为安装程序

```bash
npm run dist
```

---

## 📁 项目结构

```
wallpeel/
├── electron/                # Electron 主进程
│   ├── main.cjs            # 主进程逻辑
│   └── preload.cjs         # 预加载脚本
├── src/                     # React 前端
│   ├── App.tsx             # 主组件
│   ├── lib/
│   │   ├── extractor.ts    # MPKG 解析器
│   │   └── repkg-wrapper.ts
│   └── index.css           # 样式
├── tools/
│   └── RePKG.exe           # PKG 解析工具
├── package.json
└── vite.config.ts
```

---

## 🛠️ 技术栈

- **前端**: React 19 + TypeScript + Tailwind CSS 4
- **桌面框架**: Electron
- **构建工具**: Vite
- **图标**: Lucide React
- **PKG 解析**: RePKG.exe (C#)
- **MPKG 解析**: Node.js 原生实现

---

## 📖 使用说明

### 导出整张静态壁纸（新增）

v0.2.1 会自动读取场景中已启用的透明度效果及其轮廓遮罩，按保存的透明度应用到图层；不会根据文件名猜测遮罩。人物仍有浅色边缘时，可在所选图层里开启「白边修复」，选择轻度或较强。此功能只修复暗色素材边缘的浅色污染，不收缩透明轮廓；白衣服、鞋子和发光描边可通过关闭修复保留。原始遮罩也可单独关闭对比。预览与正式导出使用相同处理。

点击顶部「导出静态壁纸」，或在壁纸详情中点击「合成整张 PNG / JPG」「选帧导出静态壁纸」。

1. **场景壁纸**：打开单张壁纸的文件夹或 PKG / MPKG。程序临时解包并读取场景布局，按保存的图层顺序、位置、缩放、旋转、透明度和父子关系合成基础图像。原包和原目录不会被修改。
2. **已经拆出的散图**：打开图片文件夹。没有场景布局时，默认只勾选最大的一张图片，其他图片保持原尺寸居中。勾选同一版本的图层，按从底到顶的顺序调整位置、缩放、旋转和透明度。日夜版本、遮罩、按钮不应全部勾选。
3. **视频壁纸**：打开视频，播放或拖动到喜欢的画面，点击「选取当前画面」；也可输入秒数，或均匀选取 5 帧。最多选择 24 个时间点，逐张保存。这里的“选帧”可以选择任意可解码画面，并不限于编码中的 I 帧。
4. 选择 PNG 无损或 JPG（默认质量 98），确认分辨率，再点击导出并选择保存目录。导出使用完整画布，不受窗口预览尺寸影响；文件使用唯一名称，保留已有文件。

**范围**：这是独立的 2D 静态合成，不需要运行 Wallpaper Engine。眼睛等骨骼图层会读取 MDLV0021/0023 模型保存的静态网格形状，避免把整张纹理直接拉伸造成五官错位；不播放骨骼动画。它不执行壁纸脚本，不完整还原粒子、3D、动态光效、特殊混合和多通道着色器；有此类内容时会在面板里列出提示。脚本控制的日夜版本使用文件保存值，可手动勾选切换。视频依赖 Electron 可解码的格式，推荐 MP4(H.264) / WebM；不支持的编码会明确报错。保持原始分辨率可以避免额外缩放损失，放大不会恢复原素材没有的细节。

开发验证：`npm run test:static` 检查新功能的场景引用、父子坐标、散图默认选择和包路径边界；`npm run build` 构建应用。`npm run pack` 打包到项目内的 `release/`。

实现思路参考 [RePKG](https://github.com/notscuffed/repkg) 的保留目录解包方式，以及 [linux-wallpaperengine 的场景解析](https://github.com/Almamu/linux-wallpaperengine/blob/main/src/WallpaperEngine/Data/Parsers/ObjectParser.cpp) 和 [图层变换](https://github.com/Almamu/linux-wallpaperengine/blob/main/src/WallpaperEngine/Render/Objects/CImage.cpp)。本功能使用基础 2D 合成，没有引入这些项目的渲染引擎。

### 1. 首次启动

应用会自动搜索 Steam 库中的 Wallpaper Engine 壁纸目录。如果没有找到，可以在设置中手动选择。

### 2. 浏览壁纸

所有壁纸会以网格形式展示，支持：
- 按类型过滤（视频/场景）
- 搜索壁纸名称或标签
- 预览图懒加载

### 3. 提取资源

**单个提取：**
1. 点击壁纸卡片，打开详情面板
2. 点击「开始提取」
3. 提取完成后查看结果

**批量提取：**
1. 点击「多选」进入多选模式
2. 勾选需要提取的壁纸
3. 点击「复制 MP4」或「提取 PKG」

### 4. MPKG 管理

对于从其他渠道下载的 MPKG 文件：
1. 点击「MPKG」按钮打开管理器
2. 选择 MPKG 文件所在目录
3. 点击「扫描」匹配本地壁纸
4. 选择文件后点击「解压并提取」

---

## ⚙️ 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| 壁纸目录 | Wallpaper Engine 创意工坊路径 | 自动搜索 |
| 输出路径 | 提取文件的复制目标 | 桌面/Wallpeel_Output |
| 标题字体 | 标题显示字体 | Lora |
| 删除冗余文件 | 解压后清理非媒体文件 | 关闭 |

---

## 🐛 已知问题

- GIF 预览图复制到剪贴板会变成静态图（系统限制）
- 部分壁纸可能缺少预览图

---

## 📄 许可证

MIT License

---

## 🙏 致谢

- [RePKG](https://github.com/notscuffed/repkg) - PKG 格式解析工具
- [unmpkg](https://github.com/aqnya/unmpkg) - MPKG 格式参考
