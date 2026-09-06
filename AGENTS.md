# AGENTS.md — dsh-whale-pet

面向 AI agent 与协作者的开发指南。**读这里再动手**，尤其"关键机制"和"重要注意事项"。

## 项目是什么

DSH（DeepSeek Harness）**单面 Host 插件**：在 WhaleHarbor 桌面壳里渲染一只透明、置顶、不抢焦点的悬浮鲸娘桌宠，实时反映主 agent 的工作状态。

- 形象路线：**AI 生成拆件 + CSS 纸片人动画**。同一张原图切成 13 个零件（底座/睁闭眼/开心眼/XX 眼/6 种嘴/呆毛/汗滴），所有零件同画布 `917×980`（顶垫 140 留给呆毛），零件全透明叠放，动作 = 容器 transform + 表情件 class 驱动 CSS keyframes，60fps、缩放无损。**整体坐标 / 颜色风格随发布版本会变，但 13 件方案和画布尺寸不变**。
- 角色本体：蓝发女仆装鲸娘，带 DEEPTHINK 鲸鱼 logo 的围裙、弯曲鲸尾、问号卷呆毛。
- 入口在 WhaleHarbor 桌面壳的托盘菜单「显示/隐藏鲸娘」，右键菜单切小号/中号/大号（重建浮窗）。
- 状态机（**8 种**）：空闲 A/B、忙碌、审批等待、提问等待、出错、庆祝、打盹、子代理分身。气泡副栏实时统计本次开机工具调用数 / 累计忙碌分钟 / 被戳次数。

## 目录结构

```
dsh-whale-pet/
├── index.js               # Host 半：apply() 插件 + _buildPetPage() 测试钩子
├── parts/                 # 13 个 PNG 零件（同画布 917×980，顶垫 140）
├── cordis.patch.yml       # bundle patch（插入插件到 profile layer stack）
├── screenshots.json       # 插件市场店面截图声明（每张图相对路径）
├── docs/                  # README 引用：hero.png、states.png、desktop-1/2/3.png
├── .github/workflows/release.yml   # tag v* → OIDC npm publish + GitHub Release
├── package.json
├── README.md
├── LICENSE                # MIT，© dukebywwh
├── .gitignore
└── generated-test/        # 用户自己的零件生成/预览工具（dev artifact，不入库、不发布）
```

`generated-test/` 在 `.gitignore` 范围外但**不进 `files` 字段**——npm 包不会带它；git 操作时按需 `.gitignore` 或不入库。

## 关键机制

### 1. DSH 单面插件（Host only，纯函数形式）

```js
module.exports = {
  apply(ctx) {
    ctx.on("approval/request", (req, next) => { /* ... */ });
    ctx.on("tools/execute", (payload, next) => { /* ... */ });
    // ...
  },
};
module.exports._buildPetPage = buildPetPage; // 测试钩子：导出浮窗页面 HTML
```

`apply()` 里注册 Cordis 监听 → 聚合成 ≤2.5KB 状态快照 → 通过 RPC 桥推 WhaleHarbor 壳。**不是**类插件/Typepert 远程服务（与 dsh-git-manager 不同，那个是 Host+Client 双面）。

### 2. 状态派生

`tick()`（index.js）按以下优先级派生 mood：
```
approval > question > error(8s 窗口) > celebrate(6s after busy→idle) > busy > nap(>180s 空闲)
                └ 空闲状态：idle-a / idle-b 每 18s 随机轮换
```

`__setMood(m)` 测试钩子：开发/预览时可钉死 mood。

### 3. 页面渲染 = 零件堆叠 + CSS mood class

`buildPetPage()`（index.js）生成 `/pet.html`：
- 一个 `.char` 容器绝对定位（占满窗口高度），子元素是 13 个 `.part`（`p-base`、`p-ahoge`、`p-eyes-*`、`p-mouth-*`、`p-sweat`）。
- 每个零件：`background-image: url("parts/<name>.png"); position: absolute; inset: 0;`，眼睛/嘴/汗滴默认 opacity:0，按 `.mood-* .p-xxx { opacity:1 }` 切换。
- **眨眼帧**：闭眼件（`p-eyes-closed`）只是弧线（无皮肤底），`mood-* .p-eyes-open` 和 `.p-eyes-closed` 各有一组**同步**的 `blinkO/blinkC` keyframes，睁眼帧 opacity 0 ↔ 闭眼帧 opacity 1。
- 容器 transform 处理动作（bob / hop / tremble），呆毛用 `.p-ahoge` 自身 `transform-origin` 旋转。
- 表情件缺失时（打包漏发 parts/）自动退回占位鲸鱼 emoji。

