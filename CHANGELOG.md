# Changelog

All notable changes to dsh-whale-pet will be documented here. Format: [Keep a Changelog](https://keepachangelog.com/).

## [1.1.0] - 2026-09-06

### Changed
- **形象重制**：从 px-v42 像素画拆件换成 AI 生成的平滑动漫风拆件（13 零件方案和画布 `917×980` 不变）。
- 状态机、表情/动作 CSS keyframes、`/pet.html` 与 `/parts/*.png` 路由结构保持不变。

### Fixed
- `index.js` 呆毛 `transform-origin` 适配新形象：从 `39% 22.2%` 改为 `38.4% 16.3%`（preview 差分实测）。
- `parts/sweat.png` 重画为干净 SVG 实心泪滴（渐变蓝 + 描边 + 高光），去除早期水平条带拼接留下的内部空白段。

### Added
- `screenshots.json`（插件市场店面截图声明，按市场新规放在自己仓库）。
- `.github/workflows/release.yml`（tag `v*` 触发：npm Trusted Publishing 跳首版后自动出包 + GitHub Release 自动附 tgz）。
- `docs/hero.png`、`docs/states.png`、`docs/desktop-1/2/3.png`（README 引用 + 桌面实拍）。
- `AGENTS.md`（项目结构 / 关键机制 / 部署流水线 / 注意事项）。

### Docs
- `README.md`：全新——hero 大图 + 8 状态标注图、状态表、架构图、安装说明、支持平台（Windows / 需 WhaleHarbor 桌面壳）。
- 插件市场条目分支 `add-moonlitdropofblood-dsh-whale-pet` 描述改为准确说法（"AI 拆件 + CSS 纸片人"，去掉 v1.0.0 的像素画/零误差声明）。

## [1.0.0] - 2026-09-06

### Added
- 首版：**px-v42 像素画拆件 + CSS 纸片人动画**。原画切成 13 个零件（底座/睁闭眼/开心眼/XX 眼/6 种嘴/呆毛/汗滴），同一画布 `917×980`（顶垫 140 留给呆毛）。表情件按 mood class 切换透明度，容器 transform + CSS keyframes 驱动所有动作（呼吸、眨眼、呆毛摇摆、汗滴、蹦跳、抖动）。重组误差 0 像素。
- 8 种工作状态：空闲 A/B（呼吸/眨眼/呆毛）、忙碌（汗滴+波浪嘴+冒泡+实时统计气泡）、审批 `!`、提问 `?`、出错 XX 眼抖动+✕ 徽章、庆祝蹦跳+∩∩ 笑眼、打盹变暗 Zzz、子代理分身迷你鲸。
- 交互：戳一戳（压缩回弹+随机吐槽）、拖动、右键三档尺寸（小/中/大，重建浮窗）、托盘菜单显隐、悬停气泡。
- 事件服务器（`127.0.0.1`，OS 随机端口）：白名单路由 `/pet.html` 和 `/parts/*.png`，其余 404。
- 卸载/`ctx.effect` 清理：`float.window.closeAll` + 托盘分区清除 + 事件服务器关闭。

### Notes
- npm 包名 `@duke-dsh-plugins/dsh-whaleharbor-pet`（裸名 `dsh-whale-pet` 已被他人占用，仓库名 `MoonlitDropOfBlood/dsh-whale-pet` 是 brand vs npm 命名差异，故意不同）。
- 首版 npm 发布须本机 TTY（EOTP 静态 token 在非 TTY 下被锁），后续版本由 `release.yml` + Trusted Publishing 自动出。