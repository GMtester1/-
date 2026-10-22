const http = require("http");
const https = require("https");

const METER_HOST = "203.237.1.41";
const METER_PORT = 8085;
const KPX_BASE_URL = "https://www.kpx.or.kr";
const KPX_BOARD_PATH = "/board.es?mid=a10109050000&bid=0216";

const UNIT_CONVERSION_MULTIPLIER = 12;
const UNIT_CONVERSION_DIVISOR = 1000000;

// 출력제어 발전소.xlsx 기준 40개소
const PLANTS = [
  // 1. 한강권역 (8개소)
  { id: "1212", region: "한강권역", name: "강천보소수력", pgCode: "1212", capacityMw: 5, meterCodes: ["16696"] },
  { id: "1095", region: "한강권역", name: "단양수중보소수력", pgCode: "1095", capacityMw: 2.4, meterCodes: ["16823"] },
  { id: "1228", region: "한강권역", name: "여주보소수력", pgCode: "1228", capacityMw: 5, meterCodes: ["16709"] },
  { id: "1227", region: "한강권역", name: "이포보소수력", pgCode: "1227", capacityMw: 3, meterCodes: ["16697"] },
  { id: "AJ67", region: "한강권역", name: "충주3수력", pgCode: "AJ67", capacityMw: 5, meterCodes: ["16836"] },
  { id: "1322", region: "한강권역", name: "횡성소수력", pgCode: "1322", capacityMw: 1, meterCodes: ["16408", "16633"] },
  { id: "BG75", region: "한강권역", name: "충주2수력", pgCode: "BG75", capacityMw: 12, meterCodes: ["16876"] },
  { id: "BT12", region: "한강권역", name: "소양강소수력", pgCode: "BT12", capacityMw: 0.75, meterCodes: ["16880"] },

  // 2. 금·영·섬권역 (14개소)
  { id: "1334", region: "금·영·섬권역", name: "공주보소수력", pgCode: "1334", capacityMw: 3, meterCodes: ["16698"] },
  { id: "1221", region: "금·영·섬권역", name: "대청댐소수력#1", pgCode: "1221", capacityMw: 0.8, meterCodes: ["15443"] },
  { id: "5572", region: "금·영·섬권역", name: "대청댐소수력#2", pgCode: "5572", capacityMw: 0.9, meterCodes: ["16810"] },
  { id: "1229", region: "금·영·섬권역", name: "백제보소수력", pgCode: "1229", capacityMw: 2.64, meterCodes: ["16691"] },
  { id: "1328", region: "금·영·섬권역", name: "보령제2소수력", pgCode: "1328", capacityMw: 0.56, meterCodes: ["15284"] },
  { id: "4628", region: "금·영·섬권역", name: "섬진강댐소수력", pgCode: "4628", capacityMw: 1.65, meterCodes: ["16786"] },
  { id: "1333", region: "금·영·섬권역", name: "세종보소수력", pgCode: "1333", capacityMw: 2.31, meterCodes: ["16682"] },
  { id: "1216", region: "금·영·섬권역", name: "승촌보소수력", pgCode: "1216", capacityMw: 0.8, meterCodes: ["16687"] },
  { id: "A462", region: "금·영·섬권역", name: "용담3소수력", pgCode: "A462", capacityMw: 2.13, meterCodes: ["15665"] },
  { id: "4973", region: "금·영·섬권역", name: "용담고산소수력#1", pgCode: "4973", capacityMw: 0.8, meterCodes: ["16784"] },
  { id: "1324", region: "금·영·섬권역", name: "용담제2수력", pgCode: "1324", capacityMw: 2.3, meterCodes: ["15914"] },
  { id: "1671", region: "금·영·섬권역", name: "장흥댐소수력", pgCode: "1671", capacityMw: 0.8, meterCodes: ["15294"] },
  { id: "1401", region: "금·영·섬권역", name: "주암소수력", pgCode: "1401", capacityMw: 0.99, meterCodes: ["15932"] },
  { id: "1214", region: "금·영·섬권역", name: "죽산보소수력", pgCode: "1214", capacityMw: 1.22, meterCodes: ["16686"] },

  // 3. 낙동강권역 (18개소)
  { id: "1213", region: "낙동강권역", name: "강정고령보소수력", pgCode: "1213", capacityMw: 3, meterCodes: ["16690"] },
  { id: "1703", region: "낙동강권역", name: "고산소수력", pgCode: "1703", capacityMw: 0.56, meterCodes: ["16445"] },
  { id: "1224", region: "낙동강권역", name: "구미보소수력", pgCode: "1224", capacityMw: 3, meterCodes: ["16700"] },
  { id: "8933", region: "낙동강권역", name: "군위댐소수력", pgCode: "8933", capacityMw: 0.5, meterCodes: ["16626"] },
  { id: "1225", region: "낙동강권역", name: "낙단보소수력", pgCode: "1225", capacityMw: 3, meterCodes: ["16722"] },
  { id: "1217", region: "낙동강권역", name: "달성보소수력", pgCode: "1217", capacityMw: 2.86, meterCodes: ["16720"] },
  { id: "1325", region: "낙동강권역", name: "밀양소수력", pgCode: "1325", capacityMw: 1.3, meterCodes: ["16156"] },
  { id: "1317", region: "낙동강권역", name: "반변소수력", pgCode: "1317", capacityMw: 1.06, meterCodes: ["15285"] },
  { id: "1851", region: "낙동강권역", name: "부항댐소수력", pgCode: "1851", capacityMw: 0.6, meterCodes: ["16741"] },
  { id: "1226", region: "낙동강권역", name: "상주보소수력", pgCode: "1226", capacityMw: 3, meterCodes: ["16721"] },
  { id: "1715", region: "낙동강권역", name: "안계소수력", pgCode: "1715", capacityMw: 0.99, meterCodes: ["16737"] },
  { id: "1318", region: "낙동강권역", name: "안동소수력", pgCode: "1318", capacityMw: 1.5, meterCodes: ["15669"] },
  { id: "1916", region: "낙동강권역", name: "영주댐수력", pgCode: "1916", capacityMw: 4.95, meterCodes: ["16787"] },
  { id: "1323", region: "낙동강권역", name: "영천소수력", pgCode: "1323", capacityMw: 1, meterCodes: ["15668"] },
  { id: "1223", region: "낙동강권역", name: "칠곡보소수력", pgCode: "1223", capacityMw: 3, meterCodes: ["16719"] },
  { id: "1215", region: "낙동강권역", name: "함안보소수력", pgCode: "1215", capacityMw: 5, meterCodes: ["16711"] },
  { id: "1218", region: "낙동강권역", name: "합천.창녕보소수력", pgCode: "1218", capacityMw: 5, meterCodes: ["16712"] },
  { id: "1115", region: "낙동강권역", name: "합천2수력", pgCode: "1115", capacityMw: 1.8, meterCodes: ["15961"] }
];

