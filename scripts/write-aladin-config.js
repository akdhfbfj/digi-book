/**
 * Vercel 등 배포 시 환경 변수 ALADIN_TTB_KEY 로 aladin.config.deploy.js 생성.
 * 로컬에서는 aladin.config.local.js 가 이어서 로드되어 덮어씀.
 */
const fs = require("fs");
const path = require("path");

const key = process.env.ALADIN_TTB_KEY || "";
const outPath = path.join(__dirname, "..", "aladin.config.deploy.js");
const contents = `// Generated at build time. Do not commit real keys; set ALADIN_TTB_KEY on the host (e.g. Vercel).
window.__ALADIN_TTB_KEY__ = ${JSON.stringify(key)};
`;

fs.writeFileSync(outPath, contents, "utf8");
console.log("write-aladin-config:", outPath, key ? `(key length ${key.length})` : "(empty — set ALADIN_TTB_KEY for production)");
