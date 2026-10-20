const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOST = "203.237.1.41";
const PORT = 8085;
const LOCAL_PORT = 3000;
const CRAWL_INTERVAL_MS = 60 * 60 * 1000; // 60분 주기
const DASHBOARD_FILE = path.join(__dirname, "dashboard.html");
const INDEX_FILE = path.join(__dirname, "index.html");
const DATA_JSON_FILE = path.join(__dirname, "data.json");
const ACCOUNT_FILE = path.join(__dirname, "account.txt");

// 26개 수집 대상 계량기 목록
const METERS = [
  // 1. 대수력 (6개)
  { group: "대수력", name: "안동수력#1", code: "15304" },
  { group: "대수력", name: "임하수력#1", code: "15960" },
  { group: "대수력", name: "합천수력#1", code: "15310" },
  { group: "대수력", name: "합천수력#2", code: "15961" },
  { group: "대수력", name: "남강수력#1", code: "15670" },
  { group: "대수력", name: "남강수력#2", code: "16817" },

  // 2. 보수력 (8개)
  { group: "보수력", name: "상주보#1", code: "16721" },
  { group: "보수력", name: "낙단보#1", code: "16722" },
  { group: "보수력", name: "구미보", code: "16700" },
  { group: "보수력", name: "칠곡보#1", code: "16719" },
  { group: "보수력", name: "강정보#1", code: "16690" },
  { group: "보수력", name: "달성보#1", code: "16720" },
  { group: "보수력", name: "합천창녕보", code: "16712" },
  { group: "보수력", name: "창녕함안보", code: "16711" },

  // 3. 중소댐 (5개)
  { group: "중소댐", name: "군위댐소수력#1", code: "16626" },
  { group: "중소댐", name: "보현산소수력", code: "16757" },
  { group: "중소댐", name: "부항댐소수력#1", code: "16741" },
  { group: "중소댐", name: "영주댐소수력", code: "16787" },
  { group: "중소댐", name: "성덕소수력", code: "16758" },

  // 4. 조정지댐 (3개)
  { group: "조정지댐", name: "안동소수력#1", code: "15669" },
  { group: "조정지댐", name: "임하소수력#1", code: "15285" },
  { group: "조정지댐", name: "합천소수력#1", code: "15587" },

  // 5. 현장 (4개)
  { group: "현장", name: "밀양소수력#1", code: "16156" },
  { group: "현장", name: "고산정수장소수력#1", code: "16445" },
  { group: "현장", name: "안계소수력#1", code: "16737" },
  { group: "현장", name: "영천소수력#1", code: "15668" }
];

function readAccount() {
  // 1순위: 환경변수 (GitHub Actions 시크릿용)
  if (process.env.KWATER_ID && process.env.KWATER_PW) {
    return {
      id: process.env.KWATER_ID.trim(),
      pw: process.env.KWATER_PW.trim()
    };
  }
  // 2순위: 로컬 account.txt
  const content = fs.readFileSync(ACCOUNT_FILE, "utf8");
  const idMatch = content.match(/id\s*:\s*(\S+)/i);
  const pwMatch = content.match(/pw\s*:\s*(\S+)/i);
  if (!idMatch || !pwMatch) {
    throw new Error("account.txt에서 id 또는 pw를 찾을 수 없습니다.");
  }
  return { id: idMatch[1].trim(), pw: pwMatch[1].trim() };
}

function getKstStrings() {
  // GitHub Actions(UTC) 환경에서도 항상 한국시간(KST, UTC+9) 기준으로 동작
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 3600000));
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, "0");
  const dd = String(kst.getDate()).padStart(2, "0");
  const hh = String(kst.getHours()).padStart(2, "0");
  const min = String(kst.getMinutes()).padStart(2, "0");
  const sec = String(kst.getSeconds()).padStart(2, "0");
  return {
    dateDash: `${yyyy}-${mm}-${dd}`,
    dateCompact: `${yyyy}${mm}${dd}`,
    nowFormatted: `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`
  };
}

