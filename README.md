# 北京环球度假区 · 打卡标注地图

从官网 `universalbeijingresort.com/zh_CN/map` 抓取的园区地图瓦片 + 官方点位数据，
做成**前后端一体**的打卡标注工具：规划拍照机位、落点标注、记录拍摄要点、跟踪打卡进度。

**打卡点与照片存在服务端，所有访问者共享** —— 你标注的点位，别人打开链接就能看到；
只有登录管理员可以增删改。地图瓦片与官方点位数据仍在本地，因此浏览不需要外网。

技术栈：**React 19 + Mantine 9 + Vite + TypeScript**（前端）·
**Express 5 + SQLite（`node:sqlite`）**（服务端）

## 快速开始

```bash
npm run setup     # 安装前后端依赖
npm run build     # 构建前端到 server/public
npm start         # 启动服务端
```

浏览器打开 **http://localhost:8787** 即可。

开发时用 `npm run dev`：并行启动服务端与 Vite dev server，前端热更新，
`/api` 与 `/photos` 自动代理到服务端。

**初始管理员口令默认是 `ubr2024`，首次部署请务必修改**（启动日志会提示，
登录后也可在管理后台改）。可用 `UBR_ADMIN_PASSWORD` 环境变量指定初始口令。

界面以**移动端优先**设计，配色为**天蓝色系**（主色 `#1f9ef5`，色相约 204°，中性色偏冷）：
打开即见地图，窄屏是底部抽屉。普通访客即为**只读浏览**；要标注、上传照片、导入导出，走管理员入口。

## 角色与权限

| | 普通访客 | 管理员 |
|---|---|---|
| 浏览地图、查看点位与详情 | ✓ | ✓ |
| 搜索、分类筛选、展开收起 | ✓ | ✓ |
| 添加 / 编辑 / 删除打卡点 | — | ✓ |
| 上传实拍照片 | — | ✓ |
| 标记「完成打卡」 | — | ✓ |
| 导入 / 导出 JSON | — | ✓ |

**进入管理员**：地址栏直接访问 `/admin`（界面上不放置入口，避免普通访客误入）。

```
默认口令：ubr2024
```

登录后可在管理页改口令。会话存在 `sessionStorage`，关掉标签页即失效。

关于安全性：口令由**服务端**用 scrypt 加盐校验，浏览器只保存登录凭证（Bearer token），
写接口一律要求管理员身份。所以这次改造之后，权限是**接口层面强制**的，
不再是"客户端藏起按钮"那种约定 —— 未登录者即使直接调 API 也会被拒（返回 401）。

会话默认 7 天，且是滑动过期（一直在用就不会掉线）。改口令会让其它设备的登录立即失效。

## 功能

**地图浏览**
- 四级缩放（z16 全景 → z19 建筑细节），官方原图瓦片，WebP 无损存档
- **所有点位一律显示官方缩略图**，尺寸随缩放变化（z16 20px → z19 34px）
- 「名称」按钮切换为"缩略图 + 名称"胶囊模式
- 底图色调切换：暖调 / 夜览 / 原色；一键回园区全景
- 工具栏单行布局，管理员态的「添加打卡点」在最右侧

**面板与抽屉（Mantine 原生 Drawer）**
- 列表、详情、编辑三态共用一个 Mantine `Drawer`，移动端自底部升起并**横向铺满**、宽屏贴右侧
- **不使用 Drawer 的 header**：三种状态都关掉（`withCloseButton={false}` + 不传 `title`），
  避免内容上方多出一条 60px 白边
- **不使用遮罩，改用 iOS 风格的抓取条**：抽屉顶部一个灰色小横条，向下拖拽即关闭。
  这样抽屉展开时地图仍可交互 —— 能直接点其他点位切换详情，不必先关抽屉
- 关闭方式：抓取条下拉 / ESC / 内容区内的收起按钮
- **不做层叠导航**：从列表点进详情时会收起列表，关闭（点空白 / 关闭按钮 / ESC）一次性全收
- **抽屉的「开合」与「内容」是两个独立状态**，内容在退场动画结束后才清空，
  因此关闭时是「详情卡片自己滑下去」，不会先闪一下列表
- **遮罩透明而非移除**：Mantine 的「点击外部关闭」挂在 overlay 的 `onClick` 上，
  用 `withOverlay={false}` 会把点击接收者一起拆掉，导致点空白不收起。
  正解是保留 overlay、只把视觉归零（`overlayProps={{ backgroundOpacity: 0, blur: 0 }}`），
  于是既不压暗地图（能看清点位），点击空白又能正常收起