### 4. 呆毛 transform-origin 必须匹配当前形象

- CSS：`.p-ahoge { transform-origin: 38.4% 16.3%; }`（基于 v1.1.0 AI 形象差分实测）
- 每次零件重制后：**先跑 preview 差分定新根**（`find-ahoge-root.js` 那类探针：预览 vs base 逐像素相减 → 呆毛 bbox → 根部 = 画布百分比），同步改 index.js 的 origin + 重生成 docs/hero.png、docs/states.png。

### 5. 事件服务器（路由 /pet.html 和 /parts/*.png）

```
eventServer (http.createServer)
  GET  /pet.html   → buildPetPage()
  GET  /parts/*.png → assetCache 中对应 PNG（启动时扫 parts/）
  其它                → 404
```

`assetCache` 在 `apply()` 启动时填，键是 `parts/<file>`。**白名单之外一律 404**——桥 4KB 上限，富内容走 url 自建通道。

### 6. 零件画布与零绘制假设

- 全部零件必须尺寸完全一致（`917×980`），不重叠偏移，靠绝对定位同位叠加。
- 改动任意一个零件的**风格**（像素 / 平滑 / 笔触）都会影响整套观感；**改动任意零件的画布尺寸会让整套错位**。
- 零件文件命名即语义：改名前先确认 index.js 的零件列表、CSS 的 `background-image` 引用、screenshots.json 都没硬编码旧名。

## 开发 / 验证

```bash
node --check index.js                          # 语法检查
node -e "require('./')._buildPetPage()"        # 输出浮窗页面（开发用）
node -e "console.log(typeof require('./').apply)"  # 确认 apply 是函数
# 预览（独立静态服务器 + 8 状态墙）：pwsh → shot-pet3.js
```

视觉验证（需要起桌面壳）：

```powershell
# 抓真实桌宠截图（直接 PrintWindow 桌宠窗口，2x 最近邻放大 + 换深蓝底）
node D:\ai-projects\dsh\.whale-pet-test\shot-pet3.js
# 输出到 dsh-whale-pet\docs\desktop-1/2/3.png
```

生成 README 引用图（hero / 8 状态标注网格）：

```bash
$env:XDG_CACHE_HOME = "D:\ai-projects\dsh\.fontcache"
node D:\ai-projects\dsh\.whale-pet-test\gen-docs.js
# 输出 .whale-pet-test\hero.png 和 states.png，手动 cp 到 dsh-whale-pet\docs\
```

改插件后**必须重启 DSH 核心**生效（桌面壳 Ctrl+Alt+R 或设置 → 核心 → 重启）。**光重启插件不够**——`eventServer` 启动时缓存 parts，浮窗创建时缓存 buildPetPage，重启核心才彻底换面。

## 部署流水线

### npm

- 包名固定为 `@duke-dsh-plugins/dsh-whaleharbor-pet`（裸名 `dsh-whale-pet` 已被他人占用，别再试）。
- `package.json` `"version"` 跟着提交递增（当前 1.1.0）。
- **首版发布必须本机 TTY 跑**：`npm publish --registry=https://registry.npmjs.org`（EOTP 静态 token 在非 TTY 下被锁；agent 代跑会 401）。
- 后续版本：仓库 GitHub Action `release.yml`（tag v* 触发）走 npm Trusted Publishing（OIDC，零 token）。需先在 npmjs.com 给包配置 Trusted Publisher（`MoonlitDropOfBlood/dsh-whale-pet`，workflow `.github/workflows/release.yml`）。
- 常用 npm 命令记得加 `--cache D:\ai-projects\dsh\.npm-cache --registry https://registry.npmjs.org/`（默认 cache 目录 EPERM；本机默认 registry 是 npmmirror，要显式切到 npmjs）。

### Git

- git 身份固定为 `duke <wwhbygx@sina.com>`（LICENSE 署名 `dukebywwh`，保持一致）。
- repo = `git@github.com:MoonlitDropOfBlood/dsh-whale-pet.git`（仓库名带 "dsh-" 前缀但**npm 包名带 "whaleharbor" 中段**，是 brand/产品 vs npm 命名差异，**故意如此**，别动）。
- **git push/pull 一律需要 danger-full-access 提权**——ssh 信号管道被沙箱拦，workspace-write 档不够；每次推送都必须带 justification。

