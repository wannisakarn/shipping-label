/* ใบปะหน้าพัสดุ 4x6 — ทำงานในเครื่อง (offline) */
'use strict';

/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : null; };
const money = n => (n == null || n === '') ? '' : Number(n).toLocaleString('th-TH', {minimumFractionDigits: 0, maximumFractionDigits: 2});
const pad = (n, l = 2) => String(n).padStart(l, '0');
const isBKK = p => /กรุงเทพ/.test(p || '');

function store(key, val) {
  try {
    if (val === undefined) { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) { return null; }
}
function toast(msg, isErr) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast', isErr ? 5000 : 2600);
}
function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 9) return d[1] === '2' ? `${d.slice(0,2)}-${d.slice(2,5)}-${d.slice(5)}` : `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return p || '';
}
function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('66') && d.length >= 11) d = '0' + d.slice(2);
  if (d.length === 9 && /^[689]/.test(d)) d = '0' + d; // พิมพ์หลัง +66 โดยไม่มี 0
  return d;
}
function fmtDate(iso) { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`; }
function fmtDateTime(iso) { const d = new Date(iso); return `${fmtDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function adminLine(r) {
  if (!r.district && !r.amphoe && !r.province) return '';
  return isBKK(r.province)
    ? [r.district && 'แขวง' + r.district, r.amphoe && 'เขต' + r.amphoe, r.province].filter(Boolean).join(' ')
    : [r.district && 'ต.' + r.district, r.amphoe && 'อ.' + r.amphoe, r.province && 'จ.' + r.province].filter(Boolean).join(' ');
}

/* ================= address database ================= */
const DB = [];
for (const p in window.TH_ADDR) for (const a in TH_ADDR[p]) for (const s of TH_ADDR[p][a]) {
  const [d, z] = s.split('|'); DB.push({d, a, p, z});
}
const PROVINCES = Object.keys(TH_ADDR);

/* ================= address parser ================= */
const ADDR_KW = /^(บ้านเลขที่|เลขที่|หมู่ที่|หมู่บ้าน|หมู่|ม\.|ซอย|ซ\.|ถนน|ถ\.|คอนโด|อาคาร|ตึก|ห้อง|ชั้น|โครงการ|บ้าน|ตรอก|แยก|ชุมชน|หอพัก|Condo|Village)/i;
const LABEL_WORDS = /(ชื่อผู้รับ|ผู้รับ|ชื่อ-สกุล|ชื่อ|เบอร์โทรศัพท์|เบอร์โทร|เบอร์|โทรศัพท์|โทร\.?|\bTel\.?|\bPhone|มือถือ|ที่อยู่จัดส่ง|ที่อยู่)\s*[:：]?/gi;

function removeLast(s, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m, last = null;
  while ((m = g.exec(s))) { last = m; if (m[0] === '') g.lastIndex++; }
  if (!last) return [s, false];
  return [s.slice(0, last.index) + ' ' + s.slice(last.index + last[0].length), true];
}

function parseAddress(raw) {
  const out = {name:'', phone:'', address:'', district:'', amphoe:'', province:'', zip:'', issues:[]};
  let lines = String(raw || '').replace(/\r/g, '').split('\n').map(x => x.trim()).filter(Boolean);
  if (!lines.length) return out;

  // บรรทัดแรกไม่มีตัวเลข และมีหลายบรรทัด → น่าจะเป็นชื่อ
  let presetName = '';
  if (lines.length > 1 && !/\d/.test(lines[0]) && lines[0].length <= 60) {
    presetName = lines.shift().replace(LABEL_WORDS, ' ').trim();
  }
  let s = ' ' + lines.join(' ') + ' ';
  s = s.replace(/[()（）\[\]]/g, ' ');

  // 1) เบอร์โทร
  const phoneRe = /(?<![\d/])(?:\+?\s?66|0)(?:[\s.-]?\d){8,9}(?![\d/])/g;
  let pm, phones = [];
  while ((pm = phoneRe.exec(s))) phones.push(pm);
  for (const m of phones) {
    const n = normPhone(m[0]);
    if (n.length === 10 || n.length === 9) { out.phone = n; s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); break; }
  }

  // 2) รหัสไปรษณีย์ (ตัวสุดท้ายที่เป็นเลข 5 หลัก)
  let zm, lastZ = null; const zipRe = /(?<![\d/-])\d{5}(?![\d/-])/g;
  while ((zm = zipRe.exec(s))) lastZ = zm;
  if (lastZ) { out.zip = lastZ[0]; s = s.slice(0, lastZ.index) + ' ' + s.slice(lastZ.index + 5); }

  // 3) หา ตำบล/อำเภอ/จังหวัด ที่เข้ากันที่สุด
  const ns = s.replace(/\s+/g, '');
  const hasBKK = /กทม|กรุงเทพ/.test(ns);
  let cands = out.zip ? DB.filter(e => e.z === out.zip) : DB;
  if (!cands.length) { cands = DB; out.issues.push(`ไม่พบรหัสไปรษณีย์ ${out.zip} ในฐานข้อมูล`); }

  let best = null, bestScore = 0;
  for (const e of cands) {
    let sc = out.zip && e.z === out.zip ? 2 : 0, hit = 0;
    if (ns.includes(e.p) || (hasBKK && e.p === 'กรุงเทพมหานคร')) { sc += 4; hit++; }
    if (ns.includes(e.a)) { sc += 3 + e.a.length * 0.02; hit++; if (new RegExp('(อำเภอ|อ\\.|เขต)' + reEsc(e.a)).test(ns)) sc += 1; }
    else if (e.a.startsWith('เมือง') && /(อำเภอ|อ\.)เมือง/.test(ns)) { sc += 2; hit++; }
    if (ns.includes(e.d)) { sc += 3 + e.d.length * 0.02; hit++; if (new RegExp('(ตำบล|ต\\.|แขวง)' + reEsc(e.d)).test(ns)) sc += 1; }
    if (!out.zip && hit < 2) continue; // ไม่มีรหัสไปรษณีย์ ต้องเจออย่างน้อย 2 ส่วน
    if (sc > bestScore) { bestScore = sc; best = e; }
  }
  if (best && bestScore >= 5) {
    out.district = best.d; out.amphoe = best.a; out.province = best.p; if (!out.zip) out.zip = best.z;
  } else if (out.zip) {
    // รู้แค่รหัสไปรษณีย์ — ถ้าอำเภอเดียวให้กรอกอำเภอ/จังหวัด
    const as = [...new Set(cands.map(e => e.a + '|' + e.p))];
    if (as.length === 1) { [out.amphoe, out.province] = as[0].split('|'); if (cands.length === 1) out.district = cands[0].d; }
    if (!out.district) out.issues.push('ระบุตำบล/แขวงไม่ได้ กรุณาเลือกเอง');
  } else {
    out.issues.push('ไม่พบรหัสไปรษณีย์ / ตำบล / อำเภอ กรุณาตรวจสอบ');
  }

  // 4) ลบส่วนที่ใช้แล้วออกจากข้อความ
  const sp = '\\s*';
  const loose = w => [...w].map(reEsc).join('\\s*');
  if (out.province) {
    [s] = removeLast(s, new RegExp(`(จังหวัด|จ\\.)?${sp}${loose(out.province)}`));
    if (isBKK(out.province)) s = s.replace(/(จังหวัด|จ\.)?\s*(กรุงเทพฯ?|กทม\.?)/g, ' ');
  }
  if (out.amphoe) {
    let ok; [s, ok] = removeLast(s, new RegExp(`(อำเภอ|อ\\.|เขต)?${sp}${loose(out.amphoe)}`));
    if (!ok && out.amphoe.startsWith('เมือง')) [s] = removeLast(s, /(อำเภอ|อ\.)\s*เมือง/);
  }
  if (out.district) [s] = removeLast(s, new RegExp(`(ตำบล|ต\\.|แขวง)?${sp}${loose(out.district)}`));
  s = s.replace(LABEL_WORDS, ' ')
       .replace(/(ตำบล|อำเภอ|จังหวัด|แขวง|เขต|ต\.|อ\.|จ\.)\s*(?=[,\s]|$)/g, ' ')
       .replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ')
       .replace(/(,\s*){2,}/g, ', ').replace(/^[\s,:-]+|[\s,:-]+$/g, '');

  // 5) แยกชื่อ กับ รายละเอียดที่อยู่
  if (presetName) { out.name = presetName; out.address = s; }
  else {
    const toks = s.split(' ');
    let i = toks.findIndex(t => /\d/.test(t) || ADDR_KW.test(t));
    if (i === -1) { out.name = s; out.address = ''; }
    else { out.name = toks.slice(0, i).join(' '); out.address = toks.slice(i).join(' '); }
    out.name = out.name.replace(/[,\s]+$/, '');
    out.address = out.address.replace(/^[,\s]+/, '');
  }
  if (!out.name) out.issues.push('หาชื่อผู้รับไม่เจอ');
  if (!out.phone) out.issues.push('หาเบอร์โทรไม่เจอ');
  return out;
}

/* ================= settings & records ================= */
const DEFAULT_SETTINGS = {
  senders: ['', '', ''],
  senderIdx: 0,
  senderAddr: '',
  senderPhone: '',
  showProduct: true,
};
let settings = Object.assign({}, DEFAULT_SETTINGS, store('sl.settings') || {});
let records = store('sl.records') || [];
let editingId = null;

function saveLocal() { store('sl.records', records); }
function saveSettings() { store('sl.settings', settings); }

function nextOrderNo() {
  const d = new Date(), pre = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
  const nums = records.filter(r => r.orderNo && r.orderNo.startsWith(pre)).map(r => parseInt(r.orderNo.split('-')[1]) || 0);
  return `${pre}-${pad((nums.length ? Math.max(...nums) : 0) + 1, 3)}`;
}

/* ================= Excel (File System Access API) ================= */
const HEADERS = ['เลขออเดอร์','วันที่','เวลา','ผู้ส่ง','ชื่อผู้รับ','เบอร์โทร','รายละเอียดที่อยู่','แขวง/ตำบล','เขต/อำเภอ','จังหวัด','รหัสไปรษณีย์','ที่อยู่เต็ม','ชื่อสินค้า','ยอดขาย','เลขพัสดุ','ค่าส่ง','ยอดหลังหักค่าส่ง','หมายเหตุ','ID'];
const KEYMAP = {'เลขออเดอร์':'orderNo','ผู้ส่ง':'sender','ชื่อผู้รับ':'name','เบอร์โทร':'phone','รายละเอียดที่อยู่':'address','แขวง/ตำบล':'district','เขต/อำเภอ':'amphoe','จังหวัด':'province','รหัสไปรษณีย์':'zip','ชื่อสินค้า':'product','ยอดขาย':'price','เลขพัสดุ':'tracking','ค่าส่ง':'ship','หมายเหตุ':'note','ID':'id'};

function buildWorkbook() {
  const rows = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const aoa = [HEADERS];
  for (const r of rows) {
    const d = new Date(r.createdAt);
    aoa.push([r.orderNo, fmtDate(r.createdAt), `${pad(d.getHours())}:${pad(d.getMinutes())}`, r.sender, r.name, fmtPhone(r.phone), r.address,
      r.district, r.amphoe, r.province, r.zip, [r.address, adminLine(r), r.zip].filter(Boolean).join(' '),
      r.product, r.price ?? '', r.tracking, r.ship ?? '', (r.price != null && r.ship != null) ? +(r.price - r.ship).toFixed(2) : '', r.note, r.id]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [12,11,6,16,22,13,36,14,14,14,8,56,24,10,18,8,12,20,14].map(w => ({wch: w}));
  ws['!autofilter'] = {ref: XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:Math.max(aoa.length-1,1), c:HEADERS.length-1}})};
  // เบอร์โทรและรหัสไปรษณีย์เป็นข้อความ (เก็บเลข 0 นำหน้า)
  for (let i = 1; i < aoa.length; i++) for (const c of [5, 10]) { const a = XLSX.utils.encode_cell({r:i, c}); if (ws[a]) { ws[a].t = 's'; ws[a].v = String(ws[a].v); } }

  // สรุปรายเดือน
  const byM = {};
  for (const r of rows) {
    const d = new Date(r.createdAt), k = `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
    const m = byM[k] ||= {n:0, sales:0, ship:0};
    m.n++; m.sales += r.price || 0; m.ship += r.ship || 0;
  }
  const sum = [['เดือน','จำนวนออเดอร์','ยอดขายรวม','ค่าส่งรวม','ยอดหลังหักค่าส่ง']];
  for (const k of Object.keys(byM).sort()) sum.push([k, byM[k].n, +byM[k].sales.toFixed(2), +byM[k].ship.toFixed(2), +(byM[k].sales - byM[k].ship).toFixed(2)]);
  const ws2 = XLSX.utils.aoa_to_sheet(sum); ws2['!cols'] = [{wch:10},{wch:14},{wch:14},{wch:12},{wch:18}];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ออเดอร์');
  XLSX.utils.book_append_sheet(wb, ws2, 'สรุปรายเดือน');
  return wb;
}

