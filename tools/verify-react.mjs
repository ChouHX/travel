#!/usr/bin/env node
/**
 * 端到端验证（真实 Chromium + CDP）。
 *
 * 项目已改为前后端一体：脚本会先确保服务端在跑，清空测试数据，再在浏览器里跑完整流程。
 *
 * 用法:
 *   node tools/verify-react.mjs
 *   UBR_BASE_URL=http://127.0.0.1:8787 node tools/verify-react.mjs
 *
 * 踩坑备忘：
 *  - 打卡点存在服务端，断言要查 /api/checkins，不能再读 localStorage。
 *  - 列表抽屉初始是收起的，测列表/标签前必须先点「点位列表」展开。
 *  - 抽屉会卸载重挂，缓存 DOM 引用会读到旧内容，一律现查现取。
 *  - 测地图标记可见性前要确保抽屉不遮挡，否则 elementFromPoint 命中的是抽屉内容。
 *  - 「分类标签」只管浏览范围，「显示管理」才控制地图显隐，两者必须分开断言。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs';

const BASE_URL = (process.env.UBR_BASE_URL
  || `http://127.0.0.1:${process.env.UBR_SERVER_PORT || 8787}`).replace(/\/$/, '');
const PAGE_URL = `${BASE_URL}/`;
const ADMIN_PASSWORD = process.env.UBR_ADMIN_PASSWORD || 'ubr2024';
const PORT = 9510;
// 每次用全新 profile：避免上一轮遗留的登录态影响断言
const PROFILE = `/tmp/ubr-verify-${process.pid}`;
fs.rmSync(PROFILE, { recursive: true, force: true });

/** 服务端没起就自己拉一个 —— 免得因为"忘了先启动"满屏失败 */
let serverProc = null;
async function ensureServer() {
  const ping = async () => {
    try {
      const r = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(1500) });
      return r.ok;
    } catch { return false; }
  };
  if (await ping()) return;
  console.log('[i] 服务端未响应，正在启动…');
  serverProc = spawn('node', ['index.mjs'], {
    cwd: path.join(import.meta.dirname, '..', 'server'),
    env: { ...process.env, PORT: String(new URL(BASE_URL).port || 8787) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if (await ping()) return;
  }
  throw new Error(`服务端启动失败：${BASE_URL}`);
}

async function adminToken() {
  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const d = await r.json();
  if (!d?.token) throw new Error('管理员登录失败');
  return d.token;
}

/** 清空服务端数据，保证断言可重复 */
async function resetServerData() {
  const token = await adminToken();
  await fetch(`${BASE_URL}/api/checkins`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
}

const chrome = spawn('chromium', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
  `--remote-debugging-port=${PORT}`, '--window-size=390,844', '--hide-scrollbars',
  `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });

let ws, id = 0;
const pending = new Map();
const exceptions = [];
const failures = [];

const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const msg = { id: ++id, method, params };
    pending.set(msg.id, { res, rej });
    ws.send(JSON.stringify(msg));
  });

async function main() {
  await ensureServer();
  await resetServerData();
  console.log(`[i] 服务端 ${BASE_URL} 已就绪，测试数据已清空\n`);

  let target;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch {}
    await sleep(250);
  }
  if (!target) throw new Error('CDP 未就绪');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    } else if (m.method === 'Runtime.exceptionThrown' && exceptions.length < 5) {
      exceptions.push((m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const ev = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise, userGesture: true });
    return r.exceptionDetails
      ? { __err: r.exceptionDetails.exception?.description?.split('\n')[0] }
      : r.result.value;
  };
  /** 真实鼠标点击：Popover 之类监听 mousedown 的行为，合成 click 不生效 */
  const realClick = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const rectOf = (sel) => ev(`(()=>{const e=document.querySelector('${sel}'); if(!e) return null;
    const r=e.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2};})()`);
  /** 用 ESC 关闭抽屉。遮罩已移除，这是与设备无关的可靠关闭方式 */
  const pressEsc = async () => {
    await send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27, nativeVirtualKeyCode:27 });
    await send('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27, nativeVirtualKeyCode:27 });
    await sleep(900);
  };
  /** 在抓取条上做一次真实拖拽 */
  const dragGrabber = async (dy, steps = 14) => {
    const g = await rectOf('.ubr-grabber');
    if (!g) return false;
    await send('Input.dispatchMouseEvent', { type:'mousePressed', x:g.x, y:g.y, button:'left', clickCount:1 });
    for (let i = 1; i <= steps; i++) {
      await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:g.x, y:g.y + (dy*i)/steps, button:'left', buttons:1 });
      await sleep(14);
    }
    await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:g.x, y:g.y + dy, button:'left', clickCount:1 });
    return true;
  };
  const reload = async () => {
    await send('Page.navigate', { url: PAGE_URL });
    await sleep(5000);
  };
  const check = (name, value, pass) => {
    if (!pass) failures.push(name);
    console.log(`${pass ? '✓' : '✗'} ${name.padEnd(22)} ${JSON.stringify(value)}`);
  };
  /** 展开列表抽屉（初始收起） */
  const openList = () => ev(`(async()=>{
    if(!document.querySelector('.mantine-Drawer-content')){
      const b=[...document.querySelectorAll('.ubr-fab-stack button')].find(x=>x.textContent.includes('点位列表'));
      if(b){ b.click(); await new Promise(r=>setTimeout(r,900)); }
    }
    return !!document.querySelector('.mantine-Drawer-content');
  })()`, true);
  const closeDrawer = async () => {
    if (await ev(`!!document.querySelector('.mantine-Drawer-content')`)) await pressEsc()
    return !(await ev(`!!document.querySelector('.mantine-Drawer-content')`))
  };

  await reload();

  // ① 初始：直接看到地图，抽屉收起
  const initial = await ev(`(()=>({
    react:!!document.querySelector('#root > *'),
    map:!!document.querySelector('.leaflet-container'),
    drawer:!!document.querySelector('.mantine-Drawer-content'),
    fab:[...document.querySelectorAll('.ubr-fab-stack button')].map(b=>b.textContent.trim()),
    bg:getComputedStyle(document.body).backgroundColor}))()`);
  check('初始显示地图·抽屉收起', initial,
    initial.react && initial.map && !initial.drawer
    && initial.fab.length === 1 && initial.fab.includes('点位列表'));   // 显示管理已移入工具栏

  // ② 浅色配色方案（关键是 Mantine 组件的配色方案，不只是 body）
  //  踩过的坑：只断言 body 背景会漏掉 defaultColorScheme="dark" 造成的问题——
  //  body 是浅色（自定义 CSS 生效），但抽屉/按钮/输入框全走暗色变量，观感是"纯黑面板"。
  await openList();
  const colors = await ev(`(()=>{
    const rgb=(c)=>{const m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(c||''); return m? [+m[1],+m[2],+m[3]] : null};
    const lum=(c)=>{const v=rgb(c); return v? (v[0]*299+v[1]*587+v[2]*114)/1000 : null};
    const hue=(c)=>{const v=rgb(c); if(!v) return null; const [r,g,b]=v.map(x=>x/255);
      const mx=Math.max(r,g,b), mn=Math.min(r,g,b); if(mx===mn) return null;
      let h = mx===r?((g-b)/(mx-mn))%6 : mx===g?((b-r)/(mx-mn)+2) : ((r-g)/(mx-mn)+4);
      h*=60; return h<0?h+360:h};
    const bg=(sel)=>{const e=document.querySelector(sel); return e? getComputedStyle(e).backgroundColor : null};
    const scheme=document.documentElement.getAttribute('data-mantine-color-scheme');
    const drawerBg=bg('.mantine-Drawer-content');
    const inputBg=bg('.mantine-TextInput-input');
    const btnBg=bg('.ubr-map-tools button');
    const marker=document.querySelector('.pin-ubr .mk');
    return {
      scheme,
      bodyBg:getComputedStyle(document.body).backgroundColor,
      bodyLum: lum(getComputedStyle(document.body).backgroundColor),
      drawerBg, drawerLum: lum(drawerBg),
      inputBg, inputLum: lum(inputBg),
      btnBg, btnLum: lum(btnBg),
      primary:getComputedStyle(document.documentElement).getPropertyValue('--mantine-color-sky-6').trim(),
      primaryHue: (()=>{const c=document.createElement('div'); c.style.color=getComputedStyle(document.documentElement)
        .getPropertyValue('--mantine-color-sky-6').trim(); document.body.appendChild(c);
        const v=getComputedStyle(c).color; document.body.removeChild(c);
        return Math.round(hue(v)||0)})(),
      primarySat: (()=>{const c=document.createElement('div'); c.style.color=getComputedStyle(document.documentElement)
        .getPropertyValue('--mantine-color-sky-6').trim(); document.body.appendChild(c);
        const v=rgb(getComputedStyle(c).color); document.body.removeChild(c);
        if(!v) return null; const mx=Math.max(...v)/255, mn=Math.min(...v)/255;
        return mx? +( (mx-mn)/mx ).toFixed(2) : 0})(),
      markerHue: marker? Math.round(hue(getComputedStyle(marker).backgroundColor)) : null,
    };
  })()`);
  // 断言"天蓝"而非任意蓝：色相 ~205°，且饱和度够高（旧的灰蓝 #4a7fae 只有 0.57）
  check('浅色·天蓝配色', colors,
    colors.scheme === 'light'
    && colors.bodyLum > 200 && colors.drawerLum > 200 && colors.inputLum > 200 && colors.btnLum > 200
    && colors.primary.toLowerCase() === '#1f9ef5'
    && colors.primaryHue > 195 && colors.primaryHue < 215
    && colors.primarySat != null && colors.primarySat >= 0.75
    && colors.markerHue != null && colors.markerHue > 180 && colors.markerHue < 260);
  await closeDrawer();

  // ③ 瓦片
  const tiles = await ev(`(()=>{const t=[...document.querySelectorAll('img.leaflet-tile')];
    return {total:t.length, loaded:t.filter(i=>i.complete&&i.naturalWidth>0).length,
            broken:t.filter(i=>i.complete&&i.naturalWidth===0).length}})()`);
  check('瓦片解码', tiles, tiles.loaded > 0 && tiles.broken === 0);

  // ④ 工具栏：单行四按钮（含显示管理 Popover 触发器），游客无添加按钮
  const toolbarGuest = await ev(`(()=>{
    const kids=[...document.querySelectorAll('.ubr-map-tools button')];
    const rows=new Set(kids.map(b=>Math.round(b.getBoundingClientRect().top/8)));
    return {n:kids.length, rows:rows.size, labels:kids.map(b=>b.getAttribute('aria-label')),
      fab:[...document.querySelectorAll('.ubr-fab-stack button')].map(b=>b.textContent.trim())};
  })()`);
  check('工具栏单行三按钮·游客无添加', toolbarGuest,
    toolbarGuest.rows === 1
    && toolbarGuest.labels.includes('显示点位名称')
        && toolbarGuest.labels.includes('回到园区全景')
    && toolbarGuest.labels.includes('地图显示管理')      // 显示管理已并入工具栏
    && !toolbarGuest.labels.includes('添加打卡点')
    && toolbarGuest.fab.length === 1);                    // fab 只剩「点位列表」

  // ⑤ 游客只读
  //   不能用界面文案判断身份 —— 那行「浏览模式」提示已按需求移除。
  //   改为直接验证权限本身：未登录时写接口必须被拒，且界面上没有编辑入口。
  const readOnly = await (async () => {
    const ui = await ev(`(()=>({
      addBtn:[...document.querySelectorAll('button')].some(b=>b.textContent.includes('添加打卡点')),
      io:[...document.querySelectorAll('button')].some(b=>/导入|导出/.test(b.textContent)),
    }))()`)
    // 直接打接口：未带 token 的写操作应当被拒
    const res = await fetch(`${BASE_URL}/api/checkins`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '不应被创建', lng: 116.68, lat: 39.85 }),
    })
    return { ...ui, 接口状态: res.status, 无编辑入口: !ui.addBtn && !ui.io }
  })()
  check('游客只读', readOnly,
    !readOnly.addBtn && !readOnly.io
    && readOnly.接口状态 === 401            // 权限由服务端强制，不只是隐藏按钮
    && readOnly.无编辑入口 === true);

  // 游客不该看到任何删除入口
  await openList();
  const guestDel = await ev(`document.querySelectorAll('[aria-label="删除打卡点"]').length`);
  await closeDrawer();
  check('游客无删除入口', guestDel, guestDel === 0);

  // ⑥ 管理员登录 + 添加按钮最右
  const login = await ev(`(async()=>{
    location.hash='#/admin'; await new Promise(r=>setTimeout(r,800));
    const inp=document.querySelector('input[type=password]');
    if(!inp) return {gate:false};
    const setV=(e,v)=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(e,v);
      e.dispatchEvent(new Event('input',{bubbles:true}))};
    setV(inp,'ubr2024'); await new Promise(r=>setTimeout(r,250));
    [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='登录').click();
    await new Promise(r=>setTimeout(r,900));
    const panel=document.body.innerText.includes('管理后台');
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('返回地图')).click();
    await new Promise(r=>setTimeout(r,1000));
    const kids=[...document.querySelectorAll('.ubr-map-tools button')];
    const add=kids.find(b=>b.getAttribute('aria-label')==='添加打卡点');
    const icons=kids.filter(b=>b!==add);
    const rows=new Set(kids.map(b=>Math.round(b.getBoundingClientRect().top/8)));
    return {gate:true, panel, n:kids.length, rows:rows.size,
      添加最右: add? add.getBoundingClientRect().left >= Math.max(...icons.map(b=>b.getBoundingClientRect().right))-1 : null};
  })()`, true);
  check('管理员登录·添加按钮最右', login,
    login.gate && login.panel && login.添加最右 === true && login.rows === 1 && login.n === 4);

  // ⑦ 点位全部显示缩略图，尺寸随缩放变化
  const zooms = await ev(`(async()=>{
    const read=()=>{const mks=[...document.querySelectorAll('.pin-ubr .mk')];
      const imgs=[...document.querySelectorAll('.pin-ubr .mk img')];
      const box=mks[0]?.getBoundingClientRect();
      return {markers:mks.length, thumbs:imgs.length,
        decoded:imgs.filter(i=>i.complete&&i.naturalWidth>0).length,
        size:box?Math.round(box.width):null};};
    const low=read();
    const el=document.querySelector('.leaflet-container'), r=el.getBoundingClientRect();
    for(let i=0;i<7;i++){
      el.dispatchEvent(new WheelEvent('wheel',{deltaY:-300,clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,cancelable:true,view:window}));
      await new Promise(x=>setTimeout(x,450));
    }
    await new Promise(x=>setTimeout(x,1500));
    return {low, high:read(), clusters:document.querySelectorAll('.pin-cluster').length};
  })()`, true);
  check('点位全显缩略图', zooms,
    zooms.clusters === 0
    && zooms.low.markers > 100 && zooms.low.thumbs === zooms.low.markers
    && zooms.low.decoded === zooms.low.markers
    && zooms.high.thumbs === zooms.high.markers && zooms.high.size > zooms.low.size);

  await reload();

  // ⑦b 抽屉几何 + 无遮罩 + 抓取条
  //   三次踩坑都在这块：
  //   1) .mantine-Drawer-inner 是 flex 行容器，只写 flex 会被当成宽度 basis（74%→289px）；
  //   2) 曾用透明 overlay 承接"点空白关闭"，但那层 pointer-events:auto 的全屏元素
  //      会拦截地图点击，抽屉开着时点不到其他点位；
  //   3) 最终取 iOS 做法：完全去掉 overlay，改用顶部抓取条下拉关闭，地图始终可交互。
  await openList();
  const geoms = await ev(`(()=>{
    const c=document.querySelector('.mantine-Drawer-content');
    if(!c) return {drawer:false};
    const r=c.getBoundingClientRect();
    const cs=getComputedStyle(c);
    const g=document.querySelector('.ubr-grabber');
    return {drawer:true, w:Math.round(r.width), h:Math.round(r.height), vw:innerWidth, vh:innerHeight,
      满宽: Math.round(r.width) === innerWidth,
      overlay数: document.querySelectorAll('.mantine-Drawer-overlay').length,
      抓取条: !!g,
      抓取条可拖: g? getComputedStyle(g).touchAction : null,
      上圆角:[cs.borderTopLeftRadius, cs.borderTopRightRadius],
      下圆角:[cs.borderBottomLeftRadius, cs.borderBottomRightRadius],
      贴底: Math.abs(r.bottom - innerHeight) < 2};
  })()`);
  check('抽屉满宽·无遮罩·有抓取条', geoms,
    geoms.drawer && geoms.满宽 && geoms.overlay数 === 0 && geoms.抓取条
    && geoms.抓取条可拖 === 'none'                     // 必须禁用触控滚动，否则拖不动
    && geoms.h > 0 && geoms.h < geoms.vh && geoms.贴底
    && geoms.上圆角.every((v)=>parseFloat(v) > 0)
    && geoms.下圆角.every((v)=>parseFloat(v) === 0));

  // ⑦a 两端一致性：桌面端与移动端同用底部抽屉；不显示分类图例；无底图色调按钮
  const twoEnds = await ev(`(()=>{
    const c=document.querySelector('.mantine-Drawer-content');
    const legend=document.querySelector('.ubr-legend');
    return {
      抽屉满宽: c? Math.round(c.getBoundingClientRect().width) === innerWidth : null,
      抽屉贴底: c? Math.abs(c.getBoundingClientRect().bottom - innerHeight) < 2 : null,
      抓取条: !!document.querySelector('.ubr-grabber'),
      图例显示: legend? getComputedStyle(legend).display !== 'none' : false,
      色调按钮: [...document.querySelectorAll('.ubr-map-tools button')]
        .some(b=>(b.getAttribute('aria-label')||'').includes('色调')),
    };
  })()`);
  check('无色调按钮·无图例', twoEnds,
    twoEnds.抽屉满宽 === true && twoEnds.抽屉贴底 === true && twoEnds.抓取条
    && twoEnds.图例显示 === false && twoEnds.色调按钮 === false);

  // ⑦b2 抽屉开着时地图必须可点：点另一枚图钉能直接切换详情
  //   用 classList.contains('act') 判断选中态 —— 写成 className.includes('act')
  //   会命中 leaflet-interactive 里的 "act"，把每枚图钉都当成已选中。
  const switchDetail = await ev(`(async()=>{
    const dc=document.querySelector('.mantine-Drawer-content');
    if(!dc) return {drawer:false};
    const top=dc.getBoundingClientRect().top;
    const cands=[...document.querySelectorAll('.pin-ubr')].filter(x=>{
      if(x.classList.contains('act')) return false;
      const r=x.getBoundingClientRect();
      return r.width>0 && r.top>110 && r.bottom<top-16 && r.left>6 && r.right<innerWidth-6;});
    if(!cands.length) return {cands:0};
    const r=cands[0].getBoundingClientRect();
    const cx=r.left+r.width/2, cy=r.top+r.height/2;
    const hit=document.elementFromPoint(cx,cy);
    return {cands:cands.length, 命中是图钉:cands[0].contains(hit), x:cx, y:cy,
      before:document.querySelector('.ubr-detail-name')?.textContent||null};
  })()`, true);
  if (switchDetail.cands) {
    await realClick(switchDetail.x, switchDetail.y);
    await sleep(1800);
  }
  const switched = await ev(`({after:document.querySelector('.ubr-detail-name')?.textContent||null,
    抽屉仍开:!!document.querySelector('.mantine-Drawer-content'),
    选中数:document.querySelectorAll('.pin-ubr.act').length})`);
  check('抽屉开着可点选其他点位', switchDetail.cands > 0 && switchDetail.命中是图钉
    ? (switchDetail.before !== switched.after && switched.抽屉仍开 && switched.选中数 === 1)
    : false, {...switchDetail, ...switched});

  // ⑦c 拖拽抓取条关闭：一次性全关，且退场动画期间内容不得回落成列表
  //   内容分支若写成 `editing ? A : selected ? B : 列表`，关闭时三态同时清空就会
  //   回落到最后的 else，退场 280ms 里滑下去的变成列表（"详情消失前先闪一下列表"）。
  //   只断言"最终全关"测不出来，必须采样过程。
  await reload();
  await openList();
  await ev(`(async()=>{document.querySelector('.ubr-row')?.click();
    await new Promise(r=>setTimeout(r,1500)); return 1})()`, true);
  const inDetail = await ev(`!!document.querySelector('.ubr-detail-name')`);

  // 装上过程采样器，再真实拖拽抓取条
  await ev(`(()=>{
    window.__samp=[]; window.__iv=setInterval(()=>{
      const dc=document.querySelector('.mantine-Drawer-content');
      if(!dc) return;
      window.__samp.push(dc.querySelector('.ubr-detail-name') ? '详情'
        : dc.querySelector('textarea') ? '编辑'
        : dc.querySelector('.ubr-row') ? '列表' : '空');
    }, 25);
    return 1})()`);
  await dragGrabber(150);
  await sleep(1300);
  const oneShot = await ev(`(()=>{clearInterval(window.__iv);
    const samples=[...window.__samp];
    return {inDetail:${inDetail}, samples,
      动画期出现列表: samples.includes('列表'),
      动画期内容种类:[...new Set(samples)],
      抽屉:!!document.querySelector('.mantine-Drawer-content'),
      列表:!!document.querySelector('.ubr-row'),
      详情:!!document.querySelector('.ubr-detail-name')};})()`);
  check('拖拽抓取条关闭·一次全关', oneShot,
    oneShot.inDetail && !oneShot.抽屉 && !oneShot.列表 && !oneShot.详情
    && oneShot.动画期出现列表 === false && oneShot.动画期内容种类.length === 1);

  // ⑦c2 小幅拖拽应回弹，不关闭
  await reload();
  await openList();
  await dragGrabber(30);
  await sleep(900);
  const snapBack = await ev(`({仍开:!!document.querySelector('.mantine-Drawer-content'),
    位移已复位:getComputedStyle(document.querySelector('.mantine-Drawer-content')).transform})`);
  check('小幅拖拽回弹不关闭', snapBack,
    snapBack.仍开 && (snapBack.位移已复位 === 'none' || snapBack.位移已复位 === 'matrix(1, 0, 0, 1, 0, 0)'));
  await pressEsc();

  // ⑦c3 快速拖拽关闭不得"回闪"
  //   曾经的 bug：释放后先 reset() 清空内联 transform，元素立刻回到 CSS 原位
  //   （translateY(0) = 完全展开），浏览器渲染出这一帧后才播收起动画。
  //   采样实测 y 从 687 直接跳回 0，观感是"抽屉先完全展开闪一下再关掉"。
  //   修法是把手势结果直接交给上层关闭，不清 transform（关闭后节点会被卸载）。
  await reload();
  await openList();
  const drawerH = await ev(`document.querySelector('.mantine-Drawer-content')?.getBoundingClientRect().height||0`);
  await ev(`(()=>{
    window.__y=[]; window.__iv=setInterval(()=>{
      const dc=document.querySelector('.mantine-Drawer-content');
      if(!dc){ window.__y.push([Math.round(performance.now()), null]); return; }
      const m=/matrix\\(1, 0, 0, 1, 0, ([\\-\\d.]+)\\)/.exec(getComputedStyle(dc).transform);
      window.__y.push([Math.round(performance.now()), m? Math.round(+m[1]) : 0]);
    }, 16); return 1})()`);
  await dragGrabber(150, 3);   // 只要 3 步 → 模拟"速度过快"
  await sleep(1400);
  const fastSamples = await ev(`(()=>{clearInterval(window.__iv); return window.__y})()`);
  const visibleLine = drawerH * 0.5;
  let left = false, flash = null;
  for (const [, y] of fastSamples) {
    if (y === null) continue;
    if (y > visibleLine) left = true;
    else if (left) { flash = y; break; }
  }
  const removedAtEnd = fastSamples.length > 0 && fastSamples[fastSamples.length - 1][1] === null;
  check('快速拖拽关闭不回闪', { 抽屉高: Math.round(drawerH), 采样数: fastSamples.length,
    最远: Math.max(...fastSamples.filter(([,y])=>y!==null).map(([,y])=>y)), 回闪位移: flash, 结束已移除: removedAtEnd },
    drawerH > 0 && !flash && removedAtEnd && left === true);

  // 关闭后重新打开：不得残留内联 transform
  await openList();
  const reopenState = await ev(`(()=>{const dc=document.querySelector('.mantine-Drawer-content');
    if(!dc) return {打开:false};
    const r=dc.getBoundingClientRect();
    return {打开:true, transform:getComputedStyle(dc).transform,
      完整可见:r.top>0 && r.bottom<=innerHeight+1 && Math.round(r.height)>0};})()`);
  check('关闭后重开无残留样式', reopenState,
    reopenState.打开 && reopenState.完整可见
    && (reopenState.transform === 'none' || reopenState.transform === 'matrix(1, 0, 0, 1, 0, 0)'));
  await pressEsc();

  // ⑦c4 切换选中 / 缩放不得重建标记
  //   曾经的 bug：点位图层 effect 的依赖里带了 selectedPoiId 与 zoom，
  //   每切一次选中、每缩放一级都会 clearLayers + 重建全部标记（实测 126/126）。
  //   新 <img> 在首次绘制前会露出 .mk 的分类色背景（全部是蓝色系），
  //   表现就是"其他点位同时闪一下蓝再恢复正常"。
  //   现在：标记只建一次；选中态切 class；缩放只改内联尺寸。
  await reload();
  const tagMarkers = () => ev(`(()=>{document.querySelectorAll('.pin-ubr').forEach((e,i)=>e.dataset.uid='u'+i);
    return document.querySelectorAll('.pin-ubr').length;})()`);
  const keptCount = () => ev(`(()=>{const n=[...document.querySelectorAll('.pin-ubr')];
    return {总数:n.length, 保留:n.filter(e=>e.dataset.uid).length,
      被重建:n.filter(e=>!e.dataset.uid).length};})()`);

  const total0 = await tagMarkers();
  const selPos = await ev(`(()=>{const p=[...document.querySelectorAll('.pin-ubr')].find(x=>{
    const r=x.getBoundingClientRect();
    return r.width>0 && r.top>110 && r.bottom<innerHeight-260 && r.left>20 && r.right<innerWidth-20;});
    if(!p) return null; const r=p.getBoundingClientRect();
    return {x:r.left+r.width/2, y:r.top+r.height/2};})()`);
  if (selPos) { await realClick(selPos.x, selPos.y); await sleep(1700); }
  const afterSelect = await keptCount();

  const mapCenter2 = await rectOf('.leaflet-container');
  await send('Input.dispatchMouseEvent', { type:'mouseWheel', x:mapCenter2.x, y:mapCenter2.y, deltaX:0, deltaY:-240 });
  await sleep(900);
  const afterZoom = await keptCount();
  // 尺寸由 CSS 变量 --ubr-mk 驱动（写在图层容器上），不再是标记的内联 --s。
  // 注意：断言对象里不能用重复的键，否则后者会覆盖前者、比较到 undefined。
  const sizeVar = await ev(`(()=>{const host=document.querySelector('.leaflet-container');
    const mk=document.querySelector('.pin-ubr .mk');
    return {容器变量:getComputedStyle(host).getPropertyValue('--ubr-mk').trim(),
      内联s:mk.style.getPropertyValue('--s')||'(无)',
      宽:Math.round(mk.getBoundingClientRect().width)};})()`);

  check('切换/缩放不重建标记', { 初始: total0, 选中后: afterSelect, 缩放后: afterZoom, 尺寸: sizeVar },
    total0 > 100
    && afterSelect.保留 === total0 && afterSelect.被重建 === 0
    && afterZoom.保留 === total0 && afterZoom.被重建 === 0
    && afterSelect.总数 === afterZoom.总数
    && /^\d+px$/.test(String(sizeVar.容器变量))
    && parseFloat(String(sizeVar.容器变量)) > 20
    && sizeVar.内联s === '(无)'        // 确认没有退回逐个写内联样式
    && sizeVar.宽 > 20);

  // 外链并入标题右侧（旧的独立"官网详情"按钮已移除）
  const extLink = await ev(`(()=>{
    const a=document.querySelector('.ubr-detail-extlink');
    const name=document.querySelector('.ubr-detail-name');
    return {外链:!!a, 旧按钮:!!document.querySelector('.ubr-detail-link'),
      在标题右侧: !!(a&&name) && a.getBoundingClientRect().left >= name.getBoundingClientRect().right-2,
      同一行: !!(a&&name) && Math.abs(a.getBoundingClientRect().top-name.getBoundingClientRect().top)<24,
      href有效: !!(a && (a.getAttribute('href')||'').startsWith('http'))};
  })()`);
  check('外链并入标题右侧', extLink,
    extLink.外链 && !extLink.旧按钮 && extLink.在标题右侧 && extLink.同一行 && extLink.href有效);
  await pressEsc();

  // ⑦d 搜索框尺寸 + 自定义点位删除
  await reload();
  await openList();
  const searchBox = await ev(`(()=>{const e=document.querySelector('.mantine-TextInput-input');
    if(!e) return {found:false}; const r=e.getBoundingClientRect();
    return {found:true, h:Math.round(r.height), w:Math.round(r.width)};})()`);
  check('搜索框已缩小', searchBox, searchBox.found && searchBox.h <= 38 && searchBox.h >= 26);

  // 删除功能：列表行 + 详情页，取消/确认，照片清理，游客不可见
  const delFlow = await ev(`(async()=>{
    // 数据在服务端：直接查接口，不再读 localStorage / IndexedDB
    const marks=async()=>((await (await fetch('/api/checkins')).json()).results||[]);
    const photoCount=async()=>((await marks()).filter(m=>m.photoUrl).length);
    const setV=(e,v)=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(e,v);
      e.dispatchEvent(new Event('input',{bubbles:true}))};

    // 建一个带照片的打卡点
    /* 关闭抽屉由外层的 pressEsc 负责，见各测试步骤 */
    [...document.querySelectorAll('.ubr-map-tools button')].find(b=>b.getAttribute('aria-label')==='添加打卡点').click();
    await new Promise(r=>setTimeout(r,300));
    const el=document.querySelector('.leaflet-container'), r=el.getBoundingClientRect();
    for(const ty of ['mousedown','mouseup','click'])
      el.dispatchEvent(new MouseEvent(ty,{clientX:r.left+r.width/2,clientY:r.top+r.height*0.35,bubbles:true,cancelable:true,view:window,button:0}));
    await new Promise(r=>setTimeout(r,800));
    const inp=[...document.querySelectorAll('input')].filter(i=>i.type==='text').pop();
    if(!inp) return {form:false};
    setV(inp,'自检-待删'); await new Promise(r=>setTimeout(r,250));

    const c=document.createElement('canvas'); c.width=1600; c.height=1200;
    const x=c.getContext('2d'); x.fillStyle='#4a7fae'; x.fillRect(0,0,1600,1200);
    const big=await new Promise(rr=>c.toBlob(rr,'image/jpeg',0.9));
    const fi=document.querySelector('input[type=file]');
    const dt=new DataTransfer(); dt.items.add(new File([big],'p.jpg',{type:'image/jpeg'}));
    fi.files=dt.files; fi.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(rr=>setTimeout(rr,2500));
    [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存')?.click();
    await new Promise(rr=>setTimeout(rr,1300));

    const built={marks:(await marks()).length, photos:await photoCount()};
    const detailHasDelete=!!document.querySelector('.mantine-Drawer-content [aria-label="删除打卡点"]');

    // 详情页删除 → 先取消
    document.querySelector('.mantine-Drawer-content [aria-label="删除打卡点"]').click();
    await new Promise(rr=>setTimeout(rr,700));
    const pop=()=>document.querySelector('.mantine-Popover-dropdown');
    const hasConfirm=!!pop() && pop().textContent.includes('取消');
    [...pop().querySelectorAll('button')].find(b=>b.textContent.trim()==='取消').click();
    await new Promise(rr=>setTimeout(rr,700));
    const afterCancel={marks:(await marks()).length, popGone:!pop()};

    // 再确认删除
    document.querySelector('.mantine-Drawer-content [aria-label="删除打卡点"]').click();
    await new Promise(rr=>setTimeout(rr,700));
    [...pop().querySelectorAll('button')].find(b=>b.textContent.trim()==='删除').click();
    await new Promise(rr=>setTimeout(rr,1400));
    const afterDelete={marks:(await marks()).length, photos:await photoCount(),
      drawerClosed:!document.querySelector('.mantine-Drawer-content'),
      markers:document.querySelectorAll('.pin-ck').length,
      toast:document.querySelector('.ubr-toast')?.textContent||null};

    return {form:true, built, detailHasDelete, hasConfirm, afterCancel, afterDelete};
  })()`, true);
  check('删除打卡点(含照片清理)', delFlow,
    delFlow.form && delFlow.built.marks === 1 && delFlow.built.photos === 1
    && delFlow.detailHasDelete && delFlow.hasConfirm
    && delFlow.afterCancel.marks === 1 && delFlow.afterCancel.popGone      // 取消不删
    && delFlow.afterDelete.marks === 0 && delFlow.afterDelete.photos === 0 // 确认后连照片一起清
    && delFlow.afterDelete.drawerClosed && delFlow.afterDelete.markers === 0);

  // 列表行的删除入口 + 走列表这条删除路径
  //   注意：断言不能写成 btn >= 0（恒真式）。这里真的建一个点、再通过列表行删掉。
  //   保存后抽屉停在详情态，必须先 ESC 收起，才能点右下角「点位列表」。
  await reload();
  const built = await ev(`(async()=>{
    const marks=async()=>((await (await fetch('/api/checkins')).json()).results||[]);
    const setV=(e,v)=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(e,v);
      e.dispatchEvent(new Event('input',{bubbles:true}))};
    [...document.querySelectorAll('.ubr-map-tools button')].find(b=>b.getAttribute('aria-label')==='添加打卡点')?.click();
    await new Promise(r=>setTimeout(r,300));
    const el=document.querySelector('.leaflet-container'), r=el.getBoundingClientRect();
    for(const ty of ['mousedown','mouseup','click'])
      el.dispatchEvent(new MouseEvent(ty,{clientX:r.left+r.width/2,clientY:r.top+r.height*0.5,bubbles:true,cancelable:true,view:window,button:0}));
    await new Promise(r=>setTimeout(r,800));
    const inp=[...document.querySelectorAll('input')].filter(i=>i.type==='text').pop();
    if(!inp) return {form:false};
    setV(inp,'列表删除自检'); await new Promise(r=>setTimeout(r,250));
    [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存')?.click();
    await new Promise(r=>setTimeout(r,1300));
    return {form:true, marks:(await marks()).length};
  })()`, true);

  await pressEsc();   // 收起详情，回到地图

  const listDelete = await ev(`(async()=>{
    const marks=async()=>((await (await fetch('/api/checkins')).json()).results||[]);
    [...document.querySelectorAll('.ubr-fab-stack button')].find(b=>b.textContent.includes('点位列表')).click();
    await new Promise(r=>setTimeout(r,1000));
    [...document.querySelectorAll('.ubr-tabs .mantine-Badge-root')].find(b=>b.textContent.includes('我的打卡'))?.click();
    await new Promise(r=>setTimeout(r,900));

    const btnCount=document.querySelectorAll('.ubr-row-acts [aria-label="删除打卡点"]').length;
    const before=(await marks()).length;
    document.querySelector('.ubr-row-acts [aria-label="删除打卡点"]')?.click();
    await new Promise(r=>setTimeout(r,700));
    const pop=document.querySelector('.mantine-Popover-dropdown');
    if(!pop) return {btnCount, before, popup:false};
    [...pop.querySelectorAll('button')].find(b=>b.textContent.trim()==='删除').click();
    await new Promise(r=>setTimeout(r,1300));
    return {btnCount, before, popup:true, after:(await marks()).length,
      列表行:document.querySelectorAll('.ubr-row').length};
  })()`, true);
  check('列表行删除路径', listDelete,
    built.form && built.marks === 1
    && listDelete.btnCount === 1 && listDelete.before === 1
    && listDelete.popup && listDelete.after === 0 && listDelete.列表行 === 0);
  await pressEsc();

  // ⑦d2 标记不得使用 transform 缩放
  //   对含 <img>/文本的元素做 transform: scale()，浏览器会先按原尺寸栅格化再放大位图，
  //   照片与文字永久丢失细节；叠加 will-change: transform 后更明显（hover 时必现）。
  //   实测归一化锐度：0.879（含 will-change）→ 0.939（仅去掉 will-change）→ 1.001（改用非缩放高亮）。
  //   高亮一律用 box-shadow / border 表达，不要再用 scale。
  //
  //   注意：必须给探针元素打标记再复测。
  //   地图上标签会重叠，且 Leaflet 的 riseOnHover 会抬升层级的 z-index，
  //   hover 时命中的可能是另一个标签，直接对比两个查询结果会误判。
  // sel 必须与 readProbe 用的一致，否则会拿 .mk（22px）跟 .mklbl（96px）比
  const probeMarker = async (tag, sel) => ev(`(()=>{
    const pins=[...document.querySelectorAll('.pin-ubr')];
    const pin=pins.find(x=>{const r=x.getBoundingClientRect();
      return r.top>100 && r.bottom<innerHeight-160 && r.left>40 && r.right<innerWidth-40;});
    if(!pin) return null;
    pin.dataset.ubrProbe = ${JSON.stringify(tag)};
    const el=pin.querySelector(${JSON.stringify(sel)}); if(!el) return null;
    const r=el.getBoundingClientRect(); const cs=getComputedStyle(el);
    return {transform:cs.transform, willChange:cs.willChange,
      w:Math.round(r.width), cx:r.left+r.width/2, cy:r.top+r.height/2};})()`);

  const readProbe = (tag, sel) => ev(`(()=>{
    const el=document.querySelector('[data-ubr-probe="${tag}"]');
    if(!el) return null;
    const target=el.querySelector('${sel}') || el;
    const cs=getComputedStyle(target);
    return {transform:cs.transform, willChange:cs.willChange,
      w:Math.round(target.getBoundingClientRect().width)};})()`);

  const mkBase = await probeMarker('m1', '.mk');
  if (mkBase) {
    await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:mkBase.cx, y:mkBase.cy });
    await sleep(900);
  }
  const mkHover = mkBase ? await readProbe('m1', '.mk') : null;
  await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:5, y:5 });
  await sleep(400);

  await ev(`(async()=>{document.querySelector('.ubr-map-tools button[aria-label="显示点位名称"]')?.click();
    await new Promise(r=>setTimeout(r,1500)); return 1})()`, true);
  const lblBase = await probeMarker('l1', '.mklbl');
  if (lblBase) {
    await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:lblBase.cx, y:lblBase.cy });
    await sleep(900);
  }
  const lblHover = lblBase ? await readProbe('l1', '.mklbl') : null;
  await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:5, y:5 });
  await ev(`(async()=>{document.querySelector('.ubr-map-tools button[aria-label="显示点位名称"]')?.click();
    await new Promise(r=>setTimeout(r,1000)); return 1})()`, true);

  const isIdentity = (t) => !t || t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
  check('标记不使用transform缩放', { mkBase, mkHover, lblBase, lblHover },
    !!mkBase && !!mkHover && !!lblBase && !!lblHover
    && isIdentity(mkBase.transform) && isIdentity(mkHover.transform)
    && isIdentity(lblBase.transform) && isIdentity(lblHover.transform)
    && mkBase.willChange === 'auto' && mkHover.willChange === 'auto'
    && lblBase.willChange === 'auto' && lblHover.willChange === 'auto'
    && mkBase.w === mkHover.w            // hover 不改变渲染尺寸
    && lblBase.w === lblHover.w);

  // ⑦e 所有状态都不应有 header；详情态无 header 也就没有 .mantine-Drawer-close，
  //   关闭入口改为内容区内嵌的小按钮，另有 ESC 与抓取条。
  await reload();
  await openList();
  const listState = await ev(`(()=>{
    const c=document.querySelector('.mantine-Drawer-content');
    if(!c) return {drawer:false};
    const cr=c.getBoundingClientRect();
    const b=c.querySelector('.mantine-Drawer-body');
    return {drawer:true,
      header存在:!!c.querySelector('.mantine-Drawer-header'),
      body到抽屉顶:b? Math.round(b.getBoundingClientRect().top-cr.top) : null,
      内嵌标题:[...c.querySelectorAll('*')].some(e=>e.textContent==='点位列表'&&e.children.length===0),
      内嵌关闭:!!c.querySelector('[aria-label="收起"]'),
      列表行:document.querySelectorAll('.ubr-row').length};
  })()`);
  check('列表态无header·有内嵌入口', listState,
    listState.drawer && listState.header存在 === false && listState.body到抽屉顶 === 0
    && listState.内嵌标题 && listState.内嵌关闭 && listState.列表行 > 100);

  // ⑦e2 列表滚动时搜索框与分类标签必须固定
  //   踩过的坑：Mantine 的 .mantine-Drawer-content 是 display:block，
  //   子元素上的 flex:1 / min-height:0 全部失效 —— Drawer body 被列表内容顶到全高
  //   （实测 8390px），滚动落到最外层 content 上，搜索框和标签会跟着一起滚走。
  //   修法：把 content 显式设成 flex column + overflow hidden，高度链才能逐层传下去。
  const scrollFix = await ev(`(async()=>{
    const topOf=(sel)=>{const e=document.querySelector(sel); return e? Math.round(e.getBoundingClientRect().top):null};
    const lastTop=()=>{const r=[...document.querySelectorAll('.ubr-row')];
      return r.length? Math.round(r[r.length-1].getBoundingClientRect().top):null};
    const list=document.querySelector('.ubr-list');
    const dc=document.querySelector('.mantine-Drawer-content');
    if(!list||!dc) return {found:false};
    const before={search:topOf('.mantine-TextInput-input'), tabs:topOf('.ubr-tabs'), last:lastTop()};
    list.scrollTop = 600;                       // 直接设 scrollTop，比合成滚轮稳定
    await new Promise(r=>setTimeout(r,350));
    const after={search:topOf('.mantine-TextInput-input'), tabs:topOf('.ubr-tabs'), last:lastTop(),
      listScrolled: Math.round(list.scrollTop)};
    return {found:true, before, after,
      列表是滚动容器: list.scrollHeight > list.clientHeight,
      content可滚: dc.scrollHeight > dc.clientHeight};
  })()`, true);
  check('搜索与标签固定·仅列表滚动', scrollFix,
    scrollFix.found
    && scrollFix.before.search === scrollFix.after.search   // 搜索框不动
    && scrollFix.before.tabs === scrollFix.after.tabs       // 标签栏不动
    && scrollFix.after.listScrolled > 0                     // 列表确实滚了
    && scrollFix.before.last !== scrollFix.after.last
    && scrollFix.列表是滚动容器 === true
    && scrollFix.content可滚 === false);                    // 最外层不再滚动

  const inlineClose = await ev(`(async()=>{
    document.querySelector('.mantine-Drawer-content [aria-label="收起"]')?.click();
    await new Promise(r=>setTimeout(r,1100));
    return {已关:!document.querySelector('.mantine-Drawer-content')};
  })()`, true);
  check('内嵌关闭按钮可用', inlineClose, inlineClose.已关 === true);

  await openList();
  await pressEsc();
  const escClosed = await ev(`!document.querySelector('.mantine-Drawer-content')`);
  check('ESC 可关闭', escClosed, escClosed === true);

  // 详情态：无 header、无空档、内嵌关闭可用、无 Leaflet 版权条
  const detailHeader = await ev(`(async()=>{
    const attribution={控件数:document.querySelectorAll('.leaflet-control-attribution').length,
      含Leaflet字样:document.body.innerText.includes('Leaflet')};
    const pin=document.querySelector('.pin-ubr');
    if(!pin) return {pin:false, attribution};
    const r=pin.getBoundingClientRect();
    for(const ty of ['mousedown','mouseup','click'])
      pin.dispatchEvent(new MouseEvent(ty,{clientX:r.left+r.width/2,clientY:r.top+r.height/2,
        bubbles:true,cancelable:true,view:window,button:0}));
    await new Promise(x=>setTimeout(x,1700));
    const h=document.querySelector('.mantine-Drawer-header');
    const c=document.querySelector('.mantine-Drawer-content');
    const b=document.querySelector('.mantine-Drawer-body');
    const cr=c?.getBoundingClientRect(), br=b?.getBoundingClientRect();
    const cs=c? getComputedStyle(c) : null;
    return {pin:true, attribution,
      header存在:!!h, header高:h?Math.round(h.getBoundingClientRect().height):0,
      header到body的间距:(cr&&br)? Math.round(br.top-cr.top) : null,
      内嵌关闭:!!document.querySelector('.ubr-detail-close'),
      下圆角: cs? [cs.borderBottomLeftRadius, cs.borderBottomRightRadius] : null,
      贴底: cr? Math.abs(cr.bottom-innerHeight)<2 : null,
      标题:document.querySelector('.ubr-detail-name')?.textContent||null};
  })()`, true);
  check('详情无header·下沿方角·无版权条', detailHeader,
    detailHeader.pin && detailHeader.attribution.控件数 === 0 && !detailHeader.attribution.含Leaflet字样
    && detailHeader.header存在 === false && detailHeader.header到body的间距 === 0
    && detailHeader.内嵌关闭 === true && !!detailHeader.标题
    && detailHeader.贴底 === true
    && (detailHeader.下圆角||[]).every((v)=>parseFloat(v) === 0));
  await pressEsc();

  // ⑦f 打卡点标记形态：路线类型显示序号，其余显示「缩略图 + 名称」
  //   存储用的 seq 是全局递增的（所有打卡点共用一套），直接显示会出现
  //   "只有一个路线点却显示 7"。所以序号按路线自身重新从 1 编号。
  await resetServerData()
  const kindToken = await adminToken()
  const mkPoint = (name, kind, lng, lat) =>
    fetch(`${BASE_URL}/api/checkins`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${kindToken}` },
      body: JSON.stringify({ name, kind, rating: 4, note: '测试', lng, lat }),
    }).then((r) => r.json())

  // 交错创建：普通点先占掉 seq=1，路线点拿到 2/4/5 —— 用于验证序号会被重编为 1/2/3
  await mkPoint('城堡机位', '必拍机位', 116.6838, 39.8562)
  await mkPoint('路线·入口', '路线', 116.6810, 39.8550)
  await mkPoint('黄油啤酒摊', '美食', 116.6845, 39.8558)
  await mkPoint('路线·城堡', '路线', 116.6835, 39.8565)
  await mkPoint('路线·出园', '路线', 116.6860, 39.8545)

  await reload();
  const kindMix = await ev(`(()=>{
    const pills=[...document.querySelectorAll('.pin-ck-lbl .cklbl')];
    const seqs=[...document.querySelectorAll('.pin-ck-seq .num')].map(n=>n.textContent.trim());
    const names=pills.map(e=>e.querySelector('.nm')?.textContent||'');
    return {
      胶囊数: pills.length,
      序号图钉数: document.querySelectorAll('.pin-ck-seq').length,
      序号: seqs,
      名称: names,
      名称里没有数字: names.every((n)=>!/^\\d+\\./.test(n)),
      兜底色: (()=>{const t=document.querySelector('.pin-ck-lbl .thumb');
        return t? getComputedStyle(t).backgroundColor : null})(),
    };
  })()`);
  check('打卡点标记形态（路线序号）', kindMix,
    kindMix.胶囊数 === 2 && kindMix.序号图钉数 === 3
    && JSON.stringify(kindMix.序号) === JSON.stringify(['1','2','3'])   // 按路线重编，不是 2/4/5
    && kindMix.名称.includes('城堡机位') && kindMix.名称.includes('黄油啤酒摊')
    && kindMix.名称里没有数字);

  // 列表同样只在路线类型前加序号
  await openList();
  await ev(`(async()=>{
    [...document.querySelectorAll('.ubr-tabs .mantine-Badge-root')].find(b=>b.textContent.includes('我的打卡'))?.click();
    await new Promise(r=>setTimeout(r,900)); return 1})()`, true);
  const listSeq = await ev(`(()=>{
    const names=[...document.querySelectorAll('.ubr-row-name')].map(n=>n.textContent.trim());
    return {names, 带序号: names.filter((t)=>/^\\d+\\./.test(t))};
  })()`);
  check('列表仅路线带序号', listSeq,
    listSeq.带序号.length === 3
    && listSeq.带序号.every((t) => t.includes('路线·'))
    && listSeq.names.some((t) => t === '城堡机位'));

  // 由官网点位转来的打卡点：没实拍图时用官方 64×64 小图兜底
  const fromPoi = await ev(`(async()=>{
    const p=document.querySelector('.pin-ubr');
    if(!p) return {pin:false};
    const r=p.getBoundingClientRect();
    for(const ty of ['mousedown','mouseup','click'])
      p.dispatchEvent(new MouseEvent(ty,{clientX:r.left+r.width/2,clientY:r.top+r.height/2,
        bubbles:true,cancelable:true,view:window,button:0}));
    await new Promise(x=>setTimeout(x,1700));
    const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('加入打卡清单'));
    if(!btn) return {pin:true, button:false};
    btn.click(); await new Promise(x=>setTimeout(x,1600));
    const el=[...document.querySelectorAll('.pin-ck-lbl .thumb img')];
    return {pin:true, button:true, 标记图数:el.length,
      任一来自官网小图: el.some(i=>String(i.getAttribute('src')).includes('/marker/'))};
  })()`, true);
  check('官网转来的点用官方小图', fromPoi,
    fromPoi.pin && fromPoi.button && fromPoi.标记图数 > 0 && fromPoi.任一来自官网小图);

  await pressEsc();
  await resetServerData();

  // ⑧ 分类标签是 Mantine Badge，tab 式：切标签只换列表，不动地图
  await reload();
  await openList();
  const tabs = await ev(`(async()=>{
    const tabs=()=>[...document.querySelectorAll('.ubr-tabs .mantine-Badge-root')];
    const initial={n:tabs().length, dots:document.querySelectorAll('.ubr-badge-dot').length,
      rows:document.querySelectorAll('.ubr-row').length, markers:document.querySelectorAll('.pin-ubr').length,
      isBadge: tabs().length>0 && tabs()[0].className.includes('mantine-Badge-root')};

    const click=(txt)=>tabs().find(b=>b.textContent.includes(txt))?.click();
    click('餐饮'); await new Promise(r=>setTimeout(r,700));
    const foodRows=[...document.querySelectorAll('.ubr-row')];
    const foodCats=[...new Set(foodRows.map(r=>r.querySelector('.ubr-row-meta span')?.textContent).filter(Boolean))];
    const afterFood={rows:foodRows.length, cats:foodCats, markers:document.querySelectorAll('.pin-ubr').length};

    click('我的打卡'); await new Promise(r=>setTimeout(r,700));
    const afterMine={rows:document.querySelectorAll('.ubr-row').length,
      empty:document.body.innerText.includes('还没有打卡点'),
      markers:document.querySelectorAll('.pin-ubr').length};

    click('全部'); await new Promise(r=>setTimeout(r,700));
    return {initial, afterFood, afterMine, afterAll:{rows:document.querySelectorAll('.ubr-row').length}};
  })()`, true);
  check('分类标签用 Badge·不动地图', tabs,
    tabs.initial.isBadge && tabs.initial.n === 8 && tabs.initial.dots === 7
    && tabs.afterFood.rows === 50 && tabs.afterFood.cats.length === 1 && tabs.afterFood.cats[0] === '餐饮'
    && tabs.afterFood.markers === tabs.initial.markers
    && tabs.afterMine.rows === 0 && tabs.afterMine.empty
    && tabs.afterMine.markers === tabs.initial.markers
    && tabs.afterAll.rows > 100);

  // ⑨ 显示管理 Popover：挂在工具栏图标上，只控制地图显隐，不动列表
  //   点击外部关闭用真实鼠标事件验证 —— Mantine 的 Popover 监听 mousedown，
  //   合成 click 不会触发，会误判为"关不掉"。
  await reload();
  const visBtn = await rectOf('.ubr-map-tools button[aria-label="地图显示管理"]');
  await realClick(visBtn.x, visBtn.y);
  await sleep(800);
  const vis = await ev(`(()=>{
    const dd=document.querySelector('.mantine-Popover-dropdown');
    const sw=dd?[...dd.querySelectorAll('.mantine-Switch-root')]:[];
    return {popover:!!dd,
      isPopover: !!(dd && dd.className.includes('mantine-Popover-dropdown')),
      drawers:document.querySelectorAll('.mantine-Drawer-content').length,
      switches:sw.length, on:sw.filter(s=>s.querySelector('input')?.checked).length,
      hasTitle: dd? dd.textContent.includes('地图显示') : false,
      markers:document.querySelectorAll('.pin-ubr').length};
  })()`);
  check('显示管理为 Popover', vis,
    vis.popover && vis.isPopover && vis.drawers === 0
    && vis.switches === 7 && vis.on === 7 && vis.hasTitle);

  // 真实点击 Popover 外部 → 关闭
  await realClick(195, 700);
  await sleep(800);
  const popClosed = await ev(`!document.querySelector('.mantine-Popover-dropdown')`);
  check('点击外部关 Popover', popClosed, popClosed === true);

  // 关掉「餐饮」→ 地图少 50 个点，列表不受影响
  const visToggle = await ev(`(async()=>{
    const btn=document.querySelector('.ubr-map-tools button[aria-label="地图显示管理"]');
    btn.click(); await new Promise(r=>setTimeout(r,700));
    const before=document.querySelectorAll('.pin-ubr').length;
    const sw=[...document.querySelectorAll('.mantine-Popover-dropdown .mantine-Switch-root')]
      .find(s=>s.textContent.includes('餐饮'));
    if(!sw) return {sw:false};
    sw.querySelector('input').click();
    await new Promise(r=>setTimeout(r,800));
    const afterHide={markers:document.querySelectorAll('.pin-ubr').length,
      stillOpen:!!document.querySelector('.mantine-Popover-dropdown')};
    // 关掉 Popover 后开列表：列表应不受显隐影响
    document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));
    await new Promise(r=>setTimeout(r,600));
    const fab=[...document.querySelectorAll('.ubr-fab-stack button')].find(b=>b.textContent.includes('点位列表'));
    fab.click(); await new Promise(r=>setTimeout(r,900));
    const rows=[...document.querySelectorAll('.ubr-row')];
    const cats=[...new Set(rows.map(r=>r.querySelector('.ubr-row-meta span')?.textContent).filter(Boolean))];
    return {sw:true, before, afterHide, listRows:rows.length, listHasFood:cats.includes('餐饮'),
      markersStill:document.querySelectorAll('.pin-ubr').length};
  })()`, true);
  check('显隐开关生效·列表不受影响', visToggle,
    visToggle.sw && visToggle.afterHide.markers === visToggle.before - 50
    && visToggle.afterHide.stillOpen
    && visToggle.listRows > 100 && visToggle.listHasFood
    && visToggle.markersStill === visToggle.afterHide.markers);

  // ⑩ 落点建点 + 图片压缩入库
  await reload();
  const flow = await ev(`(async()=>{
    /* 关闭抽屉由外层的 pressEsc 负责，见各测试步骤 */

    [...document.querySelectorAll('.ubr-map-tools button')].find(b=>b.getAttribute('aria-label')==='添加打卡点').click();
    await new Promise(r=>setTimeout(r,300));
    const el=document.querySelector('.leaflet-container'), r=el.getBoundingClientRect();
    for(const ty of ['mousedown','mouseup','click'])
      el.dispatchEvent(new MouseEvent(ty,{clientX:r.left+r.width/2,clientY:r.top+r.height*0.4,bubbles:true,cancelable:true,view:window,button:0}));
    await new Promise(r=>setTimeout(r,800));
    const setV=(e,v)=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(e,v);
      e.dispatchEvent(new Event('input',{bubbles:true}))};
    const inp=[...document.querySelectorAll('input')].filter(i=>i.type==='text').pop();
    if(!inp) return {form:false};
    setV(inp,'自检机位'); await new Promise(r=>setTimeout(r,250));

    const c=document.createElement('canvas'); c.width=2000; c.height=1500;
    const x=c.getContext('2d'); x.fillStyle='#4a7fae'; x.fillRect(0,0,2000,1500);
    const big=await new Promise(r=>c.toBlob(r,'image/jpeg',0.92));
    const input=document.querySelector('input[type=file]');
    const dt=new DataTransfer(); dt.items.add(new File([big],'p.jpg',{type:'image/jpeg'}));
    input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,2500));

    [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存')?.click();
    await new Promise(r=>setTimeout(r,1300));

    const list=((await (await fetch('/api/checkins')).json()).results||[]);
    return {form:true, marks:list.length, name:list[0]?.name,
      hasPhoto:!!list[0]?.photoUrl, photos:list.filter(x=>x.photoUrl).length};
  })()`, true);
  check('落点建点+照片上传', flow,
    flow.form && flow.marks === 1 && flow.hasPhoto && flow.photos === 1);

  // ⑩2 支持直接粘贴截图上传
  //   桌面端截图工具会把图放进剪贴板，用户期望 Ctrl/⌘+V 就能贴上。
  //   监听挂在 document 上（不要求先聚焦某个元素），且只在剪贴板确实含图片时拦截，
  //   纯文本粘贴必须照常放行，否则会影响备注输入。
  await pressEsc()
  const pasteFlow = await ev(`(async()=>{
    // 重新进入编辑表单
    [...document.querySelectorAll('.ubr-map-tools button')]
      .find(b=>b.getAttribute('aria-label')==='添加打卡点')?.click();
    await new Promise(r=>setTimeout(r,400));
    const el=document.querySelector('.leaflet-container'), r=el.getBoundingClientRect();
    for(const ty of ['mousedown','mouseup','click'])
      el.dispatchEvent(new MouseEvent(ty,{clientX:r.left+r.width/2,clientY:r.top+r.height*0.35,
        bubbles:true,cancelable:true,view:window,button:0}));
    await new Promise(r=>setTimeout(r,900));

    const drop=document.querySelector('.ubr-photo-drop');
    const hint = drop? drop.innerText.replace(/\\s+/g,' ').trim() : null;

    // 造一张 1400x900 的 PNG，文件名模仿截图工具
    const c=document.createElement('canvas'); c.width=1400; c.height=900;
    const x=c.getContext('2d'); x.fillStyle='#0f7fc4'; x.fillRect(0,0,1400,900);
    const blob=await new Promise(rr=>c.toBlob(rr,'image/png'));

    // 纯文本粘贴不应被 preventDefault
    const textDt=new DataTransfer(); textDt.setData('text/plain','普通文本');
    const notCancelled=document.dispatchEvent(
      new ClipboardEvent('paste',{clipboardData:textDt,bubbles:true,cancelable:true}));

    // 粘贴图片
    const dt=new DataTransfer();
    dt.items.add(new File([blob],'image.png',{type:'image/png'}));
    document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
    await new Promise(rr=>setTimeout(rr,2600));

    const imgs=[...document.querySelectorAll('.ubr-pane img')];
    const info=[...document.querySelectorAll('.ubr-pane *')]
      .map(e=>e.textContent||'').find(t=>t.includes('已压缩为'));

    // 名字填好再保存，供后面核对服务端
    const setV=(e,v)=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(e,v);
      e.dispatchEvent(new Event('input',{bubbles:true}))};
    const inp=[...document.querySelectorAll('input')].filter(i=>i.type==='text').pop();
    if(inp) setV(inp,'粘贴截图测试');
    await new Promise(rr=>setTimeout(rr,250));
    [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存')?.click();
    await new Promise(rr=>setTimeout(rr,2200));

    const list=((await (await fetch('/api/checkins')).json()).results||[])
      .filter(m=>m.name==='粘贴截图测试');
    return {hint, 文本粘贴未被拦截:notCancelled,
      预览已解码: imgs[0]? (imgs[0].complete&&imgs[0].naturalWidth>0) : null,
      压缩信息: info? info.trim().slice(-40) : null,
      原始KB: Math.round(blob.size/1024),
      服务端尺寸: list[0]? list[0].photoW+'×'+list[0].photoH : null,
      服务端类型: list[0]?.photoType ?? null};
  })()`, true);
  check('粘贴截图上传', pasteFlow,
    !!pasteFlow.hint && pasteFlow.hint.includes('粘贴')
    && pasteFlow.文本粘贴未被拦截 === true       // 不能把普通文本也吞掉
    && pasteFlow.预览已解码 === true
    && pasteFlow.服务端尺寸 === '1400×900'       // 原图尺寸保留
    && pasteFlow.服务端类型 === 'image/webp');    // 走的是同一套压缩链路

  // ⑪ 详情：可见、不被卡片遮挡、无经纬度
  const detail = await ev(`(async()=>{
    /* 关闭抽屉由外层的 pressEsc 负责，见各测试步骤 */

    const pin=document.querySelector('.pin-ubr');
    if(!pin) return {pin:false};
    const pr=pin.getBoundingClientRect();
    for(const ty of ['mousedown','mouseup','click'])
      pin.dispatchEvent(new MouseEvent(ty,{clientX:pr.left+pr.width/2,clientY:pr.top+pr.height/2,
        bubbles:true,cancelable:true,view:window,button:0}));
    await new Promise(r=>setTimeout(r,1700));

    const inView=(sel)=>{const e=document.querySelector(sel); if(!e) return null;
      const b=e.getBoundingClientRect();
      return b.top>=0 && b.bottom<=innerHeight && b.left>=0 && b.right<=innerWidth && b.width>0};
    const dc=document.querySelector('.mantine-Drawer-content');
    const dr=dc?.getBoundingClientRect();
    const act=[...document.querySelectorAll('.pin-ubr')].find(p=>p.classList.contains('act'));
    const ar=act?act.getBoundingClientRect():null;
    const img=document.querySelector('.ubr-detail-thumb');
    const link=document.querySelector('.ubr-detail-extlink');
    const text=document.body.innerText;
    return {
      pin:true, drawer:!!dc,
      标题:document.querySelector('.ubr-detail-name')?.textContent||null,
      标题在视口:inView('.ubr-detail-name'),
      图本地:!!(img && !img.getAttribute('src').startsWith('http')),
      图已解码:img?(img.complete&&img.naturalWidth>0):null,
      图在视口:inView('.ubr-detail-thumb'),
      图尺寸:img?[Math.round(img.getBoundingClientRect().width),Math.round(img.getBoundingClientRect().height)]:null,
      点位在卡片上方: ar? ar.top < dr.top : null,
      卡片占屏比: dr? +(dr.height/innerHeight*100).toFixed(0) : null,
      外链在标题右侧: !!(link && document.querySelector('.ubr-detail-name')
        && link.getBoundingClientRect().left >= document.querySelector('.ubr-detail-name').getBoundingClientRect().right - 2),
      含LNG:text.includes('LNG'), 含LAT:/\\bLAT\\b/.test(text),
      含坐标数字:/116\\.\\d{3,}/.test(text)||/39\\.8\\d{3,}/.test(text)
    };
  })()`, true);
  check('详情可见·不遮挡·无经纬度', detail,
    detail.pin && detail.drawer && detail.标题在视口 && detail.图本地 && detail.图已解码 && detail.图在视口
    && Array.isArray(detail.图尺寸) && detail.图尺寸[0] >= 110
    && detail.点位在卡片上方 === true && detail.卡片占屏比 <= 40 && detail.外链在标题右侧
    && !detail.含LNG && !detail.含LAT && !detail.含坐标数字);

  // ⑪2 缩略图点击查看大图
  //   关键断言是「ESC 一次只关大图」—— 踩过的坑：Drawer 与 Modal 各自独立使用时，
  //   Mantine 的 ESC 监听都注册在 window 的 capture 阶段，同一个事件会触发两边 onClose，
  //   表现为"看大图按 ESC，底下的详情也一起没了"。
  //   修法是大图打开时把 Drawer 的 closeOnEscape 关掉，由上层显式协调。
  const lightbox = await ev(`(async()=>{
    const thumbBtn=document.querySelector('.ubr-detail-thumb-btn');
    if(!thumbBtn) return {thumb:false};
    const thumbImg=thumbBtn.querySelector('img');
    const thumbRect=thumbImg.getBoundingClientRect();
    const affordance={ cursor:getComputedStyle(thumbBtn).cursor,
      aria:thumbBtn.getAttribute('aria-label'),
      hint:!!thumbBtn.querySelector('.zoom-hint') };

    thumbBtn.click();
    await new Promise(r=>setTimeout(r,1400));
    const big=document.querySelector('.ubr-lightbox-img');
    if(!big) return {thumb:true, opened:false};
    const br=big.getBoundingClientRect();
    const inner=document.querySelector('.mantine-Modal-inner');
    const opened={ 原图:big.naturalWidth+'×'+big.naturalHeight,
      显示:Math.round(br.width)+'×'+Math.round(br.height),
      放大倍数:+(br.width/Math.max(1,thumbRect.width)).toFixed(1),
      在视口内: br.top>=0 && br.bottom<=innerHeight && br.left>=0 && br.right<=innerWidth,
      zIndex: inner? getComputedStyle(inner).zIndex : null,
      标题: document.querySelector('.mantine-Modal-title')?.textContent||null };

    // ESC 一次：只应关掉大图
    return {thumb:true, opened, affordance};
  })()`, true);
  await pressEsc();
  const afterEsc1 = await ev(`({大图:!!document.querySelector('.ubr-lightbox-img'),
    详情:!!document.querySelector('.ubr-detail-name'),
    抽屉:!!document.querySelector('.mantine-Drawer-content')})`);
  await pressEsc();
  const afterEsc2 = await ev(`!!document.querySelector('.mantine-Drawer-content')`);

  check('缩略图点击看大图', lightbox,
    lightbox.thumb && lightbox.opened
    && lightbox.affordance.cursor === 'zoom-in'       // 有明确的可点击提示
    && lightbox.affordance.aria === '查看大图'
    && lightbox.affordance.hint
    && lightbox.opened.在视口内 === true               // 大图不能溢出屏幕
    && lightbox.opened.放大倍数 > 1                   // 确实比缩略图大
    && Number(lightbox.opened.zIndex) > 200           // 必须盖在 Drawer(200) 之上
    && afterEsc1.大图 === false                        // 一次 ESC 关大图
    && afterEsc1.详情 === true && afterEsc1.抽屉 === true   // 详情不能跟着一起关
    && afterEsc2 === false);                           // 二次 ESC 才关详情

  // ⑫ Mantine Drawer 动效：进场需有中间帧，退场后节点移除
  //   必须先收起可能残留的详情抽屉，否则 fab 处于隐藏态，
  //   对它 .click() 只是重新"打开"一个已开的抽屉，不会有进场动画。
  await pressEsc();
  const anim = await ev(`(async()=>{
    const fab=()=>[...document.querySelectorAll('.ubr-fab-stack button')].find(b=>b.textContent.includes('点位列表'));
    const dc=()=>document.querySelector('.mantine-Drawer-content');
    if(!fab()) return {why:'找不到点位列表按钮'};

    fab().click();
    // 采样点要跨过整段过渡（Mantine 默认 280ms），过早采样只会拿到起始值
    const samples=[];
    let prev=0;
    for(const d of [80,160,260,400]){
      await new Promise(r=>setTimeout(r,d-prev)); prev=d;
      const el=dc();
      samples.push(el? getComputedStyle(el).transform : null);
    }
    await new Promise(r=>setTimeout(r,700));
    const settled=dc()? getComputedStyle(dc()).transform : null;
    // 必须在抽屉仍开着时判定按钮隐藏状态
    const fabHiddenWhileOpen=document.querySelector('.ubr-fab-stack')?.classList.contains('hidden');

    // 退场由下面的键事件触发
    await new Promise(r=>setTimeout(r,20));
    const during=!!dc();
    await new Promise(r=>setTimeout(r,900));
    const after=!!dc();
    return {samples, settled, 有中间帧:samples.some(t=>t && t!==settled),
            退场有过渡:during, 退场后移除:!after, fabHiddenWhileOpen,
            按钮恢复:!document.querySelector('.ubr-fab-stack')?.classList.contains('hidden')};
  })()`, true);
  // anim 的 ev 内部已把测量点摆在"抽屉开着"，这里补一次真实 ESC 触发退场
  await pressEsc();
  const animExit = await ev(`!document.querySelector('.mantine-Drawer-content')`);
  anim.退场后移除 = animExit;
  anim.按钮恢复 = await ev(`!document.querySelector('.ubr-fab-stack')?.classList.contains('hidden')`);
  check('Drawer 动效', anim,
    anim.有中间帧 && anim.退场有过渡 && anim.退场后移除
    && anim.fabHiddenWhileOpen === true && anim.按钮恢复 === true);

  // ⑬ 服务端共享：数据必须来自服务端，另一个客户端才能看到
  //   改造前打卡点只在 localStorage/IndexedDB，别人打开页面什么都看不到。
  //   这里清掉浏览器本地存储后重新加载 —— 若数据仍显示，说明确实来自服务端。
  const sharing = await (async () => {
    await resetServerData()
    const token = await adminToken()
    const created = await fetch(`${BASE_URL}/api/checkins`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: '他人标注的机位', kind: '必拍机位', rating: 4,
        note: '由另一个客户端写入', lng: 116.6838, lat: 39.8562,
      }),
    }).then((r) => r.json())

    // 清空本机存储：模拟"换一台设备/换一个浏览器"
    await ev(`(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} return 1 })()`)
    await send('Page.navigate', { url: PAGE_URL })
    await sleep(5500)

    const seen = await ev(`(() => ({
      本地无数据: !localStorage.getItem('ubr_checkin_v1'),
      地图标记: document.querySelectorAll('.pin-ck').length,
      连接提示: !!document.querySelector('.ubr-conn-error'),
    }))()`)

    // 展开列表，确认也能看到
    await ev(`(async()=>{
      [...document.querySelectorAll('.ubr-fab-stack button')].find(b=>b.textContent.includes('点位列表'))?.click();
      await new Promise(r=>setTimeout(r,1000));
      [...document.querySelectorAll('.ubr-tabs .mantine-Badge-root')].find(b=>b.textContent.includes('我的打卡'))?.click();
      await new Promise(r=>setTimeout(r,900));
      return 1})()`, true)
    const rows = await ev(`[...document.querySelectorAll('.ubr-row-name')].map(n=>n.textContent.trim())`)

    return { created: created?.name ?? null, seen, rows,
      名称匹配: rows.some((r) => r.includes('他人标注的机位')) }
  })()
  check('服务端共享·非本机数据可见', sharing,
    sharing.created === '他人标注的机位'
    && sharing.seen.本地无数据 === true      // 本机确实没有副本
    && sharing.seen.地图标记 === 1           // 但地图上有
    && sharing.名称匹配)                     // 列表里也有

  await resetServerData()   // 清理，避免影响后续手动使用

  console.log('\nconsole 异常:', exceptions.length ? exceptions.join(' | ') : '无');
  if (exceptions.length) failures.push('console异常');
  console.log(failures.length ? `\n✗ 失败项: ${failures.join(', ')}` : '\n全部通过');
  process.exitCode = failures.length ? 1 : 0;
}

main()
  .catch((e) => {
    console.error('验证失败:', e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    try { ws?.close(); } catch {}
    chrome.kill('SIGKILL');
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
    // 只关掉本脚本自己拉起来的服务端，不影响用户手动启动的那个
    if (serverProc) { try { serverProc.kill('SIGTERM'); } catch {} }
  });