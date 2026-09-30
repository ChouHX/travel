#!/usr/bin/env python3
"""把官方 API 原始响应清洗成前端可直接消费的 pois.json。

输入: tools/api/*.json（官网接口存档）
输出: data/pois.json（运行时数据），并同步一份到 app/src/data/ 供 React 打包内联。

本脚本位于 tools/。
"""
import json, os, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
API = HERE / 'api'
DATA = ROOT / 'data'
APP_DATA = ROOT / 'app' / 'src' / 'data'

CAT = {'play': '玩乐', 'restaurant': '餐饮', 'show': '演出',
       'store': '商店', 'hotel': '酒店', 'event': '活动'}

DATA.mkdir(exist_ok=True)

# tid -> 标签名
tid_name = {}
for grp in json.load(open(API / 'taxonomy.json', encoding='utf-8')):
    for cond in grp.get('vocabulary_condition', []):
        for t in cond.get('terms', []):
            tid_name[str(t.get('tid'))] = t.get('name')


def coord_ok(lng, lat):
    """官网存在字段错填（如经纬度同值）。北京范围内校验，不合格标记为坐标缺失。"""
    if lng is None or lat is None:
        return False
    if not (115.0 <= lng <= 117.5 and 39.0 <= lat <= 41.0):
        return False
    return abs(lng - lat) > 1.0        # 经度/纬度同值必为错填


pois, seen, bad = [], set(), []
for key, label in CAT.items():
    path = API / f'{key}.json'
    if not path.exists():
        continue
    for r in json.load(open(path, encoding='utf-8')).get('results', []):
        lng, lat = r.get('field_longitude'), r.get('field_latitude')
        if lng is None or lat is None:
            continue
        nid = str(r.get('nid', ''))
        if nid in seen:
            continue
        seen.add(nid)
        tags = [tid_name.get(str(t).strip(), str(t).strip())
                for t in str(r.get('field_features_taxonomy_label') or '').split(',')
                if str(t).strip()]
        valid = coord_ok(lng, lat)
        if not valid:
            bad.append((nid, r.get('title')))
        pois.append({
            'id': nid,
            'name': (r.get('title') or '').strip(),
            'cat': key,
            'catLabel': label,
            'land': (r.get('field_park_list') or '').strip(),
            'lng': round(float(lng), 7) if valid else None,
            'lat': round(float(lat), 7) if valid else None,
            'coordValid': valid,
            'img': r.get('field_small_card_img') or '',
            'url': r.get('view_node') or '',
            'tags': tags,
        })

out = DATA / 'pois.json'
json.dump(pois, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'[✓] {out.relative_to(ROOT)}  {len(pois)} 个官方点位')

# 同步给 React 工程（构建时内联进包）
APP_DATA.mkdir(parents=True, exist_ok=True)
shutil.copyfile(out, APP_DATA / 'pois.json')
print(f'[✓] 已同步 {APP_DATA.relative_to(ROOT)}/pois.json')

from collections import Counter
for k, v in Counter(p['cat'] for p in pois).items():
    print(f'    {CAT[k]:4s} {v:3d}')
if bad:
    print(f'[!] 官网原始数据坐标异常 {len(bad)} 条（已标记 coordValid=false，地图上不落点）：')
    for nid, t in bad:
        print(f'      nid={nid}  {t}')
