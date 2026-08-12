import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import App from './App.tsx';
import './index.css';

// 안드로이드 WebView가 상태바 아래까지 화면 전체를 그려버려서(엣지투엣지), 헤더/모달
// 상단부가 상태바에 가려 잘려 보인다. WebView 자체를 상태바 밑에서 시작하게 만들어
// 앱 전체 화면 어디서든 개별 컴포넌트를 손대지 않고 한 번에 해결한다.
if (Capacitor.isNativePlatform()) {
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
