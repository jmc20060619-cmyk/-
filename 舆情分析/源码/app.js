const currentPage = document.body.dataset.page || "";
const API_BASE = window.location.protocol === "file:" ? "http://localhost:4173" : "";
const PAGE_REFRESH_MS = 60_000;
const DEFAULT_INTERESTS = ["brand", "product"];
const MAX_INTERESTS = 3;
const STORAGE_KEYS = {
  interests: "pulse_scope_interests",
  pushEnabled: "pulse_scope_push_enabled",
  seenIds: "pulse_scope_seen_recommendations",
  seenSignals: "pulse_scope_seen_push_signals"
};

const pageState = {
  dashboard: {
    payload: null,
    timer: null,
    translationEnabled: readBooleanPreference("dashboard_translation", true),
    initialized: false,
    searchPayload: null
  },
  monitor: {
    payload: null,
    timer: null,
    currentFilter: "all",
    translationEnabled: readBooleanPreference("monitor_translation", true),
    initialized: false
  },
  detail: {
    payload: null,
    timer: null,
    currentId: "",
    translationEnabled: readBooleanPreference("detail_translation", true)
  },
  warning: {
    payload: null,
    timer: null,
    translationEnabled: readBooleanPreference("warning_translation", true)
  },
  personalization: {
    interests: readListPreference(STORAGE_KEYS.interests, DEFAULT_INTERESTS),
    pushEnabled: readBooleanPreference(STORAGE_KEYS.pushEnabled, true),
    seenRecommendationIds: readListPreference(STORAGE_KEYS.seenIds, []),
    seenSignalIds: readListPreference(STORAGE_KEYS.seenSignals, [])
  }
};

const activeButtonSelectors = [
  '[data-action="refresh-dashboard"]',
  '[data-action="toggle-dashboard-translation"]',
  '[data-action="search-dashboard"]',
  '[data-action="clear-dashboard-search"]',
  '[data-action="refresh-monitor"]',
  '[data-action="toggle-monitor-translation"]',
  '[data-action="refresh-detail"]',
  '[data-action="toggle-detail-translation"]',
  '[data-action="copy-detail-brief"]',
  '[data-action="download-detail-brief"]',
  '[data-action="refresh-warning"]',
  '[data-action="toggle-warning-translation"]',
  '[data-action="copy-warning-brief"]',
  '[data-action="download-warning-brief"]',
  '[data-action="toggle-push"]'
];

let toastTimer = null;

document.querySelectorAll("[data-nav]").forEach((link) => {
  if (link.dataset.nav === currentPage) {
    link.classList.add("is-active");
  }
});

function readBooleanPreference(key, fallbackValue) {
  try {
    const savedValue = window.localStorage.getItem(key);
    return savedValue === null ? fallbackValue : savedValue === "true";
  } catch {
    return fallbackValue;
  }
}

function readListPreference(key, fallbackValue) {
  try {
    const savedValue = window.localStorage.getItem(key);
    if (!savedValue) {
      return [...fallbackValue];
    }

    const parsed = JSON.parse(savedValue);
    return Array.isArray(parsed) ? parsed : [...fallbackValue];
  } catch {
    return [...fallbackValue];
  }
}

function writePreference(key, value) {
  try {
    window.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    // Ignore localStorage failures.
  }
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }

  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");

  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2400);
}

function normalizeFilename(value, fallbackName) {
  const safe = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return safe || fallbackName;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const success = document.execCommand("copy");
  document.body.removeChild(textarea);
  return success;
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(value) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getClientRisk(score) {
  if (score >= 120) {
    return { text: "楂樻尝鍔?, className: "badge-warn" };
  }
  if (score >= 60) {
    return { text: "鍏虫敞涓?, className: "badge-mid" };
  }
  return { text: "绋冲畾", className: "badge-safe" };
}

function buildInterestQuery() {
  return pageState.personalization.interests.join(",");
}

function buildApiPath(basePath, params = {}, forceRefresh = false) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, value);
    }
  });

  if (forceRefresh) {
    searchParams.set("refresh", String(Date.now()));
  }

  const queryString = searchParams.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}

function getDisplayTitle(item, translationEnabled) {
  if (!item) {
    return "--";
  }

  return translationEnabled && item.translatedTitle ? item.translatedTitle : item.originalTitle || item.title || "--";
}

function getSecondaryTitle(item, translationEnabled) {
  if (!item) {
    return "";
  }

  return translationEnabled && item.translatedTitle ? item.originalTitle || "" : item.translatedTitle || "";
}

function renderTitleStack(item, translationEnabled, href = "") {
  const secondary = getSecondaryTitle(item, translationEnabled);
  const content = `
    <div class="title-stack">
      <span class="title-primary">${escapeHtml(getDisplayTitle(item, translationEnabled))}</span>
      ${secondary ? `<span class="title-secondary">${escapeHtml(secondary)}</span>` : ""}
    </div>
  `;

  if (!href) {
    return content;
  }

  return `<a class="title-link" href="${escapeHtml(href)}">${content}</a>`;
}

function setButtonLabel(selector, label, disabled = false) {
  document.querySelectorAll(selector).forEach((button) => {
    button.disabled = disabled;
    button.textContent = label;
  });
}

function setStatusText(elementId, value) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = value;
  }
}

function setVisibility(elementId, isVisible) {
  const element = document.getElementById(elementId);
  if (element) {
    element.classList.toggle("is-hidden", !isVisible);
  }
}

function setPreformattedText(elementId, value) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = value;
  }
}

function setDashboardTranslationButtonLabel() {
  setButtonLabel('[data-action="toggle-dashboard-translation"]', `自动翻译：${pageState.dashboard.translationEnabled ? "开" : "关"}`);
}

function setMonitorTranslationButtonLabel() {
  setButtonLabel('[data-action="toggle-monitor-translation"]', `自动翻译：${pageState.monitor.translationEnabled ? "开" : "关"}`);
}

function setDetailTranslationButtonLabel() {
  setButtonLabel('[data-action="toggle-detail-translation"]', `自动翻译：${pageState.detail.translationEnabled ? "开" : "关"}`);
}

function setWarningTranslationButtonLabel() {
  setButtonLabel('[data-action="toggle-warning-translation"]', `自动翻译：${pageState.warning.translationEnabled ? "开" : "关"}`);
}

function setPushButtonLabel() {
  setButtonLabel('[data-action="toggle-push"]', `智能推送：${pageState.personalization.pushEnabled ? "开" : "关"}`);
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    method: options.method || "GET",
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }

  return response.json();
}

async function loadExternalApiConfig() {
  try {
    const config = await requestJson("/api/external-config");
    const baseUrlInput = document.getElementById("external-api-base-url");
    const tokenInput = document.getElementById("external-api-token");
    const dashboardInput = document.getElementById("external-api-dashboard-endpoint");
    const searchInput = document.getElementById("external-api-search-endpoint");
    if (baseUrlInput) baseUrlInput.value = config.base_url || "";
    if (tokenInput) tokenInput.value = config.token || "";
    if (dashboardInput) dashboardInput.value = config.endpoints?.dashboard || "/dashboard";
    if (searchInput) searchInput.value = config.endpoints?.search || "/search";
    setStatusText("external-api-status", config.enabled ? `当前连接外部 API：${config.base_url || "--"}` : "当前使用本地分析引擎");
    return config;
  } catch {
    setStatusText("external-api-status", "外部 API 配置读取失败，已回退本地模式");
    return null;
  }
}

function readExternalApiForm() {
  return {
    enabled: true,
    base_url: document.getElementById("external-api-base-url")?.value.trim() || "",
    token: document.getElementById("external-api-token")?.value.trim() || "",
    endpoints: {
      dashboard: document.getElementById("external-api-dashboard-endpoint")?.value.trim() || "/dashboard",
      search: document.getElementById("external-api-search-endpoint")?.value.trim() || "/search",
      monitor: "/monitor",
      events: "/events",
      warnings: "/warnings"
    }
  };
}