function login(id, pw) {
  return new Promise((resolve, reject) => {
    const body = `serviceCode=login&view=/loginResult.jsp&id=${encodeURIComponent(id)}&password=${encodeURIComponent(pw)}`;
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: "/mtr/action.do",
      method: "POST",
      timeout: 15000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    }, res => {
      res.resume();
      const setCookie = res.headers["set-cookie"];
      if (!setCookie || !setCookie.length) {
        return reject(new Error("로그인 응답에 Set-Cookie(JSESSIONID)가 없습니다."));
      }
      const cookie = setCookie[0].split(";")[0];
      resolve(cookie);
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("로그인 요청 타임아웃")));
    req.end(body);
  });
}

function fetchMeterHtml(cookie, code, dateDash) {
  return new Promise((resolve, reject) => {
    const body =
      `nodetype=EnergyMeter&nodecode=${code}` +
      `&serviceCode=retrieveListWeighingResult` +
      `&view=/metering/ajaxweighingresult/main.jsp` +
      `&prefix=master&master_dataType=result` +
      `&master_startDate=${dateDash}&master_endDate=${dateDash}` +
      `&master_dateTerm=5min&master_displayMode=data` +
      `&master_chCount=5&master_ch1=1&master_ch2=1` +
      `&master_result1=1&master_result2=1&master_unit=Wh`;

    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: "/mtr/ajax.do",
      method: "POST",
      timeout: 15000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "Cookie": cookie
      }
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const html = new TextDecoder("euc-kr").decode(Buffer.concat(chunks));
        resolve(html);
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`계량기(${code}) 조회 타임아웃`)));
    req.end(body);
  });
}

function fetchLastCommDate(cookie, code) {
  return new Promise(resolve => {
    const body = `serviceCode=retrieveWeighingResult&view=/metering/weighingResult.jsp&nodecode=${code}&nodetype=EnergyMeter`;
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: "/mtr/action.do",
      method: "POST",
      timeout: 15000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "Cookie": cookie
      }
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const html = new TextDecoder("euc-kr").decode(Buffer.concat(chunks));
        const m = html.match(/최종통신시간\s*<\/th>\s*<td><input[^>]*value="(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})"/);
        resolve(m ? { dateDash: m[1], timeStr: m[2] } : null);
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end(body);
  });
}

function extractRows(html) {
  const re = /<td[^>]*>(\d{8})<\/td>\s*<td[^>]*><nobr>(\d{2}\s*:\s*\d{2})<\/nobr><\/td>\s*<td[^>]*>\s*<nobr>\s*([^\s<]+)\s*<\/nobr>\s*<\/td>\s*<td[^>]*><nobr>\s*([^\s<]+)\s*<\/nobr><\/td>\s*<td[^>]*><nobr>\s*([^\s<]+)\s*<\/nobr>/gs;
  const rows = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const rawWh = m[3].trim();
    const numericWh = rawWh === "-" || rawWh === "X" ? null : parseFloat(rawWh.replace(/,/g, ""));
    rows.push({
      date: m[1].trim(),
      time: m[2].replace(/\s+/g, ""),
      rawWh,
      wh: Number.isNaN(numericWh) ? null : numericWh,
      pf: m[4].trim(),
      flag: m[5].trim()
    });
  }
  return rows;
}

