import React, { useState, useEffect } from "react";
import { UserRole } from "./LoginModal";
import { ProductItem } from "../types";
import { ApiError, getStoreProfile, setMerchantMarket, updateProfile, updateStoreProfile } from "../lib/api";
import { StoreLocationPicker } from "./StoreLocationPicker";
import { StoreLocationThumbnail } from "./StoreLocationThumbnail";
import { MARKETS_DATA, REGIONS_DATA } from "../data/initialData";

// "전체"는 상인 소속 시장 선택에는 의미가 없는 선택지라 뺀다.
const MERCHANT_REGIONS = REGIONS_DATA.filter((r) => r !== "전체");

// 소비자쪽 홈 피드 필터와 같은 5개 카테고리로 맞춰서, 상인이 "주요 품목"을 직접 타이핑하는 대신
// 체크 버튼으로 고르게 한다 — 오탈자 걱정 없이 손가락으로 누르기만 하면 된다.
const SHOP_CATEGORY_OPTIONS = ["야채", "과일", "정육", "수산물", "건어물"];

// 대분류를 고르면 그 밑에 세부 품목(중분류)도 체크로 고를 수 있게 한다. 야채/과일은 소비자
// 필터에 이미 있는 품종 목록을 그대로 쓰고, 정육/수산물/건어물은 AI 인식 목록이 없어서
// 자주 파는 품목 몇 개만 대충 추려 넣었다 — 목록에 없으면 아래 "직접 입력"에 적으면 된다.
const SHOP_SUBCATEGORY_OPTIONS: Record<string, string[]> = {
  야채: ["무", "배추", "마늘", "양파", "양배추", "감자"],
  과일: ["사과", "배", "감", "감귤"],
  정육: ["소고기", "돼지고기", "닭고기"],
  수산물: ["고등어", "갈치", "오징어", "새우"],
  건어물: ["멸치", "미역", "다시마"],
};

// 주요 품목은 결국 하나의 문자열(subtitle)로 저장되므로, 대분류/중분류/직접입력 선택 상태를
// "야채(무·배추) / 수산물(고등어) / 트러플" 같은 문자열로 합쳤다 다시 풀어 쓴다.
function parseShopCategoryValue(value: string): {
  majors: string[];
  subsByMajor: Record<string, string[]>;
  custom: string;
} {
  const majors: string[] = [];
  const subsByMajor: Record<string, string[]> = {};
  const customParts: string[] = [];
  const segments = value.split("/").map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const match = seg.match(/^(.+?)\(([^)]*)\)$/);
    const major = (match ? match[1] : seg).trim();
    if (SHOP_CATEGORY_OPTIONS.includes(major)) {
      majors.push(major);
      subsByMajor[major] = match ? match[2].split("·").map((s) => s.trim()).filter(Boolean) : [];
    } else {
      customParts.push(seg);
    }
  }
  return { majors, subsByMajor, custom: customParts.join(" / ") };
}

function buildShopCategoryValue(
  majors: string[],
  subsByMajor: Record<string, string[]>,
  custom: string
): string {
  const parts = SHOP_CATEGORY_OPTIONS.filter((c) => majors.includes(c)).map((major) => {
    const subs = subsByMajor[major] || [];
    return subs.length > 0 ? `${major}(${subs.join("·")})` : major;
  });
  if (custom.trim()) parts.push(custom.trim());
  return parts.join(" / ");
}

// 저장된 휴대폰 번호는 숫자만("01021814361") 들어있어서, 읽기 전용으로 보여줄 때 하이픈을
// 넣어 "010-2181-4361" 형식으로 표시한다. 표준 11자리/10자리가 아니면 원본 그대로 둔다.
function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
}

// 입력 중에도 숫자만 치면 바로 하이픈이 붙게 한다. 서울(02)은 국번이 2자리라 나머지
// 지역번호/휴대폰(010, 031 등 3자리)과 자리수가 달라서 따로 나눠 처리한다.
function formatPhoneAsYouType(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.startsWith("02")) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}

// 영업시간은 "06:00 - 20:00" 또는 "06:00 - 20:00 (매주 화요일 휴무)"로 저장한다. 네이티브
// time input을 쓰면 형식이 항상 "HH:MM"으로 강제되므로, 나중에 "지금 영업 중" 필터를 붙일 때도
// 이 값을 그대로 파싱해서 쓸 수 있다. 이 형식으로 못 쪼개는 기존 자유 입력 값은 통째로 비고로
// 남겨서 데이터가 사라지지 않게 한다.
// 시작/종료 시간을 둘 다 고르기 전(보통 시작 시간부터 먼저 고름)에도 방금 고른 값이
// 사라지면 안 되므로, 시간 그룹을 둘 다 선택적으로 둬서 "06:00 - "나 " - 20:00"처럼
// 한쪽만 채워진 상태도 그대로 저장/복원할 수 있게 한다.
function parseShopHoursValue(value: string): { start: string; end: string; note: string } {
  const match = value.trim().match(/^(\d{1,2}:\d{2})?\s*-\s*(\d{1,2}:\d{2})?\s*(?:\(([^)]*)\))?$/);
  if (match && (match[1] || match[2])) {
    return { start: match[1] || "", end: match[2] || "", note: (match[3] || "").trim() };
  }
  return { start: "", end: "", note: value.trim() };
}

function buildShopHoursValue(start: string, end: string, note: string): string {
  const range = start || end ? `${start} - ${end}` : "";
  const trimmedNote = note.trim();
  if (range && trimmedNote) return `${range} (${trimmedNote})`;
  return range || trimmedNote;
}

// "직접 입력" 예시가 고른 대분류와 안 맞으면(정육을 골랐는데 수산물 예시가 뜨는 식) 어색해
// 보이므로, 선택한 대분류에 맞는 예시를 보여준다.
const SHOP_CUSTOM_ITEM_PLACEHOLDER: Record<string, string> = {
  야채: "예: 열무, 깻잎",
  과일: "예: 한라봉, 자두",
  정육: "예: 한우, 흑돼지",
  수산물: "예: 홍어, 병어",
  건어물: "예: 오징어채, 먹태",
};
const SHOP_CUSTOM_ITEM_PLACEHOLDER_DEFAULT = "예: 젓갈, 나물";

// 전통시장 상인 대부분은 요일 구분 없이 매일 같은 시간에 열고, 특정 요일에만 쉰다. 그래서
// 정기휴무일은 자주 쓰는 패턴만 드롭다운으로 주고, 예외적인 경우만 직접 입력하게 한다.
const HOURS_CLOSED_DAY_PRESETS = ["연중무휴", "매주 일요일", "첫째·셋째 주 일요일"];

