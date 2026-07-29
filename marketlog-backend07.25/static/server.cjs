var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");
var import_genai = require("@google/genai");
var import_dotenv = __toESM(require("dotenv"), 1);
import_dotenv.default.config();
var app = (0, import_express.default)();
var PORT = 8080;
app.use(import_express.default.json({ limit: "20mb" }));
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new import_genai.GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "MarketLog Backend" });
});
app.post("/api/analyze-product", async (req, res) => {
  try {
    const { imageBase64, sampleId, userPrompt } = req.body;
    const ai = getGeminiClient();
    if (ai) {
      const systemInstruction = `\uB2F9\uC2E0\uC740 \uB300\uD55C\uBBFC\uAD6D \uC804\uD1B5\uC2DC\uC7A5 \uC804\uBB38 AI \uD488\uC9C8 \uBC0F \uAC00\uACA9 \uAC80\uC99D\uAD00\uC785\uB2C8\uB2E4.
\uC18C\uBE44\uC790\uAC00 \uCC0D\uC740 \uC0C1\uD488 \uC0AC\uC9C4(\uB610\uB294 \uD488\uBAA9 \uC124\uBA85)\uC744 \uBD84\uC11D\uD558\uC5EC \uC544\uB798 JSON \uADDC\uACA9\uC73C\uB85C \uBC18\uD658\uD558\uC2ED\uC2DC\uC624.
\uD488\uC9C8 \uB4F1\uAE09\uC740 A+, A, B+, B, C \uC911 \uD558\uB098\uC774\uBA70, \uAC00\uACA9 \uC2E0\uB8B0\uB3C4\uB294 SAFE(\uC548\uC804), CAUTION(\uC720\uC758), ALERT(\uACBD\uACE0) \uC911 \uD558\uB098\uC785\uB2C8\uB2E4.
\uACF5\uACF5 \uC2DC\uC138(\uB18D\uC218\uC0B0\uBB3C\uC720\uD1B5\uACF5\uC0AC/\uB18D\uB9BC\uCD95\uC0B0\uC2DD\uD488\uBD80 \uAE30\uC900)\uC640 \uBE44\uAD50\uD558\uC5EC \uC2E0\uB8B0 \uC9C0\uD45C\uB97C \uB3C4\uCD9C\uD558\uC138\uC694.`;
      let contentsParts = [];
      if (imageBase64) {
        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        contentsParts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: cleanBase64
          }
        });
      }
      contentsParts.push({
        text: userPrompt || "\uC0AC\uC9C4\uC5D0 \uC788\uB294 \uC804\uD1B5\uC2DC\uC7A5 \uC0C1\uD488\uC758 \uD488\uC9C8, \uC2E0\uC120\uB3C4, \uACF5\uACF5 \uC2DC\uC138 \uB300\uBE44 \uC801\uC815 \uAC00\uACA9\uC744 \uC815\uBC00 \uBD84\uC11D\uD574 \uC8FC\uC138\uC694."
      });
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: { parts: contentsParts },
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              productName: { type: import_genai.Type.STRING },
              category: { type: import_genai.Type.STRING },
              grade: { type: import_genai.Type.STRING },
              qualityScore: { type: import_genai.Type.INTEGER },
              sellingPrice: { type: import_genai.Type.INTEGER },
              publicMarketPrice: { type: import_genai.Type.INTEGER },
              priceDiffPercent: { type: import_genai.Type.INTEGER },
              priceTrafficLight: { type: import_genai.Type.STRING },
              freshnessScore: { type: import_genai.Type.INTEGER },
              defectScore: { type: import_genai.Type.INTEGER },
              uniformityScore: { type: import_genai.Type.INTEGER },
              publicGuarantee: { type: import_genai.Type.STRING },
              aiAnalysisSummary: { type: import_genai.Type.STRING },
              crossSellRecommendation: {
                type: import_genai.Type.OBJECT,
                properties: {
                  itemName: { type: import_genai.Type.STRING },
                  shopName: { type: import_genai.Type.STRING },
                  distance: { type: import_genai.Type.STRING },
                  discountOffer: { type: import_genai.Type.STRING },
                  recipeName: { type: import_genai.Type.STRING }
                },
                required: ["itemName", "shopName", "distance", "discountOffer", "recipeName"]
              }
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
              "crossSellRecommendation"
            ]
          }
        }
      });
      if (response.text) {
        const parsedData = JSON.parse(response.text);
        return res.json({ success: true, data: parsedData });
      }
    }
    const fallbackData = getSampleInspectionData(sampleId);
    return res.json({ success: true, data: fallbackData });
  } catch (error) {
    console.error("AI Analysis Error:", error);
    const fallbackData = getSampleInspectionData(req.body.sampleId);
    return res.json({ success: true, data: fallbackData, isFallback: true });
  }
});
app.post("/api/kakao-register", async (req, res) => {
  try {
    const { chatText, imageBase64, merchantName } = req.body;
    const ai = getGeminiClient();
    if (ai) {
      const prompt = `\uC0C1\uC778\uC774 \uCE74\uCE74\uC624\uD1A1 \uBA54\uC2DC\uC9C0\uB85C \uBCF4\uB0B8 \uC0C1\uD488 \uC815\uBCF4: "${chatText}".
\uC774 \uC815\uBCF4\uB97C \uBD84\uC11D\uD558\uC5EC \uC18C\uBE44\uC790 \uC571\uC5D0 \uB178\uCD9C\uB420 \uB9C8\uCF00\uD305 \uC0C1\uD488 \uB370\uC774\uD130\uB85C \uC790\uB3D9\uC73C\uB85C \uAC00\uACF5 \uBC0F \uC0DD\uC131\uD574 \uC8FC\uC138\uC694.`;
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              title: { type: import_genai.Type.STRING },
              category: { type: import_genai.Type.STRING },
              price: { type: import_genai.Type.INTEGER },
              publicPrice: { type: import_genai.Type.INTEGER },
              grade: { type: import_genai.Type.STRING },
              priceTag: { type: import_genai.Type.STRING },
              description: { type: import_genai.Type.STRING },
              tags: {
                type: import_genai.Type.ARRAY,
                items: { type: import_genai.Type.STRING }
              }
            },
            required: ["title", "category", "price", "publicPrice", "grade", "priceTag", "description", "tags"]
          }
        }
      });
      if (response.text) {
        const result = JSON.parse(response.text);
        return res.json({
          success: true,
          product: {
            ...result,
            merchantName: merchantName || "\uC591\uB3D9\uC218\uC0B0",
            createdAt: "\uBC29\uAE08 \uC804",
            id: Date.now()
          }
        });
      }
    }
    return res.json({
      success: true,
      product: {
        id: Date.now(),
        title: chatText ? chatText.slice(0, 20) : "\uC0B0\uC9C0\uC9C1\uC1A1 \uC2F1\uC2F1\uD55C \uC81C\uCCA0 \uC0C1\uD488",
        category: "\uC218\uC0B0\uBB3C",
        price: 18e3,
        publicPrice: 19500,
        grade: "A+",
        priceTag: "\uACF5\uACF5 \uC2DC\uC138 \uB300\uBE44 10% \uC800\uB834",
        merchantName: merchantName || "\uC591\uB3D9\uC218\uC0B0",
        description: "\uC0C8\uBCBD \uC0B0\uC9C0 \uC9C1\uC1A1\uC73C\uB85C \uC2E0\uC120\uB3C4\uAC00 \uB9E4\uC6B0 \uC6B0\uC218\uD569\uB2C8\uB2E4.",
        tags: ["#\uC0B0\uC9C0\uC9C1\uC1A1", "#AI\uC778\uC99D", "#\uCC29\uD55C\uAC00\uACA9"],
        createdAt: "\uBC29\uAE08 \uC804"
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});
app.post("/api/docent-story", async (req, res) => {
  try {
    const { marketName, alleyName } = req.body;
    const ai = getGeminiClient();
    if (ai) {
      const prompt = `${marketName}\uC758 ${alleyName || "\uC218\uC0B0\uBB3C \uACE8\uBAA9"}\uC5D0 \uC704\uCE58\uD55C \uC720\uBA85 \uC810\uD3EC\uC640 \uC5ED\uC0AC, \uC81C\uCCA0 \uC2DD\uC7AC\uB8CC \uC774\uC57C\uAE30\uB97C \uB530\uB73B\uD558\uACE0 \uC7AC\uBBF8\uC788\uB294 \uC624\uB514\uC624 \uB3C4\uC2A8\uD2B8 \uD574\uC124 \uC6D0\uACE0(2\uBB38\uC7A5)\uB85C \uC791\uC131\uD574 \uC8FC\uC138\uC694.`;
      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt
      });
      if (response.text) {
        return res.json({ success: true, script: response.text });
      }
    }
    return res.json({
      success: true,
      script: `"\uC624\uB978\uCABD\uC5D0 \uBCF4\uC774\uB294 \uC591\uB3D9\uC218\uC0B0\uC740 \uB9E4\uC77C \uC0C8\uBCBD \uC0B0\uC9C0\uC5D0\uC11C \uC9C1\uC1A1\uB41C \uC2E0\uC120\uD55C \uD65C\uC5B4\uB97C \uCDE8\uAE09\uD569\uB2C8\uB2E4. \uC624\uB298 A\uAE09 \uAC08\uCE58\uC640 \uBB34\uC758 \uD658\uC0C1\uC801\uC778 \uC870\uD569\uC744 \uACBD\uD5D8\uD574\uBCF4\uC138\uC694!"`
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});
function getSampleInspectionData(sampleId) {
  if (sampleId === "strawberry") {
    return {
      productName: "\uB17C\uC0B0 \uC124\uD5A5 \uB538\uAE30 (500g)",
      category: "\uACFC\uC77C/\uC57C\uCC44",
      grade: "A",
      qualityScore: 93,
      sellingPrice: 12500,
      publicMarketPrice: 13e3,
      priceDiffPercent: 4,
      priceTrafficLight: "SAFE",
      freshnessScore: 94,
      defectScore: 92,
      uniformityScore: 91,
      publicGuarantee: "\uB18D\uB9BC\uCD95\uC0B0\uC2DD\uD488\uBD80 \uACF5\uACF5\uB370\uC774\uD130 \uC5F0\uB3D9 \uBCF4\uC99D",
      aiAnalysisSummary: "\uB2F9\uB3C4\uAC00 \uB192\uC544 \uACFC\uC999\uC774 \uD48D\uBD80\uD558\uBA70 \uBB34\uB984 \uD604\uC0C1\uC774 \uC5C6\uB294 \uC6B0\uC218\uD55C \uC0C1\uD488\uC785\uB2C8\uB2E4.",
      crossSellRecommendation: {
        itemName: "\uC2F1\uC2F1\uCCAD\uACFC \uC218\uC81C \uC0DD\uD06C\uB9BC",
        shopName: "\uC2F1\uC2F1\uCCAD\uACFC",
        distance: "30m",
        discountOffer: "10% OFF",
        recipeName: "\uB538\uAE30 \uD30C\uB974\uD398 \uD328\uD0A4\uC9C0"
      }
    };
  } else if (sampleId === "pork") {
    return {
      productName: "\uD55C\uB3C8 \uC0BC\uACB9\uC0B4 (600g \uB0C9\uC7A5)",
      category: "\uC815\uC721",
      grade: "A+",
      qualityScore: 97,
      sellingPrice: 16800,
      publicMarketPrice: 19800,
      priceDiffPercent: 15,
      priceTrafficLight: "SAFE",
      freshnessScore: 98,
      defectScore: 96,
      uniformityScore: 95,
      publicGuarantee: "\uB18D\uC218\uC0B0\uBB3C\uC720\uD1B5\uACF5\uC0AC(KAMIS) \uC2DC\uC138 \uAC80\uC99D \uC644\uB8CC",
      aiAnalysisSummary: "\uC120\uD64D\uBE5B \uB9C8\uBE14\uB9C1\uC774 \uC6B0\uC218\uD558\uBA70 \uC9C0\uBC29 \uBE44\uC728\uC774 \uB9E4\uC6B0 \uADE0\uC77C\uD55C 1\uB4F1\uAE09 \uD55C\uB3C8\uC785\uB2C8\uB2E4.",
      crossSellRecommendation: {
        itemName: "\uD638\uB0A8\uC0C1\uD68C \uD30C\uCC44 \uBC0F \uC0C1\uCD94 \uBAA8\uB460",
        shopName: "\uD638\uB0A8\uC0C1\uD68C",
        distance: "40m",
        discountOffer: "15% OFF",
        recipeName: "\uC0BC\uACB9\uC0B4 \uD30C\uCC44 \uAD6C\uC774 \uD328\uD0A4\uC9C0"
      }
    };
  }
  return {
    productName: "\uC81C\uC8FC\uC0B0 \uC740\uAC08\uCE58 (\uD2B9\uB300)",
    category: "\uC218\uC0B0\uBB3C",
    grade: "A+",
    qualityScore: 98,
    sellingPrice: 18e3,
    publicMarketPrice: 19500,
    priceDiffPercent: 10,
    priceTrafficLight: "SAFE",
    freshnessScore: 98,
    defectScore: 95,
    uniformityScore: 92,
    publicGuarantee: "\uB18D\uB9BC\uCD95\uC0B0\uC2DD\uD488\uBD80 \uACF5\uACF5\uB370\uC774\uD130 \uC5F0\uB3D9 \uBCF4\uC99D",
    aiAnalysisSummary: "\uC740\uBC31\uC0C9 \uAD11\uD0DD\uC774 98% \uC720\uC9C0\uB418\uACE0 \uD45C\uBA74 \uC0C1\uCC98\uAC00 \uAC70\uC758 \uC5C6\uB294 \uCD5C\uC0C1\uAE09 \uC740\uAC08\uCE58\uC785\uB2C8\uB2E4.",
    crossSellRecommendation: {
      itemName: "\uD638\uB0A8\uC0C1\uD68C \uAC00\uC744\uBB34",
      shopName: "\uD638\uB0A8\uC0C1\uD68C",
      distance: "50m",
      discountOffer: "20% OFF",
      recipeName: "\uAC08\uCE58\uC870\uB9BC \uC644\uC131 \uD328\uD0A4\uC9C0"
    }
  };
}
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[MarketLog] Server running on http://0.0.0.0:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