- **代价**：透明 overlay 仍是 `position:fixed; inset:0; pointer-events:auto` 的全屏层，
  抽屉打开时点地图等于"点空白"（收起抽屉），而不是选中该点位。想选中就先收起抽屉。
  这是模态抽屉的标准行为——要能点外部关闭，那个外部层就必然要接收点击
- 详情贴合内容高度（约 25% 屏高），不会盖住地图上的点位
- 抽屉默认收起、打开即见地图；点图钉或列表项后详情升起，缩略图（120px）在左、文字在右、外链在右上角
- **卡片升起时地图会自动平移**，把点位挪到卡片上方的可视区，不会出现"点完看不到自己点的是哪儿"
- 拖把手或点把手在半屏 ↔ 全屏间切换；关闭后可从右下角「点位列表」按钮重新展开
- 宽屏下自动变为右侧 380px 固定面板（不占垂直空间，无需平移）

**官方点位（127 条，可落点 126）**
- 六个分类：玩乐 17 / 餐饮 50 / 演出 24 / 商店 21 / 酒店 2 / 活动 13
- **分类标签是 tab 式单选**：直接用 Mantine 的 `Badge`（`component="button"`）做可点标签，
  左侧色点用 `leftSection`、数量用 `rightSection`，省掉一整套自定义样式
- **"浏览范围"与"地图显隐"彻底解耦**：切标签只换列表，不会连带把其他系列从地图上关掉
- 显隐由工具栏第四个图标（眼睛）上的 **Popover** 负责，按系列开关，互不干扰
- 关键词搜索（名称 / 园区 / 标签）
- 详情含缩略图、所属园区与标签；官网链接是标题右侧的小图标按钮，不单独占位
- **点击缩略图可查看大图**：缩略图只有 120px，而官方点位原图 360×360、实拍照片 1600px，
  放大看细节很常用
- **大图下方显示完整描述**：详情里的描述被 `line-clamp` 截断到 3 行，大图里给出全文，超出可滚动
- **图片尺寸由弹窗可用宽度和视口高度共同约束**（`max-width` / `max-height` + `object-fit: contain`），不做固定尺寸、
  也不裁剪。想放大看细节用浏览器原生手势（触控板双指、浏览器缩放）——
  比自己实现一套缩放更可靠，也不会有手势冲突

**打卡点（与官方点位并列在分类 tag 中）**
- 分类栏最后一个 tag 是「我的打卡」，与六个官方分类同级，不再另开独立区块
- **地图显示管理按实际打卡类型分别开关**，包括自定义类型，并显示各类型点位数；多类型点位只要任一所属类型开启就显示，全部关闭才隐藏。开关不影响列表和路线编号。
- 点「添加打卡点」→ 点地图任意位置落点
- 字段：名称、**类型（可多选、可自定义）**、拍摄优先级（1–5 星）、备注（时段、机位朝向、焦段、排队情况…）
- **类型用 TagsInput 输入**：预设了必拍机位 / 建筑外观 / 美食 / 演出 / 路线 / 角色合影 / 夜景 / 其他，
  也可直接敲入自己的标签（如「日出蓝调」「三脚架位」）。第一个是「主类型」，决定地图上的配色；
  最多 6 个标签，重复会自动去掉
- 自定义标签的配色由标签文本哈希稳定生成 —— 同一标签在任何设备上颜色一致，相邻点位之间也有区分度
- **地图标记按类型分两种形态**：
  - **「路线」类型 → 序号图钉**。序号表达走访顺序，是这个类型存在的意义；
    其余类型不显示序号（全局递增的编号对它们没有信息量）
  - 普通类型 → **立标小卡片**：缩略图 + 名称 + 类型标签。卡片刻意做得比官方点位标记更醒目
    （118×48 对 20×20，带类型色左边条与底部指向尖角），一眼能从官方点位里区分出来。
    缩略图优先用实拍照片；由官网点位转来、还没传照片的，回落到官方 64×64 小图
- **类型标签直接印在卡片上**（如「美食 · 自创类型」），不再统一显示成「我的打卡」
- **路线序号按路线自身从 1 编号**，不受其它类型影响。存储用的 `seq` 是所有打卡点
  共用的一套全局序号，直接显示会出现"只有一个路线点却显示 7"
- 落点后地图上出现**可拖动的橙色圆环**，保存后的图钉也能**直接拖拽**改位置
- 已完成项在列表置灰划线，标记转为绿色
- **自定义打卡点可直接删除**：详情页与列表行各有一个删除按钮，走 Popover 二次确认；
  删除时连同服务端的照片文件一起清理（官方点位数据不可删）