### 插件市场（awesome-dsh-plugin）

- 在 `_awesome-dsh-plugin` 仓库的 fork 分支 `add-moonlitdropofblood-ddsh-whale-pet` 上提交，yml + 双语 README 重新生成后强推到 fork。
- **截图声明放自己仓库 `screenshots.json`**，条目 yml 不写截图字段——店面下一次构建自动读取，**换图不用再开市场 PR**。
- yml 描述必须**准确性硬规则**：写过的功能/数字/API 必须对着代码核实（维护者会读仓库）。**形象大改后必须改描述**（像素画 → AI 拆件这种）。
- 开 PR 前三前置：仓库满 1 天、≥10 commits、加 GitHub 仓库 topic `dsh-plugin`。
- 同类竞品（已有 2 个鲸鱼娘桌宠）的答辩点：AI 拆件纸片人 + Host 事件八态 + 气泡实时统计——和 Live2D/帧动画路线有结构性差异。

## 常规注意事项

- **形象大改必须同步 4 处**：（1）`index.js` 呆毛 transform-origin（preview 差分实测）；（2）`docs/hero.png`、`docs/states.png` 重生成；（3）`docs/desktop-1/2/3.png` 重抓实拍（桌宠重启后）；（4）市场 yml 描述改准确说法。少改一处就会出现"形像与文档不符"的硬错。
- **零件不要走"矩形补丁"方案**：v42 像素画早期用整矩形擦眼嘴再贴弧线，结果刘海/眉毛/皮肤渐变被遮——用户原话。眼睛剪影的正确做法在 `generated-test/` 里的用户工具里；如果接手的是这套新图就直接用；如果误退回旧方案要先在 preview 看到"矩形边缘盖住周围"再回滚。
- **不要用纯颜色分类切眼睛**：早期 px-v42 噪点多，虹膜底 `#82b2ec` 和发尖高光 `#86ade3` 同色误分，深虹膜和发阴同深蓝色——任何纯分类或纯洪泛都会出渣。如果必须回退到图像切割，**几何 + 切线**比颜色分类稳得多。
- **CSS 眨眼双帧同步**：闭眼件现在是纯透明弧线（为了不覆盖刘海/眉毛），所以眨眼帧必须睁眼 + 闭眼**同帧切换**——两个 keyframes 配对（`blinkAO/blinkAC`、`blinkBuO/blinkBuC` 等）。idle-b 视线平移和双眨合并进同一 8s 动画避免 transform 冲突。
- **screenshots.json 路径不能跳出插件目录**：相对路径不能以 `/` 开头、不能含 `..`。绝对 URL 仅接受 GitHub 托管（`raw.githubusercontent.com`、`user-images.githubusercontent.com` 等）——第三方图床会被拒。
- **缩放都用 nearest**：像素边就角清晰；lanczos 会糊。预览页和桌宠里都显式 `image-rendering: pixelated`。
- **dump-config 不能验证 boot manifest**：plugin load 失败（如 import 链炸了）会被 loader 静默剔除，**不报错**。装完任何 plugin 改动最好实测一次：起独立端口实例 → 抓 HTML 的 `__DSH_BOOT__` 看 bundle id 是否在。
- **浮窗被普通窗口盖住**：Windows 把永不激活的 NOACTIVATE 置顶窗降级（WS_EX_TOPMOST 位还在但 z-band 失效）。修复 = 周期性重发 `setAlwaysOnTop`，由 `dsh-desktop` 主进程加 2.5s 看门狗（main.js 源码）。**用户跑的是安装版，重打包才生效**——手动 `SetWindowPos` 只是临时。

## 关键不要做

- ❌ 直接编辑 `~/.dsh/profiles/web/cordis.yml`（生成文件，patch 覆盖在 `cordis.patch.yml`）。
- ❌ 把仓库名改成 `dsh-whaleharbor-pet` 之类——命名是 brand/产品 vs npm 的故意差异。
- ❌ 在 yml 描述里写没核对过的数字（如"46 个工具"）——维护者会读代码核对，夸大会被打回。
- ❌ 用 `git commit --allow-empty` 之类灌水凑 commit 数——市场 CI 数的是 commit，评审看的是仓库实质，空提交反而难看。