function getCredentials() {
  if (process.env.KWATER_ID && process.env.KWATER_PW) {
    return {
      id: process.env.KWATER_ID.trim(),
      pw: process.env.KWATER_PW.trim()
    };
  }
  return {
    id: Buffer.from("a3dhdGVycG93ZXI=", "base64").toString("utf8"),
    pw: Buffer.from("Z2lvc3Bvd2Vy", "base64").toString("utf8")
  };
}

function getKstStrings() {
  const now = new Date();
  const kst = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 9 * 3600000);
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, "0");
  const dd = String(kst.getDate()).padStart(2, "0");
  const hh = String(kst.getHours()).padStart(2, "0");
  const min = String(kst.getMinutes()).padStart(2, "0");
  const sec = String(kst.getSeconds()).padStart(2, "0");
  return {
    dateDash: `${yyyy}-${mm}-${dd}`,
    nowFormatted: `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`
  };
}

function loginMeter(id, pw) {
  return new Promise((resolve, reject) => {
    const body = `serviceCode=login&view=/loginResult.jsp&id=${encodeURIComponent(id)}&password=${encodeURIComponent(pw)}`;
    const req = http.request({
      hostname: METER_HOST,
      port: METER_PORT,
      path: "/mtr/action.do",
      method: "POST",
      timeout: 8000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    }, res => {
      res.resume();
      const setCookie = res.headers["set-cookie"];
      if (!setCookie || !setCookie.length) {
        return reject(new Error("로그인 쿠키 발급 실패"));
      }
      resolve(setCookie[0].split(";")[0]);
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("로그인 타임아웃")));
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
      hostname: METER_HOST,
      port: METER_PORT,
      path: "/mtr/ajax.do",
      method: "POST",
      timeout: 8000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "Cookie": cookie
      }
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        resolve(new TextDecoder("euc-kr").decode(Buffer.concat(chunks)));
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("조회 타임아웃")));
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
      wh: Number.isNaN(numericWh) ? null : numericWh,
      flag: m[5].trim()
    });
  }
  return rows;
}

async function fetchSingleCode(cookie, code, dateDash) {
  const html = await fetchMeterHtml(cookie, code, dateDash);
  const rows = extractRows(html);
  if (rows.length === 0) return { time: "-", wh: null, flag: "미수신" };

  const normalRows = rows.filter(r => r.flag === "정상" && r.wh !== null);
  const latestNormal = normalRows.length > 0 ? normalRows[normalRows.length - 1] : null;
  if (latestNormal) {
    return { time: latestNormal.time, wh: latestNormal.wh, flag: latestNormal.flag };
  }
  const lastRow = rows[rows.length - 1];
  return {
    time: lastRow ? lastRow.time : "-",
    wh: lastRow && lastRow.wh !== null ? lastRow.wh : null,
    flag: lastRow ? lastRow.flag : "미수신"
  };
}