**实拍照片（管理员）**
- 两种方式添加：点投放区选文件，或**直接粘贴截图**（桌面端截图后 Ctrl/⌘ + V 即可）
- 粘贴监听挂在 `document` 上，不需要先点中某个元素 —— 截图后的心智是"随手粘一下"。
  仅在剪贴板确实含图片时拦截，纯文本粘贴照常放行（否则会影响备注输入）
- **浏览器端先压缩**：等比缩到长边 1600px，再编码为 WebP（q0.82），
  通常可压到原体积的 5%–10%，然后上传到服务端
- 服务端会校验文件魔数（不信任客户端给的 content-type），只接受 WebP / JPEG / PNG
- 列表行显示缩略图，详情页大图预览，表单里会显示压缩前后体积
- 照片与点位一样是**共享的**，别人也能看到实拍图

**数据持久化**
- 打卡点与照片都存在服务端（SQLite + 磁盘），所有访问者共享
- 前端每 20 秒轮询一次（页面重新聚焦时也会立即刷新），别人标注的改动会自动出现
- 管理页可导出 JSON 备份（可选是否内嵌照片 base64），导入按 id 去重合并
- 删除打卡点会连同服务端照片文件一起清理

## 目录结构

```
ubr-map/
├── server/                    服务端
│   ├── index.mjs              Express 应用：API + 静态资源
│   ├── db.mjs                 SQLite 持久层（node:sqlite）
│   ├── auth.mjs               scrypt 口令 + Bearer 会话
│   ├── public/                前端构建产物（npm run build 生成）
│   ├── var/                   运行时数据：ubr.db + uploads/（备份就是拷这个目录）
│   └── .env.example           配置项说明
├── tiles/{z}/{x}-{y}-{z}.webp  地图瓦片（WebP 无损，z16–z19）
├── data/
│   ├── pois.json              清洗后的官方点位
│   └── img/
│       ├── {nid}.jpg          点位详情缩略图（360×360）
│       └── marker/{nid}.webp  地图标记小图（64×64，189KB/127 张）
├── app/                       React 工程
│   ├── src/
│   │   ├── App.tsx            路由分发、权限门控、状态编排
│   │   ├── constants.ts       坐标、分类、瓦片路径
│   │   ├── theme.ts           Mantine 天蓝主题
│   │   ├── styles.css         地图、标记、抽屉样式
│   │   ├── types.ts
│   │   ├── data/pois.json     由 tools/build_pois.py 同步
│   │   ├── lib/
│   │   │   ├── api.ts             API 客户端（含 token 管理）
│   │   │   ├── checkins.ts        路线序号编号 + 标记缩略图解析
│   │   │   ├── legacy.ts          旧本地数据读取与迁移
│   │   │   ├── idb.ts             仅迁移时用于读旧照片
│   │   │   └── image.ts           压缩 + WebP 编码 + base64 互转
│   │   ├── hooks/
│   │   │   ├── useCheckins.ts     打卡点状态（服务端 + 轮询）
│   │   │   ├── useAdmin.ts        管理员会话（服务端校验）
│   │   │   ├── useRoute.ts        / 与 /admin 路由
│   │   └── components/
│   │       ├── MapCanvas.tsx      Leaflet 集成与图层同步
│   │       ├── CategoryTabs.tsx   分类标签（Mantine Badge，tab 式单选）
│   │       ├── ConfirmPopover.tsx  二次确认气泡（替代 window.confirm）
│   │       ├── SheetGrabber.tsx    iOS 风格抓取条（下拉关闭，地图保持可交互）
│   │       ├── VisibilityPopover.tsx 显示管理 Popover（按系列开关地图显隐）
│   │       ├── SpotSheet.tsx      点位/打卡点详情
│   │       ├── SpotList.tsx       统一列表
│   │       ├── SpotEditor.tsx     编辑表单（含照片上传）
│   │       ├── AdminGate.tsx      管理员登录
│   │       └── AdminPanel.tsx     管理后台
│   ├── vite.config.ts         构建到 server/public；dev 时代理 /api 与 /photos
│   └── package.json
├── scripts/dev.mjs            并行启动前后端（npm run dev）
└── tools/                     ← 开发工具与存档，不参与运行
    ├── README.md              工具说明与避坑记录
    ├── download_tiles.sh      瓦片抓取（xargs 并发调度）
    ├── fetch_tile.sh          单片抓取 worker
    ├── to_webp.py             PNG → WebP 无损转换 + 全量逐像素校验
    ├── build_pois.py          API → pois.json（含坐标校验）
    ├── fetch_images.py        缩略图本地化（末尾自动串跑 build_markers.py）
    ├── build_markers.py       生成 64×64 地图标记图
    ├── verify-react.mjs       CDP 自检（渲染/权限/建点/压缩/抽屉）
    ├── api/                   官网接口原始响应存档
    ├── raw/                   逆向分析存档（官网页面与打包 JS）
    └── tmp/                   抓取中间文件
```

