const INAT_API = 'https://api.inaturalist.org/v1';
const RADIUS_KM = 30;
const SEASONAL_WEEKS = 1;    // 対象週 ± この週数（ISO週番号で絞る）
const TOP_N = 50;            // 季節クエリで取得する種数
const TOP_N_YEARLY = 500;    // 年間クエリ: 季節種が漏れないよう多めに取る
const AVOID_DAYS = 14;       // 直近何日間に表示した種を避けるか
const WEEKLY_SLOTS = 7;      // 週に割り当てる種数（= 1週間の日数）

// ── 選択中の日付を返す（デフォルト: 今日）────────────────────
function getSelectedDate() {
  const picker = document.getElementById('date-picker');
  return picker.value ? new Date(picker.value + 'T00:00:00') : new Date();
}

function dateKey(date) {
  return date.toLocaleDateString('sv-SE'); // YYYY-MM-DD
}

// ── 日付ピッカーを今日で初期化 ───────────────────────────────
function initDatePicker() {
  document.getElementById('date-picker').value = dateKey(new Date());
}

// ── 7セグメント日付ディスプレイ ──────────────────────────────
function renderDateHeader() {
  document.getElementById('date-display').innerHTML = buildSegmentDisplay(getSelectedDate());
}

function buildSegmentDisplay(date) {
  const W = 30, H = 58, T = 5, GAP = 7, DOT_W = 12;

  // [a, b, c, d, e, f, g] — top, top-right, bot-right, bottom, bot-left, top-left, middle
  const SEGS = {
    0:[1,1,1,1,1,1,0], 1:[0,1,1,0,0,0,0], 2:[1,1,0,1,1,0,1],
    3:[1,1,1,1,0,0,1], 4:[0,1,1,0,0,1,1], 5:[1,0,1,1,0,1,1],
    6:[1,0,1,1,1,1,1], 7:[1,1,1,0,0,0,0], 8:[1,1,1,1,1,1,1],
    9:[1,1,1,1,0,1,1],
  };

  const C  = T * 0.42; // 面取り量
  const M  = H / 2;    // 中間高さ

  function hbar(x, y, w, on) {
    const p = `M${x+C},${y} L${x+w-C},${y} L${x+w},${y+T/2} L${x+w-C},${y+T} L${x+C},${y+T} L${x},${y+T/2} Z`;
    return `<path d="${p}" fill="white" opacity="${on ? .9 : .055}"/>`;
  }
  function vbar(x, y, h, on) {
    const p = `M${x+T/2},${y} L${x+T},${y+C} L${x+T},${y+h-C} L${x+T/2},${y+h} L${x},${y+h-C} L${x},${y+C} Z`;
    return `<path d="${p}" fill="white" opacity="${on ? .9 : .055}"/>`;
  }

  function digit(n, ox, oy) {
    const s = SEGS[n];
    const iw = W - T * 2;       // 横セグメント長
    const sh = M - T * 1.5;     // 縦セグメント長
    return [
      hbar(ox + T,     oy,           iw, s[0]),  // a
      vbar(ox + W - T, oy + T,       sh, s[1]),  // b
      vbar(ox + W - T, oy + M + T*.5, sh, s[2]), // c
      hbar(ox + T,     oy + H - T,   iw, s[3]),  // d
      vbar(ox,         oy + M + T*.5, sh, s[4]), // e
      vbar(ox,         oy + T,       sh, s[5]),  // f
      hbar(ox + T,     oy + M - T/2, iw, s[6]),  // g
    ].join('');
  }

  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');

  // 各文字のX位置: D0 D1 . D2 D3
  const x0=0, x1=x0+W+GAP, x2=x1+W+GAP, x3=x2+DOT_W+GAP, x4=x3+W+GAP;
  const totalW = x4 + W;
  const SVG_W  = 240;
  const ox     = (SVG_W - totalW) / 2;

  const wds  = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const mono = `'SF Mono','Courier New',monospace`;
  const yr   = date.getFullYear();
  const wd   = wds[date.getDay()];

  return `
  <svg width="${SVG_W}" height="${H + 28}" viewBox="0 0 ${SVG_W} ${H + 28}" style="display:block;margin:auto">
    ${digit(+mm[0], ox + x0, 0)}
    ${digit(+mm[1], ox + x1, 0)}
    <circle cx="${ox + x2 + DOT_W/2}" cy="${H * 0.73}" r="3.5" fill="white" opacity=".9"/>
    ${digit(+dd[0], ox + x3, 0)}
    ${digit(+dd[1], ox + x4, 0)}
    <text x="${SVG_W/2}" y="${H + 20}" text-anchor="middle"
          fill="white" opacity=".6" font-size="12" font-family="${mono}"
          letter-spacing="3">${yr}  ${wd}</text>
  </svg>`;
}

