const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  UNIT_CONVERSION_MULTIPLIER,
  UNIT_CONVERSION_DIVISOR,
  PLANTS
} = require("../constants/plants");

const METER_HOST = "203.237.1.41";
const METER_PORT = 8085;
const REQUEST_TIMEOUT_MS = 10000;
const BATCH_SIZE = 14;
const ACCOUNT_FILE = path.join(__dirname, "../../account.txt");

/**
 * 한국 표준시(KST, UTC+9) 날짜 및 시간 문자열을 반환합니다.
 */
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

/**
 * 계량정보시스템 로그인 계정 정보를 읽어옵니다.
 */
function readCredentials() {
  if (process.env.KWATER_ID && process.env.KWATER_PW) {
    return {
      id: process.env.KWATER_ID.trim(),
      pw: process.env.KWATER_PW.trim()
    };
  }
  if (fs.existsSync(ACCOUNT_FILE)) {
    const content = fs.readFileSync(ACCOUNT_FILE, "utf8");
    const idMatch = content.match(/id\s*:\s*(\S+)/i);
    const pwMatch = content.match(/pw\s*:\s*(\S+)/i);
    if (idMatch && pwMatch) {
      return { id: idMatch[1].trim(), pw: pwMatch[1].trim() };
    }
  }
  return {
    id: Buffer.from("a3dhdGVycG93ZXI=", "base64").toString("utf8"),
    pw: Buffer.from("Z2lvc3Bvd2Vy", "base64").toString("utf8")
  };
}

/**
 * K-water 신재생에너지 계량정보시스템에 로그인하여 세션 쿠키를 발급받습니다.
 */
function loginMeterSystem(id, pw) {
  return new Promise((resolve, reject) => {
    const body = `serviceCode=login&view=/loginResult.jsp&id=${encodeURIComponent(id)}&password=${encodeURIComponent(pw)}`;
    const req = http.request({
      hostname: METER_HOST,
      port: METER_PORT,
      path: "/mtr/action.do",
      method: "POST",
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    }, res => {
      res.resume();
      const setCookie = res.headers["set-cookie"];
      if (!setCookie || !setCookie.length) {
        return reject(new Error("계량시스템 로그인 응답에 세션 쿠키가 없습니다."));
      }
      resolve(setCookie[0].split(";")[0]);
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("계량시스템 로그인 타임아웃")));
    req.end(body);
  });
}

/**
 * 개별 계량기(EnergyMeter)의 5분 단위 계량실적(Wh) HTML을 조회합니다.
 */
function fetchMeterHtml(cookie, meterCode, dateDash) {
  return new Promise((resolve, reject) => {
    const body =
      `nodetype=EnergyMeter&nodecode=${meterCode}` +
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
      timeout: REQUEST_TIMEOUT_MS,
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
    req.on("timeout", () => req.destroy(new Error(`계량기(${meterCode}) 조회 타임아웃`)));
    req.end(body);
  });
}

/**
 * 계량결과 HTML 테이블에서 5분 데이터 행을 추출합니다.
 */
function extractMeterRows(html) {
  const re = /<td[^>]*>(\d{8})<\/td>\s*<td[^>]*><nobr>(\d{2}\s*:\s*\d{2})<\/nobr><\/td>\s*<td[^>]*>\s*<nobr>\s*([^\s<]+)\s*<\/nobr>\s*<\/td>\s*<td[^>]*><nobr>\s*([^\s<]+)\s*<\/nobr><\/td>\s*<td[^>]*><nobr>\s*([^\s<]+)\s*<\/nobr>/gs;
  const rows = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    const rawWh = match[3].trim();
    const numericWh = rawWh === "-" || rawWh === "X" ? null : parseFloat(rawWh.replace(/,/g, ""));
    rows.push({
      date: match[1].trim(),
      time: match[2].replace(/\s+/g, ""),
      wh: Number.isNaN(numericWh) ? null : numericWh,
      flag: match[5].trim()
    });
  }
  return rows;
}