// IndexedDB เก็บ file handle
function idb() { return new Promise((res, rej) => { const q = indexedDB.open('sl-db', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function kvGet(k) { try { const db = await idb(); return await new Promise(r => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); } catch { return null; } }
async function kvSet(k, v) { try { const db = await idb(); await new Promise(r => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = r; t.onerror = r; }); } catch {} }

let xlHandle = null, xlDirty = false;
const fsSupported = 'showSaveFilePicker' in window;
const XL_TYPES = [{description: 'Excel', accept: {'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']}}];

function setPill(state, text) {
  const p = $('xlPill'); p.className = 'xl-pill ' + state; $('xlText').textContent = text;
  $('xlInfo').textContent = xlHandle ? `ไฟล์ที่ใช้อยู่: ${xlHandle.name}` : (fsSupported ? 'ยังไม่ได้เลือกไฟล์ — ข้อมูลยังเก็บในเบราว์เซอร์ กด "สร้างไฟล์ Excel ใหม่" เพื่อเริ่มบันทึกลงไฟล์' : 'เบราว์เซอร์นี้ไม่รองรับการเขียนไฟล์อัตโนมัติ (ใช้ Chrome หรือ Edge) — ใช้ปุ่ม "ดาวน์โหลด Excel" แทน');
}
function refreshPill() {
  if (!fsSupported) return setPill('warn', 'ใช้ Chrome/Edge เพื่อบันทึก Excel อัตโนมัติ');
  if (!xlHandle) return setPill('warn', 'ยังไม่เชื่อมไฟล์ Excel');
  if (xlDirty) return setPill('err', `ยังไม่ได้บันทึกลง ${xlHandle.name} — คลิกเพื่อลองใหม่`);
  setPill('ok', `Excel: ${xlHandle.name}`);
}

async function ensurePerm(h) {
  const o = {mode: 'readwrite'};
  if ((await h.queryPermission(o)) === 'granted') return true;
  return (await h.requestPermission(o)) === 'granted';
}
async function writeExcel() {
  if (!xlHandle) { refreshPill(); return false; }
  try {
    if (!(await ensurePerm(xlHandle))) throw new Error('ไม่ได้รับอนุญาตให้เขียนไฟล์');
    const buf = XLSX.write(buildWorkbook(), {bookType: 'xlsx', type: 'array'});
    const w = await xlHandle.createWritable();
    await w.write(new Uint8Array(buf)); await w.close();
    xlDirty = false; refreshPill(); return true;
  } catch (e) {
    xlDirty = true; refreshPill();
    const locked = /lock|busy|NoModification|InvalidState|being used/i.test(e.name + e.message);
    toast(locked ? 'บันทึก Excel ไม่ได้: กรุณาปิดไฟล์ Excel ที่เปิดค้างอยู่ แล้วคลิกปุ่มสีแดงด้านบน' : 'บันทึก Excel ไม่ได้: ' + e.message, true);
    return false;
  }
}
let syncTimer = null;
function scheduleSync() { saveLocal(); clearTimeout(syncTimer); syncTimer = setTimeout(writeExcel, 1200); }

async function xlCreateNew() {
  try {
    xlHandle = await showSaveFilePicker({suggestedName: 'ข้อมูลลูกค้า-ออเดอร์.xlsx', types: XL_TYPES, startIn: 'documents'});
    await kvSet('xlHandle', xlHandle);
    if (await writeExcel()) toast(`สร้างไฟล์ ${xlHandle.name} แล้ว`);
  } catch (e) { if (e.name !== 'AbortError') toast(e.message, true); }
}
async function xlOpenExisting() {
  try {
    [xlHandle] = await showOpenFilePicker({types: XL_TYPES});
    await kvSet('xlHandle', xlHandle);
    const file = await xlHandle.getFile();
    const wb = XLSX.read(await file.arrayBuffer(), {type: 'array', raw: false});
    const ws = wb.Sheets['ออเดอร์'] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {defval: '', raw: true});
    let added = 0;
    const byId = new Map(records.map(r => [r.id, r]));
    for (const row of rows) {
      const r = {};
      for (const h in KEYMAP) r[KEYMAP[h]] = row[h] ?? '';
      if (!r.name && !r.phone) continue;
      r.phone = normPhone(r.phone); r.zip = String(r.zip || '');
      r.price = num(r.price); r.ship = num(r.ship);
      r.id = String(r.id || ('x' + Math.random().toString(36).slice(2, 10)));
      const dm = String(row['วันที่'] || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/), tm = String(row['เวลา'] || '').match(/(\d{1,2}):(\d{2})/);
      r.createdAt = dm ? new Date(+dm[3], +dm[2]-1, +dm[1], tm ? +tm[1] : 0, tm ? +tm[2] : 0).toISOString() : new Date().toISOString();
      if (!byId.has(r.id)) { records.push(r); byId.set(r.id, r); added++; }
    }
    saveLocal();
    await writeExcel();
    renderHistory(); refreshProductList();
    toast(`เชื่อมไฟล์ ${xlHandle.name} แล้ว${added ? ` • นำเข้า ${added} รายการ` : ''}`);
  } catch (e) { if (e.name !== 'AbortError') toast('เปิดไฟล์ไม่ได้: ' + e.message, true); }
}
function downloadExcel() {
  const d = new Date();
  XLSX.writeFile(buildWorkbook(), `ข้อมูลลูกค้า-ออเดอร์_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.xlsx`);
}

/* ================= label rendering ================= */
function labelHTML(r) {
  const ph = (v, p) => v ? esc(v) : `<span class="placeholder">${p}</span>`;
  const zip = (r.zip || '').padEnd(5, ' ').slice(0, 5).split('').map(c => `<span>${c.trim() ? esc(c) : ''}</span>`).join('');
  const addr = [r.address].filter(Boolean).join(' ');
  const showProd = settings.showProduct && r.product;
  const foot = [showProd ? `<b>สินค้า:</b> ${esc(r.product)}` : '', r.note ? `<b>หมายเหตุ:</b> ${esc(r.note)}` : ''].filter(Boolean).join('<br>');
  return `<div class="label">
    <div class="lb-top"><span class="ord">ORDER #${esc(r.orderNo || '—')}</span><span>${fmtDate(r.createdAt || new Date().toISOString())}</span></div>
    <div class="lb-from"><span class="lb-tag">ผู้ส่ง</span><span class="nm">${ph(r.sender, 'ชื่อผู้ส่ง')}</span> &nbsp;โทร ${esc(fmtPhone(r.senderPhone))}<br>${esc(r.senderAddr)}</div>
    <div class="lb-to">
      <div><span class="lb-tag" style="font-size:12px;padding:1px 8px">ผู้รับ</span></div>
      <div class="nm">${ph(r.name, 'ชื่อผู้รับ')}</div>
      <div class="tel">โทร ${r.phone ? esc(fmtPhone(r.phone)) : '<span class="placeholder">เบอร์โทร</span>'}</div>
      <div class="addr">${ph(addr, 'รายละเอียดที่อยู่')}</div>
      <div class="admin">${ph(adminLine(r), 'ตำบล อำเภอ จังหวัด')}</div>
      <div class="zipwrap"><div class="zip">${zip}</div><div class="lb-prov">${esc(r.province || '')}</div></div>
    </div>
    ${foot ? `<div class="lb-foot">${foot}</div>` : ''}
  </div>`;
}
function printLabels(list) {
  $('printArea').innerHTML = list.map(labelHTML).join('');
  document.fonts.ready.then(() => setTimeout(() => window.print(), 60));
}

/* ================= form ================= */
const F = {phone:'fPhone', name:'fName', address:'fAddress', district:'fDistrict', amphoe:'fAmphoe', province:'fProvince', zip:'fZip', product:'fProduct', price:'fPrice', tracking:'fTracking', ship:'fShip', note:'fNote'};

function currentSender() { return settings.senders[settings.senderIdx] || settings.senders.find(Boolean) || ''; }
function formData() {
  const r = {};
  for (const k in F) r[k] = $(F[k]).value.trim();
  r.phone = normPhone(r.phone); r.price = num(r.price); r.ship = num(r.ship);
  r.sender = currentSender(); r.senderAddr = settings.senderAddr; r.senderPhone = settings.senderPhone;
  const ex = editingId && records.find(x => x.id === editingId);
  r.orderNo = ex ? ex.orderNo : nextOrderNo();
  r.createdAt = ex ? ex.createdAt : new Date().toISOString();
  return r;
}
function fillForm(r) {
  for (const k in F) if (r[k] !== undefined) $(F[k]).value = r[k] == null ? '' : r[k];
  syncLocSearch(); updatePreview(); checkReturning();
}
function clearForm() {
  for (const k in F) $(F[k]).value = '';
  $('autoText').value = ''; $('locSearch').value = ''; $('parseResult').className = 'parse-result';
  $('returning').className = 'returning';
  document.querySelectorAll('.input.invalid').forEach(x => x.classList.remove('invalid'));
  setEditing(null); updatePreview();
}
function setEditing(id) {
  editingId = id;
  const r = id && records.find(x => x.id === id);
  $('editBanner').classList.toggle('show', !!r);
  if (r) $('editOrderNo').textContent = r.orderNo;
  $('btnSavePrint').innerHTML = r ? '🖨 บันทึกการแก้ไข &amp; ปริ้น' : '🖨 บันทึก &amp; ปริ้นใบปะหน้า';
}
function updatePreview() { $('preview').innerHTML = labelHTML(formData()); }

function validate(r) {
  const bad = [];
  if (!r.name) bad.push('fName');
  if (!(r.phone.length === 9 || r.phone.length === 10)) bad.push('fPhone');
  if (!r.address) bad.push('fAddress');
  if (!r.province) bad.push('fProvince');
  if (!/^\d{5}$/.test(r.zip)) bad.push('fZip');
  document.querySelectorAll('.input.invalid').forEach(x => x.classList.remove('invalid'));
  bad.forEach(id => (id === 'fPhone' ? $(id).parentElement : $(id)).classList.add('invalid'));
  if (bad.includes('fProvince') || bad.includes('fZip')) $('locSearch').classList.add('invalid');
  return !bad.length;
}

async function saveRecord(andPrint) {
  if (!currentSender() || !settings.senderAddr) { openSettings(); toast('กรุณาตั้งค่าชื่อ / ที่อยู่ / เบอร์โทรผู้ส่งก่อน', true); return; }
  const r = formData();
  if (!validate(r)) { toast('กรุณากรอกข้อมูลที่มี * ให้ครบ (ชื่อ เบอร์โทร ที่อยู่ จังหวัด รหัสไปรษณีย์)', true); return; }
  if (editingId) {
    const i = records.findIndex(x => x.id === editingId);
    records[i] = Object.assign({}, records[i], r, {id: editingId, updatedAt: new Date().toISOString()});
  } else {
    r.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    records.push(r);
  }
  saveLocal();
  const saved = editingId ? records.find(x => x.id === editingId) : r;
  const okXl = xlHandle ? await writeExcel() : false;
  if (andPrint) printLabels([saved]);
  toast(`บันทึกออเดอร์ #${saved.orderNo} แล้ว` + (xlHandle ? (okXl ? ' • บันทึกลง Excel แล้ว' : '') : ' • (ยังไม่เชื่อมไฟล์ Excel)'));
  clearForm(); renderHistory(); refreshProductList();
}

/* ---------- auto fill ---------- */
function doAutofill(text) {
  const p = parseAddress(text);
  if (p.name) $('fName').value = p.name;
  if (p.phone) $('fPhone').value = p.phone;
  $('fAddress').value = p.address || $('fAddress').value;
  $('fDistrict').value = p.district; $('fAmphoe').value = p.amphoe; $('fProvince').value = p.province; $('fZip').value = p.zip;
  syncLocSearch(); updatePreview(); checkReturning();
  const pr = $('parseResult');
  if (p.issues.length) { pr.className = 'parse-result warn'; pr.innerHTML = '⚠ แยกข้อมูลได้บางส่วน: ' + p.issues.map(esc).join(' • ') + ' — กรุณาตรวจสอบก่อนปริ้น'; }
  else { pr.className = 'parse-result ok'; pr.innerHTML = `✓ แยกข้อมูลเรียบร้อย: <b>${esc(p.name)}</b> • ${esc(fmtPhone(p.phone))} • ${esc(adminLine(p))} ${esc(p.zip)}`; }
}

/* ---------- location search ---------- */
let locHi = -1, locItems = [];
function syncLocSearch() {
  const r = {district: $('fDistrict').value, amphoe: $('fAmphoe').value, province: $('fProvince').value};
  $('locSearch').value = [adminLine(r), $('fZip').value].filter(Boolean).join(' ');
  $('locSearch').classList.remove('invalid');
}
function searchLoc(q) {
  q = q.replace(/\s+/g, ' ').trim(); if (!q) return [];
  const parts = q.replace(/(ตำบล|อำเภอ|จังหวัด|แขวง|เขต|ต\.|อ\.|จ\.)/g, ' ').split(' ').filter(Boolean);
  const res = [];
  for (const e of DB) {
    const hay = e.d + ' ' + e.a + ' ' + e.p + ' ' + e.z;
    if (parts.every(w => hay.includes(w))) {
      const score = (e.d.startsWith(parts[0]) ? 3 : 0) + (e.z.startsWith(parts[0]) ? 3 : 0) + (e.a.startsWith(parts[0]) ? 1 : 0);
      res.push([score, e]);
      if (res.length > 400) break;
    }
  }
  return res.sort((a, b) => b[0] - a[0]).slice(0, 60).map(x => x[1]);
}
function renderLocList() {
  const L = $('locList');
  if (!locItems.length) { L.innerHTML = `<div class="loc-item muted">ไม่พบ — พิมพ์ชื่อตำบล อำเภอ จังหวัด หรือรหัสไปรษณีย์</div>`; L.classList.add('open'); return; }
  L.innerHTML = locItems.map((e, i) => `<div class="loc-item ${i === locHi ? 'hi' : ''}" data-i="${i}"><b>${esc(e.d)}</b> » ${esc(e.a)} » ${esc(e.p)} » ${esc(e.z)}</div>`).join('');
  L.classList.add('open');
}
function pickLoc(e) {
  $('fDistrict').value = e.d; $('fAmphoe').value = e.a; $('fProvince').value = e.p; $('fZip').value = e.z;
  $('locList').classList.remove('open'); syncLocSearch(); updatePreview();
}

/* ---------- returning customer ---------- */
function checkReturning() {
  const ph = normPhone($('fPhone').value), box = $('returning');
  if (ph.length < 9) { box.className = 'returning'; return; }
  const prev = [...records].reverse().find(r => r.phone === ph && r.id !== editingId);
  if (!prev) { box.className = 'returning'; return; }
  const n = records.filter(r => r.phone === ph).length;
  const same = prev.name === $('fName').value.trim() && prev.address === $('fAddress').value.trim();
  if (same) { box.className = 'returning show'; box.innerHTML = `👋 ลูกค้าเก่า — สั่งมาแล้ว ${n} ครั้ง`; return; }
  box.className = 'returning show';
  box.innerHTML = `👋 ลูกค้าเก่า (สั่งแล้ว ${n} ครั้ง): <b>${esc(prev.name)}</b> <button class="btn sm" id="btnUsePrev">ใช้ที่อยู่เดิม</button>`;
  $('btnUsePrev').onclick = () => {
    fillForm({name: prev.name, address: prev.address, district: prev.district, amphoe: prev.amphoe, province: prev.province, zip: prev.zip});
  };
}

/* ================= sender ================= */
function renderSender() {
  const sel = $('senderSelect');
  const names = settings.senders.map((n, i) => [n, i]).filter(x => x[0]);
  if (!settings.senders[settings.senderIdx]) settings.senderIdx = names.length ? names[0][1] : 0;
  sel.innerHTML = names.map(([n, i]) => `<option value="${i}" ${i === settings.senderIdx ? 'selected' : ''}>${esc(n)}</option>`).join('');
  if (!names.length) sel.innerHTML = '<option>— ยังไม่ได้ตั้งชื่อผู้ส่ง —</option>';
  $('senderAddr').textContent = settings.senderAddr || 'ยังไม่ได้ตั้งค่าที่อยู่ผู้ส่ง — กด "แก้ไขชื่อผู้ส่ง" เพื่อกรอก';
  $('senderPhone').textContent = fmtPhone(settings.senderPhone);
  $('chkShowProduct').checked = !!settings.showProduct;
}

/* ================= history ================= */
let selected = new Set();
function filtered() {
  const q = $('hSearch').value.trim().toLowerCase(), m = $('hMonth').value, st = $('hStatus').value;
  return [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter(r => {
    if (m && !r.createdAt.startsWith(m) && monthKey(r) !== m) return false;
    const done = !!r.tracking && r.ship != null;
    if (st === 'done' && !done) return false;
    if (st === 'pend' && done) return false;
    if (q) {
      const hay = [r.name, r.phone, r.tracking, r.product, r.orderNo, r.province, r.address].join(' ').toLowerCase();
      if (!hay.includes(q.replace(/-/g, '')) && !hay.includes(q)) return false;
    }
    return true;
  });
}
function monthKey(r) { const d = new Date(r.createdAt); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; }
const TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function renderMonths() {
  const sel = $('hMonth'), cur = sel.value;
  const ms = [...new Set(records.map(monthKey))].sort().reverse();
  sel.innerHTML = `<option value="">ทุกเดือน</option>` + ms.map(k => { const [y, m] = k.split('-'); return `<option value="${k}">${TH_MONTHS[+m-1]} ${+y + 543}</option>`; }).join('');
  sel.value = ms.includes(cur) ? cur : '';
}
function renderHistory() {
  renderMonths();
  const list = filtered();
  const tot = list.reduce((a, r) => (a.sales += r.price || 0, a.ship += r.ship || 0, a.pend += (!r.tracking || r.ship == null) ? 1 : 0, a), {sales:0, ship:0, pend:0});
  $('stats').innerHTML = [
    ['จำนวนออเดอร์', list.length.toLocaleString()],
    ['ยอดขายรวม', '฿' + money(tot.sales)],
    ['ค่าส่งรวม', '฿' + money(tot.ship)],
    ['รอกรอกเลขพัสดุ/ค่าส่ง', tot.pend.toLocaleString()],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  if (!list.length) { $('hBody').innerHTML = `<tr><td colspan="12" class="empty">${records.length ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีออเดอร์ — สร้างใบปะหน้าใบแรกได้ที่แท็บ "สร้างใบปะหน้า"'}</td></tr>`; }
  else $('hBody').innerHTML = list.map(r => {
    const done = !!r.tracking && r.ship != null;
    return `<tr data-id="${r.id}">
      <td><input type="checkbox" class="sel" ${selected.has(r.id) ? 'checked' : ''}></td>
      <td style="white-space:nowrap">${fmtDateTime(r.createdAt)}</td>
      <td style="white-space:nowrap">${esc(r.orderNo)}</td>
      <td class="addrcell"><b>${esc(r.name)}</b><div class="small muted">${esc(r.address)} ${esc(adminLine(r))} ${esc(r.zip)}</div></td>
      <td style="white-space:nowrap">${esc(fmtPhone(r.phone))}</td>
      <td>${esc(r.province)}</td>
      <td><input class="cell prod" data-f="product" value="${esc(r.product)}"></td>
      <td class="num"><input class="cell num" data-f="price" type="number" step="0.01" value="${r.price ?? ''}"></td>
      <td><input class="cell trk" data-f="tracking" value="${esc(r.tracking)}" placeholder="กรอกเลขพัสดุ"></td>
      <td class="num"><input class="cell num" data-f="ship" type="number" step="0.01" value="${r.ship ?? ''}" placeholder="0"></td>
      <td><span class="badge ${done ? 'done' : 'pend'}">${done ? 'ครบแล้ว' : 'รอข้อมูล'}</span></td>
      <td><div class="rowact">
        <button class="btn sm" data-act="print" title="ปริ้นซ้ำ">🖨</button>
        <button class="btn sm" data-act="edit" title="แก้ไข">✎</button>
        <button class="btn sm" data-act="dup" title="ส่งซ้ำ (สร้างออเดอร์ใหม่ที่อยู่เดิม)">⧉</button>
        <button class="btn sm" data-act="del" title="ลบ">🗑</button>
      </div></td></tr>`;
  }).join('');
  $('selCount').textContent = selected.size; $('btnPrintSel').disabled = !selected.size;
  $('chkAll').checked = list.length > 0 && list.every(r => selected.has(r.id));
}
function refreshProductList() {
  const ps = [...new Set(records.map(r => r.product).filter(Boolean))].slice(-80);
  $('productList').innerHTML = ps.map(p => `<option value="${esc(p)}">`).join('');
}

/* ================= events ================= */
function switchTab(t) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  $('tab-create').classList.toggle('hidden', t !== 'create');
  $('tab-history').classList.toggle('hidden', t !== 'history');
  if (t === 'history') renderHistory();
  try { sessionStorage.setItem('sl.tab', t); } catch {}
}
document.querySelectorAll('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

$('btnAutofill').onclick = () => { const t = $('autoText').value.trim(); if (!t) return toast('วางข้อมูลผู้รับในช่องป้อนอัตโนมัติก่อน', true); doAutofill(t); };
$('btnPasteAutofill').onclick = async () => {
  try { const t = await navigator.clipboard.readText(); if (!t.trim()) return toast('คลิปบอร์ดว่างเปล่า', true); $('autoText').value = t; doAutofill(t); }
  catch { toast('เบราว์เซอร์ไม่อนุญาตให้อ่านคลิปบอร์ด — กด Ctrl+V ในช่องแล้วกด "แยกข้อมูล"', true); }
};
$('autoText').addEventListener('paste', () => setTimeout(() => doAutofill($('autoText').value), 0));
$('autoText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) { e.preventDefault(); $('btnAutofill').click(); } });

for (const k in F) $(F[k]).addEventListener('input', () => { $(F[k]).classList.remove('invalid'); if (k === 'phone') $('fPhone').parentElement.classList.remove('invalid'); updatePreview(); });
['fDistrict','fAmphoe','fProvince','fZip'].forEach(id => $(id).addEventListener('change', syncLocSearch));
$('fPhone').addEventListener('input', checkReturning);

$('locSearch').addEventListener('input', e => { locItems = searchLoc(e.target.value); locHi = locItems.length ? 0 : -1; renderLocList(); });
$('locSearch').addEventListener('focus', e => { e.target.select(); });
$('locSearch').addEventListener('keydown', e => {
  if (!$('locList').classList.contains('open')) return;
  if (e.key === 'ArrowDown') { locHi = Math.min(locHi + 1, locItems.length - 1); renderLocList(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { locHi = Math.max(locHi - 1, 0); renderLocList(); e.preventDefault(); }
  else if (e.key === 'Enter') { if (locItems[locHi]) pickLoc(locItems[locHi]); e.preventDefault(); }
  else if (e.key === 'Escape') $('locList').classList.remove('open');
});
$('locList').addEventListener('mousedown', e => { const it = e.target.closest('.loc-item[data-i]'); if (it) { e.preventDefault(); pickLoc(locItems[+it.dataset.i]); } });
$('locSearch').addEventListener('blur', () => setTimeout(() => { $('locList').classList.remove('open'); syncLocSearch(); }, 150));

$('senderSelect').onchange = e => { settings.senderIdx = +e.target.value; saveSettings(); updatePreview(); };
$('chkShowProduct').onchange = e => { settings.showProduct = e.target.checked; saveSettings(); updatePreview(); };

$('btnClear').onclick = clearForm;
$('btnCancelEdit').onclick = clearForm;
$('btnSaveOnly').onclick = () => saveRecord(false);
$('btnSavePrint').onclick = () => saveRecord(true);
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && !$('tab-create').classList.contains('hidden')) { e.preventDefault(); saveRecord(true); } });

// history
$('hSearch').oninput = renderHistory; $('hMonth').onchange = renderHistory; $('hStatus').onchange = renderHistory;
$('hBody').addEventListener('change', e => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const r = records.find(x => x.id === tr.dataset.id); if (!r) return;
  if (e.target.classList.contains('sel')) { e.target.checked ? selected.add(r.id) : selected.delete(r.id); $('selCount').textContent = selected.size; $('btnPrintSel').disabled = !selected.size; return; }
  const f = e.target.dataset.f; if (!f) return;
  r[f] = (f === 'price' || f === 'ship') ? num(e.target.value) : e.target.value.trim();
  r.updatedAt = new Date().toISOString();
  scheduleSync();
  const done = !!r.tracking && r.ship != null, b = tr.querySelector('.badge');
  b.className = 'badge ' + (done ? 'done' : 'pend'); b.textContent = done ? 'ครบแล้ว' : 'รอข้อมูล';
  toast('บันทึกแล้ว');
});
$('hBody').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.classList.contains('cell')) {
    e.target.blur();
    const all = [...$('hBody').querySelectorAll(`input.cell[data-f="${e.target.dataset.f}"]`)];
    const nx = all[all.indexOf(e.target) + 1]; if (nx) nx.focus();
  }
});
$('hBody').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('tr').dataset.id, r = records.find(x => x.id === id);
  if (b.dataset.act === 'print') printLabels([r]);
  if (b.dataset.act === 'edit') { switchTab('create'); clearForm(); setEditing(id); fillForm(r); window.scrollTo(0, 0); }
  if (b.dataset.act === 'dup') { switchTab('create'); clearForm(); fillForm(Object.assign({}, r, {tracking:'', ship:'', price:'', note:''})); window.scrollTo(0, 0); toast('คัดลอกที่อยู่แล้ว — ใส่สินค้า/ยอดขาย แล้วกดบันทึก'); }
  if (b.dataset.act === 'del' && confirm(`ลบออเดอร์ #${r.orderNo} (${r.name}) ?`)) { records = records.filter(x => x.id !== id); selected.delete(id); scheduleSync(); renderHistory(); }
});
$('chkAll').onchange = e => { filtered().forEach(r => e.target.checked ? selected.add(r.id) : selected.delete(r.id)); renderHistory(); };
$('btnPrintSel').onclick = () => { const list = records.filter(r => selected.has(r.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); if (list.length) printLabels(list); };
$('btnExport').onclick = downloadExcel;

// Excel pill & settings
$('xlPill').onclick = () => { if (xlHandle && xlDirty) writeExcel().then(ok => ok && toast('บันทึกลง Excel แล้ว')); else openSettings(); };
function openSettings() {
  [1, 2, 3].forEach(i => $('sName' + i).value = settings.senders[i - 1] || '');
  $('sAddr').value = settings.senderAddr; $('sPhone').value = fmtPhone(settings.senderPhone);
  refreshPill(); $('settingsModal').classList.add('open');
}
$('btnSettings').onclick = openSettings;
$('btnEditSenders').onclick = openSettings;
$('btnSettingsCancel').onclick = () => $('settingsModal').classList.remove('open');
$('settingsModal').addEventListener('mousedown', e => { if (e.target.id === 'settingsModal') $('settingsModal').classList.remove('open'); });
$('btnSettingsSave').onclick = () => {
  const names = [1, 2, 3].map(i => $('sName' + i).value.trim());
  if (!names.some(Boolean)) return toast('ต้องมีชื่อผู้ส่งอย่างน้อย 1 ชื่อ', true);
  settings.senders = names; settings.senderAddr = $('sAddr').value.trim(); settings.senderPhone = normPhone($('sPhone').value);
  saveSettings(); renderSender(); updatePreview(); $('settingsModal').classList.remove('open'); toast('บันทึกการตั้งค่าแล้ว');
};
$('btnXlNew').onclick = () => fsSupported ? xlCreateNew() : toast('ใช้ Chrome หรือ Edge เพื่อบันทึก Excel อัตโนมัติ', true);
$('btnXlOpen').onclick = () => fsSupported ? xlOpenExisting() : toast('ใช้ Chrome หรือ Edge เพื่อบันทึก Excel อัตโนมัติ', true);
$('btnXlSync').onclick = () => xlHandle ? writeExcel().then(ok => ok && toast('บันทึกลง Excel แล้ว')) : toast('ยังไม่ได้เลือกไฟล์ Excel', true);

/* ================= init ================= */
(async function init() {
  renderSender(); updatePreview(); renderHistory(); refreshProductList();
  if (fsSupported) { xlHandle = await kvGet('xlHandle'); }
  refreshPill();
  try { const t = sessionStorage.getItem('sl.tab'); if (t) switchTab(t); } catch {}
  if (!currentSender() || !settings.senderAddr) {
    setTimeout(() => { openSettings(); toast('ยินดีต้อนรับ! เริ่มจากกรอกชื่อ ที่อยู่ และเบอร์โทรผู้ส่ง แล้วกด "สร้างไฟล์ Excel ใหม่"'); }, 400);
    store('sl.xlPrompted', true);
  } else if (fsSupported && !xlHandle && !store('sl.xlPrompted')) {
    store('sl.xlPrompted', true);
    setTimeout(() => { openSettings(); toast('เริ่มต้น: กด "สร้างไฟล์ Excel ใหม่" เพื่อให้ระบบบันทึกข้อมูลลูกค้าลงไฟล์อัตโนมัติ'); }, 400);
  }
})();

