/* 扣款管家 — 所有資料只存在這台裝置的瀏覽器儲存空間，不會傳送到任何伺服器 */
(() => {
'use strict';
const KEY = 'billkeeper.v1';
const VERSION = '1.0';
const CATS = { sub: '訂閱', card: '信用卡', water: '水費', power: '電費', gas: '瓦斯', other: '其他' };
const CYC = { 1: '每月', 2: '每 2 個月', 3: '每季', 6: '每半年', 12: '每年' };
const TITLES = { home: '總覽', items: '項目', records: '紀錄', stats: '統計', settings: '設定' };

const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => iso(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const addMonth = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

/* ---------- 資料 ---------- */
const blank = () => ({ v: 1, items: [], records: [], settings: { pin: null, salt: null, remindDays: 1, hideAmount: false } });
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.items) && Array.isArray(s.records)) { s.settings = Object.assign(blank().settings, s.settings); return s; }
  } catch (e) { /* 第一次使用 */ }
  return blank();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('儲存失敗：裝置儲存空間不足'); }
}
let S = load();
let tab = 'home';
let recMonth = today().slice(0, 7);
let hiddenAt = 0;

const itemById = id => S.items.find(i => i.id === id);
/* 第 k 次扣款日；遇到小月自動改為該月最後一天 */
function occ(item, k) {
  const s = parse(item.start), day = s.getDate();
  const t = new Date(s.getFullYear(), s.getMonth() + k * item.interval, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return iso(t);
}
function nextOcc(item, from = today()) {
  for (let k = 0; k < 2400; k++) { const d = occ(item, k); if (d >= from) return d; }
  return null;
}
/* 把已經到期的扣款日自動產生成紀錄 */
function generate() {
  const t = today(), have = new Set(S.records.map(r => r.itemId + '|' + r.date));
  let n = 0;
  for (const it of S.items) {
    if (!it.active) continue;
    for (let k = 0; k < 2400; k++) {
      const d = occ(it, k);
      if (d > t) break;
      if (it.genFrom && d < it.genFrom) continue;
      if (have.has(it.id + '|' + d)) continue;
      const hasAmt = !it.variable && it.amount != null;
      S.records.push({ id: uid(), itemId: it.id, name: it.name, cat: it.cat, date: d,
        amount: hasAmt ? it.amount : null, status: hasAmt ? 'ok' : 'pending', note: '' });
      n++;
    }
  }
  if (n) save();
  return n;
}
const recName = r => (itemById(r.itemId) || r).name;
const recCat = r => (itemById(r.itemId) || r).cat;
const estOf = r => { const it = itemById(r.itemId); return it && it.amount != null ? it.amount : 0; };

/* ---------- 畫面 ---------- */
function render() {
  generate();
  $('#title').textContent = TITLES[tab];
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#view').innerHTML = ({ home, items, records, stats, settings })[tab]();
  document.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
}

function emptyState() {
  return `<div class="empty"><div class="em">🗓️</div>
    <p>還沒有任何扣款項目。<br>新增第一個項目，或先載入範例看看效果。</p>
    <div class="row-btns"><button class="btn primary" data-act="newItem">＋ 新增項目</button>
    <button class="btn" data-act="demo">載入範例資料</button></div></div>`;
}

function itemSub(it) {
  return [CATS[it.cat], CYC[it.interval], it.source].filter(Boolean).map(esc).join(' · ');
}
function amtText(it) {
  if (it.amount == null) return '金額未定';
  return (it.variable ? '約 ' : '') + money(it.amount);
}

function home() {
  if (!S.items.length) return emptyState();
  const t = today(), ym = t.slice(0, 7);
  let done = 0, coming = 0;
  for (const r of S.records) {
    if (r.date.slice(0, 7) !== ym || r.status === 'skip') continue;
    done += r.status === 'ok' ? r.amount : estOf(r);
  }
  const act = S.items.filter(i => i.active);
  const up = [];
  for (const it of act) {
    const n = nextOcc(it, t);
    if (!n) continue;
    up.push({ it, date: n, days: daysBetween(t, n) });
    for (let k = 0; k < 2400; k++) { const d = occ(it, k); if (d.slice(0, 7) > ym) break; if (d > t) coming += it.amount || 0; }
  }
  up.sort((a, b) => a.date.localeCompare(b.date));
  const perMonth = act.reduce((s, i) => s + (i.amount || 0) / i.interval, 0);
  const pend = S.records.filter(r => r.status === 'pending').sort((a, b) => b.date.localeCompare(a.date));

  let h = `<section class="hero"><div class="lab">${Number(ym.slice(5))} 月預計扣款</div>
    <div class="big num">${money(done + coming)}</div>
    <div class="split"><div><b class="num">${money(done)}</b><span>已到扣款日</span></div>
    <div><b class="num">${money(coming)}</b><span>本月尚未扣款</span></div>
    <div><b class="num">${money(perMonth)}</b><span>平均每月</span></div>
    <div><b class="num">${money(perMonth * 12)}</b><span>一年合計</span></div></div></section>`;

  if (pend.length) {
    h += `<h2 class="sec"><span>待填實際金額</span><span>${pend.length} 筆</span></h2><div class="list warnlist">` +
      pend.map(r => `<button class="li" data-act="rec" data-id="${r.id}"><span class="dot c-${recCat(r)}"></span>
        <span class="mid"><span class="nm">${esc(recName(r))}</span><span class="sb">${md(r.date)} 已到扣款日</span></span>
        <span class="rt"><span class="badge">填金額</span></span></button>`).join('') + `</div>`;
  }
  h += `<h2 class="sec"><span>接下來的扣款</span><span>${up.length} 項</span></h2>`;
  h += up.length ? `<div class="list">` + up.map(u => {
    const when = u.days === 0 ? '今天' : u.days === 1 ? '明天' : `${u.days} 天後`;
    return `<button class="li" data-act="item" data-id="${u.it.id}"><span class="dot c-${u.it.cat}"></span>
      <span class="mid"><span class="nm">${esc(u.it.name)}</span><span class="sb">${itemSub(u.it)}</span></span>
      <span class="rt"><span class="amt num">${amtText(u.it)}</span><br>
      <span class="${u.days <= 3 ? 'badge soon' : 'sb'}">${when} · ${md(u.date)}</span></span></button>`;
  }).join('') + `</div>` : `<p class="hint">目前沒有啟用中的項目。</p>`;
  return h;
}

function items() {
  if (!S.items.length) return emptyState();
  let h = '';
  for (const c of Object.keys(CATS)) {
    const arr = S.items.filter(i => i.cat === c).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'zh-Hant'));
    if (!arr.length) continue;
    const sum = arr.filter(i => i.active).reduce((s, i) => s + (i.amount || 0) / i.interval, 0);
    h += `<h2 class="sec"><span>${CATS[c]}</span><span class="num">每月約 ${money(sum)}</span></h2><div class="list">` +
      arr.map(it => {
        const n = it.active ? nextOcc(it) : null;
        return `<button class="li ${it.active ? '' : 'off'}" data-act="item" data-id="${it.id}"><span class="dot c-${it.cat}"></span>
          <span class="mid"><span class="nm">${esc(it.name)}</span>
          <span class="sb">${[CYC[it.interval], it.source].filter(Boolean).map(esc).join(' · ')}</span></span>
          <span class="rt"><span class="amt num">${amtText(it)}</span><br>
          <span class="sb">${it.active ? (n ? '下次 ' + md(n) : '') : '已停用'}</span></span></button>`;
      }).join('') + `</div>`;
  }
  return h;
}

