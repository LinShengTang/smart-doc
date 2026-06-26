(function() {
'use strict';
const S = {
  mode: 'extract',
  file: null, b64: null, mime: null,
  tables: [], activeTable: 0,
  textOut: '',
  docCtx: null,
  history: [],
  extractFmt: 'csv',
  textFmt: 'txt',
  urlText: null,
  urlSource: '',
};

const MODELS = { gemini: 'gemini-3.5-flash', gpt: 'gpt-4o' };

function validateKeyFormat(val) {
  const prov = document.getElementById('aiProvider').value;
  const warn = document.getElementById('keyWarn');
  const fmtErr = document.getElementById('keyFmtErr');
  warn.classList.toggle('hidden', !val.trim());
  let msg = '';
  if (val.trim()) {
    if (prov === 'gemini' && !val.trim().startsWith('AIza')) {
      msg = 'Gemini Key 通常以「AIza」開頭，請確認格式是否正確。';
    } else if (prov === 'gpt' && !val.trim().startsWith('sk-')) {
      msg = 'OpenAI Key 通常以「sk-」開頭，請確認格式是否正確。';
    }
  }
  fmtErr.textContent = msg;
  fmtErr.classList.toggle('hidden', !msg);
}

function switchMode(m) {
  S.mode = m;
  ['extract', 'text', 'chat'].forEach(x => {
    const tab = document.getElementById('tab-' + x);
    const panel = document.getElementById('panel' + x[0].toUpperCase() + x.slice(1));
    tab.classList.toggle('active', x === m);
    panel.classList.toggle('hidden', x !== m);
  });
  const labels = { extract: '▶ 提取表格', text: '▶ 提取文字', chat: '▶ 載入文件' };
  document.getElementById('startBtn').textContent = labels[m];

  document.getElementById('fmtBlock').classList.toggle('hidden', m === 'chat');
  document.getElementById('extractFmts').classList.toggle('hidden', m !== 'extract');
  document.getElementById('textFmts').classList.toggle('hidden', m !== 'text');
}

function selectFmt(el, val) {
  const group = el.closest('.fmt-opts');
  group.querySelectorAll('.fmt-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  if (S.mode === 'extract') S.extractFmt = val;
  else S.textFmt = val;
}

function onProviderChange() {
  const p = document.getElementById('aiProvider').value;
  const hint = document.getElementById('providerHint');
  const fmtHint = document.getElementById('fmtHint');
  if (p === 'gemini') {
    hint.innerHTML = '免費額度充足，在 <a href="https://aistudio.google.com/app/apikey" target="_blank">AI Studio</a> 一鍵取得 Key';
    fmtHint.textContent = '支援：JPG、PNG、WebP、PDF';
    document.getElementById('fileInput').accept = 'image/*,.pdf';
  } else {
    hint.innerHTML = '在 <a href="https://platform.openai.com/api-keys" target="_blank">OpenAI Platform</a> 取得 Key（需付費帳戶）';
    fmtHint.textContent = '支援：JPG、PNG、WebP（GPT-4o 不支援 PDF，請改用 Gemini）';
    document.getElementById('fileInput').accept = 'image/jpeg,image/png,image/webp,image/gif';
    if (S.mime === 'application/pdf') showErr('目前檔案為 PDF，GPT-4o 不支援。請切換回 Gemini 或重新上傳圖片。');
  }
}

function handleFile(f) {
  if (!f) return;
  const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
  if (!ok.includes(f.type)) { showErr('不支援的格式。請上傳 JPG、PNG、WebP 或 PDF。'); return; }
  const prov = document.getElementById('aiProvider').value;
  if (prov === 'gpt' && f.type === 'application/pdf') { showErr('GPT-4o 不支援 PDF。請切換至 Gemini，或上傳圖片。'); return; }
  if (f.size > 15 * 1024 * 1024) { showErr('檔案超過 15MB 上限（base64 編碼後約 20MB，可能超出 API 限制）。請壓縮後再試。'); return; }

  clearErr();
  S.file = f; S.b64 = null; S.mime = f.type; S.docCtx = null; S.history = [];
  S.urlText = null; S.urlSource = '';
  document.getElementById('urlInp').value = '';
  document.getElementById('urlStatus').className = 'url-status hidden';

  const sz = f.size < 1048576 ? (f.size / 1024).toFixed(1) + ' KB' : (f.size / 1048576).toFixed(2) + ' MB';
  document.getElementById('fileName').textContent = f.name;
  document.getElementById('fileSz').textContent = sz;
  document.getElementById('filePill').classList.add('show');
  if (S.mode === 'chat') resetChatUI();
}

function clearFile() {
  S.file = null; S.b64 = null; S.mime = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('filePill').classList.remove('show');
}

async function getB64() {
  if (S.b64) return S.b64;
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { S.b64 = r.result.split(',')[1]; res(S.b64); };
    r.onerror = () => rej(new Error('讀取檔案失敗'));
    r.readAsDataURL(S.file);
  });
}

(function() {
  const z = document.getElementById('dropZone');
  z.addEventListener('click', () => document.getElementById('fileInput').click());
  z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('drag'); });
  z.addEventListener('dragleave', () => z.classList.remove('drag'));
  z.addEventListener('drop', e => {
    e.preventDefault(); z.classList.remove('drag');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
})();

function validate() {
  if (!document.getElementById('apiKey').value.trim()) { showErr('請輸入 API Key'); return false; }
  if (!S.file && !S.urlText) { showErr('請上傳文件，或輸入網址並點擊「擷取」'); return false; }
  clearErr(); return true;
}

let _pendingAction = null;

function showConfirm(action) {
  if (!validate()) return;

  const prov = document.getElementById('aiProvider').value;
  const provLabel = prov === 'gemini' ? 'Google Gemini' : 'OpenAI GPT-4o';
  const modeLabels = { extract: '表格提取', text: '文字提取', chat: '載入文件（AI 問答）' };

  const info = document.getElementById('confirmInfo');
  info.innerHTML =
    '<div><strong id="_ci_src_lbl">來源：</strong><span id="_ci_file"></span></div>' +
    '<div><strong>功能：</strong><span id="_ci_mode"></span></div>' +
    '<div><strong>送往：</strong><span id="_ci_dest"></span></div>' +
    '<div><strong>說明：</strong>由您的瀏覽器直接送往上方 API，不經過開發者伺服器</div>';

  if (S.file) {
    const sz = S.file.size < 1048576 ? (S.file.size / 1024).toFixed(1) + ' KB' : (S.file.size / 1048576).toFixed(2) + ' MB';
    document.getElementById('_ci_src_lbl').textContent = '文件：';
    document.getElementById('_ci_file').textContent = S.file.name + '（' + sz + '）';
  } else {
    document.getElementById('_ci_src_lbl').textContent = '網址：';
    document.getElementById('_ci_file').textContent = S.urlSource;
  }
  document.getElementById('_ci_mode').textContent = modeLabels[S.mode];
  document.getElementById('_ci_dest').textContent = provLabel + ' API';

  _pendingAction = action;
  document.getElementById('confirmModal').classList.add('show');
}

function closeConfirm() {
  document.getElementById('confirmModal').classList.remove('show');
  _pendingAction = null;
}

document.getElementById('confirmModal').addEventListener('click', function(e) {
  if (e.target === this) closeConfirm();
});

document.getElementById('confirmOkBtn').addEventListener('click', function() {
  const action = _pendingAction;
  if (typeof action === 'function') {
    closeConfirm();
    action();
  }
});

async function runCurrent() {
  if (!validate()) return;
  const actions = {
    extract: runExtract,
    text: runText,
    chat: initChat,
  };
  showConfirm(actions[S.mode]);
}

async function geminiReq(body) {
  const key = document.getElementById('apiKey').value.trim();
  const model = MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error('Gemini 錯誤：' + (d.error?.message || 'HTTP ' + r.status));
  const cand = d.candidates?.[0];
  if (!cand) throw new Error('API 未回傳結果。請確認 API Key 是否有效，或稍後再試。');
  if (cand.finishReason === 'SAFETY') throw new Error('AI 拒絕此請求（安全政策限制）。');
  return cand.content.parts[0].text;
}

async function callGPT(messages) {
  const key = document.getElementById('apiKey').value.trim();
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: MODELS.gpt, messages, max_tokens: 4096, temperature: 0.1 })
  });
  const d = await r.json();
  if (!r.ok) throw new Error('OpenAI 錯誤：' + (d.error?.message || 'HTTP ' + r.status));
  return d.choices[0].message.content;
}