// ── 位置情報取得（タイムアウト8秒）─────────────────────────
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('geolocation_unsupported')); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(new Error('geolocation_failed:' + err.code)),
      { timeout: 8000, maximumAge: 60000 }
    );
  });
}

// ── ISO週番号を返す（1〜53）────────────────────────────────
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ── 対象週リストを作る（前後 SEASONAL_WEEKS 週、1〜53でラップ）
function getTargetWeeks() {
  const base = getISOWeek(getSelectedDate());
  const weeks = new Set();
  for (let d = -SEASONAL_WEEKS; d <= SEASONAL_WEEKS; d++) {
    weeks.add(((base - 1 + d + 53) % 53) + 1);
  }
  return [...weeks];
}

// ── iNaturalist: 種別観察数を取得 ────────────────────────────
async function fetchSpeciesCounts({ lat, lng, weeks = null, perPage = TOP_N }) {
  const params = new URLSearchParams({
    lat, lng, radius: RADIUS_KM, per_page: perPage, locale: 'ja', quality_grade: 'research',
  });
  if (weeks) params.set('week', weeks.join(','));
  const res = await fetch(`${INAT_API}/observations/species_counts?${params}`);
  if (!res.ok) throw new Error(`iNaturalist API エラー (${res.status})`);
  return (await res.json()).results;
}

// ── 季節性スコアを計算 ────────────────────────────────────────
// score = (seasonal_count^2) / (yearly_count + 1)
function computeScores(seasonal, yearly) {
  const yearlyMap = {};
  for (const item of yearly) yearlyMap[item.taxon.id] = item.count;
  return seasonal.map(item => {
    const sc = item.count;
    const yc = yearlyMap[item.taxon.id] ?? sc;
    return { ...item, seasonal_count: sc, yearly_count: yc, score: (sc * sc) / (yc + 1) };
  }).sort((a, b) => b.score - a.score);
}

// ── シード付き PRNG（mulberry32）────────────────────────────
function seededRandom(seed) {
  let t = seed + 0x6D2B79F5;
  return function () {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getDayOfYear(date) {
  return Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
}

// ── 直近回避 + 週シャッフル割り当て ─────────────────────────
// 履歴フォーマット: { "YYYY-MM-DD": { id: taxonId, rank: number } }
const HISTORY_KEY = 'creature_history';

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); }
  catch { return {}; }
}

