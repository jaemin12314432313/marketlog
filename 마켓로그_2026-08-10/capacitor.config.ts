import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.marketlog.app',
  appName: 'MarketLog',
  webDir: 'dist',
  // 백엔드가 아직 로컬 http(HTTPS 아님)라서 클리어텍스트를 열어둔다.
  // 실제 배포용 HTTPS 백엔드가 생기면 이 옵션은 지우는 게 맞다.
  server: {
    cleartext: true,
  },
};

export default config;
