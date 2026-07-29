import { useEffect, useState } from "react";
import {
  TabType,
  MarketInfo,
  ProductItem,
  QuestItem,
  CouponItem,
} from "./types";
import {
  MARKETS_DATA,
  REGIONS_DATA,
  INITIAL_PRODUCTS,
  INITIAL_QUESTS,
  INITIAL_COUPONS,
} from "./data/initialData";
import { Header } from "./components/Header";
import { HomeFeed } from "./components/HomeFeed";
import { MapView } from "./components/MapView";
import { AiScanModal } from "./components/AiScanModal";
import { MyWallet } from "./components/MyWallet";
import { SavedView } from "./components/SavedView";
import { ProductDetailModal } from "./components/ProductDetailModal";
import { BottomNav } from "./components/BottomNav";
import { LoginModal, UserRole } from "./components/LoginModal";
import { fetchFeed } from "./lib/api";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>("home");
  const [userRole, setUserRole] = useState<UserRole>("customer");
  const [userDisplayName, setUserDisplayName] = useState<string>("");
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
  const [products, setProducts] = useState<ProductItem[]>(INITIAL_PRODUCTS);

  useEffect(() => {
    let cancelled = false;
    fetchFeed()
      .then((feed) => {
        if (!cancelled && feed.length > 0) setProducts(feed);
      })
      .catch((err) => {
        console.error("상품 피드를 불러오지 못했습니다. 임시 데이터로 표시합니다.", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [scannedProducts, setScannedProducts] = useState<ProductItem[]>([
    {
      id: "scan-sample-1",
      title: "AI 스캔 설향 딸기 1kg",
      shopName: "싱싱청과",
      distance: "양동전통시장",
      timeAgo: "1시간 전 스캔",
      price: 13500,
      publicPrice: 16800,
      priceTag: "공공 시세 대비 19.6% 저렴",
      grade: "A+ 최상",
      category: "과일",
      imageUrl: "https://images.unsplash.com/photo-1464965911861-746a04b4bca6?auto=format&fit=crop&w=600&q=80",
      freshnessScore: 98,
      defectScore: 2,
      uniformityScore: 96,
      description: "AI 신선도 스캔 결과 당도 및 당도 균일도가 뛰어난 최상품 딸기입니다.",
    },
  ]);
  const [bookmarkedProducts, setBookmarkedProducts] = useState<ProductItem[]>([
    INITIAL_PRODUCTS[0],
    INITIAL_PRODUCTS[1],
  ]);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
  const [isAiScanOpen, setIsAiScanOpen] = useState(false);
  const [cartItems, setCartItems] = useState<ProductItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [quests] = useState<QuestItem[]>(INITIAL_QUESTS);
  const [coupons, setCoupons] = useState<CouponItem[]>(INITIAL_COUPONS);

  const handleLoginSuccess = (role: UserRole, displayName: string) => {
    setUserRole(role);
    setUserDisplayName(displayName);
    setIsLoginModalOpen(false);
  };

  const handleAddToCart = (product: ProductItem) => {
    setCartItems((prev) => [...prev, product]);
  };

  const handleSaveScannedProduct = (scannedProduct: ProductItem) => {
    setScannedProducts((prev) => [scannedProduct, ...prev]);
  };

  const handleRemoveScannedProduct = (id: string) => {
    setScannedProducts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleToggleBookmarkProduct = (product: ProductItem) => {
    setBookmarkedProducts((prev) => {
      const exists = prev.some((p) => p.id === product.id);
      if (exists) {
        return prev.filter((p) => p.id !== product.id);
      } else {
        return [product, ...prev];
      }
    });
  };

  const handleRemoveBookmarkedProduct = (id: string) => {
    setBookmarkedProducts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleProductRegistered = (newProduct: ProductItem) => {
    setProducts((prev) => [newProduct, ...prev]);
  };

  const handleUseCoupon = (couponId: string) => {
    setCoupons((prev) =>
      prev.map((c) => (c.id === couponId ? { ...c, isUsed: true } : c))
    );
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
        {activeTab === "home" && (
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
        )}

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
            quests={quests}
            coupons={coupons}
            onUseCoupon={handleUseCoupon}
            onNavigateToMap={() => setActiveTab("map")}
            userRole={userRole}
            userDisplayName={userDisplayName}
            onOpenLogin={() => setIsLoginModalOpen(true)}
          />
        )}
      </main>

      {/* Bottom Nav Bar */}
      <BottomNav
        activeTab={activeTab}
        isAiScanOpen={isAiScanOpen}
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
      />

      {/* 2. Product Detail Inspection Modal */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          marketInfo={selectedMarket}
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

            <div className="space-y-3">
              <div className="p-3 bg-trust-blue/10 rounded-2xl border border-trust-blue/20">
                <div className="text-xs font-bold text-trust-blue mb-1">AI 뱃지 등록 알림</div>
                <div className="text-xs text-on-surface">
                  양동수산의 <span className="font-bold">제주 은갈치</span>가 AI 최상등급(A+) 검증되었습니다.
                </div>
                <div className="text-[10px] text-outline mt-1">10분 전</div>
              </div>

              <div className="p-3 bg-safe-emerald/10 rounded-2xl border border-safe-emerald/20">
                <div className="text-xs font-bold text-safe-emerald mb-1">쿠폰 발급 완료</div>
                <div className="text-xs text-on-surface">
                  호남상회 <span className="font-bold">가을무 20% OFF</span> 쿠폰이 지갑에 발급되었습니다.
                </div>
                <div className="text-[10px] text-outline mt-1">30분 전</div>
              </div>
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
