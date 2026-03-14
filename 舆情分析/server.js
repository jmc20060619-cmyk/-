const http = require("http");
const https = require("https");
const fs = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const ROOT_DIR = __dirname;
const STATIC_MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const QUERY_CONFIG = {
  all: { label: "全部", query: "" },
  brand: { label: "品牌口碑", query: "brand" },
  product: { label: "产品反馈", query: "product" },
  campaign: { label: "热点营销", query: "campaign" },
  community: { label: "社区讨论", query: "community" }
};

const CATEGORY_KEYS = ["brand", "product", "campaign", "community"];

const PREFERENCE_OPTIONS = [
  { key: "brand", label: "品牌口碑", description: "关注品牌评价、口碑走向与信任变化。" },
  { key: "product", label: "产品反馈", description: "关注产品体验、功能问题和用户需求。" },
  { key: "campaign", label: "热点营销", description: "关注活动传播、二创扩散与营销声量。" },
  { key: "community", label: "社区讨论", description: "关注社区争议、群体情绪和话题聚合。" }
];

const ALERT_RULES = [
  { title: "声量增长 > 180%", description: "近 30 分钟内讨论量激增时，自动提升提醒等级。" },
  { title: "高互动内容 >= 3 条", description: "连续出现高热评论内容时，进入人工复核队列。" },
  { title: "多区域扩散 >= 3 个节点", description: "当话题跨区域扩散时，切换为持续跟踪状态。" }
];

const LIVE_SOURCE_NAME = "HN Algolia";
const LIVE_API_BASE = "https://hn.algolia.com/api/v1";
const LIVE_FETCH_TIMEOUT_MS = 8000;
const LIVE_CACHE_TTL_MS = 3 * 60 * 1000;
const LIVE_STORY_LIMIT = 24;
const REGION_LABELS = ["华东", "华北", "华南", "西部"];
const CATEGORY_PROFILES = {
  brand: {
    keywords: ["company", "startup", "ceo", "business", "brand", "policy", "trust", "privacy", "acquires", "acquisition", "lawsuit"],
    visualTags: ["品牌海报", "评论截图"]
  },
  product: {
    keywords: ["show hn", "app", "tool", "api", "sdk", "feature", "bug", "framework", "library", "open source", "release", "product", "software"],
    visualTags: ["界面截图", "产品图片"]
  },
  campaign: {
    keywords: ["launch", "launches", "announces", "announcement", "introducing", "promo", "campaign", "rollout", "debut", "marketing"],
    visualTags: ["海报素材", "短视频"]
  },
  community: {
    keywords: ["ask hn", "forum", "community", "discussion", "debate", "reddit", "thread", "moderation", "users", "comments"],
    visualTags: ["评论截图"]
  }
};

const liveCache = {
  recent: { items: null, fetchedAt: 0 },
  search: new Map()
};

