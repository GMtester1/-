const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { crawlAllMetersOnDemand } = require("./src/services/meterService");
const { crawlKpxCurtailmentNotice } = require("./src/services/kpxService");

const LOCAL_PORT = Number(process.env.PORT) || 3010;
const KPX_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3시간 주기 (10,800,000ms)
const CMD_POLL_INTERVAL_MS = 2500; // 외부 웹/모바일 [새로고침] 클릭 감지 주기 (2.5초)
const INDEX_FILE = path.join(__dirname, "index.html");
const DASHBOARD_FILE = path.join(__dirname, "dashboard.html");

// 외부 웹(Vercel/GitHub Pages)/스마트폰 실시간 온디맨드 중계용 설정
const SUPABASE_URL = "https://yihwudxvoplamekroprx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpaHd1ZHh2b3BsYW1la3JvcHJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4OTM0NDAsImV4cCI6MjEwMzQ2OTQ0MH0.FX2uU90oZClfiwTJX5S0hDMbPEKMepvGiougVStK7XI";
const SUPABASE_TABLE = "generator_shutdown_schedules";
const KEY_METER_CMD = "CURTAILMENT_METER_CMD";
const KEY_METER_RES = "CURTAILMENT_METER_RES";
const KEY_KPX_DATA = "CURTAILMENT_KPX_DATA";

let isMeterCrawling = false;
let lastMeterPayload = null;
let latestKpxNotice = null;
let lastHandledCmdTime = Date.now();

