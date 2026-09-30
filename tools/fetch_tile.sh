#!/usr/bin/env bash
# 单张瓦片抓取 worker：由 download_tiles.sh 通过 xargs 并发调用，也可单独运行。
#
# 刻意做成独立脚本而非导出的 shell 函数——export -f 会序列化函数体，
# 嵌套函数定义在子 shell 中导入后行为异常（表现为 curl 静默失败、http_code=000）。
#
# 用法: fetch_tile.sh <z> <x> <y>
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # tools/
ROOT="$(cd "$HERE/.." && pwd)"                          # 项目根
TILES="$ROOT/tiles"
TMP="$HERE/tmp"

BASE="https://amposs.app.universalbeijingresort.com/map_tiles/4.0"
REF="https://www.universalbeijingresort.com/zh_CN/map"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
# 该瓦片服务可直连。若环境强制走代理，实测会慢约 9 倍（0.7s → 6s），
# 因此默认绕过代理；若你的网络必须经代理，设 UBR_USE_PROXY=1 即可。
if [ "${UBR_USE_PROXY:-0}" = "1" ]; then
  NOPROXY=()
else
  NOPROXY=(--noproxy '*')      # 必须用数组：裸写 --noproxy * 会让 * 被通配符展开
fi

z="$1"; x="$2"; y="$3"
out="$TILES/$z/$x-$y-$z.png"

png_ok() {
  # 完整 PNG：正确的文件头 + 以 IEND 块结尾（下载中断会留下头正确但数据截断的文件）
  [ -s "$1" ] || return 1
  [ "$(head -c 8 "$1" | od -An -tx1 | tr -d ' \n')" = "89504e470d0a1a0a" ] || return 1
  [ "$(tail -c 8 "$1" | od -An -tx1 | tr -d ' \n')" = "49454e44ae426082" ] || return 1
}

[ -s "$out" ] && png_ok "$out" && exit 0

mkdir -p "$TILES/$z"
tmp="$out.part"

for try in 1 2 3; do
  code=$(curl -sS --max-time 18 --retry 1 -A "$UA" -e "$REF" "${NOPROXY[@]}" \
    -o "$tmp" -w "%{http_code}" "$BASE/$z/$x-$y-$z.png" 2>/dev/null)
  if [ "$code" = "200" ] && png_ok "$tmp"; then
    mv -f "$tmp" "$out"
    exit 0
  fi
  rm -f "$tmp"
  [ "$code" = "404" ] && exit 0        # 园区外，服务端本就没有
  sleep "$try"
done

mkdir -p "$TMP"
echo "MISS $z $x $y" >> "$TMP/missed.txt"
exit 1