`tiles/` 与 `data/` 留在根目录，由服务端以 `/tiles`、`/data` 路径托管，并设置了长缓存。

## 开发与构建

```bash
npm run setup    # 安装 server/ 与 app/ 的依赖
npm run dev      # 并行启动服务端(8787) + Vite dev server(5173)
npm run build    # 构建前端 → server/public
npm start        # 生产启动（只跑服务端，托管构建产物）
npm run verify   # 端到端自检（会自动拉起服务端）
```

Vite 把 `/api` 与 `/photos` 代理到服务端，所以开发时只访问 Vite 端口即可，
前端改动有热更新、服务端改动由 `node --watch` 自动重启。

构建产物输出到 `server/public`（`outDir: '../server/public'`——注意 Vite 的
`outDir` 是相对 `root`（即 `app/`）解析的，写 `server/public` 会落到 `app/server/public`）。
不再内联成单文件：走 HTTP 后按文件名 hash 缓存更划算，也不必每次重传 800KB。

**开发模式的资源路径是个坑，配置里已经处理。** Vite 的 root 是 `app/`，
而 `tiles/`、`data/` 在仓库根目录（与 `app/` 同级）。dev server 只会去找
`app/tiles`、`app/data`，找不到就落到 SPA fallback —— 于是 `/data/img/x.jpg`
会返回 **200 + `text/html`**（其实是 `index.html`），`<img>` 解码失败，
地图瓦片同理，表现为「图片和地图都加载不出来」。

所以 `vite.config.ts` 里注册了 `serveSharedAssets()` 插件：在 Vite 内建中间件
**之前**拦截 `/tiles/**` 与 `/data/**`，直接从根目录读盘返回，并带上正确的
`Content-Type`。它只在 `apply: 'serve'` 下生效，不影响构建产物。

若新增其它根目录级静态资源目录，在插件的正则里补上即可：

```ts
const m = /^\/(tiles|data)\/(.+)$/.exec(url)   // ← 在这里加目录名
```

## Docker 部署

最省事的方式：直接用 compose 拉取镜像启动（镜像里已包含前端产物、地图瓦片与官方点位数据）。

```bash
cp .env.example .env      # 可选：改端口与初始口令
docker compose up -d
```

浏览器打开 **http://localhost:8787**。

镜像地址：`ghcr.io/chouhx/travel:latest`，由 GitHub Actions 在 push 到 `main` 时自动构建推送。

**首次使用请先改口令**：编辑 `.env` 里的 `UBR_ADMIN_PASSWORD` 再启动。该值只在数据卷里
还没有口令时生效，之后请登录管理后台修改。容器默认只监听 `127.0.0.1`，配合反向代理对外
服务；若确需直接暴露，把 `UBR_BIND` 设为 `0.0.0.0` 并**务必同时改掉口令**。

### 从源码构建

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

构建出的是 `ubr-map:local`，与拉取的镜像共用同一个数据卷，两种方式可随时切换。

### 数据与备份

打卡点数据库与上传的照片存在具名卷 `ubr-data` 里（容器内挂到 `/data`），
**容器重建或升级镜像都不会丢**。备份就是备份这个卷：

```bash
# 备份
docker run --rm -v ubr-map_ubr-data:/d -v "$PWD":/backup alpine \
  tar czf /backup/ubr-backup.tar.gz -C /d .

# 恢复
docker run --rm -v ubr-map_ubr-data:/d -v "$PWD":/backup alpine \
  sh -c "tar xzf /backup/ubr-backup.tar.gz -C /d"
```

### 单独更新地图瓦片

瓦片与点位数据已打进镜像，但也可以用卷覆盖 —— 这样更新瓦片不必重建镜像。
把 `docker-compose.yml` 里 `volumes` 下对应两行的注释去掉即可：

```yaml
- ./tiles:/app/tiles:ro
- ./data:/app/data:ro
```

### 镜像说明

多阶段构建（Node 24 Alpine）。`node:sqlite` 在 musl 上实测可用，
因此不需要编译原生扩展，也没有 `node-gyp` 环节。基础镜像选 Alpine 是为了体积；
另外构建时逐项用 `COPY --chown` 指定属主，而不是最后统一 `chown -R` —— 后者会递归
改写 `/app` 下所有文件，等于把整份内容再复制一层（实测多出 139MB）。

## 服务端

