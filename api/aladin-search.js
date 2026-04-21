/**
 * 알라딘 ItemSearch — CallBack 없이 output=js 는 순수 JSON 본문을 돌려줌.
 * 브라우저 JSONP 대신 서버에서 호출해 배포 도메인·클라이언트 차이를 줄임.
 */
const ALADIN_ITEM_SEARCH_URL = "https://www.aladin.co.kr/ttb/api/ItemSearch.aspx";

function itemsFromPayload(data) {
    if (!data || typeof data !== "object") return [];
    const raw = data.item ?? data.Item ?? data.items ?? data.Items;
    if (raw == null) return [];
    return Array.isArray(raw) ? raw : [raw];
}

module.exports = async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");

    if (req.method !== "GET" && req.method !== "HEAD") {
        return res.status(405).json({ ok: false, error: "Method not allowed", items: [] });
    }

    const key = (process.env.ALADIN_TTB_KEY || "").trim();
    if (!key) {
        return res.status(503).json({
            ok: false,
            error: "ALADIN_TTB_KEY 미설정",
            errorMessage: "Vercel Environment Variables에 ALADIN_TTB_KEY를 넣고 재배포해 주세요.",
            items: [],
        });
    }

    const q = String(req.query.q || req.query.query || "").trim();
    if (!q) {
        return res.status(400).json({ ok: false, error: "검색어 없음", items: [] });
    }

    const url = new URL(ALADIN_ITEM_SEARCH_URL);
    url.searchParams.set("ttbkey", key);
    url.searchParams.set("Query", q);
    url.searchParams.set("QueryType", "Keyword");
    url.searchParams.set("MaxResults", "10");
    url.searchParams.set("start", "1");
    url.searchParams.set("SearchTarget", "Book");
    url.searchParams.set("output", "js");
    url.searchParams.set("Cover", "MidBig");

    try {
        const aladinRes = await fetch(url.toString(), {
            headers: { Accept: "application/json,text/plain,*/*" },
        });
        const text = await aladinRes.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            return res.status(502).json({
                ok: false,
                errorMessage: "알라딘 응답을 JSON으로 읽지 못했어요.",
                items: [],
            });
        }

        if (typeof data.errorCode === "number" && data.errorCode !== 0) {
            return res.status(200).json({
                ok: false,
                errorMessage: data.errorMessage || "알라딘 API 오류",
                items: [],
            });
        }

        return res.status(200).json({ ok: true, items: itemsFromPayload(data) });
    } catch (e) {
        return res.status(502).json({
            ok: false,
            errorMessage: e.message || "알라딘 서버 연결 실패",
            items: [],
        });
    }
};