// 네이티브 time input은 시/분을 따로 휠로 돌려야 해서 어르신들껜 번거롭다는 피드백 — 시장
// 영업시간은 거의 다 정시나 30분 단위(06:00, 07:30...)라, 목록에서 탭 한 번으로 고르는
// 드롭다운이면 충분하다. 04:00~23:30 범위를 30분 단위로 채운다.
const HOURS_TIME_PRESETS = Array.from({ length: 40 }, (_, i) => {
  const totalMinutes = 4 * 60 + i * 30;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

interface MyWalletProps {
  onNavigateToMap?: () => void;
  marketName?: string;
  userRole?: UserRole;
  userDisplayName?: string;
  userShopName?: string;
  userUsername?: string;
  userPhone?: string;
  userProfileImage?: string;
  // 상인이 가입 후 로그인해서 아직 소속 전통시장을 안 골랐으면 빈 문자열 — 이 경우
  // 점포 위치 등록보다 먼저 시장 선택 카드를 보여준다.
  userMarketId?: string;
  onMarketSelected?: (marketId: string) => void;
  isLoggedIn?: boolean;
  onOpenLogin?: () => void;
  onLogout?: () => void;
  products?: ProductItem[];
  onUpdateShopName?: (newName: string) => void;
  onProfileUpdated?: (displayName: string, phone: string) => void;
  onProfileImageUpdated?: (image: string) => void;
}

export const MyWallet: React.FC<MyWalletProps> = ({
  marketName = "",
  userRole = "customer",
  userDisplayName,
  userShopName = "",
  userUsername = "",
  userPhone = "",
  userProfileImage = "",
  userMarketId = "",
  onMarketSelected,
  isLoggedIn = false,
  onOpenLogin,
  onLogout,
  products = [],
  onUpdateShopName,
  onProfileUpdated,
  onProfileImageUpdated,
}) => {
  // 상단 헤더에 쓰는 건 계정 표시 이름이다 — 점포 상세정보의 "상호명"과는 별개 값이라
  // 여기서 섞어 쓰지 않는다.
  const initialShopName = userDisplayName || (userRole === "merchant" ? "양동수산 사장님" : "스마트 장보기 회원");

  // Merchant Store Details Editable State — 점포 위치 등록(지도 핀) 이후에만 저장 가능한
  // 실제 백엔드 데이터. hasStoreProfile이 false면 아직 위치 등록 전이라는 뜻.
  const [isEditingShopInfo, setIsEditingShopInfo] = useState(false);
  const [hasStoreProfile, setHasStoreProfile] = useState<boolean | null>(null); // null = 로딩 중
  const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);
  const [locationVersion, setLocationVersion] = useState(0);
  // 주요 품목 값이 길면 요약 화면 한 줄을 넘어가서 지저분해지므로 기본은 한 줄로
  // 잘라 보여주고 눌러서 펼칠 수 있게 한다.
  const [isShopCategoryExpanded, setIsShopCategoryExpanded] = useState(false);
  const [shopInfo, setShopInfo] = useState({
    storeName: userShopName || initialShopName,
    marketName,
    category: "",
    phone: "",
    hours: "",
    description: "",
    address: "",
  });

  // 영업시간 입력 모드 — "매일 동일하게 영업"이 기본값이라 시작/종료 시간 2개만 고르면
  // 끝나고, 요일마다 다르게 여는 예외적인 상인만 체크를 풀어 자유 텍스트로 적는다.
  const [isHoursDailyMode, setIsHoursDailyMode] = useState(true);
  const [hoursClosedDayMode, setHoursClosedDayMode] = useState<string>(HOURS_CLOSED_DAY_PRESETS[0]);

  // 점포 상세정보 수정 폼의 주요 품목/영업시간 편집 영역이 세부 품목 체크박스·시간
  // 드롭다운 때문에 세로로 길어서, 기본은 접어두고 필요할 때만 펼치게 한다.
  const [isEditCategoryOpen, setIsEditCategoryOpen] = useState(false);
  const [isEditHoursOpen, setIsEditHoursOpen] = useState(false);

  // Customer Profile & Nickname Editable State
  const [customerNickname, setCustomerNickname] = useState(
    userDisplayName || "스마트 장보기 회원"
  );
  const [isEditingCustomerNickname, setIsEditingCustomerNickname] = useState(false);
  const [customerNicknameInput, setCustomerNicknameInput] = useState(customerNickname);
  // 사진 업로드는 상인/소비자 둘 다 같은 방식으로 쓰므로(마이 탭 아바타를 통일), 역할과
  // 무관한 이름으로 둔다.
  const [profileImage, setProfileImage] = useState<string | null>(userProfileImage || null);
  const profileFileInputRef = React.useRef<HTMLInputElement>(null);

  // 로그인 직후엔 아직 fetchMe()가 안 끝나 프로필 아바타 props가 빈 값으로 들어왔다가 뒤늦게
  // 채워질 수 있어서, 값이 도착하면 화면에도 반영되게 동기화해준다.
  useEffect(() => {
    if (userProfileImage) setProfileImage(userProfileImage);
  }, [userProfileImage]);

  // shopInfo.marketName은 useState 초기값으로만 받아서, 소속 전통시장을 처음 선택한
  // 직후(handleConfirmMarket → onMarketSelected → 부모의 marketName prop 갱신)에도
  // 로컬 상태가 그대로 남아 "미선택"만 계속 보여주는 문제가 있었다 — prop이 바뀌면
  // 같이 갱신되게 동기화한다.
  useEffect(() => {
    setShopInfo((prev) => ({ ...prev, marketName }));
  }, [marketName]);

  // Personal Information Editing State — 실제 로그인한 유저의 진짜 정보를 사용한다.
  const [personalInfo, setPersonalInfo] = useState({
    userName: userDisplayName || "",
    userPhone: userPhone || "",
    currentPw: "",
    newPw: "",
    confirmPw: "",
  });
  const [isEditingPersonalInfo, setIsEditingPersonalInfo] = useState(false);
  const [isSavingPersonalInfo, setIsSavingPersonalInfo] = useState(false);

  useEffect(() => {
    setPersonalInfo((prev) => ({
      ...prev,
      userName: userDisplayName || prev.userName,
      userPhone: userPhone || prev.userPhone,
    }));
  }, [userDisplayName, userPhone]);

  useEffect(() => {
    if (userDisplayName) {
      setCustomerNickname(userDisplayName);
      setCustomerNicknameInput(userDisplayName);
    }
  }, [userDisplayName]);

  const handleSavePersonalInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personalInfo.userName.trim()) {
      alert("이름을 입력해주세요.");
      return;
    }
    if (!personalInfo.userPhone.trim()) {
      alert("휴대폰 번호를 입력해주세요.");
      return;
    }
    if (personalInfo.newPw) {
      if (!personalInfo.currentPw) {
        alert("비밀번호를 변경하려면 현재 비밀번호를 입력해주세요.");
        return;
      }
      if (personalInfo.newPw.length < 8) {
        alert("새 비밀번호는 8자 이상이어야 합니다.");
        return;
      }
      if (personalInfo.newPw !== personalInfo.confirmPw) {
        alert("새 비밀번호 확인이 일치하지 않습니다.");
        return;
      }
    }

    setIsSavingPersonalInfo(true);
    try {
      const res = await updateProfile({
        displayName: personalInfo.userName.trim(),
        phone: personalInfo.userPhone.trim(),
        ...(personalInfo.newPw
          ? { currentPassword: personalInfo.currentPw, newPassword: personalInfo.newPw }
          : {}),
      });
      if (onProfileUpdated) {
        onProfileUpdated(res.user.displayName, res.user.phone || "");
      }
      setIsEditingPersonalInfo(false);
      setPersonalInfo((prev) => ({ ...prev, currentPw: "", newPw: "", confirmPw: "" }));
      showToast("개인정보가 성공적으로 수정되었습니다.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        alert("현재 비밀번호가 올바르지 않습니다.");
      } else {
        alert("개인정보 수정에 실패했습니다. 잠시 후 다시 시도해주세요.");
      }
    } finally {
      setIsSavingPersonalInfo(false);
    }
  };

  const handleProfileImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result as string;
      setProfileImage(dataUrl);
      try {
        await updateProfile({ profileImage: dataUrl });
        onProfileImageUpdated?.(dataUrl);
        showToast("프로필 사진이 성공적으로 변경되었습니다.");
      } catch (err) {
        console.error(err);
        alert("프로필 사진 저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
      }
    };
    reader.readAsDataURL(file);
    // 같은 파일을 다시 골라도 onChange가 또 발생하도록 값을 비워둔다.
    e.target.value = "";
  };

  // 지금까지는 사진을 한 번 올리면 다른 사진으로 바꿀 수만 있고 아예 없앨 방법이
  // 없었다 — 빈 문자열로 저장해서 "사진 없음(아이콘으로 표시)" 상태로 되돌린다.
  const handleRemoveProfileImage = async () => {
    const previous = profileImage;
    setProfileImage(null);
    try {
      await updateProfile({ profileImage: "" });
      onProfileImageUpdated?.("");
      showToast("프로필 사진을 삭제했습니다.");
    } catch (err) {
      console.error(err);
      setProfileImage(previous);
      alert("프로필 사진 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.");
    }
  };

  const handleSaveCustomerNickname = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = customerNicknameInput.trim();
    if (!trimmed) {
      alert("닉네임을 입력해주세요.");
      return;
    }
    setCustomerNickname(trimmed);
    if (onUpdateShopName) {
      onUpdateShopName(trimmed);
    }
    setIsEditingCustomerNickname(false);
  };

  // Edit form buffer
  const [editForm, setEditForm] = useState({ ...shopInfo });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 점포 상세정보는 "점포 위치 등록"을 먼저 해야 저장할 Store 레코드가 생긴다 —
  // 위치 등록 전이면 hasStoreProfile=false로 두고 안내 문구를 보여준다. 위치 등록도
  // 같은 Store 레코드 존재 여부로 판단하므로 hasStoreProfile을 그대로 재사용한다.
  const refreshStoreProfile = () => {
    if (userRole !== "merchant") return;
    getStoreProfile()
      .then((res) => {
        if (res.profile) {
          setHasStoreProfile(true);
          setShopInfo((prev) => ({
            ...prev,
            storeName: res.profile!.name,
            category: res.profile!.subtitle,
            phone: res.profile!.phone,
            hours: res.profile!.hours,
            description: res.profile!.storyText,
            address: res.profile!.address,
          }));
        } else {
          setHasStoreProfile(false);
        }
      })
      .catch((err) => {
        console.error("점포 상세정보를 불러오지 못했습니다.", err);
        setHasStoreProfile(false);
      });
  };

  useEffect(() => {
    refreshStoreProfile();
  }, [userRole]);

  // 상인이 로그인 후 아직 소속 전통시장을 안 골랐을 때 보여줄 선택 폼 — 가입 때는 더 이상
  // 받지 않고, 여기서 처음 점포 정보를 채우려 할 때 고르게 한다. 지역(대분류)을 먼저
  // 고르면 그 지역의 유명 시장 3곳만 추려서 보여주고, 목록에 없으면 직접 입력한다.
  const [pendingRegion, setPendingRegion] = useState(MERCHANT_REGIONS[0]);
  const marketsInPendingRegion = MARKETS_DATA.filter((m) => m.region === pendingRegion);
  const [pendingMarketId, setPendingMarketId] = useState(
    marketsInPendingRegion[0]?.id || "custom"
  );
  const [pendingCustomName, setPendingCustomName] = useState("");
  const [isSavingMarket, setIsSavingMarket] = useState(false);
  // 이미 시장이 설정된 계정은 기본적으로 읽기 전용 표시만 보여주다가, "변경" 버튼을
  // 눌러야 선택 폼이 펼쳐진다 — 실수로 건드리는 걸 막기 위한 한 단계 확인.
  const [isChangingMarket, setIsChangingMarket] = useState(false);

  const handleConfirmMarket = async () => {
    if (pendingMarketId === "custom" && !pendingCustomName.trim()) {
      alert("소속 전통시장 이름을 입력해주세요.");
      return;
    }
    // 이미 시장이 있는 상태에서 바꾸는 거면(초기 설정이 아니라 변경이면) 한 번 더 확인 —
    // 점포/상품이 새 시장 기준으로 옮겨지는 눈에 띄는 변화라서.
    if (userMarketId && !window.confirm("소속 전통시장을 바꾸면 등록된 점포와 상품이 새 시장 기준으로 옮겨집니다. 계속할까요?")) {
      return;
    }
    setIsSavingMarket(true);
    try {
      const res = await setMerchantMarket(
        pendingMarketId === "custom"
          ? { customName: pendingCustomName.trim(), customRegion: pendingRegion }
          : { marketId: pendingMarketId }
      );
      onMarketSelected?.(res.marketId);
      setIsChangingMarket(false);
    } catch (err) {
      console.error("소속 전통시장 저장 실패", err);
      alert("소속 전통시장 저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsSavingMarket(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  };

  const [isSavingShopInfo, setIsSavingShopInfo] = useState(false);

  const handleStartEdit = () => {
    if (!hasStoreProfile) {
      alert("점포 상세정보를 저장하려면 먼저 '점포 위치 등록'으로 지도에 점포를 등록해주세요.");
      return;
    }
    setEditForm({ ...shopInfo });
    // "매일 동일하게 영업"이 기본값이다 — 시장 상인은 거의 다 매일 같은 시간에 열기
    // 때문에, 예전 데이터 형식을 추론해서 자유 텍스트 모드로 슬쩍 바뀌는 일이 없게
    // 항상 이 모드로 연다. 정기휴무일도 정확히 아는 프리셋일 때만 그대로 보여주고,
    // 그 외엔 "직접입력"으로 잘못 넘어가지 않게 기본값(연중무휴)으로 시작한다.
    const loadedHours = parseShopHoursValue(shopInfo.hours);
    setIsHoursDailyMode(true);
    setHoursClosedDayMode(
      HOURS_CLOSED_DAY_PRESETS.includes(loadedHours.note) ? loadedHours.note : HOURS_CLOSED_DAY_PRESETS[0]
    );
    setIsEditCategoryOpen(false);
    setIsEditHoursOpen(false);
    setIsEditingShopInfo(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editForm.storeName.trim()) {
      alert("상호명을 입력해주세요.");
      return;
    }
    setIsSavingShopInfo(true);
    try {
      const res = await updateStoreProfile({
        name: editForm.storeName.trim(),
        subtitle: editForm.category,
        phone: editForm.phone,
        hours: editForm.hours,
        storyText: editForm.description,
      });
      setShopInfo((prev) => ({
        ...prev,
        storeName: res.profile.name,
        category: res.profile.subtitle,
        phone: res.profile.phone,
        hours: res.profile.hours,
        description: res.profile.storyText,
      }));
      // 상호명이 상인 매칭 키(shop_name)라, 바뀐 값을 상위(App)에도 바로 반영해서
      // 다른 화면(내 상품 등록 등)도 새로고침 없이 새 이름으로 맞춰지게 한다.
      if (onUpdateShopName) {
        onUpdateShopName(res.profile.name);
      }
      setIsEditingShopInfo(false);
      showToast("점포 상세 정보가 성공적으로 수정되었습니다.");
    } catch (err) {
      console.error(err);
      alert("점포 상세정보 저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsSavingShopInfo(false);
    }
  };

  const handleCancelEdit = () => {
    setEditForm({ ...shopInfo });
    setIsEditingShopInfo(false);
  };

  // editForm.category는 buildShopCategoryValue()가 만든 문자열을 그대로 저장/전송한다.
  // 체크 버튼을 그리거나 토글할 때만 parseShopCategoryValue()로 풀어서 쓴다.
  const { majors: selectedShopCategories, subsByMajor: selectedShopSubcategories, custom: shopCategoryCustomText } =
    parseShopCategoryValue(editForm.category);

  const toggleShopCategory = (category: string) => {
    setEditForm((prev) => {
      const { majors, subsByMajor, custom } = parseShopCategoryValue(prev.category);
      const nextMajors = majors.includes(category) ? majors.filter((c) => c !== category) : [...majors, category];
      const nextSubs = { ...subsByMajor };
      if (!nextMajors.includes(category)) delete nextSubs[category];
      return { ...prev, category: buildShopCategoryValue(nextMajors, nextSubs, custom) };
    });
  };

  const toggleShopSubcategory = (major: string, sub: string) => {
    setEditForm((prev) => {
      const { majors, subsByMajor, custom } = parseShopCategoryValue(prev.category);
      const currentSubs = subsByMajor[major] || [];
      const nextSubs = {
        ...subsByMajor,
        [major]: currentSubs.includes(sub) ? currentSubs.filter((s) => s !== sub) : [...currentSubs, sub],
      };
      return { ...prev, category: buildShopCategoryValue(majors, nextSubs, custom) };
    });
  };

  const handleShopCategoryCustomChange = (text: string) => {
    setEditForm((prev) => {
      const { majors, subsByMajor } = parseShopCategoryValue(prev.category);
      return { ...prev, category: buildShopCategoryValue(majors, subsByMajor, text) };
    });
  };

  // 상품은 실제 상호명(shop_name)으로 붙어 있으므로, 계정 표시 이름이 아니라 점포
  // 상세정보의 상호명(아직 못 불러왔다면 userShopName)으로 매칭한다.
  const effectiveStoreName = shopInfo.storeName || userShopName || initialShopName;
  const merchantProducts = products.filter((p) => p.shopName === effectiveStoreName);

  // 로그인하지 않은 상태에서는 로그인한 것처럼 보이는 가짜 프로필 카드(+ 눌러도 의미
  // 없는 로그아웃 버튼)를 보여주는 대신, 이 탭을 명확한 로그인 진입점으로 쓴다.
  if (!isLoggedIn) {
    return (
      <div className="w-full max-w-[600px] mx-auto content-pt-safe content-pb-safe px-4">
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)] p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-trust-blue flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined text-3xl">account_circle</span>
          </div>
          <div>
            <h2 className="text-base font-extrabold text-on-surface">로그인이 필요합니다</h2>
            <p className="text-xs text-outline mt-1.5 leading-relaxed">
              로그인하면 내 정보 관리, 찜한 상품, AI 스캔 저장목록을 이용할 수 있어요.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenLogin}
            className="w-full py-3 bg-trust-blue hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md transition-colors"
          >
            로그인 / 회원가입
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[600px] mx-auto content-pt-safe content-pb-safe px-4 space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          // Tailwind 유틸리티(fixed/left-1/2/-translate-x-1/2)로 위치를 잡으면 실기기
          // 안드로이드 WebView에서 이따금 적용이 안 돼(정확한 원인 미상 — Tailwind Play
          // CDN 스크립트와 Vite 빌드 CSS가 같이 로드되는 구조라 둘이 충돌하는 것으로
          // 추정) 토스트가 fixed 없이 그냥 본문 맨 위 좌측에 눌러앉은 것처럼 보였다.
          // 위치만큼은 클래스에 기대지 않고 인라인 style로 강제해서 파이프라인과
          // 무관하게 항상 적용되게 한다.
          style={{
            position: "fixed",
            top: "calc(5.5rem + env(safe-area-inset-top, 0px))",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
          }}
          className="bg-[#0F172A] text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-xl flex items-center gap-2 border border-slate-700 animate-in fade-in zoom-in duration-200"
        >
          <span className="material-symbols-outlined text-base text-emerald-400">check_circle</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 상인/소비자 둘 다 같은 사진 업로드 입력을 공유한다 — 역할별 헤더 카드에서 ref로 연다. */}
      <input
        type="file"
        ref={profileFileInputRef}
        accept="image/*"
        onChange={handleProfileImageUpload}
        className="hidden"
      />

      {/* Profile & Store Management Header Card */}
      {userRole === "merchant" ? (
        <section className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-[0_1px_3px_rgba(0,0,0,0.05)] text-[#0F172A] relative overflow-hidden space-y-4">
          <div className="flex items-center justify-between gap-3.5">
            <div className="flex items-center gap-3.5 min-w-0">
              {/* 소비자 쪽과 같은 방식(사진 직접 업로드)으로 맞췄다 — 사진이 없을 때만
                  기존 아이콘/색상 커스터마이즈가 자리를 대신 채운다. */}
              <div className="relative group shrink-0">
                <div
                  className="w-14 h-14 rounded-2xl overflow-hidden shadow-md relative cursor-pointer transition-transform group-hover:scale-105"
                  onClick={() => profileFileInputRef.current?.click()}
                  title="클릭하여 프로필 사진 선택"
                >
                  {profileImage ? (
                    <img src={profileImage} alt="프로필 사진" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-400">
                      <span className="material-symbols-outlined text-3xl">storefront</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                    <span className="material-symbols-outlined text-lg">add_a_photo</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => profileFileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 w-5 h-5 bg-[#0052FF] text-white border-2 border-white rounded-full flex items-center justify-center shadow-xs cursor-pointer hover:bg-blue-700 transition-colors"
                  title="사진 추가"
                >
                  <span className="material-symbols-outlined text-[11px]">add_a_photo</span>
                </button>

                {profileImage && (
                  <button
                    type="button"
                    onClick={handleRemoveProfileImage}
                    className="absolute -bottom-1 -left-1 w-5 h-5 bg-white border border-rose-200 rounded-full flex items-center justify-center text-rose-500 shadow-xs cursor-pointer hover:bg-rose-50"
                    title="사진 삭제"
                  >
                    <span className="material-symbols-outlined text-[11px]">close</span>
                  </button>
                )}
              </div>
              {/* 계정 표시 이름만 보여준다 — 상호명은 아래 "점포 상세 정보" 카드에서 따로 관리한다 */}
              <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg font-semibold text-[#0F172A] truncate">{initialShopName}</h2>
              </div>
            </div>

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="text-[11px] font-bold text-slate-500 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 px-2 py-1 rounded-lg transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                title="로그아웃"
              >
                <span className="material-symbols-outlined text-xs">logout</span>
                <span>로그아웃</span>
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="bg-surface-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-[#E2E8F0] p-4 flex items-center gap-4">
          {/* User Profile Avatar with Direct Photo Selection */}
          <div className="relative group shrink-0">
            <div
              className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-slate-200 shadow-xs bg-slate-100 relative cursor-pointer group-hover:border-[#0052FF] transition-all flex items-center justify-center"
              onClick={() => profileFileInputRef.current?.click()}
              title="클릭하여 원하는 프로필 사진 선택"
            >
              {profileImage ? (
                <img
                  src={profileImage}
                  alt="프로필 사진"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-400">
                  <span className="material-symbols-outlined text-4xl">account_circle</span>
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-xl">add_a_photo</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => profileFileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#0052FF] text-white border-2 border-white rounded-full flex items-center justify-center shadow-xs cursor-pointer hover:bg-blue-700 transition-colors"
              title="원하는 사진 추가"
            >
              <span className="material-symbols-outlined text-[13px]">add_a_photo</span>
            </button>

            {profileImage && (
              <button
                type="button"
                onClick={handleRemoveProfileImage}
                className="absolute -bottom-1 -left-1 w-6 h-6 bg-white border border-rose-200 rounded-full flex items-center justify-center text-rose-500 shadow-xs cursor-pointer hover:bg-rose-50"
                title="사진 삭제"
              >
                <span className="material-symbols-outlined text-[13px]">close</span>
              </button>
            )}
          </div>

          {/* Profile Name & Editable Nickname */}
          <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
            {/* Editable Nickname Container */}
            <div className="flex-1 min-w-0 flex items-center h-8">
              {isEditingCustomerNickname ? (
                <input
                  type="text"
                  value={customerNicknameInput}
                  onChange={(e) => setCustomerNicknameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSaveCustomerNickname();
                    } else if (e.key === "Escape") {
                      setIsEditingCustomerNickname(false);
                    }
                  }}
                  onBlur={handleSaveCustomerNickname}
                  placeholder="닉네임 입력"
                  className="text-base font-extrabold text-slate-900 border-b-2 border-[#0052FF] bg-transparent focus:outline-none w-full max-w-[160px] py-0.5 leading-none"
                  autoFocus
                />
              ) : (
                <div
                  onClick={() => {
                    setCustomerNicknameInput(customerNickname);
                    setIsEditingCustomerNickname(true);
                  }}
                  className="flex items-center gap-1.5 cursor-pointer group/nick max-w-full"
                  title="닉네임 클릭하여 수정"
                >
                  <h2 className="text-base font-extrabold text-slate-900 group-hover/nick:text-[#0052FF] transition-colors truncate leading-none">
                    {customerNickname}
                  </h2>
                </div>
              )}
            </div>

            {/* Logout Button */}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="text-xs font-bold text-slate-600 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                title="로그아웃"
              >
                <span className="material-symbols-outlined text-sm">logout</span>
                <span>로그아웃</span>
              </button>
            )}
          </div>
        </section>
      )}

      {/* Personal Information Edit Section */}
      <section className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-[#E2E8F0] p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                userRole === "merchant"
                  ? "bg-emerald-50 border border-emerald-100 text-emerald-600"
                  : "bg-blue-50 border border-blue-100 text-[#0052FF]"
              }`}
            >
              <span className="material-symbols-outlined text-lg">manage_accounts</span>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">계정 정보</h3>
            </div>
          </div>
          {!isEditingPersonalInfo && (
            <button
              type="button"
              onClick={() => {
                if (!isLoggedIn) {
                  onOpenLogin?.();
                  return;
                }
                setIsEditingPersonalInfo(true);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer shrink-0 ${
                userRole === "merchant"
                  ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-700"
              }`}
            >
              <span className="material-symbols-outlined text-sm">edit</span>
              <span>정보 수정</span>
            </button>
          )}
        </div>

        {isEditingPersonalInfo ? (
          <form onSubmit={handleSavePersonalInfo} className="space-y-3.5 pt-1">
            {/* ID Field (Read-only) */}
            <div className="space-y-1">
              <label className="text-xs font-extrabold text-slate-700 block">아이디 (수정 불가)</label>
              <input
                type="text"
                value={userUsername}
                disabled
                className="w-full px-3 py-2 text-xs font-bold bg-slate-100 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed"
              />
            </div>

            {/* Name Field */}
            <div className="space-y-1">
              <label className="text-xs font-extrabold text-slate-700 block">이름</label>
              <input
                type="text"
                value={personalInfo.userName}
                onChange={(e) => setPersonalInfo({ ...personalInfo, userName: e.target.value })}
                placeholder="이름 입력"
                className={`w-full px-3 py-2 text-xs font-bold bg-white border border-slate-300 rounded-xl focus:outline-none text-slate-900 ${
                  userRole === "merchant" ? "focus:border-emerald-500" : "focus:border-[#0052FF]"
                }`}
              />
            </div>

            {/* Phone Number Field */}
            <div className="space-y-1">
              <label className="text-xs font-extrabold text-slate-700 block">휴대폰 번호</label>
              <input
                type="tel"
                inputMode="numeric"
                value={personalInfo.userPhone}
                onChange={(e) =>
                  setPersonalInfo({ ...personalInfo, userPhone: formatPhoneAsYouType(e.target.value) })
                }
                placeholder="010-0000-0000"
                className={`w-full px-3 py-2 text-xs font-bold bg-white border border-slate-300 rounded-xl focus:outline-none text-slate-900 ${
                  userRole === "merchant" ? "focus:border-emerald-500" : "focus:border-[#0052FF]"
                }`}
              />
            </div>

            {/* Password Field */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <label className="text-xs font-extrabold text-slate-700 block">비밀번호 변경 (선택)</label>
              <input
                type="password"
                value={personalInfo.currentPw}
                onChange={(e) => setPersonalInfo({ ...personalInfo, currentPw: e.target.value })}
                placeholder="현재 비밀번호 (변경 시 필수)"
                className={`w-full px-3 py-2 text-xs font-bold bg-white border border-slate-300 rounded-xl focus:outline-none text-slate-900 ${
                  userRole === "merchant" ? "focus:border-emerald-500" : "focus:border-[#0052FF]"
                }`}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="password"
                  value={personalInfo.newPw}
                  onChange={(e) => setPersonalInfo({ ...personalInfo, newPw: e.target.value })}
                  placeholder="새 비밀번호"
                  className={`w-full px-3 py-2 text-xs font-bold bg-white border border-slate-300 rounded-xl focus:outline-none text-slate-900 ${
                    userRole === "merchant" ? "focus:border-emerald-500" : "focus:border-[#0052FF]"
                  }`}
                />
                <input
                  type="password"
                  value={personalInfo.confirmPw}
                  onChange={(e) => setPersonalInfo({ ...personalInfo, confirmPw: e.target.value })}
                  placeholder="새 비밀번호 확인"
                  className={`w-full px-3 py-2 text-xs font-bold bg-white border border-slate-300 rounded-xl focus:outline-none text-slate-900 ${
                    userRole === "merchant" ? "focus:border-emerald-500" : "focus:border-[#0052FF]"
                  }`}
                />
              </div>
            </div>

            {/* Save / Cancel Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsEditingPersonalInfo(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={isSavingPersonalInfo}
                className={`px-4 py-2 rounded-xl text-white text-xs font-bold shadow-xs transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-60 ${
                  userRole === "merchant"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-[#0052FF] hover:bg-blue-700"
                }`}
              >
                <span className="material-symbols-outlined text-sm">check</span>
                <span>{isSavingPersonalInfo ? "저장 중..." : "저장하기"}</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-100">
              <div>
                <span className="text-slate-400 font-bold block text-[10px]">아이디</span>
                <span className="font-extrabold text-slate-800">{userUsername}</span>
              </div>
              <div>
                <span className="text-slate-400 font-bold block text-[10px]">이름</span>
                <span className="font-extrabold text-slate-800">{personalInfo.userName}</span>
              </div>
              <div>
                <span className="text-slate-400 font-bold block text-[10px]">휴대폰 번호</span>
                <span className="font-extrabold text-slate-800">{formatPhoneNumber(personalInfo.userPhone)}</span>
              </div>
              <div>
                <span className="text-slate-400 font-bold block text-[10px]">비밀번호</span>
                <span className="font-extrabold text-slate-800">••••••••</span>
              </div>
            </div>
          </div>
        )}
      </section>



      {/* Editable Merchant Store Details */}
      {userRole === "merchant" && (
        <section className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-[#F1F5F9]">
            <h3 className="text-sm font-extrabold text-[#0F172A] uppercase tracking-wider">
              점포 상세 정보
            </h3>
            {!isEditingShopInfo ? (
              <button
                onClick={handleStartEdit}
                className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-extrabold transition-colors flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
                <span>정보 수정</span>
              </button>
            ) : (
              <span className="text-[11px] font-extrabold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                수정 모드
              </span>
            )}
          </div>

          {/* 소속 전통시장 선택 — 예전엔 회원가입 때 받았는데, 가입 절차를 짧게 하려고
              로그인 후 여기서 처음 점포 정보를 채우려 할 때 고르게 바꿨다. 시장을 알아야
              지도 썸네일/위치 등록이 어느 시장 기준으로 뜰지 정해진다. */}
          {/* hasStoreProfile === false로 명확히 확인된 뒤에만 선택 카드를 보여준다 — 이미
              점포가 있는 예전 계정(시장 선택 기능이 생기기 전에 가입)은 market_id가 비어
              있어도 여기 안 걸리게 해서, 실수로 다시 시장을 고르라고 하지 않는다. */}
          {!userMarketId && hasStoreProfile === false ? (
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-emerald-600 text-lg shrink-0">storefront</span>
                <p className="text-xs text-emerald-800 font-bold leading-relaxed">
                  점포 위치와 상세정보를 등록하려면 먼저 소속 전통시장을 선택해주세요.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={pendingRegion}
                  onChange={(e) => {
                    const region = e.target.value;
                    setPendingRegion(region);
                    const firstInRegion = MARKETS_DATA.find((m) => m.region === region);
                    setPendingMarketId(firstInRegion?.id || "custom");
                  }}
                  className="w-full px-3 py-2.5 rounded-xl border border-emerald-300 bg-white text-xs font-semibold"
                >
                  {MERCHANT_REGIONS.map((region) => (
                    <option key={region} value={region}>
                      {region}
                    </option>
                  ))}
                </select>
                <select
                  value={pendingMarketId}
                  onChange={(e) => setPendingMarketId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-emerald-300 bg-white text-xs font-semibold"
                >
                  {marketsInPendingRegion.map((market) => (
                    <option key={market.id} value={market.id}>
                      {market.name}
                    </option>
                  ))}
                  <option value="custom">목록에 없음 (직접 입력)</option>
                </select>
              </div>
              {pendingMarketId === "custom" && (
                <input
                  type="text"
                  value={pendingCustomName}
                  onChange={(e) => setPendingCustomName(e.target.value)}
                  placeholder="시장 이름을 입력해주세요 (예: OO전통시장)"
                  className="w-full px-3 py-2.5 rounded-xl border border-emerald-300 bg-white text-xs font-semibold"
                />
              )}
              <button
                type="button"
                onClick={handleConfirmMarket}
                disabled={isSavingMarket}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold shadow-md transition-all cursor-pointer"
              >
                {isSavingMarket ? "저장 중..." : "선택 완료"}
              </button>
            </div>
          ) : (
            <>
              {/* 점포 위치 등록 — 지도의 실제 점포와 이름이 정확히 일치할 때만 상품이 지도에
                  뜨던 문제 때문에, 상인이 직접 자기 위치에 핀을 찍어 등록할 수 있게 한다.
                  전화번호/영업시간과 같은 곳에서 관리하도록 이 카드 안에 같이 둔다. 텍스트
                  박스 대신 실제 지도 썸네일로 보여줘서 글씨를 안 읽어도 바로 확인되게 한다.
                  이미 점포가 있으면 평소엔 안 보여주고 "정보 수정"을 눌렀을 때만 뜨게 한다
                  (읽기 전용 화면에 지도 편집 버튼이 계속 떠 있는 게 불필요했음) — 다만
                  아직 점포가 없는 신규 계정은 이게 유일한 최초 등록 경로라서(handleStartEdit이
                  hasStoreProfile===false면 수정 모드 진입 자체를 막음) 그 경우는 예외로
                  계속 보여준다. */}
              {(isEditingShopInfo || hasStoreProfile === false) && (
                <StoreLocationThumbnail onEdit={() => setIsLocationPickerOpen(true)} refreshKey={locationVersion} />
              )}

              {hasStoreProfile === false && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                  <span className="material-symbols-outlined text-amber-600 text-lg shrink-0">info</span>
                  <p className="text-[11px] text-amber-800 font-medium leading-relaxed">
                    점포 상세정보를 저장하려면 먼저 위쪽의 "점포 위치 등록"으로 지도에 점포를 등록해주세요.
                    위치가 등록돼야 이 정보도 저장할 수 있어요.
                  </p>
                </div>
              )}
            </>
          )}

          {/* 소속 전통시장 선택 카드가 떠 있는 동안만(=userMarketId 없고 hasStoreProfile이
              명확히 false) 이 요약/수정 폼을 숨긴다 — "미등록" 천지인 화면이 같이 뜨는 걸
              막기 위함이었는데, 처음엔 이 조건을 userMarketId만으로 판단해서 이미 점포가
              있는 예전 계정(market_id는 비어있지만 hasStoreProfile은 true)까지 같이 숨어
              버리는 버그가 있었다 — 위 시장 선택 카드와 정확히 반대 조건으로 맞춘다. */}
          {(userMarketId || hasStoreProfile !== false) && (!isEditingShopInfo ? (
            /* View Mode */
            <div className="space-y-3">
              <div className="space-y-2 text-xs divide-y divide-[#F1F5F9]">
                <div className="flex justify-between py-1.5">
                  <span className="text-[#0F172A] font-medium">상호명</span>
                  <span className="font-bold text-[#0F172A]">{shopInfo.storeName}</span>
                </div>
                <div className="flex justify-between py-1.5 gap-3">
                  <span className="text-[#0F172A] font-medium shrink-0">위치</span>
                  <span className="font-bold text-[#334155] text-right truncate">
                    {shopInfo.address || "지도에 핀을 찍으면 자동으로 채워져요"}
                  </span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-[#0F172A] font-medium">소속 전통시장</span>
                  <span className="font-bold text-emerald-600">
                    {shopInfo.marketName || (hasStoreProfile ? "광주 양동시장" : "미선택")}
                  </span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-[#0F172A] font-medium">전화번호</span>
                  <span className="font-bold text-[#334155]">{shopInfo.phone || "미등록"}</span>
                </div>
                <div className="flex justify-between py-1.5 gap-3">
                  <span className="text-[#0F172A] font-medium shrink-0">영업시간</span>
                  <span className="font-bold text-[#334155] text-right">{shopInfo.hours || "미등록"}</span>
                </div>
                <div className="py-1.5">
                  {/* 값이 짧으면(한 줄에 다 들어가면) 화살표 없이 다른 행들처럼 평범하게
                      보여준다 — 안 그러면 접었다 펼 것도 없는데 화살표만 붙어서 어색하다. */}
                  {shopInfo.category.length > 14 ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#0F172A] font-medium shrink-0">주요 품목</span>
                      <button
                        type="button"
                        onClick={() => setIsShopCategoryExpanded((v) => !v)}
                        className="flex items-center gap-1 min-w-0 cursor-pointer"
                      >
                        <span
                          className={`font-bold text-[#0F172A] text-right ${
                            isShopCategoryExpanded ? "whitespace-normal break-words" : "truncate"
                          }`}
                        >
                          {shopInfo.category}
                        </span>
                        <span className="material-symbols-outlined text-slate-400 text-base shrink-0">
                          {isShopCategoryExpanded ? "expand_less" : "expand_more"}
                        </span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-[#0F172A] font-medium">주요 품목</span>
                      <span className="font-bold text-[#0F172A]">{shopInfo.category || "미등록"}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Shop Description Box */}
              <div className="bg-[#F8FAFC] rounded-xl p-3 border border-[#E2E8F0] space-y-1 mt-2">
                <span className="text-[11px] font-bold text-[#64748B] block">점포 한줄 안내 / 소개</span>
                <p className="text-xs text-[#334155] leading-relaxed font-medium">
                  {shopInfo.description || "등록된 점포 소개글이 없습니다."}
                </p>
              </div>
            </div>
          ) : (
            /* Edit Form Mode */
            <form onSubmit={handleSaveEdit} className="space-y-3.5 text-xs">
              {/* 상호명은 계정 표시 이름과 별개인 점포 이름이라, 여기 점포 상세정보 폼에서
                  직접 고친다 — 저장 시 상인 매칭 키(shop_name)도 같이 옮겨준다. */}
              <div className="space-y-1">
                <label className="font-bold text-[#334155] block">상호명</label>
                <input
                  type="text"
                  value={editForm.storeName}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, storeName: e.target.value }))}
                  placeholder="예: 양동수산"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-500 text-xs font-semibold"
                />
              </div>

              {/* 위치(도로명 주소) — 이 폼에서 직접 고치는 값이 아니라 "지도 수정"에서
                  핀을 찍으면 자동으로 채워지는 값이라, 여기서는 참고용으로 읽기 전용
                  회색 박스로만 보여준다. */}
              <div className="space-y-1">
                <label className="font-bold text-[#334155] block">위치</label>
                <p className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-500">
                  {shopInfo.address || "지도에 핀을 찍으면 자동으로 채워져요"}
                </p>
              </div>

              {/* 소속 전통시장 — 이미 골랐으면 기본은 읽기 전용으로 보여주고 "변경"을
                  눌러야 선택 폼이 펼쳐진다. 시장을 바꾸면 백엔드(set_merchant_market)가
                  기존 점포/상품의 market_id도 같이 새 시장으로 옮겨준다 — 예전엔 이
                  마이그레이션이 없어서 재설정 자체를 막았었는데, 실제로 시장을 옮기거나
                  잘못 고른 걸 고치고 싶은 경우가 있어서 데이터를 같이 옮기는 쪽으로 바꿨다. */}
              <div className="space-y-1.5">
                <label className="font-bold text-[#334155] block">소속 전통시장</label>
                {userMarketId && !isChangingMarket ? (
                  <div className="flex items-center gap-2">
                    <p className="flex-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-emerald-700">
                      {shopInfo.marketName || "광주 양동시장"}
                    </p>
                    <button
                      type="button"
                      onClick={() => setIsChangingMarket(true)}
                      className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-50 shrink-0 cursor-pointer"
                    >
                      변경
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 bg-emerald-50/70 border border-emerald-200 rounded-xl p-3">
                    {userMarketId && (
                      <p className="text-[11px] text-amber-700 font-bold leading-relaxed flex items-start gap-1">
                        <span className="material-symbols-outlined text-sm shrink-0">warning</span>
                        시장을 바꾸면 등록된 점포/상품이 새 시장 기준으로 옮겨집니다.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={pendingRegion}
                        onChange={(e) => {
                          const region = e.target.value;
                          setPendingRegion(region);
                          const firstInRegion = MARKETS_DATA.find((m) => m.region === region);
                          setPendingMarketId(firstInRegion?.id || "custom");
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-emerald-300 bg-white text-xs font-semibold"
                      >
                        {MERCHANT_REGIONS.map((region) => (
                          <option key={region} value={region}>
                            {region}
                          </option>
                        ))}
                      </select>
                      <select
                        value={pendingMarketId}
                        onChange={(e) => setPendingMarketId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-emerald-300 bg-white text-xs font-semibold"
                      >
                        {marketsInPendingRegion.map((market) => (
                          <option key={market.id} value={market.id}>
                            {market.name}
                          </option>
                        ))}
                        <option value="custom">목록에 없음 (직접 입력)</option>
                      </select>
                    </div>
                    {pendingMarketId === "custom" && (
                      <input
                        type="text"
                        value={pendingCustomName}
                        onChange={(e) => setPendingCustomName(e.target.value)}
                        placeholder="시장 이름을 입력해주세요 (예: OO전통시장)"
                        className="w-full px-3 py-2 rounded-xl border border-emerald-300 bg-white text-xs font-semibold"
                      />
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleConfirmMarket}
                        disabled={isSavingMarket}
                        className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold transition-all cursor-pointer"
                      >
                        {isSavingMarket ? "저장 중..." : userMarketId ? "변경 완료" : "소속 전통시장 설정"}
                      </button>
                      {userMarketId && (
                        <button
                          type="button"
                          onClick={() => setIsChangingMarket(false)}
                          className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                        >
                          취소
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 전화번호 — 숫자만 쳐도 자동으로 하이픈이 붙고, 모바일에서 숫자 키패드가 뜬다 */}
              <div className="space-y-1">
                <label className="font-bold text-[#334155] block">전화번호</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={editForm.phone}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, phone: formatPhoneAsYouType(e.target.value) }))}
                  placeholder="062-365-1234"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-500 text-xs font-semibold"
                />
              </div>

              {/* 영업시간 — 시장 상인은 대부분 요일 구분 없이 매일 같은 시간에 열고 특정
                  요일에만 쉬므로, 기본은 "매일 동일" 체크 + 시작/종료 시간 2개 + 정기휴무일
                  드롭다운으로 끝나는 초간단 모드다. 체크를 풀면 요일별로 다르게 여는 예외
                  케이스용 자유 텍스트로 바뀐다. 네이티브 타임 피커라 "HH:MM" 형식이 강제돼서
                  나중에 "지금 영업 중" 필터도 이 값 그대로 쓸 수 있다. */}
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setIsEditHoursOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 cursor-pointer"
                >
                  <span className="font-bold text-[#334155]">영업시간</span>
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="text-[11px] font-bold text-slate-500 truncate">
                      {editForm.hours || "미등록"}
                    </span>
                    <span className="material-symbols-outlined text-slate-400 text-base shrink-0">
                      {isEditHoursOpen ? "expand_less" : "expand_more"}
                    </span>
                  </span>
                </button>
                {isEditHoursOpen && (
                <>
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isHoursDailyMode}
                    onChange={() => setIsHoursDailyMode((v) => !v)}
                    className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer"
                  />
                  매일 동일하게 영업
                </label>

                {isHoursDailyMode ? (
                  <>
                    <div className="flex items-center gap-2">
                      <select
                        value={parseShopHoursValue(editForm.hours).start}
                        onChange={(e) => {
                          const { end } = parseShopHoursValue(editForm.hours);
                          const note = hoursClosedDayMode === "직접입력" ? parseShopHoursValue(editForm.hours).note : hoursClosedDayMode;
                          setEditForm((prev) => ({ ...prev, hours: buildShopHoursValue(e.target.value, end, note) }));
                        }}
                        className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-500 text-xs font-semibold bg-white"
                      >
                        <option value="">시작 시간</option>
                        {HOURS_TIME_PRESETS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <span className="text-slate-400 font-bold shrink-0">~</span>
                      <select
                        value={parseShopHoursValue(editForm.hours).end}
                        onChange={(e) => {
                          const { start } = parseShopHoursValue(editForm.hours);
                          const note = hoursClosedDayMode === "직접입력" ? parseShopHoursValue(editForm.hours).note : hoursClosedDayMode;
                          setEditForm((prev) => ({ ...prev, hours: buildShopHoursValue(start, e.target.value, note) }));
                        }}
                        className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-500 text-xs font-semibold bg-white"
                      >
                        <option value="">종료 시간</option>
                        {HOURS_TIME_PRESETS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1 pt-1">
                      <label className="text-[11px] font-bold text-slate-500 block">정기 휴무일</label>
                      <select
                        value={hoursClosedDayMode}
                        onChange={(e) => {
                          const mode = e.target.value;
                          setHoursClosedDayMode(mode);
                          const { start, end } = parseShopHoursValue(editForm.hours);
                          setEditForm((prev) => ({
                            ...prev,
                            hours: buildShopHoursValue(start, end, mode === "직접입력" ? "" : mode),
                          }));
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-500 text-xs font-semibold bg-white"
                      >
                        {HOURS_CLOSED_DAY_PRESETS.map((preset) => (
                          <option key={preset} value={preset}>
                            {preset}
                          </option>
                        ))}
                        <option value="직접입력">직접 입력</option>
                      </select>
                      {hoursClosedDayMode === "직접입력" && (
                        <input
                          type="text"
                          value={parseShopHoursValue(editForm.hours).note}
                          onChange={(e) => {
                            const { start, end } = parseShopHoursValue(editForm.hours);
                            setEditForm((prev) => ({ ...prev, hours: buildShopHoursValue(start, end, e.target.value) }));
                          }}
                          placeholder="예: 매달 둘째 주 월요일 휴무"
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-500 text-xs font-semibold"
                        />
                      )}
                    </div>
                  </>
                ) : (
                  <input
                    type="text"
                    value={editForm.hours}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, hours: e.target.value }))}
                    placeholder="예: 평일 09:00-18:00, 주말 10:00-17:00"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-500 text-xs font-semibold"
                  />
                )}
                </>
                )}
              </div>

              {/* 주요 품목 — 세부 품목 체크박스까지 펼치면 세로로 길어져서, 기본은 접어두고
                  헤더에 지금 고른 값 요약만 보여준다. 타이핑 대신 소비자 홈 피드와 같은
                  5개 카테고리를 체크 버튼으로 고른다. */}
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setIsEditCategoryOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 cursor-pointer"
                >
                  <span className="font-bold text-[#334155]">주요 품목</span>
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="text-[11px] font-bold text-slate-500 truncate">
                      {selectedShopCategories.length > 0 ? selectedShopCategories.join(", ") : "미선택"}
                    </span>
                    <span className="material-symbols-outlined text-slate-400 text-base shrink-0">
                      {isEditCategoryOpen ? "expand_less" : "expand_more"}
                    </span>
                  </span>
                </button>
                {isEditCategoryOpen && (
                <>
                <div className="flex flex-wrap gap-2">
                  {SHOP_CATEGORY_OPTIONS.map((cat) => {
                    const selected = selectedShopCategories.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleShopCategory(cat)}
                        className={`px-4 py-2.5 rounded-xl border text-sm font-bold transition-colors flex items-center gap-1 cursor-pointer ${
                          selected
                            ? "bg-emerald-600 border-emerald-600 text-white"
                            : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {selected && <span className="material-symbols-outlined text-base leading-none">check</span>}
                        {cat}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-400">파는 품목을 모두 눌러서 골라주세요. 여러 개 선택할 수 있어요.</p>

                {/* 대분류를 고르면 그 밑에 세부 품목(중분류)이 펼쳐진다 */}
                {selectedShopCategories.length > 0 && (
                  <div className="space-y-2.5 pl-3 border-l-2 border-emerald-100 mt-1">
                    {selectedShopCategories.map((major) => (
                      <div key={major} className="space-y-1">
                        <span className="text-[11px] font-bold text-slate-500">{major} 세부 품목 (선택)</span>
                        <div className="flex flex-wrap gap-1.5">
                          {(SHOP_SUBCATEGORY_OPTIONS[major] || []).map((sub) => {
                            const on = (selectedShopSubcategories[major] || []).includes(sub);
                            return (
                              <button
                                key={sub}
                                type="button"
                                onClick={() => toggleShopSubcategory(major, sub)}
                                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer ${
                                  on
                                    ? "bg-emerald-500 border-emerald-500 text-white"
                                    : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                                }`}
                              >
                                {on && <span className="material-symbols-outlined text-sm leading-none">check</span>}
                                {sub}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 목록에 없는 품목은 여기에만 짧게 직접 입력 */}
                <div className="space-y-1 pt-1">
                  <label className="font-bold text-[#334155] block text-[11px]">목록에 없는 품목 직접 입력 (선택)</label>
                  <input
                    type="text"
                    value={shopCategoryCustomText}
                    onChange={(e) => handleShopCategoryCustomChange(e.target.value)}
                    placeholder={
                      SHOP_CUSTOM_ITEM_PLACEHOLDER[selectedShopCategories[0]] || SHOP_CUSTOM_ITEM_PLACEHOLDER_DEFAULT
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-500 text-xs font-semibold"
                  />
                </div>
                </>
                )}
              </div>

              {/* 점포 한줄 안내 / 소개 */}
              <div className="space-y-1">
                <label className="font-bold text-[#334155] block">점포 한줄 안내 / 소개</label>
                <textarea
                  rows={2}
                  value={editForm.description}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="고객에게 안내할 점포 관련 인사말 및 특징을 적어주세요."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:border-emerald-500 text-xs font-semibold resize-none"
                />
              </div>

              {/* Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="w-full py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSavingShopInfo}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">check</span>
                  <span>{isSavingShopInfo ? "저장 중..." : "저장 완료"}</span>
                </button>
              </div>
            </form>
          ))}
        </section>
      )}

      {/* Store Location Picker Modal */}
      {userRole === "merchant" && (
        <StoreLocationPicker
          isOpen={isLocationPickerOpen}
          onClose={() => setIsLocationPickerOpen(false)}
          marketName={marketName}
          onSaved={() => {
            refreshStoreProfile();
            setLocationVersion((v) => v + 1);
            showToast("점포 위치가 지도에 등록되었습니다!");
          }}
        />
      )}
    </div>
  );
};
