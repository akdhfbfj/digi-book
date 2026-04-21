import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getFirestore,
    collection,
    addDoc,
    onSnapshot,
    doc,
    updateDoc,
    arrayUnion,
    arrayRemove,
    getDoc,
    setDoc,
    deleteDoc,
    getDocs,
    query,
    where,
    limit,
    writeBatch,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDOEDyzO5kYY-OCmqJZrUU1rfenP8Kz8tM",
    authDomain: "opoproject-c291b.firebaseapp.com",
    projectId: "opoproject-c291b",
    storageBucket: "opoproject-c291b.firebasestorage.app",
    messagingSenderId: "792551343830",
    appId: "1:792551343830:web:b3e10df0bf4b92c4c4eb77",
    measurementId: "G-K1TD0BB954",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const appId = "opo-digital-bookroad-v5";
/** 우체통 전용 (기존 secrets 컬렉션은 사용하지 않음) */
const MAILBOX_SUBCOL = "mailbox";

/**
 * 알라딘 TTB Open API (ItemSearch)
 * 브라우저에서는 CORS 제한으로 fetch 대신 Callback JSONP를 사용합니다.
 * TTB 키는 index.html이 먼저 불러오는 aladin.config.local.js 의 window.__ALADIN_TTB_KEY__ 에 둡니다(저장소에 넣지 않음).
 */
const ALADIN_ITEM_SEARCH_URL = "https://www.aladin.co.kr/ttb/api/ItemSearch.aspx";

function getAladinTtbKey() {
    if (typeof window === "undefined") return "";
    const k = window.__ALADIN_TTB_KEY__;
    return typeof k === "string" ? k.trim() : "";
}

function buildAladinItemSearchScriptUrl(searchWord, callbackName) {
    const params = new URLSearchParams({
        ttbkey: getAladinTtbKey(),
        Query: searchWord.trim(),
        // Title 은 제목 일치에 가깝게 동작해 빈 결과가 잦음 → Keyword 가 학생 검색에 맞음
        QueryType: "Keyword",
        MaxResults: "10",
        start: "1",
        SearchTarget: "Book",
        output: "js",
        Cover: "MidBig",
        CallBack: callbackName,
    });
    // Version=20131101 을 넣으면 Callback 이 있어도 JSON만 내려와 <script> 실행이 깨짐 → JSONP용 요청에서는 생략
    return `${ALADIN_ITEM_SEARCH_URL}?${params.toString()}`;
}

function normalizeAladinItemList(payload) {
    if (!payload || typeof payload !== "object") return [];
    const raw = payload.item ?? payload.Item ?? payload.items ?? payload.Items;
    if (raw == null) return [];
    return Array.isArray(raw) ? raw : [raw];
}