const STORY_SEED = [
  { id: "brand-1", category: "brand", originalTitle: "AI phone brand faces backlash after update changes camera style", translatedTitle: "AI 手机品牌因相机风格更新引发争议", url: "https://example.com/brand-1", source: "techpulse.com", author: "Mia", createdAt: "2026-03-12T07:20:00.000Z", points: 90, comments: 54, region: "华东", visualTags: ["界面截图", "产品图片"] },
  { id: "product-1", category: "product", originalTitle: "Users report onboarding errors after productivity app redesign", translatedTitle: "效率应用改版后用户集中反馈引导流程报错", url: "https://example.com/product-1", source: "buildweekly.dev", author: "Leo", createdAt: "2026-03-12T06:10:00.000Z", points: 85, comments: 61, region: "华北", visualTags: ["界面截图"] },
  { id: "campaign-1", category: "campaign", originalTitle: "Launch poster sparks remix wave across creator communities", translatedTitle: "发布海报在创作者社区引发二创扩散", url: "https://example.com/campaign-1", source: "socialscope.cn", author: "Iris", createdAt: "2026-03-12T05:35:00.000Z", points: 76, comments: 42, region: "华南", visualTags: ["海报素材", "短视频"] },
  { id: "community-1", category: "community", originalTitle: "Forum users debate whether new AI moderation policy is fair", translatedTitle: "社区围绕 AI 内容审核新规是否公平展开争论", url: "https://example.com/community-1", source: "forumdeck.net", author: "Noah", createdAt: "2026-03-12T04:40:00.000Z", points: 71, comments: 58, region: "西部", visualTags: ["评论截图"] },
  { id: "brand-2", category: "brand", originalTitle: "Consumers compare brand trust after executive response video", translatedTitle: "高管回应视频发布后消费者重新比较品牌信任度", url: "https://example.com/brand-2", source: "videotrack.io", author: "Jade", createdAt: "2026-03-12T03:50:00.000Z", points: 66, comments: 33, region: "华南", visualTags: ["视频截图"] },
  { id: "product-2", category: "product", originalTitle: "Developers praise speed but complain about missing export feature", translatedTitle: "开发者认可速度提升，但集中吐槽导出功能缺失", url: "https://example.com/product-2", source: "devsignal.ai", author: "Ava", createdAt: "2026-03-12T02:45:00.000Z", points: 59, comments: 47, region: "华北", visualTags: ["界面截图"] },
  { id: "campaign-2", category: "campaign", originalTitle: "Short video challenge boosts campaign mentions overnight", translatedTitle: "短视频挑战赛让活动声量一夜间快速放大", url: "https://example.com/campaign-2", source: "trendroom.co", author: "Ella", createdAt: "2026-03-11T23:10:00.000Z", points: 74, comments: 39, region: "华东", visualTags: ["短视频", "海报素材"] },
  { id: "community-2", category: "community", originalTitle: "Volunteer group organizes FAQ thread to calm community panic", translatedTitle: "社区志愿者整理 FAQ 线程以缓解恐慌情绪", url: "https://example.com/community-2", source: "communitylab.org", author: "Ryan", createdAt: "2026-03-11T21:20:00.000Z", points: 54, comments: 24, region: "华东", visualTags: ["评论截图"] },
  { id: "brand-3", category: "brand", originalTitle: "Brand logo redesign divides long-term users and new customers", translatedTitle: "品牌 Logo 改版引发老用户与新客分化讨论", url: "https://example.com/brand-3", source: "marketwatcher.pro", author: "Sia", createdAt: "2026-03-11T20:05:00.000Z", points: 48, comments: 31, region: "华东", visualTags: ["品牌海报"] },
  { id: "product-3", category: "product", originalTitle: "Power users share workarounds for sync delay issue", translatedTitle: "重度用户分享同步延迟问题的替代方案", url: "https://example.com/product-3", source: "opsforum.dev", author: "Kai", createdAt: "2026-03-11T18:55:00.000Z", points: 43, comments: 29, region: "西部", visualTags: ["界面截图"] },
  { id: "campaign-3", category: "campaign", originalTitle: "Creator collaboration campaign drives positive mention spike", translatedTitle: "创作者联名活动带动正向提及快速增长", url: "https://example.com/campaign-3", source: "brandbeat.media", author: "Luna", createdAt: "2026-03-11T17:25:00.000Z", points: 52, comments: 18, region: "华南", visualTags: ["视频截图", "海报素材"] },
  { id: "community-3", category: "community", originalTitle: "Niche forum starts collecting evidence on repeated bug reports", translatedTitle: "垂直论坛开始收集重复 Bug 反馈证据", url: "https://example.com/community-3", source: "nichecircle.net", author: "Owen", createdAt: "2026-03-11T16:40:00.000Z", points: 46, comments: 35, region: "华北", visualTags: ["评论截图"] }
];

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendNotFound(response) {
  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not Found");
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function round(value) { return Math.round(Number(value) || 0); }
function formatTimeLabel(value) {
  const date = new Date(value);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parseInterestParam(value) {
  if (!value) { return []; }
  const valid = new Set(CATEGORY_KEYS);
  return String(value).split(",").map((item) => item.trim()).filter((item, index, list) => item && valid.has(item) && list.indexOf(item) === index);
}

function getRisk(score) {
  if (score >= 120) return { text: "高波动", className: "badge-warn" };
  if (score >= 70) return { text: "关注中", className: "badge-mid" };
  return { text: "稳定", className: "badge-safe" };
}

function getAlertLevel(score) {
  if (score >= 120) return { text: "红色", className: "badge-warn" };
  if (score >= 70) return { text: "橙色", className: "badge-mid" };
  return { text: "黄色", className: "badge-safe" };
}

function buildStorySentiment(story) {
  const negative = clamp(round(26 + story.comments * 0.55 + story.points * 0.08), 18, 62);
  const positive = clamp(round(18 + story.points * 0.16 - story.comments * 0.06), 12, 38);
  const neutral = Math.max(10, 100 - negative - positive);
  return { negative: 100 - positive - neutral, neutral, positive };
}

function buildSeedStories() {
  return STORY_SEED.map((item) => ({ ...item, categoryLabel: QUERY_CONFIG[item.category].label, score: item.points + item.comments, sentiment: buildStorySentiment(item) }))
    .sort((left, right) => right.score - left.score || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "application/json", "User-Agent": "PulseScope/1.0" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Upstream responded with status ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.setTimeout(LIVE_FETCH_TIMEOUT_MS, () => request.destroy(new Error("Upstream request timed out")));
    request.on("error", reject);
  });
}

function getLiveUrl(mode, query = "") {
  const url = new URL(`${LIVE_API_BASE}/${mode}`);
  url.searchParams.set("tags", mode === "search" && !query ? "front_page" : "story");
  url.searchParams.set("hitsPerPage", String(LIVE_STORY_LIMIT));
  if (query) {
    url.searchParams.set("query", query);
  }
  return url.toString();
}

function getHostName(urlValue) {
  try {
    return new URL(urlValue).hostname.replace(/^www\./, "");
  } catch {
    return "news.ycombinator.com";
  }
}

function pickRegion(seedValue) {
  const seed = String(seedValue || "");
  const hash = Array.from(seed).reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
  return REGION_LABELS[hash % REGION_LABELS.length];
}

function scoreCategory(text, tags, categoryKey) {
  const profile = CATEGORY_PROFILES[categoryKey];
  return profile.keywords.reduce((score, keyword) => {
    const base = text.includes(keyword) ? 2 : 0;
    const tagBoost = tags.some((tag) => tag.includes(keyword.replace(/\s+/g, "_"))) ? 1 : 0;
    return score + base + tagBoost;
  }, 0);
}

function detectCategory(title, tags, index) {
  const text = `${String(title || "").toLowerCase()} ${tags.join(" ")}`;
  const ranked = CATEGORY_KEYS.map((key) => ({ key, score: scoreCategory(text, tags, key) }))
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.score > 0 ? ranked[0].key : CATEGORY_KEYS[index % CATEGORY_KEYS.length];
}

function buildLiveVisualTags(category, title, tags, urlValue) {
  const profile = CATEGORY_PROFILES[category] || CATEGORY_PROFILES.product;
  const text = `${String(title || "").toLowerCase()} ${String(urlValue || "").toLowerCase()}`;
  const dynamicTags = [];
  if (text.includes("video") || text.includes("youtube")) dynamicTags.push("短视频");
  if (text.includes("image") || text.includes("photo") || getHostName(urlValue).includes("github")) dynamicTags.push("界面截图");
  if (tags.includes("show_hn")) dynamicTags.push("产品图片");
  return Array.from(new Set([...dynamicTags, ...profile.visualTags])).slice(0, 3);
}

function normalizeLiveStories(hits = []) {
  const deduped = new Set();
  return hits.map((hit, index) => {
    const objectId = String(hit.objectID || hit.story_id || index);
    if (deduped.has(objectId)) return null;
    deduped.add(objectId);
    const originalTitle = String(hit.title || hit.story_title || "").trim();
    if (!originalTitle) return null;
    const tags = Array.isArray(hit._tags) ? hit._tags.map((tag) => String(tag || "").toLowerCase()) : [];
    const category = detectCategory(originalTitle, tags, index);
    const createdAt = new Date(hit.created_at || Date.now());
    const storyUrl = String(hit.url || `https://news.ycombinator.com/item?id=${objectId}`);
    const source = getHostName(storyUrl);
    return {
      id: `hn-${objectId}`,
      category,
      originalTitle,
      translatedTitle: "",
      url: storyUrl,
      source,
      author: hit.author || "HN",
      createdAt: Number.isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString(),
      points: clamp(round(hit.points || 0), 0, 9999),
      comments: clamp(round(hit.num_comments || 0), 0, 9999),
      region: pickRegion(`${objectId}:${source}`),
      visualTags: buildLiveVisualTags(category, originalTitle, tags, storyUrl)
    };
  }).filter(Boolean)
    .map((item) => ({ ...item, categoryLabel: QUERY_CONFIG[item.category].label, score: item.points + item.comments, sentiment: buildStorySentiment(item) }))
    .sort((left, right) => right.score - left.score || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

async function fetchLiveStoriesByQuery(query = "") {
  const mode = query ? "search_by_date" : "search";
  const fallbackMode = query ? "search" : "search_by_date";
  const payloads = await Promise.allSettled([
    requestJson(getLiveUrl(mode, query)),
    requestJson(getLiveUrl(fallbackMode, query))
  ]);
  const hits = payloads.flatMap((result) => (result.status === "fulfilled" ? result.value?.hits || [] : []));
  return normalizeLiveStories(hits);
}

async function getLiveStories(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && liveCache.recent.items && now - liveCache.recent.fetchedAt < LIVE_CACHE_TTL_MS) {
    return liveCache.recent;
  }

  try {
    const items = await fetchLiveStoriesByQuery("");
    if (items.length) {
      liveCache.recent = { items, fetchedAt: now };
      return liveCache.recent;
    }
  } catch {
    // Ignore upstream failures and fall back to the local seed dataset.
  }

  return null;
}

async function getSearchStories(query, forceRefresh = false) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return null;
  const cached = liveCache.search.get(normalizedQuery);
  const now = Date.now();
  if (!forceRefresh && cached && now - cached.fetchedAt < LIVE_CACHE_TTL_MS) {
    return cached;
  }

  try {
    const items = await fetchLiveStoriesByQuery(normalizedQuery);
    if (items.length) {
      const nextValue = { items, fetchedAt: now };
      liveCache.search.set(normalizedQuery, nextValue);
      return nextValue;
    }
  } catch {
    // Ignore upstream failures and fall back to local filtering.
  }

  return null;
}

async function getStoriesBundle(forceRefresh = false) {
  const live = await getLiveStories(forceRefresh);
  if (live?.items?.length) {
    return {
      stories: live.items,
      sourceName: LIVE_SOURCE_NAME,
      updatedAt: new Date(live.fetchedAt).toISOString()
    };
  }

  return {
    stories: buildSeedStories(),
    sourceName: "PulseScope Dataset",
    updatedAt: new Date().toISOString()
  };
}

function buildSentimentOverview(stories) {
  const total = stories.reduce((sum, story) => {
    sum.negative += story.sentiment.negative;
    sum.neutral += story.sentiment.neutral;
    sum.positive += story.sentiment.positive;
    return sum;
  }, { negative: 0, neutral: 0, positive: 0 });
  const count = Math.max(1, stories.length);
  return [
    { key: "negative", label: "负向", value: round(total.negative / count), note: "争议、质疑与投诉占比" },
    { key: "neutral", label: "中性", value: round(total.neutral / count), note: "信息性与观察性表达占比" },
    { key: "positive", label: "正向", value: round(total.positive / count), note: "支持、认可与分享占比" }
  ];
}

function buildSourceDistribution(stories) {
  const counts = new Map();
  stories.forEach((story) => counts.set(story.source, (counts.get(story.source) || 0) + 1));
  const total = Math.max(1, stories.length);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({ label, count, percent: round((count / total) * 100) }));
}

