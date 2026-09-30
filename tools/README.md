# tools — 开发与抓取工具

这里存放**不属于运行时**的东西：抓取脚本、数据清洗、构建辅助、以及逆向分析时的存档。
应用本身（`index.html` + `tiles/` + `data/` + `app/`）全在项目根，与本目录保持隔离。

## 脚本一览

| 脚本 | 作用 | 读写位置 |
|---|---|---|
| `download_tiles.sh` | 批量抓取官方地图瓦片，调度并发 | 写 `../tiles/` |
| `fetch_tile.sh` | 单片抓取 worker（由上面通过 xargs 调用，也可单跑） | 写 `../tiles/` |
| `to_webp.py` | PNG → WebP **无损**转换 + 全量逐像素校验 | 读写 `../tiles/` |
| `build_pois.py` | 官网 API 响应 → 清洗后的点位数据 | 读 `api/`，写 `../data/pois.json`，同步 `../app/src/data/` |
| `fetch_images.py` | 点位缩略图本地化，末尾自动串跑 `build_markers.py` | 读 `../data/pois.json`，写 `../data/img/` |
| `build_markers.py` | 生成地图标记用 64×64 小图并写回 `marker` 字段 | 读 `../data/img/`，写 `../data/img/marker/` |
| `verify-react.mjs` | 端到端自检（CDP）：渲染、配色、权限、建点、压缩、标签/显隐解耦、Drawer 动效 | 读 `../index.html` |

所有脚本都用 `__file__` / `BASH_SOURCE` 自行定位项目根，**从任何目录调用都可以**。

```bash
# 在项目根或 tools/ 下都一样
python3 tools/build_pois.py
node tools/verify-react.mjs
```

## 子目录

| 目录 | 内容 | 说明 |
|---|---|---|
| `api/` | 官网接口原始响应存档 | `content-type-with-taxonomy` 与六个分类的 `content/list`，是 `build_pois.py` 的输入 |
| `raw/` | 逆向分析存档 | 官网地图页 HTML、四个打包 JS——当初就是从中挖出瓦片服务地址的 |
| `tmp/` | 抓取过程的中间文件 | `urls.txt`、`missed.txt`、日志 |

## 完整抓取流程

```bash
./tools/download_tiles.sh              # 抓 PNG 中间格式（默认并发 20）
python3 tools/to_webp.py --replace     # 转 WebP 无损，含全量逐像素校验
python3 tools/build_pois.py            # 重新清洗点位数据
python3 tools/fetch_images.py          # 缩略图本地化（含标记图）
cd app && pnpm build                   # 重新生成 index.html
node tools/verify-react.mjs            # 自检
```

## 四个必须知道的坑

**并发不能开高。** 官方瓦片服务对高并发敏感，会静默丢片。现用 20 并发 + 每片 3 次重试。

**校验必须查完整性。** 下载中断会留下 **PNG 头正确但数据截断**的文件（缺 IEND 块），
它能通过「存在 + 大小 + 文件头」的检查，浏览器却解码失败，直接显示成空洞。
`fetch_tile.sh` 的 `png_ok()` 与 `to_webp.py` 都校验 IEND 结尾。

**shell 函数不要用 `export -f` 跨进程传递。** 导出的函数体在子 shell 重新导入后行为异常，
实测表现为 curl 静默失败、`http_code=000`，一个文件都下不下来。
所以抓取逻辑拆成了独立的 `fetch_tile.sh`。

**「图片路径被重置」是个反复出现的坑。** `build_pois.py` 会从 API 存档重新生成
`pois.json`，把 `img` 写回远程地址；必须紧接着跑 `fetch_images.py` 才恢复本地路径。
而地图标记用的 `marker` 字段又是从图片派生的，所以这三步是**强顺序依赖**：
`build_pois.py` → `fetch_images.py`（内部自动带 `build_markers.py`）。
漏掉后续步骤的表现是：详情图变远程地址（离线打不开）、地图标记退回纯色块。

**代理会拖慢约 9 倍。** 该瓦片服务可直连（实测 0.67s vs 走代理 6.15s）。
`fetch_tile.sh` 默认加 `--noproxy '*'`；若你的网络必须经代理，设 `UBR_USE_PROXY=1`。
注意参数必须用数组传递，裸写 `--noproxy *` 会让 `*` 被通配符展开。

## 复查瓦片覆盖

园区外的瓦片服务端返回 404，缺失是正常的；关键是确认没有**园区内**空洞。

```bash
python3 - <<'EOF'
import math, os
W,S,E,N = 116.668117, 39.840337, 116.694866, 39.868721
root = 'tiles'
for z in (16,17,18,19):
    t = lambda lon,lat: (int((lon+180)/360*2**z),
         int((1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*2**z))
    x0,y0 = t(W,N); x1,y1 = t(E,S)
    miss = sum(1 for x in range(x0-1,x1+2) for y in range(y0-1,y1+2)
               if not os.path.exists(f'{root}/{z}/{x}-{y}-{z}.webp'))
    print(f'z={z} 缺失 {miss}  （应等于园区东界外的 404 数）')
EOF
```
