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

const { useState, useEffect } = React;

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
    const [posts, setPosts] = useState([]);
    const [secrets, setSecrets] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [adminChatTarget, setAdminChatTarget] = useState(null);
    const [adminSelectedSecrets, setAdminSelectedSecrets] = useState([]);

    const [alert, setAlert] = useState({ show: false, msg: "", icon: "" });
    const [showComments, setShowComments] = useState(null);
    const [commentInput, setCommentInput] = useState("");
    const [selectedLifeImg, setSelectedLifeImg] = useState(null);

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

    const fetchAppUser = async (id) => {
        const userRef = doc(db, "artifacts", appId, "public", "data", "users", id);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) setAppUser(userSnap.data());
        else localStorage.removeItem("opo_login_id");
    };

    useEffect(() => {
        if (!appUser) return;

        const postsColl = collection(db, "artifacts", appId, "public", "data", "posts");
        const unsubPosts = onSnapshot(postsColl, (snapshot) => {
            const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            setPosts(data.sort((a, b) => b.timestamp - a.timestamp));
        });

        const secretsColl = collection(db, "artifacts", appId, "users", appUser.id, "secrets");
        const unsubSecrets = onSnapshot(secretsColl, (snapshot) => {
            const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            setSecrets(data.sort((a, b) => a.timestamp - b.timestamp));
        });

        if (appUser.role === "admin") {
            const usersColl = collection(db, "artifacts", appId, "public", "data", "users");
            const unsubUsers = onSnapshot(usersColl, (snapshot) => {
                const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
                setAllUsers(data.sort((a, b) => parseInt(a.no) - parseInt(b.no)));
            });
            return () => {
                unsubPosts();
                unsubSecrets();
                unsubUsers();
            };
        }

        return () => {
            unsubPosts();
            unsubSecrets();
        };
    }, [appUser]);

    useEffect(() => {
        if (appUser?.role === "admin" && adminChatTarget) {
            const targetSecretsColl = collection(db, "artifacts", appId, "users", adminChatTarget.id, "secrets");
            const unsubTargetSecrets = onSnapshot(targetSecretsColl, (snapshot) => {
                const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
                setAdminSelectedSecrets(data.sort((a, b) => a.timestamp - b.timestamp));
            });
            return () => unsubTargetSecrets();
        }
    }, [adminChatTarget, appUser]);

    const showAlert = (msg, icon) => setAlert({ show: true, msg, icon: icon || "🌟" });

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
            profileImg: null,
            statusMsg: "",
            createdAt: Date.now(),
        };
        await setDoc(userRef, newUser);
        setAppUser(newUser);
        localStorage.setItem("opo_login_id", loginId);
        showAlert(`${signupName} ${isAdmin ? "선생님" : "작가님"}, 환영해요!`, "🎈");
    };

    const handleLogin = async () => {
        if (!loginId || !loginPw) return showAlert("아이디와 비밀번호를 써주세요!", "👀");
        const userRef = doc(db, "artifacts", appId, "public", "data", "users", loginId);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const userData = userSnap.data();
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
    };

    const savePost = async (type) => {
        if (!appUser) return;
        const content = document.getElementById(type === "book" ? "book-content" : "life-content").value;
        if (!content) return showAlert("내용을 적어주세요!", "✍️");

        const newPost = {
            type,
            writer: appUser.name,
            writerNo: appUser.no,
            writerId: appUser.id,
            writerRole: appUser.role,
            writerImg: appUser.profileImg,
            content,
            timestamp: Date.now(),
            likes: [],
            comments: [],
            date: new Date().toISOString(),
        };

        if (type === "book") {
            newPost.title = document.getElementById("book-title").value;
            newPost.author = document.getElementById("book-author").value || "작자미상";
            newPost.category = document.getElementById("book-category").value;
        } else if (selectedLifeImg) newPost.imageUrl = selectedLifeImg;

        await addDoc(collection(db, "artifacts", appId, "public", "data", "posts"), newPost);
        setActiveTab("feed");
        showAlert("저장되었습니다!", "✨");
        if (type === "book") {
            document.getElementById("book-title").value = "";
            document.getElementById("book-content").value = "";
            document.getElementById("book-author").value = "";
        } else {
            document.getElementById("life-content").value = "";
            setSelectedLifeImg(null);
        }
    };

    const deletePost = async (postId) => {
        if (!confirm("정말 이 글을 삭제할까요?")) return;
        await deleteDoc(doc(db, "artifacts", appId, "public", "data", "posts", postId));
        showAlert("글이 삭제되었습니다.", "🗑️");
    };

    const toggleLike = async (postId) => {
        const post = posts.find((p) => p.id === postId);
        const myKey = { id: appUser.id, name: appUser.name };
        const postRef = doc(db, "artifacts", appId, "public", "data", "posts", postId);

        const existing = post.likes.find((l) => l.id === appUser.id);
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

    const sendSecret = async (content) => {
        if (!content) return;
        const secretData = {
            senderId: appUser.id,
            senderName: appUser.name,
            content,
            timestamp: Date.now(),
            date: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        await addDoc(collection(db, "artifacts", appId, "users", appUser.id, "secrets"), secretData);
    };

    const sendAdminReply = async (content) => {
        if (!content || !adminChatTarget) return;
        const secretData = {
            senderId: appUser.id,
            senderName: appUser.name,
            content,
            timestamp: Date.now(),
            date: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        await addDoc(collection(db, "artifacts", appId, "users", adminChatTarget.id, "secrets"), secretData);
    };

    const updateProfile = async () => {
        const newName = document.getElementById("profile-name").value;
        const newStatus = document.getElementById("profile-status").value;
        const userRef = doc(db, "artifacts", appId, "public", "data", "users", appUser.id);
        await updateDoc(userRef, { name: newName, statusMsg: newStatus });
        setAppUser({ ...appUser, name: newName, statusMsg: newStatus });
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

    const renderCalendar = () => {
        const now = new Date();
        const lastDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
        const myHistory = {};
        posts
            .filter((p) => p.writerId === appUser.id && p.type === "book")
            .forEach((p) => {
                const d = new Date(p.timestamp).getDate();
                myHistory[d] = (myHistory[d] || 0) + 1;
            });
        let days = [];
        for (let i = 0; i < firstDay; i++) days.push(<div key={`empty-${i}`} className="p-2"></div>);
        for (let i = 1; i <= lastDate; i++) {
            const count = myHistory[i] || 0;
            days.push(
                <div
                    key={i}
                    className={`relative p-1 h-14 border rounded-xl flex flex-col items-center ${
                        i === now.getDate() ? "bg-indigo-50 border-indigo-200" : "bg-slate-50 border-transparent"
                    }`}
                >
                    <span className="text-[10px] font-bold text-slate-400">{i}</span>
                    <div className="flex flex-wrap justify-center gap-0.5 mt-1">
                        {count > 0 &&
                            (count <= 3 ? (
                                [...Array(count)].map((_, idx) => (
                                    <i key={idx} className="fa-solid fa-book text-[8px] text-indigo-400"></i>
                                ))
                            ) : (
                                <>
                                    <i className="fa-solid fa-book text-[8px] text-indigo-400"></i>
                                    <span className="text-[8px] font-bold text-indigo-600">3+</span>
                                </>
                            ))}
                    </div>
                </div>
            );
        }
        return days;
    };

    if (!appUser) {
        return (
            <div className="fixed inset-0 bg-indigo-600 flex items-center justify-center p-6 text-white font-sans overflow-y-auto">
                <div className="text-center w-full max-w-sm py-10 animate-pop">
                    <div className="bg-white/10 backdrop-blur-xl p-8 rounded-[3.5rem] border border-white/20 shadow-2xl">
                        <h1 className="text-4xl font-bold font-gaegu mb-2 text-yellow-300">오포초등학교</h1>
                        <h2 className="text-xl font-bold font-gaegu mb-8 text-indigo-100 italic">디지털 북로드 V5</h2>
                        <div className="space-y-3 text-gray-800 text-left">
                            <label className="text-white text-[10px] font-bold ml-2">ID</label>
                            <input
                                type="text"
                                value={loginId}
                                onChange={(e) => setLoginId(e.target.value)}
                                placeholder="아이디"
                                className="w-full p-4 rounded-2xl outline-none shadow-inner text-center font-bold"
                                onKeyDown={(e) => e.key === "Enter" && (isLoginView ? handleLogin() : null)}
                            />
                            <label className="text-white text-[10px] font-bold ml-2">PASSWORD</label>
                            <input
                                type="password"
                                value={loginPw}
                                onChange={(e) => setLoginPw(e.target.value)}
                                placeholder="비밀번호"
                                className="w-full p-4 rounded-2xl outline-none shadow-inner text-center font-bold"
                                onKeyDown={(e) => e.key === "Enter" && (isLoginView ? handleLogin() : null)}
                            />
                            {!isLoginView && (
                                <>
                                    <label className="text-white text-[10px] font-bold ml-2">CONFIRM PASSWORD</label>
                                    <input
                                        type="password"
                                        value={loginPwConfirm}
                                        onChange={(e) => setLoginPwConfirm(e.target.value)}
                                        placeholder="비밀번호 확인"
                                        className="w-full p-4 rounded-2xl outline-none shadow-inner text-center font-bold"
                                    />
                                    <label className="text-white text-[10px] font-bold ml-2">NAME</label>
                                    <input
                                        type="text"
                                        value={signupName}
                                        onChange={(e) => setSignupName(e.target.value)}
                                        placeholder="이름 (예: 홍길동)"
                                        className="w-full p-4 rounded-2xl outline-none shadow-inner text-center font-bold"
                                    />
                                    <label className="text-white text-[10px] font-bold ml-2">ATTENDANCE NO.</label>
                                    <input
                                        type="number"
                                        value={signupNo}
                                        onChange={(e) => setSignupNo(e.target.value)}
                                        placeholder="출석 번호"
                                        className="w-full p-4 rounded-2xl outline-none shadow-inner text-center font-bold"
                                        onKeyDown={(e) => e.key === "Enter" && handleSignup()}
                                    />
                                </>
                            )}
                            <button
                                onClick={isLoginView ? handleLogin : handleSignup}
                                className="w-full bg-yellow-400 text-indigo-900 font-bold p-4 rounded-2xl text-xl active:scale-95 transition shadow-lg mt-4"
                            >
                                {isLoginView ? "작가 로그인 🎒" : "작가 등록하기 ✨"}
                            </button>
                            <button
                                onClick={() => setIsLoginView(!isLoginView)}
                                className="text-white/70 text-sm font-bold underline mt-6 block mx-auto text-center"
                            >
                                {isLoginView ? "처음 왔나요? (회원가입)" : "아이디가 있나요? (로그인)"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto p-4 font-sans pb-44 min-h-screen">
            <header className="flex justify-between items-center mb-6 pt-4 px-2">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-white shadow-lg flex items-center justify-center text-indigo-200 text-2xl overflow-hidden border-2 border-white">
                        {appUser.profileImg ? (
                            <img src={appUser.profileImg} className="w-full h-full object-cover" />
                        ) : (
                            <i className="fa-solid fa-user"></i>
                        )}
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 font-gaegu leading-none mb-1">
                            <span className="text-indigo-600">{appUser.name}</span> {appUser.role === "admin" ? "선생님" : "작가님"}
                        </h2>
                        <div className="flex items-center gap-2">
                            <span
                                className={`text-white text-[9px] px-2 py-0.5 rounded-full font-bold ${
                                    appUser.role === "admin" ? "bg-red-500 shadow-red-100" : "bg-indigo-500 shadow-indigo-100"
                                } shadow-md`}
                            >
                                {appUser.role === "admin" ? "선생님" : "LV.1 새싹"}
                            </span>
                            {appUser.role !== "admin" && (
                                <span className="text-[10px] text-slate-500 font-bold tracking-widest">{appUser.no}번</span>
                            )}
                            {appUser.statusMsg && (
                                <span className="text-[10px] text-slate-400 font-bold italic ml-2">"{appUser.statusMsg}"</span>
                            )}
                        </div>
                    </div>
                </div>
                <button onClick={logout} className="text-slate-500 text-xs font-bold hover:text-red-500 transition-colors">
                    로그아웃
                </button>
            </header>

            <main className="min-h-[60vh]">
                {activeTab === "feed" && (
                    <div className="space-y-6 animate-pop max-w-xl mx-auto">
                        <h3 className="font-bold text-slate-800 text-xl font-gaegu ml-2">우리 반 타임라인 💬</h3>
                        {posts.length === 0 ? (
                            <div className="text-center py-20 text-slate-300 italic font-gaegu text-xl">아직 첫 글이 없어요.</div>
                        ) : (
                            posts.map((post) => {
                                const isLiked = post.likes.some((l) => l.id === appUser.id);
                                const canDelete = appUser.id === post.writerId || appUser.role === "admin";
                                return (
                                    <div
                                        key={post.id}
                                        className="bg-white rounded-[2rem] p-6 shadow-sm border-4 border-white mb-4 relative transition hover:shadow-md"
                                    >
                                        {canDelete && (
                                            <button
                                                onClick={() => deletePost(post.id)}
                                                className="absolute top-6 right-6 text-slate-200 hover:text-red-400 transition-colors"
                                            >
                                                <i className="fa-solid fa-trash-can"></i>
                                            </button>
                                        )}
                                        <div className="flex justify-between items-center mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-200 overflow-hidden border">
                                                    {post.writerImg ? (
                                                        <img src={post.writerImg} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <i className="fa-solid fa-user"></i>
                                                    )}
                                                </div>
                                                <div>
                                                    <h5 className="font-bold text-slate-800 font-gaegu text-lg leading-tight">
                                                        {post.writer} {post.writerRole === "admin" ? "선생님" : ""}
                                                    </h5>
                                                    <p className="text-[9px] text-slate-400 font-bold tracking-tighter">
                                                        {post.writerRole === "admin" ? "관리자" : `${post.writerNo}번 작가`} •{" "}
                                                        {new Date(post.timestamp).toLocaleDateString()}
                                                    </p>
                                                </div>
                                            </div>
                                            <span className="text-[9px] font-bold bg-indigo-50 text-indigo-500 px-2 py-1 rounded-lg uppercase italic tracking-tighter">
                                                {post.type === "book" ? KDC_LABELS[post.category]?.split(" ")[0] : "DAILY"}
                                            </span>
                                        </div>
                                        {post.imageUrl && (
                                            <img
                                                src={post.imageUrl}
                                                className="w-full rounded-2xl mb-4 border-2 border-slate-50 shadow-sm"
                                                alt="Post"
                                            />
                                        )}
                                        {post.type === "book" && (
                                            <div className="bg-indigo-50/50 p-4 rounded-2xl mb-4 border-l-4 border-indigo-400 shadow-inner">
                                                <h4 className="font-bold text-slate-800 font-gaegu leading-tight">📖 {post.title}</h4>
                                                <p className="text-[10px] text-indigo-400 font-bold">{post.author}</p>
                                            </div>
                                        )}
                                        <div className="text-sm text-slate-600 leading-relaxed mb-5 whitespace-pre-wrap px-1">{post.content}</div>
                                        <div className="flex items-center gap-3 pt-4 border-t border-slate-50">
                                            <button
                                                onClick={() => toggleLike(post.id)}
                                                className={`px-4 py-2 rounded-full border transition-all ${
                                                    isLiked
                                                        ? "text-pink-500 bg-pink-50 border-pink-100"
                                                        : "text-slate-400 bg-slate-50 border-transparent"
                                                }`}
                                            >
                                                <i className={`fa-${isLiked ? "solid" : "regular"} fa-heart mr-1`}></i>
                                                {post.likes.length}
                                            </button>
                                            <button
                                                onClick={() => setShowComments(post)}
                                                className="px-4 py-2 rounded-full bg-slate-50 text-slate-500 hover:bg-slate-100 transition-colors font-bold text-xs"
                                            >
                                                <i className="fa-regular fa-comment mr-1"></i>
                                                {post.comments.length} 댓글
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

                {activeTab === "write-book" && (
                    <div className="flex flex-col md:flex-row gap-6 animate-pop">
                        <div className="flex-1 space-y-4 md:max-h-[70vh] md:overflow-y-auto pr-2 custom-scrollbar order-2 md:order-1">
                            <h3 className="font-bold text-slate-800 text-lg font-gaegu ml-2 italic underline decoration-indigo-200 underline-offset-4 mb-4">
                                나의 독서 흔적들 📖
                            </h3>
                            {posts.filter((p) => p.writerId === appUser.id && p.type === "book").length === 0 ? (
                                <div className="text-center py-20 text-slate-300 italic">아직 기록이 없어요.</div>
                            ) : (
                                posts
                                    .filter((p) => p.writerId === appUser.id && p.type === "book")
                                    .map((post) => (
                                        <div key={post.id} className="bg-white/80 p-4 rounded-2xl shadow-sm border border-white mb-3">
                                            <p className="text-[10px] text-indigo-400 font-bold mb-1">{new Date(post.timestamp).toLocaleDateString()}</p>
                                            <h4 className="font-bold text-slate-800 text-sm mb-1">📖 {post.title}</h4>
                                            <p className="text-xs text-slate-500 line-clamp-2 italic">"{post.content}"</p>
                                        </div>
                                    ))
                            )}
                        </div>
                        <div className="flex-1 bg-white rounded-[2rem] p-8 shadow-lg border-4 border-white order-1 md:order-2 h-fit sticky top-4">
                            <h3 className="text-3xl font-bold mb-6 text-slate-800 font-gaegu text-center underline decoration-indigo-100">
                                📖 독서기록장
                            </h3>
                            <div className="space-y-4">
                                <select
                                    id="book-category"
                                    className="w-full p-4 bg-slate-50 rounded-2xl font-bold text-indigo-600 outline-none border-2 border-transparent focus:border-indigo-400 shadow-inner"
                                >
                                    {Object.entries(KDC_LABELS).map(([k, v]) => (
                                        <option key={k} value={k}>
                                            {v}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    id="book-title"
                                    placeholder="어떤 책을 읽었나요?"
                                    className="w-full p-4 bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-indigo-400 shadow-inner"
                                />
                                <input id="book-author" placeholder="저자(지은이)" className="w-full p-4 bg-slate-50 rounded-2xl outline-none" />
                                <textarea
                                    id="book-content"
                                    placeholder="이 책을 읽고 내 생각이 어떻게 자라났나요?"
                                    className="w-full p-4 bg-slate-50 rounded-2xl h-48 outline-none resize-none leading-relaxed border-2 border-transparent focus:border-indigo-400 shadow-inner"
                                ></textarea>
                                <button
                                    onClick={() => savePost("book")}
                                    className="w-full bg-indigo-600 text-white font-bold p-5 rounded-3xl text-xl shadow-xl active:scale-95 transition-all"
                                >
                                    오늘의 기록 남기기 🚀
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === "write-life" && (
                    <div className="flex flex-col md:flex-row gap-6 animate-pop">
                        <div className="flex-1 space-y-4 md:max-h-[70vh] md:overflow-y-auto pr-2 custom-scrollbar order-2 md:order-1">
                            <h3 className="font-bold text-slate-800 text-lg font-gaegu ml-2 italic underline decoration-emerald-200 underline-offset-4 mb-4">
                                나의 일상 조각들 ✨
                            </h3>
                            {posts.filter((p) => p.writerId === appUser.id && p.type === "life").length === 0 ? (
                                <div className="text-center py-20 text-slate-300 italic">일상의 조각을 모아보세요.</div>
                            ) : (
                                posts
                                    .filter((p) => p.writerId === appUser.id && p.type === "life")
                                    .map((post) => (
                                        <div key={post.id} className="bg-white/80 p-4 rounded-2xl shadow-sm border border-white mb-3 flex gap-3 items-center">
                                            {post.imageUrl && <img src={post.imageUrl} className="w-12 h-12 rounded-lg object-cover border" />}
                                            <div>
                                                <p className="text-[10px] text-emerald-500 font-bold">{new Date(post.timestamp).toLocaleDateString()}</p>
                                                <p className="text-xs text-slate-600 line-clamp-2">{post.content}</p>
                                            </div>
                                        </div>
                                    ))
                            )}
                        </div>
                        <div className="flex-1 bg-white rounded-[2rem] p-8 shadow-lg border-4 border-white order-1 md:order-2 h-fit sticky top-4">
                            <h3 className="text-3xl font-bold mb-6 text-slate-800 font-gaegu text-center underline decoration-emerald-100">✨ 오늘의 조각</h3>
                            <div className="space-y-4">
                                <textarea
                                    id="life-content"
                                    placeholder="오늘 있었던 특별한 일을 자유롭게 기록해요."
                                    className="w-full p-4 bg-slate-50 rounded-2xl h-60 outline-none resize-none shadow-inner border-2 border-transparent focus:border-emerald-400 leading-relaxed"
                                ></textarea>

                                <div className="text-center">
                                    {selectedLifeImg && (
                                        <div className="relative mb-4 animate-pop">
                                            <img
                                                src={selectedLifeImg}
                                                className="w-full rounded-2xl border-4 border-white shadow-md max-h-60 object-cover"
                                                alt="Preview"
                                            />
                                            <button
                                                onClick={() => setSelectedLifeImg(null)}
                                                className="absolute top-2 right-2 bg-black/50 text-white w-8 h-8 rounded-full flex items-center justify-center"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    )}
                                    <label className="flex items-center justify-center gap-2 w-full p-4 bg-slate-100 rounded-2xl border-2 border-dashed border-slate-300 cursor-pointer text-slate-500 font-bold hover:bg-slate-200 transition shadow-sm">
                                        <i className="fa-solid fa-camera text-xl"></i> 사진 한 조각 추가
                                        <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                                    </label>
                                </div>
                                <button
                                    onClick={() => savePost("life")}
                                    className="w-full bg-emerald-500 text-white font-bold p-5 rounded-3xl text-xl shadow-xl active:scale-95 transition mt-2"
                                >
                                    조각 보관하기 📮
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === "secret" && (
                    <div className="bg-[#b2c7da] p-0 rounded-[2.5rem] border-4 border-white shadow-2xl animate-pop max-w-xl mx-auto flex flex-col h-[75vh] overflow-hidden">
                        <header className="bg-[#b2c7da] p-4 flex items-center justify-between border-b border-black/5">
                            <div className="flex items-center gap-3">
                                {appUser.role === "admin" ? (
                                    adminChatTarget ? (
                                        <button onClick={() => setAdminChatTarget(null)} className="text-slate-700 mr-2">
                                            <i className="fa-solid fa-chevron-left"></i>
                                        </button>
                                    ) : null
                                ) : null}
                                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-slate-400">
                                    {appUser.role === "admin" ? (
                                        adminChatTarget?.profileImg ? (
                                            <img src={adminChatTarget.profileImg} className="w-full h-full object-cover rounded-xl" />
                                        ) : (
                                            <i className="fa-solid fa-user-graduate"></i>
                                        )
                                    ) : (
                                        <i className="fa-solid fa-chalkboard-user"></i>
                                    )}
                                </div>
                                <h3 className="font-bold text-slate-800 text-lg">
                                    {appUser.role === "admin"
                                        ? adminChatTarget
                                            ? `${adminChatTarget.name} 작가님`
                                            : "학생 목록"
                                        : "선생님과의 1:1 대화"}
                                </h3>
                            </div>
                            <i className="fa-solid fa-envelope text-slate-600"></i>
                        </header>

                        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-[#b2c7da]">
                            {appUser.role === "admin" && !adminChatTarget ? (
                                <div className="space-y-2">
                                    {allUsers
                                        .filter((u) => u.role !== "admin")
                                        .map((student) => (
                                            <button
                                                key={student.id}
                                                onClick={() => setAdminChatTarget(student)}
                                                className="w-full flex items-center gap-4 bg-white/50 p-4 rounded-2xl hover:bg-white transition-all shadow-sm"
                                            >
                                                <div className="w-10 h-10 rounded-full bg-white border overflow-hidden flex items-center justify-center text-slate-300">
                                                    {student.profileImg ? (
                                                        <img src={student.profileImg} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <i className="fa-solid fa-user"></i>
                                                    )}
                                                </div>
                                                <div className="text-left flex-1">
                                                    <p className="font-bold text-slate-800">
                                                        {student.no}번 {student.name}
                                                    </p>
                                                    <p className="text-[10px] text-slate-500 truncate">{student.statusMsg || "대화 내용 없음"}</p>
                                                </div>
                                                <i className="fa-solid fa-chevron-right text-slate-400"></i>
                                            </button>
                                        ))}
                                </div>
                            ) : (appUser.role === "admin" ? adminSelectedSecrets : secrets).length === 0 ? (
                                <div className="text-center py-20 text-slate-500 italic text-sm">대화를 시작해보세요! 👋</div>
                            ) : (
                                (appUser.role === "admin" ? adminSelectedSecrets : secrets).map((msg) => {
                                    const isMe = msg.senderId === appUser.id;
                                    return (
                                        <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                                            {!isMe && (
                                                <div className="w-8 h-8 rounded-lg bg-white flex-shrink-0 mr-2 flex items-center justify-center text-[10px] text-slate-400 border">
                                                    {appUser.role === "admin" ? "학생" : "교사"}
                                                </div>
                                            )}
                                            <div className="flex flex-col max-w-[75%]">
                                                {!isMe && (
                                                    <span className="text-[9px] text-slate-600 mb-1 ml-1 font-bold">{msg.senderName}</span>
                                                )}
                                                <div className={`p-3 text-sm shadow-sm relative ${isMe ? "chat-bubble-me" : "chat-bubble-other"}`}>
                                                    {msg.content}
                                                </div>
                                                <span className="text-[8px] text-slate-500 mt-1 self-end">{msg.date}</span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {(appUser.role !== "admin" || adminChatTarget) && (
                            <div className="p-3 bg-white flex gap-2 items-center">
                                <input
                                    id="chat-input"
                                    placeholder="메시지를 입력하세요"
                                    className="flex-1 p-3 bg-slate-100 rounded-xl outline-none text-sm font-bold border-none"
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && e.target.value) {
                                            appUser.role === "admin" ? sendAdminReply(e.target.value) : sendSecret(e.target.value);
                                            e.target.value = "";
                                        }
                                    }}
                                />
                                <button
                                    onClick={() => {
                                        const input = document.getElementById("chat-input");
                                        if (input.value) {
                                            appUser.role === "admin" ? sendAdminReply(input.value) : sendSecret(input.value);
                                            input.value = "";
                                        }
                                    }}
                                    className="bg-[#fee500] text-[#3b1e1e] w-12 h-10 rounded-xl flex items-center justify-center shadow-md active:scale-95 transition-all"
                                >
                                    <i className="fa-solid fa-paper-plane"></i>
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === "admin" && (
                    <div className="space-y-6 animate-pop max-w-2xl mx-auto">
                        <div className="bg-white rounded-[2rem] p-8 shadow-sm border-4 border-white">
                            <h3 className="text-xl font-bold text-slate-800 font-gaegu mb-4">
                                <i className="fa-solid fa-user-pen text-indigo-500 mr-2"></i>프로필 & 상태 관리
                            </h3>
                            <div className="flex flex-col md:flex-row items-center gap-8">
                                <div className="relative">
                                    <div className="w-28 h-28 rounded-[2.5rem] bg-slate-100 border-4 border-white shadow-xl overflow-hidden flex items-center justify-center text-slate-300 text-4xl">
                                        {appUser.profileImg ? (
                                            <img src={appUser.profileImg} className="w-full h-full object-cover" />
                                        ) : (
                                            <i className="fa-solid fa-user"></i>
                                        )}
                                    </div>
                                    <label className="absolute bottom-[-10px] right-[-10px] bg-indigo-600 text-white w-10 h-10 rounded-full flex items-center justify-center cursor-pointer shadow-lg hover:bg-indigo-700 transition-all active:scale-90">
                                        <i className="fa-solid fa-camera text-sm"></i>
                                        <input type="file" className="hidden" accept="image/*" onChange={handleProfileUpload} />
                                    </label>
                                </div>
                                <div className="flex-1 w-full space-y-3">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-400 ml-2 uppercase">Name</label>
                                        <input
                                            id="profile-name"
                                            defaultValue={appUser.name}
                                            className="w-full p-4 bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-indigo-400 shadow-inner"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-slate-400 ml-2 uppercase">Status Message</label>
                                        <input
                                            id="profile-status"
                                            defaultValue={appUser.statusMsg}
                                            placeholder="오늘의 다짐을 적어보세요"
                                            className="w-full p-4 bg-slate-50 rounded-2xl font-bold outline-none border-2 border-transparent focus:border-indigo-400 shadow-inner"
                                        />
                                    </div>
                                    <button
                                        onClick={updateProfile}
                                        className="w-full bg-indigo-600 text-white font-bold p-4 rounded-2xl shadow-lg hover:bg-indigo-700 transition-all active:scale-95"
                                    >
                                        저장하기 ✅
                                    </button>
                                </div>
                            </div>
                        </div>

                        {appUser.role === "admin" ? (
                            <>
                                <div className="bg-white rounded-[2rem] p-8 shadow-sm border-4 border-white">
                                    <h3 className="text-xl font-bold text-slate-800 font-gaegu mb-4">
                                        <i className="fa-solid fa-chart-pie text-red-500 mr-2"></i>반 독서 통계 현황 (선생님 전용)
                                    </h3>
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto custom-scrollbar">
                                            {Object.entries(
                                                posts.reduce((acc, p) => {
                                                    if (p.type === "book") acc[p.writer] = (acc[p.writer] || 0) + 1;
                                                    return acc;
                                                }, {})
                                            )
                                                .sort((a, b) => b[1] - a[1])
                                                .map(([name, count], i) => (
                                                    <div
                                                        key={name}
                                                        className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:bg-indigo-50 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <span
                                                                className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold ${
                                                                    i < 3 ? "bg-yellow-400 text-white" : "bg-slate-200 text-slate-500"
                                                                }`}
                                                            >
                                                                {i + 1}
                                                            </span>
                                                            <span className="font-bold text-slate-700">{name} 작가님</span>
                                                        </div>
                                                        <span className="bg-white px-3 py-1 rounded-full text-indigo-600 font-bold text-sm shadow-sm border border-indigo-100">
                                                            {count} 권
                                                        </span>
                                                    </div>
                                                ))}
                                        </div>
                                        <div className="mt-6 p-6 bg-indigo-600 rounded-3xl text-center shadow-xl shadow-indigo-100">
                                            <p className="text-xs text-indigo-100 font-bold uppercase mb-1 tracking-widest">누적 우리 반 전체 기록</p>
                                            <p className="text-4xl font-bold text-white font-gaegu">
                                                {posts.filter((p) => p.type === "book").length} 권의 독서 로드
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white rounded-[2rem] p-8 shadow-sm border-4 border-white">
                                    <h3 className="text-xl font-bold text-slate-800 font-gaegu mb-4">
                                        <i className="fa-solid fa-users-gear text-slate-500 mr-2"></i>전체 회원 관리
                                    </h3>
                                    <div className="space-y-2">
                                        {allUsers.map((u) => (
                                            <div key={u.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-white overflow-hidden border">
                                                        {u.profileImg ? (
                                                            <img src={u.profileImg} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <i className="fa-solid fa-user text-slate-300 m-2"></i>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-sm text-slate-800">
                                                            {u.no}번 {u.name} ({u.id})
                                                        </p>
                                                        <p className="text-[10px] text-slate-400">가입일: {new Date(u.createdAt).toLocaleDateString()}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span
                                                        className={`text-[9px] px-2 py-0.5 rounded-full font-bold ${
                                                            u.role === "admin" ? "bg-red-100 text-red-500" : "bg-slate-200 text-slate-500"
                                                        }`}
                                                    >
                                                        {u.role}
                                                    </span>
                                                    {u.role !== "admin" && (
                                                        <button
                                                            onClick={async () => {
                                                                if (confirm("정말 삭제할까요?")) {
                                                                    await deleteDoc(doc(db, "artifacts", appId, "public", "data", "users", u.id));
                                                                    showAlert("삭제되었습니다.", "🗑️");
                                                                }
                                                            }}
                                                            className="text-slate-300 hover:text-red-500 transition-colors px-2"
                                                        >
                                                            <i className="fa-solid fa-xmark"></i>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="bg-white rounded-[2rem] p-8 shadow-sm border-4 border-white">
                                <h3 className="text-xl font-bold text-slate-800 font-gaegu mb-4">
                                    <i className="fa-solid fa-calendar-days text-indigo-400 mr-2"></i>나의 독서 마일리지 달력
                                </h3>
                                <div className="grid grid-cols-7 gap-2 text-center text-[10px] font-bold text-slate-400 mb-2 italic">
                                    <div>SUN</div>
                                    <div>MON</div>
                                    <div>TUE</div>
                                    <div>WED</div>
                                    <div>THU</div>
                                    <div>FRI</div>
                                    <div>SAT</div>
                                </div>
                                <div className="grid grid-cols-7 gap-1">{renderCalendar()}</div>
                                <div className="mt-6 p-4 bg-indigo-50 rounded-2xl flex justify-between items-center border border-indigo-100">
                                    <span className="text-xs font-bold text-indigo-500">누적 나의 독서량</span>
                                    <span className="text-2xl font-bold text-indigo-600 font-gaegu">
                                        {posts.filter((p) => p.writerId === appUser.id && p.type === "book").length} 권
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>

            <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-2xl shadow-[0_-15px_40px_rgba(0,0,0,0.15)] rounded-t-[3.5rem] px-4 pt-5 pb-8 flex justify-between items-center z-[4000] border-t-[6px] border-white">
                <button
                    onClick={() => {
                        setActiveTab("feed");
                        setAdminChatTarget(null);
                    }}
                    className={`flex flex-col items-center gap-1 transition-all flex-1 ${activeTab === "feed" ? "nav-item active" : "nav-item"}`}
                >
                    <i className="fa-solid fa-house-chimney text-2xl"></i>
                    <span className="nav-text">홈</span>
                </button>
                <button
                    onClick={() => setActiveTab("write-book")}
                    className={`flex flex-col items-center gap-1 transition-all flex-1 ${activeTab === "write-book" ? "nav-item active" : "nav-item"}`}
                >
                    <i className="fa-solid fa-book-open-reader text-2xl"></i>
                    <span className="nav-text">독서기록</span>
                </button>
                <button
                    onClick={() => setActiveTab("write-life")}
                    className={`flex flex-col items-center gap-1 transition-all flex-1 ${activeTab === "write-life" ? "nav-item active" : "nav-item"}`}
                >
                    <i className="fa-solid fa-pen-fancy text-2xl"></i>
                    <span className="nav-text">조각</span>
                </button>
                <button
                    onClick={() => setActiveTab("secret")}
                    className={`flex flex-col items-center gap-1 transition-all flex-1 ${activeTab === "secret" ? "nav-item active" : "nav-item"}`}
                >
                    <i className="fa-solid fa-envelope text-2xl"></i>
                    <span className="nav-text">우체통</span>
                </button>
                <button
                    onClick={() => setActiveTab("admin")}
                    className={`flex flex-col items-center gap-1 transition-all flex-1 ${activeTab === "admin" ? "nav-item active" : "nav-item"}`}
                >
                    <i className="fa-solid fa-star-of-life text-2xl"></i>
                    <span className="nav-text">관리</span>
                </button>
            </nav>

            {showComments && (
                <div className="fixed inset-0 bg-black/60 z-[5000] flex flex-col justify-end backdrop-blur-sm">
                    <div className="bg-white rounded-t-[3rem] p-8 w-full max-w-xl mx-auto border-t-8 border-indigo-400 shadow-2xl animate-in slide-in-from-bottom duration-300">
                        <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-8"></div>
                        <h4 className="font-bold text-center mb-8 font-gaegu text-3xl text-indigo-600 italic underline decoration-indigo-100 decoration-4">
                            응원 댓글 💬
                        </h4>
                        <div className="space-y-4 max-h-[40vh] overflow-y-auto mb-24 px-2 custom-scrollbar">
                            {showComments.comments.length === 0 ? (
                                <p className="text-center py-10 text-slate-300 italic font-gaegu text-xl">첫 댓글을 달아보세요!</p>
                            ) : (
                                showComments.comments.map((c, i) => (
                                    <div key={i} className="bg-slate-50 p-4 rounded-2xl border-2 border-white flex flex-col animate-pop shadow-sm">
                                        <div className="flex justify-between mb-1">
                                            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">{c.writer} 작가님</span>
                                            <span className="text-[8px] text-slate-300 font-bold">
                                                {new Date(c.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-700 font-medium">{c.content}</p>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 p-6 bg-white border-t flex gap-2 rounded-t-[2rem]">
                            <input
                                value={commentInput}
                                onChange={(e) => setCommentInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && addComment()}
                                placeholder="응원의 한마디를 입력하세요"
                                className="flex-1 p-4 bg-slate-100 rounded-2xl outline-none font-bold shadow-inner border-2 border-transparent focus:border-indigo-400 transition-all"
                            />
                            <button
                                onClick={addComment}
                                className="bg-indigo-600 text-white px-8 rounded-2xl font-bold shadow-lg shadow-indigo-100 active:scale-95 transition-all"
                            >
                                보내기
                            </button>
                        </div>
                        <button
                            onClick={() => setShowComments(null)}
                            className="absolute top-8 right-8 text-slate-300 text-3xl hover:text-indigo-600 transition-all"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}

            {alert.show && (
                <div className="fixed inset-0 bg-black/40 z-[6000] flex items-center justify-center p-6 backdrop-blur-md">
                    <div className="bg-white p-10 rounded-[3.5rem] text-center w-full max-w-xs shadow-2xl border-b-8 border-indigo-500 animate-pop">
                        <div className="text-7xl mb-6 drop-shadow-xl">{alert.icon}</div>
                        <p className="font-bold text-slate-800 text-2xl mb-10 leading-tight font-gaegu tracking-tight">{alert.msg}</p>
                        <button
                            onClick={() => setAlert({ ...alert, show: false })}
                            className="w-full bg-indigo-600 text-white p-5 rounded-3xl font-bold text-xl active:scale-95 shadow-lg shadow-indigo-100 transition-all"
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
