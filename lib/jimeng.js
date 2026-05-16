import fs from "node:fs/promises";
import path from "node:path";

function authHeaders(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function nowLabel() {
  return new Date().toISOString();
}

function sanitizeLogValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.startsWith("data:")) return `[data-url length=${value.length}]`;
    if (value.length > 1600) return `${value.slice(0, 1600)}... [truncated length=${value.length}]`;
    return value;
  }
  if (typeof value !== "object") return value;
  if (depth > 4) return "[nested object]";
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/token|session|authorization|password|secret/iu.test(key)) {
      const text = String(item || "");
      return [key, text ? `${text.slice(0, 6)}...${text.slice(-4)}` : ""];
    }
    return [key, sanitizeLogValue(item, depth + 1)];
  }));
}

function logJimeng(message, details = {}) {
  console.log(`[${nowLabel()}] [jimeng] ${message}`);
  if (Object.keys(details).length) {
    console.dir(sanitizeLogValue(details), { depth: null, colors: false });
  }
}

function normalizeBaseUrl(apiBase) {
  return (apiBase || "http://127.0.0.1:5100").replace(/\/+$/, "");
}

function asDataUrl(value) {
  if (typeof value !== "string" || !value) return "";
  if (value.startsWith("data:")) return value;
  if (/^https?:\/\//u.test(value)) return value;
  if (/^\/\//u.test(value)) return `https:${value}`;
  if (/^[A-Za-z0-9+/]+={0,2}$/u.test(value) && value.length > 500) {
    return `data:image/png;base64,${value}`;
  }
  return "";
}

function pickMediaUrl(payload, seen = new Set()) {
  if (!payload) return "";
  if (typeof payload === "string") return asDataUrl(payload);
  if (typeof payload !== "object") return "";
  if (seen.has(payload)) return "";
  seen.add(payload);

  const preferredKeys = [
    "url",
    "image_url",
    "video_url",
    "download_url",
    "file_url",
    "media_url",
    "image",
    "video",
    "b64_json"
  ];
  for (const key of preferredKeys) {
    const direct = asDataUrl(payload[key]);
    if (direct) return direct;
  }

  const arrayKeys = ["data", "images", "image_urls", "video_urls", "urls", "files", "output", "result"];
  for (const key of arrayKeys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = pickMediaUrl(item, seen);
        if (nested) return nested;
      }
    } else {
      const nested = pickMediaUrl(value, seen);
      if (nested) return nested;
    }
  }

  for (const value of Object.values(payload)) {
    const nested = pickMediaUrl(value, seen);
    if (nested) return nested;
  }
  return "";
}

function responseSummary(payload) {
  if (!payload || typeof payload !== "object") return String(payload || "").slice(0, 180);
  const keys = Object.keys(payload).slice(0, 12);
  const status = payload.status || payload.state || payload.task_status || payload.code || "";
  const message = payload.message || payload.msg || payload.error?.message || payload.error || "";
  return [
    keys.length ? `keys=${keys.join(",")}` : "",
    status ? `status=${status}` : "",
    message ? `message=${String(message).slice(0, 140)}` : ""
  ].filter(Boolean).join("; ") || JSON.stringify(payload).slice(0, 220);
}

