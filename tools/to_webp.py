#!/usr/bin/env python3
"""把地图瓦片从 PNG 转为 WebP 无损格式。

地图瓦片是矢量风格渲染，颜色多且有抗锯齿，调色板量化会有肉眼可见损失，
因此只用 WebP 的无损模式（lossless=True），保证逐像素完全一致。

本脚本位于 tools/，瓦片位于项目根的 tiles/。

用法:
    python3 tools/to_webp.py            # 转换，保留原 PNG
    python3 tools/to_webp.py --replace  # 全量逐像素校验通过后替换并删除原 PNG
"""
import glob, os, sys, io, time, shutil
from pathlib import Path
from PIL import Image
import concurrent.futures as cf

ROOT = Path(__file__).resolve().parent.parent
SRC = str(ROOT / 'tiles')
DST = str(ROOT / 'tiles_webp')

REPLACE = '--replace' in sys.argv


def convert(path):
    rel = os.path.relpath(path, SRC)
    out = os.path.join(DST, rel[:-4] + '.webp')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if os.path.exists(out) and os.path.getsize(out) > 100:
        return (os.path.getsize(path), os.path.getsize(out))
    im = Image.open(path)
    im.load()
    im.save(out, format='WEBP', lossless=True, quality=100, method=5)
    return (os.path.getsize(path), os.path.getsize(out))


def identical(png, webp):
    """逐像素比对，返回 (是否完全一致, 差异像素数)"""
    a = Image.open(png).convert('RGBA')
    b = Image.open(webp).convert('RGBA')
    if a.size != b.size:
        return False, -1
    da, db = a.getdata(), b.getdata()
    # 注意: getdata() 返回的是 ImagingCore，用 == 比的是对象身份而非像素，
    # 必须自己逐元素比较。
    diff = 0
    for x, y in zip(da, db):
        if x != y:
            diff += 1
    return diff == 0, diff


def verify_pair(job):
    """多进程入口：必须是模块级函数（lambda 不可 pickle）"""
    return identical(*job)


if __name__ == '__main__':
    files = sorted(glob.glob(f'{SRC}/*/*.png'))
    if not files:
        print(f'[i] {SRC} 下没有 PNG 需要转换（可能已经是 WebP 了）')
        sys.exit(0)
    print(f'源瓦片 {len(files)} 片   模式: {"转换并替换" if REPLACE else "转换（保留原文件）"}')

    t0 = time.time()
    sizes = [0, 0]
    with cf.ProcessPoolExecutor() as ex:
        for i, (a, b) in enumerate(ex.map(convert, files, chunksize=32), 1):
            sizes[0] += a; sizes[1] += b
            if i % 500 == 0:
                print(f'  转换 {i}/{len(files)}  ({time.time()-t0:.0f}s)')
    print(f'[✓] 转换完成 {len(files)} 片  用时 {time.time()-t0:.0f}s')
    print(f'    PNG {sizes[0]/1048576:.1f} MB → WebP {sizes[1]/1048576:.1f} MB '
          f'({sizes[1]/sizes[0]*100:.1f}%)  省 {(sizes[0]-sizes[1])/1048576:.1f} MB')

    # 全量逐像素校验（破坏性替换前必须全过）
    print(f'[i] 全量逐像素校验 {len(files)} 片…')
    t1 = time.time()
    bad = []
    with cf.ProcessPoolExecutor() as ex:
        jobs = [(p, os.path.join(DST, os.path.relpath(p, SRC)[:-4] + '.webp')) for p in files]
        for p, (ok, d) in zip(files, ex.map(verify_pair, jobs, chunksize=16)):
            if not ok:
                bad.append((p, d))
    print(f'[{"✓" if not bad else "!"}] 校验完成，用时 {time.time()-t1:.0f}s   '
          f'完全一致 {len(files)-len(bad)}/{len(files)} 片')
    for p, d in bad[:5]:
        print(f'     差异 {p} : {d} 像素')

    if REPLACE and not bad:
        moved = 0
        for p in files:
            w = os.path.join(DST, os.path.relpath(p, SRC)[:-4] + '.webp')
            if not os.path.exists(w):
                continue
            os.replace(w, p[:-4] + '.webp')   # 逐个搬回，避免批量移动遗漏
            os.remove(p)
            moved += 1
        shutil.rmtree(DST, ignore_errors=True)
        left = len(glob.glob(f'{SRC}/*/*.png'))
        print(f'[✓] 已替换 {moved} 片为 WebP' + (f'，仍有 {left} 个 PNG 残留' if left else '，无 PNG 残留'))
    elif bad:
        print('[!] 存在差异，未替换。请检查转换参数。')