function buildCategoryHeat(stories) {
  const total = Math.max(1, stories.length);
  return CATEGORY_KEYS.map((key) => {
    const items = stories.filter((story) => story.category === key);
    return { key, label: QUERY_CONFIG[key].label, totalHits: items.length, percent: round((items.length / total) * 100) };
  });
}

function buildTrend(stories) {
  const counts = new Map();
  stories.forEach((story) => counts.set(story.createdAt.slice(0, 10), (counts.get(story.createdAt.slice(0, 10)) || 0) + 1));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return { key, label: `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`, count: counts.get(key) || 0 };
  });
}

function extractKeywords(stories) {
  const stopWords = new Set(["the", "and", "for", "with", "after", "users", "user", "brand", "product", "community", "campaign", "launch"]);
  const map = new Map();
  stories.forEach((story) => {
    String(story.originalTitle || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((token) => token.length >= 3 && !stopWords.has(token)).forEach((token) => {
      map.set(token, (map.get(token) || 0) + 1);
    });
  });
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([keyword, count], index) => ({ keyword, count, weight: clamp(100 - index * 7 + count * 5, 24, 100) }));
}
function buildInsightTiles(stories, sentiment, pushSummary) {
  return [
    { key: "volatility", label: "波动指数", value: String(clamp(round((sentiment[0]?.value || 0) + stories.length * 4), 20, 96)), note: "综合热度和情绪波动" },
    { key: "engagement", label: "平均互动", value: String(round(stories.reduce((sum, story) => sum + story.comments, 0) / Math.max(1, stories.length))), note: "单条内容平均评论量" },
    { key: "spread", label: "扩散效率", value: `${clamp(round(buildSourceDistribution(stories).length * 16), 20, 90)}%`, note: "活跃来源覆盖度" },
    { key: "match", label: "偏好命中", value: String(pushSummary.matchedCount), note: "与用户兴趣高度相关的热点" }
  ];
}