function records() {
  const list = S.records.filter(r => r.date.slice(0, 7) === recMonth).sort((a, b) => b.date.localeCompare(a.date));
  const sum = list.filter(r => r.status === 'ok').reduce((s, r) => s + r.amount, 0);
  let h = `<div class="monthnav"><button data-act="mPrev" aria-label="上個月">‹</button>
    <div class="mt"><b>${recMonth.slice(0, 4)} 年 ${Number(recMonth.slice(5))} 月</b><span class="num">已記錄 ${money(sum)}</span></div>
    <button data-act="mNext" aria-label="下個月">›</button></div>`;
  if (!list.length) return h + `<div class="empty"><p>這個月沒有扣款紀錄。<br>到了扣款日，紀錄會自動出現在這裡。</p></div>`;
  return h + `<div class="list">` + list.map(r => {
    const right = r.status === 'pending' ? `<span class="badge">填金額</span>`
      : `<span class="amt num">${money(r.amount ?? estOf(r))}</span>${r.status === 'skip' ? '<br><span class="sb">已略過</span>' : ''}`;
    return `<button class="li ${r.status === 'skip' ? 'skip' : ''}" data-act="rec" data-id="${r.id}"><span class="dot c-${recCat(r)}"></span>
      <span class="mid"><span class="nm">${esc(recName(r))}</span>
      <span class="sb">${md(r.date)} · ${CATS[recCat(r)]}${r.note ? ' · ' + esc(r.note) : ''}</span></span>
      <span class="rt">${right}</span></button>`;
  }).join('') + `</div>`;
}

