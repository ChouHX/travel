#!/usr/bin/env bash
# 抓取北京环球度假区官方地图瓦片 (amposs tile service v4.0)
# 网格: 标准 Web Mercator XYZ, 256x256 PNG
#
# 工作目录: 本脚本位于 tools/，但瓦片写入项目根的 tiles/。
# 抓下来的 PNG 是中间格式，之后用 `python3 to_webp.py --replace` 转成 WebP 无损存档。
#
# 注意: 官方瓦片服务对并发敏感，并发过高会静默丢片（表现为地图上出现空洞），
#       每片 3 次重试 + PNG 完整性校验。抓完务必复查覆盖。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # tools/
ROOT="$(cd "$HERE/.." && pwd)"                          # 项目根
TILES="$ROOT/tiles"
TMP="$HERE/tmp"

W=116.668117; S=39.840337; E=116.694866; N=39.868721
PAD=1
ZOOMS="${ZOOMS:-16 17 18 19}"
JOBS="${JOBS:-20}"

mkdir -p "$TILES" "$TMP"
: > "$TMP/urls.txt"
: > "$TMP/missed.txt"

python3 - "$W" "$S" "$E" "$N" "$PAD" $ZOOMS <<'PY' >> "$TMP/urls.txt"
import math, sys
W,S,E,N,pad = float(sys.argv[1]),float(sys.argv[2]),float(sys.argv[3]),float(sys.argv[4]),int(sys.argv[5])
zooms=[int(z) for z in sys.argv[6:]]
def tile(lon,lat,z):
    n=2**z
    x=int((lon+180)/360*n)
    lr=math.radians(lat)
    y=int((1-math.log(math.tan(lr)+1/math.cos(lr))/math.pi)/2*n)
    return x,y
for z in zooms:
    x0,y0=tile(W,N,z); x1,y1=tile(E,S,z)
    for x in range(x0-pad, x1+pad+1):
        for y in range(y0-pad, y1+pad+1):
            print(z,x,y)
PY

total=$(wc -l < "$TMP/urls.txt")
echo "[i] 待探测瓦片: $total   并发: $JOBS   输出: $TILES"

# 每 3 个参数（z x y）调用一次独立 worker 脚本
xargs -a "$TMP/urls.txt" -P "$JOBS" -n 3 "$HERE/fetch_tile.sh"

ok=$(find "$TILES" -name '*.png' | wc -l)
echo "[✓] 已抓取 PNG: $ok / $total   占用: $(du -sh "$TILES" | cut -f1)"
if [ -s "$TMP/missed.txt" ]; then
  echo "[!] $(sort -u "$TMP/missed.txt" | wc -l) 片重试后仍未成功（多为园区外 404，可忽略）"
fi
echo "[i] 下一步: python3 tools/to_webp.py --replace"