/**
 * 단일 계량기 코드에 대해 금일 최신 5분 Wh 값을 조회합니다.
 */
async function fetchSingleMeterReading(cookie, meterCode, dateDash) {
  const html = await fetchMeterHtml(cookie, meterCode, dateDash);
  const rows = extractMeterRows(html);

  if (rows.length === 0) {
    return { time: "-", wh: null, flag: "미수신" };
  }

  const normalRows = rows.filter(r => r.flag === "정상" && r.wh !== null);
  const latestNormal = normalRows.length > 0 ? normalRows[normalRows.length - 1] : null;
  if (latestNormal) {
    return {
      time: latestNormal.time,
      wh: latestNormal.wh,
      flag: latestNormal.flag
    };
  }

  const lastRow = rows[rows.length - 1];
  return {
    time: lastRow ? lastRow.time : "-",
    wh: lastRow && lastRow.wh !== null ? lastRow.wh : null,
    flag: lastRow ? lastRow.flag : "미수신"
  };
}

/**
 * 5분 계량데이터(Wh)를 MW 단위로 환산합니다. (Wh * 12 / 10^6)
 */
function convertWhToMw(whValue) {
  if (whValue === null || whValue === undefined || Number.isNaN(whValue)) {
    return null;
  }
  return (whValue * UNIT_CONVERSION_MULTIPLIER) / UNIT_CONVERSION_DIVISOR;
}

/**
 * 발전소(단일 또는 복수 계량기 합산)의 계량데이터(MW)를 조회합니다.
 */
async function fetchPlantMeterData(cookie, plant, dateDash) {
  try {
    const readings = await Promise.all(
      plant.meterCodes.map(code => fetchSingleMeterReading(cookie, code, dateDash))
    );

    const validReadings = readings.filter(r => r.wh !== null && !Number.isNaN(r.wh));
    const totalWh = validReadings.length > 0
      ? validReadings.reduce((acc, r) => acc + r.wh, 0)
      : null;

    const meterMw = convertWhToMw(totalWh);
    const allNormal = readings.every(r => r.flag === "정상");
    const anyNormal = readings.some(r => r.flag === "정상");
    const primaryTime = readings.find(r => r.time && r.time !== "-")?.time || "-";

    return {
      id: plant.id,
      region: plant.region,
      name: plant.name,
      pgCode: plant.pgCode,
      capacityMw: plant.capacityMw,
      meterCodes: plant.meterCodes,
      time: primaryTime,
      rawWh: totalWh,
      meterMw,
      flag: allNormal ? "정상" : (anyNormal ? "정상(일부)" : (readings[0]?.flag || "실패(비정상)"))
    };
  } catch (err) {
    return {
      id: plant.id,
      region: plant.region,
      name: plant.name,
      pgCode: plant.pgCode,
      capacityMw: plant.capacityMw,
      meterCodes: plant.meterCodes,
      time: "-",
      rawWh: null,
      meterMw: null,
      flag: "실패(통신오류)"
    };
  }
}

/**
 * 40개 발전소 전체의 실시간 계량데이터를 온디맨드로 크롤링합니다. (파일/DB 저장 없음)
 */
async function crawlAllMetersOnDemand() {
  const { id, pw } = readCredentials();
  const { dateDash, nowFormatted } = getKstStrings();
  const cookie = await loginMeterSystem(id, pw);

  const results = [];
  for (let i = 0; i < PLANTS.length; i += BATCH_SIZE) {
    const batch = PLANTS.slice(i, i + BATCH_SIZE);
    const batchRes = await Promise.all(
      batch.map(plant => fetchPlantMeterData(cookie, plant, dateDash))
    );
    results.push(...batchRes);
  }

  return {
    meta: {
      crawledAt: nowFormatted,
      formula: "5분 계량데이터(Wh) × 12 / 10^6 = MW"
    },
    results
  };
}

module.exports = {
  getKstStrings,
  crawlAllMetersOnDemand
};
