import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import {
  TabType,
  MarketInfo,
  ProductItem,
} from "./types";
import {
  MARKETS_DATA,
  REGIONS_DATA,
} from "./data/initialData";
import {
  fetchFeed,
  fetchBookmarks,
  fetchScannedProducts,
  addBookmark,
  removeBookmark,
  addScannedProduct,
  removeScannedProduct,
  createMerchantProduct,
  updateMerchantProduct,
  deleteMerchantProduct,
  getAuthToken,
} from "./lib/api";
import { Header } from "./components/Header";
import { HomeFeed } from "./components/HomeFeed";
import { MerchantView } from "./components/MerchantView";
import { MapView } from "./components/MapView";
import { AiScanModal } from "./components/AiScanModal";
import { MyWallet } from "./components/MyWallet";
import { SavedView } from "./components/SavedView";
import { ProductDetailModal } from "./components/ProductDetailModal";
import { BottomNav } from "./components/BottomNav";
import { LoginModal, UserRole } from "./components/LoginModal";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>("home");
  const [userRole, setUserRole] = useState<UserRole>("customer");
  const [userDisplayName, setUserDisplayName] = useState<string>("");
  const [userShopName, setUserShopName] = useState<string>("");
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(true);
  const [selectedRegion, setSelectedRegion] = useState<string>("광주광역시");
  const [selectedMarket, setSelectedMarket] = useState<MarketInfo>(MARKETS_DATA[0]);

  const handleSelectRegion = (region: string) => {
    setSelectedRegion(region);
    // Sync market if region directly matches a known market
    if (region === "서울특별시") {
      setSelectedMarket(MARKETS_DATA[1]);
    } else if (region === "부산광역시") {
      setSelectedMarket(MARKETS_DATA[2]);
    } else if (region === "광주광역시") {
      setSelectedMarket(MARKETS_DATA[0]);
    }
  };
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [scannedProducts, setScannedProducts] = useState<ProductItem[]>([]);
  const [bookmarkedProducts, setBookmarkedProducts] = useState<ProductItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);

  // 상품 피드는 로그인 여부와 무관하게 백엔드에서 불러온다.
  useEffect(() => {
    fetchFeed()
      .then(setProducts)
      .catch((err) => console.error("상품 피드를 불러오지 못했습니다.", err));
  }, []);

  // 로그인 상태가 되면(토큰 발급 후) 내 찜/AI스캔 저장목록을 백엔드에서 불러온다.
  useEffect(() => {
    if (isLoginModalOpen || !getAuthToken()) return;
    fetchBookmarks()
      .then(setBookmarkedProducts)
      .catch((err) => console.error("찜 목록을 불러오지 못했습니다.", err));
    fetchScannedProducts()
      .then(setScannedProducts)
      .catch((err) => console.error("AI 스캔 저장목록을 불러오지 못했습니다.", err));
  }, [isLoginModalOpen]);

  const [isAiScanOpen, setIsAiScanOpen] = useState(false);
  const [cartItems, setCartItems] = useState<ProductItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);

  // 이 앱은 모달/탭 전환을 브라우저 히스토리 없이 컴포넌트 상태로만 처리해서, 안드로이드
  // 뒤로가기(하드웨어 버튼/제스처)가 기본 동작(WebView 히스토리 뒤로가기)을 타면 갈 곳이
  // 없어 곧바로 앱이 꺼져버린다. 열려있는 모달/탭을 앱 상태 기준으로 직접 닫아주고,
  // 더 이상 닫을 게 없는 홈 화면에서만 앱을 백그라운드로 보낸다(완전 종료 아님).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = CapacitorApp.addListener("backButton", () => {
      if (isNotificationOpen) {
        setIsNotificationOpen(false);
      } else if (selectedProduct) {
        setSelectedProduct(null);
      } else if (isAiScanOpen) {
        setIsAiScanOpen(false);
      } else if (activeTab !== "home") {
        setActiveTab("home");
      } else {
        CapacitorApp.minimizeApp();
      }
    });
    return () => {
      listener.then((l) => l.remove());
    };
  }, [isNotificationOpen, selectedProduct, isAiScanOpen, activeTab]);

  const handleLoginSuccess = (role: UserRole, displayName: string, shopName?: string) => {
    setUserRole(role);
    setUserDisplayName(displayName);
    setUserShopName(shopName || "");
    setIsLoginModalOpen(false);
    setActiveTab("home");
  };

  const handleLogout = () => {
    setUserDisplayName("");
    setUserShopName("");
    setUserRole("customer");
    setIsLoginModalOpen(true);
  };

  const handleAddToCart = (product: ProductItem) => {
    setCartItems((prev) => [...prev, product]);
  };

  const handleSaveScannedProduct = async (scannedProduct: ProductItem) => {
    try {
      const { id, ...rest } = scannedProduct;
      const res = await addScannedProduct(rest);
      setScannedProducts((prev) => [res.product, ...prev]);
    } catch (err) {
      console.error("AI 스캔 저장 실패", err);
    }
  };

  const handleRemoveScannedProduct = async (id: string) => {
    try {
      await removeScannedProduct(id);
      setScannedProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("AI 스캔 저장목록 삭제 실패", err);
    }
  };

  const handleToggleBookmarkProduct = async (product: ProductItem) => {
    const exists = bookmarkedProducts.some((p) => p.id === product.id);
    try {
      if (exists) {
        await removeBookmark(product.id);
        setBookmarkedProducts((prev) => prev.filter((p) => p.id !== product.id));
      } else {
        await addBookmark(product.id);
        setBookmarkedProducts((prev) => [product, ...prev]);
      }
    } catch (err) {
      console.error("찜 처리 실패", err);
    }
  };

  const handleRemoveBookmarkedProduct = async (id: string) => {
    try {
      await removeBookmark(id);
      setBookmarkedProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("찜 삭제 실패", err);
    }
  };

  const handleProductRegistered = async (newProduct: ProductItem) => {
    try {
      const { id, shopName, isMerchantUploaded, region, marketId, ...rest } = newProduct;
      const res = await createMerchantProduct(rest);
      setProducts((prev) => [res.product, ...prev]);
    } catch (err) {
      console.error("상품 등록 실패", err);
      alert("상품 등록에 실패했습니다. 판매자 계정으로 로그인되어 있는지 확인해주세요.");
    }
  };

  const handleProductUpdated = async (updatedProduct: ProductItem) => {
    try {
      const { id, shopName, isMerchantUploaded, region, marketId, ...rest } = updatedProduct;
      const res = await updateMerchantProduct(id, rest);
      setProducts((prev) => prev.map((p) => (p.id === id ? res.product : p)));
    } catch (err) {
      console.error("상품 수정 실패", err);
      alert("상품 수정에 실패했습니다.");
    }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      await deleteMerchantProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("상품 삭제 실패", err);
      alert("상품 삭제에 실패했습니다.");
    }
  };

  const handleSelectShopOnMap = (shopName: string) => {
    const foundProduct = products.find((p) => p.shopName === shopName);
    if (foundProduct) {
      setSelectedProduct(foundProduct);
    }
  };

  if (isLoginModalOpen) {
    return (
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
        currentRole={userRole}
        isFullScreen={true}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background-slate text-on-surface relative">
      {/* Top Header Bar (Show on Home & MY) */}
      {activeTab !== "map" && (
        <Header
          selectedRegion={selectedRegion}
          allRegions={REGIONS_DATA}
          onSelectRegion={handleSelectRegion}
          onOpenNotifications={() => setIsNotificationOpen(true)}
          activeTab={activeTab}
          userRole={userRole}
          userDisplayName={userDisplayName}
          onOpenLogin={() => setIsLoginModalOpen(true)}
        />
      )}

      {/* Main Tab View Canvas */}
      <main className="w-full">
        {activeTab === "home" &&
          (userRole === "merchant" ? (
            <MerchantView
              products={products}
              userDisplayName={userShopName || userDisplayName}
              onOpenAiScan={() => setIsAiScanOpen(true)}
              onAddProduct={handleProductRegistered}
              onUpdateProduct={handleProductUpdated}
              onDeleteProduct={handleDeleteProduct}
              onOpenLogin={() => setIsLoginModalOpen(true)}
              onSelectProduct={(p) => setSelectedProduct(p)}
            />
          ) : (
            <HomeFeed
              products={products}
              selectedRegion={selectedRegion}
              selectedMarket={selectedMarket}
              onSelectProduct={(p) => setSelectedProduct(p)}
              onOpenAiScan={() => setIsAiScanOpen(true)}
              userRole={userRole}
              userDisplayName={userDisplayName}
              onOpenLogin={() => setIsLoginModalOpen(true)}
              bookmarkedProductIds={bookmarkedProducts.map((p) => p.id)}
              onToggleBookmark={handleToggleBookmarkProduct}
            />
          ))}

        {activeTab === "map" && (
          <MapView
            selectedMarket={selectedMarket}
            onOpenAiScan={() => setIsAiScanOpen(true)}
            onSelectShop={handleSelectShopOnMap}
          />
        )}

        {activeTab === "saved" && (
          <SavedView
            scannedProducts={scannedProducts}
            bookmarkedProducts={bookmarkedProducts}
            onSelectProduct={(p) => setSelectedProduct(p)}
            onNavigateToMap={() => setActiveTab("map")}
            onRemoveScannedProduct={handleRemoveScannedProduct}
            onRemoveBookmarkedProduct={handleRemoveBookmarkedProduct}
          />
        )}

        {activeTab === "my" && (
          <MyWallet
            products={products}
            onNavigateToMap={() => setActiveTab("map")}
            userRole={userRole}
            userDisplayName={userDisplayName}
            onOpenLogin={() => setIsLoginModalOpen(true)}
            onLogout={handleLogout}
            onUpdateShopName={(newName) => setUserDisplayName(newName)}
          />
        )}
      </main>

      {/* Bottom Nav Bar */}
      <BottomNav
        activeTab={activeTab}
        isAiScanOpen={isAiScanOpen}
        userRole={userRole}
        onSelectTab={(tab) => {
          setIsAiScanOpen(false);
          setActiveTab(tab);
        }}
        onOpenAiScan={() => setIsAiScanOpen((prev) => !prev)}
      />

      {/* Modals */}
      {/* 1. AI Live Scanner Viewfinder */}
      <AiScanModal
        isOpen={isAiScanOpen}
        onClose={() => setIsAiScanOpen(false)}
        onSaveToSavedList={handleSaveScannedProduct}
        onNavigateToSavedTab={() => setActiveTab("saved")}
        userRole={userRole}
        userDisplayName={userDisplayName}
        onMerchantRegisterProduct={(newProduct) => {
          handleProductRegistered(newProduct);
        }}
      />

      {/* 2. Product Detail Inspection Modal */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          marketInfo={selectedMarket}
          initialTab="description"
          onClose={() => setSelectedProduct(null)}
          isBookmarked={bookmarkedProducts.some((p) => p.id === selectedProduct.id)}
          onToggleBookmark={handleToggleBookmarkProduct}
          onNavigateToMap={() => {
            setSelectedProduct(null);
            setActiveTab("map");
          }}
        />
      )}

      {/* 4. Notifications Modal */}
      {isNotificationOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-white w-full max-w-sm rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-base text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-trust-blue">notifications</span>
                실시간 전통시장 알림
              </h3>
              <button onClick={() => setIsNotificationOpen(false)} className="text-outline">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="py-8 text-center text-outline text-sm">
              아직 새로운 알림이 없습니다.
            </div>
          </div>
        </div>
      )}
      {/* 5. Login & Role Selection Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
        currentRole={userRole}
      />
    </div>
  );
}