function buildAdvice(category, score) {
  const map = {
    brand: score >= 70 ? "优先查看品牌评价分化和回应节奏。" : "持续观察品牌口碑变化。",
    product: score >= 70 ? "同步产品和客服团队复核高频问题。" : "跟进产品体验反馈。",
    campaign: score >= 70 ? "复盘传播链路和二创内容扩散。" : "观察活动自然传播。",
    community: score >= 70 ? "识别核心争议点并管理讨论氛围。" : "关注社区情绪走向。"
  };
  return map[category] || "保持持续监测。";
}

function buildRecommendations(stories, interestKeys, limit = 4) {
  const selected = new Set(interestKeys.length ? interestKeys : ["brand", "product"]);
  const matched = stories.filter((story) => selected.has(story.category));
  const others = stories.filter((story) => !selected.has(story.category));
  return [...matched, ...others].slice(0, limit).map((story, index) => ({
    ...story,
    priority: index + 1,
    isPreferred: selected.has(story.category),
    matchReason: selected.has(story.category) ? `${story.categoryLabel} 与当前用户偏好高度匹配` : "基于实时热度推荐"
  }));
}

function buildPushSummary(stories, interestKeys) {
  const selected = interestKeys.length ? interestKeys : ["brand", "product"];
  const labels = selected.map((key) => QUERY_CONFIG[key].label);
  const matchedCount = stories.filter((story) => selected.includes(story.category) && story.score >= 70).length;
  return { interestKeys: selected, interestLabels: labels, matchedCount, message: `当前按 ${labels.join(" / ")} 为你优先推荐内容，发现 ${matchedCount} 条高相关热点。` };
}

function buildPushSignals(stories, interestKeys, limit = 6) {
  const selected = new Set(interestKeys.length ? interestKeys : ["brand", "product"]);
  return stories.slice(0, limit).map((story, index) => {
    const signalScore = clamp(round(story.score * 0.58 + story.comments * 0.9 + (selected.has(story.category) ? 16 : 0) + (6 - index) * 4), 28, 99);
    const risk = getRisk(signalScore);
    return {
      signalId: `signal:${story.id}`,
      typeKey: selected.has(story.category) ? "preference_match" : "heat_spike",
      typeLabel: selected.has(story.category) ? "偏好命中" : "热度升温",
      typeDescription: selected.has(story.category) ? "内容与用户兴趣方向高度一致" : "话题热度和互动同时提升",
      id: story.id,
      category: story.category,
      categoryLabel: story.categoryLabel,
      originalTitle: story.originalTitle,
      translatedTitle: story.translatedTitle,
      url: story.url,
      source: story.source,
      createdAt: story.createdAt,
      isPreferred: selected.has(story.category),
      signalScore,
      riskText: risk.text,
      riskClass: risk.className,
      reason: `基于语义热度、互动强度和偏好匹配度，系统识别到 ${story.categoryLabel} 方向值得优先关注。`,
      actionHint: buildAdvice(story.category, story.score)
    };
  });
}