function stats() {
  if (!S.items.length) return emptyState();
  const ymNow = today().slice(0, 7), months = [];
  for (let i = 11; i >= 0; i--) months.push(addMonth(ymNow, -i));
  const tot = Object.fromEntries(months.map(m => [m, 0]));
  let yearSum = 0;
  for (const r of S.records) {
    if (r.status !== 'ok') continue;
    const m = r.date.slice(0, 7);
    if (m in tot) tot[m] += r.amount;
    if (m.slice(0, 4) === ymNow.slice(0, 4)) yearSum += r.amount;
  }
  const max = Math.max(1, ...Object.values(tot));
  let h = `<div class="card"><h3>近 12 個月實際扣款</h3><p class="hint">只計入已填金額的紀錄。${ymNow.slice(0, 4)} 年累計 <b class="num">${money(yearSum)}</b></p>` +
    months.map(m => `<div class="bar-row ${m === ymNow ? 'now' : ''}"><span class="lb num">${m.slice(2, 4)}/${m.slice(5)}</span>
      <span class="tr"><span class="fl" data-w="${(tot[m] / max * 100).toFixed(1)}"></span></span>
      <span class="vl num">${money(tot[m])}</span></div>`).join('') + `</div>`;

  const act = S.items.filter(i => i.active);
  const byCat = Object.keys(CATS).map(c => [c, act.filter(i => i.cat === c).reduce((s, i) => s + (i.amount || 0) / i.interval, 0)]).filter(x => x[1] > 0);
  const all = byCat.reduce((s, x) => s + x[1], 0) || 1, cmax = Math.max(1, ...byCat.map(x => x[1]));
  h += `<div class="card"><h3>各類別平均每月</h3><p class="hint">依啟用中項目的金額（變動項目用預估金額）換算成每月。</p>` +
    (byCat.length ? byCat.sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div class="bar-row wide"><span class="lb"><span class="dot c-${c}"></span>${CATS[c]}</span>
      <span class="tr"><span class="fl c-${c}" data-w="${(v / cmax * 100).toFixed(1)}"></span></span>
      <span class="vl num">${money(v)} <span class="lb">${Math.round(v / all * 100)}%</span></span></div>`).join('') : `<p class="hint">尚無金額資料。</p>`) + `</div>`;
  return h;
}

function settings() {
  const st = S.settings;
  const opt = [0, 1, 2, 3, 7].map(d => `<option value="${d}" ${st.remindDays === d ? 'selected' : ''}>${d === 0 ? '扣款當天早上 9 點' : `扣款前 ${d} 天早上 9 點`}</option>`).join('');
  return `<div class="card"><h3>扣款提醒（行事曆）</h3>
      <p class="hint">網頁 App 無法自己發通知，所以改成匯出行事曆檔，加入 iPhone 行事曆後就會在每個扣款日前自動提醒。新增或修改項目後，請重新匯出一次。</p>
      <label class="fld"><span>提醒時間</span><select id="remindDays">${opt}</select></label>
      <label class="chk"><input type="checkbox" id="hideAmount" ${st.hideAmount ? 'checked' : ''}>行事曆中不顯示金額</label>
      <button class="btn primary block" data-act="ics">匯出行事曆檔（.ics）</button></div>
    <div class="card"><h3>備份與還原</h3>
      <p class="hint">資料只存在這支手機。把 App 從主畫面刪除、或清除 Safari 網站資料時，紀錄會一起消失，建議定期匯出備份檔存到「檔案」App。</p>
      <div class="row-btns"><button class="btn" data-act="export">匯出備份</button><button class="btn" data-act="import">匯入備份</button></div></div>
    <div class="card"><h3>密碼鎖</h3>
      <p class="hint">${st.pin ? '已啟用。開啟 App 時需要輸入密碼。' : '設定後，開啟 App 時需要輸入 4–6 位數字密碼。'}這是畫面鎖，用來防止別人拿到手機時直接看到內容。</p>
      <div class="row-btns"><button class="btn" data-act="pinSet">${st.pin ? '變更密碼' : '設定密碼'}</button>
      ${st.pin ? '<button class="btn danger" data-act="pinOff">關閉密碼鎖</button>' : ''}</div></div>
    <div class="card"><h3>資料</h3>
      <p class="hint">目前有 ${S.items.length} 個項目、${S.records.length} 筆紀錄。</p>
      <button class="btn danger block" data-act="wipe">清除所有資料</button></div>
    <p class="hint" id="about">扣款管家 ${VERSION} · 所有資料只儲存在這台裝置，不會上傳。</p>`;
}

/* ---------- 表單 ---------- */
function openSheet(html) { $('#panel').innerHTML = html; $('#sheet').hidden = false; $('#panel').scrollTop = 0; }
function closeSheet() { $('#sheet').hidden = true; $('#panel').innerHTML = ''; }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.tm); toast.tm = setTimeout(() => { t.hidden = true; }, 2600);
}

function itemForm(id) {
  const it = id ? itemById(id) : { name: '', cat: 'sub', source: '', interval: 1, start: today(), variable: false, amount: null, note: '', active: true };
  const sel = (o, cur) => Object.entries(o).map(([k, v]) => `<option value="${k}" ${String(cur) === k ? 'selected' : ''}>${v}</option>`).join('');
  openSheet(`<form id="itemForm" data-id="${id || ''}" autocomplete="off"><h2>${id ? '編輯項目' : '新增項目'}</h2>
    <label class="fld"><span>名稱</span><input type="text" name="name" required maxlength="40" placeholder="例如 Netflix、電費" value="${esc(it.name)}"></label>
    <div class="two"><label class="fld"><span>類別</span><select name="cat">${sel(CATS, it.cat)}</select></label>
    <label class="fld"><span>週期</span><select name="interval">${sel(CYC, it.interval)}</select></label></div>
    <label class="fld"><span>${id ? '下次扣款日' : '下次（或第一次）扣款日'}</span><input type="date" name="start" required value="${id ? (it.active ? nextOcc(it) : it.start) : it.start}"></label>
    <div class="seg"><label class="${it.variable ? '' : 'on'}"><input type="radio" name="variable" value="0" ${it.variable ? '' : 'checked'}>固定金額</label>
      <label class="${it.variable ? 'on' : ''}"><input type="radio" name="variable" value="1" ${it.variable ? 'checked' : ''}>每期金額不同</label></div>
    <label class="fld"><span id="amtLab">${it.variable ? '預估金額（可留空）' : '金額（新台幣）'}</span>
      <input type="number" name="amount" inputmode="decimal" min="0" step="any" value="${it.amount ?? ''}"></label>
    <label class="fld"><span>扣款來源（選填，請只寫末四碼，不要寫完整卡號或帳號）</span>
      <input type="text" name="source" maxlength="30" placeholder="例如 玉山卡 1234、郵局帳戶" value="${esc(it.source)}"></label>
    <label class="fld"><span>備註（選填）</span><input type="text" name="note" maxlength="80" value="${esc(it.note)}"></label>
    ${id ? `<label class="chk"><input type="checkbox" name="active" ${it.active ? 'checked' : ''}>啟用中（取消勾選＝停用，保留歷史紀錄）</label>` : ''}
    <p class="hint">${id ? '修改日期或週期只會影響之後的紀錄。' : '日期若填過去的日子，會自動補上從那天到今天的歷史紀錄。'}每期金額不同的項目，到了扣款日會提醒你填入實際金額。</p>
    <div class="row-btns"><button class="btn" type="button" data-act="close">取消</button><button class="btn primary" type="submit">儲存</button></div>
    ${id ? '<p><button class="link" type="button" data-act="delItem">刪除這個項目與它的所有紀錄</button></p>' : ''}</form>`);
}
function saveItem(f) {
  const id = f.dataset.id, d = new FormData(f);
  const name = String(d.get('name')).trim(), start = String(d.get('start'));
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(start)) { toast('請填寫名稱與扣款日'); return; }
  const variable = d.get('variable') === '1', raw = String(d.get('amount')).trim();
  const amount = raw === '' ? null : Math.max(0, Number(raw));
  if (!variable && amount == null) { toast('固定金額的項目請填寫金額'); return; }
  const v = { name, cat: String(d.get('cat')), interval: Number(d.get('interval')), start, variable, amount,
    source: String(d.get('source')).trim(), note: String(d.get('note')).trim() };
  if (id) {
    const it = itemById(id), wasNext = it.active ? nextOcc(it) : it.start;
    const active = d.get('active') === 'on';
    if (v.start !== wasNext || v.interval !== it.interval) v.genFrom = v.start < today() ? v.start : today();
    else { v.start = it.start; if (active && !it.active) v.genFrom = today(); }
    Object.assign(it, v, { active });
  } else {
    S.items.push(Object.assign({ id: uid(), active: true }, v));
  }
  save(); closeSheet(); render(); toast('已儲存');
}

function recForm(id) {
  const r = S.records.find(x => x.id === id); if (!r) return;
  const est = estOf(r);
  openSheet(`<form id="recForm" data-id="${id}" autocomplete="off"><h2>${esc(recName(r))}</h2>
    <p class="hint">${r.date.replace(/-/g, '/')} · ${CATS[recCat(r)]}${r.status === 'skip' ? ' · 已略過' : ''}</p>
    <label class="fld"><span>實際扣款金額</span><input type="number" name="amount" inputmode="decimal" min="0" step="any"
      value="${r.amount ?? ''}" placeholder="${est ? '預估 ' + est : ''}"></label>
    <label class="fld"><span>備註（選填）</span><input type="text" name="note" maxlength="80" value="${esc(r.note)}"></label>
    <div class="row-btns"><button class="btn" type="button" data-act="close">取消</button><button class="btn primary" type="submit">儲存</button></div>
    <p><button class="link" type="button" data-act="${r.status === 'skip' ? 'unskip' : 'skip'}" data-id="${id}">${r.status === 'skip' ? '恢復這筆紀錄' : '這期沒有扣款（略過，不計入統計）'}</button></p></form>`);
}
function saveRec(f) {
  const r = S.records.find(x => x.id === f.dataset.id), d = new FormData(f), raw = String(d.get('amount')).trim();
  r.note = String(d.get('note')).trim();
  if (raw === '') { r.amount = null; r.status = 'pending'; } else { r.amount = Math.max(0, Number(raw)); r.status = 'ok'; }
  save(); closeSheet(); render(); toast('已儲存');
}

/* ---------- 密碼鎖 ---------- */
async function sha(text) {
  if (window.crypto && crypto.subtle) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; for (const ch of text) h = (h * 33 ^ ch.codePointAt(0)) >>> 0; return 'x' + h.toString(16);
}
function pinForm() {
  openSheet(`<form id="pinForm" autocomplete="off"><h2>${S.settings.pin ? '變更密碼' : '設定密碼'}</h2>
    <label class="fld"><span>新密碼（4–6 位數字）</span><input type="password" name="p1" inputmode="numeric" pattern="[0-9]*" maxlength="6" required></label>
    <label class="fld"><span>再輸入一次</span><input type="password" name="p2" inputmode="numeric" pattern="[0-9]*" maxlength="6" required></label>
    <p class="hint">忘記密碼時無法找回，只能清除全部資料重來，所以請先匯出一份備份。</p>
    <div class="row-btns"><button class="btn" type="button" data-act="close">取消</button><button class="btn primary" type="submit">儲存</button></div></form>`);
}
async function savePin(f) {
  const d = new FormData(f), p1 = String(d.get('p1')), p2 = String(d.get('p2'));
  if (!/^\d{4,6}$/.test(p1)) { toast('密碼需為 4–6 位數字'); return; }
  if (p1 !== p2) { toast('兩次輸入的密碼不同'); return; }
  S.settings.salt = uid(); S.settings.pin = await sha(S.settings.salt + p1);
  save(); closeSheet(); render(); toast('密碼鎖已啟用');
}
function showLock() { $('#app').hidden = true; closeSheet(); $('#lock').hidden = false; $('#lockPin').value = ''; $('#lockMsg').textContent = ''; }
function unlock() { $('#lock').hidden = true; $('#app').hidden = false; render(); }

/* ---------- 匯出／匯入 ---------- */
async function saveFile(name, mime, text) {
  const file = new File([text], name, { type: mime });
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const stamp = () => today().replace(/-/g, '');
function exportBackup() {
  const data = { app: 'billkeeper', v: 1, exported: new Date().toISOString(), items: S.items, records: S.records };
  saveFile(`bills-backup-${stamp()}.json`, 'application/json', JSON.stringify(data, null, 1));
}
function importBackup(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (d.app !== 'billkeeper' || !Array.isArray(d.items) || !Array.isArray(d.records)) throw new Error('format');
      if (!confirm(`備份檔內有 ${d.items.length} 個項目、${d.records.length} 筆紀錄。\n匯入會取代目前的所有資料，確定嗎？`)) return;
      S.items = d.items; S.records = d.records; save(); render(); toast('已匯入備份');
    } catch (e) { toast('這不是扣款管家的備份檔'); }
  };
  rd.readAsText(file);
}

const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const enc = new TextEncoder(); let out = '', cur = '', bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > 73) { out += cur + '\r\n '; cur = ''; bytes = 1; }
    cur += ch; bytes += n;
  }
  return out + cur;
}
function buildIcs() {
  const st = S.settings, t = today(), L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BillKeeper//ZH-TW', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:扣款提醒'];
  const dt = s => s.replace(/-/g, '');
  const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const trig = st.remindDays === 0 ? 'PT9H' : `-PT${st.remindDays * 24 - 9}H`;
  let n = 0;
  for (const it of S.items) {
    if (!it.active) continue;
    const d = nextOcc(it, t); if (!d) continue;
    const day = parse(it.start).getDate(), end = iso(new Date(parse(d).getTime() + 36 * 3600000));
    let rule = `RRULE:FREQ=MONTHLY;INTERVAL=${it.interval};BYMONTHDAY=`;
    if (day <= 28) rule += day;
    else { const ds = []; for (let x = 28; x <= day; x++) ds.push(x); rule += ds.join(',') + ';BYSETPOS=-1'; }
    const amt = st.hideAmount || it.amount == null ? '' : ` ${it.variable ? '約' : ''}NT$${Math.round(it.amount)}`;
    const desc = [CATS[it.cat], CYC[it.interval], st.hideAmount ? '' : it.source, it.variable ? '金額每期不同，扣款後請到扣款管家填入實際金額' : ''].filter(Boolean).join(' / ');
    L.push('BEGIN:VEVENT', `UID:${it.id}@billkeeper.local`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${dt(d)}`, `DTEND;VALUE=DATE:${dt(end)}`, rule,
      `SUMMARY:${icsEsc('扣款：' + it.name + amt)}`, `DESCRIPTION:${icsEsc(desc)}`, 'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc('扣款提醒：' + it.name)}`, `TRIGGER:${trig}`, 'END:VALARM', 'END:VEVENT');
    n++;
  }
  L.push('END:VCALENDAR');
  return { n, text: L.map(fold).join('\r\n') + '\r\n' };
}
function exportIcs() {
  const { n, text } = buildIcs();
  if (!n) { toast('沒有啟用中的項目可以匯出'); return; }
  saveFile(`bills-reminders-${stamp()}.ics`, 'text/calendar', text);
}