### API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 公开 | 健康检查、点位总数、是否仍用初始口令 |
| POST | `/api/auth/login` | 公开 | 口令换 token |
| GET | `/api/auth/me` | 公开 | 查询当前 token 是否有效 |
| POST | `/api/auth/logout` | 管理员 | 注销当前 token |
| POST | `/api/auth/password` | 管理员 | 改口令，并踢掉其它设备的会话 |
| GET | `/api/checkins` | **公开** | 列出全部打卡点（这就是"别人能看到"的接口） |
| POST | `/api/checkins` | 管理员 | 新建 |
| PATCH | `/api/checkins/:id` | 管理员 | 局部更新 |
| DELETE | `/api/checkins/:id` | 管理员 | 删除（含照片文件） |
| DELETE | `/api/checkins` | 管理员 | 清空全部 |
| POST | `/api/checkins/import` | 管理员 | 批量导入，按 id 去重 |
| PUT | `/api/checkins/:id/photo` | 管理员 | 上传照片（请求体直接是图片二进制） |
| DELETE | `/api/checkins/:id/photo` | 管理员 | 删除照片 |

写接口一律校验 `Authorization: Bearer <token>`，未登录返回 401。

照片上传刻意不用 multipart：**直接以图片二进制作为请求体**，省掉解析依赖，
服务端也能更严格地按魔数校验类型（伪造的 content-type 会被 415 拒掉）。

### 配置

复制 `server/.env.example` 为 `.env`，或直接 export 环境变量。全部有默认值：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | 监听地址 |
| `UBR_ADMIN_PASSWORD` | `ubr2024` | **仅首次启动**写入数据库，之后改这里不生效 |
| `UBR_SESSION_TTL_HOURS` | `168` | 登录有效期（滑动过期） |
| `UBR_MAX_PHOTO_MB` | `8` | 单张照片上限 |
| `UBR_DATA_DIR` | `server/var` | 数据库与照片目录 |
| `UBR_PUBLIC_DIR` | `server/public` | 前端产物目录 |
| `UBR_CORS_ORIGIN` | 空 | 需要跨域时填来源；同源部署留空 |

Docker 部署另有 `.env`（见 `.env.example` 根目录那份）：`UBR_PORT`、`UBR_BIND`
控制端口映射与绑定地址。

### 部署

单机部署只需要 Node ≥ 22.5（`node:sqlite` 是内置的，不用编译原生模块）：

```bash
npm run setup && npm run build
UBR_ADMIN_PASSWORD='换成你的口令' PORT=8787 npm start
```

反代到 HTTPS 时：本项目用 Bearer token 而非 Cookie，所以不需要处理 CSRF，
但要确保反代不缓存 `/api` 响应。

## 从旧版本迁移

早期版本是纯离线单文件应用，打卡点存在浏览器 `localStorage`、照片存在 `IndexedDB`。
改造后这些数据不会再被自动读取，但**不会丢失**：

用管理员登录后进入 `/admin`，若检测到本机仍有旧数据，页面顶部会出现
「发现本机旧标注」卡片，点「上传到服务端」即可全部迁移（含照片）。
迁移按 id 去重，重复点击不会产生副本；确认无误后可点「丢弃本机数据」清理。

## 重新抓取 / 更新瓦片

```bash
./tools/download_tiles.sh              # 抓 PNG 中间格式（默认并发 20）
python3 tools/to_webp.py --replace     # 转 WebP 无损（含全量逐像素校验）
```

三个必须知道的坑，脚本里都已处理：

**并发不能开高。** 官方瓦片服务对高并发敏感，会静默丢片。现用 20 并发 + 每片 3 次重试。

**校验必须查完整性，不能只查文件是否存在。** 下载中断会留下 **PNG 头正确但数据截断**
的文件（缺 IEND 块），它通过了「存在 + 大小 + 文件头」的检查，浏览器却能解码失败，
直接显示成空洞。`tools/fetch_tile.sh` 的 `png_ok()` 与 `to_webp.py` 都校验 IEND 结尾。

**shell 函数不要用 `export -f` 跨进程传递。** 导出的函数体在子 shell 中重新导入后
行为异常（实测表现为 curl 静默失败、`http_code=000`）。因此抓取逻辑拆成了独立的
`tools/fetch_tile.sh`，由 `xargs` 直接调用，而不是导出函数。

**代理会拖慢约 9 倍。** 该瓦片服务可直连（实测 0.67s vs 走代理 6.15s）。
`tools/fetch_tile.sh` 默认加 `--noproxy '*'`；若你的网络必须经代理，设 `UBR_USE_PROXY=1`。

复查覆盖是否完整（`#` 有瓦片、`·` 园区外 404）：