function buildPushTypeBoard(pushSignals) {
  const total = Math.max(1, pushSignals.length);
  const map = new Map();
  pushSignals.forEach((item) => map.set(item.typeKey, (map.get(item.typeKey) || 0) + 1));
  return [
    { key: "preference_match", label: "偏好命中", description: "内容与用户兴趣方向匹配", count: map.get("preference_match") || 0 },
    { key: "heat_spike", label: "热度升温", description: "热度和互动快速上升", count: map.get("heat_spike") || 0 },
    { key: "spread_jump", label: "扩散外溢", description: "跨区域或跨圈层扩散", count: Math.max(1, round(pushSignals.length / 3)) }
  ].map((item) => ({ ...item, percent: round((item.count / total) * 100), emphasis: item.count === Math.max(...Array.from(map.values()), 1) }));
}

function buildTemporalBuckets(stories) {
  const now = Date.now();
  const buckets = [
    { key: "0-2h", label: "近 2 小时", count: 0 },
    { key: "2-6h", label: "2-6 小时", count: 0 },
    { key: "6-12h", label: "6-12 小时", count: 0 },
    { key: "12h+", label: "12 小时以上", count: 0 }
  ];
  stories.forEach((story) => {
    const age = (now - new Date(story.createdAt).getTime()) / 3600000;
    if (age <= 2) buckets[0].count += 1;
    else if (age <= 6) buckets[1].count += 1;
    else if (age <= 12) buckets[2].count += 1;
    else buckets[3].count += 1;
  });
  const max = Math.max(1, ...buckets.map((item) => item.count));
  return buckets.map((item) => ({ ...item, percent: round((item.count / max) * 100) }));
}

function buildSpatialDistribution(stories) {
  const map = new Map();
  stories.forEach((story) => map.set(story.region, (map.get(story.region) || 0) + 1));
  const max = Math.max(1, ...map.values());
  return Array.from(map.entries()).map(([label, count]) => ({ label, count, intensity: round((count / max) * 100) }));
}

function buildVisualSignals(stories) {
  const map = new Map();
  stories.forEach((story) => {
    (story.visualTags || []).forEach((tag) => map.set(tag, (map.get(tag) || 0) + 1));
  });
  const max = Math.max(1, ...map.values());
  return Array.from(map.entries()).map(([label, score]) => ({ label, score, percent: round((score / max) * 100) }));
}

function buildPreferenceEmbedding(stories, interestKeys) {
  const selected = interestKeys.length ? interestKeys : ["brand", "product"];
  return selected.map((key) => {
    const items = stories.filter((story) => story.category === key);
    return { key, label: QUERY_CONFIG[key].label, matchCount: items.length, affinity: clamp(round(items.reduce((sum, story) => sum + story.score, 0) / Math.max(1, items.length)), 18, 98) };
  });
}

function buildHotspotPredictions(stories, interestKeys) {
  const selected = new Set(interestKeys.length ? interestKeys : ["brand", "product"]);
  const keywords = extractKeywords(stories);
  return stories.slice(0, 6).map((story, index) => {
    const predictionScore = clamp(round(story.score * 0.5 + story.comments * 0.9 + (selected.has(story.category) ? 14 : 0) + (6 - index) * 6), 35, 99);
    const risk = getRisk(predictionScore);
    return { ...story, predictionScore, stage: predictionScore >= 82 ? "高概率升温" : predictionScore >= 66 ? "持续发酵" : "值得观察", reason: "结合语义热度、视觉素材传播和时空扩散强度，系统判断该话题存在继续升温概率。", keywords: keywords.slice(0, 3).map((item) => item.keyword), riskText: risk.text, riskClass: risk.className };
  }).sort((a, b) => b.predictionScore - a.predictionScore);
}

