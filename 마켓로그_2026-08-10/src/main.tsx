import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import App from './App.tsx';
import './index.css';

// 안드로이드 WebView가 상태바 아래까지 화면 전체를 그려버려서(엣지투엣지), 헤더/모달
// 상단부가 상태바에 가려 잘려 보인다. WebView 자체를 상태바 밑에서 시작하게 만들어
// 앱 전체 화면 어디서든 개별 컴포넌트를 손대지 않고 한 번에 해결한다.
if (Capacitor.isNativePlatform()) {
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  // 상태바 배경을 따로 안 정해주면 Capacitor 기본값(남색 #303F9F)이 그대로 나와서,
  // 흰색 헤더 바로 위에 남색 줄이 얹힌 것처럼 보인다. 앱 배경(흰색)과 맞추고,
  // 흰 배경에 시계/배터리 아이콘이 흰색으로 묻히지 않도록 어두운 아이콘 스타일을 쓴다.
  StatusBar.setBackgroundColor({ color: '#FFFFFF' }).catch(() => {});
  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