async function fetchAndParseMeter(cookie, meter, dateDash) {
  const html = await fetchMeterHtml(cookie, meter.code, dateDash);
  const rows = extractRows(html);

  if (rows.length === 0) {
    const lastComm = await fetchLastCommDate(cookie, meter.code);
    if (lastComm) {
      const oldHtml = await fetchMeterHtml(cookie, meter.code, lastComm.dateDash);
      const oldRows = extractRows(oldHtml);
      const normalOld = oldRows.filter(r => r.flag === "정상" && r.wh !== null);
      const lastOld = normalOld.length > 0 ? normalOld[normalOld.length - 1] : null;
      if (lastOld) {
        return {
          group: meter.group,
          name: meter.name,
          time: lastOld.time,
          whTimes12: lastOld.wh * 12,
          flag: "실패(비정상)"
        };
      }
    }
    return {
      group: meter.group,
      name: meter.name,
      time: "-",
      whTimes12: null,
      flag: "실패(비정상)"
    };
  }

  // 최근 검침완료시각(Flag === '정상') 기준
  const normalRows = rows.filter(r => r.flag === "정상" && r.wh !== null);
  const latestNormal = normalRows.length > 0 ? normalRows[normalRows.length - 1] : null;

  if (latestNormal) {
    return {
      group: meter.group,
      name: meter.name,
      time: latestNormal.time,
      whTimes12: latestNormal.wh * 12,
      flag: latestNormal.flag
    };
  }

  const lastRow = rows[rows.length - 1];
  return {
    group: meter.group,
    name: meter.name,
    time: lastRow ? lastRow.time : "-",
    whTimes12: lastRow && lastRow.wh !== null ? lastRow.wh * 12 : null,
    flag: lastRow ? lastRow.flag : "실패(비정상)"
  };
}