async function saveExternalApiConfig(enabled = true) {
  const payload = readExternalApiForm();
  payload.enabled = enabled && Boolean(payload.base_url);
  const saved = await requestJson("/api/external-config", { method: "POST", body: payload });
  setStatusText("external-api-status", saved.enabled ? `当前连接外部 API：${saved.base_url || "--"}` : "当前使用本地分析引擎");
  showToast(saved.enabled ? "外部 API 已启用。" : "已切回本地分析模式。");
  return saved;
}

async function testExternalApiConfig() {
  try {
    const testPayload = await requestJson("/api/external-test");
    setStatusText("external-api-status", testPayload.message || "连接测试完成");
    showToast(testPayload.ok ? "外部 API 连接成功。" : "外部 API 未连通，当前可继续使用本地模式。");
  } catch {
    showToast("外部 API 测试失败。");
  }
}

function renderSentimentBars(containerId, items, showNotes = false) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">褰撳墠鏆傛棤鎯呯华缁撴瀯鏁版嵁銆?/p>';
    return;
  }

  container.innerHTML = items
    .map((item) => `
      <div class="bar-group">
        <div class="bar-row">
          <span>${escapeHtml(item.label)}</span>
          <div class="bar"><i style="width: ${Math.max(4, Number(item.value) || 0)}%"></i></div>
          <strong>${escapeHtml(String(item.value))}%</strong>
        </div>
        ${showNotes && item.note ? `<p class="sentiment-note">${escapeHtml(item.note)}</p>` : ""}
      </div>
    `)
    .join("");
}

function renderSentimentRing(score, label) {
  const ring = document.getElementById("dashboard-sentiment-ring");
  if (!ring) {
    return;
  }

  const safeScore = clamp(Number(score) || 0, 0, 100);
  ring.style.setProperty("--ring-fill", `${safeScore / 100}`);
  setStatusText("dashboard-ring-value", safeScore);
  setStatusText("dashboard-ring-label", label || "娉㈠姩鎸囨暟");
}

function renderModelChannels(items) {
  const container = document.getElementById("dashboard-model-channels");
  if (!container) {
    return;
  }

  if (!items?.length) {
    container.innerHTML = '<p class="empty-state">当前暂无多模态通道数据。</p>';
    return;
  }

  container.innerHTML = items.map((item) => `
    <article class="model-channel-card">
      <div class="model-channel-top">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(String(item.score))}</strong>
      </div>
      <div class="category-bar"><i style="width: ${Math.max(8, Number(item.score) || 0)}%"></i></div>
      <p class="stat-foot">${escapeHtml(item.note || "")}</p>
    </article>
  `).join("");
}

function renderKeywordCluster(items) {
  const container = document.getElementById("dashboard-keyword-cluster");
  if (!container) {
    return;
  }

  if (!items?.length) {
    container.innerHTML = '<p class="empty-state">当前暂无关键词聚类。</p>';
    return;
  }

  container.innerHTML = items.map((item, index) => `
    <span class="keyword-pill ${index < 3 ? "is-hot" : ""}">${escapeHtml(item.keyword)}<strong>${escapeHtml(String(item.count))}</strong></span>
  `).join("");
}

function renderSpatialHeatmap(items) {
  const container = document.getElementById("dashboard-spatial-heatmap");
  if (!container) {
    return;
  }

  if (!items?.length) {
    container.innerHTML = '<p class="empty-state">当前暂无空间扩散数据。</p>';
    return;
  }

  container.innerHTML = items.map((item) => `
    <article class="spatial-card">
      <div class="spatial-card-top">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(String(item.count))}</strong>
      </div>
      <div class="heat-dots"><i style="width:${Math.max(10, item.intensity)}%"></i></div>
      <p class="stat-foot">扩散强度 ${escapeHtml(String(item.intensity))}%</p>
    </article>
  `).join("");
}

function renderPredictionList(items, containerId = "dashboard-prediction-list") {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  if (!items?.length) {
    container.innerHTML = '<p class="empty-state">当前暂无热点预测。</p>';
    return;
  }

  container.innerHTML = items.map((item) => `
    <article class="prediction-card">
      <div class="signal-card-top">
        <div class="recommendation-meta">
          <span class="soft-badge">${escapeHtml(item.categoryLabel || "热点")}</span>
          <span class="badge ${escapeHtml(item.riskClass || "badge-safe")}">${escapeHtml(item.riskText || item.stage || "观察中")}</span>
        </div>
        <strong class="signal-type-value">${escapeHtml(String(item.predictionScore || item.matchScore || 0))}</strong>
      </div>
      ${renderTitleStack(item, pageState.dashboard.translationEnabled, `./detail.html?id=${encodeURIComponent(item.id)}`)}
      <p class="signal-note">${escapeHtml(item.reason || item.advice || "系统正在生成预测原因。")}</p>
      <p class="forecast-watch">${escapeHtml(item.stage || "值得观察")} · ${escapeHtml((item.keywords || []).join(" / ") || "暂无关键词")}</p>
    </article>
  `).join("");
}

function renderPreferenceEmbedding(items) {
  const container = document.getElementById("dashboard-preference-embedding");
  if (!container) {
    return;
  }

  if (!items?.length) {
    container.innerHTML = '<p class="empty-state">当前暂无偏好画像。</p>';
    return;
  }

  container.innerHTML = items.map((item) => `
    <article class="embedding-card">
      <div class="model-channel-top">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(String(item.affinity))}</strong>
      </div>
      <div class="category-bar"><i style="width:${Math.max(8, item.affinity)}%"></i></div>
      <p class="stat-foot">命中 ${escapeHtml(String(item.matchCount))} 条，适合继续推送</p>
    </article>
  `).join("");
}

function renderSearchResults(payload) {
  const container = document.getElementById("dashboard-search-results");
  const emptyState = document.getElementById("dashboard-search-empty");
  if (!container || !emptyState) {
    return;
  }

  if (!payload?.results?.length) {
    container.innerHTML = "";
    emptyState.classList.remove("is-hidden");
    setStatusText("dashboard-search-meta", payload?.query ? `没有找到与“${payload.query}”相关的热点。` : "输入关键词后可搜索热点并查看预测结果");
    return;
  }

  emptyState.classList.add("is-hidden");
  setStatusText("dashboard-search-meta", `搜索“${payload.query}”共匹配 ${payload.total} 条热点，已按热度和相关性排序。`);
  container.innerHTML = payload.results.map((item) => `
    <article class="search-result-card">
      <div class="signal-card-top">
        <div class="recommendation-meta">
          <span class="soft-badge">${escapeHtml(item.categoryLabel)}</span>
          <span class="badge ${escapeHtml(item.riskClass)}">${escapeHtml(item.riskText)}</span>
        </div>
        <strong class="signal-type-value">${escapeHtml(String(item.matchScore || item.score || 0))}</strong>
      </div>
      ${renderTitleStack(item, pageState.dashboard.translationEnabled, `./detail.html?id=${encodeURIComponent(item.id)}`)}
      <p class="signal-note">${escapeHtml(item.advice || "建议继续观察话题扩散。")}</p>
      <div class="link-group">
        <a class="text-link" href="./detail.html?id=${encodeURIComponent(item.id)}">查看详情</a>
        <a class="text-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">查看原文</a>
      </div>
    </article>
  `).join("");
}