function saveHistory(date, id, rank) {
  const history = loadHistory();
  history[dateKey(date)] = { id, rank };
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// 直近 days 日間に表示した taxonId の Set
function recentTaxonIds(date, days) {
  const history = loadHistory();
  const ids = new Set();
  for (let d = 1; d <= days; d++) {
    const past = new Date(date);
    past.setDate(past.getDate() - d);
    const entry = history[dateKey(past)];
    if (!entry) continue;
    ids.add(typeof entry === 'object' ? entry.id : entry);
  }
  return ids;
}

// Fisher-Yates シャッフル（シード付き）
function shuffleWithSeed(arr, seed) {
  const rand = seededRandom(seed);
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// 月曜=0, 火曜=1, ..., 日曜=6
function getDayOfWeek(date) {
  return (date.getDay() + 6) % 7;
}

function rotationPick(scored, date) {
  const recentIds = recentTaxonIds(date, AVOID_DAYS);

  // 直近14日以内に表示した種を除外
  const eligible = scored
    .map((item, i) => ({ item, rank: i + 1 }))
    .filter(({ item }) => !recentIds.has(item.taxon.id));

  if (!eligible.length) {
    // 全種ブロック済み → フォールバックで1位
    saveHistory(date, scored[0].taxon.id, 1);
    return scored[0];
  }

  // 上位 WEEKLY_SLOTS 種に絞ってから週シードでシャッフル → 曜日で割り当て
  const topEligible = eligible.slice(0, Math.min(WEEKLY_SLOTS, eligible.length));
  const weekSeed = getISOWeek(date) * 10000 + date.getFullYear();
  const shuffled = shuffleWithSeed(topEligible, weekSeed);
  const picked = shuffled[getDayOfWeek(date) % shuffled.length];

  saveHistory(date, picked.item.taxon.id, picked.rank);
  return picked.item;
}

// ── 写真URLとクレジットを取得 ────────────────────────────────
const LICENSE_URLS = {
  'cc-by':       'https://creativecommons.org/licenses/by/4.0/',
  'cc-by-nc':    'https://creativecommons.org/licenses/by-nc/4.0/',
  'cc-by-sa':    'https://creativecommons.org/licenses/by-sa/4.0/',
  'cc-by-nd':    'https://creativecommons.org/licenses/by-nd/4.0/',
  'cc-by-nc-sa': 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  'cc-by-nc-nd': 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
  'cc0':         'https://creativecommons.org/publicdomain/zero/1.0/',
};

function extractPhoto(taxon) {
  const photo = taxon.default_photo;
  if (!photo || !photo.license_code) return null;
  return {
    url: photo.medium_url || photo.url,
    attribution: photo.attribution || '',
    licenseCode: photo.license_code,
    licenseUrl: LICENSE_URLS[photo.license_code] ?? null,
  };
}

// ── taxon_photos から代替写真を取得 ─────────────────────────
async function fetchAlternativePhoto(taxonId) {
  try {
    const res = await fetch(`${INAT_API}/taxa/${taxonId}`);
    if (!res.ok) return null;
    const taxonPhotos = (await res.json()).results?.[0]?.taxon_photos ?? [];
    for (const tp of taxonPhotos) {
      const p = tp.photo;
      if (p?.license_code && LICENSE_URLS[p.license_code]) {
        return {
          url: p.medium_url || p.url,
          attribution: p.attribution || '',
          licenseCode: p.license_code,
          licenseUrl: LICENSE_URLS[p.license_code],
        };
      }
    }
    return null;
  } catch { return null; }
}

// ── 地名を逆ジオコード（Nominatim）────────────────────────────
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ja`,
      { headers: { 'User-Agent': 'creature-of-the-day/1.0' } }
    );
    const addr = (await res.json()).address || {};
    return addr.city || addr.town || addr.village || addr.municipality || addr.county || '現在地';
  } catch { return '現在地'; }
}

// ── UI 更新 ──────────────────────────────────────────────────
function showError(msg, showLocationFallback = false) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('creature').classList.add('hidden');
  document.getElementById('error').classList.remove('hidden');
  document.getElementById('error-msg').textContent = msg;
  document.getElementById('manual-location').classList.toggle('hidden', !showLocationFallback);
}

function showCreature(item, photo, scored) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');

  const taxon = item.taxon;
  const commonName = taxon.preferred_common_name || taxon.name;
  const rank = scored.findIndex(s => s.taxon.id === item.taxon.id) + 1;

  document.getElementById('common-name').textContent = commonName;
  document.getElementById('sci-name').textContent = taxon.name;
  document.getElementById('stats').innerHTML =
    `この時期（±${SEASONAL_WEEKS}週）・半径${RADIUS_KM}km以内での観察: <strong>${item.seasonal_count}件</strong><br>` +
    `年間観察: ${item.yearly_count}件 ／ 季節性スコア: ${item.score.toFixed(1)}（${rank}位）`;

  const link = `https://www.inaturalist.org/taxa/${taxon.id}`;
  document.getElementById('inat-link').href = link;

  const photoEl = document.getElementById('photo');
  const creditEl = document.getElementById('photo-credit');
  if (photo) {
    photoEl.src = photo.url;
    photoEl.alt = commonName;
    photoEl.style.display = 'block';
    document.getElementById('photo-placeholder').style.display = 'none';
    const licenseLabel = photo.licenseCode.toUpperCase().replace('CC-', 'CC ');
    const licenseLink = photo.licenseUrl
      ? `<a href="${photo.licenseUrl}" target="_blank">${licenseLabel}</a>`
      : licenseLabel;
    creditEl.innerHTML = `<a href="${link}" target="_blank">${photo.attribution}</a> · ${licenseLink}`;
  } else {
    photoEl.style.display = 'none';
    document.getElementById('photo-placeholder').style.display = 'flex';
    creditEl.innerHTML = '';
  }

  document.getElementById('creature').classList.remove('hidden');
}

function showDebugTable(scored, winner) {
  const date = getSelectedDate();
  const recentIds = recentTaxonIds(date, AVOID_DAYS);

  // 今週の枠に入っている種（eligible上位7種）を特定
  const eligible = scored
    .map((item, i) => ({ item, rank: i + 1 }))
    .filter(({ item }) => !recentIds.has(item.taxon.id));
  const weeklyIds = new Set(
    eligible.slice(0, Math.min(WEEKLY_SLOTS, eligible.length)).map(e => e.item.taxon.id)
  );

  const rows = scored.slice(0, 10).map((item, i) => {
    const name = item.taxon.preferred_common_name || item.taxon.name;
    const isWinner = item.taxon.id === winner.taxon.id;
    const isBlocked = recentIds.has(item.taxon.id);
    const inWeekly = weeklyIds.has(item.taxon.id);
    const style = isWinner  ? 'color:#58a6ff;font-weight:600'
                : isBlocked ? 'color:#444;text-decoration:line-through'
                : !inWeekly ? 'color:#555' : '';
    const label = isWinner ? '★' : isBlocked ? '✕' : i + 1;
    return `<tr style="${style}">
      <td>${label}</td><td>${name}</td>
      <td>${item.seasonal_count}</td><td>${item.yearly_count}</td>
      <td>${item.score.toFixed(1)}</td>
    </tr>`;
  }).join('');
  document.getElementById('debug-table').innerHTML = `
    <tr><th>#</th><th>種名</th><th>季節</th><th>年間</th><th>スコア</th></tr>
    ${rows}
  `;
}

function toggleDebug() {
  const el = document.getElementById('algo-debug');
  el.classList.toggle('hidden');
  document.getElementById('debug-toggle').textContent =
    el.classList.contains('hidden') ? 'スコア詳細を表示' : 'スコア詳細を隠す';
}

// ── 直前のスコアをメモリに保持（モード切替時の再利用のみ）──
let lastScored = null;

async function renderResult(scored) {
  const winner = rotationPick(scored, getSelectedDate());
  let photo = extractPhoto(winner.taxon);
  if (!photo) photo = await fetchAlternativePhoto(winner.taxon.id);
  showCreature(winner, photo, scored);
  showDebugTable(scored, winner);
}

// ── 日付変更ハンドラ ─────────────────────────────────────────
let cachedLocation = null;

async function onDateChange() {
  renderDateHeader();
  if (!cachedLocation) return;
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('creature').classList.add('hidden');
  document.getElementById('algo-debug').classList.add('hidden');
  await fetchAndRender(cachedLocation.lat, cachedLocation.lng);
}

// ── データ取得 + 表示 ────────────────────────────────────────
async function fetchAndRender(lat, lng) {
  const weeks = getTargetWeeks();
  let seasonal, yearly;
  try {
    [seasonal, yearly] = await Promise.all([
      fetchSpeciesCounts({ lat, lng, weeks }),
      fetchSpeciesCounts({ lat, lng, perPage: TOP_N_YEARLY }),
    ]);
  } catch (e) {
    showError('データ取得に失敗しました: ' + e.message);
    return;
  }
  if (!seasonal.length) {
    showError('近くの観察データが見つかりませんでした。\n観察記録が少ない地域かもしれません。');
    return;
  }
  lastScored = computeScores(seasonal, yearly);
  await renderResult(lastScored);
}

// ── メイン ───────────────────────────────────────────────────
async function init() {
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('creature').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');
  document.getElementById('algo-debug').classList.add('hidden');

  initDatePicker();
  renderDateHeader();

  try {
    cachedLocation = await getLocation();
  } catch (e) {
    const isLocationError = e.message.startsWith('geolocation_');
    showError(
      isLocationError
        ? '位置情報を取得できませんでした。\nfile://で開いている場合はlocalhostが必要です。\n場所を手動で指定してください。'
        : e.message,
      isLocationError
    );
    return;
  }

  setLocationText(cachedLocation.lat, cachedLocation.lng);

  await fetchAndRender(cachedLocation.lat, cachedLocation.lng);
}

// ── 場所ラベルを更新（即時 → 地名解決後に上書き）────────────
function setLocationText(lat, lng) {
  const el = document.getElementById('location-text');
  el.textContent = `現在地 周辺 ${RADIUS_KM}km`;
  reverseGeocode(lat, lng).then(place => {
    el.textContent = `${place} 周辺 ${RADIUS_KM}km`;
  });
}

// ── 場所パネル ───────────────────────────────────────────────
function toggleLocationPanel() {
  document.getElementById('location-panel').classList.toggle('hidden');
}

function closeLocationPanel() {
  document.getElementById('location-panel').classList.add('hidden');
}

async function useCurrentLocation() {
  closeLocationPanel();
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('creature').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');
  document.getElementById('algo-debug').classList.add('hidden');
  try {
    cachedLocation = await getLocation();
  } catch {
    showError('位置情報を取得できませんでした。場所を手動で指定してください。', true);
    return;
  }
  setLocationText(cachedLocation.lat, cachedLocation.lng);
  await fetchAndRender(cachedLocation.lat, cachedLocation.lng);
}

// ── 手動位置入力 ─────────────────────────────────────────────
async function usePreset(lat, lng) { await startWithLocation(lat, lng); }

async function useManualLatLng() {
  const lat = parseFloat(document.getElementById('input-lat').value);
  const lng = parseFloat(document.getElementById('input-lng').value);
  if (isNaN(lat) || isNaN(lng)) { alert('正しい数値を入力してください'); return; }
  await startWithLocation(lat, lng);
}

async function usePanelManualLatLng() {
  const lat = parseFloat(document.getElementById('panel-lat').value);
  const lng = parseFloat(document.getElementById('panel-lng').value);
  if (isNaN(lat) || isNaN(lng)) { alert('正しい数値を入力してください'); return; }
  await startWithLocation(lat, lng);
}

async function startWithLocation(lat, lng) {
  closeLocationPanel();
  cachedLocation = { lat, lng };
  document.getElementById('error').classList.add('hidden');
  document.getElementById('loading').classList.remove('hidden');
  reverseGeocode(lat, lng).then(place => {
    document.getElementById('location-text').textContent = `${place} 周辺 ${RADIUS_KM}km`;
  });
  await fetchAndRender(lat, lng);
}

// ── 起動 ─────────────────────────────────────────────────────
init();