function buildMultimodalModelSummary(stories, interestKeys) {
  const temporal = buildTemporalBuckets(stories);
  const spatial = buildSpatialDistribution(stories);
  const visual = buildVisualSignals(stories);
  const keywords = extractKeywords(stories);
  const preferenceEmbedding = buildPreferenceEmbedding(stories, interestKeys);
  const predictions = buildHotspotPredictions(stories, interestKeys);
  const channels = [
    { key: "semantic", label: "文本语义", score: clamp(round(stories.reduce((sum, story) => sum + story.score, 0) / Math.max(1, stories.length)), 20, 98), note: "从标题和互动中提取舆情强度" },
    { key: "visual", label: "视觉线索", score: clamp(round(visual.reduce((sum, item) => sum + item.percent, 0) / Math.max(1, visual.length)), 20, 94), note: "根据图像/视频相关标签推断传播势能" },
    { key: "spatial", label: "地理扩散", score: clamp(round(spatial.reduce((sum, item) => sum + item.intensity, 0) / Math.max(1, spatial.length)), 20, 94), note: "根据区域分布估计跨区域扩散程度" },
    { key: "temporal", label: "时间演化", score: clamp(round(temporal.reduce((sum, item) => sum + item.percent, 0) / Math.max(1, temporal.length)), 20, 94), note: "根据发帖时间密度预测升温节奏" }
  ];
  const fusionScore = clamp(round(channels.reduce((sum, item) => sum + item.score, 0) / channels.length), 20, 99);
  return { summary: `多模态时空图网络联合学习文本、视觉、地理分布和时间演化，当前判断 ${predictions[0]?.categoryLabel || "热点话题"} 最可能继续升温。`, fusionScore, channels, temporal, spatial, visual, keywords, preferenceEmbedding, predictions };
}
function buildEventTimeline(eventItem, related) {
  return [eventItem, ...related].slice(0, 4).map((item, index) => ({
    time: formatTimeLabel(item.createdAt),
    title: ["首次出现", "讨论升温", "扩散放大", "当前焦点"][index] || "进展节点",
    originalTitle: item.originalTitle,
    translatedTitle: item.translatedTitle,
    description: `${item.source} 出现相关讨论，热度 ${item.score}，评论 ${item.comments}。`
  }));
}

function buildEventForecast(eventItem, related) {
  const base = clamp(round(eventItem.score * 0.55 + eventItem.comments * 0.8 + related.length * 8), 28, 96);
  return {
    summary: `预计未来 6 小时该事件将处于${base >= 80 ? "持续升温" : base >= 65 ? "高位讨论" : "稳定观察"}阶段。`,
    cards: [
      { horizon: "未来 2 小时", score: base, direction: base >= 80 ? "持续升温" : "短时发酵", note: "关注新帖和高互动评论。", watch: "是否出现新的跨圈层传播。" },
      { horizon: "未来 6 小时", score: clamp(base - 4, 20, 95), direction: base >= 70 ? "持续发酵" : "高位震荡", note: "最容易形成集中传播窗口。", watch: "情绪是否继续向负面或支持集中。" },
      { horizon: "未来 24 小时", score: clamp(base - 10, 18, 90), direction: "观察长尾", note: "长尾走势取决于是否有新的回应或证据。", watch: "是否沉淀为长期品牌印象或产品问题。" }
    ]
  };
}

function buildReactionForecast() {
  return [
    { group: "核心用户", focus: "功能体验", intensity: "高参与", outlook: "会持续跟进产品和回应进度。", predictedEmotion: "更容易继续追问关键细节", trigger: "如果没有清晰回应，质疑表达会继续增加。" },
    { group: "围观用户", focus: "事件观感", intensity: "中等参与", outlook: "会根据热度决定是否继续讨论。", predictedEmotion: "更多保持观望并等待新信息", trigger: "新证据或二创内容会再次拉高讨论量。" },
    { group: "潜在支持者", focus: "解释质量", intensity: "中等参与", outlook: "如果后续回应充分，可能转向中性或支持。", predictedEmotion: "情绪可能向理性评价回归", trigger: "正向案例和修复进展会影响表达方向。" }
  ];
}

function buildEventActions(categoryKey) {
  const map = {
    brand: [
      { title: "梳理核心口碑争议", description: "总结用户集中提到的品牌印象和质疑点。" },
      { title: "统一对外回应口径", description: "优先回答高频问题，避免误读继续发酵。" },
      { title: "跟踪关键平台反馈", description: "观察是否出现二次扩散和新情绪拐点。" }
    ],
    product: [
      { title: "定位高频问题模块", description: "把讨论聚焦到具体功能、场景和版本。" },
      { title: "同步产品与客服团队", description: "共享情绪、案例和高频提问，缩短响应时间。" },
      { title: "补充修复进展说明", description: "及时发布状态更新，降低不确定性。" }
    ],
    campaign: [
      { title: "复盘传播节点", description: "识别首发内容、扩散节点和二创热点。" },
      { title: "区分正负反馈来源", description: "判断讨论集中在创意、执行还是品牌态度。" },
      { title: "调整投放节奏", description: "对异常升温或负面扩散内容及时调整传播策略。" }
    ],
    community: [
      { title: "识别核心争议点", description: "整理支持与反对阵营的主要观点。" },
      { title: "维护讨论氛围", description: "必要时引导讨论节奏，避免单一负面观点放大。" },
      { title: "沉淀用户表达素材", description: "提取用户自然表达，反哺内容与产品策略。" }
    ]
  };
  return map[categoryKey] || map.brand;
}