async function crawlMeters() {
  const { id, pw } = getCredentials();
  const { dateDash, nowFormatted } = getKstStrings();
  const cookie = await loginMeter(id, pw);

  const results = [];
  const BATCH_SIZE = 14;
  for (let i = 0; i < PLANTS.length; i += BATCH_SIZE) {
    const batch = PLANTS.slice(i, i + BATCH_SIZE);
    const batchRes = await Promise.all(
      batch.map(async plant => {
        try {
          const readings = await Promise.all(
            plant.meterCodes.map(c => fetchSingleCode(cookie, c, dateDash))
          );
          const valid = readings.filter(r => r.wh !== null && !Number.isNaN(r.wh));
          const totalWh = valid.length > 0 ? valid.reduce((a, b) => a + b.wh, 0) : null;
          const meterMw = totalWh !== null ? (totalWh * UNIT_CONVERSION_MULTIPLIER) / UNIT_CONVERSION_DIVISOR : null;
          const allNormal = readings.every(r => r.flag === "정상");
          const primaryTime = readings.find(r => r.time && r.time !== "-")?.time || "-";
          return {
            id: plant.id,
            region: plant.region,
            name: plant.name,
            pgCode: plant.pgCode,
            capacityMw: plant.capacityMw,
            time: primaryTime,
            meterMw,
            flag: allNormal ? "정상" : (readings[0]?.flag || "미수신")
          };
        } catch (_) {
          return {
            id: plant.id,
            region: plant.region,
            name: plant.name,
            pgCode: plant.pgCode,
            capacityMw: plant.capacityMw,
            time: "-",
            meterMw: null,
            flag: "실패(통신오류)"
          };
        }
      })
    );
    results.push(...batchRes);
  }

  return {
    meta: { crawledAt: nowFormatted },
    results
  };
}

function fetchKpxHtml(urlPath) {
  return new Promise((resolve, reject) => {
    const fullUrl = urlPath.startsWith("http") ? urlPath : `${KPX_BASE_URL}${urlPath}`;
    const req = https.get(fullUrl, {
      rejectUnauthorized: false,
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0" }
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("KPX 조회 타임아웃")));
  });
}

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>|<\/p>|<\/li>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ");
}

async function crawlKpxNotice() {
  const { nowFormatted } = getKstStrings();
  let latestBoardPost = null;
  let foundForecast = null;

  for (let page = 1; page <= 5; page++) {
    const html = await fetchKpxHtml(`${KPX_BOARD_PATH}&nPage=${page}`);
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    const items = [];
    while ((rm = rowRe.exec(html)) !== null) {
      const lm = rm[1].match(/<a[^>]+href=["']([^"']*act=view[^"']*list_no=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!lm) continue;
      const href = lm[1].replace(/&amp;/g, "&");
      items.push({
        listNo: lm[2],
        title: cleanText(lm[3]).replace(/\s+/g, " ").trim(),
        href: href.startsWith("http") ? href : `${KPX_BASE_URL}${href}`
      });
    }
    if (page === 1 && items.length > 0) latestBoardPost = items[0];
    const hit = items.find(x => x.title.includes("육지 출력제어 전망"));
    if (hit) {
      foundForecast = hit;
      break;
    }
  }

  if (!foundForecast) {
    return {
      checkedAt: nowFormatted,
      hasForecast: false,
      isLatestOnBoard: false,
      latestBoardPost,
      forecast: null
    };
  }

  const viewHtml = await fetchKpxHtml(foundForecast.href);
  const text = cleanText(viewHtml);
  const titleDate = (foundForecast.title.match(/\[\s*([^\]]+)\s*\]/) || [])[1] || "-";
  const scheduleRaw = ((text.match(/예정일\s*[:：]\s*([^\n\r]+)/) || [])[1] || "").trim();

  let scheduledDate = titleDate;
  let scheduledTime = "-";
  if (scheduleRaw) {
    const parts = scheduleRaw.split(",");
    if (parts.length >= 2) {
      scheduledDate = parts[0].trim();
      scheduledTime = parts.slice(1).join(",").trim();
    } else {
      scheduledDate = scheduleRaw;
    }
  }

  const demandForecast = ((text.match(/수급전망\s*[:：]\s*([^\n\r]+)/) || [])[1] || "-").trim();
  const reason = ((text.match(/제한사유\s*[:：]\s*([^\n\r]+)/) || [])[1] || "-").trim();

  return {
    checkedAt: nowFormatted,
    hasForecast: true,
    isLatestOnBoard: Boolean(latestBoardPost && latestBoardPost.listNo === foundForecast.listNo),
    latestBoardPost,
    forecast: {
      listNo: foundForecast.listNo,
      title: foundForecast.title,
      viewUrl: foundForecast.href,
      scheduledDate,
      scheduledTime,
      demandForecast,
      reason
    }
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  try {
    const urlStr = req.url || "";
    if (urlStr.includes("type=kpx")) {
      const notice = await crawlKpxNotice();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(notice));
    }

    const meters = await crawlMeters();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify(meters));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: err.message }));
  }
};