async function loadDashboardSearch(query) {
  const keyword = String(query || "").trim();
  if (!keyword) {
    renderSearchResults(null);
    return;
  }

  try {
    setButtonLabel('[data-action="search-dashboard"]', "搜索中...", true);
    const payload = await requestJson(buildApiPath("/api/search", { query: keyword, interest: buildInterestQuery() }, true));
    pageState.dashboard.searchPayload = payload;
    renderSearchResults(payload);
    renderPredictionList(payload.predictions || []);
    if (payload.multimodalModel) {
      setStatusText("dashboard-model-summary", payload.multimodalModel.summary || "");
      setStatusText("dashboard-model-score", `融合分数 ${payload.multimodalModel.fusionScore}`);
      renderModelChannels(payload.multimodalModel.channels || []);
      renderKeywordCluster(payload.keywords || payload.multimodalModel.keywords || []);
      renderSpatialHeatmap(payload.multimodalModel.spatial || []);
      renderTrendList("dashboard-temporal-evolution", payload.multimodalModel.temporal || []);
      renderPreferenceEmbedding(payload.multimodalModel.preferenceEmbedding || []);
    }
  } catch (error) {
    console.error(error);
    showToast("热点搜索失败，请确认本地服务已启动。");
  } finally {
    setButtonLabel('[data-action="search-dashboard"]', "搜索热点", false);
  }
}

function renderDashboardCategoryHeat(items) {
  const container = document.getElementById("dashboard-category-heat");
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">褰撳墠鏆傛棤涓婚鐑害鏁版嵁銆?/p>';
    return;
  }

  container.innerHTML = items
    .map((item) => `
      <div class="category-item">
        <div class="category-row">
          <span>${escapeHtml(item.label)}</span>
          <strong>${item.percent}%</strong>
        </div>
        <div class="category-bar">
          <i style="width: ${Math.max(item.percent, 6)}%"></i>
        </div>
        <p class="category-foot">${formatNumber(item.totalHits)} 鏉″叕寮€鍐呭</p>
      </div>
    `)
    .join("");
}

function renderTrendList(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">褰撳墠鏆傛棤瓒嬪娍鏁版嵁銆?/p>';
    return;
  }

  const maxCount = Math.max(...items.map((item) => item.count), 1);
  container.innerHTML = items
    .map((item) => `
      <div class="trend-row">
        <span class="trend-label">${escapeHtml(item.label)}</span>
        <div class="trend-track">
          <i class="trend-fill" style="width: ${(item.count / maxCount) * 100}%"></i>
        </div>
        <strong>${escapeHtml(String(item.count))}</strong>
      </div>
    `)
    .join("");
}

function renderSourceList(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">褰撳墠鏆傛棤鏉ユ簮鏋勬垚鏁版嵁銆?/p>';
    return;
  }

  container.innerHTML = items
    .map((item) => `
      <div class="source-item">
        <span>${escapeHtml(item.label)}</span>
        <strong>${item.percent}%</strong>
      </div>
    `)
    .join("");
}

function renderInsightTiles(items) {
  const container = document.getElementById("dashboard-insight-tiles");
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">褰撳墠鏆傛棤蹇€熷垽鏂唴瀹广€?/p>';
    return;
  }

  container.innerHTML = items
    .map((item) => `
      <article class="insight-tile">
        <p class="stat-title">${escapeHtml(item.label)}</p>
        <p class="insight-value">${escapeHtml(item.value)}</p>
        <p class="stat-foot">${escapeHtml(item.note)}</p>
      </article>
    `)
    .join("");
}