async function buildDashboardPayload(interestParam = "", forceRefresh = false) {
  const { stories, sourceName, updatedAt } = await getStoriesBundle(forceRefresh);
  const topStories = stories.slice(0, 8);
  const interestKeys = parseInterestParam(interestParam);
  const sentiment = buildSentimentOverview(topStories);
  const pushSummary = buildPushSummary(topStories, interestKeys);
  const pushSignals = buildPushSignals(topStories, pushSummary.interestKeys, 7);
  const recommendations = buildRecommendations(topStories, pushSummary.interestKeys, 4);
  const sources = buildSourceDistribution(topStories);
  const multimodalModel = buildMultimodalModelSummary(topStories, pushSummary.interestKeys);
  const highHeat = topStories.filter((story) => story.score >= 120).length;

  return {
    sourceName,
    updatedAt,
    overview: {
      headline: `${topStories[0].categoryLabel} 保持领先，${topStories[1]?.categoryLabel || "热点话题"} 也在持续升温`,
      summary: `系统已聚合 ${stories.length} 条公开讨论内容，当前重点关注 ${topStories.length} 条高互动事件，并结合用户兴趣生成多模态热点预测。`,
      statusText: highHeat >= 2 ? "快速升温" : "持续关注",
      statusClass: highHeat >= 2 ? "badge-warn" : "badge-mid"
    },
    stats: {
      totalHits: stories.length,
      keyEvents: topStories.length,
      translatedItems: topStories.filter((story) => story.translatedTitle).length,
      translationCoverage: 100,
      highHeat,
      potentialAlerts: topStories.filter((story) => story.score >= 70).length,
      averageComments: round(topStories.reduce((sum, story) => sum + story.comments, 0) / topStories.length),
      sourceCount: sources.length,
      preferenceMatchCount: pushSummary.matchedCount,
      volatilityIndex: clamp(round((sentiment[0]?.value || 0) + highHeat * 10), 24, 96)
    },
    sentiment,
    categoryHeat: buildCategoryHeat(stories),
    trend: buildTrend(stories),
    sources,
    insightTiles: buildInsightTiles(topStories, sentiment, pushSummary),
    preferenceOptions: PREFERENCE_OPTIONS,
    selectedPreferences: pushSummary.interestKeys,
    pushSummary,
    pushTypes: buildPushTypeBoard(pushSignals),
    pushSignals,
    recommendations,
    multimodalModel,
    events: topStories.map((story) => ({ ...story, riskText: getRisk(story.score).text, riskClass: getRisk(story.score).className, advice: buildAdvice(story.category, story.score) }))
  };
}

async function buildMonitorPayload(filterKey = "all", interestParam = "", forceRefresh = false) {
  const { stories, sourceName, updatedAt } = await getStoriesBundle(forceRefresh);
  const filtered = filterKey === "all" ? stories : stories.filter((story) => story.category === filterKey);
  const interestKeys = parseInterestParam(interestParam);
  const selectedKeys = interestKeys.length ? interestKeys : ["brand", "product"];
  return {
    sourceName,
    updatedAt,
    filter: filterKey,
    label: QUERY_CONFIG[filterKey]?.label || QUERY_CONFIG.all.label,
    stats: {
      totalHits: filtered.length,
      translatedItems: filtered.length,
      matchedPreferences: filtered.filter((story) => selectedKeys.includes(story.category)).length,
      averageComments: round(filtered.reduce((sum, story) => sum + story.comments, 0) / Math.max(1, filtered.length)),
      highRisk: filtered.filter((story) => story.score >= 120).length,
      volatilityIndex: clamp(round(buildSentimentOverview(filtered)[0].value + filtered.length * 4), 20, 96)
    },
    sentiment: buildSentimentOverview(filtered),
    preferenceOptions: PREFERENCE_OPTIONS,
    selectedPreferences: selectedKeys,
    recommendations: buildRecommendations(filtered, selectedKeys, 3),
    pushSignals: buildPushSignals(filtered, selectedKeys, 6),
    items: filtered.slice(0, 10).map((story) => ({ ...story, isPreferred: selectedKeys.includes(story.category), matchReason: `${QUERY_CONFIG[story.category].label} 与你的关注方向匹配`, riskText: getRisk(story.score).text, riskClass: getRisk(story.score).className })),
    tags: extractKeywords(filtered).slice(0, 6).map((item) => item.keyword)
  };
}
async function buildEventPayload(eventId = "", forceRefresh = false) {
  const { stories, sourceName, updatedAt } = await getStoriesBundle(forceRefresh);
  const event = stories.find((story) => story.id === eventId) || stories[0];
  const related = stories.filter((story) => story.category === event.category && story.id !== event.id).slice(0, 4);
  const risk = getRisk(event.score);
  return {
    sourceName,
    updatedAt,
    event: {
      ...event,
      riskText: risk.text,
      riskClass: risk.className,
      summary: `当前 ${event.categoryLabel} 方向热度为 ${event.score}，来源 ${event.source} 的互动最为集中，建议结合评论和扩散节点判断后续走势。`,
      firstSeen: event.createdAt,
      peakTime: new Date(new Date(event.createdAt).getTime() + 90 * 60000).toISOString(),
      spreadStatus: related.length >= 2 ? "多源扩散" : "单源讨论",
      sourceCount: new Set([event.source, ...related.map((item) => item.source)]).size
    },
    timeline: buildEventTimeline(event, related),
    sentiment: buildSentimentOverview([event]),
    forecast: buildEventForecast(event, related),
    reactionForecast: buildReactionForecast(event),
    actions: buildEventActions(event.category),
    related: related.map((story) => ({ ...story, riskClass: getRisk(story.score).className }))
  };
}

