import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "20mb" }));

// Initialize Gemini Client lazily or safely
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// 1. Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "MarketLog Backend" });
});

// 2. AI Product Inspection & Live Scan Endpoint
app.post("/api/analyze-product", async (req, res) => {
  try {
    const { imageBase64, sampleId, userPrompt } = req.body;
    const ai = getGeminiClient();

    if (ai) {
      const systemInstruction = `당신은 대한민국 전통시장 전문 AI 품질 및 가격 검증관입니다.
소비자가 찍은 상품 사진(또는 품목 설명)을 분석하여 아래 JSON 규격으로 반환하십시오.
품질 등급은 A+, A, B+, B, C 중 하나이며, 가격 신뢰도는 SAFE(안전), CAUTION(유의), ALERT(경고) 중 하나입니다.
공공 시세(농수산물유통공사/농림축산식품부 기준)와 비교하여 신뢰 지표를 도출하세요.`;

      let contentsParts: any[] = [];
      if (imageBase64) {
        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        contentsParts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: cleanBase64,
          },
        });
      }
      contentsParts.push({
        text: userPrompt || "사진에 있는 전통시장 상품의 품질, 신선도, 공공 시세 대비 적정 가격을 정밀 분석해 주세요.",
      });

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: { parts: contentsParts },
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              productName: { type: Type.STRING },
              category: { type: Type.STRING },
              grade: { type: Type.STRING },
              qualityScore: { type: Type.INTEGER },
              sellingPrice: { type: Type.INTEGER },
              publicMarketPrice: { type: Type.INTEGER },
              priceDiffPercent: { type: Type.INTEGER },
              priceTrafficLight: { type: Type.STRING },
              freshnessScore: { type: Type.INTEGER },
              defectScore: { type: Type.INTEGER },
              uniformityScore: { type: Type.INTEGER },
              publicGuarantee: { type: Type.STRING },
              aiAnalysisSummary: { type: Type.STRING },
              crossSellRecommendation: {
                type: Type.OBJECT,
                properties: {
                  itemName: { type: Type.STRING },
                  shopName: { type: Type.STRING },
                  distance: { type: Type.STRING },
                  discountOffer: { type: Type.STRING },
                  recipeName: { type: Type.STRING },
                },
                required: ["itemName", "shopName", "distance", "discountOffer", "recipeName"],
              },
            },
            required: [
              "productName",
              "category",
              "grade",
              "qualityScore",
              "sellingPrice",
              "publicMarketPrice",
              "priceDiffPercent",
              "priceTrafficLight",
              "freshnessScore",
              "defectScore",
              "uniformityScore",
              "publicGuarantee",
              "aiAnalysisSummary",
              "crossSellRecommendation",
            ],
          },
        },
      });

      if (response.text) {
        const parsedData = JSON.parse(response.text);
        return res.json({ success: true, data: parsedData });
      }
    }

    // Fallback Mock data matching real samples
    const fallbackData = getSampleInspectionData(sampleId);
    return res.json({ success: true, data: fallbackData });
  } catch (error: any) {
    console.error("AI Analysis Error:", error);
    const fallbackData = getSampleInspectionData(req.body.sampleId);
    return res.json({ success: true, data: fallbackData, isFallback: true });
  }
});