function absoluteMediaUrl(url, apiBase) {
  if (!url || url.startsWith("data:") || /^https?:\/\//u.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${normalizeBaseUrl(apiBase)}${url}`;
  return url;
}

function mimeTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

async function imageReference(value) {
  if (!value) return value;
  if (/^https?:\/\//u.test(value)) throw new Error(`不支持远程 URL（会失效），请先下载到本地：${value.slice(0, 120)}`);
  if (value.startsWith("data:")) throw new Error("不支持 data URL，请先保存到本地文件");
  const buffer = await fs.readFile(value);
  return `data:${mimeTypeFor(value)};base64,${buffer.toString("base64")}`;
}

export async function checkJimeng(apiBase, token) {
  const url = `${normalizeBaseUrl(apiBase)}/v1/models`;
  logJimeng("request", { method: "GET", url, headers: { authorization: token ? "Bearer ***" : "" } });
  const res = await fetch(url, { headers: authHeaders(token) });
  logJimeng("response", { method: "GET", url, status: res.status });
  if (!res.ok) throw new Error(`即梦接口不可用：HTTP ${res.status}`);
  const body = await res.json();
  logJimeng("response body", { summary: responseSummary(body) });
  return body;
}

async function fetchWithTimeout(url, options, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function generateImage({ apiBase, token, prompt, ratio = "16:9", filePaths = [], sampleStrength = 0.5 }) {
  const base = normalizeBaseUrl(apiBase);

  // 有参考图时，改用 /v1/images/compositions（multipart/form-data 上传本地文件）
  if (filePaths.filter(Boolean).length > 0) {
    const url = `${base}/v1/images/compositions`;
    const formData = new FormData();
    formData.append("model", "jimeng-4.5");
    formData.append("prompt", prompt);
    formData.append("ratio", ratio);
    formData.append("resolution", "2k");
    formData.append("sample_strength", String(sampleStrength));
    for (const filePath of filePaths.filter(Boolean)) {
      const buffer = await fs.readFile(filePath);
      const blob = new Blob([buffer], { type: mimeTypeFor(filePath) });
      formData.append("images", blob, path.basename(filePath));
    }
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    logJimeng("request", { method: "POST", url, note: "multipart/compositions", filePaths, headers: { authorization: token ? "Bearer ***" : "" } });
    const res = await fetchWithTimeout(url, { method: "POST", headers, body: formData });
    const body = await res.json().catch(() => ({}));
    logJimeng("response", { method: "POST", url, status: res.status, summary: responseSummary(body) });
    if (!res.ok) throw new Error(body.error?.message || body.message || `图片合成失败：HTTP ${res.status}`);
    const mediaUrl = absoluteMediaUrl(pickMediaUrl(body), apiBase);
    if (!mediaUrl) throw new Error(`图片合成完成但没有返回可下载 URL（${responseSummary(body)}）`);
    logJimeng("media url", { url: mediaUrl });
    return { url: mediaUrl, raw: body };
  }

  // 纯文生图：/v1/images/generations JSON 请求
  const payload = {
    model: "jimeng-4.5",
    prompt,
    ratio,
    resolution: "2k"
  };
  const url = `${base}/v1/images/generations`;
  logJimeng("request", { method: "POST", url, payload, headers: { authorization: token ? "Bearer ***" : "" } });
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  logJimeng("response", { method: "POST", url, status: res.status, summary: responseSummary(body) });
  if (!res.ok) throw new Error(body.error?.message || body.message || `图片生成失败：HTTP ${res.status}`);
  const mediaUrl = absoluteMediaUrl(pickMediaUrl(body), apiBase);
  if (!mediaUrl) throw new Error(`图片生成完成但没有返回可下载 URL（${responseSummary(body)}）`);
  logJimeng("media url", { url: mediaUrl });
  return { url: mediaUrl, raw: body };
}

export async function generateVideo({ apiBase, token, prompt, duration, firstFrameUrl = "", firstFramePath = "", ratio = "16:9" }) {
  const base = normalizeBaseUrl(apiBase);
  const url = `${base}/v1/videos/generations`;
  const localPath = firstFramePath || "";

  // 有本地首帧图时，用 multipart/form-data 上传（image_file_1 字段）
  if (localPath) {
    const formData = new FormData();
    // 1. Model 置顶
    formData.append("model", "jimeng-video-seedance-2.0-fast");
    // 2. Prompt 截断测试（防止过长触发风控）
    formData.append("prompt", prompt.slice(0, 1000));
    formData.append("ratio", ratio);
    formData.append("resolution", "720p");
    if (duration) formData.append("duration", String(duration));

    const buffer = await fs.readFile(localPath);
    const blob = new Blob([buffer], { type: mimeTypeFor(localPath) });
    // 3. 字段名
    formData.append("image_file_1", blob, path.basename(localPath));

    // 4. Header 深度清理
    const pureToken = token ? token.replace(/^Bearer\s+/i, "") : "";
    const headers = {
      "Authorization": `Bearer ${pureToken}`,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*"
    };

    logJimeng("request", { 
      method: "POST", 
      url, 
      note: "multipart/firstFrame", 
      localPath, 
      headers: { ...headers, Authorization: "Bearer ***" } 
    });

    let res;
    try {
      res = await fetchWithTimeout(url, { method: "POST", headers, body: formData }, 300000);
    } catch (fetchErr) {
      logJimeng("fetch error", { error: fetchErr?.message || String(fetchErr), code: fetchErr?.code, cause: String(fetchErr?.cause || "") });
      throw fetchErr;
    }

    const body = await res.json().catch(() => ({}));
    logJimeng("response", { method: "POST", url, status: res.status, summary: responseSummary(body) });
    if (!res.ok) throw new Error(body.error?.message || body.message || `视频生成失败：HTTP ${res.status}`);
    const mediaUrl = absoluteMediaUrl(pickMediaUrl(body), apiBase);
    if (!mediaUrl) throw new Error(`视频生成完成但没有返回可下载 URL（${responseSummary(body)}）`);
    logJimeng("media url", { url: mediaUrl });
    return { url: mediaUrl, raw: body };
  }

  // 无首帧图（纯文生视频）或仅有远程 URL 时，走 JSON 请求
  const payload = {
    model: "jimeng-video-seedance-2.0-fast",
    prompt,
    ratio,
    resolution: "720p",
    duration
  };
  // 远程 URL 用 filePaths 传递（新版参数名）
  if (firstFrameUrl) payload.filePaths = [firstFrameUrl];
  logJimeng("request", { method: "POST", url, payload, headers: { authorization: token ? "Bearer ***" : "" } });
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload)
  }, 300000);
  const body = await res.json().catch(() => ({}));
  logJimeng("response", { method: "POST", url, status: res.status, summary: responseSummary(body) });
  if (!res.ok) throw new Error(body.error?.message || body.message || `视频生成失败：HTTP ${res.status}`);
  const mediaUrl = absoluteMediaUrl(pickMediaUrl(body), apiBase);
  if (!mediaUrl) throw new Error(`视频生成完成但没有返回可下载 URL（${responseSummary(body)}）`);
  logJimeng("media url", { url: mediaUrl });
  return { url: mediaUrl, raw: body };
}

export async function downloadFile(url, filePath) {
  if (url.startsWith("data:")) {
    logJimeng("download data-url", { filePath, length: url.length });
    const [, data] = url.split(",", 2);
    await fs.writeFile(filePath, Buffer.from(data, "base64"));
    return;
  }
  logJimeng("download request", { method: "GET", url, filePath });
  const res = await fetchWithTimeout(url, {}, 60000);
  logJimeng("download response", { method: "GET", url, status: res.status });
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
  logJimeng("download saved", { filePath, bytes: buffer.length });
}