```bash
python3 - <<'EOF'
import math, os
W,S,E,N = 116.668117, 39.840337, 116.694866, 39.868721
for z in (16,17,18,19):
    t = lambda lon,lat: (int((lon+180)/360*2**z),
         int((1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*2**z))
    x0,y0 = t(W,N); x1,y1 = t(E,S)
    miss = sum(1 for x in range(x0-1,x1+2) for y in range(y0-1,y1+2)
               if not os.path.exists(f'tiles/{z}/{x}-{y}-{z}.webp'))
    print(f'z={z} 缺失 {miss}  （应等于园区东界外的 404 数）')
EOF
```

## 坐标系统（重要）

所有坐标为 **GCJ-02**（火星坐标系），与高德底图一致，也是官网原始值。

- 在本页面内使用：完全对齐，无需转换
- 导入 Google Earth / OSM / QGIS 等 WGS-84 工具：需做 GCJ-02 → WGS-84 偏移纠正，
  否则在北京地区会有约 **300–500 米**的系统偏差

## 导出格式

```json
{
  "format": "ubr-checkin",
  "version": 3,
  "source": "server",
  "exportedAt": "2025-…",
  "crs": "GCJ-02",
  "count": 3,
  "points": [
    {
      "id": "lz4k2a9x",
      "seq": 1,
      "name": "霍格沃茨城堡正面机位",
      "kind": "必拍机位",
      "kinds": ["必拍机位", "日出蓝调"],
      "rating": 5,
      "note": "日落后 20 分钟蓝调，长焦压缩城堡与湖面",
      "lng": 116.6838,
      "lat": 39.8562,
      "done": false,
      "photoUrl": "/photos/lz4k2a9x.webp?v=…",
      "photoBase64": "…（勾选包含照片时才有）",
      "createdAt": "2025-…"
    }
  ]
}
```

`id` 唯一，导入时据此去重，可安全多次合并。导出仍由客户端生成，格式向下兼容，
**旧的导出文件可以直接用「导入 JSON 合并」灌进服务端**。

`photoUrl` 是服务端地址；勾选「包含照片」会额外附带 `photoBase64`，
便于完整备份或在两套部署之间搬运。

## 数据来源

- 瓦片：`amposs.app.universalbeijingresort.com/map_tiles/4.0/{z}/{x}-{y}-{z}.png`
  （官网地图页 `AMap.TileLayer` 实际调用地址）
- 点位：`/zh_CN/api/content/list/{play|restaurant|show|store|hotel|event}`
  与 `/zh_CN/api/content-type-with-taxonomy`
- 园区边界：`[[116.668117, 39.840337], [116.694866, 39.868721]]`，中心 `116.681491, 39.854529`

仅作个人游玩打卡规划使用，地图与点位版权归北京环球度假区所有。

## 已知情况

**瓦片服务的覆盖范围比官网配置的边界小。** 官网 `bounds` 东界为 `116.694866`，
瓦片服务器实际只提供到约 `116.693344`，再往东返回 404（最右侧数列，约 130 米宽）。
这不是抓取遗漏。官方页面上这片区域由一张低分辨率底图填充，我们则用**瓦片自带的
草地底色 `#95bd95`** 补格：`errorTileUrl` 与地图容器背景统一为该色，缺失区与地图
边缘无缝衔接，不会出现黑块。初始视野也按瓦片真实覆盖范围设定。

**一条官方数据坐标异常。** `nid=753《侏罗纪世界：重生》鹰角龙小洛见面会`，
官网 API 的 `field_longitude` 与 `field_latitude` 都是 `39.856705`（纬度值被误填进
经度字段），详情页也无正确坐标。已在 `build_pois.py` 中校验并标记 `coordValid:false`：
该点位在侧栏显示并标注「坐标缺失」，但不在图上落点，也无法一键转为打卡点。
可落点官方点位因此为 **126 / 127**。

**底部抽屉要手动控制圆角。** Mantine 的 `radius` 给四个角统一加圆角
（`lg` = 16px），但底部抽屉贴着屏幕下沿，下面两个角应该是方的。做法是把
`radius` 置 0，再用 `styles.content.borderRadius` 只圆上沿：

```tsx
radius={0}
styles={{ content: { borderRadius: '16px 16px 0 0' } }}   // 内联样式优先级高于 --paper-radius
```

**Drawer 的 header 要去掉，必须同时关掉 `withCloseButton`。**
Mantine 的判定是 `hasHeader = !!title || withCloseButton` —— 只要任一为真，就会渲染
一条 60px 高的头部（标题 + 关闭按钮），在内容上方表现为白边。因此本项目的三种状态
（列表 / 详情 / 编辑）全部设为 `withCloseButton={false}` 且不传 `title`，
标题与关闭入口改为内容区内的小节，关闭保留三条路径：点空白、ESC、内嵌按钮。
**注意**：移除 header 后 `.mantine-Drawer-close` 元素就不存在了，
自动化测试若依赖它关抽屉会静默失败 —— 统一改用点击 overlay。