// 3. Merchant KakaoTalk Easy Registration Endpoint
app.post("/api/kakao-register", async (req, res) => {
  try {
    const { chatText, imageBase64, merchantName } = req.body;
    const ai = getGeminiClient();

    if (ai) {
      const prompt = `상인이 카카오톡 메시지로 보낸 상품 정보: "${chatText}".
이 정보를 분석하여 소비자 앱에 노출될 마케팅 상품 데이터로 자동으로 가공 및 생성해 주세요.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              category: { type: Type.STRING },
              price: { type: Type.INTEGER },
              publicPrice: { type: Type.INTEGER },
              grade: { type: Type.STRING },
              priceTag: { type: Type.STRING },
              description: { type: Type.STRING },
              tags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ["title", "category", "price", "publicPrice", "grade", "priceTag", "description", "tags"],
          },
        },
      });

      if (response.text) {
        const result = JSON.parse(response.text);
        return res.json({
          success: true,
          product: {
            ...result,
            merchantName: merchantName || "양동수산",
            createdAt: "방금 전",
            id: Date.now(),
          },
        });
      }
    }

    // Fallback registration response
    return res.json({
      success: true,
      product: {
        id: Date.now(),
        title: chatText ? chatText.slice(0, 20) : "산지직송 싱싱한 제철 상품",
        category: "수산물",
        price: 18000,
        publicPrice: 19500,
        grade: "A+",
        priceTag: "공공 시세 대비 10% 저렴",
        merchantName: merchantName || "양동수산",
        description: "새벽 산지 직송으로 신선도가 매우 우수합니다.",
        tags: ["#산지직송", "#AI인증", "#착한가격"],
        createdAt: "방금 전",
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 4. AI Docent Story Generator
app.post("/api/docent-story", async (req, res) => {
  try {
    const { marketName, alleyName } = req.body;
    const ai = getGeminiClient();

    if (ai) {
      const prompt = `${marketName}의 ${alleyName || "수산물 골목"}에 위치한 유명 점포와 역사, 제철 식재료 이야기를 따뜻하고 재미있는 오디오 도슨트 해설 원고(2문장)로 작성해 주세요.`;
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
      });

      if (response.text) {
        return res.json({ success: true, script: response.text });
      }
    }

    return res.json({
      success: true,
      script: `"오른쪽에 보이는 양동수산은 매일 새벽 산지에서 직송된 신선한 활어를 취급합니다. 오늘 A급 갈치와 무의 환상적인 조합을 경험해보세요!"`,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

function getSampleInspectionData(sampleId?: string) {
  if (sampleId === "strawberry") {
    return {
      productName: "논산 설향 딸기 (500g)",
      category: "과일/야채",
      grade: "A",
      qualityScore: 93,
      sellingPrice: 12500,
      publicMarketPrice: 13000,
      priceDiffPercent: 4,
      priceTrafficLight: "SAFE",
      freshnessScore: 94,
      defectScore: 92,
      uniformityScore: 91,
      publicGuarantee: "농림축산식품부 공공데이터 연동 보증",
      aiAnalysisSummary: "당도가 높아 과즙이 풍부하며 무름 현상이 없는 우수한 상품입니다.",
      crossSellRecommendation: {
        itemName: "싱싱청과 수제 생크림",
        shopName: "싱싱청과",
        distance: "30m",
        discountOffer: "10% OFF",
        recipeName: "딸기 파르페 패키지",
      },
    };
  } else if (sampleId === "pork") {
    return {
      productName: "한돈 삼겹살 (600g 냉장)",
      category: "정육",
      grade: "A+",
      qualityScore: 97,
      sellingPrice: 16800,
      publicMarketPrice: 19800,
      priceDiffPercent: 15,
      priceTrafficLight: "SAFE",
      freshnessScore: 98,
      defectScore: 96,
      uniformityScore: 95,
      publicGuarantee: "농수산물유통공사(KAMIS) 시세 검증 완료",
      aiAnalysisSummary: "선홍빛 마블링이 우수하며 지방 비율이 매우 균일한 1등급 한돈입니다.",
      crossSellRecommendation: {
        itemName: "호남상회 파채 및 상추 모둠",
        shopName: "호남상회",
        distance: "40m",
        discountOffer: "15% OFF",
        recipeName: "삼겹살 파채 구이 패키지",
      },
    };
  }

  // Default: Hairtail
  return {
    productName: "제주산 은갈치 (특대)",
    category: "수산물",
    grade: "A+",
    qualityScore: 98,
    sellingPrice: 18000,
    publicMarketPrice: 19500,
    priceDiffPercent: 10,
    priceTrafficLight: "SAFE",
    freshnessScore: 98,
    defectScore: 95,
    uniformityScore: 92,
    publicGuarantee: "농림축산식품부 공공데이터 연동 보증",
    aiAnalysisSummary: "은백색 광택이 98% 유지되고 표면 상처가 거의 없는 최상급 은갈치입니다.",
    crossSellRecommendation: {
      itemName: "호남상회 가을무",
      shopName: "호남상회",
      distance: "50m",
      discountOffer: "20% OFF",
      recipeName: "갈치조림 완성 패키지",
    },
  };
}

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[MarketLog] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
