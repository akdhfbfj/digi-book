/**
 * Vercel Serverless: 환경 변수 ALADIN_TTB_KEY 를 JS로 내려줍니다.
 * 빌드(npm run build) 없이도 배포만으로 알라딘 검색이 동작합니다.
 * 로컬(Live Server)에서는 이 URL이 404여도 aladin.config.local.js 가 이어서 로드됩니다.
 */
module.exports = (req, res) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    const fromEnv = (process.env.ALADIN_TTB_KEY || "").trim();
    // Vercel: 환경 변수 우선. 로컬은 aladin.config.local.js 가 먼저 있으면 env 비었을 때 유지.
    const line = `window.__ALADIN_TTB_KEY__ = (${JSON.stringify(fromEnv)} || "").trim() || (window.__ALADIN_TTB_KEY__ || "").trim();`;
    res.status(200).send(line);
};