/* ---------- 範例資料 ---------- */
function demo() {
  const t = new Date(), ago = (m, day) => iso(new Date(t.getFullYear(), t.getMonth() - m, day));
  const mk = (name, cat, interval, start, variable, amount, source) => ({ id: uid(), name, cat, interval, start, variable, amount, source, note: '範例', active: true });
  S.items.push(
    mk('Netflix', 'sub', 1, ago(7, 5), false, 390, '玉山卡 1234'),
    mk('Spotify', 'sub', 1, ago(7, 12), false, 149, '玉山卡 1234'),
    mk('iCloud+ 200GB', 'sub', 1, ago(7, 20), false, 90, '國泰卡 5678'),
    mk('網域年費', 'sub', 12, ago(10, 8), false, 450, '國泰卡 5678'),
    mk('玉山信用卡帳單', 'card', 1, ago(7, 15), true, 8000, '玉山帳戶 4321'),
    mk('電費', 'power', 2, ago(7, 18), true, 1800, '郵局帳戶'),
    mk('水費', 'water', 2, ago(6, 10), true, 420, '郵局帳戶'),
    mk('天然氣', 'gas', 2, ago(6, 25), true, 600, '郵局帳戶'));
  generate();
  const latest = {};
  for (const r of S.records) if (r.status === 'pending' && (!latest[r.itemId] || r.date > latest[r.itemId])) latest[r.itemId] = r.date;
  for (const r of S.records) {
    if (r.status !== 'pending' || r.date === latest[r.itemId]) continue;
    const e = estOf(r); r.amount = Math.round(e * (0.8 + Math.random() * 0.4)); r.status = 'ok';
  }
  save(); render(); toast('已載入範例資料，可到「設定」清除');
}