async function fetchUrl() {
  const url = document.getElementById('urlInp').value.trim();
  if (!url) { showErr('請輸入網址'); return; }
  if (!url.startsWith('http')) { showErr('請輸入完整網址（以 http 或 https 開頭）'); return; }
  const status = document.getElementById('urlStatus');
  status.className = 'url-status loading';
  status.textContent = '⏳ 擷取中…';
  status.classList.remove('hidden');
  document.getElementById('fetchUrlBtn').disabled = true;
  try {
    const r = await fetch('https://r.jina.ai/' + url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const text = await r.text();
    if (!text || text.length < 30) throw new Error('無法取得有效內容');
    S.urlText = text; S.urlSource = url;
    S.file = null; S.b64 = null; S.mime = null; S.docCtx = null; S.history = [];
    document.getElementById('filePill').classList.remove('show');
    document.getElementById('fileInput').value = '';
    status.className = 'url-status ok';
    const short = url.length > 55 ? url.slice(0, 55) + '…' : url;
    status.textContent = '✅ 已擷取：' + short + '（' + Math.round(text.length / 1000) + 'K 字）';
    clearErr();
    if (S.mode === 'chat') resetChatUI();
  } catch (e) {
    status.className = 'url-status err';
    status.textContent = '❌ 擷取失敗：' + e.message;
  } finally {
    document.getElementById('fetchUrlBtn').disabled = false;
  }
}

async function callWithContext(prompt) {
  const prov = document.getElementById('aiProvider').value;
  if (S.urlText) {
    const maxLen = 60000;
    const content = S.urlText.length > maxLen ? S.urlText.slice(0, maxLen) + '\n\n[內容過長，已截斷]' : S.urlText;
    const combined = `以下是從「${S.urlSource}」擷取的網頁內容：\n\n${content}\n\n---\n\n${prompt}`;
    if (prov === 'gemini') {
      return geminiReq({ contents: [{ parts: [{ text: combined }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 8192 } });
    } else {
      return callGPT([{ role: 'user', content: combined }]);
    }
  }
  const b64 = await getB64();
  if (prov === 'gemini') {
    return geminiReq({
      contents: [{ parts: [{ inline_data: { mime_type: S.mime, data: b64 } }, { text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
    });
  } else {
    return callGPT([{ role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:${S.mime};base64,${b64}` } },
      { type: 'text', text: prompt }
    ] }]);
  }
}

async function callChat(messages, sysPrompt) {
  const prov = document.getElementById('aiProvider').value;
  if (prov === 'gemini') {
    const contents = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));
    return geminiReq({
      contents,
      systemInstruction: { parts: [{ text: sysPrompt }] },
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 }
    });
  } else {
    return callGPT([
      { role: 'system', content: sysPrompt },
      ...messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
    ]);
  }
}

async function runExtract() {
  setLoading(true, '🤖 AI 正在識別表格…');
  const prompt = `仔細分析這份文件，提取其中所有的表格。

輸出規則（嚴格遵守）：
1. 每個表格以 CSV 格式輸出，逗號分隔，第一行為欄位標題
2. 欄位中若含逗號，用英文雙引號包住；內部雙引號用 "" 表示
3. 多個表格用「===表格N===」（N 為序號）分隔
4. 若完全沒有表格，僅輸出「[NO_TABLE]」
5. 除 CSV 資料和分隔標記外，不輸出任何說明文字`;

  try {
    const raw = (await callWithContext(prompt)).trim();
    if (raw === '[NO_TABLE]' || raw === '') {
      showExtractRaw('這份文件中沒有偵測到表格。');
    } else {
      const parsed = parseMultiTable(raw);
      if (parsed.length > 0 && parsed[0].length > 1) {
        renderTableResult(parsed);
      } else {
        showExtractRaw(raw);
      }
    }
  } catch (e) {
    showErr(e.message);
  } finally {
    setLoading(false);
  }
}

function parseMultiTable(raw) {
  const parts = raw.split(/===?表格\s*\d+\s*===?/i)
    .map(s => s.replace(/```[a-z]*/gi, '').replace(/```/g, '').trim())
    .filter(s => s.length > 0);
  if (parts.length === 0) parts.push(raw.replace(/```[a-z]*/gi, '').replace(/```/g, '').trim());
  return parts.map(parseCSV).filter(t => t.length > 0);
}

function parseCSV(str) {
  return str.trim().split('\n').filter(l => l.trim()).map(parseCSVLine);
}

function parseCSVLine(line) {
  const fields = []; let f = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { f += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { fields.push(f.trim()); f = ''; }
    else f += c;
  }
  fields.push(f.trim()); return fields;
}

function renderTableResult(tables) {
  S.tables = tables; S.activeTable = 0;
  const bar = document.getElementById('tblTabs');
  bar.innerHTML = '';
  if (tables.length > 1) {
    tables.forEach((_, i) => {
      const d = document.createElement('div');
      d.className = 'tbl-tab' + (i === 0 ? ' active' : '');
      d.textContent = '表格 ' + (i + 1);
      d.addEventListener('click', () => selectTable(i));
      bar.appendChild(d);
    });
  }
  renderTable(0);
  document.getElementById('extractPH').classList.add('hidden');
  document.getElementById('rawExtract').classList.add('hidden');
  document.getElementById('extractContent').classList.remove('hidden');
  document.getElementById('extractDlBtn').classList.remove('hidden');
}

function selectTable(i) {
  S.activeTable = i; document.querySelectorAll('.tbl-tab').forEach((el, j) => el.classList.toggle('active', j === i)); renderTable(i);
}

function renderTable(i) {
  const rows = S.tables[i]; const tbl = document.getElementById('resultTable');
  tbl.innerHTML = '';
  if (!rows || rows.length === 0) return;
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  rows[0].forEach(h => { const th = document.createElement('th'); th.textContent = h || ''; hr.appendChild(th); });
  thead.appendChild(hr); tbl.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (let r = 1; r < rows.length; r++) {
    const tr = document.createElement('tr');
    rows[r].forEach(c => { const td = document.createElement('td'); td.textContent = c || ''; tr.appendChild(td); });
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
}

function showExtractRaw(txt) {
  document.getElementById('extractPH').classList.add('hidden');
  document.getElementById('extractContent').classList.add('hidden');
  document.getElementById('extractDlBtn').classList.add('hidden');
  document.getElementById('rawExtract').classList.remove('hidden');
  document.getElementById('rawExtractText').value = txt;
}

async function runText() {
  setLoading(true, '🤖 AI 正在提取文字…');
  const prompt = `完整、準確地提取這份文件中的所有文字內容。
要求：
- 保持原始排版（標題層級、段落、清單、縮排）
- 段落間用空行分隔
- 若有表格，轉為可讀的文字格式
- 只輸出文字本身，不加任何說明`;

  try {
    const txt = await callWithContext(prompt);
    S.textOut = txt;
    document.getElementById('textPH').classList.add('hidden');
    const ta = document.getElementById('textOut');
    ta.classList.remove('hidden'); ta.value = txt;
    document.getElementById('downloadTextBtn').classList.remove('hidden');
  } catch (e) {
    showErr(e.message);
  } finally {
    setLoading(false);
  }
}

function resetChatUI() {
  S.docCtx = null; S.history = [];
  document.getElementById('chatMsgs').innerHTML = '<div class="msg msg-sys">請先上傳文件，再按左側「▶ 載入文件」，之後即可在此提問</div>';
  document.getElementById('chatInp').className = 'chat-inp not-ready';
  document.getElementById('chatInp').placeholder = '請先按「▶ 載入文件」，之後即可輸入問題…';
  document.getElementById('sendBtn').disabled = true;
  document.getElementById('chatStatus').textContent = '';
  document.getElementById('chatCounter').textContent = '';
  document.getElementById('quickBtns').classList.add('hidden');
}

async function initChat() {
  setLoading(true, '🤖 AI 正在讀取文件，建立問答環境…');
  const prompt = `仔細閱讀這份文件，提供一份詳盡的內容摘要，包含：
1. 文件類型與主要主題
2. 所有重要數據：數字、日期、金額、姓名、地點
3. 表格內容的逐欄完整記錄
4. 重要結論、建議或關鍵訊息

請盡量詳細，這份摘要將作為後續問答的唯一資料來源。`;

  try {
    const summary = await callWithContext(prompt);
    S.docCtx = summary; S.history = [];
    document.getElementById('chatMsgs').innerHTML = '';
    appendMsg('sys', '✅ 文件已載入，AI 已讀取內容。請在下方輸入問題。');
    appendMsg('sys', '⚠️ 聊天模式基於 AI 摘要，非完整文件即時檢索。若需更高精確度，請重新按「▶ 載入文件」。');
    const inp = document.getElementById('chatInp');
    inp.className = 'chat-inp';
    inp.placeholder = '輸入問題… (Enter 送出，Shift+Enter 換行)';
    document.getElementById('sendBtn').disabled = false;
    document.getElementById('chatStatus').textContent = S.file ? S.file.name : S.urlSource;
    document.getElementById('quickBtns').classList.remove('hidden');
    inp.focus();
    updateCounter();
  } catch (e) {
    showErr(e.message);
  } finally {
    setLoading(false);
  }
}

async function sendMsg() {
  const inp = document.getElementById('chatInp');
  const txt = inp.value.trim();
  if (!txt) return;
  if (!S.docCtx) { showErr('請先按「▶ 載入文件」後再提問。'); return; }

  inp.value = ''; document.getElementById('sendBtn').disabled = true;
  clearErr();
  appendMsg('user', txt);
  S.history.push({ role: 'user', content: txt });
  const loadEl = appendMsg('ai', '⋯', true);

  const sourceName = S.file ? S.file.name : S.urlSource;
  const sys = `你是一個文件分析助理。以下是用戶來源的詳細內容，請嚴格根據此內容回答：

=== 文件內容 ===
${S.docCtx}
================

原則：直接根據文件作答；文件中沒有的資訊請明確告知；使用繁體中文；數字請準確引用。
引用格式：若引用具體內容，請標明「根據【${sourceName}】：」。`;

  try {
    const reply = await callChat(S.history, sys);
    loadEl.remove();
    appendMsg('ai', reply);
    S.history.push({ role: 'ai', content: reply });
    if (S.history.length > 24) S.history = S.history.slice(-24);
    updateCounter();
  } catch (e) {
    loadEl.remove();
    appendMsg('sys', '❌ ' + e.message);
    showErr(e.message);
  } finally {
    document.getElementById('sendBtn').disabled = false;
    inp.focus();
  }
}

function renderMarkdownText(text) {
  const container = document.createElement('span');
  const lines = String(text ?? '').split('\n');

  lines.forEach((line, index) => {
    if (index > 0) container.appendChild(document.createElement('br'));

    let lastIndex = 0;
    const pattern = /\*\*(.+?)\*\*/g;
    let match;

    while ((match = pattern.exec(line)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(line.slice(lastIndex, match.index)));
      }
      const strong = document.createElement('strong');
      strong.textContent = match[1];
      container.appendChild(strong);
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < line.length) {
      container.appendChild(document.createTextNode(line.slice(lastIndex)));
    }
  });

  return container;
}

function appendMsg(role, txt, loading = false) {
  const c = document.getElementById('chatMsgs');
  const d = document.createElement('div');
  d.className = 'msg msg-' + role + (loading ? ' msg-loading' : '');

  if (role === 'ai') {
    d.appendChild(renderMarkdownText(txt));
  } else {
    d.textContent = txt;
  }

  c.appendChild(d); c.scrollTop = c.scrollHeight;
  return d;
}

function sendQuickPrompt(promptText) {
  if (!S.docCtx) { showErr('請先按「▶ 載入文件」後再使用快速提問。'); return; }
  const inp = document.getElementById('chatInp');
  inp.value = promptText;
  sendMsg();
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}

function updateCounter() {
  const n = Math.floor(S.history.length / 2);
  document.getElementById('chatCounter').textContent = n > 0 ? `已對話 ${n} 輪` : '';
}

function downloadTable() {
  const fmt = S.extractFmt;
  const rows = S.tables[S.activeTable];
  if (!rows || rows.length < 2) { showErr('沒有可下載的表格資料'); return; }

  if (fmt === 'csv') {
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    saveBlob('\uFEFF' + csv, 'result.csv', 'text/csv;charset=utf-8');
  } else if (fmt === 'json') {
    const heads = rows[0];
    const arr = rows.slice(1).map(row => { const o = {}; heads.forEach((h, i) => { o[h] = row[i] || ''; }); return o; });
    saveBlob(JSON.stringify(arr, null, 2), 'result.json', 'application/json');
  } else {
    if (typeof XLSX === 'undefined') { showErr('Excel 功能需要網路連線（載入 SheetJS）'); return; }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '資料');
    XLSX.writeFile(wb, 'result.xlsx');
  }
}

function downloadText() {
  const txt = document.getElementById('textOut').value;
  if (!txt) { showErr('沒有可下載的文字內容'); return; }
  saveBlob(txt, 'result.' + S.textFmt, 'text/plain;charset=utf-8');
}

function saveBlob(content, name, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function setLoading(on, msg = 'AI 處理中…') {
  document.getElementById('overlay').classList.toggle('show', on);
  if (on) document.getElementById('overlayMsg').textContent = msg;
  document.getElementById('startBtn').disabled = on;
}

function showErr(msg) { const b = document.getElementById('errBox'); b.textContent = '⚠ ' + msg; b.classList.add('show'); }
function clearErr() { document.getElementById('errBox').classList.remove('show'); }

function panicClear() {
  if (!confirm('清除所有暫存資料？\n包含：API Key、上傳文件、提取結果、聊天記錄。')) return;
  Object.assign(S, { file: null, b64: null, mime: null, tables: [], activeTable: 0, textOut: '', docCtx: null, history: [], urlText: null, urlSource: '' });
  document.getElementById('apiKey').value = '';
  document.getElementById('fileInput').value = '';
  document.getElementById('urlInp').value = '';
  document.getElementById('urlStatus').className = 'url-status hidden';
  document.getElementById('filePill').classList.remove('show');
  document.getElementById('textOut').value = '';
  document.getElementById('textOut').classList.add('hidden');
  document.getElementById('downloadTextBtn').classList.add('hidden');
  document.getElementById('textPH').classList.remove('hidden');
  document.getElementById('extractPH').classList.remove('hidden');
  document.getElementById('extractContent').classList.add('hidden');
  document.getElementById('extractDlBtn').classList.add('hidden');
  document.getElementById('rawExtract').classList.add('hidden');
  document.getElementById('resultTable').innerHTML = '';
  resetChatUI(); clearErr();
  try { sessionStorage.clear(); localStorage.clear(); } catch (e) {}
}

function bindEvents() {
  document.getElementById('panicClearBtn').addEventListener('click', panicClear);
  document.querySelectorAll('.mode-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });
  document.getElementById('aiProvider').addEventListener('change', onProviderChange);
  document.getElementById('apiKey').addEventListener('input', e => validateKeyFormat(e.target.value));
  document.getElementById('fileInput').addEventListener('change', e => handleFile(e.target.files[0]));
  document.getElementById('clearFileBtn').addEventListener('click', clearFile);
  document.querySelectorAll('.fmt-opts').forEach(group => {
    group.addEventListener('click', e => {
      const opt = e.target.closest('.fmt-opt');
      if (!opt) return;
      selectFmt(opt, opt.dataset.fmt);
    });
  });
  document.getElementById('startBtn').addEventListener('click', runCurrent);
  document.getElementById('fetchUrlBtn').addEventListener('click', fetchUrl);
  document.getElementById('downloadTableBtn').addEventListener('click', downloadTable);
  document.getElementById('downloadTextBtn').addEventListener('click', downloadText);
  document.getElementById('chatInp').addEventListener('keydown', handleChatKey);
  document.getElementById('sendBtn').addEventListener('click', sendMsg);
  document.getElementById('cancelConfirmBtn').addEventListener('click', closeConfirm);
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => sendQuickPrompt(btn.dataset.prompt));
  });
}

bindEvents();
switchMode('extract');
document.getElementById('downloadTextBtn').classList.add('hidden');

Object.assign(window, {
  switchMode, selectFmt, onProviderChange,
  handleFile, clearFile, runCurrent, fetchUrl,
  sendMsg, sendQuickPrompt, handleChatKey,
  downloadTable, downloadText,
  panicClear, validateKeyFormat, closeConfirm
});
})();