**Leaflet 版权条已关闭。** `attributionControl: false` —— 它默认渲染
"Leaflet | 地图瓦片 © …" 一行，在移动端会挤在右下角按钮附近。
数据来源与版权说明保留在本文档的「数据来源」一节。

**底部 Drawer 的尺寸要同时写 width / flex / height。** `.mantine-Drawer-inner` 是
flex 行容器，只写 `flex: 0 0 74%` 会被当作**宽度** basis 解释（74% → 289px），
抽屉看起来没铺满；只写 flex 不写 height 又会回退到默认 `md`（440px），详情卡片会撑高盖住地图。
正确写法是三者齐全：

```ts
content: { flex: '0 0 auto', width: '100%', maxWidth: '100%', height: '74%' }
```

从源码可以印证这一点 —— Mantine 对上下位置的抽屉就是这么定义宽度的：

```js
// DrawerRoot.mjs
if (position === "top" || position === "bottom")
  return "0 0 calc(100% - var(--drawer-offset, 0rem) * 2)"   // flex-basis 即宽度
```

**破坏性操作用 Popover 二次确认，而不是 `window.confirm`。** 后者是阻塞式原生弹窗，
样式与应用割裂，移动端还会打断页面上下文。`ConfirmPopover` 就地确认，点外部即取消；
在列表行内使用时记得给触发元素 `stopPropagation`，否则会同时触发行的"点开详情"。

**抽屉关闭时"闪一下列表"的坑。** 内容分支若写成

```tsx
{editing ? <编辑器/> : selected ? <详情/> : <列表/>}
```

关闭时三个状态同时清空，最后的 `else` 就接管了渲染 —— **整个退场动画（280ms）里
滑下去的是列表**，观感是"详情消失前先弹一下列表"。正确做法是把「是否打开」独立出来：

```tsx
const [open, setOpen] = useState(false)        // 只管可见性
const [selected, setSelected] = useState(...)  // 内容状态留到 onExited 再清
// Drawer: transitionProps={{ duration: 280, onExited: clearContent }}
```

同时把内容分支的兜底从 `<列表/>` 改成 `null`，双保险。
**注意：只断言"最终态全关"是测不出这个问题的，必须采样退场过程中的渲染内容。**

**遮罩该不该留，取决于"点空白"要做什么。** Mantine 的点击外部关闭只写在 overlay 上：

```js
// ModalBaseOverlay.mjs
onClick: (event) => { onClick?.(event); ctx.closeOnClickOutside && ctx.onClose(); }
```

- 想让「点空白 = 关闭」：保留 overlay，把视觉归零
  （`overlayProps={{ backgroundOpacity: 0, blur: 0 }}`）。但 overlay 是
  `position: fixed; inset: 0; pointer-events: auto` 的全屏层，**它会拦下所有地图点击**，
  抽屉开着时点不到任何点位。
- 想让「抽屉开着还能操作地图」（本项目采用的方案）：`withOverlay={false}`，
  改为抓取条下拉关闭。

两者无法兼得 —— 要能"点外部"，那个外部层就必须接收点击。

**抓取条实现要点。** 拖动期间直接改 DOM 的 `transform`，不走 React state
（指针事件频率高，每次 setState 重渲染会明显掉帧）。抓取条必须设 `touch-action: none`，
否则纵向拖动会被浏览器当成页面滚动。

**关闭时不要在清 transform 之后再触发关闭。** 曾经的写法是「自己滑出屏幕 →
`reset()` 清空内联 transform → 调 `onClose()`」，结果快速拖拽关闭时会闪一下，
采样数据如下：

```
24ms–272ms : 60 → 687   平滑滑出
273ms      : 0          ← 清空 transform 后弹回完全展开，闪这一帧
288ms–576ms: 625        跳到屏幕外
```

清空内联 transform 会让元素立刻回到 CSS 原位（`translateY(0)` = 完全展开），
浏览器必然渲染出这一帧。正确做法是**把手势结果直接交给上层关闭，不清 transform** ——
关闭流程走完后 Mantine 会卸载内容节点（默认 `keepMounted: false`），
下次打开是新节点，残留样式自然不存在。

**渲染开销：先测量，再优化。** 用 CDP 逐帧采样 + `PerformanceObserver` 长任务 +
CPU Profiler 三项指标测过，结论与直觉不同：

