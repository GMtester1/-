// K-water 전력거래소 출력제어 대응 대상 40개 발전소 고정 데이터 (출력제어 발전소.xlsx 기준)

const UNIT_CONVERSION_MULTIPLIER = 12;
const UNIT_CONVERSION_DIVISOR = 1_000_000; // Wh -> MWh (5분 데이터 * 12 / 10^6 = MW)

const REGIONS = ["한강권역", "금·영·섬권역", "낙동강권역"];

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

module.exports = {
  UNIT_CONVERSION_MULTIPLIER,
  UNIT_CONVERSION_DIVISOR,
  REGIONS,
  PLANTS
};