function buildDashboardHtml(results, meta, authHash) {
  const groups = ["대수력", "보수력", "중소댐", "조정지댐", "현장"];
  const dataJson = JSON.stringify({ meta, results });

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>K-water 실시간 발전실적 대시보드</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0ea5e9;
      --ok-bg: rgba(16, 185, 129, 0.15);
      --ok-text: #34d399;
      --err-bg: rgba(239, 68, 68, 0.15);
      --err-text: #f87171;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Pretendard', 'Malgun Gothic', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      padding: 20px;
      line-height: 1.5;
    }
    /* 로그인 모달 화면 */
    #loginOverlay {
      position: fixed;
      inset: 0;
      background: #0b1120;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      padding: 20px;
    }
    .login-card {
      width: 100%;
      max-width: 390px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px 26px;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.6);
    }
    .login-title {
      font-size: 1.35rem;
      font-weight: 800;
      text-align: center;
      margin-bottom: 6px;
      color: var(--text);
    }
    .login-desc {
      font-size: 0.85rem;
      color: var(--muted);
      text-align: center;
      margin-bottom: 24px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group label {
      display: block;
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .form-input {
      width: 100%;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #0f172a;
      color: var(--text);
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.15s;
    }
    .form-input:focus {
      border-color: var(--accent);
    }
    .login-error {
      color: var(--err-text);
      font-size: 0.83rem;
      margin-bottom: 14px;
      text-align: center;
      display: none;
    }
    .login-btn {
      width: 100%;
      padding: 13px;
      border: none;
      border-radius: 10px;
      background: var(--accent);
      color: #0f172a;
      font-size: 0.98rem;
      font-weight: 800;
      cursor: pointer;
      transition: background 0.15s;
    }
    .login-btn:hover {
      background: var(--accent-hover);
    }

    /* 대시보드 본문 (로그인 전 숨김) */
    #appContent {
      display: none;
      max-width: 1600px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
      padding: 20px 24px;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
    }
    .title-area h1 {
      font-size: 1.45rem;
      font-weight: 800;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .live-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background-color: #10b981;
      box-shadow: 0 0 10px #10b981;
      animation: pulse 2s infinite;
      flex-shrink: 0;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
    .subtitle {
      font-size: 0.85rem;
      color: var(--muted);
      margin-top: 6px;
    }
    .right-panel {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    .timestamp-box {
      background: rgba(56, 189, 248, 0.14);
      border: 2px solid var(--accent);
      border-radius: 12px;
      padding: 10px 18px;
      text-align: right;
    }
    .timestamp-label {
      font-size: 0.76rem;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 0.04em;
    }
    .timestamp-value {
      font-size: 1.4rem;
      font-weight: 800;
      color: #ffffff;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.02em;
    }
    .refresh-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: var(--accent);
      color: #0f172a;
      border: none;
      border-radius: 10px;
      padding: 14px 20px;
      font-size: 0.92rem;
      font-weight: 800;
      cursor: pointer;
      transition: all 0.15s ease;
      box-shadow: 0 4px 12px rgba(56, 189, 248, 0.3);
    }
    .refresh-btn:hover:not(:disabled) {
      background: var(--accent-hover);
      transform: translateY(-1px);
    }
    .refresh-btn:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    .logout-btn {
      background: transparent;
      color: var(--muted);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 13px 14px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
    }
    .logout-btn:hover {
      color: var(--text);
      border-color: var(--muted);
    }
    .spin {
      display: inline-block;
      animation: rotate 1s linear infinite;
    }
    @keyframes rotate {
      100% { transform: rotate(360deg); }
    }
    .summary-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .summary-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
    }
    .summary-label {
      font-size: 0.78rem;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .summary-val {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text);
    }
    .grid-container {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 18px;
    }
    .group-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .group-header {
      background: rgba(255, 255, 255, 0.03);
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .group-title {
      font-size: 1.02rem;
      font-weight: 700;
      color: var(--accent);
    }
    .group-count {
      font-size: 0.78rem;
      color: var(--muted);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th, td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    th {
      font-size: 0.76rem;
      color: var(--muted);
      font-weight: 600;
      background: rgba(15, 23, 42, 0.4);
    }
    td.num, th.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    td.center, th.center {
      text-align: center;
    }
    tr:last-child td {
      border-bottom: none;
    }
    .meter-name {
      font-weight: 600;
      color: var(--text);
    }
    .badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 0.74rem;
      font-weight: 600;
    }
    .badge-ok {
      background: var(--ok-bg);
      color: var(--ok-text);
    }
    .badge-err {
      background: var(--err-bg);
      color: var(--err-text);
    }
    .val-highlight {
      font-weight: 700;
      font-size: 0.98rem;
      color: #f8fafc;
    }
    .val-zero {
      color: var(--muted);
    }
    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #1e293b;
      border: 1px solid var(--accent);
      color: var(--text);
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 0.85rem;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      display: none;
      z-index: 1000;
    }
    @media (max-width: 600px) {
      body { padding: 12px; }
      .header { padding: 16px; }
      .right-panel { width: 100%; justify-content: space-between; }
      .timestamp-box { width: 100%; text-align: center; }
      .refresh-btn { flex: 1; }
      .grid-container { grid-template-columns: 1fr; }
      th, td { padding: 9px 10px; font-size: 0.84rem; }
    }
  </style>
</head>
<body>
  <!-- 최초 접속 로그인 화면 -->
  <div id="loginOverlay">
    <form class="login-card" onsubmit="handleLogin(event)">
      <div class="login-title">K-water 계량실적 대시보드</div>
      <div class="login-desc">접속을 위해 계정 정보(ID / PW)를 입력해주세요.</div>
      <div class="form-group">
        <label for="userId">아이디 (ID)</label>
        <input type="text" id="userId" class="form-input" placeholder="아이디 입력" required autocomplete="username" />
      </div>
      <div class="form-group">
        <label for="userPw">비밀번호 (Password)</label>
        <input type="password" id="userPw" class="form-input" placeholder="비밀번호 입력" required autocomplete="current-password" />
      </div>
      <div class="login-error" id="loginError">아이디 또는 비밀번호가 일치하지 않습니다.</div>
      <button type="submit" class="login-btn">로그인</button>
    </form>
  </div>

  <!-- 대시보드 본문 -->
  <div id="appContent">
    <div class="header">
      <div class="title-area">
        <h1><span class="live-dot"></span> K-water 실시간 계량실적 대시보드</h1>
        <div class="subtitle">
          최근 검침완료시각 기준 &nbsp;|&nbsp; 자동 크롤링 주기: <strong>60분</strong>
        </div>
      </div>
      <div class="right-panel">
        <div class="timestamp-box">
          <div class="timestamp-label">크롤링 갱신시각</div>
          <div class="timestamp-value" id="crawledAtText">${meta.crawledAt}</div>
        </div>
        <button class="refresh-btn" id="refreshBtn" onclick="triggerRefresh()">
          <span id="refreshIcon">↻</span>
          <span id="refreshLabel">새로고침</span>
        </button>
        <button class="logout-btn" onclick="handleLogout()">로그아웃</button>
      </div>
    </div>

    <div class="summary-bar" id="summaryBar"></div>
    <div class="grid-container" id="gridContainer"></div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const EXPECTED_HASH = "${authHash}";
    const STORAGE_KEY = "kwater_dashboard_auth_v1";
    let PAYLOAD = ${dataJson};
    const GROUPS = ${JSON.stringify(groups)};

    // 순수 JS SHA-256 구현 (https, http, file:// 모든 스마트폰/PC 환경 지원)
    function sha256(ascii) {
      function rightRotate(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
      }
      var mathPow = Math.pow;
      var maxWord = mathPow(2, 32);
      var lengthProperty = 'length';
      var i, j;
      var result = '';
      var words = [];
      var asciiBitLength = ascii[lengthProperty] * 8;
      var hash = sha256.h = sha256.h || [];
      var k = sha256.k = sha256.k || [];
      var primeCounter = k[lengthProperty];
      var isComposite = {};
      for (var candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
          for (i = 0; i < 313; i += candidate) {
            isComposite[i] = candidate;
          }
          hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
          k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
        }
      }
      ascii += '\\x80';
      while (ascii[lengthProperty] % 64 - 56) ascii += '\\x00';
      for (i = 0; i < ascii[lengthProperty]; i++) {
        j = ascii.charCodeAt(i);
        if (j >> 8) return '';
        words[i >> 2] |= j << ((3 - i) % 4) * 8;
      }
      words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
      words[words[lengthProperty]] = (asciiBitLength);
      for (j = 0; j < words[lengthProperty];) {
        var w = words.slice(j, j += 16);
        var oldHash = hash;
        hash = hash.slice(0, 8);
        for (i = 0; i < 64; i++) {
          var i2 = i + j;
          var w15 = w[i - 15], w2 = w[i - 2];
          var a = hash[0], e = hash[4];
          var temp1 = hash[7]
            + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
            + ((e & hash[5]) ^ ((~e) & hash[6]))
            + k[i]
            + (w[i] = (i < 16) ? w[i] : (
                w[i - 16]
                + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
                + w[i - 7]
                + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
              ) | 0
            );
          var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
            + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
          hash = [(temp1 + temp2) | 0].concat(hash);
          hash[4] = (hash[4] + temp1) | 0;
        }
        for (i = 0; i < 8; i++) {
          hash[i] = (hash[i] + oldHash[i]) | 0;
        }
      }
      for (i = 0; i < 8; i++) {
        for (j = 3; j + 1; j--) {
          var b = (hash[i] >> (j * 8)) & 255;
          result += ((b < 16) ? 0 : '') + b.toString(16);
        }
      }
      return result;
    }

    function checkAuth() {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === EXPECTED_HASH) {
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('appContent').style.display = 'block';
        render();
        // GitHub Pages 환경에서 열렸을 때 최신 data.json이 있으면 자동 로드
        fetchLatestJsonSilent();
      } else {
        document.getElementById('loginOverlay').style.display = 'flex';
        document.getElementById('appContent').style.display = 'none';
      }
    }

    function handleLogin(e) {
      e.preventDefault();
      const id = document.getElementById('userId').value.trim();
      const pw = document.getElementById('userPw').value.trim();
      const hash = sha256(id + ':' + pw);
      if (hash === EXPECTED_HASH) {
        localStorage.setItem(STORAGE_KEY, hash);
        document.getElementById('loginError').style.display = 'none';
        checkAuth();
      } else {
        document.getElementById('loginError').style.display = 'block';
      }
    }

    function handleLogout() {
      localStorage.removeItem(STORAGE_KEY);
      document.getElementById('userId').value = '';
      document.getElementById('userPw').value = '';
      checkAuth();
    }

    function fmt(n) {
      if (n === null || n === undefined || Number.isNaN(n)) return '-';
      return Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 3500);
    }

    async function fetchLatestJsonSilent() {
      try {
        const res = await fetch('./data.json?t=' + Date.now(), { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data && data.meta && data.results) {
            PAYLOAD = data;
            render();
          }
        }
      } catch (_) {}
    }

    async function triggerRefresh() {
      const btn = document.getElementById('refreshBtn');
      const icon = document.getElementById('refreshIcon');
      const label = document.getElementById('refreshLabel');
      btn.disabled = true;
      icon.classList.add('spin');
      label.textContent = '크롤링 중...';

      try {
        // 1차 시도: 로컬 크롤링 서버가 켜져 있는 경우 즉시 실시간 크롤링 수행
        const localRes = await fetch('http://localhost:${LOCAL_PORT}/api/refresh', { method: 'POST' });
        if (localRes.ok) {
          const data = await localRes.json();
          PAYLOAD = data;
          render();
          showToast('실시간 즉시 크롤링 완료! (' + data.meta.crawledAt + ')');
          return;
        }
      } catch (_) {
        // PC가 꺼져 있거나 외부 스마트폰(GitHub Pages) 접속인 경우 최신 data.json 패치
      }

      try {
        const ghRes = await fetch('./data.json?t=' + Date.now(), { cache: 'no-store' });
        if (ghRes.ok) {
          const data = await ghRes.json();
          PAYLOAD = data;
          render();
          showToast('최신 데이터를 불러왔습니다. (' + data.meta.crawledAt + ')');
        } else {
          window.location.reload();
        }
      } catch (err) {
        window.location.reload();
      } finally {
        btn.disabled = false;
        icon.classList.remove('spin');
        label.textContent = '새로고침';
      }
    }

    function render() {
      const items = PAYLOAD.results;
      document.getElementById('crawledAtText').textContent = PAYLOAD.meta.crawledAt;

      let okCount = 0;
      let errCount = 0;
      let totalWhTimes12 = 0;

      items.forEach(item => {
        if (item.flag === '정상') okCount++;
        else errCount++;
        if (item.whTimes12 !== null && !Number.isNaN(item.whTimes12)) {
          totalWhTimes12 += item.whTimes12;
        }
      });

      document.getElementById('summaryBar').innerHTML = \`
        <div class="summary-card">
          <div class="summary-label">전체 모니터링 개소</div>
          <div class="summary-val">\${items.length}개소</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">정상 검침 개소</div>
          <div class="summary-val" style="color: var(--ok-text);">\${okCount}개소</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">실패 / 미수신 개소</div>
          <div class="summary-val" style="color: var(--err-text);">\${errCount}개소</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">순방향 발전실적 합계 (Wh × 12)</div>
          <div class="summary-val">\${fmt(totalWhTimes12)}</div>
        </div>
      \`;

      const container = document.getElementById('gridContainer');
      container.innerHTML = GROUPS.map(groupName => {
        const groupItems = items.filter(x => x.group === groupName);
        const rowsHtml = groupItems.map(item => {
          const isOk = item.flag === '정상';
          return \`
            <tr>
              <td><span class="meter-name">\${item.name}</span></td>
              <td class="center"><strong>\${item.time || '-'}</strong></td>
              <td class="num">
                <span class="\${item.whTimes12 && item.whTimes12 > 0 ? 'val-highlight' : 'val-zero'}">\${fmt(item.whTimes12)}</span>
              </td>
              <td class="center">
                <span class="badge \${isOk ? 'badge-ok' : 'badge-err'}">\${item.flag}</span>
              </td>
            </tr>
          \`;
        }).join('');

        return \`
          <div class="group-card">
            <div class="group-header">
              <span class="group-title">\${groupName}</span>
              <span class="group-count">\${groupItems.length}개 발전기</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>발전기</th>
                  <th class="center">시간</th>
                  <th class="num">순방향 발전실적</th>
                  <th class="center">상태</th>
                </tr>
              </thead>
              <tbody>
                \${rowsHtml}
              </tbody>
            </table>
          </div>
        \`;
      }).join('');
    }

    checkAuth();
  </script>
</body>
</html>`;
}