/* ---------- 事件 ---------- */
document.addEventListener('click', e => {
  const tb = e.target.closest('[data-tab]');
  if (tb) { tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'newItem': itemForm(); break;
    case 'item': itemForm(id); break;
    case 'rec': recForm(id); break;
    case 'close': closeSheet(); break;
    case 'demo': demo(); break;
    case 'mPrev': recMonth = addMonth(recMonth, -1); render(); break;
    case 'mNext': recMonth = addMonth(recMonth, 1); render(); break;
    case 'skip': case 'unskip': {
      const r = S.records.find(x => x.id === id);
      r.status = el.dataset.act === 'skip' ? 'skip' : (r.amount == null ? 'pending' : 'ok');
      save(); closeSheet(); render(); break;
    }
    case 'delItem': {
      const fid = $('#itemForm').dataset.id, it = itemById(fid);
      if (!confirm(`確定刪除「${it.name}」和它的所有紀錄嗎？\n如果只是不再扣款，建議改用「停用」保留歷史。`)) break;
      S.items = S.items.filter(i => i.id !== fid); S.records = S.records.filter(r => r.itemId !== fid);
      save(); closeSheet(); render(); toast('已刪除'); break;
    }
    case 'ics': exportIcs(); break;
    case 'export': exportBackup(); break;
    case 'import': $('#importFile').value = ''; $('#importFile').click(); break;
    case 'pinSet': pinForm(); break;
    case 'pinOff': if (confirm('確定關閉密碼鎖嗎？')) { S.settings.pin = null; S.settings.salt = null; save(); render(); } break;
    case 'wipe': case 'forgot':
      if (confirm('這會刪除這台裝置上的所有項目、紀錄和密碼，而且無法復原。確定嗎？')) {
        S = blank(); save(); tab = 'home'; unlock(); toast('已清除所有資料');
      } break;
  }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'itemForm') saveItem(f);
  else if (f.id === 'recForm') saveRec(f);
  else if (f.id === 'pinForm') savePin(f);
  else if (f.id === 'lockForm') {
    sha(S.settings.salt + $('#lockPin').value).then(h => {
      if (h === S.settings.pin) unlock();
      else { $('#lockMsg').textContent = '密碼不正確'; $('#lockPin').value = ''; }
    });
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'variable') {
    t.closest('.seg').querySelectorAll('label').forEach(l => l.classList.toggle('on', l.contains(t)));
    $('#amtLab').textContent = t.value === '1' ? '預估金額（可留空）' : '金額（新台幣）';
  } else if (t.id === 'remindDays') { S.settings.remindDays = Number(t.value); save(); }
  else if (t.id === 'hideAmount') { S.settings.hideAmount = t.checked; save(); }
  else if (t.id === 'importFile' && t.files[0]) importBackup(t.files[0]);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (S.settings.pin && hiddenAt && Date.now() - hiddenAt > 60000) showLock();
  else if (!$('#app').hidden && $('#sheet').hidden) render();
});

/* ---------- 啟動 ---------- */
if (S.settings.pin) showLock(); else unlock();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__bk = { buildIcs, state: () => S };
})();
