---
title: Marketlog Backend
emoji: 🛒
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# MarketLog Backend

FastAPI backend for MarketLog (전통시장 AI 신뢰검증 플랫폼) — auth, product feed,
Naver map/store data, KAMIS live pricing, and AI product-quality scanning
(vision model + Gemini).

Deployed here as a Hugging Face Space (Docker SDK) because the vision models
need more RAM than typical free-tier PaaS hosts allow.