function renderRecommendationList(containerId, emptyId, items, translationEnabled) {
  const container = document.getElementById(containerId);
  const emptyState = emptyId ? document.getElementById(emptyId) : null;
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = "";
    if (emptyState) {
      emptyState.classList.remove("is-hidden");
    }
    return;
  }

  if (emptyState) {
    emptyState.classList.add("is-hidden");
  }

  container.innerHTML = items
    .map((item) => {
      const risk = item.riskClass ? { text: item.riskText, className: item.riskClass } : getClientRisk(item.score);
      return `
        <article class="recommendation-card">
          <div class="recommendation-meta">
            <span class="soft-badge">${escapeHtml(item.categoryLabel || "鎺ㄨ崘鍐呭")}</span>
            <span class="badge ${risk.className}">${escapeHtml(risk.text)}</span>
          </div>
          ${renderTitleStack(item, translationEnabled, `./detail.html?id=${encodeURIComponent(item.id)}`)}
          <p class="recommendation-reason">${escapeHtml(item.matchReason || "鍩轰簬瀹炴椂鐑害鎺ㄨ崘")}</p>
          <div class="link-group">
            <a class="text-link" href="./detail.html?id=${encodeURIComponent(item.id)}">鏌ョ湅璇︽儏</a>
            <a class="text-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">鏌ョ湅鍘熸枃</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSignalTypeBoard(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">褰撳墠鏆傛棤鍙睍绀虹殑鎺ㄩ€佺被鍨嬨€?/p>';
    return;
  }

  container.innerHTML = items
    .map((item) => `
      <article class="signal-type-card ${item.emphasis ? "is-emphasis" : ""}">
        <div class="signal-type-top">
          <div>
            <p class="stat-title">${escapeHtml(item.label)}</p>
            <p class="signal-note">${escapeHtml(item.description || "瀹炴椂鎺ㄩ€佺被鍨?)}</p>
          </div>
          <strong class="signal-type-value">${escapeHtml(String(item.count))}</strong>
        </div>
        <div class="signal-type-meta">
          <span>${escapeHtml(item.count > 0 ? "娲昏穬涓? : "寰呭懡涓?)}</span>
          <span>${escapeHtml(String(item.percent || 0))}%</span>
        </div>
      </article>
    `)
    .join("");
}

function renderSignalList(containerId, emptyId, items, translationEnabled) {
  const container = document.getElementById(containerId);
  const emptyState = emptyId ? document.getElementById(emptyId) : null;
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = "";
    if (emptyState) {
      emptyState.classList.remove("is-hidden");
    }
    return;
  }

  if (emptyState) {
    emptyState.classList.add("is-hidden");
  }

  container.innerHTML = items
    .map((item) => `
      <article class="signal-card">
        <div class="signal-card-top">
          <div class="recommendation-meta">
            <span class="soft-badge">${escapeHtml(item.typeLabel || "鎺ㄩ€佷俊鍙?)}</span>
            <span class="soft-badge ${item.isPreferred ? "is-strong" : ""}">${escapeHtml(item.categoryLabel || "瀹炴椂璇濋")}</span>
          </div>
          <span class="badge ${escapeHtml(item.riskClass || "badge-safe")}">${escapeHtml(item.riskText || "鍏虫敞涓?)}</span>
        </div>
        ${renderTitleStack(item, translationEnabled, `./detail.html?id=${encodeURIComponent(item.id)}`)}
        <div class="signal-card-body">
          <p class="signal-note">${escapeHtml(item.reason || item.typeDescription || "绯荤粺璇嗗埆鍒版柊鐨勬帹閫佷俊鍙枫€?)}</p>
          <div class="signal-meta">
            <span>淇″彿寮哄害 ${escapeHtml(String(item.signalScore || 0))}</span>
            <span>${escapeHtml(formatDateTime(item.createdAt))}</span>
            <span>${escapeHtml(item.source || "--")}</span>
          </div>
          <p class="forecast-watch">${escapeHtml(item.actionHint || "寤鸿缁х画瑙傚療鍐呭鍙樺寲鍜屼簰鍔ㄩ€熷害銆?)}</p>
          <div class="link-group">
            <a class="text-link" href="./detail.html?id=${encodeURIComponent(item.id)}">鏌ョ湅璇︽儏</a>
            <a class="text-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">鏌ョ湅鍘熸枃</a>
          </div>
        </div>
      </article>
    `)
    .join("");
}

function renderPreferenceChips(containerId, options, selectedKeys) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  const selectedSet = new Set(selectedKeys);
  container.innerHTML = options
    .map((item) => `
      <button
        class="preference-chip ${selectedSet.has(item.key) ? "is-active" : ""}"
        type="button"
        data-interest-key="${escapeHtml(item.key)}"
        aria-pressed="${selectedSet.has(item.key) ? "true" : "false"}"
        title="${escapeHtml(item.description || "")}"
      >
        ${escapeHtml(item.label)}
      </button>
    `)
    .join("");
}

function rememberRecommendationIds(items) {
  const ids = Array.from(
    new Set([...pageState.personalization.seenRecommendationIds, ...items.map((item) => item.id)])
  ).slice(-80);

  pageState.personalization.seenRecommendationIds = ids;
  writePreference(STORAGE_KEYS.seenIds, ids);
}

function rememberSignalIds(items) {
  const ids = Array.from(
    new Set([
      ...pageState.personalization.seenSignalIds,
      ...items.map((item) => item.signalId || `${item.typeKey || "signal"}:${item.id}`)
    ])
  ).slice(-120);

  pageState.personalization.seenSignalIds = ids;
  writePreference(STORAGE_KEYS.seenSignals, ids);
}

function maybeDesktopNotify(title, body) {
  if (!pageState.personalization.pushEnabled || typeof Notification === "undefined") {
    return;
  }

  if (Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

function notifyNewRecommendations(sourceName, recommendations, alreadyInitialized) {
  if (!recommendations?.length) {
    return;
  }

  if (!alreadyInitialized || !pageState.personalization.pushEnabled) {
    rememberRecommendationIds(recommendations);
    return;
  }

  const seenSet = new Set(pageState.personalization.seenRecommendationIds);
  const newItems = recommendations.filter((item) => item.isPreferred && !seenSet.has(item.id));
  if (!newItems.length) {
    return;
  }

  const labels = Array.from(new Set(newItems.map((item) => item.categoryLabel))).join(" / ");
  const message = `发现 ${newItems.length} 条${labels ? `${labels}相关` : ""}新内容`;
  showToast(message);
  maybeDesktopNotify(`${sourceName} 有新推荐`, message);
  rememberRecommendationIds(newItems);
}

function notifyNewSignals(sourceName, signals, alreadyInitialized) {
  if (!signals?.length) {
    return;
  }

  if (!alreadyInitialized || !pageState.personalization.pushEnabled) {
    rememberSignalIds(signals);
    return;
  }

  const seenSet = new Set(pageState.personalization.seenSignalIds);
  const newItems = signals.filter((item) => !seenSet.has(item.signalId || `${item.typeKey || "signal"}:${item.id}`));
  if (!newItems.length) {
    return;
  }

  const typeLabels = Array.from(new Set(newItems.map((item) => item.typeLabel).filter(Boolean))).slice(0, 2).join(" / ");
  const message = `发现 ${newItems.length} 条${typeLabels ? `${typeLabels}` : ""}推送信号`;
  showToast(message);
  maybeDesktopNotify(`${sourceName} 智能推送`, message);
  rememberSignalIds(newItems);
}

function renderTagCloud(items) {
  const container = document.getElementById("tag-cloud");
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">褰撳墠鏆傛棤鏍囩鏁版嵁銆?/p>';
    return;
  }

  container.innerHTML = items
    .map((item, index) => {
      const className = index === 0 ? "tag-large" : index < 4 ? "tag-medium" : "tag-small";
      return `<span class="${className}">${escapeHtml(item)}</span>`;
    })
    .join("");
}

function toggleInterest(interestKey) {
  const interests = [...pageState.personalization.interests];
  const index = interests.indexOf(interestKey);

  if (index >= 0) {
    if (interests.length === 1) {
      showToast("至少保留一个关注方向，推荐才会更准确。");
      return false;
    }
    interests.splice(index, 1);
  } else {
    if (interests.length >= MAX_INTERESTS) {
      showToast("最多选择 3 个关注方向，避免推荐过于分散。");
      return false;
    }
    interests.push(interestKey);
  }

  pageState.personalization.interests = interests;
  writePreference(STORAGE_KEYS.interests, interests);
  return true;
}

async function togglePushMode() {
  pageState.personalization.pushEnabled = !pageState.personalization.pushEnabled;
  writePreference(STORAGE_KEYS.pushEnabled, String(pageState.personalization.pushEnabled));
  setPushButtonLabel();

  if (pageState.personalization.pushEnabled && typeof Notification !== "undefined" && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      // Ignore notification permission failures.
    }
  }

  showToast(pageState.personalization.pushEnabled ? "智能推送已开启。" : "智能推送已关闭。");
}

function renderDashboardEvents(items) {
  const tableBody = document.getElementById("dashboard-table-body");
  const emptyState = document.getElementById("dashboard-table-empty");
  if (!tableBody || !emptyState) {
    return;
  }

  if (!items.length) {
    tableBody.innerHTML = "";
    emptyState.classList.remove("is-hidden");
    return;
  }

  emptyState.classList.add("is-hidden");
  tableBody.innerHTML = items
    .map((item) => `
      <tr>
        <td>${renderTitleStack(item, pageState.dashboard.translationEnabled, `./detail.html?id=${encodeURIComponent(item.id)}`)}</td>
        <td>${escapeHtml(item.categoryLabel)}</td>
        <td>${escapeHtml(String(item.score))}</td>
        <td><span class="badge ${item.riskClass}">${escapeHtml(item.riskText)}</span></td>
        <td>${escapeHtml(item.source)}</td>
        <td>${escapeHtml(item.advice)}</td>
      </tr>
    `)
    .join("");
}

function renderDashboard(payload) {
  const alreadyInitialized = pageState.dashboard.initialized;
  pageState.dashboard.payload = payload;

  setStatusText("dashboard-source-status", `数据源在线：${payload.sourceName}`);
  setStatusText("dashboard-updated", `最近更新：${formatDateTime(payload.updatedAt)}`);
  setStatusText("dashboard-headline", payload.overview.headline);
  setStatusText("dashboard-summary", payload.overview.summary);
  setStatusText("metric-total-hits", formatNumber(payload.stats.totalHits));
  setStatusText("metric-key-events", formatNumber(payload.stats.keyEvents));
  setStatusText("metric-translation-rate", `${payload.stats.translationCoverage}%`);
  setStatusText("metric-total-hits-note", "聚合内容总量");
  setStatusText("metric-key-events-note", "按热度自动排序");
  setStatusText("metric-translation-note", `${payload.stats.translatedItems} 条内容已翻译`);
  setStatusText("stat-high-heat", formatNumber(payload.stats.highHeat));
  setStatusText("stat-avg-comments", formatNumber(payload.stats.averageComments));
  setStatusText("stat-source-count", formatNumber(payload.stats.sourceCount));
  setStatusText("stat-preference-match", formatNumber(payload.stats.preferenceMatchCount));
  setStatusText("dashboard-trend-meta", "近 7 天内容数量走势");
  setStatusText("dashboard-push-summary", payload.pushSummary.message);

  const statusBadge = document.getElementById("dashboard-status");
  if (statusBadge) {
    statusBadge.textContent = payload.overview.statusText;
    statusBadge.className = `badge ${payload.overview.statusClass}`;
  }

  renderSentimentBars("dashboard-sentiment-bars", payload.sentiment, true);
  renderSentimentRing(payload.stats.volatilityIndex, "波动指数");
  renderDashboardCategoryHeat(payload.categoryHeat || []);
  setStatusText("dashboard-model-summary", payload.multimodalModel?.summary || "正在生成模型分析摘要。");
  setStatusText("dashboard-model-score", `融合分数 ${payload.multimodalModel?.fusionScore || "--"}`);
  renderModelChannels(payload.multimodalModel?.channels || []);
  renderKeywordCluster(payload.multimodalModel?.keywords || []);
  renderSpatialHeatmap(payload.multimodalModel?.spatial || []);
  renderTrendList("dashboard-temporal-evolution", payload.multimodalModel?.temporal || []);
  renderPredictionList(payload.multimodalModel?.predictions || []);
  renderPreferenceEmbedding(payload.multimodalModel?.preferenceEmbedding || []);
  renderSourceList("dashboard-source-list", payload.sources || []);
  renderTrendList("dashboard-trend-list", payload.trend || []);
  renderInsightTiles(payload.insightTiles || []);
  renderPreferenceChips("dashboard-preference-chips", payload.preferenceOptions || [], payload.selectedPreferences || []);
  renderRecommendationList(
    "dashboard-recommendation-list",
    "dashboard-recommendation-empty",
    payload.recommendations || [],
    pageState.dashboard.translationEnabled
  );
  renderSignalTypeBoard("dashboard-push-types", payload.pushTypes || []);
  renderSignalList("dashboard-push-feed", "dashboard-push-feed-empty", payload.pushSignals || [], pageState.dashboard.translationEnabled);
  renderDashboardEvents(payload.events || []);
  setDashboardTranslationButtonLabel();
  setPushButtonLabel();
  notifyNewRecommendations("总览", payload.recommendations || [], alreadyInitialized);
  notifyNewSignals("总览", payload.pushSignals || [], alreadyInitialized);
  pageState.dashboard.initialized = true;
}

async function loadDashboard(forceRefresh = false) {
  try {
    setButtonLabel('[data-action="refresh-dashboard"]', forceRefresh ? "正在刷新..." : "刷新总览", true);
    const payload = await requestJson(
      buildApiPath("/api/dashboard", { interest: buildInterestQuery() }, forceRefresh)
    );
    renderDashboard(payload);
  } catch (error) {
    console.error(error);
    setStatusText("dashboard-source-status", "后端请求失败");
    setStatusText("dashboard-updated", "最近更新：--");
    showToast("总览页暂时无法获取数据，请确认本地服务已启动。");
  } finally {
    setButtonLabel('[data-action="refresh-dashboard"]', "刷新总览", false);
  }
}

function renderMonitorFeed(items) {
  const feedList = document.getElementById("feed-list");
  const emptyState = document.getElementById("feed-empty");
  if (!feedList || !emptyState) {
    return;
  }

  if (!items.length) {
    feedList.innerHTML = "";
    emptyState.classList.remove("is-hidden");
    return;
  }

  emptyState.classList.add("is-hidden");
  feedList.innerHTML = items
    .map((item) => `
      <article class="feed-item">
        <div>
          <div class="recommendation-meta">
            <span class="soft-badge">${escapeHtml(item.categoryLabel)}</span>
            ${item.isPreferred ? '<span class="soft-badge is-strong">鍋忓ソ鍛戒腑</span>' : ""}
          </div>
          ${renderTitleStack(item, pageState.monitor.translationEnabled, `./detail.html?id=${encodeURIComponent(item.id)}`)}
          <p>来源：${escapeHtml(item.source)} / 发布时间：${escapeHtml(formatDateTime(item.createdAt))} / 作者：${escapeHtml(item.author)}</p>
          ${item.isPreferred ? `<p class="recommendation-reason">${escapeHtml(item.matchReason)}</p>` : ""}
        </div>
        <span class="badge ${item.riskClass}">${escapeHtml(item.riskText)}</span>
      </article>
    `)
    .join("");
}

function renderMonitorTable(items) {
  const tableBody = document.getElementById("topic-table-body");
  const emptyState = document.getElementById("table-empty");
  if (!tableBody || !emptyState) {
    return;
  }

  if (!items.length) {
    tableBody.innerHTML = "";
    emptyState.classList.remove("is-hidden");
    return;
  }

  emptyState.classList.add("is-hidden");
  tableBody.innerHTML = items
    .map((item) => `
      <tr>
        <td>${renderTitleStack(item, pageState.monitor.translationEnabled, `./detail.html?id=${encodeURIComponent(item.id)}`)}</td>
        <td>${escapeHtml(item.source)}</td>
        <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
        <td>${escapeHtml(String(item.score))}</td>
        <td>${escapeHtml(String(item.comments))}</td>
        <td>
          <div class="link-group">
            <a class="text-link" href="./detail.html?id=${encodeURIComponent(item.id)}">鏌ョ湅璇︽儏</a>
            <a class="text-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">鏌ョ湅鍘熸枃</a>
          </div>
        </td>
      </tr>
    `)
    .join("");
}

function renderMonitor(payload) {
  const alreadyInitialized = pageState.monitor.initialized;
  pageState.monitor.payload = payload;

  setStatusText("monitor-source-status", `数据源在线：${payload.sourceName}`);
  setStatusText("monitor-updated", `最近更新：${formatDateTime(payload.updatedAt)}`);
  setStatusText("monitor-sidebar-title", `${payload.label}监测中`);
  setStatusText("monitor-sidebar-copy", `当前主题下共检索到 ${formatNumber(payload.stats.totalHits)} 条公开内容，其中 ${formatNumber(payload.stats.matchedPreferences)} 条与用户偏好高度相关。`);
  setStatusText("monitor-feed-title", `${payload.label}内容流`);
  setStatusText("monitor-feed-meta", `展示最新 ${payload.items.length} 条内容，平均互动 ${formatNumber(payload.stats.averageComments)}`);
  setStatusText("monitor-stat-total", formatNumber(payload.stats.totalHits));
  setStatusText("monitor-stat-match", formatNumber(payload.stats.matchedPreferences));
  setStatusText("monitor-stat-comments", formatNumber(payload.stats.averageComments));
  setStatusText("monitor-stat-risk", formatNumber(payload.stats.highRisk));
  setStatusText(
    "monitor-preference-summary",
    `当前按 ${pageState.personalization.interests.map((key) => {
      const option = (payload.preferenceOptions || []).find((item) => item.key === key);
      return option ? option.label : key;
    }).join(" / ")} 进行优先推荐。`
  );

  renderMonitorFeed(payload.items || []);
  renderMonitorTable(payload.items || []);
  renderTagCloud(payload.tags || []);
  renderSentimentBars("monitor-sentiment-bars", payload.sentiment || [], true);
  renderPreferenceChips("monitor-preference-chips", payload.preferenceOptions || [], payload.selectedPreferences || []);
  renderRecommendationList(
    "monitor-recommendation-list",
    "monitor-recommendation-empty",
    payload.recommendations || [],
    pageState.monitor.translationEnabled
  );
  renderSignalList("monitor-push-feed", "monitor-push-feed-empty", payload.pushSignals || [], pageState.monitor.translationEnabled);
  setMonitorTranslationButtonLabel();
  setPushButtonLabel();
  notifyNewRecommendations("监测页", payload.recommendations || [], alreadyInitialized);
  notifyNewSignals("监测页", payload.pushSignals || [], alreadyInitialized);
  pageState.monitor.initialized = true;
}

async function loadMonitor(filter, forceRefresh = false) {
  pageState.monitor.currentFilter = filter;

  try {
    setButtonLabel('[data-action="refresh-monitor"]', forceRefresh ? "正在刷新..." : "刷新实时数据", true);
    const payload = await requestJson(
      buildApiPath(
        "/api/monitor",
        {
          filter,
          interest: buildInterestQuery()
        },
        forceRefresh
      )
    );
    renderMonitor(payload);
  } catch (error) {
    console.error(error);
    setStatusText("monitor-source-status", "后端请求失败");
    setStatusText("monitor-updated", "最近更新：--");
    showToast("监测页暂时无法获取数据，请确认本地服务已启动。");
  } finally {
    setButtonLabel('[data-action="refresh-monitor"]', "刷新实时数据", false);
  }
}

function renderDetailTimeline(items) {
  const container = document.getElementById("detail-timeline");
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = "";
    setVisibility("detail-timeline-empty", true);
    return;
  }

  setVisibility("detail-timeline-empty", false);
  container.innerHTML = items
    .map((item) => `
      <div class="timeline-item">
        <span class="timeline-time">${escapeHtml(item.time || "--")}</span>
        <div>
          <h4>${escapeHtml(item.title)}</h4>
          ${renderTitleStack(item, pageState.detail.translationEnabled)}
          <p>${escapeHtml(item.description)}</p>
        </div>
      </div>
    `)
    .join("");
}

function buildDetailBrief(payload) {
  const eventItem = payload?.event;
  if (!eventItem) {
    return "当前暂无可生成的事件简报。";
  }

  const forecast = payload.forecast || {};
  const timelineItems = (payload.timeline || []).slice(0, 3);
  const actionItems = (payload.actions || []).slice(0, 3);
  const relatedItems = (payload.related || []).slice(0, 3);
  const reactionItems = (payload.reactionForecast || []).slice(0, 2);
  const sentimentText = (payload.sentiment || [])
    .map((item) => `${item.label}${item.value}%`)
    .join(" / ");

  return [
    `【事件研判】${getDisplayTitle(eventItem, pageState.detail.translationEnabled)}`,
    `分类：${eventItem.categoryLabel} | 来源：${eventItem.source} | 风险等级：${eventItem.riskText}`,
    `发现时间：${formatDateTime(eventItem.firstSeen)} | 峰值时间：${formatDateTime(eventItem.peakTime)} | 传播状态：${eventItem.spreadStatus}`,
    "",
    "一、事件概述",
    eventItem.summary || "暂无概述。",
    "",
    "二、情绪结构",
    sentimentText || "暂无情绪结构数据。",
    "",
    "三、趋势判断",
    forecast.summary || "暂无趋势预测。",
    ...((forecast.cards || []).map((item) => `- ${item.horizon}：${item.direction}（${item.score}）｜关注点：${item.watch}`)),
    "",
    "四、公众反应预判",
    ...(reactionItems.length
      ? reactionItems.map((item) => `- ${item.group}：${item.predictedEmotion}；触发点：${item.trigger}`)
      : ["暂无公众反应预判。"]),
    "",
    "五、建议动作",
    ...(actionItems.length
      ? actionItems.map((item, index) => `${index + 1}. ${item.title}：${item.description}`)
      : ["暂无建议动作。"]),
    "",
    "六、关键进展",
    ...(timelineItems.length
      ? timelineItems.map((item) => `- ${item.time} ${item.title}：${getDisplayTitle(item, pageState.detail.translationEnabled)}`)
      : ["暂无时间线信息。"]),
    "",
    "七、相关内容",
    ...(relatedItems.length
      ? relatedItems.map((item) => `- ${getDisplayTitle(item, pageState.detail.translationEnabled)}（${item.source}，热度 ${item.score}）`)
      : ["暂无关联内容。"])
  ].join("\n");
}

function renderDetailActions(items) {
  const container = document.getElementById("detail-action-list");
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = "";
    setVisibility("detail-action-empty", true);
    return;
  }

  setVisibility("detail-action-empty", false);
  container.innerHTML = items
    .map((item, index) => `
      <article class="action-item">
        <h4>${index + 1}. ${escapeHtml(item.title)}</h4>
        <p>${escapeHtml(item.description)}</p>
      </article>
    `)
    .join("");
}

function renderDetailRelated(items) {
  const container = document.getElementById("detail-related-list");
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = "";
    setVisibility("detail-related-empty", true);
    return;
  }

  setVisibility("detail-related-empty", false);
  container.innerHTML = items
    .map((item) => `
      <article class="feed-item">
        <div>
          ${renderTitleStack(item, pageState.detail.translationEnabled, `./detail.html?id=${encodeURIComponent(item.id)}`)}
          <p>来源：${escapeHtml(item.source)} / 发布时间：${escapeHtml(formatDateTime(item.createdAt))} / 热度：${escapeHtml(String(item.score))}</p>
        </div>
        <div class="link-group">
          <a class="text-link" href="./detail.html?id=${encodeURIComponent(item.id)}">缁х画鏌ョ湅</a>
          <a class="text-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">鏌ョ湅鍘熸枃</a>
        </div>
      </article>
    `)
    .join("");
}

function renderForecastCards(forecast) {
  const container = document.getElementById("detail-forecast-cards");
  if (!container) {
    return;
  }

  if (!forecast?.cards?.length) {
    container.innerHTML = "";
    setVisibility("detail-forecast-empty", true);
    return;
  }

  setVisibility("detail-forecast-empty", false);
  container.innerHTML = forecast.cards
    .map((item) => `
      <article class="forecast-card">
        <div class="forecast-card-top">
          <div>
            <p class="forecast-label">${escapeHtml(item.horizon || "鏈潵闃舵")}</p>
            <h4>${escapeHtml(item.direction || "璧板娍寰呭畾")}</h4>
          </div>
          <strong class="forecast-score">${escapeHtml(String(item.score || 0))}</strong>
        </div>
        <div class="forecast-card-body">
          <p class="forecast-note">${escapeHtml(item.note || "绯荤粺姝ｅ湪鐢熸垚瓒嬪娍璇存槑銆?)}</p>
          <p class="forecast-watch">${escapeHtml(item.watch || "寤鸿缁х画鍏虫敞鏂板璁ㄨ銆?)}</p>
        </div>
      </article>
    `)
    .join("");
}

function renderReactionList(items) {
  const container = document.getElementById("detail-reaction-list");
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = "";
    setVisibility("detail-reaction-empty", true);
    return;
  }

  setVisibility("detail-reaction-empty", false);
  container.innerHTML = items
    .map((item) => `
      <article class="reaction-item">
        <div class="reaction-card-top">
          <div>
            <h4>${escapeHtml(item.group || "鍏虫敞浜虹兢")}</h4>
            <p class="reaction-note">${escapeHtml(item.focus || "鍏虫敞鐐瑰緟鏇存柊")}</p>
          </div>
          <span class="soft-badge">${escapeHtml(item.intensity || "涓瓑鍙備笌")}</span>
        </div>
        <p>${escapeHtml(item.outlook || "绯荤粺姝ｅ湪鐢熸垚琛屼负棰勫垽銆?)}</p>
        <p class="reaction-strong">${escapeHtml(item.predictedEmotion || "鏇村浼氱瓑寰呭悗缁俊鎭€?)}</p>
        <p class="reaction-trigger">${escapeHtml(item.trigger || "后续回应质量会直接影响表达方向。")}</p>
      </article>
    `)
    .join("");
}

function syncDetailUrl(eventId) {
  if (!eventId || !window.history?.replaceState) {
    return;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get("id") === eventId) {
    return;
  }

  url.searchParams.set("id", eventId);
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function renderDetail(payload) {
  pageState.detail.payload = payload;
  setStatusText("detail-source-status", `数据源在线：${payload.sourceName}`);
  setStatusText("detail-updated", `最近更新：${formatDateTime(payload.updatedAt)}`);

  if (!payload.event) {
    setStatusText("detail-sidebar-title", "暂无可用事件");
    setStatusText("detail-sidebar-summary", "当前没有后端返回的事件数据，请稍后刷新。");
    setStatusText("detail-title", "暂无可用事件");
    setStatusText("detail-title-note", "你可以稍后刷新，或者从监测页重新进入详情。");
    setStatusText("detail-first-seen", "首次发现：-");
    setStatusText("detail-peak-time", "传播峰值：--");
    setStatusText("detail-spread-status", "传播状态：--");
    setStatusText("detail-summary-text", "当前没有可展示的事件摘要。");

    const badge = document.getElementById("detail-risk-badge");
    if (badge) {
      badge.textContent = "待分析";
      badge.className = "badge badge-safe";
    }

    renderDetailTimeline([]);
    renderSentimentBars("detail-sentiment-bars", [], false);
    renderDetailActions([]);
    renderDetailRelated([]);
    setPreformattedText("detail-brief-preview", buildDetailBrief(payload));
    setDetailTranslationButtonLabel();
    return;
  }

  const eventItem = payload.event;
  pageState.detail.currentId = eventItem.id;
  syncDetailUrl(eventItem.id);

  const title = getDisplayTitle(eventItem, pageState.detail.translationEnabled);
  const secondaryTitle = getSecondaryTitle(eventItem, pageState.detail.translationEnabled);

  setStatusText("detail-sidebar-title", title);
  setStatusText("detail-sidebar-summary", eventItem.summary);
  setStatusText("detail-title", title);
  setStatusText("detail-title-note", secondaryTitle || `${eventItem.categoryLabel} / ${eventItem.source}`);
  setStatusText("detail-first-seen", `首次发现：${formatDateTime(eventItem.firstSeen)}`);
  setStatusText("detail-peak-time", `传播峰值：${formatDateTime(eventItem.peakTime)}`);
  setStatusText("detail-spread-status", `传播状态：${eventItem.spreadStatus}`);
  setStatusText("detail-summary-text", eventItem.summary);
  setStatusText("detail-forecast-summary", payload.forecast?.summary || "系统会结合当前热度、情绪和扩散情况生成趋势预测。");

  const badge = document.getElementById("detail-risk-badge");
  if (badge) {
    badge.textContent = eventItem.riskText;
    badge.className = `badge ${eventItem.riskClass}`;
  }

  renderDetailTimeline(payload.timeline || []);
  renderSentimentBars("detail-sentiment-bars", payload.sentiment || [], true);
  renderForecastCards(payload.forecast || null);
  renderReactionList(payload.reactionForecast || []);
  renderDetailActions(payload.actions || []);
  renderDetailRelated(payload.related || []);
  setPreformattedText("detail-brief-preview", buildDetailBrief(payload));
  setDetailTranslationButtonLabel();
  document.title = `${title} - PulseScope`;
}

async function loadDetail(eventId = "", forceRefresh = false) {
  const targetId = eventId || pageState.detail.currentId;
  if (targetId) {
    pageState.detail.currentId = targetId;
  }

  try {
    setButtonLabel('[data-action="refresh-detail"]', forceRefresh ? "正在刷新..." : "刷新事件", true);
    const payload = await requestJson(buildApiPath("/api/events", { id: targetId }, forceRefresh));
    renderDetail(payload);
  } catch (error) {
    console.error(error);
    setStatusText("detail-source-status", "后端请求失败");
    setStatusText("detail-updated", "最近更新：--");
    showToast("事件详情暂时无法获取数据，请确认本地服务已启动。");
  } finally {
    setButtonLabel('[data-action="refresh-detail"]', "刷新事件", false);
  }
}

function renderWarningRules(items) {
  const container = document.getElementById("warning-rules-list");
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = "";
    setVisibility("warning-rules-empty", true);
    return;
  }

  setVisibility("warning-rules-empty", false);
  container.innerHTML = items
    .map((item) => `
      <div class="rule-item">
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.description)}</p>
      </div>
    `)
    .join("");
}

function renderWarningDuty(items) {
  const container = document.getElementById("warning-duty-board");
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = "";
    setVisibility("warning-duty-empty", true);
    return;
  }

  setVisibility("warning-duty-empty", false);
  container.innerHTML = items
    .map((item) => `
      <div class="duty-item">
        <span>${escapeHtml(item.name)}</span>
        <strong>${escapeHtml(item.summary)}</strong>
      </div>
    `)
    .join("");
}

function renderWarningTable(items) {
  const tableBody = document.getElementById("warning-table-body");
  const emptyState = document.getElementById("warning-table-empty");
  if (!tableBody || !emptyState) {
    return;
  }

  if (!items.length) {
    tableBody.innerHTML = "";
    emptyState.classList.remove("is-hidden");
    return;
  }

  emptyState.classList.add("is-hidden");
  tableBody.innerHTML = items
    .map((item) => `
      <tr>
        <td>${renderTitleStack(item, pageState.warning.translationEnabled, item.detailUrl || `./detail.html?id=${encodeURIComponent(item.id)}`)}</td>
        <td>${escapeHtml(item.trigger)}</td>
        <td><span class="badge ${item.levelClass}">${escapeHtml(item.levelText)}</span></td>
        <td>${escapeHtml(item.ownerStatus)}</td>
        <td>
          <div>${escapeHtml(item.advice)}</div>
          <div class="link-group">
            <a class="text-link" href="${escapeHtml(item.detailUrl || `./detail.html?id=${encodeURIComponent(item.id)}`)}">浜嬩欢璇︽儏</a>
            <a class="text-link" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">鏌ョ湅鍘熸枃</a>
          </div>
        </td>
      </tr>
    `)
    .join("");
}

function buildWarningBrief(payload) {
  if (!payload?.warnings?.length) {
    return "当前暂无可生成的提醒摘要。";
  }

  const topWarnings = payload.warnings.slice(0, 5);
  return [
    "【提醒摘要】",
    `更新时间：${formatDateTime(payload.updatedAt)}`,
    `红色 ${payload.stats.red} / 橙色 ${payload.stats.orange} / 黄色 ${payload.stats.yellow} / 已闭环 ${payload.stats.closed}`,
    "",
    "一、当前重点提醒",
    ...topWarnings.map((item, index) => `${index + 1}. ${getDisplayTitle(item, pageState.warning.translationEnabled)}｜${item.levelText}｜${item.trigger}`),
    "",
    "二、建议动作",
    ...topWarnings.map((item) => `- ${item.levelText} ${getDisplayTitle(item, pageState.warning.translationEnabled)}：${item.advice}`),
    "",
    "三、值班队列",
    ...((payload.duty || []).map((item) => `- ${item.name}：${item.summary}`)),
    "",
    "四、触发规则",
    ...((payload.rules || []).slice(0, 3).map((item) => `- ${item.title}：${item.description}`))
  ].join("\n");
}

function renderWarnings(payload) {
  pageState.warning.payload = payload;
  setStatusText("warning-source-status", `数据源在线：${payload.sourceName}`);
  setStatusText("warning-updated", `最近更新：${formatDateTime(payload.updatedAt)}`);
  setStatusText("warning-stat-red", formatNumber(payload.stats.red));
  setStatusText("warning-stat-orange", formatNumber(payload.stats.orange));
  setStatusText("warning-stat-yellow", formatNumber(payload.stats.yellow));
  setStatusText("warning-stat-closed", formatNumber(payload.stats.closed));

  renderWarningRules(payload.rules || []);
  renderWarningDuty(payload.duty || []);
  renderWarningTable(payload.warnings || []);
  setPreformattedText("warning-brief-preview", buildWarningBrief(payload));
  setWarningTranslationButtonLabel();
}

async function loadWarnings(forceRefresh = false) {
  try {
    setButtonLabel('[data-action="refresh-warning"]', forceRefresh ? "正在刷新..." : "刷新提醒", true);
    const payload = await requestJson(
      buildApiPath("/api/warnings", { interest: buildInterestQuery() }, forceRefresh)
    );
    renderWarnings(payload);
  } catch (error) {
    console.error(error);
    setStatusText("warning-source-status", "后端请求失败");
    setStatusText("warning-updated", "最近更新：--");
    showToast("提醒中心暂时无法获取数据，请确认本地服务已启动。");
  } finally {
    setButtonLabel('[data-action="refresh-warning"]', "刷新提醒", false);
  }
}

function bindPreferenceContainer(containerId, onChange) {
  const container = document.getElementById(containerId);
  if (!container || container.dataset.bound === "true") {
    return;
  }

  container.dataset.bound = "true";
  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-interest-key]");
    if (!button) {
      return;
    }

    if (toggleInterest(button.dataset.interestKey || "")) {
      onChange();
    }
  });
}

function bindBriefActions() {
  const detailCopyButton = document.querySelector('[data-action="copy-detail-brief"]');
  const detailDownloadButton = document.querySelector('[data-action="download-detail-brief"]');
  const warningCopyButton = document.querySelector('[data-action="copy-warning-brief"]');
  const warningDownloadButton = document.querySelector('[data-action="download-warning-brief"]');

  if (detailCopyButton && detailCopyButton.dataset.bound !== "true") {
    detailCopyButton.dataset.bound = "true";
    detailCopyButton.addEventListener("click", async() => {
      const content = buildDetailBrief(pageState.detail.payload);
      try {
        await copyTextToClipboard(content);
        showToast("事件简报已复制到剪贴板。");
      } catch {
        showToast("复制失败，请稍后重试。");
      }
    });
  }

  if (detailDownloadButton && detailDownloadButton.dataset.bound !== "true") {
    detailDownloadButton.dataset.bound = "true";
    detailDownloadButton.addEventListener("click", () => {
      const content = buildDetailBrief(pageState.detail.payload);
      const title = pageState.detail.payload?.event
        ? getDisplayTitle(pageState.detail.payload.event, pageState.detail.translationEnabled)
        : "事件简报";
      downloadTextFile(`${normalizeFilename(title, "事件简报")}.txt`, content);
      showToast("事件简报已开始下载。");
    });
  }

  if (warningCopyButton && warningCopyButton.dataset.bound !== "true") {
    warningCopyButton.dataset.bound = "true";
    warningCopyButton.addEventListener("click", async() => {
      const content = buildWarningBrief(pageState.warning.payload);
      try {
        await copyTextToClipboard(content);
        showToast("提醒摘要已复制到剪贴板。");
      } catch {
        showToast("复制失败，请稍后重试。");
      }
    });
  }

  if (warningDownloadButton && warningDownloadButton.dataset.bound !== "true") {
    warningDownloadButton.dataset.bound = "true";
    warningDownloadButton.addEventListener("click", () => {
      const content = buildWarningBrief(pageState.warning.payload);
      const filename = `提醒摘要-${new Date().toISOString().slice(0, 10)}.txt`;
      downloadTextFile(filename, content);
      showToast("提醒摘要已开始下载。");
    });
  }
}

function bindPushButtons() {
  document.querySelectorAll('[data-action="toggle-push"]').forEach((button) => {
    if (button.dataset.bound === "true") {
      return;
    }

    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      togglePushMode();
    });
  });
}

function initDashboardPage() {
  const refreshButton = document.querySelector('[data-action="refresh-dashboard"]');
  const translationButton = document.querySelector('[data-action="toggle-dashboard-translation"]');
  const searchButton = document.querySelector('[data-action="search-dashboard"]');
  const clearSearchButton = document.querySelector('[data-action="clear-dashboard-search"]');
  const testExternalApiButton = document.querySelector('[data-action="test-external-api"]');
  const saveExternalApiButton = document.querySelector('[data-action="save-external-api"]');
  const disableExternalApiButton = document.querySelector('[data-action="disable-external-api"]');
  const searchInput = document.getElementById("dashboard-search-input");

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      loadDashboard(true);
    });
  }

  if (translationButton) {
    translationButton.addEventListener("click", () => {
      pageState.dashboard.translationEnabled = !pageState.dashboard.translationEnabled;
      writePreference("dashboard_translation", String(pageState.dashboard.translationEnabled));
      if (pageState.dashboard.payload) {
        renderDashboard(pageState.dashboard.payload);
      } else {
        setDashboardTranslationButtonLabel();
      }
    });
  }

  if (searchButton) {
    searchButton.addEventListener("click", () => {
      loadDashboardSearch(searchInput?.value || "");
    });
  }

  if (clearSearchButton) {
    clearSearchButton.addEventListener("click", () => {
      if (searchInput) {
        searchInput.value = "";
      }
      pageState.dashboard.searchPayload = null;
      renderSearchResults(null);
      if (pageState.dashboard.payload?.multimodalModel) {
        renderPredictionList(pageState.dashboard.payload.multimodalModel.predictions || []);
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        loadDashboardSearch(searchInput.value || "");
      }
    });
  }

  if (testExternalApiButton) {
    testExternalApiButton.addEventListener("click", () => {
      testExternalApiConfig();
    });
  }

  if (saveExternalApiButton) {
    saveExternalApiButton.addEventListener("click", async() => {
      await saveExternalApiConfig(true);
      loadDashboard(true);
    });
  }

  if (disableExternalApiButton) {
    disableExternalApiButton.addEventListener("click", async() => {
      await saveExternalApiConfig(false);
      loadDashboard(true);
    });
  }

  bindPreferenceContainer("dashboard-preference-chips", () => {
    loadDashboard(true);
  });
  bindPushButtons();
  setDashboardTranslationButtonLabel();
  setPushButtonLabel();
  loadDashboard(true);
  pageState.dashboard.timer = window.setInterval(() => {
    loadDashboard(true);
  }, PAGE_REFRESH_MS);
}

function initMonitorPage() {
  const chips = Array.from(document.querySelectorAll(".filter-bar [data-filter]"));
  const refreshButton = document.querySelector('[data-action="refresh-monitor"]');
  const translationButton = document.querySelector('[data-action="toggle-monitor-translation"]');

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const filter = chip.dataset.filter || "all";
      chips.forEach((otherChip) => {
        const isActive = otherChip === chip;
        otherChip.classList.toggle("chip-active", isActive);
        otherChip.setAttribute("aria-pressed", String(isActive));
      });

      loadMonitor(filter, true);
    });
  });

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      loadMonitor(pageState.monitor.currentFilter, true);
    });
  }

  if (translationButton) {
    translationButton.addEventListener("click", () => {
      pageState.monitor.translationEnabled = !pageState.monitor.translationEnabled;
      writePreference("monitor_translation", String(pageState.monitor.translationEnabled));
      if (pageState.monitor.payload) {
        renderMonitor(pageState.monitor.payload);
      } else {
        setMonitorTranslationButtonLabel();
      }
    });
  }

  bindPreferenceContainer("monitor-preference-chips", () => {
    loadMonitor(pageState.monitor.currentFilter, true);
  });
  bindPushButtons();
  setMonitorTranslationButtonLabel();
  setPushButtonLabel();
  loadMonitor("all", true);
  pageState.monitor.timer = window.setInterval(() => {
    loadMonitor(pageState.monitor.currentFilter, true);
  }, PAGE_REFRESH_MS);
}

function initDetailPage() {
  const refreshButton = document.querySelector('[data-action="refresh-detail"]');
  const translationButton = document.querySelector('[data-action="toggle-detail-translation"]');
  const initialId = new URLSearchParams(window.location.search).get("id") || "";

  pageState.detail.currentId = initialId;

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      loadDetail(pageState.detail.currentId, true);
    });
  }

  if (translationButton) {
    translationButton.addEventListener("click", () => {
      pageState.detail.translationEnabled = !pageState.detail.translationEnabled;
      writePreference("detail_translation", String(pageState.detail.translationEnabled));
      if (pageState.detail.payload) {
        renderDetail(pageState.detail.payload);
      } else {
        setDetailTranslationButtonLabel();
      }
    });
  }

  setDetailTranslationButtonLabel();
  bindBriefActions();
  loadDetail(initialId, true);
  pageState.detail.timer = window.setInterval(() => {
    loadDetail(pageState.detail.currentId, true);
  }, PAGE_REFRESH_MS);
}

function initWarningPage() {
  const refreshButton = document.querySelector('[data-action="refresh-warning"]');
  const translationButton = document.querySelector('[data-action="toggle-warning-translation"]');

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      loadWarnings(true);
    });
  }

  if (translationButton) {
    translationButton.addEventListener("click", () => {
      pageState.warning.translationEnabled = !pageState.warning.translationEnabled;
      writePreference("warning_translation", String(pageState.warning.translationEnabled));
      if (pageState.warning.payload) {
        renderWarnings(pageState.warning.payload);
      } else {
        setWarningTranslationButtonLabel();
      }
    });
  }

  setWarningTranslationButtonLabel();
  bindBriefActions();
  loadWarnings(true);
  pageState.warning.timer = window.setInterval(() => {
    loadWarnings(true);
  }, PAGE_REFRESH_MS);
}

function initPrototypeButtons() {
  document.querySelectorAll("button").forEach((button) => {
    if (activeButtonSelectors.some((selector) => button.matches(selector))) {
      return;
    }

    button.addEventListener("click", () => {
      showToast(`${button.textContent.trim()}功能还处于原型阶段，后续可以继续接真实业务流程。`);
    });
  });
}

if (currentPage === "dashboard") {
  initDashboardPage();
}

if (currentPage === "monitor") {
  initMonitorPage();
}

if (currentPage === "detail") {
  initDetailPage();
}

if (currentPage === "warning") {
  initWarningPage();
}

initPrototypeButtons();
















