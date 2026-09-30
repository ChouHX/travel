#!/usr/bin/env python3
"""下载官方点位缩略图到本地，并把 pois.json 的 img 改写为本地相对路径。

失败的点位保留远程 URL，前端已有 onerror 优雅降级。
随后会把结果同步回 app/src/data/pois.json（React 构建时内联）。

本脚本位于 tools/，图片写入项目根的 data/img/。
"""
import json, os, subprocess, shutil, sys
from pathlib import Path
import concurrent.futures as cf

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
IMG = DATA / 'img'
POIS = DATA / 'pois.json'
APP_POIS = ROOT / 'app' / 'src' / 'data' / 'pois.json'

IMG.mkdir(parents=True, exist_ok=True)
pois = json.load(open(POIS, encoding='utf-8'))


def grab(p):
    src = p.get('img') or ''
    if not src.startswith('http'):
        return p
    ext = '.jpg'
    for e in ('.png', '.jpeg', '.webp'):
        if src.lower().split('?')[0].endswith(e):
            ext = e
            break
    dst = IMG / f'{p["id"]}{ext}'
    if not os.path.exists(dst) or os.path.getsize(dst) < 512:
        r = subprocess.run(['curl', '-sSL', '--max-time', '25', '-A', 'Mozilla/5.0',
                            '-e', 'https://www.universalbeijingresort.com/zh_CN/map',
                            '-o', str(dst), '-w', '%{http_code}', src],
                           capture_output=True, text=True)
        if r.stdout.strip() != '200' or not os.path.exists(dst) or os.path.getsize(dst) < 512:
            if os.path.exists(dst):
                os.remove(dst)
            return p                      # 保留下载失败项，回退远程
    p['imgLocal'] = f'data/img/{dst.name}'
    p['img'] = p['imgLocal']              # 优先用本地
    return p


with cf.ThreadPoolExecutor(max_workers=12) as ex:
    pois = list(ex.map(grab, pois))

json.dump(pois, open(POIS, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
ok = sum(1 for p in pois if p.get('imgLocal'))
print(f'[✓] 本地缩略图 {ok} / {len(pois)}  (其余保留远程 URL)')

shutil.copyfile(POIS, APP_POIS)
print(f'[✓] 已同步 {APP_POIS.relative_to(ROOT)}')

subprocess.run(['du', '-sh', str(IMG)])

# 顺带刷新地图标记用的小图。
# 这两步必须连着做：build_pois.py 会把 img 重置为远程地址，
# fetch_images.py 写回本地路径，而 marker 字段由图片派生——
# 漏掉这一步会导致地图标记退回纯色块（曾踩过）。
print()
subprocess.run([sys.executable, str(Path(__file__).resolve().parent / 'build_markers.py')])
