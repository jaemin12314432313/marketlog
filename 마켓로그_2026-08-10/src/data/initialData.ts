import { MarketInfo } from "../types";

export const REGIONS_DATA: string[] = [
  "전체",
  "광주광역시",
  "서울특별시",
  "부산광역시",
  "전라남도",
  "경상남도",
  "대구광역시",
];

export const MARKETS_DATA: MarketInfo[] = [
  {
    id: "yangdong",
    name: "광주 양동시장",
    city: "광주광역시 서구",
    congestion: "원활",
    parkingCapacity: "24/80면 여유 (양동 공영주차장)",
    toiletLocation: "수산동 2층 / B동 중앙출입구",
  },
  {
    id: "mangwon",
    name: "서울 망원시장",
    city: "서울특별시 마포구",
    congestion: "보통",
    parkingCapacity: "12/50면 여유 (망원1동 노상주차장)",
    toiletLocation: "고객만족센터 1층",
  },
  {
    id: "jagalchi",
    name: "부산 자갈치시장",
    city: "부산광역시 중구",
    congestion: "혼잡",
    parkingCapacity: "5/120면 (건물 지하주차장)",
    toiletLocation: "본관 1층, 3층",
  },
];
