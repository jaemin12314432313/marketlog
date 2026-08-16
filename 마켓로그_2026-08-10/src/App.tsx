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
  fetchMe,
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
  clearAuthToken,
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
  const [userUsername, setUserUsername] = useState<string>("");
  const [userPhone, setUserPhone] = useState<string>("");
  // 마이 탭 프로필 사진 — 백엔드에 저장돼서 탭을 옮겼다 와도(MyWallet 언마운트) 유지된다.
  const [userProfileImage, setUserProfileImage] = useState<string>("");
  // 상인이 로그인 후 마이 탭에서 고르는 소속 전통시장 — 지도 탭 검색으로 바뀌는
  // selectedMarket과는 별개다(그건 소비자가 지도를 둘러보는 상태). 빈 문자열이면 아직
  // 고르지 않은 것(가입 절차에서는 더 이상 받지 않는다).
  const [userMarketId, setUserMarketId] = useState<string>("");
  // 앱은 항상 로그인 화면부터 시작한다. 저장된 토큰으로 세션이 복원되면(자동로그인)
  // 아래 useEffect에서 바로 false로 내려가고, 복원 실패/토큰 없음이면 true로 유지된다.
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);
  // 저장된 토큰으로 세션을 복원하는 동안 로그인 화면이 잠깐 번쩍였다 사라지는 걸 막기 위한 스플래시.
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);
  const [selectedRegion, setSelectedRegion] = useState<string>("전체");
  const [selectedMarket, setSelectedMarket] = useState<MarketInfo>(MARKETS_DATA[0]);
  // 상인 화면(내 정보/물건 등록)에 보여줄 시장 이름 — 지도 탭에서 검색으로 다른 시장을
  // 봐도(selectedMarket) 이건 안 바뀌고, 항상 그 상인이 고른 시장 그대로다. 아직 안
  // 골랐으면(userMarketId가 빈 값) undefined로 둬서 마이 탭이 선택 카드를 보여주게 한다.
  const merchantMarket = userMarketId ? MARKETS_DATA.find((m) => m.id === userMarketId) : undefined;
  // 상품 상세의 "상점 위치 지도에서 확인하기"에서 넘어왔을 때 지도가 바로 그 상점으로
  // 이동/포커스하도록 전달하는 값 — MapView가 처리하고 나면 다시 null로 비운다.
  const [mapFocusShopName, setMapFocusShopName] = useState<string | null>(null);
  // 위와 같은 흐름으로 지도에 왔을 때, 뒤로가기를 누르면 원래 보던 상품 상세로 돌아갈 수
  // 있도록 그 상품을 기억해둔다 — 예전엔 onNavigateToMap이 selectedProduct를 바로 지워서,
  // 지도까지 갔다가 다시 상품으로 돌아갈 방법이 하단 탭바로 홈에 가는 것뿐이었다.
  const [mapReturnProduct, setMapReturnProduct] = useState<ProductItem | null>(null);
  // 상품 상세로 돌아간 뒤 그걸 닫았을 때도, 원래 있던 탭(보통 홈 피드)이 아니라 "map"
  // 탭이 그대로 남아있으면 안 되므로 지도로 넘어가기 직전의 탭을 같이 기억해둔다.
  const [mapReturnTab, setMapReturnTab] = useState<TabType | null>(null);
  // 상품 상세의 레시피 탭에서 "지도에서 재료 위치 확인"을 누르면 그 레시피 재료 목록을
  // 담아 지도 탭으로 넘어간다 — MapView가 실제 등록 상품/점포와 매칭해 마커를 표시한다.
  const [recipeIngredients, setRecipeIngredients] = useState<string[] | null>(null);

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [scannedProducts, setScannedProducts] = useState<ProductItem[]>([]);
  const [bookmarkedProducts, setBookmarkedProducts] = useState<ProductItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);

  const [isFeedLoading, setIsFeedLoading] = useState(true);

  // 상품 피드는 로그인 여부와 무관하게 백엔드에서 불러온다. 처음 홈 탭에 들어올 때뿐
  // 아니라, 다른 탭(지도/저장/내 정보)에 갔다가 다시 홈으로 돌아올 때마다도 새로
  // 불러온다 — 그 사이 상인이 물건/가게 정보를 바꿨어도 화면을 나갔다 들어오면 바로
  // 보이게 하기 위함. isFeedLoading은 최초 1회만 true였다가 false로 내려가므로, 재진입
  // 때 다시 불러오는 동안 로딩 스켈레톤이 깜빡이며 다시 뜨지는 않는다.
  useEffect(() => {
    if (activeTab !== "home") return;
    fetchFeed()
      .then(setProducts)
      .catch((err) => console.error("상품 피드를 불러오지 못했습니다.", err))
      .finally(() => setIsFeedLoading(false));
  }, [activeTab]);

  // 저장된 토큰이 있으면 앱을 새로 열 때마다 다시 로그인하지 않고 세션을 복원한다(자동로그인).
  // 토큰이 없거나 만료됐으면 로그인 화면을 강제로 띄운다(게스트 진입 불가).
  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setIsAuthChecking(false);
      setIsLoginModalOpen(true);
      return;
    }
    fetchMe()
      .then((res) => {
        setUserRole(res.user.role);
        setUserDisplayName(res.user.displayName);
        setUserShopName(res.user.shopName || "");
        setUserMarketId(res.user.marketId || "");
        setUserUsername(res.user.username);
        setUserPhone(res.user.phone || "");
        setUserProfileImage(res.user.profileImage || "");
      })
      .catch(() => {
        clearAuthToken();
        setIsLoginModalOpen(true);
      })
      .finally(() => setIsAuthChecking(false));
  }, []);

  // 로그인 상태가 되면(토큰 발급 후) 내 찜/AI스캔 저장목록을 백엔드에서 불러온다.
  useEffect(() => {
    if (isAuthChecking || isLoginModalOpen || !getAuthToken()) return;
    fetchBookmarks()
      .then(setBookmarkedProducts)
      .catch((err) => console.error("찜 목록을 불러오지 못했습니다.", err));
    fetchScannedProducts()
      .then(setScannedProducts)
      .catch((err) => console.error("AI 스캔 저장목록을 불러오지 못했습니다.", err));
  }, [isAuthChecking, isLoginModalOpen]);

  const [isAiScanOpen, setIsAiScanOpen] = useState(false);
  const [cartItems, setCartItems] = useState<ProductItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  // 상인이 상품 등록/수정 폼에 뭔가 입력해둔 상태인지 — 뒤로가기가 홈(상인 화면)에서
  // 바로 앱을 백그라운드로 보내버리기 전에 이걸 확인해서 작성 중인 내용을 지키게 한다.
  const [isMerchantFormDirty, setIsMerchantFormDirty] = useState(false);

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
      } else if (activeTab === "map" && mapReturnProduct) {
        setSelectedProduct(mapReturnProduct);
        setMapReturnProduct(null);
        setActiveTab(mapReturnTab ?? "home");
        setMapReturnTab(null);
      } else if (activeTab !== "home") {
        setActiveTab("home");
      } else if (isMerchantFormDirty) {
        if (window.confirm("작성 중인 상품 정보가 있습니다. 저장하지 않고 나가시겠어요?")) {
          setIsMerchantFormDirty(false);
          CapacitorApp.minimizeApp();
        }
      } else {
        CapacitorApp.minimizeApp();
      }
    });
    return () => {
      listener.then((l) => l.remove());
    };
  }, [isNotificationOpen, selectedProduct, isAiScanOpen, activeTab, isMerchantFormDirty, mapReturnProduct, mapReturnTab]);

  const handleLoginSuccess = (
    role: UserRole,
    displayName: string,
    shopName?: string,
    username?: string,
    phone?: string,
    profileImage?: string,
    marketId?: string
  ) => {
    setUserRole(role);
    setUserDisplayName(displayName);
    setUserShopName(shopName || "");
    setUserMarketId(marketId || "");
    setUserUsername(username || "");
    setUserPhone(phone || "");
    setUserProfileImage(profileImage || "");
    setIsLoginModalOpen(false);
    setActiveTab("home");
  };

  const handleLogout = () => {
    clearAuthToken();
    setUserDisplayName("");
    setUserShopName("");
    setUserMarketId("");
    setUserRole("customer");
    setUserUsername("");
    setUserPhone("");
    setUserProfileImage("");
    setBookmarkedProducts([]);
    setScannedProducts([]);
    setActiveTab("home");
    setIsLoginModalOpen(true);
  };

  const handleAddToCart = (product: ProductItem) => {
    setCartItems((prev) => [...prev, product]);
  };

  // 스캔 목록 저장은 매번 새 레코드를 만드는 API라(북마크처럼 존재 여부로 걸러지지 않음),
  // 저장 중에 또 누르면 진짜로 중복 레코드가 생긴다 — 진행 중엔 추가 클릭을 무시한다.
  const [isSavingScannedProduct, setIsSavingScannedProduct] = useState(false);

  const handleSaveScannedProduct = async (scannedProduct: ProductItem) => {
    if (isSavingScannedProduct) return;
    setIsSavingScannedProduct(true);
    try {
      const { id, ...rest } = scannedProduct;
      const res = await addScannedProduct(rest);
      setScannedProducts((prev) => [res.product, ...prev]);
    } catch (err) {
      console.error("AI 스캔 저장 실패", err);
    } finally {
      setIsSavingScannedProduct(false);
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

  // 북마크 아이콘을 빠르게 여러 번 누르면, 첫 요청이 끝나기 전엔 bookmarkedProducts가
  // 아직 안 바뀌어서 "exists" 판정이 매번 false로 나와 addBookmark가 중복 호출되고 목록에
  // 같은 상품이 여러 번 들어갔다 — 처리 중인 상품 id는 추가 클릭을 무시하게 막는다.
  const [pendingBookmarkIds, setPendingBookmarkIds] = useState<Set<string>>(new Set());

  const handleToggleBookmarkProduct = async (product: ProductItem) => {
    if (!getAuthToken()) {
      setIsLoginModalOpen(true);
      return;
    }
    if (pendingBookmarkIds.has(product.id)) return;
    setPendingBookmarkIds((prev) => new Set(prev).add(product.id));

    const exists = bookmarkedProducts.some((p) => p.id === product.id);
    try {
      if (exists) {
        await removeBookmark(product.id);
        setBookmarkedProducts((prev) => prev.filter((p) => p.id !== product.id));
      } else {
        await addBookmark(product.id);
        setBookmarkedProducts((prev) => (prev.some((p) => p.id === product.id) ? prev : [product, ...prev]));
      }
    } catch (err) {
      console.error("찜 처리 실패", err);
    } finally {
      setPendingBookmarkIds((prev) => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
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

  // 성공/실패를 boolean으로 돌려줘서, 호출부(MerchantView)가 실제 결과를 기다렸다가
  // 성공했을 때만 "등록/수정/삭제되었습니다" 토스트를 보여줄 수 있게 한다. 실패 알림은
  // 여기서 이미 alert로 보여주므로, 호출부는 실패 시 별도 안내 없이 그냥 조용히 넘어간다.
  const handleProductRegistered = async (newProduct: ProductItem): Promise<boolean> => {
    try {
      const { id, shopName, isMerchantUploaded, region, marketId, ...rest } = newProduct;
      const res = await createMerchantProduct(rest);
      setProducts((prev) => [res.product, ...prev]);
      return true;
    } catch (err) {
      console.error("상품 등록 실패", err);
      alert("상품 등록에 실패했습니다. 판매자 계정으로 로그인되어 있는지 확인해주세요.");
      return false;
    }
  };

  const handleProductUpdated = async (updatedProduct: ProductItem): Promise<boolean> => {
    try {
      const { id, shopName, isMerchantUploaded, region, marketId, ...rest } = updatedProduct;
      const res = await updateMerchantProduct(id, rest);
      setProducts((prev) => prev.map((p) => (p.id === id ? res.product : p)));
      return true;
    } catch (err) {
      console.error("상품 수정 실패", err);
      alert("상품 수정에 실패했습니다.");
      return false;
    }
  };

  const handleDeleteProduct = async (id: string): Promise<boolean> => {
    try {
      await deleteMerchantProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
      return true;
    } catch (err) {
      console.error("상품 삭제 실패", err);
      alert("상품 삭제에 실패했습니다.");
      return false;
    }
  };

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-background-slate flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-4 border-trust-blue border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm text-outline">마켓로그를 불러오는 중...</p>
      </div>
    );
  }

  if (isLoginModalOpen) {
    return (
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
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
          onSelectRegion={setSelectedRegion}
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
              marketName={merchantMarket?.name || ""}
              onOpenAiScan={() => setIsAiScanOpen(true)}
              onAddProduct={handleProductRegistered}
              onUpdateProduct={handleProductUpdated}
              onDeleteProduct={handleDeleteProduct}
              onOpenLogin={() => setIsLoginModalOpen(true)}
              onSelectProduct={(p) => setSelectedProduct(p)}
              onFormDirtyChange={setIsMerchantFormDirty}
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
              isLoading={isFeedLoading}
            />
          ))}

        {activeTab === "map" && (
          <MapView
            selectedMarket={selectedMarket}
            onSelectMarket={setSelectedMarket}
            onOpenAiScan={() => setIsAiScanOpen(true)}
            focusShopName={mapFocusShopName}
            onFocusHandled={() => setMapFocusShopName(null)}
            recipeIngredients={recipeIngredients}
            onClearRecipeIngredients={() => setRecipeIngredients(null)}
            onBack={
              mapReturnProduct
                ? () => {
                    setSelectedProduct(mapReturnProduct);
                    setMapReturnProduct(null);
                    setActiveTab(mapReturnTab ?? "home");
                    setMapReturnTab(null);
                  }
                : undefined
            }
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
            isLoggedIn={Boolean(userUsername)}
            onOpenLogin={() => setIsLoginModalOpen(true)}
          />
        )}

        {activeTab === "my" && (
          <MyWallet
            products={products}
            marketName={merchantMarket?.name || ""}
            userMarketId={userMarketId}
            onMarketSelected={setUserMarketId}
            onNavigateToMap={() => setActiveTab("map")}
            userRole={userRole}
            userDisplayName={userDisplayName}
            userShopName={userShopName}
            userUsername={userUsername}
            userPhone={userPhone}
            userProfileImage={userProfileImage}
            isLoggedIn={Boolean(userUsername)}
            onOpenLogin={() => setIsLoginModalOpen(true)}
            onLogout={handleLogout}
            onUpdateShopName={(newName) => setUserShopName(newName)}
            onProfileUpdated={(displayName, phone) => {
              setUserDisplayName(displayName);
              setUserPhone(phone);
            }}
            onProfileImageUpdated={(image) => setUserProfileImage(image)}
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
          if (tab !== "map") {
            setMapReturnProduct(null);
            setMapReturnTab(null);
          }
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
            setMapFocusShopName(selectedProduct.shopName);
            setMapReturnProduct(selectedProduct);
            setMapReturnTab(activeTab);
            setSelectedProduct(null);
            setActiveTab("map");
          }}
          onNavigateToRecipeMap={(ingredients) => {
            setRecipeIngredients(ingredients);
            setMapReturnProduct(selectedProduct);
            setMapReturnTab(activeTab);
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
    </div>
  );
}