function supabaseRequest(method, queryPath, bodyObj = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(SUPABASE_URL + queryPath);
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers = Object.assign({
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json; charset=utf-8"
    }, extraHeaders);
    if (bodyStr) {
      headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }

    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method,
      rejectUnauthorized: false,
      timeout: 10000,
      headers
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(text ? JSON.parse(text) : null);
          } catch (_) {
            resolve(text);
          }
        } else {
          reject(new Error(`Supabase HTTP ${res.statusCode}: ${text}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Supabase 요청 타임아웃")));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function pushCloudKey(keyName, payloadObj) {
  try {
    const nowTs = Date.now();
    await supabaseRequest(
      "POST",
      `/rest/v1/${SUPABASE_TABLE}?on_conflict=category`,
      [{
        category: keyName,
        content: JSON.stringify(payloadObj),
        updated_at: nowTs
      }],
      { "Prefer": "resolution=merge-duplicates,return=minimal" }
    );
  } catch (_) {}
}

/**
 * 웹/모바일에서 [계량데이터 새로고침] 버튼을 클릭했을 때 온디맨드로 크롤링합니다.
 */
async function executeMeterCrawlOnDemand(sourceLabel = "로컬") {
  if (isMeterCrawling && lastMeterPayload) {
    return lastMeterPayload;
  }
  isMeterCrawling = true;
  try {
    console.log(`[${sourceLabel} 새로고침 요청] 40개 발전소 5분 계량실적(MW) 실시간 크롤링 시작...`);
    lastMeterPayload = await crawlAllMetersOnDemand();
    lastHandledCmdTime = Date.now();
    await pushCloudKey(KEY_METER_RES, lastMeterPayload);
    console.log(`[계량데이터 크롤링 완료] (${lastMeterPayload.meta.crawledAt})`);
    return lastMeterPayload;
  } finally {
    isMeterCrawling = false;
  }
}

/**
 * 외부 웹/스마트폰에서 [계량데이터 새로고침] 클릭 시 실시간 감지하여 크롤링 수행
 */
async function pollRemoteMeterCrawlCommand() {
  if (isMeterCrawling) return;
  try {
    const rows = await supabaseRequest(
      "GET",
      `/rest/v1/${SUPABASE_TABLE}?category=eq.${KEY_METER_CMD}&select=updated_at`
    );
    if (Array.isArray(rows) && rows.length > 0) {
      const cmdTime = Number(rows[0].updated_at) || 0;
      if (cmdTime > lastHandledCmdTime) {
        lastHandledCmdTime = cmdTime;
        await executeMeterCrawlOnDemand("외부 웹/모바일");
      }
    }
  } catch (_) {}
}

/**
 * 전력거래소(KPX) 육지 출력제어 전망 공지를 확인하고 콘솔에 로그를 출력합니다.
 */
async function checkKpxSchedule() {
  try {
    const notice = await crawlKpxCurtailmentNotice();
    latestKpxNotice = notice;
    await pushCloudKey(KEY_KPX_DATA, notice);
    if (notice.hasForecast && notice.forecast) {
      const fc = notice.forecast;
      console.log(
        `[${notice.checkedAt}] [KPX 출력제어 전망 확인] ${fc.title} | 예정일: ${fc.scheduledDate} | 시간: ${fc.scheduledTime}`
      );
    } else {
      console.log(`[${notice.checkedAt}] [KPX 출력제어 전망 확인] 최근 전망 게시글 없음`);
    }
    return notice;
  } catch (err) {
    console.error(`[KPX 크롤링 오류] ${err.message}`);
    throw err;
  }
}

/**
 * 로컬 대시보드 및 크롤링 API 서버를 시작합니다.
 */
function startServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    // 1. 온디맨드 실시간 계량데이터(MW) 크롤링 API (데이터 파일 저장 없음, 새로고침 클릭 시에만 실행)
    if (req.url.startsWith("/api/meters") && (req.method === "GET" || req.method === "POST")) {
      try {
        const data = await executeMeterCrawlOnDemand("웹 대시보드");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify(data));
      } catch (err) {
        console.error("[계량데이터 크롤링 실패]", err.message);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    // 2. 전력거래소(KPX) 출력제어 예고 확인 크롤링 API
    if (req.url.startsWith("/api/kpx-notice") && (req.method === "GET" || req.method === "POST")) {
      try {
        const notice = await checkKpxSchedule();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify(notice));
      } catch (err) {
        if (latestKpxNotice) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify(latestKpxNotice));
        }
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    // 3. 대시보드 웹페이지 제공
    if (req.url === "/" || req.url.startsWith("/index.html") || req.url.startsWith("/dashboard.html")) {
      const targetFile = fs.existsSync(INDEX_FILE) ? INDEX_FILE : DASHBOARD_FILE;
      if (fs.existsSync(targetFile)) {
        const html = fs.readFileSync(targetFile, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(html);
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  server.on("error", err => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[안내] 로컬 포트(${LOCAL_PORT})가 이미 사용 중입니다. 실행 중인 대시보드 서버를 이용해주세요.`);
    } else {
      console.error("서버 오류:", err.message);
    }
  });

  server.listen(LOCAL_PORT, () => {
    console.log("============================================================================");
    console.log(" [K-water 전력거래소 출력제어 대응 대시보드 서버]");
    console.log(` - 대시보드 접속 주소: http://localhost:${LOCAL_PORT}`);
    console.log(" - 계량데이터(MW): 데이터 저장 없이 웹 화면에서 [계량데이터 새로고침] 클릭 시에만 실시간 크롤링");
    console.log(" - 전력거래소(KPX) 출력제어 전망: 3시간 주기 자동 크롤링 및 예정일/시간 공지");
    console.log("============================================================================\n");
  });
}

async function main() {
  if (fs.existsSync(INDEX_FILE)) {
    fs.copyFileSync(INDEX_FILE, DASHBOARD_FILE);
  }

  startServer();

  // 최초 기동 시 KPX 출력제어 전망 1회 확인 후 3시간 주기 타이머 작동
  await checkKpxSchedule().catch(() => {});
  setInterval(() => {
    checkKpxSchedule().catch(() => {});
  }, KPX_CHECK_INTERVAL_MS);

  // 외부 웹(Vercel/GitHub Pages)/모바일 새로고침 버튼 클릭 감지
  setInterval(() => {
    pollRemoteMeterCrawlCommand();
  }, CMD_POLL_INTERVAL_MS);
}

main().catch(err => {
  console.error("서버 시작 실패:", err);
  process.exit(1);
});
