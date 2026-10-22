const https = require("https");
const { getKstStrings } = require("./meterService");

const KPX_BASE_URL = "https://www.kpx.or.kr";
const KPX_BOARD_PATH = "/board.es?mid=a10109050000&bid=0216";
const MAX_SEARCH_PAGES = 5;
const REQUEST_TIMEOUT_MS = 12000;

/**
 * KPX 홈페이지 HTML을 가져옵니다. (사내 보안 인증서 프록시 환경 호환을 위해 rejectUnauthorized: false 적용)
 */
function fetchKpxHtml(urlPath) {
  return new Promise((resolve, reject) => {
    const fullUrl = urlPath.startsWith("http") ? urlPath : `${KPX_BASE_URL}${urlPath}`;
    const req = https.get(fullUrl, {
      rejectUnauthorized: false,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9"
      }
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("전력거래소(KPX) 게시판 요청 타임아웃")));
  });
}

/**
 * HTML 엔티티 및 태그를 제거하고 평문으로 정제합니다.
 */
function cleanHtmlText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>|<\/p>|<\/li>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/[ \t]+/g, " ");
}

/**
 * 게시판 목록 HTML에서 게시글 항목들을 추출합니다.
 */
function parseBoardListItems(listHtml) {
  const items = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(listHtml)) !== null) {
    const rowHtml = rowMatch[1];
    const linkMatch = rowHtml.match(/<a[^>]+href=["']([^"']*act=view[^"']*list_no=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const rawHref = linkMatch[1].replace(/&amp;/g, "&");
    const listNo = linkMatch[2];
    const title = cleanHtmlText(linkMatch[3]).replace(/\s+/g, " ").trim();

    // 등록일 추출 (YYYY-MM-DD 형태)
    const dateMatch = rowHtml.match(/(\d{4}[-.]\d{2}[-.]\d{2})/);
    const postedDate = dateMatch ? dateMatch[1] : "";

    items.push({
      listNo,
      title,
      postedDate,
      href: rawHref.startsWith("http") ? rawHref : `${KPX_BASE_URL}${rawHref}`
    });
  }

  return items;
}

/**
 * '육지 출력제어 전망' 상세 페이지 본문에서 예정일, 예정시간, 수급전망, 제한사유를 파싱합니다.
 */
function parseForecastDetail(viewHtml, fallbackTitle) {
  const text = cleanHtmlText(viewHtml);

  // 제목에서 날짜 추출: 예) 육지 출력제어 전망[2026년 6월 6일(토)]
  const titleDateMatch = fallbackTitle.match(/\[\s*([^\]]+)\s*\]/);
  const titleDate = titleDateMatch ? titleDateMatch[1].trim() : "";

  // 본문 내 'o 예정일 : 2026년 6월 6일(토), 11시~15시' 추출
  const scheduleMatch = text.match(/예정일\s*[:：]\s*([^\n\r]+)/);
  const scheduleRaw = scheduleMatch ? scheduleMatch[1].trim() : "";

  let scheduledDate = titleDate;
  let scheduledTime = "-";

  if (scheduleRaw) {
    // 쉼표(,) 또는 시간 패턴을 기준으로 예정일과 예정시간 분리
    const commaParts = scheduleRaw.split(",");
    if (commaParts.length >= 2) {
      scheduledDate = commaParts[0].trim();
      scheduledTime = commaParts.slice(1).join(",").trim();
    } else {
      const timeMatch = scheduleRaw.match(/(\d{1,2}\s*시\s*[~∼-]\s*\d{1,2}\s*시[^\n\r]*)/);
      if (timeMatch) {
        scheduledTime = timeMatch[1].trim();
        scheduledDate = scheduleRaw.replace(timeMatch[0], "").replace(/[,，]/g, "").trim() || titleDate;
      } else {
        scheduledDate = scheduleRaw;
      }
    }
  }

  const demandMatch = text.match(/수급전망\s*[:：]\s*([^\n\r]+)/);
  const demandForecast = demandMatch ? demandMatch[1].trim() : "-";

  const reasonMatch = text.match(/제한사유\s*[:：]\s*([^\n\r]+)/);
  const reason = reasonMatch ? reasonMatch[1].trim() : "-";

  return {
    scheduleRaw: scheduleRaw || (titleDate ? `${titleDate}` : "-"),
    scheduledDate: scheduledDate || "-",
    scheduledTime: scheduledTime || "-",
    demandForecast,
    reason
  };
}

/**
 * KPX 게시판에서 가장 최근 '육지 출력제어 전망' 게시글을 찾아 상세 정보를 반환합니다.
 */
async function crawlKpxCurtailmentNotice() {
  const { nowFormatted } = getKstStrings();
  let latestBoardPost = null;
  let foundForecastItem = null;

  for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
    const pageUrl = `${KPX_BOARD_PATH}&nPage=${page}`;
    const listHtml = await fetchKpxHtml(pageUrl);
    const items = parseBoardListItems(listHtml);

    if (page === 1 && items.length > 0) {
      latestBoardPost = items[0];
    }

    const forecast = items.find(item => item.title.includes("육지 출력제어 전망"));
    if (forecast) {
      foundForecastItem = forecast;
      break;
    }
  }

  if (!foundForecastItem) {
    return {
      checkedAt: nowFormatted,
      boardUrl: `${KPX_BASE_URL}${KPX_BOARD_PATH}`,
      hasForecast: false,
      isLatestOnBoard: false,
      latestBoardPost,
      forecast: null
    };
  }

  const viewHtml = await fetchKpxHtml(foundForecastItem.href);
  const detail = parseForecastDetail(viewHtml, foundForecastItem.title);
  const isLatestOnBoard = Boolean(
    latestBoardPost && latestBoardPost.listNo === foundForecastItem.listNo
  );

  return {
    checkedAt: nowFormatted,
    boardUrl: `${KPX_BASE_URL}${KPX_BOARD_PATH}`,
    hasForecast: true,
    isLatestOnBoard,
    latestBoardPost,
    forecast: {
      listNo: foundForecastItem.listNo,
      title: foundForecastItem.title,
      postedDate: foundForecastItem.postedDate,
      viewUrl: foundForecastItem.href,
      scheduleRaw: detail.scheduleRaw,
      scheduledDate: detail.scheduledDate,
      scheduledTime: detail.scheduledTime,
      demandForecast: detail.demandForecast,
      reason: detail.reason
    }
  };
}

module.exports = {
  crawlKpxCurtailmentNotice
};
