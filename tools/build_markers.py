#!/usr/bin/env python3
"""为地图标记生成小尺寸缩略图。

地图上的点位标记只显示 ~32px，直接用 360×360 的原缩略图意味着首屏要拉
十几 MB。这里统一生成 64×64 的 WebP 小图（2x 屏下 32px 也够清晰），
体积可降到原来的百分之一左右。

源图不一定是正方形，一律居中裁切成正方形，避免标记变形。

用法:
    python3 tools/build_markers.py
"""
import json, os, sys
from pathlib import Path
from PIL import Image
import concurrent.futures as cf

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
IMG = DATA / 'img'
OUT = IMG / 'marker'
SIZE = 64

OUT.mkdir(parents=True, exist_ok=True)


def center_square(im: Image.Image) -> Image.Image:
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return im.crop((left, top, left + side, top + side))


def make(nid: str) -> tuple[str, int] | None:
    src = None
    for ext in ('.jpg', '.jpeg', '.png', '.webp'):
        p = IMG / f'{nid}{ext}'
        if p.exists():
            src = p
            break
    if src is None:
        return None
    dst = OUT / f'{nid}.webp'
    if dst.exists() and dst.stat().st_size > 200:
        return (nid, dst.stat().st_size)
    try:
        im = Image.open(src).convert('RGB')
        im = center_square(im).resize((SIZE, SIZE), Image.LANCZOS)
        im.save(dst, format='WEBP', quality=78, method=5)
        return (nid, dst.stat().st_size)
    except Exception as e:
        print(f'  [!] {nid} 处理失败: {e}')
        return None


if __name__ == '__main__':
    pois = json.load(open(DATA / 'pois.json', encoding='utf-8'))
    ids = [p['id'] for p in pois if p.get('img')]
    print(f'[i] 为 {len(ids)} 个点位生成 {SIZE}×{SIZE} 标记图…')

    made = []
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for r in ex.map(make, ids):
            if r:
                made.append(r)

    total = sum(sz for _, sz in made)
    src_total = sum(
        (IMG / f'{nid}{ext}').stat().st_size
        for nid in ids
        for ext in ('.jpg', '.jpeg', '.png', '.webp')
        if (IMG / f'{nid}{ext}').exists()
    )
    print(f'[✓] 生成 {len(made)} 张，合计 {total/1024:.0f} KB '
          f'（原图 {src_total/1048576:.1f} MB，约 {total/src_total*100:.1f}%）')

    # 把 marker 路径写回 pois.json，前端直接用
    for p in pois:
        if p.get('img') and (OUT / f"{p['id']}.webp").exists():
            p['marker'] = f"data/img/marker/{p['id']}.webp"
    json.dump(pois, open(DATA / 'pois.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    import shutil
    shutil.copyfile(DATA / 'pois.json', ROOT / 'app' / 'src' / 'data' / 'pois.json')
    n = sum(1 for p in pois if p.get('marker'))
    print(f'[✓] pois.json 已写入 marker 字段（{n} 条），并同步到 app/src/data/')