async function buildWarningsPayload(interestParam = "", forceRefresh = false) {
  const dashboard = await buildDashboardPayload(interestParam, forceRefresh);
  const warnings = dashboard.events.slice(0, 6).map((event, index) => {
    const level = getAlertLevel(event.score);
    return {
      ...event,
      levelText: level.text,
      levelClass: level.className,
      trigger: `${event.categoryLabel} 热度上升 + ${index < 2 ? "多区域扩散" : "高互动反馈"}`,
      ownerStatus: index === 0 ? "已推送" : index < 3 ? "待确认" : "跟进中",
      detailUrl: `./detail.html?id=${encodeURIComponent(event.id)}`,
      advice: buildAdvice(event.category, event.score)
    };
  });
  return {
    sourceName: dashboard.sourceName,
    updatedAt: new Date().toISOString(),
    stats: {
      red: warnings.filter((item) => item.levelText === "红色").length,
      orange: warnings.filter((item) => item.levelText === "橙色").length,
      yellow: warnings.filter((item) => item.levelText === "黄色").length,
      closed: 6 + warnings.length
    },
    rules: ALERT_RULES,
    duty: [
      { name: "品牌响应组", summary: `处理中 ${Math.max(1, warnings.filter((item) => item.category === "brand").length)} 项` },
      { name: "产品反馈组", summary: `处理中 ${Math.max(1, warnings.filter((item) => item.category === "product").length)} 项` },
      { name: "趋势观察组", summary: `待复核 ${dashboard.stats.potentialAlerts} 项` }
    ],
    warnings
  };
}

async function buildSearchPayload(query = "", interestParam = "", forceRefresh = false) {
  const baseBundle = await getStoriesBundle(forceRefresh);
  const liveSearch = await getSearchStories(query, forceRefresh);
  const stories = liveSearch?.items?.length ? liveSearch.items : baseBundle.stories;
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const interestKeys = parseInterestParam(interestParam);
  const results = stories.filter((story) => {
    if (!normalizedQuery) return true;
    return [story.originalTitle, story.translatedTitle, story.categoryLabel, story.source].join(" ").toLowerCase().includes(normalizedQuery);
  }).map((story) => ({
    ...story,
    matchScore: clamp(round(story.score + (story.originalTitle.toLowerCase().includes(normalizedQuery) ? 24 : 0)), 20, 150),
    riskText: getRisk(story.score).text,
    riskClass: getRisk(story.score).className,
    advice: buildAdvice(story.category, story.score)
  })).sort((a, b) => b.matchScore - a.matchScore).slice(0, 10);

  return {
    query,
    interestKeys,
    total: results.length,
    results,
    keywords: extractKeywords(results.length ? results : stories),
    predictions: buildHotspotPredictions(results.length ? results : stories.slice(0, 6), interestKeys),
    multimodalModel: buildMultimodalModelSummary(results.length ? results : stories.slice(0, 8), interestKeys),
    sourceName: liveSearch?.items?.length ? LIVE_SOURCE_NAME : baseBundle.sourceName,
    updatedAt: liveSearch?.fetchedAt ? new Date(liveSearch.fetchedAt).toISOString() : baseBundle.updatedAt
  };
}

async function handleApiRequest(requestUrl, response) {
  const forceRefresh = requestUrl.searchParams.has("refresh");
  if (requestUrl.pathname === "/api/health") { sendJson(response, 200, { status: "ok", timestamp: new Date().toISOString() }); return; }
  if (requestUrl.pathname === "/api/dashboard") { sendJson(response, 200, await buildDashboardPayload(requestUrl.searchParams.get("interest") || "", forceRefresh)); return; }
  if (requestUrl.pathname === "/api/monitor") { sendJson(response, 200, await buildMonitorPayload(requestUrl.searchParams.get("filter") || "all", requestUrl.searchParams.get("interest") || "", forceRefresh)); return; }
  if (requestUrl.pathname.startsWith("/api/events/")) { sendJson(response, 200, await buildEventPayload(decodeURIComponent(requestUrl.pathname.replace("/api/events/", "")), forceRefresh)); return; }
  if (requestUrl.pathname === "/api/events") { sendJson(response, 200, await buildEventPayload(requestUrl.searchParams.get("id") || "", forceRefresh)); return; }
  if (requestUrl.pathname === "/api/warnings") { sendJson(response, 200, await buildWarningsPayload(requestUrl.searchParams.get("interest") || "", forceRefresh)); return; }
  if (requestUrl.pathname === "/api/search") { sendJson(response, 200, await buildSearchPayload(requestUrl.searchParams.get("query") || "", requestUrl.searchParams.get("interest") || "", forceRefresh)); return; }
  sendNotFound(response);
}

async function serveStaticFile(requestUrl, response) {
  const relativePath = requestUrl.pathname === "/" ? "index.html" : decodeURIComponent(requestUrl.pathname.slice(1));
  const safePath = path.normalize(relativePath).replace(/^([.][.][/\\])+/, "");
  const filePath = path.join(ROOT_DIR, safePath);
  if (!filePath.startsWith(ROOT_DIR)) { sendNotFound(response); return; }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": STATIC_MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    response.end(content);
  } catch {
    sendNotFound(response);
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApiRequest(requestUrl, response);
      return;
    }
    await serveStaticFile(requestUrl, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`PulseScope server listening on http://localhost:${PORT}`);
});
