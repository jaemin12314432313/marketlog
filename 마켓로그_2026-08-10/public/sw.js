/* 크롬이 "앱 설치"를 보여 주려면 서비스 워커가 있어야 한다.
   캐시는 하지 않고 요청을 그대로 네트워크로 보낸다(전시 중 옛 화면이 남지 않게). */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function (e) { e.respondWith(fetch(e.request)); });