- 无节流环境下各操作全部稳定在 **16.7ms（60fps）**，0 长任务、0 帧超 32ms
- CPU 降速 6× 模拟中低端设备后仍有长任务（最长 251ms，但降速下读数被放大 6 倍）
- **CPU profile 显示 75% 采样是 idle**，最热的自有函数只有 2.4% —— 瓶颈不在 JS

不过审查中确实找到三处结构性浪费，已修：

| 问题 | 修法 | 效果 |
|---|---|---|
| 每次缩放遍历 126 个标记、各写 5 条内联样式 | 尺寸抽成 CSS 变量挂图层容器，**只写 2 次** | 630 → 2 次样式写入 |
| 切换分类显隐会 `clearLayers` 重建全部标记 | 增量 diff：只增删受影响的那一类 | 保留 76 个原 DOM，新建 0 |
| `focus` effect 依赖了 `marks`，切完成状态也会重新 `setView` | 依赖收敛为 `[focus]`，数据从 ref 读 | 地图不再无谓跳动 |

**试过但撤销：`markerZoomAnimation: false`。** 它能省掉"每个标记各写一次
transform"（126 个 = 251 次），但 Leaflet 的实现是给标记层加 `.leaflet-zoom-hide`，
其 CSS 为 `visibility: hidden` —— 缩放动画期间标记整体消失再出现，
闪烁比省下的开销更糟。那些 transform 是 GPU 合成的，代价可接受。

**抽屉里的滚动容器只能有一个，且 `Drawer content` 必须显式设成 flex 列容器。**
Mantine 的 `.mantine-Drawer-content` 是 `display: block` —— 此时子元素上的
`flex: 1` / `min-height: 0` 全部无效，Drawer body 会被列表内容顶到全高（实测 8390px），
滚动就落到最外层的 content 上：**搜索框与分类标签会跟着列表一起滚走**。
修法是让高度链逐层传下去：

```css
.mantine-Drawer-content { display: flex; flex-direction: column; overflow: hidden; }
/* body 需要同时给 flex 与 min-height（默认是 flex: 0 1 auto，不撑满） */
```

同时 `body → .ubr-list-view → .ubr-list` 三层都要 `flex: 1 1 auto; min-height: 0`，
最后由 `.ubr-list` 单独承担 `overflow-y: auto`。编辑面板同理（`.ubr-pane` 自己滚）。
**验证方式是直接设 `list.scrollTop` 再比对搜索框的 `getBoundingClientRect().top` 是否变化。**

**点位图层的 effect 依赖里不要放「选中项」和「缩放」。** 曾经的依赖是
`[pois, showLabels, selectedPoiId, zoom]`，结果每切换一次选中、每缩放一级都会
`clearLayers()` 并重建**全部**标记（实测 126/126）。新插入的 `<img>` 在首次绘制前
会露出 `.mk` 的分类色背景（所有分类色都是蓝色系），表现就是"其他点位同时闪一下蓝"。
正确做法是把三件事拆开：

- 建标记：只依赖 `[pois, showLabels]`
- 选中态：遍历现有 marker，`getElement()?.classList.toggle('act', ...)`
- 缩放：只改内联尺寸，不动 DOM

**改尺寸时 `--s` 要设在 `.mk` 自身，不能只设父级。** `.mk` 的内联自定义属性
会盖过从父级继承的值，只改父级会出现"外框已放大、图片还是旧尺寸"的半更新状态。

**标记的高亮不要用 `transform: scale()`。** 点位标记现在都含缩略图，
对含 `<img>` 或文本的元素做缩放，浏览器会先按原尺寸栅格化再放大位图，
照片与文字会永久丢失细节；叠加 `will-change: transform` 后 hover 时必现。
实测归一化锐度：0.879（含 will-change）→ 0.939（仅去掉 will-change）
→ **1.001**（改用 `box-shadow` / `border` 表达高亮）。

**配色方案必须显式声明 `light`。** Mantine 的 `MantineProvider` 若不写
`defaultColorScheme`，默认是 `dark`：它会在 `html` 上挂 `data-mantine-color-scheme="dark"`，
于是抽屉、按钮、输入框全部走暗色变量（`--mantine-color-body` 变成 `#242424`）。
页面 body 因为有自己的 CSS 仍是浅色，看起来就像"浅色页面上嵌了几块近黑面板"。
排查时要注意：**只测 `body` 背景是测不出来的**，要看 Mantine 组件的 `data-mantine-color-scheme`
和 `.mantine-Drawer-content` 这类元素的实际背景。

**弹窗内容不用 Mantine 组件。** Leaflet 的 popup 挂载在独立的 React root 上，
不在 `MantineProvider` 树内，直接用 Mantine 组件会抛
`MantineProvider was not found`。因此弹窗内是原生元素 + 自定义样式。