/** @returns {Promise<object[]>} */
function aladinItemSearchJsonp(query) {
    const q = (query || "").trim();
    if (!q) return Promise.reject(new Error("검색어를 입력해 주세요."));
    if (!getAladinTtbKey())
        return Promise.reject(
            new Error(
                "알라딘 키가 비어 있어요.\n\n[로컬] aladin.config.local.js 한 줄: window.__ALADIN_TTB_KEY__ = \"TTB키\";\n[Vercel] Environment Variables → ALADIN_TTB_KEY → 재배포 후 /api/aladin-config 에 키가 보이는지 확인"
            )
        );
    return new Promise((resolve, reject) => {
        // 알라딘은 Callback 이름이 특정 형태일 때 JSON만 주고 JSONP 래핑을 안 함(앞에 __ 두 개면 JSON만 옴 → 스크립트 로드 실패).
        const cbName = `aladinTtbCb_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const script = document.createElement("script");
        let settled = false;

        const cleanup = () => {
            delete window[cbName];
            if (script.parentNode) script.parentNode.removeChild(script);
        };

        const done = (err, items) => {
            if (settled) return;
            settled = true;
            clearTimeout(tid);
            cleanup();
            if (err) reject(err);
            else resolve(items);
        };

        const tid = setTimeout(() => done(new Error("알라딘 검색 시간이 초과되었어요.")), 15000);

        window[cbName] = (ok, data) => {
            // TTB: 실패는 보통 (false, { errorCode, errorMessage }). 성공은 (true, payload).
            // !ok 로 보면 ok 가 0 인 경우 등에서 오판할 수 있어 false 만 실패로 처리.
            if (arguments.length === 1) {
                const payload = ok;
                if (payload && typeof payload.errorCode === "number" && payload.errorCode !== 0) {
                    return done(new Error(payload.errorMessage || "알라딘 API 오류"));
                }
                return done(null, normalizeAladinItemList(payload));
            }
            if (ok === false) {
                const detail = (data && data.errorMessage) || "";
                const hint =
                    "알라딘 검색에 실패했어요. TTB 키 관리(알라딘 오픈API)에서 웹 사용 도메인에 배포 주소(예: opobook53.vercel.app)를 넣었는지 확인해 주세요. 로컬(127.0.0.1)만 허용된 키는 배포 사이트에서 막힐 수 있어요.";
                return done(new Error(detail || hint));
            }
            const payload = data != null ? data : ok;
            if (payload && typeof payload === "object" && typeof payload.errorCode === "number" && payload.errorCode !== 0) {
                return done(new Error(payload.errorMessage || "알라딘 API 오류"));
            }
            done(null, normalizeAladinItemList(payload));
        };

        script.onerror = () => done(new Error("알라딘 서버에 연결하지 못했어요."));
        script.src = buildAladinItemSearchScriptUrl(q, cbName);
        document.body.appendChild(script);
    });
}

const { useState, useEffect, useMemo } = React;

const KDC_LABELS = {
    "000": "📂 000 총류",
    "100": "🧠 100 철학",
    "200": "🙏 200 종교",
    "300": "🤝 300 사회과학",
    "400": "🌿 400 자연과학",
    "500": "⚙️ 500 기술과학",
    "600": "🎨 600 예술",
    "700": "🗣️ 700 언어",
    "800": "📚 800 문학",
    "900": "🗺️ 900 역사",
};

/** 선생님 미등록 시 날짜마다 하나씩 돌아가는 오늘의 글감 (항상 같은 날 = 같은 문장) */
const WRITING_PROMPTS_FALLBACK = [
    "오늘 하루 중 가장 기억에 남는 순간 한 가지",
    "점심시간에 있었던 일을 누구에게 말해 주고 싶은지 적어 보기",
    "친구에게 고마웠던 말이나 행동이 있었나요?",
    "오늘 배우고 싶었던 것·궁금했던 것",
    "주말에 하고 싶은 것을 상상해 보기",
    "최근에 웃었던 이유 한 가지",
    "학교(학급)에서 좋았던 점 한 가지",
    "날씨와 내 기분을 연결 지어 한 문단 써 보기",
    "좋아하는 책·만화·게임 속 인물에게 편지 쓰기",
    "어른이 되면 해보고 싶은 일",
    "오늘 먹은 것 중 가장 맛있었던 것",
    "집에서 가장 편한 장소와 그 이유",
    "칭찬받고 싶은 나의 모습",
    "실수했을 때 나는 어떻게 했나요?",
    "동물·식물을 한 마디로 표현해 보기",
    "꿈에 나올 법한 이야기 한 줄",
    "시작이 좋았던 하루의 아침",
    "내일의 나에게 해 주고 싶은 말",
    "친구와의 약속이 있다면?",
    "오늘의 나를 날씨에 비유하면",
];

const MOOD_PICKS = [
    { id: "happy", emoji: "😊", label: "기쁨" },
    { id: "calm", emoji: "😌", label: "평온" },
    { id: "excited", emoji: "🤩", label: "신남" },
    { id: "tired", emoji: "😮‍💨", label: "피곤" },
    { id: "sad", emoji: "😢", label: "속상" },
    { id: "angry", emoji: "😠", label: "화남" },
    { id: "proud", emoji: "🌟", label: "뿌듯" },
];

function localDateKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function pickFallbackPromptForDate(dateKey) {
    let h = 0;
    for (let i = 0; i < dateKey.length; i++) h = (h * 31 + dateKey.charCodeAt(i)) >>> 0;
    return WRITING_PROMPTS_FALLBACK[h % WRITING_PROMPTS_FALLBACK.length];
}

/** 관리자 주제 설정용: 초등 5학년 창의·사고 확장 글감 (매일 랜덤 추천) */
const GRADE5_CREATIVE_TOPIC_PROMPTS = [
    "만약 하루 동안 투명인간이 된다면, 가장 먼저 해보고 싶은 일과 그 이유를 써 보세요.",
    "시간 여행이 가능하다면 과거와 미래 중 어디로 가고 싶나요? 무엇을 확인해 보고 싶나요?",
    "우리 학교에 새 규칙을 하나만 만든다면 무엇이 좋을까요? 친구들에게 어떤 점이 좋은지 설득해 보세요.",
    "좋아하는 책·영화 속 캐릭터와 하루를 보낸다면 어떤 하루가 될지 상상해 보세요.",
    "지구가 하루 동안 장난감 크기로 작아진다면, 당신은 무엇부터 할 건가요?",
    "‘용기’가 사람 안에 산다면 어떤 모습일까요? 비유나 이야기로 표현해 보세요.",
    "친구와 다툰 뒤 화해하는 나만의 방법을 단계별로 적어 보세요.",
    "버려지는 물건 하나(예: 빨대, 뚜껑)의 입장에서 하루를 이야기해 보세요.",
    "10년 뒤의 나에게 편지를 쓴다면, 어떤 질문을 하고 싶나요?",
    "소리가 보인다면 어떤 모습일까요? 기쁜 소리·슬픈 소리를 각각 묘사해 보세요.",
    "우리 동네에 필요한 ‘비밀 정원’이 있다면 어디에 있고 무엇이 자라나 있을까요?",
    "동물이 말을 할 수 있다면, 가장 먼저 어떤 동물과 무슨 이야기를 나누고 싶나요?",
    "실수를 해도 괜찮은 이유를 친구에게 위로하듯 써 보세요.",
    "하늘에 떠 있는 구름 한 조각이 되었다면, 어디를 지나가며 무엇을 볼까요?",
    "‘행복’을 만드는 재료 3가지를 떠올리고, 오늘 그중 하나를 경험한 적이 있는지 써 보세요.",
    "무인도에 책 세 권만 가져갈 수 있다면 어떤 책을 고를까요? 이유와 함께 적어 보세요.",
    "학교 급식 메뉴를 하루 동안 당신이 정할 수 있다면 메뉴와 이유를 설계해 보세요.",
    "꿈에서 깨어난 뒤에도 기억에 남았으면 하는 꿈 한 가지와 그 이유를 써 보세요.",
    "어른들이 모르는 ‘우리 세대만의 고민’ 한 가지를 이야기하고, 어떻게 풀고 싶은지 써 보세요.",
    "바닷속 깊은 곳에 도시가 있다면 어떤 건물과 사람(인어?)이 살까요?",
    "오늘 하루를 날씨에 비유한다면 어떤 날씨인가요? 구체적으로 설명해 보세요.",
    "만약 친구의 하루와 몸이 바뀐다면 가장 조심할 점과 가장 재미있을 점은 무엇인가요?",
    "나만의 슈퍼파워를 하나 고른다면 무엇이고, 첫날에 세 가지 규칙을 정한다면?",
    "버려진 우주 정거장에서 살아남기 위해 꼭 챙길 물건 다섯 가지와 이유를 써 보세요.",
    "‘친절’이 전염된다면 세상이 어떻게 바뀔지 단편 소설처럼 짧게 써 보세요.",
    "좋아하는 노래 한 곡의 가사처럼 오늘의 기분을 은유로 써 보세요.",
    "미래의 나는 지금의 나에게 어떤 조언을 해 줄까요? 반대로 지금의 나는 미래의 나에게 무엇을 부탁할까요?",
    "학교에 ‘실수 연습 시간’이 생긴다면 어떤 활동을 하고 싶나요?",
    "식물이 사람의 감정을 느낀다면, 교실 화분은 어떤 이야기를 들었을까요?",
    "세상에서 색이 하나 사라진다면 어떤 색을 지키고 싶나요? 그 색에 담긴 기억도 함께 써 보세요.",
    "거울 속의 나와 진짜 나는 같을까요? 다르다면 어떤 점이 다른지 써 보세요.",
    "봉사활동으로 하루를 보낸다면 어디에서 무엇을 하고 싶나요? 기대와 걱정도 적어 보세요.",
    "전설 속 생물(드래곤, 유니콘 등) 중 하나를 골라 현대 서울에 데려온다면 무슨 일이 벌어질까요?",
    "‘나는 왜 웃었을까?’ 오늘 또는 최근에 웃은 순간을 떠올려 원인과 결과를 써 보세요.",
    "만약 종이에만 그릴 수 있는 세상이라면, 가장 먼저 그리고 싶은 것은?",
    "친구에게 고마웠지만 아직 말하지 못한 일이 있다면 편지 형식으로 써 보세요.",
    "시간이 느리게 가는 방과 빠르게 가는 방이 있다면 각각 어떤 때 들어가고 싶나요?",
    "우주인에게 지구를 소개하는 글을 쓴다면 무엇부터 말하고 싶나요?",
    "내가 만든 발명품 하나(실제로 없어도 됨)의 이름·기능·사람들의 반응을 써 보세요.",
    "하루 동안 모든 질문에 ‘진실만’ 말해야 한다면 가장 무서운 순간과 가장 시원한 순간은?",
    "바다가 숲이 되고 숲이 바다가 된다면, 동물과 사람의 삶이 어떻게 바뀔까요?",
    "‘용서’와 ‘잊기’의 차이를 나만의 예시로 설명해 보세요.",
    "오늘 만약 책 한 권의 주인공이 된다면 어떤 책을 고르고 어떤 장면을 바꾸고 싶나요?",
];

function pickRandomGrade5CreativePrompt() {
    return GRADE5_CREATIVE_TOPIC_PROMPTS[Math.floor(Math.random() * GRADE5_CREATIVE_TOPIC_PROMPTS.length)];
}

function normalizeUser(raw) {
    if (!raw) return null;
    return {
        ...raw,
        homeroomTeacherId: raw.homeroomTeacherId ?? null,
        statusMsg: raw.statusMsg ?? "",
        no: raw.no ?? "",
    };
}

/** 반(학급) 식별자: 담임(관리자) 계정 id — 학생은 배정 전에도 단일 관리자 id로 같은 반 취급 */
function effectiveClassTeacherId(viewer, soleAdminIdFallback) {
    if (!viewer) return null;
    if (viewer.role === "admin") return viewer.id;
    return viewer.homeroomTeacherId || soleAdminIdFallback || null;
}

/** 우리 반 피드: 독서 기록 + 조각에서 「피드에 공유」한 글 */
function feedClassPosts(allPosts, viewer, soleAdminIdFallback) {
    const key = effectiveClassTeacherId(viewer, soleAdminIdFallback);
    if (!key) return [];
    return allPosts
        .filter((p) => p.classTeacherId === key && p.type === "book")
        .sort((a, b) => b.timestamp - a.timestamp);
}

const LIFE_HINT_BLOCK_PREFIX = "🧭 오늘의 힌트\n";

function stripLifeHintBlockFromContent(text) {
    if (!text || !text.startsWith(LIFE_HINT_BLOCK_PREFIX)) return text;
    const after = text.slice(LIFE_HINT_BLOCK_PREFIX.length);
    const sep = after.indexOf("\n\n");
    if (sep === -1) return "";
    return after.slice(sep + 2);
}

function buildLifeHintBlockFromInputs() {
    const when = document.getElementById("life-when")?.value?.trim() || "";
    const where = document.getElementById("life-where")?.value?.trim() || "";
    const who = document.getElementById("life-who")?.value?.trim() || "";
    const what = document.getElementById("life-what")?.value?.trim() || "";
    const how = document.getElementById("life-how")?.value?.trim() || "";
    const feeling = document.getElementById("life-feeling")?.value?.trim() || "";
    const hintLine = [when && `언제: ${when}`, where && `어디서: ${where}`, who && `누가: ${who}`, what && `무엇을: ${what}`, how && `어떻게: ${how}`, feeling && `기분: ${feeling}`]
        .filter(Boolean)
        .join(" · ");
    if (!hintLine) return "";
    return LIFE_HINT_BLOCK_PREFIX + hintLine;
}

const DRAFT_KEY_BOOK = (uid) => `opo_v5_draft_book_${uid}`;
const DRAFT_KEY_LIFE_DAILY = (uid) => `opo_v5_draft_life_daily_${uid}`;
const DRAFT_KEY_LIFE_TOPIC = (uid) => `opo_v5_draft_life_topic_${uid}`;
/** 구버전 임시 저장 호환 */
const DRAFT_KEY_LIFE_LEGACY = (uid) => `opo_v5_draft_life_${uid}`;

/** 독서 기록: 분류 선택 UI 제거 — 저장 시 고정 코드 (피드 뱃지용) */
const BOOK_STORE_CATEGORY = "800";

/** 독서 카드 본문 (피드·상세 모달 공용) */
function BookFeedCardInner({ post }) {
    if (!post || post.type !== "book") return null;
    return (
        <>
            <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-slate-100">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-200 overflow-hidden border shrink-0">
                    {post.writerImg ? (
                        <img src={post.writerImg} className="w-full h-full object-cover" alt="" />
                    ) : (
                        <i className="fa-solid fa-user text-xl"></i>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <h5 className="font-bold text-slate-800 font-gaegu text-lg sm:text-2xl leading-tight truncate">
                        {post.writer} {post.writerRole === "admin" ? "선생님" : ""}
                    </h5>
                    <p className="text-sm sm:text-base text-slate-500 font-bold">
                        {post.writerRole === "admin" ? "관리자" : `${post.writerNo}번 작가`} · {new Date(post.timestamp).toLocaleDateString()}
                    </p>
                </div>
                <span className="text-xs sm:text-sm font-bold bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-xl shrink-0">
                    {KDC_LABELS[post.category]?.split(" ")[0] || "📚"}
                </span>
            </div>
            <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">
                <div className="w-full lg:w-52 xl:w-56 shrink-0 flex justify-center lg:justify-start">
                    {post.coverImageUrl ? (
                        <div className="rounded-2xl overflow-hidden border-4 border-white shadow-md w-full max-w-[14rem] lg:max-w-none aspect-[3/4] bg-slate-50">
                            <img src={post.coverImageUrl} alt="" className="w-full h-full object-cover" />
                        </div>
                    ) : (
                        <div className="rounded-2xl border-4 border-dashed border-indigo-100 w-full max-w-[14rem] lg:max-w-none aspect-[3/4] flex items-center justify-center text-5xl bg-indigo-50/50">
                            📖
                        </div>
                    )}
                </div>
                <div className="flex-1 min-w-0 space-y-4 text-base sm:text-lg w-full">
                    <div className="rounded-2xl bg-slate-50 border-2 border-slate-100 p-5 sm:p-6">
                        <p className="text-xs sm:text-sm font-bold text-slate-500 uppercase tracking-wide mb-2">책</p>
                        <h4 className="font-bold text-slate-900 font-gaegu text-xl sm:text-2xl leading-snug [text-wrap:balance] break-keep">
                            {post.title}
                        </h4>
                        <p className="text-lg sm:text-xl text-indigo-700 font-bold mt-3 leading-snug">{post.author}</p>
                    </div>
                    {post.favoriteQuote && (
                        <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 border-2 border-amber-100/80 text-slate-800">
                            <p className="text-sm sm:text-base font-bold text-indigo-600 mb-2">인용 한 줄</p>
                            <p className="font-medium leading-relaxed">&ldquo;{post.favoriteQuote}&rdquo;</p>
                            {post.quoteWhy && (
                                <p className="text-slate-700 mt-3 pt-3 border-t border-amber-200/60">
                                    <span className="font-bold text-amber-900">왜 좋았나요:</span> {post.quoteWhy}
                                </p>
                            )}
                        </div>
                    )}
                    {(post.memorableScene || post.myThought || post.curiousNext) && (
                        <>
                            {post.memorableScene && (
                                <div className="p-4 sm:p-5 rounded-2xl bg-white border-2 border-indigo-100">
                                    <p className="text-sm sm:text-base font-bold text-indigo-600 mb-2">인상 깊은 장면</p>
                                    <p className="text-slate-800 leading-relaxed whitespace-pre-wrap">{post.memorableScene}</p>
                                </div>
                            )}
                            {post.myThought && (
                                <div className="p-4 sm:p-5 rounded-2xl bg-white border-2 border-indigo-100">
                                    <p className="text-sm sm:text-base font-bold text-indigo-600 mb-2">나의 생각</p>
                                    <p className="text-slate-800 leading-relaxed whitespace-pre-wrap">{post.myThought}</p>
                                </div>
                            )}
                            {post.curiousNext && (
                                <div className="p-4 sm:p-5 rounded-2xl bg-white border-2 border-indigo-100">
                                    <p className="text-sm sm:text-base font-bold text-indigo-600 mb-2">다음에 궁금한 점</p>
                                    <p className="text-slate-800 leading-relaxed whitespace-pre-wrap">{post.curiousNext}</p>
                                </div>
                            )}
                        </>
                    )}
                    {post.freeNote && (
                        <div className="p-4 sm:p-5 rounded-2xl bg-slate-50/90 border border-slate-100">
                            <p className="text-sm sm:text-base font-bold text-slate-500 mb-2">더 적기</p>
                            <p className="text-slate-800 leading-relaxed whitespace-pre-wrap">{post.freeNote}</p>
                        </div>
                    )}
                    {!post.memorableScene && !post.myThought && !post.curiousNext && !post.freeNote && (
                        <div className="text-slate-800 leading-relaxed whitespace-pre-wrap">{post.content}</div>
                    )}
                </div>
            </div>
        </>
    );
}

/** 조각 카드 본문 (피드 공유분) */
function LifeFeedCardInner({ post }) {
    if (!post || post.type !== "life") return null;
    return (
        <>
            <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-slate-100">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-200 overflow-hidden border shrink-0">
                    {post.writerImg ? (
                        <img src={post.writerImg} className="w-full h-full object-cover" alt="" />
                    ) : (
                        <i className="fa-solid fa-user text-xl"></i>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <h5 className="font-bold text-slate-800 font-gaegu text-lg sm:text-2xl leading-tight truncate">
                        {post.writer} {post.writerRole === "admin" ? "선생님" : ""}
                    </h5>
                    <p className="text-sm sm:text-base text-slate-500 font-bold">
                        {post.writerRole === "admin" ? "관리자" : `${post.writerNo}번 작가`} · {new Date(post.timestamp).toLocaleDateString()}
                    </p>
                </div>
                <span className="text-xs sm:text-sm font-bold bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-xl shrink-0">
                    {post.lifePieceKind === "topic" ? "📝 주제 글" : "✨ 조각"}
                </span>
            </div>
            {post.lifePieceKind !== "daily" && post.writingPromptTopic && String(post.writingPromptTopic).trim() && (
                <div className="mb-4 rounded-2xl bg-slate-50 border-2 border-slate-100 px-4 py-3">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">쓰기 주제</p>
                    <p className="text-base sm:text-lg text-slate-800 font-medium leading-snug">&ldquo;{post.writingPromptTopic}&rdquo;</p>
                </div>
            )}
            <div className="space-y-4 text-base sm:text-lg">
                {(post.moodEmoji || post.moodLabel) && (
                    <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50/80 border-2 border-emerald-100">
                        <p className="text-sm sm:text-base font-bold text-emerald-800 mb-1">기분 스티커</p>
                        <p className="text-slate-800 font-bold">
                            {post.moodEmoji} {post.moodLabel}
                            {post.moodWhy && <span className="font-normal text-slate-600"> — {post.moodWhy}</span>}
                        </p>
                    </div>
                )}
                {post.imageUrl && (
                    <div className="rounded-2xl overflow-hidden border-4 border-white shadow-md bg-slate-50">
                        <img src={post.imageUrl} alt="" className="w-full max-h-96 object-cover" />
                        {post.imageCaption && <p className="p-4 text-slate-600 italic bg-white/90 text-base">📷 {post.imageCaption}</p>}
                    </div>
                )}
                <div className="text-slate-800 leading-relaxed whitespace-pre-wrap">{post.content}</div>
            </div>
        </>
    );
}

function myClassStudents(allUsers, teacherId) {
    return allUsers.filter((u) => u.role === "student" && u.homeroomTeacherId === teacherId);
}

function studentsWithoutHomeroom(allUsers) {
    return allUsers.filter((u) => u.role === "student" && !u.homeroomTeacherId);
}

function isDailyLifePiece(p) {
    if (!p || p.type !== "life") return false;
    if (p.lifePieceKind === "daily") return true;
    if (p.lifePieceKind === "topic") return false;
    return !String(p.writingPromptTopic || "").trim();
}

function studentDailyLifePostOnDate(posts, studentId, y, m, day) {
    const start = new Date(y, m, day, 0, 0, 0, 0).getTime();
    const end = new Date(y, m, day, 23, 59, 59, 999).getTime();
    const list = posts
        .filter(
            (p) =>
                p.type === "life" &&
                p.writerId === studentId &&
                isDailyLifePiece(p) &&
                p.timestamp >= start &&
                p.timestamp <= end
        )
        .sort((a, b) => b.timestamp - a.timestamp);
    return list[0] || null;
}

function studentBookPostOnDate(posts, studentId, y, m, day) {
    const start = new Date(y, m, day, 0, 0, 0, 0).getTime();
    const end = new Date(y, m, day, 23, 59, 59, 999).getTime();
    const list = posts
        .filter((p) => p.type === "book" && p.writerId === studentId && p.timestamp >= start && p.timestamp <= end)
        .sort((a, b) => b.timestamp - a.timestamp);
    return list[0] || null;
}

function App() {
    const [user, setUser] = useState(null);
    const [appUser, setAppUser] = useState(null);
    const [isLoginView, setIsLoginView] = useState(true);

    const [loginId, setLoginId] = useState("");
    const [loginPw, setLoginPw] = useState("");
    const [loginPwConfirm, setLoginPwConfirm] = useState("");
    const [signupName, setSignupName] = useState("");
    const [signupNo, setSignupNo] = useState("");

    const [activeTab, setActiveTab] = useState("feed");
    /** 학생 화면: DB에 담임 미배정이어도 같은 반(단일 admin) 기준으로 피드·우체통 연동 */
    const [soleAdminId, setSoleAdminId] = useState(null);
    const [posts, setPosts] = useState([]);
    const [mailbox, setMailbox] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [adminChatTarget, setAdminChatTarget] = useState(null);
    const [adminMailbox, setAdminMailbox] = useState([]);

    const [alert, setAlert] = useState({ show: false, msg: "", icon: "" });
    const [showComments, setShowComments] = useState(null);
    const [commentInput, setCommentInput] = useState("");
    const [selectedLifeImg, setSelectedLifeImg] = useState(null);
    const [adminManageStudent, setAdminManageStudent] = useState(null);
    const [adminPwDraft, setAdminPwDraft] = useState("");
    const [selectedBookCover, setSelectedBookCover] = useState(null);
    const [showLifeHints, setShowLifeHints] = useState(false);
    const [selectedMoodId, setSelectedMoodId] = useState("");
    const [dailyPromptDoc, setDailyPromptDoc] = useState(null);
    const [adminPromptInput, setAdminPromptInput] = useState("");
    const [bookSubTab, setBookSubTab] = useState("compose");
    const [lifeSubTab, setLifeSubTab] = useState("daily");
    const [mailboxUnreadByStudent, setMailboxUnreadByStudent] = useState({});
    const [aladinQueryInput, setAladinQueryInput] = useState("");
    const [aladinResults, setAladinResults] = useState([]);
    const [aladinLoading, setAladinLoading] = useState(false);
    const [bookDetailModal, setBookDetailModal] = useState(null);
    const [readingCalendarModal, setReadingCalendarModal] = useState(null);
    const [lifePostDetailModal, setLifePostDetailModal] = useState(null);
    const [adminDailyPick, setAdminDailyPick] = useState(() => {
        const d = new Date();
        return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
    });
    const [adminBookPick, setAdminBookPick] = useState(() => {
        const d = new Date();
        return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
    });

    useEffect(() => {
        if (appUser?.role === "admin" && lifeSubTab === "my") {
            setLifeSubTab("daily");
        }
    }, [appUser?.role, lifeSubTab]);

    useEffect(() => {
        if (appUser?.role !== "admin" && bookSubTab === "classreading") {
            setBookSubTab("compose");
        }
    }, [appUser?.role, bookSubTab]);

    useEffect(() => {
        const initAuth = async () => {
            await signInAnonymously(auth);
        };
        initAuth();
        const unsubAuth = onAuthStateChanged(auth, async (userData) => {
            if (userData) {
                setUser(userData);
                const savedId = localStorage.getItem("opo_login_id");
                if (savedId) fetchAppUser(savedId);
            }
        });
        return () => unsubAuth();
    }, []);

    useEffect(() => {
        if (!appUser || appUser.role !== "student") {
            setSoleAdminId(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const usersColl = collection(db, "artifacts", appId, "public", "data", "users");
                const q = query(usersColl, where("role", "==", "admin"), limit(1));
                const snap = await getDocs(q);
                if (!cancelled && !snap.empty) setSoleAdminId(snap.docs[0].id);
            } catch {
                if (!cancelled) setSoleAdminId(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [appUser]);

    useEffect(() => {
        if (!appUser) return;
        const key = localDateKey();
        const ref = doc(db, "artifacts", appId, "public", "data", "writingPrompts", key);
        const unsub = onSnapshot(ref, (snap) => {
            if (snap.exists()) setDailyPromptDoc({ id: snap.id, ...snap.data() });
            else setDailyPromptDoc(null);
        });
        return () => unsub();
    }, [appUser]);

    const fetchAppUser = async (id) => {
        const userRef = doc(db, "artifacts", appId, "public", "data", "users", id);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) setAppUser(normalizeUser({ ...userSnap.data(), id }));
        else localStorage.removeItem("opo_login_id");
    };

    useEffect(() => {
        if (!appUser) return;

        const postsColl = collection(db, "artifacts", appId, "public", "data", "posts");
        const unsubPosts = onSnapshot(postsColl, (snapshot) => {
            const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
            setPosts(data.sort((a, b) => b.timestamp - a.timestamp));
        });

        const mailboxColl = collection(db, "artifacts", appId, "users", appUser.id, MAILBOX_SUBCOL);
        const unsubMailbox = onSnapshot(mailboxColl, (snapshot) => {
            const tid = appUser.role === "student" ? appUser.homeroomTeacherId || soleAdminId : null;
            const data = snapshot.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .filter((m) => (tid ? m.teacherId === tid : false))
                .sort((a, b) => a.timestamp - b.timestamp);
            setMailbox(data);
        });

        if (appUser.role === "admin") {
            const usersColl = collection(db, "artifacts", appId, "public", "data", "users");
            const unsubUsers = onSnapshot(usersColl, (snapshot) => {
                const data = snapshot.docs.map((d) => normalizeUser({ ...d.data(), id: d.id }));
                setAllUsers(data.sort((a, b) => parseInt(String(a.no || 0), 10) - parseInt(String(b.no || 0), 10)));
            });
            return () => {
                unsubPosts();
                unsubMailbox();
                unsubUsers();
            };
        }

        return () => {
            unsubPosts();
            unsubMailbox();
        };
    }, [appUser, soleAdminId]);

    useEffect(() => {
        if (appUser?.role === "admin" && adminChatTarget) {
            const coll = collection(db, "artifacts", appId, "users", adminChatTarget.id, MAILBOX_SUBCOL);
            const unsub = onSnapshot(coll, (snapshot) => {
                const tid = appUser.id;
                const data = snapshot.docs
                    .map((d) => ({ id: d.id, ...d.data() }))
                    .filter((m) => m.teacherId === tid)
                    .sort((a, b) => a.timestamp - b.timestamp);
                setAdminMailbox(data);
            });
            return () => unsub();
        }
    }, [adminChatTarget, appUser]);

    useEffect(() => {
        if (adminManageStudent && appUser?.role === "admin") {
            setAdminPwDraft("");
        }
    }, [adminManageStudent, appUser]);

    const showAlert = (msg, icon) => setAlert({ show: true, msg, icon: icon || "🌟" });

    const runAladinSearch = async () => {
        const q = aladinQueryInput.trim();
        if (!q) return showAlert("책 제목을 입력하고 검색해 주세요.", "🔍");
        setAladinLoading(true);
        setAladinResults([]);
        try {
            const items = await aladinItemSearchJsonp(q);
            setAladinResults(items);
            if (items.length === 0)
                showAlert("검색 결과가 없어요. 책 이름 일부나 저자, 다른 단어로 다시 검색해 보세요.", "📚");
        } catch (e) {
            showAlert(e.message || "검색 중 오류가 났어요.", "⚠️");
        } finally {
            setAladinLoading(false);
        }
    };

    const applyAladinBook = (item) => {
        const titleEl = document.getElementById("book-title");
        const authorEl = document.getElementById("book-author");
        if (titleEl) titleEl.value = (item.title || "").trim();
        if (authorEl) {
            let a = (item.author || "").trim();
            const first = a.split(",").map((s) => s.trim()).filter(Boolean)[0];
            authorEl.value = first || a;
        }
        if (item.cover) setSelectedBookCover(item.cover);
        showAlert("제목·저자·표지를 채웠어요. 필요하면 수정해 주세요.", "📖");
    };

    const classFeed = useMemo(() => (appUser ? feedClassPosts(posts, appUser, soleAdminId) : []), [posts, appUser, soleAdminId]);

    const todayWritingHint = useMemo(() => {
        const key = localDateKey();
        if (dailyPromptDoc?.topic?.trim()) return { text: dailyPromptDoc.topic.trim(), badge: "오늘의 글감", key };
        return { text: pickFallbackPromptForDate(key), badge: "오늘의 글감", key };
    }, [dailyPromptDoc]);

    const studentMailboxUnreadCount = useMemo(() => {
        if (!appUser || appUser.role !== "student") return 0;
        const tid = appUser.homeroomTeacherId || soleAdminId;
        if (!tid) return 0;
        return mailbox.filter((m) => m.senderId === tid && m.read === false).length;
    }, [appUser, soleAdminId, mailbox]);

    const teacherMailboxUnreadTotal = useMemo(() => {
        if (!appUser || appUser.role !== "admin") return 0;
        return Object.values(mailboxUnreadByStudent).filter(Boolean).length;
    }, [appUser, mailboxUnreadByStudent]);

    const classTopicOnlyGroupedForAdmin = useMemo(() => {
        if (!appUser || appUser.role !== "admin") return [];
        const topicPosts = posts.filter(
            (p) =>
                p.type === "life" &&
                p.classTeacherId === appUser.id &&
                p.writerId !== appUser.id &&
                (p.lifePieceKind === "topic" || (!p.lifePieceKind && String(p.writingPromptTopic || "").trim()))
        );
        const groups = new Map();
        for (const p of topicPosts) {
            const label = (p.writingPromptTopic && String(p.writingPromptTopic).trim()) || "주제 미지정 · 이전 기록";
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(p);
        }
        return Array.from(groups.entries()).sort((a, b) => {
            const ta = Math.max(...a[1].map((x) => x.timestamp));
            const tb = Math.max(...b[1].map((x) => x.timestamp));
            return tb - ta;
        });
    }, [posts, appUser]);

    const adminDailyCountsByDay = useMemo(() => {
        if (!appUser || appUser.role !== "admin") return {};
        const studs = myClassStudents(allUsers, appUser.id);
        const y = adminDailyPick.y;
        const m = adminDailyPick.m;
        const last = new Date(y, m + 1, 0).getDate();
        const counts = {};
        for (let day = 1; day <= last; day++) {
            let n = 0;
            for (const stu of studs) {
                if (studentDailyLifePostOnDate(posts, stu.id, y, m, day)) n++;
            }
            counts[day] = n;
        }
        return counts;
    }, [appUser, adminDailyPick.y, adminDailyPick.m, posts, allUsers]);

    const adminBookCountsByDay = useMemo(() => {
        if (!appUser || appUser.role !== "admin") return {};
        const studs = myClassStudents(allUsers, appUser.id);
        const y = adminBookPick.y;
        const m = adminBookPick.m;
        const last = new Date(y, m + 1, 0).getDate();
        const counts = {};
        for (let day = 1; day <= last; day++) {
            let n = 0;
            for (const stu of studs) {
                if (studentBookPostOnDate(posts, stu.id, y, m, day)) n++;
            }
            counts[day] = n;
        }
        return counts;
    }, [appUser, adminBookPick.y, adminBookPick.m, posts, allUsers]);

    const myLifePostsSorted = useMemo(() => {
        if (!appUser) return [];
        return posts
            .filter((p) => p.writerId === appUser.id && p.type === "life")
            .sort((a, b) => b.timestamp - a.timestamp);
    }, [posts, appUser]);

    const myLifeDailyList = useMemo(() => myLifePostsSorted.filter((p) => p.lifePieceKind === "daily"), [myLifePostsSorted]);

    const myLifeTopicList = useMemo(
        () =>
            myLifePostsSorted.filter(
                (p) => p.lifePieceKind === "topic" || (!p.lifePieceKind && String(p.writingPromptTopic || "").trim())
            ),
        [myLifePostsSorted]
    );

    const handleSignup = async () => {
        if (!loginId || !loginPw || !signupName || !signupNo) return showAlert("빈칸을 모두 채워주세요!", "✍️");
        if (loginPw !== loginPwConfirm) return showAlert("비밀번호가 서로 달라요!", "🔐");

        const userRef = doc(db, "artifacts", appId, "public", "data", "users", loginId);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) return showAlert("이미 있는 아이디예요!", "🚫");

        const isAdmin = loginId.toLowerCase().includes("admin");

        const newUser = {
            id: loginId,
            pw: loginPw,
            name: signupName,
            no: signupNo,
            role: isAdmin ? "admin" : "student",
            homeroomTeacherId: null,
            profileImg: null,
            statusMsg: "",
            createdAt: Date.now(),
        };
        await setDoc(userRef, newUser);
        setAppUser(normalizeUser(newUser));
        localStorage.setItem("opo_login_id", loginId);
        showAlert(`${signupName} ${isAdmin ? "선생님" : "작가님"}, 환영해요!`, "🎈");
    };

    const handleLogin = async () => {
        if (!loginId || !loginPw) return showAlert("아이디와 비밀번호를 써주세요!", "👀");
        const userRef = doc(db, "artifacts", appId, "public", "data", "users", loginId);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const userData = normalizeUser({ ...userSnap.data(), id: loginId });
            if (userData.pw === loginPw) {
                setAppUser(userData);
                localStorage.setItem("opo_login_id", loginId);
                showAlert(`${userData.name}님 반가워요!`, "🎈");
            } else showAlert("비밀번호가 틀렸어요!", "🔒");
        } else showAlert("가입되지 않은 아이디예요!", "❓");
    };

    const logout = () => {
        setAppUser(null);
        localStorage.removeItem("opo_login_id");
        setLoginId("");
        setLoginPw("");
        setSignupName("");
        setSignupNo("");
        setIsLoginView(true);
        setAdminChatTarget(null);
        setAdminManageStudent(null);
    };

    const resolveClassTeacherIdForPost = () => {
        if (appUser.role === "admin") return appUser.id;
        return appUser.homeroomTeacherId || soleAdminId || null;
    };

    const savePost = async (type, opts = {}) => {
        const { lifeWritingMode = "daily" } = opts;
        if (!appUser) return;
        const classTeacherId = resolveClassTeacherIdForPost();
        if (type === "book" && !classTeacherId) return showAlert("관리자(선생님) 계정을 찾을 수 없어요. 잠시 후 다시 시도해 주세요.", "👩‍🏫");

        if (type === "book") {
            const scene = document.getElementById("book-scene")?.value?.trim() || "";
            const thought = document.getElementById("book-thought")?.value?.trim() || "";
            const curious = document.getElementById("book-curious")?.value?.trim() || "";
            const quote = document.getElementById("book-quote")?.value?.trim() || "";
            const quoteWhy = document.getElementById("book-quote-why")?.value?.trim() || "";
            const main = document.getElementById("book-content")?.value?.trim() || "";
            const hasBookBody = main || scene || thought || curious || quote;
            if (!hasBookBody) return showAlert("뼈대·인용·생각 중 한 곳이라도 적어 주세요!", "✍️");
            const bookTitleVal = document.getElementById("book-title")?.value?.trim() || "";
            if (!bookTitleVal) return showAlert("책 제목을 적어 주세요!", "📖");

            const blocks = [];
            if (quote) {
                blocks.push(`💬 인용\n「${quote}」`);
                if (quoteWhy) blocks.push(`왜 좋았나요: ${quoteWhy}`);
            }
            if (scene) blocks.push(`📌 인상 깊은 장면\n${scene}`);
            if (thought) blocks.push(`💭 나의 생각\n${thought}`);
            if (curious) blocks.push(`❓ 다음에 궁금한 점\n${curious}`);
            if (main) blocks.push(`✏️ 더 적기\n${main}`);
            const mergedContent = blocks.join("\n\n");

            const newPost = {
                type: "book",
                writer: appUser.name,
                writerNo: appUser.no,
                writerId: appUser.id,
                writerRole: appUser.role,
                writerImg: appUser.profileImg,
                content: mergedContent,
                memorableScene: scene,
                myThought: thought,
                curiousNext: curious,
                favoriteQuote: quote,
                quoteWhy: quoteWhy,
                freeNote: main,
                timestamp: Date.now(),
                likes: [],
                comments: [],
                date: new Date().toISOString(),
                classTeacherId: classTeacherId || null,
                isPrivateJournal: false,
                title: bookTitleVal,
                author: document.getElementById("book-author")?.value?.trim() || "작자미상",
                category: BOOK_STORE_CATEGORY,
            };
            if (selectedBookCover) newPost.coverImageUrl = selectedBookCover;

            await addDoc(collection(db, "artifacts", appId, "public", "data", "posts"), newPost);
            try {
                localStorage.removeItem(DRAFT_KEY_BOOK(appUser.id));
            } catch {
                /* ignore */
            }
            showAlert("우리 반 피드에 올렸어요!", "✨");
            setActiveTab("write-book");
            document.getElementById("book-title").value = "";
            document.getElementById("book-author").value = "";
            document.getElementById("book-scene").value = "";
            document.getElementById("book-thought").value = "";
            document.getElementById("book-curious").value = "";
            document.getElementById("book-quote").value = "";
            document.getElementById("book-quote-why").value = "";
            document.getElementById("book-content").value = "";
            setSelectedBookCover(null);
            setBookSubTab("history");
            return;
        }

        const isTopicWriting = lifeWritingMode === "topic";
        const mainLife = document.getElementById("life-content")?.value?.trim() || "";
        const cap = document.getElementById("life-caption")?.value?.trim() || "";
        const moodWhy = document.getElementById("life-mood-why")?.value?.trim() || "";
        const hasImg = !!selectedLifeImg;
        const photoOk = !isTopicWriting && hasImg && !!cap;
        if (!mainLife && !photoOk && !moodWhy) {
            return showAlert("본문·사진 설명·기분 이야기 중 하나는 적어 주세요!", "✍️");
        }

        const when = document.getElementById("life-when")?.value?.trim() || "";
        const where = document.getElementById("life-where")?.value?.trim() || "";
        const who = document.getElementById("life-who")?.value?.trim() || "";
        const what = document.getElementById("life-what")?.value?.trim() || "";
        const how = document.getElementById("life-how")?.value?.trim() || "";
        const feeling = document.getElementById("life-feeling")?.value?.trim() || "";
        const moodMeta = MOOD_PICKS.find((m) => m.id === selectedMoodId);

        const lifeBlocks = [];
        if (when || where || who || what || how || feeling) {
            const hintLine = [when && `언제: ${when}`, where && `어디서: ${where}`, who && `누가: ${who}`, what && `무엇을: ${what}`, how && `어떻게: ${how}`, feeling && `기분: ${feeling}`]
                .filter(Boolean)
                .join(" · ");
            if (hintLine) lifeBlocks.push(`🧭 오늘의 힌트\n${hintLine}`);
        }
        if (moodMeta) {
            lifeBlocks.push(`기분 스티커: ${moodMeta.emoji} ${moodMeta.label}`);
            if (moodWhy) lifeBlocks.push(`왜 그랬어요? ${moodWhy}`);
        }
        if (!isTopicWriting && hasImg && cap) lifeBlocks.push(`📷 사진 한 줄\n${cap}`);
        if (mainLife) lifeBlocks.push(mainLife);
        const mergedLife = lifeBlocks.join("\n\n");

        const topicText = (todayWritingHint?.text || "").trim();
        const topicKey = todayWritingHint?.key || "";
        const newPost = {
            type: "life",
            writer: appUser.name,
            writerNo: appUser.no,
            writerId: appUser.id,
            writerRole: appUser.role,
            writerImg: appUser.profileImg,
            content: mergedLife,
            lifeWhen: when,
            lifeWhere: where,
            lifeWho: who,
            lifeWhat: what,
            lifeHow: how,
            lifeFeeling: feeling,
            imageCaption: !isTopicWriting && cap ? cap : null,
            moodId: selectedMoodId || null,
            moodLabel: moodMeta?.label || null,
            moodEmoji: moodMeta?.emoji || null,
            moodWhy: moodWhy || null,
            timestamp: Date.now(),
            likes: [],
            comments: [],
            date: new Date().toISOString(),
            classTeacherId: classTeacherId || null,
            sharedToFeed: false,
            isPrivateJournal: true,
            lifePieceKind: isTopicWriting ? "topic" : "daily",
            writingPromptTopic: isTopicWriting ? topicText : "",
            writingPromptDateKey: isTopicWriting ? topicKey : "",
        };
        if (!isTopicWriting && selectedLifeImg) newPost.imageUrl = selectedLifeImg;

        await addDoc(collection(db, "artifacts", appId, "public", "data", "posts"), newPost);
        try {
            const uid = appUser.id;
            if (isTopicWriting) {
                localStorage.removeItem(DRAFT_KEY_LIFE_TOPIC(uid));
            } else {
                localStorage.removeItem(DRAFT_KEY_LIFE_DAILY(uid));
            }
            localStorage.removeItem(DRAFT_KEY_LIFE_LEGACY(uid));
        } catch {
            /* ignore */
        }
        showAlert("조각을 보관했어요. 선생님과 나만 볼 수 있어요. 📮", "✨");
        setActiveTab("write-life");
        const lifeContentEl = document.getElementById("life-content");
        if (lifeContentEl) lifeContentEl.value = "";
        const lifeCapEl = document.getElementById("life-caption");
        if (lifeCapEl) lifeCapEl.value = "";
        const lifeMoodWhyEl = document.getElementById("life-mood-why");
        if (lifeMoodWhyEl) lifeMoodWhyEl.value = "";
        ["life-when", "life-where", "life-who", "life-what", "life-how", "life-feeling"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        });
        setSelectedLifeImg(null);
        setSelectedMoodId("");
        setShowLifeHints(false);
        setLifeSubTab("my");
    };

    const saveBookDraftLocal = () => {
        if (!appUser) return;
        try {
            const payload = {
                title: document.getElementById("book-title")?.value || "",
                author: document.getElementById("book-author")?.value || "",
                scene: document.getElementById("book-scene")?.value || "",
                thought: document.getElementById("book-thought")?.value || "",
                curious: document.getElementById("book-curious")?.value || "",
                quote: document.getElementById("book-quote")?.value || "",
                quoteWhy: document.getElementById("book-quote-why")?.value || "",
                main: document.getElementById("book-content")?.value || "",
                cover: selectedBookCover || null,
            };
            localStorage.setItem(DRAFT_KEY_BOOK(appUser.id), JSON.stringify(payload));
            showAlert("임시 저장했어요. 나중에 이어서 쓸 수 있어요.", "💾");
        } catch {
            showAlert("임시 저장에 실패했어요.", "⚠️");
        }
    };

    const restoreBookDraftLocal = () => {
        if (!appUser) return;
        const raw = localStorage.getItem(DRAFT_KEY_BOOK(appUser.id));
        if (!raw) return showAlert("불러올 임시 글이 없어요.", "📭");
        try {
            const payload = JSON.parse(raw);
            const setVal = (id, v) => {
                const el = document.getElementById(id);
                if (el) el.value = v ?? "";
            };
            setVal("book-title", payload.title);
            setVal("book-author", payload.author);
            setVal("book-scene", payload.scene);
            setVal("book-thought", payload.thought);
            setVal("book-curious", payload.curious);
            setVal("book-quote", payload.quote);
            setVal("book-quote-why", payload.quoteWhy);
            setVal("book-content", payload.main);
            setSelectedBookCover(payload.cover || null);
            showAlert("임시 저장본을 불러왔어요.", "📂");
        } catch {
            showAlert("임시 글을 읽을 수 없어요.", "⚠️");
        }
    };

    const lifeDraftStorageKey = () => {
        if (!appUser) return null;
        return lifeSubTab === "topic" ? DRAFT_KEY_LIFE_TOPIC(appUser.id) : DRAFT_KEY_LIFE_DAILY(appUser.id);
    };

    const saveLifeDraftLocal = () => {
        if (!appUser) return;
        const storageKey = lifeDraftStorageKey();
        if (!storageKey) return;
        try {
            const payload = {
                moodId: selectedMoodId || "",
                moodWhy: document.getElementById("life-mood-why")?.value || "",
                when: document.getElementById("life-when")?.value || "",
                where: document.getElementById("life-where")?.value || "",
                who: document.getElementById("life-who")?.value || "",
                what: document.getElementById("life-what")?.value || "",
                how: document.getElementById("life-how")?.value || "",
                feeling: document.getElementById("life-feeling")?.value || "",
                content: document.getElementById("life-content")?.value || "",
                caption: document.getElementById("life-caption")?.value || "",
                img: selectedLifeImg || null,
                showHints: !!showLifeHints,
            };
            localStorage.setItem(storageKey, JSON.stringify(payload));
            showAlert("임시 저장했어요.", "💾");
        } catch {
            showAlert("임시 저장에 실패했어요.", "⚠️");
        }
    };

    const restoreLifeDraftLocal = () => {
        if (!appUser) return;
        const storageKey = lifeDraftStorageKey();
        if (!storageKey) return;
        let raw = localStorage.getItem(storageKey);
        if (!raw && lifeSubTab === "daily") raw = localStorage.getItem(DRAFT_KEY_LIFE_LEGACY(appUser.id));
        if (!raw) return showAlert("불러올 임시 글이 없어요.", "📭");
        try {
            const payload = JSON.parse(raw);
            const setVal = (id, v) => {
                const el = document.getElementById(id);
                if (el) el.value = v ?? "";
            };
            setVal("life-mood-why", payload.moodWhy);
            setVal("life-when", payload.when);
            setVal("life-where", payload.where);
            setVal("life-who", payload.who);
            setVal("life-what", payload.what);
            setVal("life-how", payload.how);
            setVal("life-feeling", payload.feeling);
            setVal("life-content", payload.content);
            setVal("life-caption", payload.caption);
            setSelectedMoodId(payload.moodId || "");
            setShowLifeHints(!!payload.showHints);
            setSelectedLifeImg(payload.img || null);
            showAlert("임시 저장본을 불러왔어요.", "📂");
            setTimeout(() => syncLifeHintsToContent(), 0);
        } catch {
            showAlert("임시 글을 읽을 수 없어요.", "⚠️");
        }
    };

    const syncLifeHintsToContent = () => {
        if (lifeSubTab !== "daily") return;
        const el = document.getElementById("life-content");
        if (!el) return;
        const body = stripLifeHintBlockFromContent(el.value);
        const block = buildLifeHintBlockFromInputs();
        el.value = block ? block + (body ? "\n\n" + body : "") : body;
    };

    const saveTodayWritingPrompt = async () => {
        if (!appUser || appUser.role !== "admin") return;
        const key = localDateKey();
        const ref = doc(db, "artifacts", appId, "public", "data", "writingPrompts", key);
        const t = adminPromptInput.trim();
        if (!t) {
            try {
                await deleteDoc(ref);
            } catch {
                /* 문서가 없어도 괜찮음 */
            }
            setAdminPromptInput("");
            showAlert("오늘은 조각 탭에 오늘의 글감만 보여요.", "📝");
            return;
        }
        await setDoc(
            ref,
            {
                topic: t,
                dateKey: key,
                setBy: appUser.id,
                setByName: appUser.name,
                updatedAt: Date.now(),
            },
            { merge: true }
        );
        showAlert("학생들 조각 탭에 오늘 주제로 보여요!", "📝");
    };

    const deleteTodayWritingPrompt = async () => {
        if (!appUser || appUser.role !== "admin") return;
        if (!confirm("오늘의 쓰기 주제 안내를 삭제할까요? 학생에게는 오늘의 글감만 보여요.")) return;
        const ref = doc(db, "artifacts", appId, "public", "data", "writingPrompts", localDateKey());
        try {
            await deleteDoc(ref);
        } catch {
            /* 없음 */
        }
        setAdminPromptInput("");
        showAlert("오늘 안내를 지웠어요.", "📝");
    };

    const handleBookCoverUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => setSelectedBookCover(ev.target.result);
            reader.readAsDataURL(file);
        }
    };

    const deletePost = async (postId) => {
        if (!confirm("정말 이 글을 삭제할까요?")) return;
        await deleteDoc(doc(db, "artifacts", appId, "public", "data", "posts", postId));
        showAlert("글이 삭제되었습니다.", "🗑️");
    };

    const canDeletePost = (post) => {
        if (post.writerId === appUser.id) return true;
        if (appUser.role === "admin" && post.classTeacherId === appUser.id) return true;
        return false;
    };

    const toggleLike = async (postId) => {
        const post = posts.find((p) => p.id === postId);
        if (!post) return;
        const myKey = { id: appUser.id, name: appUser.name };
        const postRef = doc(db, "artifacts", appId, "public", "data", "posts", postId);
        const likes = post.likes || [];
        const existing = likes.find((l) => l.id === appUser.id);
        if (existing) await updateDoc(postRef, { likes: arrayRemove(existing) });
        else await updateDoc(postRef, { likes: arrayUnion(myKey) });
    };

    const addComment = async () => {
        if (!commentInput) return;
        const postRef = doc(db, "artifacts", appId, "public", "data", "posts", showComments.id);
        await updateDoc(postRef, {
            comments: arrayUnion({
                writerId: appUser.id,
                writer: appUser.name,
                content: commentInput,
                date: new Date().toISOString(),
                timestamp: Date.now(),
            }),
        });
        setCommentInput("");
        setShowComments(null);
        showAlert("댓글을 남겼습니다!", "✍️");
    };

    const sendMailbox = async (content, { asTeacherToStudent } = {}) => {
        if (!content) return;
        if (asTeacherToStudent) {
            if (!adminChatTarget) return;
            if (adminChatTarget.homeroomTeacherId !== appUser.id) {
                showAlert("이 학생의 담임만 메시지를 보낼 수 있어요.", "🔒");
                return;
            }
            const msg = {
                senderId: appUser.id,
                senderName: appUser.name,
                content,
                timestamp: Date.now(),
                date: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                teacherId: appUser.id,
                read: false,
            };
            await addDoc(collection(db, "artifacts", appId, "users", adminChatTarget.id, MAILBOX_SUBCOL), msg);
            return;
        }
        const tid = appUser.homeroomTeacherId || soleAdminId;
        if (!tid) {
            showAlert("관리자(선생님) 계정을 불러올 수 없어요. 잠시 후 다시 시도해 주세요.", "📬");
            return;
        }
        const msg = {
            senderId: appUser.id,
            senderName: appUser.name,
            content,
            timestamp: Date.now(),
            date: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            teacherId: tid,
            read: false,
        };
        await addDoc(collection(db, "artifacts", appId, "users", appUser.id, MAILBOX_SUBCOL), msg);
    };

    const markMailboxReadForStudent = async () => {
        if (!appUser || appUser.role !== "student") return;
        const tid = appUser.homeroomTeacherId || soleAdminId;
        if (!tid) return;
        const coll = collection(db, "artifacts", appId, "users", appUser.id, MAILBOX_SUBCOL);
        const snap = await getDocs(coll);
        const batch = writeBatch(db);
        let n = 0;
        snap.docs.forEach((d) => {
            const m = d.data();
            if (m.senderId === tid && m.read === false) {
                batch.update(d.ref, { read: true });
                n++;
            }
        });
        if (n) await batch.commit();
    };

    const markMailboxReadForTeacher = async (studentId) => {
        if (!studentId) return;
        const coll = collection(db, "artifacts", appId, "users", studentId, MAILBOX_SUBCOL);
        const snap = await getDocs(coll);
        const batch = writeBatch(db);
        let n = 0;
        snap.docs.forEach((d) => {
            const m = d.data();
            if (m.senderId === studentId && m.read === false) {
                batch.update(d.ref, { read: true });
                n++;
            }
        });
        if (n) await batch.commit();
        setMailboxUnreadByStudent((prev) => ({ ...prev, [studentId]: false }));
    };

    const updateProfile = async () => {
        const newName = document.getElementById("profile-name").value;
        const userRef = doc(db, "artifacts", appId, "public", "data", "users", appUser.id);
        await updateDoc(userRef, { name: newName, statusMsg: "" });
        setAppUser({ ...appUser, name: newName, statusMsg: "" });
        showAlert("프로필 정보가 수정되었습니다!", "✅");
    };

    const handleProfileUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const imgData = event.target.result;
                const userRef = doc(db, "artifacts", appId, "public", "data", "users", appUser.id);
                await updateDoc(userRef, { profileImg: imgData });
                setAppUser({ ...appUser, profileImg: imgData });
                showAlert("프로필 사진이 변경되었습니다!", "🖼️");
            };
            reader.readAsDataURL(file);
        }
    };

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => setSelectedLifeImg(event.target.result);
            reader.readAsDataURL(file);
        }
    };

    const adminUpdateStudent = async () => {
        if (!adminManageStudent) return;
        const ref = doc(db, "artifacts", appId, "public", "data", "users", adminManageStudent.id);
        const updates = { homeroomTeacherId: appUser.id };
        if (adminPwDraft.trim()) updates.pw = adminPwDraft.trim();
        await updateDoc(ref, updates);
        showAlert("학생 정보가 저장되었습니다.", "✅");
        setAdminManageStudent(normalizeUser({ ...adminManageStudent, ...updates }));
        setAdminPwDraft("");
    };

    const adminDeleteStudentUser = async () => {
        if (!adminManageStudent) return;
        const tid = adminManageStudent.homeroomTeacherId;
        if (tid != null && tid !== appUser.id) {
            showAlert("다른 반으로 배정된 학생은 삭제할 수 없어요.", "🔒");
            return;
        }
        if (!confirm("이 학생 계정과 연결 데이터 일부는 Firebase에 남을 수 있어요. 정말 삭제할까요?")) return;
        await deleteDoc(doc(db, "artifacts", appId, "public", "data", "users", adminManageStudent.id));
        setAdminManageStudent(null);
        showAlert("학생 계정을 삭제했습니다.", "🗑️");
    };

    const claimStudentToMyClass = async (studentId) => {
        const ref = doc(db, "artifacts", appId, "public", "data", "users", studentId);
        await updateDoc(ref, { homeroomTeacherId: appUser.id });
        showAlert("우리 반으로 넣었어요.", "🎒");
    };

    const renderCalendar = () => {
        const now = new Date();
        const y = now.getFullYear();
        const mo = now.getMonth();
        const lastDate = new Date(y, mo + 1, 0).getDate();
        const firstDay = new Date(y, mo, 1).getDay();
        const myHistory = {};
        posts
            .filter((p) => p.writerId === appUser.id && p.type === "book")
            .forEach((p) => {
                const dt = new Date(p.timestamp);
                if (dt.getFullYear() !== y || dt.getMonth() !== mo) return;
                const day = dt.getDate();
                if (!myHistory[day]) myHistory[day] = [];
                myHistory[day].push(p);
            });
        const days = [];
        for (let i = 0; i < firstDay; i++) days.push(<div key={`empty-${i}`} className="p-1 sm:p-2"></div>);
        for (let i = 1; i <= lastDate; i++) {
            const books = myHistory[i] || [];
            const count = books.length;
            const baseCls = `relative p-1 min-h-[4rem] sm:min-h-[4.5rem] border rounded-xl flex flex-col items-center justify-start pt-1 ${
                i === now.getDate() ? "bg-indigo-50 border-indigo-200" : "bg-slate-50 border-transparent"
            }`;
            const inner = (
                <>
                    <span className="text-xs sm:text-sm font-bold text-slate-400 shrink-0">{i}</span>
                    <div className="flex flex-wrap justify-center gap-0.5 mt-0.5 w-full px-0.5 pointer-events-none">
                        {count > 0 &&
                            books.slice(0, 3).map((bp, idx) =>
                                bp.coverImageUrl ? (
                                    <img
                                        key={`${bp.id}-${idx}`}
                                        src={bp.coverImageUrl}
                                        alt=""
                                        className="w-6 h-[2.1rem] sm:w-7 sm:h-9 object-cover rounded-md border border-white shadow-sm"
                                    />
                                ) : (
                                    <i key={`${bp.id}-${idx}`} className="fa-solid fa-book text-[10px] sm:text-xs text-indigo-400 leading-none py-1"></i>
                                )
                            )}
                        {count > 3 && <span className="text-[9px] sm:text-[10px] font-bold text-indigo-600 leading-none self-center">+</span>}
                    </div>
                </>
            );
            days.push(
                count > 0 ? (
                    <button
                        key={i}
                        type="button"
                        className={`${baseCls} w-full cursor-pointer transition hover:ring-2 hover:ring-indigo-400 hover:ring-offset-1 text-inherit font-inherit p-1`}
                        onClick={() => setReadingCalendarModal({ dateLabel: `${mo + 1}월 ${i}일`, books: [...books] })}
                    >
                        {inner}
                    </button>
                ) : (
                    <div key={i} className={baseCls}>
                        {inner}
                    </div>
                )
            );
        }
        return days;
    };

    const classStats = useMemo(() => {
        if (!appUser || appUser.role !== "admin") return {};
        return posts
            .filter((p) => p.type === "book" && p.classTeacherId === appUser.id)
            .reduce((acc, p) => {
                acc[p.writer] = (acc[p.writer] || 0) + 1;
                return acc;
            }, {});
    }, [posts, appUser]);

    useEffect(() => {
        if (activeTab !== "secret" || !appUser || appUser.role !== "student") return;
        markMailboxReadForStudent();
    }, [activeTab, appUser, soleAdminId]);

    useEffect(() => {
        if (activeTab !== "secret" || !appUser || appUser.role !== "admin" || !adminChatTarget) return;
        markMailboxReadForTeacher(adminChatTarget.id);
    }, [activeTab, adminChatTarget, appUser]);

    useEffect(() => {
        if (!appUser || appUser.role !== "admin" || activeTab !== "secret" || adminChatTarget) return;
        let cancelled = false;
        const studs = myClassStudents(allUsers, appUser.id);
        (async () => {
            const map = {};
            for (const s of studs) {
                const coll = collection(db, "artifacts", appId, "users", s.id, MAILBOX_SUBCOL);
                const snap = await getDocs(coll);
                const unread = snap.docs.some((d) => {
                    const m = d.data();
                    return m.senderId === s.id && m.read === false;
                });
                map[s.id] = unread;
            }
            if (!cancelled) setMailboxUnreadByStudent(map);
        })();
        return () => {
            cancelled = true;
        };
    }, [activeTab, adminChatTarget, appUser, allUsers]);

    if (!appUser) {
        return (
            <div className="fixed inset-0 bg-indigo-600 flex items-center justify-center p-4 sm:p-6 text-white font-sans overflow-y-auto min-h-[100dvh]">
                <div className="text-center w-full max-w-md py-6 sm:py-10 animate-pop">
                    <div className="bg-white/10 backdrop-blur-xl p-6 sm:p-10 rounded-[2.5rem] sm:rounded-[3.5rem] border border-white/20 shadow-2xl">
                        <h1 className="text-3xl sm:text-5xl font-bold font-gaegu mb-2 text-yellow-300">오포초등학교</h1>
                        <h2 className="text-lg sm:text-2xl font-bold font-gaegu mb-6 sm:mb-8 text-indigo-100 italic">디지털 북로드 V5</h2>
                        <div className="space-y-3 text-gray-800 text-left">
                            <label className="text-white text-xs font-bold ml-2">ID</label>
                            <input
                                type="text"
                                value={loginId}
                                onChange={(e) => setLoginId(e.target.value)}
                                placeholder="아이디"
                                className="w-full p-4 sm:p-5 rounded-2xl outline-none shadow-inner text-center font-bold text-base text-slate-800"
                                onKeyDown={(e) => e.key === "Enter" && (isLoginView ? handleLogin() : null)}
                            />
                            <label className="text-white text-xs font-bold ml-2">PASSWORD</label>
                            <input
                                type="password"
                                value={loginPw}
                                onChange={(e) => setLoginPw(e.target.value)}
                                placeholder="비밀번호"
                                className="w-full p-4 sm:p-5 rounded-2xl outline-none shadow-inner text-center font-bold text-base text-slate-800"
                                onKeyDown={(e) => e.key === "Enter" && (isLoginView ? handleLogin() : null)}
                            />
                            {!isLoginView && (
                                <>
                                    <label className="text-white text-xs font-bold ml-2">CONFIRM PASSWORD</label>
                                    <input
                                        type="password"
                                        value={loginPwConfirm}
                                        onChange={(e) => setLoginPwConfirm(e.target.value)}
                                        placeholder="비밀번호 확인"
                                        className="w-full p-4 sm:p-5 rounded-2xl outline-none shadow-inner text-center font-bold text-base text-slate-800"
                                    />
                                    <label className="text-white text-xs font-bold ml-2">NAME</label>
                                    <input
                                        type="text"
                                        value={signupName}
                                        onChange={(e) => setSignupName(e.target.value)}
                                        placeholder="이름 (예: 홍길동)"
                                        className="w-full p-4 sm:p-5 rounded-2xl outline-none shadow-inner text-center font-bold text-base text-slate-800"
                                    />
                                    <label className="text-white text-xs font-bold ml-2">ATTENDANCE NO.</label>
                                    <input
                                        type="number"
                                        value={signupNo}
                                        onChange={(e) => setSignupNo(e.target.value)}
                                        placeholder="출석 번호"
                                        className="w-full p-4 sm:p-5 rounded-2xl outline-none shadow-inner text-center font-bold text-base text-slate-800"
                                        onKeyDown={(e) => e.key === "Enter" && handleSignup()}
                                    />
                                    {!loginId.toLowerCase().includes("admin") && (
                                        <p className="text-indigo-100/90 text-xs px-1 text-center">
                                            가입 후 선생님이 <strong className="text-yellow-200">관리</strong> 탭에서 반 배정·정보 수정을 해 주세요.
                                        </p>
                                    )}
                                </>
                            )}
                            <button
                                onClick={isLoginView ? handleLogin : handleSignup}
                                className="w-full bg-yellow-400 text-indigo-900 font-bold p-4 sm:p-5 rounded-2xl text-lg sm:text-xl active:scale-95 transition shadow-lg mt-4"
                            >
                                {isLoginView ? "작가 로그인 🎒" : "작가 등록하기 ✨"}
                            </button>
                            <button
                                onClick={() => setIsLoginView(!isLoginView)}
                                className="text-white/80 text-sm font-bold underline mt-4 sm:mt-6 block mx-auto text-center"
                            >
                                {isLoginView ? "처음 왔나요? (회원가입)" : "아이디가 있나요? (로그인)"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const myStudents = appUser.role === "admin" ? myClassStudents(allUsers, appUser.id) : [];
    const unassigned = appUser.role === "admin" ? studentsWithoutHomeroom(allUsers) : [];

    return (
        <div className="app-shell max-w-[min(100%,96rem)] mx-auto w-full px-3 sm:px-5 md:px-8 lg:px-12 font-sans">
            <header className="shrink-0 flex flex-wrap justify-between items-center gap-3 mb-3 sm:mb-4 pt-3 sm:pt-4 px-1">
                <div className="flex items-center gap-3 sm:gap-5 min-w-0">
                    <div className="w-14 h-14 sm:w-20 sm:h-20 shrink-0 rounded-2xl sm:rounded-3xl bg-white shadow-lg flex items-center justify-center text-indigo-200 text-2xl sm:text-3xl overflow-hidden border-2 border-white">
                        {appUser.profileImg ? (
                            <img src={appUser.profileImg} className="w-full h-full object-cover" alt="" />
                        ) : (
                            <i className="fa-solid fa-user"></i>
                        )}
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-xl sm:text-3xl font-bold text-slate-800 font-gaegu leading-tight mb-1 truncate">
                            <span className="text-indigo-600">{appUser.name}</span> {appUser.role === "admin" ? "선생님" : "작가님"}
                        </h2>
                        <div className="flex flex-wrap items-center gap-2">
                            {appUser.role !== "admin" && (
                                <span className="text-xs sm:text-sm text-slate-500 font-bold tracking-widest">{appUser.no}번</span>
                            )}
                        </div>
                    </div>
                </div>
                <button
                    onClick={logout}
                    className="text-slate-500 text-sm sm:text-base font-bold hover:text-red-500 transition-colors shrink-0 px-2 py-1"
                >
                    로그아웃
                </button>
            </header>

            <main className="app-main">
                {activeTab === "feed" && (
                    <div className="animate-pop flex-1 flex flex-col min-h-0 w-full">
                        <div className="app-feed-panel">
                            <div className="shrink-0 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 sm:gap-4 mb-3 sm:mb-4">
                                <div className="w-full max-w-5xl">
                                    <h3 className="font-bold text-slate-800 text-2xl sm:text-4xl font-gaegu leading-tight">우리 반 피드 📚✨</h3>
                                    <p className="text-slate-600 text-base sm:text-xl mt-1 max-w-5xl leading-snug">
                                        우리 반 친구들의 <strong className="text-indigo-700">독서 기록</strong>이 모여요.
                                    </p>
                                </div>
                            </div>
                            {appUser.role === "student" && !effectiveClassTeacherId(appUser, soleAdminId) && (
                                <div className="shrink-0 bg-amber-50 border-2 border-amber-200 rounded-2xl sm:rounded-3xl p-4 sm:p-5 text-amber-950 text-sm sm:text-base font-bold mb-3">
                                    관리자(선생님) 계정을 아직 불러오지 못했어요. 네트워크 확인 후 새로고침 하거나, 선생님께 문의해 주세요.
                                </div>
                            )}
                            {classFeed.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-8 sm:py-12 min-h-[12rem] border-2 border-dashed border-indigo-200/80 rounded-2xl sm:rounded-3xl bg-indigo-50/40">
                                    <div className="text-6xl sm:text-8xl mb-4 sm:mb-6 opacity-90" aria-hidden="true">
                                        📖
                                    </div>
                                    <p className="text-slate-600 font-gaegu text-xl sm:text-3xl font-bold leading-tight mb-2">
                                        아직 피드에 올라온 글이 없어요
                                    </p>
                                    <p className="text-slate-500 text-sm sm:text-lg max-w-lg mb-6 sm:mb-8">
                                        독서 탭에서 기록을 남기면 카드가 쌓여요.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setActiveTab("write-book");
                                            setBookSubTab("compose");
                                        }}
                                        className="w-full max-w-sm bg-indigo-600 text-white font-bold py-4 sm:py-5 px-6 rounded-2xl text-base sm:text-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-[0.98] transition"
                                    >
                                        독서 기록 쓰러 가기 →
                                    </button>
                                </div>
                            ) : (
                                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-4 sm:space-y-5 pr-1 -mr-0.5 pb-1">
                                    {classFeed.map((post) => {
                                        const likes = post.likes || [];
                                        const comments = post.comments || [];
                                        const isLiked = likes.some((l) => l.id === appUser.id);
                                        const canDelete = canDeletePost(post);
                                        const merged = { ...post, likes, comments };
                                        return (
                                            <div
                                                key={post.id}
                                                className="bg-white rounded-[1.75rem] sm:rounded-[2rem] p-5 sm:p-8 shadow-sm border-4 border-white mb-2 relative transition hover:shadow-md"
                                            >
                                                {canDelete && (
                                                    <button
                                                        onClick={() => deletePost(post.id)}
                                                        className="absolute top-5 right-5 sm:top-8 sm:right-8 text-slate-200 hover:text-red-400 transition-colors text-lg z-10"
                                                        aria-label="삭제"
                                                    >
                                                        <i className="fa-solid fa-trash-can"></i>
                                                    </button>
                                                )}
                                                {post.type === "book" ? (
                                                    <BookFeedCardInner post={merged} />
                                                ) : (
                                                    <LifeFeedCardInner post={merged} />
                                                )}
                                                <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-slate-50">
                                                    <button
                                                        onClick={() => toggleLike(post.id)}
                                                        className={`px-5 py-2.5 rounded-full border transition-all text-sm sm:text-base font-bold ${
                                                            isLiked
                                                                ? "text-pink-500 bg-pink-50 border-pink-100"
                                                                : "text-slate-400 bg-slate-50 border-transparent"
                                                        }`}
                                                    >
                                                        <i className={`fa-${isLiked ? "solid" : "regular"} fa-heart mr-1`}></i>
                                                        {likes.length}
                                                    </button>
                                                    <button
                                                        onClick={() => setShowComments(merged)}
                                                        className="px-5 py-2.5 rounded-full bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors font-bold text-sm sm:text-base"
                                                    >
                                                        <i className="fa-regular fa-comment mr-1"></i>
                                                        {comments.length} 댓글
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === "write-book" && (
                    <div className="flex-1 flex flex-col min-h-0 animate-pop w-full">
                        <div className="app-feed-panel flex flex-col min-h-0 flex-1">
                            <div className="flex flex-wrap gap-2 p-1.5 bg-slate-100 rounded-2xl shrink-0 mb-4">
                                {appUser.role === "admin" && (
                                    <button
                                        type="button"
                                        onClick={() => setBookSubTab("classreading")}
                                        className={`flex-1 min-w-[6.5rem] py-3 sm:py-3.5 rounded-xl font-bold text-base sm:text-lg transition ${
                                            bookSubTab === "classreading" ? "bg-white text-indigo-700 shadow-md" : "text-slate-600 hover:text-slate-800"
                                        }`}
                                    >
                                        반 독서 현황
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setBookSubTab("compose")}
                                    className={`flex-1 min-w-[6.5rem] py-3 sm:py-3.5 rounded-xl font-bold text-base sm:text-lg transition ${
                                        bookSubTab === "compose" ? "bg-white text-indigo-700 shadow-md" : "text-slate-600 hover:text-slate-800"
                                    }`}
                                >
                                    독서기록장
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setBookSubTab("history")}
                                    className={`flex-1 min-w-[6.5rem] py-3 sm:py-3.5 rounded-xl font-bold text-base sm:text-lg transition ${
                                        bookSubTab === "history" ? "bg-white text-indigo-700 shadow-md" : "text-slate-600 hover:text-slate-800"
                                    }`}
                                >
                                    독서 흔적
                                </button>
                            </div>
                            {bookSubTab === "classreading" && appUser.role === "admin" ? (
                                <div className="flex-1 flex flex-col min-h-0 gap-4">
                                    <div className="w-full rounded-2xl border-2 border-indigo-100 bg-indigo-50/90 p-4 sm:p-5 text-slate-800 text-base leading-snug shrink-0">
                                        캘린더에서 <strong className="text-indigo-800">날짜</strong>를 고르면, 그날 우리 반 학생이{' '}
                                        <strong className="text-indigo-800">독서 기록(피드 올리기)</strong>를 했는지 한눈에 볼 수 있어요.
                                    </div>
                                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white/95">
                                        <div className="flex flex-wrap items-center justify-between gap-2 p-3 sm:p-4 border-b border-slate-100 bg-slate-50/80 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setAdminBookPick((prev) => {
                                                        let nm = prev.m - 1;
                                                        let ny = prev.y;
                                                        if (nm < 0) {
                                                            nm = 11;
                                                            ny -= 1;
                                                        }
                                                        const maxD = new Date(ny, nm + 1, 0).getDate();
                                                        return { y: ny, m: nm, d: Math.min(prev.d, maxD) };
                                                    })
                                                }
                                                className="px-4 py-2 rounded-xl bg-white border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 text-sm sm:text-base"
                                            >
                                                ← 이전 달
                                            </button>
                                            <span className="font-bold text-slate-800 text-lg font-gaegu">
                                                {adminBookPick.y}년 {adminBookPick.m + 1}월
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setAdminBookPick((prev) => {
                                                        let nm = prev.m + 1;
                                                        let ny = prev.y;
                                                        if (nm > 11) {
                                                            nm = 0;
                                                            ny += 1;
                                                        }
                                                        const maxD = new Date(ny, nm + 1, 0).getDate();
                                                        return { y: ny, m: nm, d: Math.min(prev.d, maxD) };
                                                    })
                                                }
                                                className="px-4 py-2 rounded-xl bg-white border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 text-sm sm:text-base"
                                            >
                                                다음 달 →
                                            </button>
                                        </div>
                                        <div className="p-3 sm:p-5 border-b border-slate-100 bg-white shrink-0">
                                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">캘린더 · 독서 기록 수</p>
                                            <div className="grid grid-cols-7 gap-1 sm:gap-2 max-w-md mx-auto sm:max-w-lg">
                                                {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
                                                    <div key={w} className="text-center text-[10px] sm:text-xs font-bold text-slate-500 py-1">
                                                        {w}
                                                    </div>
                                                ))}
                                                {(() => {
                                                    const y = adminBookPick.y;
                                                    const m = adminBookPick.m;
                                                    const firstWd = new Date(y, m, 1).getDay();
                                                    const lastDay = new Date(y, m + 1, 0).getDate();
                                                    const cells = [];
                                                    for (let i = 0; i < firstWd; i++) cells.push(null);
                                                    for (let d = 1; d <= lastDay; d++) cells.push(d);
                                                    return cells.map((day, idx) =>
                                                        day == null ? (
                                                            <div key={`be-${idx}`} className="min-h-[2.5rem] sm:min-h-[2.75rem]" />
                                                        ) : (
                                                            <button
                                                                key={day}
                                                                type="button"
                                                                onClick={() => setAdminBookPick({ y, m, d: day })}
                                                                className={`relative min-h-[2.5rem] sm:min-h-[2.75rem] rounded-xl text-sm font-bold transition border-2 flex flex-col items-center justify-center gap-0.5 ${
                                                                    adminBookPick.d === day
                                                                        ? "border-indigo-500 bg-indigo-100 text-indigo-900 shadow-sm"
                                                                        : "border-slate-100 bg-slate-50/80 text-slate-800 hover:border-indigo-200 hover:bg-indigo-50/50"
                                                                }`}
                                                            >
                                                                <span>{day}</span>
                                                                {(adminBookCountsByDay[day] ?? 0) > 0 && (
                                                                    <span className="text-[9px] sm:text-[10px] font-black text-indigo-700 leading-none">
                                                                        {adminBookCountsByDay[day]}
                                                                    </span>
                                                                )}
                                                            </button>
                                                        )
                                                    );
                                                })()}
                                            </div>
                                            <p className="text-center text-xs text-slate-500 mt-3">숫자는 그날 기록을 올린 학생 수예요.</p>
                                        </div>
                                        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 sm:p-5">
                                            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                                                <h4 className="font-bold text-slate-900 text-lg sm:text-xl font-gaegu">
                                                    {adminBookPick.y}년 {adminBookPick.m + 1}월 {adminBookPick.d}일 · 독서 기록
                                                </h4>
                                                <span className="text-sm font-bold text-slate-500">
                                                    기록{" "}
                                                    {
                                                        myStudents.filter((stu) =>
                                                            studentBookPostOnDate(posts, stu.id, adminBookPick.y, adminBookPick.m, adminBookPick.d)
                                                        ).length
                                                    }
                                                    명 / {myStudents.length}명 배정
                                                </span>
                                            </div>
                                            <div className="space-y-2">
                                                {Array.from({ length: 25 }, (_, idx) => {
                                                    const no = idx + 1;
                                                    const stu = myStudents.find((s) => String(s.no) === String(no));
                                                    const post = stu
                                                        ? studentBookPostOnDate(posts, stu.id, adminBookPick.y, adminBookPick.m, adminBookPick.d)
                                                        : null;
                                                    const preview = post
                                                        ? post.memorableScene || post.myThought || post.favoriteQuote || post.content || ""
                                                        : "";
                                                    return (
                                                        <div
                                                            key={no}
                                                            className={`rounded-2xl border-2 px-3 py-3 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 ${
                                                                post ? "border-indigo-100 bg-indigo-50/50" : "border-slate-100 bg-slate-50/60"
                                                            }`}
                                                        >
                                                            <div className="font-bold text-slate-800 shrink-0 sm:w-36">
                                                                {no}번 {stu?.name || "—"}
                                                            </div>
                                                            <div className="min-w-0 flex-1 text-sm sm:text-base">
                                                                {!stu ? (
                                                                    <span className="text-slate-400 font-bold">해당 번호 학생 없음</span>
                                                                ) : post ? (
                                                                    <>
                                                                        <p className="font-bold text-indigo-900 font-gaegu">📖 {post.title}</p>
                                                                        <p className="text-slate-600 text-xs sm:text-sm mt-0.5">{post.author}</p>
                                                                        {preview && (
                                                                            <p className="text-slate-700 line-clamp-2 whitespace-pre-wrap leading-snug mt-2">{preview}</p>
                                                                        )}
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setBookDetailModal(post)}
                                                                            className="mt-2 text-sm font-bold text-indigo-700 hover:underline"
                                                                        >
                                                                            전체 보기
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <span className="text-slate-400 font-bold">미제출</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : bookSubTab === "history" ? (
                                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 space-y-4">
                                    <p className="text-sm sm:text-base text-slate-500 font-bold px-1">카드를 누르면 피드와 같은 형태로 전체 내용을 볼 수 있어요.</p>
                                    {posts.filter((p) => p.writerId === appUser.id && p.type === "book").length === 0 ? (
                                        <div className="text-center py-20 text-slate-500 text-lg font-bold">아직 기록이 없어요.</div>
                                    ) : (
                                        posts
                                            .filter((p) => p.writerId === appUser.id && p.type === "book")
                                            .map((post) => (
                                                <div
                                                    key={post.id}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => setBookDetailModal(post)}
                                                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setBookDetailModal(post))}
                                                    className="bg-white/95 p-5 sm:p-6 rounded-2xl border-2 border-white shadow-sm flex gap-4 cursor-pointer hover:border-indigo-200 hover:shadow-md transition text-left w-full"
                                                >
                                                    {post.coverImageUrl ? (
                                                        <img src={post.coverImageUrl} alt="" className="w-20 h-28 sm:w-24 sm:h-32 rounded-xl object-cover border-2 border-white shadow shrink-0" />
                                                    ) : (
                                                        <div className="w-20 h-28 sm:w-24 sm:h-32 rounded-xl bg-indigo-100 flex items-center justify-center text-3xl shrink-0">📖</div>
                                                    )}
                                                    <div className="min-w-0 flex-1 text-base sm:text-lg">
                                                        <p className="text-sm font-bold text-indigo-500 mb-1">{new Date(post.timestamp).toLocaleDateString()}</p>
                                                        <h4 className="font-bold text-slate-900 font-gaegu text-xl sm:text-2xl mb-2">📖 {post.title}</h4>
                                                        <p className="text-slate-600 mb-1">{post.author}</p>
                                                        {post.favoriteQuote && (
                                                            <p className="text-amber-900/90 italic line-clamp-2 mt-2">&ldquo;{post.favoriteQuote}&rdquo;</p>
                                                        )}
                                                        <p className="text-slate-700 line-clamp-3 mt-2 whitespace-pre-wrap leading-relaxed">
                                                            {post.memorableScene || post.myThought || post.content}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))
                                    )}
                                </div>
                            ) : (
                                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                                    <div className="w-full max-w-5xl mx-auto bg-white/95 rounded-[1.75rem] sm:rounded-[2rem] p-6 sm:p-10 shadow-md border-2 border-white">
                            <h3 className="text-2xl sm:text-4xl font-bold mb-2 text-slate-800 font-gaegu text-center underline decoration-indigo-100">
                                📖 독서기록장
                            </h3>
                            <p className="text-base sm:text-lg text-slate-600 text-center mb-6 leading-snug">
                                책을 고르고, 인용과 생각만 채워도 좋아요. <strong>제목</strong>은 꼭 적어 주세요.
                            </p>
                            <div className="space-y-4 sm:space-y-5">
                                <div className="p-4 rounded-2xl bg-sky-50/90 border-2 border-sky-100 space-y-3">
                                    <p className="text-sm sm:text-base font-bold text-sky-900">
                                        알라딘에서 책 찾기 <span className="font-normal text-sky-700">(제목 검색 → 제목·저자·표지)</span>
                                    </p>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <input
                                            value={aladinQueryInput}
                                            onChange={(e) => setAladinQueryInput(e.target.value)}
                                            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), runAladinSearch())}
                                            placeholder="검색할 책 제목"
                                            className="flex-1 p-4 rounded-xl bg-white border border-sky-200 text-base outline-none focus:border-sky-400"
                                            autoComplete="off"
                                        />
                                        <button
                                            type="button"
                                            onClick={runAladinSearch}
                                            disabled={aladinLoading}
                                            className="shrink-0 px-5 py-3 rounded-xl bg-sky-600 text-white font-bold text-base disabled:opacity-50 active:scale-[0.99] transition"
                                        >
                                            {aladinLoading ? "검색 중…" : "검색"}
                                        </button>
                                    </div>
                                    {aladinResults.length > 0 && (
                                        <ul className="max-h-52 overflow-y-auto custom-scrollbar space-y-2 border-t border-sky-100 pt-3">
                                            {aladinResults.map((it, idx) => (
                                                <li key={`${it.itemId || it.isbn13 || idx}-${idx}`} className="flex gap-3 items-center bg-white/90 rounded-xl p-2 border border-sky-100">
                                                    {it.cover ? (
                                                        <img src={it.cover} alt="" className="w-10 h-14 object-cover rounded-lg border shrink-0" />
                                                    ) : (
                                                        <div className="w-10 h-14 rounded-lg bg-sky-100 shrink-0 flex items-center justify-center text-xs">📚</div>
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs font-bold text-slate-800 line-clamp-2 leading-snug">{it.title}</p>
                                                        <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{it.author}</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => applyAladinBook(it)}
                                                        className="shrink-0 text-xs font-bold text-sky-700 bg-sky-100 px-3 py-2 rounded-lg hover:bg-sky-200 transition"
                                                    >
                                                        적용
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                                <input
                                    id="book-title"
                                    placeholder="책 제목 (필수)"
                                    className="w-full p-4 sm:p-5 text-base sm:text-lg bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-indigo-400 shadow-inner"
                                />
                                <input
                                    id="book-author"
                                    placeholder="저자(지은이)"
                                    className="w-full p-4 sm:p-5 text-base sm:text-lg bg-slate-50 rounded-2xl outline-none border-2 border-transparent focus:border-indigo-400"
                                />
                                <div className="p-4 rounded-2xl bg-indigo-50/80 border border-indigo-100 space-y-2">
                                    <p className="text-sm font-bold text-indigo-700">책 표지·썸네일 (선택)</p>
                                    {selectedBookCover && (
                                        <div className="relative inline-block">
                                            <img src={selectedBookCover} alt="" className="h-28 rounded-xl border-2 border-white shadow object-cover" />
                                            <button type="button" onClick={() => setSelectedBookCover(null)} className="absolute -top-2 -right-2 bg-slate-800 text-white w-8 h-8 rounded-full text-sm">
                                                ×
                                            </button>
                                        </div>
                                    )}
                                    <label className="flex items-center justify-center gap-2 w-full p-3 bg-white rounded-xl border-2 border-dashed border-indigo-200 cursor-pointer text-indigo-600 font-bold text-sm">
                                        <i className="fa-solid fa-image"></i> 이미지 넣기
                                        <input type="file" className="hidden" accept="image/*" onChange={handleBookCoverUpload} />
                                    </label>
                                </div>
                                <div className="rounded-2xl border-2 border-amber-100 bg-amber-50/50 p-4 sm:p-5 space-y-3">
                                    <p className="text-sm sm:text-base font-bold text-amber-900">인용 한 줄</p>
                                    <input
                                        id="book-quote"
                                        placeholder="책에서 마음에 드는 문장을 그대로 적어 보세요"
                                        className="w-full p-4 rounded-xl bg-white border border-amber-200/80 text-base outline-none"
                                    />
                                    <input
                                        id="book-quote-why"
                                        placeholder="왜 좋았는지 한 줄"
                                        className="w-full p-4 rounded-xl bg-white border border-amber-200/80 text-base outline-none"
                                    />
                                </div>
                                <div className="p-4 rounded-2xl bg-indigo-50/90 border border-indigo-100 text-center">
                                    <p className="text-sm sm:text-base font-bold text-indigo-800 leading-relaxed">
                                        글 뼈대: 인상 깊은 장면 → 나의 생각 → 다음에 궁금한 점
                                        <span className="font-normal text-indigo-600"> (순서는 바꿔도 돼요)</span>
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm sm:text-base font-bold text-indigo-600">인상 깊은 장면</label>
                                    <textarea id="book-scene" placeholder="어떤 장면이 가장 기억에 남나요?" className="w-full p-4 rounded-xl bg-slate-50 text-base min-h-[5.5rem] outline-none border-2 border-transparent focus:border-indigo-300 resize-y" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm sm:text-base font-bold text-indigo-600">나의 생각</label>
                                    <textarea id="book-thought" placeholder="읽고 나서 어떤 생각이 들었나요?" className="w-full p-4 rounded-xl bg-slate-50 text-base min-h-[5.5rem] outline-none border-2 border-transparent focus:border-indigo-300 resize-y" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm sm:text-base font-bold text-indigo-600">다음에 궁금한 점</label>
                                    <textarea id="book-curious" placeholder="이어서 읽거나 찾아보고 싶은 것" className="w-full p-4 rounded-xl bg-slate-50 text-base min-h-[5.5rem] outline-none border-2 border-transparent focus:border-indigo-300 resize-y" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm sm:text-base font-bold text-slate-500">더 자유롭게 쓰기 (선택)</label>
                                    <textarea
                                        id="book-content"
                                        placeholder="위 내용을 합쳐 쓰거나, 추가로 하고 싶은 말"
                                        className="w-full p-4 sm:p-5 text-base sm:text-lg bg-slate-50 rounded-2xl min-h-[9rem] outline-none resize-y leading-relaxed border-2 border-transparent focus:border-indigo-400 shadow-inner"
                                    ></textarea>
                                </div>
                                <div className="flex flex-col sm:flex-row flex-wrap gap-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={saveBookDraftLocal}
                                        className="flex-1 min-w-[10rem] bg-white text-indigo-700 font-bold p-4 sm:p-5 rounded-3xl text-base sm:text-lg border-2 border-indigo-200 shadow-sm hover:bg-indigo-50 active:scale-[0.99] transition-all"
                                    >
                                        임시 저장 💾
                                    </button>
                                    <button
                                        type="button"
                                        onClick={restoreBookDraftLocal}
                                        className="flex-1 min-w-[10rem] bg-slate-100 text-slate-800 font-bold p-4 sm:p-5 rounded-3xl text-base sm:text-lg border-2 border-slate-200 hover:bg-slate-200 active:scale-[0.99] transition-all"
                                    >
                                        불러오기 📂
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => savePost("book")}
                                        className="flex-[2] min-w-[12rem] bg-indigo-600 text-white font-bold p-5 sm:p-6 rounded-3xl text-lg sm:text-xl shadow-xl active:scale-95 transition-all"
                                    >
                                        피드에 올리기 🚀
                                    </button>
                                </div>
                            </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === "write-life" && (
                    <div className="flex-1 flex flex-col min-h-0 w-full animate-pop">
                        <div className="app-feed-panel flex flex-col min-h-0 flex-1">
                            <div className="flex flex-wrap gap-2 p-1.5 bg-slate-100 rounded-2xl shrink-0 mb-4">
                                <button
                                    type="button"
                                    onClick={() => setLifeSubTab("daily")}
                                    className={`flex-1 min-w-[5.5rem] py-3 sm:py-3.5 rounded-xl font-bold text-base sm:text-lg transition ${
                                        lifeSubTab === "daily" ? "bg-white text-emerald-700 shadow-md" : "text-slate-600 hover:text-slate-800"
                                    }`}
                                >
                                    오늘의 조각
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setLifeSubTab("topic")}
                                    className={`flex-1 min-w-[5.5rem] py-3 sm:py-3.5 rounded-xl font-bold text-base sm:text-lg transition ${
                                        lifeSubTab === "topic" ? "bg-white text-emerald-700 shadow-md" : "text-slate-600 hover:text-slate-800"
                                    }`}
                                >
                                    주제 글쓰기
                                </button>
                                {appUser.role !== "admin" && (
                                    <button
                                        type="button"
                                        onClick={() => setLifeSubTab("my")}
                                        className={`flex-1 min-w-[5.5rem] py-3 sm:py-3.5 rounded-xl font-bold text-base sm:text-lg transition ${
                                            lifeSubTab === "my" ? "bg-white text-emerald-700 shadow-md" : "text-slate-600 hover:text-slate-800"
                                        }`}
                                    >
                                        내 조각 모음
                                    </button>
                                )}
                            </div>

                            {lifeSubTab === "my" && appUser.role !== "admin" && (
                                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 space-y-8">
                                    {myLifePostsSorted.length === 0 ? (
                                        <div className="text-center py-20 text-slate-500 text-lg font-bold">첫 조각을 남겨 보세요.</div>
                                    ) : (
                                        <>
                                            <section className="space-y-3">
                                                <h4 className="text-lg sm:text-xl font-bold text-emerald-800 font-gaegu border-b-2 border-emerald-100 pb-2">
                                                    ✨ 오늘의 조각
                                                </h4>
                                                {myLifeDailyList.length === 0 ? (
                                                    <p className="text-slate-500 text-sm sm:text-base font-bold pl-1">아직 없어요.</p>
                                                ) : (
                                                    <div className="space-y-4">
                                                        {myLifeDailyList.map((post) => (
                                                            <div
                                                                key={post.id}
                                                                className="bg-white/95 p-5 sm:p-6 rounded-2xl shadow-sm border-2 border-white flex gap-4 items-start"
                                                            >
                                                                {post.imageUrl && (
                                                                    <img src={post.imageUrl} className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover border shrink-0" alt="" />
                                                                )}
                                                                <div className="min-w-0 flex-1 text-base sm:text-lg">
                                                                    <p className="text-sm font-bold text-emerald-600 mb-1">{new Date(post.timestamp).toLocaleDateString()}</p>
                                                                    {(post.moodEmoji || post.moodLabel) && (
                                                                        <p className="font-bold text-emerald-900">
                                                                            {post.moodEmoji} {post.moodLabel}
                                                                            {post.moodWhy && <span className="font-normal text-slate-600"> — {post.moodWhy}</span>}
                                                                        </p>
                                                                    )}
                                                                    {post.imageCaption && (
                                                                        <p className="text-slate-600 italic mt-1">📷 {post.imageCaption}</p>
                                                                    )}
                                                                    <p className="text-slate-800 mt-2 whitespace-pre-wrap leading-relaxed">{post.content}</p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </section>
                                            <section className="space-y-3">
                                                <h4 className="text-lg sm:text-xl font-bold text-violet-800 font-gaegu border-b-2 border-violet-100 pb-2">
                                                    📝 주제 글쓰기
                                                </h4>
                                                {myLifeTopicList.length === 0 ? (
                                                    <p className="text-slate-500 text-sm sm:text-base font-bold pl-1">아직 없어요.</p>
                                                ) : (
                                                    <div className="space-y-4">
                                                        {myLifeTopicList.map((post) => (
                                                            <div
                                                                key={post.id}
                                                                className="bg-white/95 p-5 sm:p-6 rounded-2xl shadow-sm border-2 border-violet-100/80 flex gap-4 items-start"
                                                            >
                                                                {post.imageUrl && (
                                                                    <img src={post.imageUrl} className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover border shrink-0" alt="" />
                                                                )}
                                                                <div className="min-w-0 flex-1 text-base sm:text-lg">
                                                                    <p className="text-sm font-bold text-violet-600 mb-1">{new Date(post.timestamp).toLocaleDateString()}</p>
                                                                    {post.writingPromptTopic && (
                                                                        <p className="text-xs sm:text-sm font-bold text-violet-800 mb-2 leading-snug">
                                                                            주제 · {post.writingPromptTopic}
                                                                        </p>
                                                                    )}
                                                                    {(post.moodEmoji || post.moodLabel) && (
                                                                        <p className="font-bold text-emerald-900">
                                                                            {post.moodEmoji} {post.moodLabel}
                                                                            {post.moodWhy && <span className="font-normal text-slate-600"> — {post.moodWhy}</span>}
                                                                        </p>
                                                                    )}
                                                                    {post.imageCaption && (
                                                                        <p className="text-slate-600 italic mt-1">📷 {post.imageCaption}</p>
                                                                    )}
                                                                    <p className="text-slate-800 mt-2 whitespace-pre-wrap leading-relaxed">{post.content}</p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </section>
                                        </>
                                    )}
                                </div>
                            )}

                            {lifeSubTab === "topic" && appUser.role === "admin" && (
                                <div className="flex-1 flex flex-col min-h-0 gap-4">
                                    <div className="w-full rounded-2xl border-2 border-amber-200 bg-amber-50/95 p-5 sm:p-6 shrink-0">
                                        <h4 className="font-bold text-amber-950 text-lg sm:text-xl font-gaegu mb-2">주제 글쓰기 · 학생 안내</h4>
                                        <p className="text-base text-slate-700 mb-4">
                                            날짜 <strong>{localDateKey()}</strong> · 저장하면 학생 <strong>주제 글쓰기</strong> 탭 상단에 보여요. 비우고 저장하면 날짜별{' '}
                                            <strong>오늘의 글감</strong>만 보여요.
                                        </p>
                                        <textarea
                                            value={adminPromptInput}
                                            onChange={(e) => setAdminPromptInput(e.target.value)}
                                            placeholder="예: 오늘 점심시간에 있었던 일을 친구에게 말하듯 써 보기"
                                            className="w-full min-h-[6rem] p-4 rounded-2xl bg-white border-2 border-amber-100 outline-none text-base mb-3"
                                        />
                                        <p className="text-sm text-amber-900/90 font-bold mb-2">초등 5학년 창의 글감을 무작위로 골라 넣어요. 마음에 들면 저장해 주세요.</p>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setAdminPromptInput(pickRandomGrade5CreativePrompt())}
                                                className="px-5 py-3 rounded-xl font-bold border-2 border-amber-400 text-amber-950 bg-amber-100/80 hover:bg-amber-200/90 text-base transition"
                                            >
                                                🎲 랜덤 글감 추천
                                            </button>
                                            <button
                                                type="button"
                                                onClick={saveTodayWritingPrompt}
                                                className="px-5 py-3 rounded-xl bg-amber-500 text-white font-bold text-base hover:bg-amber-600 transition"
                                            >
                                                저장
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setAdminPromptInput(dailyPromptDoc?.topic || "")}
                                                className="px-5 py-3 rounded-xl font-bold border-2 border-amber-300 text-amber-900 bg-white hover:bg-amber-50 text-base"
                                            >
                                                불러오기
                                            </button>
                                            <button
                                                type="button"
                                                onClick={deleteTodayWritingPrompt}
                                                className="px-5 py-3 rounded-xl font-bold border-2 border-red-200 text-red-700 bg-white hover:bg-red-50 text-base"
                                            >
                                                삭제
                                            </button>
                                        </div>
                                        <p className="text-base text-slate-700 mt-4 pt-4 border-t border-amber-200/60 leading-relaxed">
                                            <span className="font-bold text-amber-900">학생에게 보이는 문장:</span> &ldquo;{todayWritingHint.text}&rdquo;
                                        </p>
                                    </div>
                                    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 space-y-6">
                                        <h3 className="font-bold text-slate-800 text-xl sm:text-2xl font-gaegu">주제별 학생 글</h3>
                                        {classTopicOnlyGroupedForAdmin.length === 0 ? (
                                            <div className="text-center py-20 text-slate-500 text-lg font-bold">아직 주제 글이 없어요.</div>
                                        ) : (
                                            classTopicOnlyGroupedForAdmin.map(([topicLabel, plist]) => (
                                                <div key={topicLabel} className="space-y-3">
                                                    <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/95 px-4 py-3 sm:px-5 sm:py-4 shadow-sm">
                                                        <p className="text-xs font-bold text-violet-800 uppercase tracking-wide">쓰기 주제</p>
                                                        <p className="text-base sm:text-lg font-bold text-slate-900 mt-1 leading-snug">{topicLabel}</p>
                                                        <p className="text-sm text-slate-600 mt-1 font-bold">{plist.length}개의 글</p>
                                                    </div>
                                                    <div className="space-y-3 pl-0 sm:pl-1">
                                                        {[...plist].sort((a, b) => b.timestamp - a.timestamp).map((post) => (
                                                            <div
                                                                key={post.id}
                                                                className="bg-white/95 p-5 sm:p-6 rounded-2xl border-2 border-white shadow-sm flex gap-4 items-start"
                                                            >
                                                                {post.imageUrl && (
                                                                    <img src={post.imageUrl} className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover border shrink-0" alt="" />
                                                                )}
                                                                <div className="min-w-0 flex-1 text-base sm:text-lg">
                                                                    <p className="font-bold text-emerald-800 text-lg">
                                                                        {post.writer}
                                                                        {post.writerNo != null && post.writerNo !== "" ? ` · ${post.writerNo}번` : ""}
                                                                    </p>
                                                                    <p className="text-sm font-bold text-slate-500 mb-2">{new Date(post.timestamp).toLocaleString()}</p>
                                                                    {(post.moodEmoji || post.moodLabel) && (
                                                                        <p className="text-slate-800 font-bold">
                                                                            {post.moodEmoji} {post.moodLabel}
                                                                            {post.moodWhy && <span className="font-normal text-slate-600"> — {post.moodWhy}</span>}
                                                                        </p>
                                                                    )}
                                                                    {post.imageCaption && <p className="text-slate-600 italic mt-1">📷 {post.imageCaption}</p>}
                                                                    <p className="text-slate-800 mt-2 whitespace-pre-wrap leading-relaxed">{post.content}</p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}

                            {lifeSubTab === "daily" && appUser.role === "admin" && (
                                <div className="flex-1 flex flex-col min-h-0 gap-4">
                                    <div className="w-full rounded-2xl border-2 border-slate-200 bg-slate-50/95 p-4 sm:p-5 text-slate-800 text-base leading-snug shrink-0">
                                        <span className="font-bold text-slate-900">주제 문장</span>은 <strong className="text-emerald-800">주제 글쓰기</strong> 탭에서 설정해요. 캘린더에서{' '}
                                        <strong className="text-emerald-800">날짜</strong>를 고르면 그날 1~25번 학생이 무엇을 썼는지 한눈에 볼 수 있어요.
                                    </div>
                                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white/95">
                                        <div className="flex flex-wrap items-center justify-between gap-2 p-3 sm:p-4 border-b border-slate-100 bg-slate-50/80 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setAdminDailyPick((prev) => {
                                                        let nm = prev.m - 1;
                                                        let ny = prev.y;
                                                        if (nm < 0) {
                                                            nm = 11;
                                                            ny -= 1;
                                                        }
                                                        const maxD = new Date(ny, nm + 1, 0).getDate();
                                                        return { y: ny, m: nm, d: Math.min(prev.d, maxD) };
                                                    })
                                                }
                                                className="px-4 py-2 rounded-xl bg-white border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 text-sm sm:text-base"
                                            >
                                                ← 이전 달
                                            </button>
                                            <span className="font-bold text-slate-800 text-lg font-gaegu">
                                                {adminDailyPick.y}년 {adminDailyPick.m + 1}월
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setAdminDailyPick((prev) => {
                                                        let nm = prev.m + 1;
                                                        let ny = prev.y;
                                                        if (nm > 11) {
                                                            nm = 0;
                                                            ny += 1;
                                                        }
                                                        const maxD = new Date(ny, nm + 1, 0).getDate();
                                                        return { y: ny, m: nm, d: Math.min(prev.d, maxD) };
                                                    })
                                                }
                                                className="px-4 py-2 rounded-xl bg-white border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 text-sm sm:text-base"
                                            >
                                                다음 달 →
                                            </button>
                                        </div>
                                        <div className="p-3 sm:p-5 border-b border-slate-100 bg-white shrink-0">
                                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">캘린더</p>
                                            <div className="grid grid-cols-7 gap-1 sm:gap-2 max-w-md mx-auto sm:max-w-lg">
                                                {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
                                                    <div key={w} className="text-center text-[10px] sm:text-xs font-bold text-slate-500 py-1">
                                                        {w}
                                                    </div>
                                                ))}
                                                {(() => {
                                                    const y = adminDailyPick.y;
                                                    const m = adminDailyPick.m;
                                                    const firstWd = new Date(y, m, 1).getDay();
                                                    const lastDay = new Date(y, m + 1, 0).getDate();
                                                    const cells = [];
                                                    for (let i = 0; i < firstWd; i++) cells.push(null);
                                                    for (let d = 1; d <= lastDay; d++) cells.push(d);
                                                    return cells.map((day, idx) =>
                                                        day == null ? (
                                                            <div key={`empty-${idx}`} className="min-h-[2.5rem] sm:min-h-[2.75rem]" />
                                                        ) : (
                                                            <button
                                                                key={day}
                                                                type="button"
                                                                onClick={() => setAdminDailyPick({ y, m, d: day })}
                                                                className={`relative min-h-[2.5rem] sm:min-h-[2.75rem] rounded-xl text-sm font-bold transition border-2 flex flex-col items-center justify-center gap-0.5 ${
                                                                    adminDailyPick.d === day
                                                                        ? "border-emerald-500 bg-emerald-100 text-emerald-900 shadow-sm"
                                                                        : "border-slate-100 bg-slate-50/80 text-slate-800 hover:border-emerald-200 hover:bg-emerald-50/50"
                                                                }`}
                                                            >
                                                                <span>{day}</span>
                                                                {(adminDailyCountsByDay[day] ?? 0) > 0 && (
                                                                    <span className="text-[9px] sm:text-[10px] font-black text-emerald-700 leading-none">
                                                                        {adminDailyCountsByDay[day]}
                                                                    </span>
                                                                )}
                                                            </button>
                                                        )
                                                    );
                                                })()}
                                            </div>
                                            <p className="text-center text-xs text-slate-500 mt-3">
                                                숫자는 그날 제출한 학생 수예요. 날짜를 눌러 아래 목록을 바꿀 수 있어요.
                                            </p>
                                        </div>
                                        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 sm:p-5">
                                            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                                                <h4 className="font-bold text-slate-900 text-lg sm:text-xl font-gaegu">
                                                    {adminDailyPick.y}년 {adminDailyPick.m + 1}월 {adminDailyPick.d}일 · 오늘의 조각
                                                </h4>
                                                <span className="text-sm font-bold text-slate-500">
                                                    제출{" "}
                                                    {
                                                        myStudents.filter((stu) =>
                                                            studentDailyLifePostOnDate(posts, stu.id, adminDailyPick.y, adminDailyPick.m, adminDailyPick.d)
                                                        ).length
                                                    }
                                                    명 / {myStudents.length}명 배정
                                                </span>
                                            </div>
                                            <div className="space-y-2">
                                                {Array.from({ length: 25 }, (_, idx) => {
                                                    const no = idx + 1;
                                                    const stu = myStudents.find((s) => String(s.no) === String(no));
                                                    const post = stu
                                                        ? studentDailyLifePostOnDate(posts, stu.id, adminDailyPick.y, adminDailyPick.m, adminDailyPick.d)
                                                        : null;
                                                    return (
                                                        <div
                                                            key={no}
                                                            className={`rounded-2xl border-2 px-3 py-3 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 ${
                                                                post ? "border-emerald-100 bg-emerald-50/40" : "border-slate-100 bg-slate-50/60"
                                                            }`}
                                                        >
                                                            <div className="font-bold text-slate-800 shrink-0 sm:w-36">
                                                                {no}번 {stu?.name || "—"}
                                                            </div>
                                                            <div className="min-w-0 flex-1 text-sm sm:text-base">
                                                                {!stu ? (
                                                                    <span className="text-slate-400 font-bold">해당 번호 학생 없음</span>
                                                                ) : post ? (
                                                                    <>
                                                                        <p className="text-slate-700 line-clamp-3 whitespace-pre-wrap leading-snug">{post.content}</p>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setLifePostDetailModal(post)}
                                                                            className="mt-2 text-sm font-bold text-emerald-700 hover:underline"
                                                                        >
                                                                            전체 보기
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <span className="text-slate-400 font-bold">미제출</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {appUser.role !== "admin" && lifeSubTab === "topic" && (
                                <div className="w-full bg-gradient-to-br from-violet-50 to-indigo-50 border-2 border-violet-200 rounded-2xl sm:rounded-3xl p-5 sm:p-6 mb-4 shrink-0">
                                    <div className="flex flex-wrap items-center gap-2 mb-3">
                                        <span className="text-xs sm:text-sm font-bold bg-violet-600 text-white px-3 py-1 rounded-full">{todayWritingHint.badge}</span>
                                        <span className="text-xs sm:text-sm text-slate-500 font-mono">{todayWritingHint.key}</span>
                                    </div>
                                    <p className="text-base sm:text-lg text-slate-800 font-medium leading-relaxed">&ldquo;{todayWritingHint.text}&rdquo;</p>
                                    <label className="block text-sm font-bold text-violet-900 mt-4 mb-2">주제에 맞춰 여기에 글을 써 주세요</label>
                                    <textarea
                                        id="life-content"
                                        placeholder="이 주제에 대한 생각·느낌·이야기를 자유롭게 적어 보세요."
                                        className="w-full p-4 sm:p-5 text-base sm:text-lg bg-white/95 rounded-2xl min-h-[14rem] outline-none resize-y border-2 border-violet-200/80 focus:border-violet-400 focus:bg-white leading-relaxed shadow-inner"
                                    ></textarea>
                                    <div className="mt-4 flex justify-center w-full">
                                        <button
                                            type="button"
                                            onClick={() => savePost("life", { lifeWritingMode: "topic" })}
                                            className="px-10 py-4 rounded-2xl bg-violet-600 text-white font-bold text-base sm:text-lg shadow-lg hover:bg-violet-700 active:scale-[0.99] transition"
                                        >
                                            저장하기
                                        </button>
                                    </div>
                                </div>
                            )}

                            {appUser.role !== "admin" && lifeSubTab === "daily" && (
                                <>
                                    <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl sm:rounded-3xl p-5 sm:p-6 text-emerald-900 mb-4 shrink-0 w-full">
                                        <p className="font-bold text-lg sm:text-xl">✨ 나만의 일상 조각</p>
                                        <p className="text-base sm:text-lg mt-2 text-emerald-800/95 leading-snug">
                                            <strong>조각 보관하기</strong>를 누르면 나와 선생님(관리)만 볼 수 있어요.
                                        </p>
                                    </div>
                                    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 w-full">
                                        <div className="w-full max-w-5xl mx-auto bg-white/95 rounded-[1.75rem] sm:rounded-[2rem] p-6 sm:p-10 shadow-md border-2 border-white">
                                            <h3 className="text-2xl sm:text-4xl font-bold mb-6 text-slate-800 font-gaegu text-center underline decoration-emerald-100">
                                                ✨ 오늘의 조각
                                            </h3>
                                            <div className="space-y-4 sm:space-y-5">
                                                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
                                                    <p className="text-sm sm:text-base font-bold text-slate-700 mb-3">기분 스티커 (선택)</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {MOOD_PICKS.map((m) => (
                                                            <button
                                                                key={m.id}
                                                                type="button"
                                                                onClick={() => setSelectedMoodId(selectedMoodId === m.id ? "" : m.id)}
                                                                className={`px-4 py-2.5 rounded-xl text-base font-bold border-2 transition ${
                                                                    selectedMoodId === m.id ? "border-emerald-500 bg-emerald-100" : "border-transparent bg-white"
                                                                }`}
                                                            >
                                                                {m.emoji} {m.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const next = !showLifeHints;
                                                        setShowLifeHints(next);
                                                        if (next) setTimeout(() => syncLifeHintsToContent(), 0);
                                                    }}
                                                    className="w-full py-4 rounded-2xl text-base font-bold border-2 border-dashed border-slate-300 text-slate-600 hover:bg-slate-50"
                                                >
                                                    {showLifeHints ? "✓ 오감·5W1H 힌트 접기" : "막히면: 언제·어디서·누가… 힌트 펼치기"}
                                                </button>
                                                {showLifeHints && (
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-4 rounded-2xl bg-teal-50/80 border border-teal-100">
                                                        <input
                                                            id="life-when"
                                                            placeholder="언제"
                                                            onInput={syncLifeHintsToContent}
                                                            className="p-3 rounded-xl text-base border border-teal-100 outline-none"
                                                        />
                                                        <input
                                                            id="life-where"
                                                            placeholder="어디서"
                                                            onInput={syncLifeHintsToContent}
                                                            className="p-3 rounded-xl text-base border border-teal-100 outline-none"
                                                        />
                                                        <input
                                                            id="life-who"
                                                            placeholder="누가"
                                                            onInput={syncLifeHintsToContent}
                                                            className="p-3 rounded-xl text-base border border-teal-100 outline-none"
                                                        />
                                                        <input
                                                            id="life-what"
                                                            placeholder="무엇을"
                                                            onInput={syncLifeHintsToContent}
                                                            className="p-3 rounded-xl text-base border border-teal-100 outline-none"
                                                        />
                                                        <input
                                                            id="life-how"
                                                            placeholder="어떻게"
                                                            onInput={syncLifeHintsToContent}
                                                            className="p-3 rounded-xl text-base border border-teal-100 outline-none sm:col-span-2"
                                                        />
                                                        <input
                                                            id="life-feeling"
                                                            placeholder="기분은"
                                                            onInput={syncLifeHintsToContent}
                                                            className="p-3 rounded-xl text-base border border-teal-100 outline-none sm:col-span-2"
                                                        />
                                                    </div>
                                                )}
                                                <textarea
                                                    id="life-content"
                                                    placeholder="오늘 있었던 특별한 일을 자유롭게 기록해요."
                                                    className="w-full p-4 sm:p-5 text-base sm:text-lg bg-slate-50 rounded-2xl min-h-[13rem] outline-none resize-y shadow-inner border-2 border-transparent focus:border-emerald-400 leading-relaxed"
                                                ></textarea>
                                                <div className="text-center space-y-3">
                                                        {selectedLifeImg && (
                                                            <div className="relative animate-pop text-left">
                                                                <img
                                                                    src={selectedLifeImg}
                                                                    className="w-full rounded-2xl border-4 border-white shadow-md max-h-72 object-cover"
                                                                    alt="미리보기"
                                                                />
                                                                <input
                                                                    id="life-caption"
                                                                    placeholder="사진 한 줄 설명 (사진과 함께 꼭 적어 주세요)"
                                                                    className="w-full mt-2 p-4 rounded-xl border-2 border-emerald-100 text-base outline-none"
                                                                />
                                                                <button
                                                                    onClick={() => setSelectedLifeImg(null)}
                                                                    className="absolute top-2 right-2 bg-black/50 text-white w-10 h-10 rounded-full flex items-center justify-center text-xl"
                                                                    type="button"
                                                                >
                                                                    ×
                                                                </button>
                                                            </div>
                                                        )}
                                                        <label className="flex items-center justify-center gap-2 w-full p-4 sm:p-5 bg-slate-100 rounded-2xl border-2 border-dashed border-slate-300 cursor-pointer text-slate-600 font-bold text-base sm:text-lg hover:bg-slate-200 transition shadow-sm">
                                                            <i className="fa-solid fa-camera text-2xl"></i> 사진 한 조각 추가
                                                            <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                                                        </label>
                                                    </div>
                                                <div className="flex flex-col sm:flex-row flex-wrap gap-3 pt-2">
                                                    <button
                                                        type="button"
                                                        onClick={saveLifeDraftLocal}
                                                        className="flex-1 min-w-[10rem] bg-white text-emerald-800 font-bold p-4 sm:p-5 rounded-3xl text-base sm:text-lg border-2 border-emerald-200 shadow-sm hover:bg-emerald-50 active:scale-[0.99] transition-all"
                                                    >
                                                        임시 저장 💾
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={restoreLifeDraftLocal}
                                                        className="flex-1 min-w-[10rem] bg-slate-100 text-slate-800 font-bold p-4 sm:p-5 rounded-3xl text-base sm:text-lg border-2 border-slate-200 hover:bg-slate-200 active:scale-[0.99] transition-all"
                                                    >
                                                        불러오기 📂
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => savePost("life", { lifeWritingMode: "daily" })}
                                                        className="flex-[2] min-w-[12rem] bg-emerald-600 text-white font-bold p-5 sm:p-6 rounded-3xl text-base sm:text-xl shadow-xl active:scale-95 transition"
                                                    >
                                                        조각 보관하기 📮
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === "secret" && (
                    <div className="flex-1 flex flex-col min-h-0 w-full animate-pop">
                    <div className="app-mailbox-shell bg-[#b2c7da] p-0 rounded-[1.5rem] sm:rounded-[2rem] border-4 border-white shadow-2xl flex flex-col overflow-hidden w-full">
                        <header className="bg-[#b2c7da] p-4 sm:p-5 flex items-center justify-between border-b border-black/5 shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                {appUser.role === "admin" ? (
                                    adminChatTarget ? (
                                        <button type="button" onClick={() => setAdminChatTarget(null)} className="text-slate-700 mr-1 shrink-0 p-2 -ml-2" aria-label="뒤로">
                                            <i className="fa-solid fa-chevron-left text-lg"></i>
                                        </button>
                                    ) : null
                                ) : null}
                                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-white flex items-center justify-center text-slate-400 shrink-0">
                                    {appUser.role === "admin" ? (
                                        adminChatTarget?.profileImg ? (
                                            <img src={adminChatTarget.profileImg} className="w-full h-full object-cover rounded-xl" alt="" />
                                        ) : (
                                            <i className="fa-solid fa-user-graduate text-xl"></i>
                                        )
                                    ) : (
                                        <i className="fa-solid fa-chalkboard-user text-xl"></i>
                                    )}
                                </div>
                                <h3 className="font-bold text-slate-800 text-base sm:text-xl truncate">
                                    {appUser.role === "admin"
                                        ? adminChatTarget
                                            ? `${adminChatTarget.name} · 우체통`
                                            : "우리 반 우체통"
                                        : "담임 선생님과의 대화"}
                                </h3>
                            </div>
                            <i className="fa-solid fa-envelope text-slate-600 text-xl shrink-0"></i>
                        </header>

                        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 custom-scrollbar bg-[#b2c7da] min-h-0">
                            {appUser.role === "admin" && !adminChatTarget ? (
                                myStudents.length === 0 ? (
                                    <div className="text-center py-16 text-slate-600 text-sm sm:text-base px-4">
                                        우리 반으로 배정된 학생이 없어요. 관리 → 회원 관리에서 학생을 배정해 주세요.
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {myStudents.map((student) => (
                                            <button
                                                key={student.id}
                                                type="button"
                                                onClick={() => setAdminChatTarget(student)}
                                                className="w-full flex items-center gap-4 bg-white/60 sm:bg-white/50 p-4 rounded-2xl hover:bg-white transition-all shadow-sm text-left"
                                            >
                                                <div className="w-12 h-12 rounded-full bg-white border overflow-hidden flex items-center justify-center text-slate-300 shrink-0">
                                                    {student.profileImg ? (
                                                        <img src={student.profileImg} className="w-full h-full object-cover" alt="" />
                                                    ) : (
                                                        <i className="fa-solid fa-user"></i>
                                                    )}
                                                </div>
                                                <div className="text-left flex-1 min-w-0">
                                                    <p className="font-bold text-slate-800 text-base flex items-center gap-2 flex-wrap">
                                                        {student.no}번 {student.name}
                                                        {mailboxUnreadByStudent[student.id] && (
                                                            <span className="text-[10px] font-black bg-red-500 text-white px-2 py-0.5 rounded-full">안 읽음</span>
                                                        )}
                                                    </p>
                                                    <p className="text-xs text-slate-500 truncate">아이디 {student.id}</p>
                                                </div>
                                                <i className="fa-solid fa-chevron-right text-slate-400 shrink-0"></i>
                                            </button>
                                        ))}
                                    </div>
                                )
                            ) : appUser.role === "student" && !effectiveClassTeacherId(appUser, soleAdminId) ? (
                                <div className="text-center py-16 text-slate-600 text-sm sm:text-base px-4">
                                    관리자(선생님) 계정을 불러오는 중이거나 없어요. 잠시 후 다시 열어 주세요.
                                </div>
                            ) : (appUser.role === "admin" ? adminMailbox : mailbox).length === 0 ? (
                                <div className="text-center py-16 text-slate-600 italic text-sm sm:text-base">첫 메시지를 남겨 보세요! 👋</div>
                            ) : (
                                (appUser.role === "admin" ? adminMailbox : mailbox).map((msg) => {
                                    const isMe = msg.senderId === appUser.id;
                                    return (
                                        <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                                            {!isMe && (
                                                <div className="w-9 h-9 rounded-lg bg-white flex-shrink-0 mr-2 flex items-center justify-center text-[10px] text-slate-500 border font-bold">
                                                    {appUser.role === "admin" ? "학생" : "교사"}
                                                </div>
                                            )}
                                            <div className="flex flex-col max-w-[85%] sm:max-w-[75%]">
                                                {!isMe && <span className="text-xs text-slate-700 mb-1 ml-1 font-bold">{msg.senderName}</span>}
                                                <div className={`p-3 sm:p-4 text-base shadow-sm relative ${isMe ? "chat-bubble-me" : "chat-bubble-other"}`}>
                                                    {!isMe && msg.read === false && (
                                                        <span
                                                            className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-red-500 border-2 border-white"
                                                            title="새 쪽지"
                                                            aria-hidden
                                                        />
                                                    )}
                                                    {msg.content}
                                                </div>
                                                <span className="text-[10px] text-slate-600 mt-1 self-end">{msg.date}</span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {(appUser.role !== "admin" || adminChatTarget) && (
                            <div className="p-3 sm:p-4 bg-white flex gap-2 items-center shrink-0 border-t border-slate-100">
                                <input
                                    id="chat-input"
                                    placeholder="메시지를 입력하세요"
                                    className="flex-1 p-3 sm:p-4 bg-slate-100 rounded-xl outline-none text-base font-bold border-none min-h-[48px]"
                                    disabled={appUser.role === "student" && !effectiveClassTeacherId(appUser, soleAdminId)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && e.target.value.trim()) {
                                            appUser.role === "admin"
                                                ? sendMailbox(e.target.value.trim(), { asTeacherToStudent: true })
                                                : sendMailbox(e.target.value.trim());
                                            e.target.value = "";
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    disabled={appUser.role === "student" && !effectiveClassTeacherId(appUser, soleAdminId)}
                                    onClick={() => {
                                        const input = document.getElementById("chat-input");
                                        if (input && input.value.trim()) {
                                            appUser.role === "admin"
                                                ? sendMailbox(input.value.trim(), { asTeacherToStudent: true })
                                                : sendMailbox(input.value.trim());
                                            input.value = "";
                                        }
                                    }}
                                    className="bg-[#fee500] text-[#3b1e1e] w-12 h-12 sm:w-14 sm:h-12 rounded-xl flex items-center justify-center shadow-md active:scale-95 transition-all disabled:opacity-40"
                                >
                                    <i className="fa-solid fa-paper-plane"></i>
                                </button>
                            </div>
                        )}
                    </div>
                    </div>
                )}

                {activeTab === "admin" && (
                    <div className="space-y-6 sm:space-y-8 animate-pop w-full max-w-6xl xl:max-w-7xl mx-auto">
                        <div className="bg-white rounded-[1.75rem] sm:rounded-[2rem] p-6 sm:p-10 shadow-sm border-4 border-white">
                            <h3 className="text-xl sm:text-2xl font-bold text-slate-800 font-gaegu mb-4 sm:mb-6">
                                <i className="fa-solid fa-user-pen text-indigo-500 mr-2"></i>프로필 관리
                            </h3>
                            <div className="flex flex-col md:flex-row items-center gap-8">
                                <div className="relative">
                                    <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-[2.5rem] bg-slate-100 border-4 border-white shadow-xl overflow-hidden flex items-center justify-center text-slate-300 text-5xl">
                                        {appUser.profileImg ? (
                                            <img src={appUser.profileImg} className="w-full h-full object-cover" alt="" />
                                        ) : (
                                            <i className="fa-solid fa-user"></i>
                                        )}
                                    </div>
                                    <label className="absolute bottom-[-10px] right-[-10px] bg-indigo-600 text-white w-12 h-12 rounded-full flex items-center justify-center cursor-pointer shadow-lg hover:bg-indigo-700 transition-all active:scale-90">
                                        <i className="fa-solid fa-camera text-sm"></i>
                                        <input type="file" className="hidden" accept="image/*" onChange={handleProfileUpload} />
                                    </label>
                                </div>
                                <div className="flex-1 w-full space-y-4">
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-400 ml-2 uppercase">Name</label>
                                        <input
                                            id="profile-name"
                                            defaultValue={appUser.name}
                                            className="w-full p-4 sm:p-5 text-base bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-indigo-400 shadow-inner"
                                        />
                                    </div>
                                    <button
                                        onClick={updateProfile}
                                        className="w-full bg-indigo-600 text-white font-bold p-4 sm:p-5 rounded-2xl text-lg shadow-lg hover:bg-indigo-700 transition-all active:scale-95"
                                    >
                                        저장하기 ✅
                                    </button>
                                </div>
                            </div>
                        </div>

                        {appUser.role === "admin" ? (
                            <>
                                <div className="bg-white rounded-[1.75rem] sm:rounded-[2rem] p-6 sm:p-10 shadow-sm border-4 border-white">
                                    <h3 className="text-xl sm:text-2xl font-bold text-slate-800 font-gaegu mb-4">
                                        <i className="fa-solid fa-chart-pie text-red-500 mr-2"></i>우리 반 독서 통계
                                    </h3>
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-96 overflow-y-auto custom-scrollbar">
                                            {Object.entries(classStats)
                                                .sort((a, b) => b[1] - a[1])
                                                .map(([name, count], i) => (
                                                    <div
                                                        key={name}
                                                        className="flex justify-between items-center p-4 sm:p-5 bg-slate-50 rounded-2xl border border-slate-100 hover:bg-indigo-50 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <span
                                                                className={`w-8 h-8 flex items-center justify-center rounded-full text-xs font-bold shrink-0 ${
                                                                    i < 3 ? "bg-yellow-400 text-white" : "bg-slate-200 text-slate-500"
                                                                }`}
                                                            >
                                                                {i + 1}
                                                            </span>
                                                            <span className="font-bold text-slate-700 truncate">{name} 작가님</span>
                                                        </div>
                                                        <span className="bg-white px-3 py-1.5 rounded-full text-indigo-600 font-bold text-sm shadow-sm border border-indigo-100 shrink-0">
                                                            {count} 권
                                                        </span>
                                                    </div>
                                                ))}
                                        </div>
                                        <div className="mt-4 p-6 sm:p-8 bg-indigo-600 rounded-3xl text-center shadow-xl shadow-indigo-100">
                                            <p className="text-sm text-indigo-100 font-bold uppercase mb-1 tracking-widest">우리 반 독서 기록 합계</p>
                                            <p className="text-3xl sm:text-5xl font-bold text-white font-gaegu">
                                                {posts.filter((p) => p.type === "book" && p.classTeacherId === appUser.id).length} 권
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white rounded-[1.75rem] sm:rounded-[2rem] p-6 sm:p-10 shadow-sm border-4 border-white">
                                    <h3 className="text-xl sm:text-2xl font-bold text-slate-800 font-gaegu mb-4">
                                        <i className="fa-solid fa-users-gear text-slate-500 mr-2"></i>우리 반 &amp; 회원 관리
                                    </h3>
                                    <p className="text-slate-500 text-sm sm:text-base mb-4">
                                        학생 아이디·비밀번호를 수정하고, 우리 반으로 넣은 뒤 우체통·창작물을 확인할 수 있어요.
                                    </p>

                                    {unassigned.length > 0 && (
                                        <div className="mb-6 p-4 bg-amber-50 rounded-2xl border border-amber-200">
                                            <p className="font-bold text-amber-900 mb-2">담임 미배정 학생</p>
                                            <div className="space-y-2">
                                                {unassigned.map((u) => (
                                                    <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 bg-white/80 rounded-xl p-3">
                                                        <span className="font-bold text-slate-800">
                                                            {u.no}번 {u.name} ({u.id})
                                                        </span>
                                                        <div className="flex flex-wrap gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => setAdminManageStudent(u)}
                                                                className="text-sm font-bold bg-slate-200 text-slate-800 px-4 py-2 rounded-xl hover:bg-slate-300"
                                                            >
                                                                상세
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => claimStudentToMyClass(u.id)}
                                                                className="text-sm font-bold bg-indigo-600 text-white px-4 py-2 rounded-xl"
                                                            >
                                                                우리 반으로
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-3">
                                        {myStudents.map((u) => (
                                            <div
                                                key={u.id}
                                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 bg-slate-50 rounded-2xl border border-slate-100"
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="w-10 h-10 rounded-lg bg-white overflow-hidden border shrink-0">
                                                        {u.profileImg ? (
                                                            <img src={u.profileImg} className="w-full h-full object-cover" alt="" />
                                                        ) : (
                                                            <i className="fa-solid fa-user text-slate-300 m-2"></i>
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-bold text-slate-800 text-base truncate">
                                                            {u.no}번 {u.name}{" "}
                                                            <span className="text-slate-500 font-mono text-sm">({u.id})</span>
                                                        </p>
                                                        <p className="text-xs text-slate-500">비밀번호: {u.pw ? "••••••" : "(없음)"} · 실제 확인/변경은 상세</p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setAdminManageStudent(u)}
                                                        className="text-sm font-bold bg-indigo-100 text-indigo-700 px-4 py-2.5 rounded-xl hover:bg-indigo-200"
                                                    >
                                                        상세 관리
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-white rounded-[1.75rem] sm:rounded-[2rem] p-6 sm:p-10 shadow-sm border-4 border-white">
                                    <h3 className="text-xl sm:text-2xl font-bold text-slate-800 font-gaegu mb-4">
                                        <i className="fa-solid fa-calendar-days text-indigo-400 mr-2"></i>나의 독서 달력
                                    </h3>
                                    <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center text-xs sm:text-sm font-bold text-slate-400 mb-2 italic">
                                        <div>SUN</div>
                                        <div>MON</div>
                                        <div>TUE</div>
                                        <div>WED</div>
                                        <div>THU</div>
                                        <div>FRI</div>
                                        <div>SAT</div>
                                    </div>
                                    <div className="grid grid-cols-7 gap-1">{renderCalendar()}</div>
                                    <div className="mt-6 p-5 bg-indigo-50 rounded-2xl flex justify-between items-center border border-indigo-100">
                                        <span className="text-sm sm:text-base font-bold text-indigo-600">누적 나의 독서량</span>
                                        <span className="text-2xl sm:text-3xl font-bold text-indigo-600 font-gaegu">
                                            {posts.filter((p) => p.writerId === appUser.id && p.type === "book").length} 권
                                        </span>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="bg-white rounded-[1.75rem] sm:rounded-[2rem] p-6 sm:p-10 shadow-sm border-4 border-white">
                                <h3 className="text-xl sm:text-2xl font-bold text-slate-800 font-gaegu mb-4">
                                    <i className="fa-solid fa-calendar-days text-indigo-400 mr-2"></i>나의 독서 달력
                                </h3>
                                <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center text-xs sm:text-sm font-bold text-slate-400 mb-2 italic">
                                    <div>SUN</div>
                                    <div>MON</div>
                                    <div>TUE</div>
                                    <div>WED</div>
                                    <div>THU</div>
                                    <div>FRI</div>
                                    <div>SAT</div>
                                </div>
                                <div className="grid grid-cols-7 gap-1">{renderCalendar()}</div>
                                <div className="mt-6 p-5 bg-indigo-50 rounded-2xl flex justify-between items-center border border-indigo-100">
                                    <span className="text-sm sm:text-base font-bold text-indigo-600">누적 나의 독서량</span>
                                    <span className="text-2xl sm:text-3xl font-bold text-indigo-600 font-gaegu">
                                        {posts.filter((p) => p.writerId === appUser.id && p.type === "book").length} 권
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>

            <nav className="app-bottom-nav fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-2xl shadow-[0_-15px_40px_rgba(0,0,0,0.12)] rounded-t-[2rem] sm:rounded-t-[3.5rem] px-2 sm:px-4 pt-4 flex justify-between items-end z-[4000] border-t-[6px] border-white gap-0.5 sm:gap-1">
                <button
                    type="button"
                    onClick={() => {
                        setActiveTab("feed");
                        setAdminChatTarget(null);
                    }}
                    className={`flex flex-col items-center gap-1 transition-all flex-1 min-w-0 py-1 ${activeTab === "feed" ? "nav-item active" : "nav-item"}`}
                >
                    <i className="fa-solid fa-house-chimney text-2xl sm:text-3xl"></i>
                    <span className="nav-text truncate w-full text-center">홈</span>
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setActiveTab("write-book");
                        setBookSubTab("compose");
                    }}
                    className={`flex flex-col items-center gap-1 transition-all flex-1 min-w-0 py-1 ${activeTab === "write-book" ? "nav-item active" : "nav-item"}`}
                >
                    <i className="fa-solid fa-book-open-reader text-2xl sm:text-3xl"></i>
                    <span className="nav-text truncate w-full text-center">독서</span>
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setActiveTab("write-life");
                        setLifeSubTab("daily");
                    }}
                    className={`flex flex-col items-center gap-1 transition-all flex-1 min-w-0 py-1 ${activeTab === "write-life" ? "nav-item active" : "nav-item"}`}
                >
                    <i className="fa-solid fa-pen-fancy text-2xl sm:text-3xl"></i>
                    <span className="nav-text truncate w-full text-center">조각</span>
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("secret")}
                    className={`flex flex-col items-center gap-1 transition-all flex-1 min-w-0 py-1 ${activeTab === "secret" ? "nav-item active" : "nav-item"}`}
                >
                    <span className="relative inline-flex">
                        <i className="fa-solid fa-envelope text-2xl sm:text-3xl"></i>
                        {(appUser.role === "student" ? studentMailboxUnreadCount : teacherMailboxUnreadTotal) > 0 && (
                            <span className="absolute -top-1.5 -right-2 min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center border-2 border-white leading-none">
                                {(appUser.role === "student" ? studentMailboxUnreadCount : teacherMailboxUnreadTotal) > 9
                                    ? "9+"
                                    : appUser.role === "student"
                                      ? studentMailboxUnreadCount
                                      : teacherMailboxUnreadTotal}
                            </span>
                        )}
                    </span>
                    <span className="nav-text truncate w-full text-center">우체통</span>
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab("admin")}
                    className={`flex flex-col items-center gap-1 transition-all flex-1 min-w-0 py-1 ${activeTab === "admin" ? "nav-item active" : "nav-item"}`}
                >
                    <i className="fa-solid fa-star-of-life text-2xl sm:text-3xl"></i>
                    <span className="nav-text truncate w-full text-center">관리</span>
                </button>
            </nav>

            {adminManageStudent && appUser.role === "admin" && (
                <div className="fixed inset-0 bg-black/55 z-[5500] flex items-end sm:items-center justify-center p-0 sm:p-6 backdrop-blur-sm">
                    <div className="bg-white rounded-t-[2rem] sm:rounded-[2.5rem] w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl border-t-8 sm:border-8 border-indigo-500 p-6 sm:p-8 animate-pop">
                        <div className="flex justify-between items-start gap-2 mb-4">
                            <div>
                                <h4 className="font-gaegu text-2xl sm:text-3xl font-bold text-indigo-600">학생 상세</h4>
                                <p className="text-slate-600 font-bold mt-1">
                                    {adminManageStudent.no}번 {adminManageStudent.name}{" "}
                                    <span className="text-slate-400 font-mono text-sm">({adminManageStudent.id})</span>
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setAdminManageStudent(null)}
                                className="text-slate-400 hover:text-slate-700 text-3xl leading-none px-2"
                                aria-label="닫기"
                            >
                                ×
                            </button>
                        </div>

                        <div className="space-y-4 mb-6">
                            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                <p className="text-xs font-bold text-slate-400 uppercase mb-1">현재 비밀번호 (저장값)</p>
                                <p className="font-mono text-base sm:text-lg font-bold text-slate-800 break-all">{adminManageStudent.pw || "(없음)"}</p>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 ml-1">새 비밀번호로 변경</label>
                                <input
                                    type="text"
                                    value={adminPwDraft}
                                    onChange={(e) => setAdminPwDraft(e.target.value)}
                                    placeholder="비워 두면 유지"
                                    className="w-full mt-1 p-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-indigo-400 outline-none font-bold"
                                />
                            </div>
                            <p className="text-sm text-slate-600 bg-indigo-50 rounded-2xl p-4 border border-indigo-100">
                                <strong>저장 반영</strong>을 누르면 이 학생은 선생님 반(담임)으로 등록됩니다. 비밀번호만 바꿀 때도 동일하게 저장하면 됩니다.
                            </p>
                            <button
                                type="button"
                                onClick={adminUpdateStudent}
                                className="w-full bg-indigo-600 text-white font-bold p-4 rounded-2xl text-lg shadow-lg active:scale-[0.99] transition"
                            >
                                저장 반영
                            </button>
                            <button
                                type="button"
                                onClick={adminDeleteStudentUser}
                                className="w-full border-2 border-red-200 text-red-600 font-bold p-4 rounded-2xl text-base hover:bg-red-50 transition"
                            >
                                학생 계정 삭제
                            </button>
                        </div>

                        <div className="border-t border-slate-100 pt-6 space-y-4">
                            <h5 className="font-bold text-slate-800 text-lg">독서 기록 ({posts.filter((p) => p.writerId === adminManageStudent.id && p.type === "book").length})</h5>
                            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                {posts
                                    .filter((p) => p.writerId === adminManageStudent.id && p.type === "book")
                                    .map((p) => (
                                        <div key={p.id} className="p-3 bg-indigo-50/80 rounded-xl text-sm flex gap-2 items-start">
                                            {p.coverImageUrl ? (
                                                <img src={p.coverImageUrl} className="w-10 h-14 object-cover rounded-lg border border-white shrink-0" alt="" />
                                            ) : (
                                                <div className="w-10 h-14 rounded-lg bg-indigo-200/60 flex items-center justify-center shrink-0 text-lg">📖</div>
                                            )}
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-1">
                                                    <span className="font-bold text-indigo-700">📖 {p.title}</span>
                                                </div>
                                                {p.favoriteQuote && (
                                                    <p className="text-xs text-amber-900/90 italic line-clamp-2 mt-0.5">&ldquo;{p.favoriteQuote}&rdquo;</p>
                                                )}
                                                <p className="text-slate-600 line-clamp-2 mt-1 whitespace-pre-wrap">{p.memorableScene || p.myThought || p.content}</p>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                            <h5 className="font-bold text-slate-800 text-lg">일상 조각 ({posts.filter((p) => p.writerId === adminManageStudent.id && p.type === "life").length})</h5>
                            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                {posts
                                    .filter((p) => p.writerId === adminManageStudent.id && p.type === "life")
                                    .map((p) => (
                                        <div key={p.id} className="p-3 bg-emerald-50/80 rounded-xl text-sm flex gap-2 items-start">
                                            {p.imageUrl && (
                                                <img src={p.imageUrl} className="w-12 h-12 rounded-lg object-cover border border-white shrink-0" alt="" />
                                            )}
                                            <div className="min-w-0">
                                                {(p.moodEmoji || p.moodLabel) && (
                                                    <p className="text-xs font-bold text-emerald-900">
                                                        {p.moodEmoji} {p.moodLabel}
                                                        {p.moodWhy && <span className="font-normal text-slate-600"> · {p.moodWhy}</span>}
                                                    </p>
                                                )}
                                                {p.imageCaption && (
                                                    <p className="text-xs text-slate-600 italic mt-0.5">📷 {p.imageCaption}</p>
                                                )}
                                                <p className="text-slate-700 whitespace-pre-wrap line-clamp-4">{p.content}</p>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {lifePostDetailModal && (
                <div
                    className="fixed inset-0 bg-black/60 z-[4870] flex items-center justify-center p-3 sm:p-6 backdrop-blur-sm overflow-y-auto"
                    role="dialog"
                    aria-modal="true"
                    aria-label="일상 조각 상세"
                    onClick={() => setLifePostDetailModal(null)}
                >
                    <div
                        className="bg-white rounded-[1.75rem] sm:rounded-[2.5rem] w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl border-4 border-white p-5 sm:p-10 relative my-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={() => setLifePostDetailModal(null)}
                            className="absolute top-4 right-4 z-10 text-slate-300 hover:text-emerald-600 text-3xl leading-none w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-50"
                            aria-label="닫기"
                        >
                            ×
                        </button>
                        <h4 className="font-bold text-slate-800 font-gaegu text-xl sm:text-2xl mb-2 pr-10">오늘의 조각</h4>
                        <p className="text-sm font-bold text-slate-500 mb-4">
                            {lifePostDetailModal.writer}
                            {lifePostDetailModal.writerNo != null && lifePostDetailModal.writerNo !== "" ? ` · ${lifePostDetailModal.writerNo}번` : ""} ·{" "}
                            {new Date(lifePostDetailModal.timestamp).toLocaleString()}
                        </p>
                        {lifePostDetailModal.imageUrl && (
                            <img
                                src={lifePostDetailModal.imageUrl}
                                alt=""
                                className="w-full max-h-64 object-cover rounded-2xl border-2 border-slate-100 mb-4"
                            />
                        )}
                        {(lifePostDetailModal.moodEmoji || lifePostDetailModal.moodLabel) && (
                            <p className="text-slate-800 font-bold text-base mb-2">
                                {lifePostDetailModal.moodEmoji} {lifePostDetailModal.moodLabel}
                                {lifePostDetailModal.moodWhy && (
                                    <span className="font-normal text-slate-600"> — {lifePostDetailModal.moodWhy}</span>
                                )}
                            </p>
                        )}
                        {lifePostDetailModal.imageCaption && (
                            <p className="text-slate-600 italic text-sm mb-2">📷 {lifePostDetailModal.imageCaption}</p>
                        )}
                        <p className="text-slate-800 whitespace-pre-wrap leading-relaxed text-base sm:text-lg">{lifePostDetailModal.content}</p>
                    </div>
                </div>
            )}

            {readingCalendarModal && (
                <div
                    className="fixed inset-0 bg-black/60 z-[4850] flex items-center justify-center p-3 sm:p-6 backdrop-blur-sm overflow-y-auto"
                    role="dialog"
                    aria-modal="true"
                    aria-label="해당 날짜 독서"
                    onClick={() => setReadingCalendarModal(null)}
                >
                    <div
                        className="bg-white rounded-[1.75rem] sm:rounded-[2rem] w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl border-4 border-white p-5 sm:p-8 relative my-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={() => setReadingCalendarModal(null)}
                            className="absolute top-3 right-3 z-10 text-slate-300 hover:text-indigo-600 text-3xl leading-none w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-50"
                            aria-label="닫기"
                        >
                            ×
                        </button>
                        <h4 className="font-bold text-slate-800 font-gaegu text-xl sm:text-2xl mb-1 pr-10">
                            {readingCalendarModal.dateLabel}
                        </h4>
                        <p className="text-sm text-slate-500 font-bold mb-5">이 날 기록한 책</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {readingCalendarModal.books.map((bp) => (
                                <button
                                    key={bp.id}
                                    type="button"
                                    onClick={() => {
                                        setBookDetailModal(bp);
                                        setReadingCalendarModal(null);
                                    }}
                                    className="flex flex-col items-center text-center gap-2 rounded-2xl p-2 -m-2 hover:bg-indigo-50/80 transition text-left w-full"
                                >
                                    {bp.coverImageUrl ? (
                                        <img
                                            src={bp.coverImageUrl}
                                            alt=""
                                            className="w-full aspect-[3/4] max-w-[6.5rem] object-cover rounded-xl border-4 border-white shadow-md bg-slate-50"
                                        />
                                    ) : (
                                        <div className="w-full max-w-[6.5rem] aspect-[3/4] rounded-xl border-2 border-dashed border-indigo-100 flex items-center justify-center text-3xl bg-indigo-50/50">
                                            📖
                                        </div>
                                    )}
                                    <p className="text-xs sm:text-sm font-bold text-slate-800 line-clamp-3 leading-snug">{bp.title || "제목 없음"}</p>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {bookDetailModal && (
                <div
                    className="fixed inset-0 bg-black/60 z-[4900] flex items-center justify-center p-3 sm:p-6 backdrop-blur-sm overflow-y-auto"
                    role="dialog"
                    aria-modal="true"
                    aria-label="독서 기록 상세"
                    onClick={() => setBookDetailModal(null)}
                >
                    <div
                        className="bg-white rounded-[1.75rem] sm:rounded-[2.5rem] w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl border-4 border-white p-5 sm:p-10 relative my-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={() => setBookDetailModal(null)}
                            className="absolute top-4 right-4 z-10 text-slate-300 hover:text-indigo-600 text-3xl leading-none w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-50"
                            aria-label="닫기"
                        >
                            ×
                        </button>
                        <BookFeedCardInner post={bookDetailModal} />
                    </div>
                </div>
            )}

            {showComments && (
                <div className="fixed inset-0 bg-black/60 z-[5000] flex flex-col justify-end sm:justify-center backdrop-blur-sm p-0 sm:p-4">
                    <div className="bg-white rounded-t-[2.5rem] sm:rounded-[2rem] p-6 sm:p-8 w-full max-w-xl mx-auto border-t-8 border-indigo-400 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col relative">
                        <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 shrink-0 sm:hidden"></div>
                        <h4 className="font-bold text-center mb-6 font-gaegu text-2xl sm:text-3xl text-indigo-600 italic underline decoration-indigo-100 decoration-4 shrink-0">
                            응원 댓글 💬
                        </h4>
                        <div className="space-y-3 overflow-y-auto flex-1 pb-28 px-1 custom-scrollbar">
                            {(showComments.comments || []).length === 0 ? (
                                <p className="text-center py-10 text-slate-300 italic font-gaegu text-xl">첫 댓글을 달아보세요!</p>
                            ) : (
                                (showComments.comments || []).map((c, i) => (
                                    <div key={i} className="bg-slate-50 p-4 rounded-2xl border-2 border-white flex flex-col animate-pop shadow-sm">
                                        <div className="flex justify-between mb-1 gap-2">
                                            <span className="text-xs font-bold text-indigo-500 uppercase tracking-widest">{c.writer} 작가님</span>
                                            <span className="text-[10px] text-slate-300 font-bold shrink-0">
                                                {new Date(c.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                            </span>
                                        </div>
                                        <p className="text-sm sm:text-base text-slate-700 font-medium">{c.content}</p>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 bg-white border-t flex gap-2 rounded-t-3xl">
                            <input
                                value={commentInput}
                                onChange={(e) => setCommentInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && addComment()}
                                placeholder="응원의 한마디를 입력하세요"
                                className="flex-1 p-4 text-base bg-slate-100 rounded-2xl outline-none font-bold shadow-inner border-2 border-transparent focus:border-indigo-400 transition-all min-h-[52px]"
                            />
                            <button
                                type="button"
                                onClick={addComment}
                                className="bg-indigo-600 text-white px-6 sm:px-8 rounded-2xl font-bold shadow-lg shadow-indigo-100 active:scale-95 transition-all shrink-0"
                            >
                                보내기
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowComments(null)}
                            className="absolute top-4 right-4 sm:top-8 sm:right-8 text-slate-300 text-3xl hover:text-indigo-600 transition-all"
                            aria-label="닫기"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}

            {alert.show && (
                <div className="fixed inset-0 bg-black/40 z-[6000] flex items-center justify-center p-6 backdrop-blur-md">
                    <div className="bg-white p-8 sm:p-10 rounded-[2.5rem] sm:rounded-[3.5rem] text-center w-full max-w-sm shadow-2xl border-b-8 border-indigo-500 animate-pop">
                        <div className="text-6xl sm:text-7xl mb-4 sm:mb-6 drop-shadow-xl">{alert.icon}</div>
                        <p className="font-bold text-slate-800 text-xl sm:text-2xl mb-8 sm:mb-10 leading-tight font-gaegu tracking-tight">{alert.msg}</p>
                        <button
                            type="button"
                            onClick={() => setAlert({ ...alert, show: false })}
                            className="w-full bg-indigo-600 text-white p-4 sm:p-5 rounded-3xl font-bold text-lg sm:text-xl active:scale-95 shadow-lg shadow-indigo-100 transition-all"
                        >
                            확인
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