let latestPayload = null;
let isCrawling = false;

async function crawlOnce() {
  if (isCrawling) return latestPayload;
  isCrawling = true;
  try {
    const { id, pw } = readAccount();
    const authHash = crypto.createHash("sha256").update(`${id}:${pw}`).digest("hex");
    const { dateDash, nowFormatted } = getKstStrings();
    console.log(`[${nowFormatted}] K-water 계량시스템 로그인 및 26개 개소 크롤링 시작...`);

    const cookie = await login(id, pw);
    const results = [];

    const BATCH_SIZE = 5;
    for (let i = 0; i < METERS.length; i += BATCH_SIZE) {
      const batch = METERS.slice(i, i + BATCH_SIZE);
      const batchRes = await Promise.all(
        batch.map(async m => {
          try {
            return await fetchAndParseMeter(cookie, m, dateDash);
          } catch (err) {
            return {
              group: m.group,
              name: m.name,
              time: "-",
              whTimes12: null,
              flag: "실패(통신오류)"
            };
          }
        })
      );
      results.push(...batchRes);
    }

    const meta = { crawledAt: nowFormatted };
    latestPayload = { meta, results };

    const dashboardHtml = buildDashboardHtml(results, meta, authHash);
    // 로컬 확인용 dashboard.html 및 GitHub Pages 배포용 index.html, data.json 동시 갱신
    fs.writeFileSync(DASHBOARD_FILE, dashboardHtml, "utf8");
    fs.writeFileSync(INDEX_FILE, dashboardHtml, "utf8");
    fs.writeFileSync(DATA_JSON_FILE, JSON.stringify(latestPayload, null, 2), "utf8");
    console.log(`[${nowFormatted}] 크롤링 완료 -> dashboard.html, index.html, data.json 갱신됨`);
    return latestPayload;
  } finally {
    isCrawling = false;
  }
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    if (req.url.startsWith("/api/refresh") && (req.method === "POST" || req.method === "GET")) {
      try {
        const data = await crawlOnce();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    if (req.url.startsWith("/data.json")) {
      if (fs.existsSync(DATA_JSON_FILE)) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(fs.readFileSync(DATA_JSON_FILE, "utf8"));
      }
    }

    if (fs.existsSync(DASHBOARD_FILE)) {
      const html = fs.readFileSync(DASHBOARD_FILE, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  server.listen(LOCAL_PORT, () => {
    console.log(`대시보드 및 즉시 크롤링 서버 실행 중: http://localhost:${LOCAL_PORT}`);
  });
}

async function main() {
  const isWatch = process.argv.includes("--watch");
  await crawlOnce();

  if (isWatch) {
    startServer();
    console.log("60분(3600초) 주기 자동 크롤링 스케줄러가 활성화되었습니다.");
    setInterval(() => {
      crawlOnce().catch(err => console.error("주기 크롤링 오류:", err.message));
    }, CRAWL_INTERVAL_MS);
  }
}

main().catch(err => {
  console.error("크롤러 실행 실패:", err);
  process.exit(1);
});
