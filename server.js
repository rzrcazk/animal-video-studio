import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPlan, loadTasks, refreshTaskStatus, saveTask } from "./lib/workflow.js";
import { checkJimeng, downloadFile, generateImage, generateVideo } from "./lib/jimeng.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const tasksDir = path.join(__dirname, "tasks");
const configDir = path.join(__dirname, "config");
const settingsPath = path.join(configDir, "settings.json");
const port = Number(process.env.PORT || 5177);

function nowLabel() {
  return new Date().toISOString();
}

function sanitizeLogValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.startsWith("data:")) return `[data-url length=${value.length}]`;
    if (value.length > 1200) return `${value.slice(0, 1200)}... [truncated length=${value.length}]`;
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

function logApi(message, details = {}) {
  console.log(`[${nowLabel()}] [api] ${message}`);
  if (Object.keys(details).length) {
    console.dir(sanitizeLogValue(details), { depth: null, colors: false });
  }
}

function shouldLogLocalApi(req, pathname) {
  if (!pathname.startsWith("/api/")) return false;
  if (req.method === "GET") return false;
  if (req.method === "POST" && pathname === "/api/settings") return true;
  if (req.method === "POST" && pathname === "/api/tasks") return true;
  if (req.method === "POST" && pathname === "/api/check-jimeng") return true;
  if (req.method === "DELETE") return true;
  return /\/(generate|first-frame|composition|approve|approve-script|approve-first-frame)$/u.test(pathname);
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return payload;
}

/**
 * 极简 multipart/form-data 解析器，仅用于手动上传补救文件
 */
async function readMultipart(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  const contentType = req.headers["content-type"];
  const boundary = "--" + contentType.split("boundary=")[1];
  
  const parts = [];
  let start = 0;
  while ((start = buffer.indexOf(boundary, start)) !== -1) {
    start += boundary.length;
    if (buffer.slice(start, start + 2).toString() === "--") break;
    start += 2; // \r\n
    const end = buffer.indexOf(boundary, start);
    if (end === -1) break;
    
    const part = buffer.slice(start, end - 2); // -2 for \r\n
    const headEnd = part.indexOf("\r\n\r\n");
    const head = part.slice(0, headEnd).toString();
    const body = part.slice(headEnd + 4);
    
    const nameMatch = head.match(/name="([^"]+)"/);
    const fileMatch = head.match(/filename="([^"]+)"/);
    
    parts.push({
      name: nameMatch ? nameMatch[1] : "",
      filename: fileMatch ? fileMatch[1] : "",
      data: body
    });
  }
  return parts;
}

async function readSettings() {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    return { apiBase: "http://127.0.0.1:5100", sessionId: "", ...JSON.parse(raw) };
  } catch {
    return { apiBase: "http://127.0.0.1:5100", sessionId: "" };
  }
}

async function writeSettings(settings) {
  await fs.mkdir(configDir, { recursive: true });
  const next = {
    apiBase: settings.apiBase || "http://127.0.0.1:5100",
    sessionId: settings.sessionId || ""
  };
  await fs.writeFile(settingsPath, JSON.stringify(next, null, 2));
  return next;
}

async function tokenFrom(payload = {}) {
  const settings = await readSettings();
  return payload.token || payload.sessionId || settings.sessionId || process.env.JIMENG_SESSIONID || "";
}

async function apiBaseFrom(payload = {}, task = null) {
  const settings = await readSettings();
  return payload.apiBase || task?.apiBase || settings.apiBase || "http://127.0.0.1:5100";
}

function versionTaskId(animal, version) {
  return `v__${encodeURIComponent(animal)}__${encodeURIComponent(version)}`;
}

function parseVersionTaskId(id) {
  const value = decodeURIComponent(id);
  if (!value.startsWith("v__")) return null;
  const parts = value.split("__");
  if (parts.length !== 3) throw new Error("版本任务 ID 不合法");
  return {
    animal: decodeURIComponent(parts[1]),
    version: decodeURIComponent(parts[2])
  };
}

function taskDir(id) {
  const versionRef = parseVersionTaskId(id);
  if (versionRef) return versionTaskDir(versionRef.animal, versionRef.version);
  const root = path.resolve(tasksDir);
  const target = path.resolve(tasksDir, decodeURIComponent(id));
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("任务路径不合法");
  return target;
}

function versionTaskDir(animal, version) {
  const root = path.resolve(tasksDir);
  const target = path.resolve(tasksDir, animal, "versions", version);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error("版本任务路径不合法");
  return target;
}

/**
 * 确保路径是相对于当前环境的任务目录的。
 * 解决移动项目后 manifest.json 中存储的绝对路径失效的问题。
 */
function ensureLocalPath(filePath) {
  if (!filePath) return "";
  const tasksMarker = "/tasks/";
  const idx = filePath.lastIndexOf(tasksMarker);
  if (idx !== -1) {
    const relative = filePath.slice(idx + tasksMarker.length);
    return path.join(tasksDir, relative);
  }
  return filePath;
}

async function getTask(id) {
  const dir = taskDir(id);
  const manifestPath = path.join(dir, "manifest.json");
  let task;
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    task = { taskType: "version", ...JSON.parse(raw) };
  } catch {
    const raw = await fs.readFile(path.join(dir, "task.json"), "utf8");
    task = { taskType: "legacy", ...JSON.parse(raw) };
  }
  task.dir = dir;

  // 强制修正所有资源路径，确保移动项目后本地预览依然有效
  let changed = false;
  const STUCK_TIMEOUT = 10 * 60 * 1000; // 10分钟超时

  if (task.assets) {
    for (const asset of task.assets) {
      if (asset.file) asset.file = ensureLocalPath(asset.file);
      // 清理卡死的生成状态
      if (asset.status === "running") {
        const started = asset.startedAt ? Date.parse(asset.startedAt) : 0;
        if (!started || Date.now() - started > STUCK_TIMEOUT) {
          asset.status = "failed";
          asset.error = "任务卡死（服务器重启或超时），请重试";
          asset.startedAt = "";
          changed = true;
        }
      }
    }
  }
  if (task.shots) {
    for (const shot of task.shots) {
      if (shot.file) shot.file = ensureLocalPath(shot.file);
      if (shot.firstFrameFile) shot.firstFrameFile = ensureLocalPath(shot.firstFrameFile);
      if (shot.compositionFile) shot.compositionFile = ensureLocalPath(shot.compositionFile);
      
      // 清理卡死的视频生成状态
      if (shot.status === "running") {
        const started = shot.startedAt ? Date.parse(shot.startedAt) : 0;
        if (!started || Date.now() - started > STUCK_TIMEOUT) {
          shot.status = "planned"; // 视频卡死回退到待生成
          shot.error = "视频生成卡死，请重试";
          shot.startedAt = "";
          changed = true;
        }
      }
      // 清理卡死的组合图/首帧生成状态
      if (shot.compositionStatus === "running" || shot.firstFrameStatus === "running") {
        const started = shot.compositionStartedAt ? Date.parse(shot.compositionStartedAt) : 0;
        if (!started || Date.now() - started > STUCK_TIMEOUT) {
          shot.compositionStatus = "failed";
          shot.firstFrameStatus = "failed";
          shot.compositionError = "组合图生成卡死，请重试";
          shot.compositionStartedAt = "";
          changed = true;
        }
      }
    }
  }
  if (changed) {
    refreshTaskStatus(task);
    await saveTask(tasksDir, task);
  }
  return task;
}

async function createTask(payload) {
  const settings = await readSettings();
  const plan = createPlan({
    animal: payload.animal,
    voiceLimit: 240,
    styleId: payload.styleId,
    audienceId: payload.audienceId,
    includeProduction: false
  });
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const version = payload.version || `${stamp}-${plan.audience?.id || "general"}-${plan.scriptStyle?.id || "style"}`;
  const id = versionTaskId(plan.animal, version);
  const task = {
    id,
    version,
    ...plan,
    createdAt: new Date().toISOString(),
    status: "draft",
    apiBase: payload.apiBase || settings.apiBase || "http://127.0.0.1:5100",
    dir: versionTaskDir(plan.animal, version),
    errors: []
  };
  await saveTask(tasksDir, task);
  return task;
}

async function approveScript(taskIdValue) {
  const task = await getTask(taskIdValue);
  task.scriptApproved = true;
  refreshTaskStatus(task);
  await saveTask(tasksDir, task);
  return task;
}

async function archiveTask(taskIdValue) {
  const id = decodeURIComponent(taskIdValue);
  const source = taskDir(id);
  try {
    await fs.access(path.join(source, "manifest.json"));
  } catch {
    await fs.access(path.join(source, "task.json"));
  }
  const archiveRoot = path.join(tasksDir, ".deleted");
  await fs.mkdir(archiveRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const safeId = id.replace(/[^\p{Script=Han}\w.-]+/gu, "_").slice(0, 80);
  await fs.rename(source, path.join(archiveRoot, `${safeId}-${stamp}`));
  return { ok: true, id };
}

async function importResource(taskIdValue, payload, isMultipart = false) {
  const task = await getTask(taskIdValue);
  let type = ""; // 'asset' or 'shot'
  let id = "";
  let remoteUrl = "";
  let fileBuffer = null;
  let fileName = "";

  if (isMultipart) {
    const parts = payload;
    type = parts.find(p => p.name === "type")?.data.toString() || "";
    id = parts.find(p => p.name === "id")?.data.toString() || "";
    const filePart = parts.find(p => p.name === "file");
    if (filePart) {
      fileBuffer = filePart.data;
      fileName = filePart.filename;
    }
  } else {
    type = payload.type;
    id = payload.id;
    remoteUrl = payload.url;
  }

  if (!id) throw new Error("缺少资源 ID");

  let localFile = "";
  if (type === "asset") {
    const asset = task.assets.find(a => a.id === id);
    if (!asset) throw new Error(`找不到资产 ${id}`);
    localFile = path.join(task.dir, "images", `${id}.png`);
    
    if (fileBuffer) {
      await fs.writeFile(localFile, fileBuffer);
    } else if (remoteUrl) {
      await downloadFile(remoteUrl, localFile);
      asset.remoteUrl = remoteUrl;
    }
    asset.file = localFile;
    asset.status = "done";
    asset.error = "";
  } else if (type === "shot") {
    const shot = task.shots.find(s => s.id === Number(id));
    if (!shot) throw new Error(`找不到分镜 ${id}`);
    
    // 如果文件名包含 mp4，或者是视频上传
    if (remoteUrl?.toLowerCase().includes(".mp4") || fileName?.toLowerCase().includes(".mp4") || payload.isSkipFirstFrame) {
      localFile = path.join(task.dir, "videos", `${String(id).padStart(2, "0")}.mp4`);
      if (fileBuffer) {
        await fs.writeFile(localFile, fileBuffer);
      } else if (remoteUrl) {
        await downloadFile(remoteUrl, localFile);
        shot.remoteUrl = remoteUrl;
      }
      shot.file = localFile;
      shot.status = "done";
      shot.error = "";
    } else {
      // 默认视为首帧/组合图上传
      localFile = path.join(task.dir, "images", `shot-${String(id).padStart(2, "0")}-composition.png`);
      if (fileBuffer) {
        await fs.writeFile(localFile, fileBuffer);
      } else if (remoteUrl) {
        await downloadFile(remoteUrl, localFile);
        shot.compositionUrl = remoteUrl;
        shot.firstFrameUrl = remoteUrl;
      }
      shot.compositionFile = localFile;
      shot.firstFrameFile = localFile;
      shot.compositionStatus = "done";
      shot.firstFrameStatus = "done";
      shot.compositionError = "";
    }
  } else {
    throw new Error("无效的资源类型");
  }

  refreshTaskStatus(task);
  await saveTask(tasksDir, task);
  return task;
}

async function runBackground(fn) {
  try {
    await fn();
  } catch (error) {
    logApi("background task failed", { error: error.message });
  }
}

async function generateAsset(taskIdValue, assetId, payload) {
  const task = await getTask(taskIdValue);
  if (!task.scriptApproved) throw new Error("请先确认解说方案，再生成图片资产");
  const asset = task.assets.find((item) => item.id === assetId);
  if (!asset) throw new Error(`找不到资产 ${assetId}`);
  if (asset.status === "running" && asset.startedAt && Date.now() - Date.parse(asset.startedAt) < 10 * 60 * 1000) {
    throw new Error("这个资产正在生成中，请稍后再试");
  }
  asset.status = "running";
  asset.error = "";
  asset.startedAt = new Date().toISOString();
  refreshTaskStatus(task);
  await saveTask(tasksDir, task);
  const savedTask = JSON.parse(JSON.stringify(task));
  const savedAssetId = assetId;
  const savedPayload = payload;
  setImmediate(async () => {
    let remoteUrl = null;
    let localFile = null;
    let completedAt = null;
    let error = null;
    try {
      const task = await getTask(taskIdValue);
      const asset = task.assets.find((item) => item.id === savedAssetId);
      if (!asset) return;
      const result = await generateImage({
        apiBase: await apiBaseFrom(savedPayload, task),
        token: await tokenFrom(savedPayload),
        prompt: asset.prompt
      });
      remoteUrl = result.url;
      localFile = path.join(task.dir, "images", `${asset.id}.png`);
      await downloadFile(result.url, localFile);
      completedAt = new Date().toISOString();
      logApi("asset generated", { assetId: asset.id, status: "done" });
    } catch (e) {
      error = e;
      logApi("asset failed", { assetId: savedAssetId, error: e.message });
    } finally {
      const task = await getTask(taskIdValue);
      const asset = task.assets.find((item) => item.id === savedAssetId);
      if (asset) {
        asset.startedAt = "";
        if (error) {
          asset.status = "failed";
          asset.error = error.message;
          task.errors.push(`资产 ${asset.id}: ${error.message}`);
        } else {
          asset.remoteUrl = remoteUrl;
          asset.file = localFile;
          asset.status = "done";
          asset.completedAt = completedAt;
        }
      }
      refreshTaskStatus(task);
      await saveTask(tasksDir, task);
    }
  });
  return savedTask;
}

async function approveAsset(taskIdValue, assetId) {
  const task = await getTask(taskIdValue);
  const asset = task.assets.find((item) => item.id === assetId);
  if (!asset) throw new Error(`找不到资产 ${assetId}`);
  if (!asset.remoteUrl && !asset.file) throw new Error("请先生成资产图，再确认");
  asset.approved = true;
  refreshTaskStatus(task);
  await saveTask(tasksDir, task);
  return task;
}

function assetMap(task) {
  return new Map(task.assets.map((asset) => [asset.id, asset]));
}

function shotAssetRecords(task, shot) {
  const map = assetMap(task);
  return (shot.assetRefs || []).map((id) => ({ id, asset: map.get(id) }));
}

function ensureApprovedShotAssets(task, shot) {
  const missing = shotAssetRecords(task, shot)
    .filter(({ asset }) => !asset || !asset.approved || (!asset.remoteUrl && !asset.file))
    .map(({ id, asset }) => asset?.name || id || "未知资产");
  if (missing.length) throw new Error(`请先确认镜头资产：${missing.join("、")}`);
}

function shotReferencePaths(task, shot) {
  ensureApprovedShotAssets(task, shot);
  return shotAssetRecords(task, shot).map(({ asset }) => {
    if (!asset?.file) throw new Error(`资产「${asset?.name || asset?.id}」没有本地文件，请先生成并下载`);
    return ensureLocalPath(asset.file);
  });
}

function compositionPrompt(task, shot) {
  const refs = shotAssetRecords(task, shot)
    .map(({ id, asset }, index) => `参考图${index + 1}：${id}=${asset?.name || id}`)
    .join("；");
  return [
    shot.firstFramePrompt,
    "",
    `必须基于这些已确认基础资产生成同一镜头组合图：${refs}。`,
    "参考图1是主角设定图，必须锁定同一只动物：身体轮廓、透明褐绿斑纹、不对称巨大螯足、触须、眼睛和自然比例都要沿用。",
    "如果有场景或道具参考图，只把它们作为环境和动作关系素材，不要让它们覆盖或替换主角设定。",
    "保持角色外观、场景结构、道具形态与参考图一致，只改变构图、动作关系和镜头调度。",
    "禁止把枪虾重绘成普通虾、龙虾、螃蟹、昆虫或科幻怪物；不要添加文字、水印或人类元素。",
    "这张图将作为视频首帧，宁可构图简单，也要优先保证主角与参考图1一致。"
  ].join("\n");
}

async function generateShotComposition(taskIdValue, shotId, payload) {
  const task = await getTask(taskIdValue);
  const shot = task.shots.find((item) => item.id === Number(shotId));
  if (!shot) throw new Error(`找不到镜头 ${shotId}`);
  const referenceImagePaths = shotReferencePaths(task, shot);
  shot.referenceImagePaths = referenceImagePaths;
  shot.compositionAssetId = shot.compositionAssetId || `shot-${String(shot.id).padStart(2, "0")}-composition`;
  if (shot.compositionStatus === "running" && shot.compositionStartedAt && Date.now() - Date.parse(shot.compositionStartedAt) < 10 * 60 * 1000) {
    throw new Error("这个镜头组合图正在生成中，请稍后再试");
  }
  shot.compositionStatus = "running";
  shot.compositionError = "";
  shot.compositionStartedAt = new Date().toISOString();
  shot.firstFrameStatus = "running";
  shot.firstFrameError = "";
  refreshTaskStatus(task);
  await saveTask(tasksDir, task);
  const savedTask = JSON.parse(JSON.stringify(task));
  const savedShotId = shotId;
  const savedPayload = payload;
  setImmediate(async () => {
    let compositionUrl = null;
    let compositionFile = null;
    let compositionCompletedAt = null;
    let error = null;
    try {
      const task = await getTask(taskIdValue);
      const shot = task.shots.find((item) => item.id === Number(savedShotId));
      if (!shot) return;
      const prompt = compositionPrompt(task, shot);
      const result = await generateImage({
        apiBase: await apiBaseFrom(savedPayload, task),
        token: await tokenFrom(savedPayload),
        prompt,
        filePaths: shot.referenceImagePaths
      });
      compositionUrl = result.url;
      compositionFile = path.join(task.dir, "images", `${shot.compositionAssetId}.png`);
      await downloadFile(result.url, compositionFile);
      compositionCompletedAt = new Date().toISOString();
      logApi("composition generated", { shotId: shot.id, status: "done" });
    } catch (e) {
      error = e;
      logApi("composition failed", { shotId: Number(savedShotId), error: e.message });
    } finally {
      const task = await getTask(taskIdValue);
      const shot = task.shots.find((item) => item.id === Number(savedShotId));
      if (shot) {
        shot.compositionStartedAt = "";
        if (error) {
          shot.compositionStatus = "failed";
          shot.compositionError = error.message;
          shot.firstFrameStatus = "failed";
          shot.firstFrameError = error.message;
          task.errors.push(`镜头 ${shot.id} 组合图: ${error.message}`);
        } else {
          shot.compositionUrl = compositionUrl;
          shot.compositionFile = compositionFile;
          shot.compositionStatus = "done";
          shot.firstFrameUrl = compositionUrl;
          shot.firstFrameFile = compositionFile;
          shot.firstFrameStatus = "done";
          shot.compositionCompletedAt = compositionCompletedAt;
          // 注意：此处不自动重置 approvedFirstFrame，除非是新生成的
        }
      }
      refreshTaskStatus(task);
      await saveTask(tasksDir, task);
    }
  });
  return savedTask;
}

async function generateFirstFrame(taskIdValue, shotId, payload) {
  return generateShotComposition(taskIdValue, shotId, payload);
}

async function approveFirstFrame(taskIdValue, shotId) {
  const task = await getTask(taskIdValue);
  const shot = task.shots.find((item) => item.id === Number(shotId));
  if (!shot) throw new Error(`找不到镜头 ${shotId}`);
  if (!shot.firstFrameUrl && !shot.firstFrameFile) throw new Error("请先生成首帧图，再确认");
  shot.approvedFirstFrame = true;
  refreshTaskStatus(task);
  await saveTask(tasksDir, task);
  return task;
}

async function generateSingleShot(taskIdValue, shotId, payload) {
  const task = await getTask(taskIdValue);
  const shot = task.shots.find((item) => item.id === Number(shotId));
  if (!shot) throw new Error(`找不到镜头 ${shotId}`);
  ensureApprovedShotAssets(task, shot);
  if (!shot.approvedFirstFrame) throw new Error("请先生成并确认这个镜头的首帧图");
  
  if (shot.status === "running" && shot.startedAt && Date.now() - Date.parse(shot.startedAt) < 10 * 60 * 1000) {
    throw new Error(`镜头 ${shotId} 正在生成中，请稍候`);
  }

  // 救援逻辑：如果已经有远程 URL 但没本地文件，优先尝试重新下载
  const canRescue = shot.remoteUrl && !shot.file;

  shot.status = "running";
  shot.error = "";
  shot.startedAt = new Date().toISOString();
  refreshTaskStatus(task);
  await saveTask(tasksDir, task);

  const savedTask = JSON.parse(JSON.stringify(task));
  const savedShotId = shotId;
  const savedPayload = payload;

  setImmediate(async () => {
    let remoteUrl = shot.remoteUrl || null;
    let localFile = null;
    let error = null;
    try {
      const task = await getTask(taskIdValue);
      const shot = task.shots.find((item) => item.id === Number(savedShotId));
      if (!shot) return;

      if (!canRescue) {
        logApi("generating video", { shotId: shot.id });
        const result = await generateVideo({
          apiBase: await apiBaseFrom(savedPayload, task),
          token: await tokenFrom(savedPayload),
          prompt: shot.videoPrompt,
          duration: shot.duration,
          firstFrameUrl: shot.firstFrameUrl,
          firstFramePath: ensureLocalPath(shot.firstFrameFile)
        });
        remoteUrl = result.url;
        // 即时保存远程 URL，防止后续下载失败导致丢地址
        shot.remoteUrl = remoteUrl;
        await saveTask(tasksDir, task);
      } else {
        logApi("rescuing video download", { shotId: shot.id, url: remoteUrl });
      }

      localFile = path.join(task.dir, "videos", `${String(shot.id).padStart(2, "0")}.mp4`);
      await downloadFile(remoteUrl, localFile);
      logApi("video saved locally", { shotId: shot.id });
    } catch (e) {
      error = e;
      logApi("video process failed", { shotId: Number(savedShotId), error: e.message });
    } finally {
      const task = await getTask(taskIdValue);
      const shot = task.shots.find((item) => item.id === Number(savedShotId));
      if (shot) {
        shot.startedAt = "";
        if (error) {
          shot.status = "failed";
          shot.error = error.message;
          task.errors.push(`镜头 ${shot.id}: ${error.message}`);
        } else {
          shot.remoteUrl = remoteUrl;
          shot.file = localFile;
          shot.status = "done";
        }
      }
      refreshTaskStatus(task);
      await saveTask(tasksDir, task);
    }
  });
  return savedTask;
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relative = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const target = path.normalize(path.join(publicDir, relative));
  if (!target.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const body = await fs.readFile(target);
    const ext = path.extname(target);
    const types = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript" };
    res.writeHead(200, {
      "Content-Type": `${types[ext] || "application/octet-stream"}; charset=utf-8`,
      "Cache-Control": "no-cache"
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  try {
    const url = new URL(req.url, "http://localhost");
    const logLocalApi = shouldLogLocalApi(req, url.pathname);
    if (logLocalApi) {
      logApi("action", {
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries())
      });
    }
    if (req.method === "GET" && url.pathname === "/api/settings") {
      return json(res, 200, await readSettings());
    }
    if (req.method === "POST" && url.pathname === "/api/settings") {
      const payload = await readJson(req);
      if (logLocalApi) logApi("payload", { path: url.pathname, payload });
      return json(res, 200, await writeSettings(payload));
    }
    if (req.method === "GET" && url.pathname === "/api/tasks") {
      return json(res, 200, await loadTasks(tasksDir));
    }
    if (req.method === "POST" && url.pathname === "/api/tasks") {
      const payload = await readJson(req);
      if (logLocalApi) logApi("payload", { path: url.pathname, payload });
      return json(res, 200, await createTask(payload));
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/tasks\/[^/]+\/approve-script$/)) {
      return json(res, 200, await approveScript(decodeURIComponent(url.pathname.split("/")[3])));
    }
    if (req.method === "DELETE" && url.pathname.match(/^\/api\/tasks\/[^/]+$/)) {
      return json(res, 200, await archiveTask(decodeURIComponent(url.pathname.split("/")[3])));
    }
    const assetGenerate = url.pathname.match(/^\/api\/tasks\/([^/]+)\/assets\/([^/]+)\/generate$/);
    if (req.method === "POST" && assetGenerate) {
      const payload = await readJson(req);
      if (logLocalApi) logApi("payload", { path: url.pathname, payload });
      return json(res, 200, await generateAsset(decodeURIComponent(assetGenerate[1]), decodeURIComponent(assetGenerate[2]), payload));
    }
    const assetApprove = url.pathname.match(/^\/api\/tasks\/([^/]+)\/assets\/([^/]+)\/approve$/);
    if (req.method === "POST" && assetApprove) {
      return json(res, 200, await approveAsset(decodeURIComponent(assetApprove[1]), decodeURIComponent(assetApprove[2])));
    }
    const firstFrame = url.pathname.match(/^\/api\/tasks\/([^/]+)\/shots\/(\d+)\/first-frame$/);
    if (req.method === "POST" && firstFrame) {
      const payload = await readJson(req);
      if (logLocalApi) logApi("payload", { path: url.pathname, payload });
      return json(res, 200, await generateFirstFrame(decodeURIComponent(firstFrame[1]), firstFrame[2], payload));
    }
    const composition = url.pathname.match(/^\/api\/tasks\/([^/]+)\/shots\/(\d+)\/composition$/);
    if (req.method === "POST" && composition) {
      const payload = await readJson(req);
      if (logLocalApi) logApi("payload", { path: url.pathname, payload });
      return json(res, 200, await generateShotComposition(decodeURIComponent(composition[1]), composition[2], payload));
    }
    const firstFrameApprove = url.pathname.match(/^\/api\/tasks\/([^/]+)\/shots\/(\d+)\/approve-first-frame$/);
    if (req.method === "POST" && firstFrameApprove) {
      return json(res, 200, await approveFirstFrame(decodeURIComponent(firstFrameApprove[1]), firstFrameApprove[2]));
    }
    const shotMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/shots\/(\d+)\/generate$/);
    if (req.method === "POST" && shotMatch) {
      const payload = await readJson(req);
      if (logLocalApi) logApi("payload", { path: url.pathname, payload });
      return json(res, 200, await generateSingleShot(decodeURIComponent(shotMatch[1]), shotMatch[2], payload));
    }
    const importMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/import$/);
    if (req.method === "POST" && importMatch) {
      const contentType = req.headers["content-type"] || "";
      if (contentType.includes("multipart/form-data")) {
        const parts = await readMultipart(req);
        return json(res, 200, await importResource(decodeURIComponent(importMatch[1]), parts, true));
      } else {
        const payload = await readJson(req);
        return json(res, 200, await importResource(decodeURIComponent(importMatch[1]), payload, false));
      }
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/tasks/")) {
      return json(res, 200, await getTask(decodeURIComponent(url.pathname.split("/").at(-1))));
    }
    if (req.method === "POST" && url.pathname === "/api/check-jimeng") {
      const payload = await readJson(req);
      if (logLocalApi) logApi("payload", { path: url.pathname, payload });
      await checkJimeng(await apiBaseFrom(payload), await tokenFrom(payload));
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname.startsWith("/tasks/")) {
      const urlPath = decodeURIComponent(url.pathname);
      const relative = urlPath.replace(/^\/tasks\//, "");
      const target = path.normalize(path.join(tasksDir, relative));
      if (!target.startsWith(path.resolve(tasksDir) + path.sep)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      try {
        const body = await fs.readFile(target);
        const ext = path.extname(target);
        const types = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4" };
        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }
    return serveStatic(req, res);
  } catch (error) {
    logApi("request failed", { method: req.method, url: req.url, ms: Date.now() - startedAt, error: error.message });
    return json(res, 500, { ok: false, error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Animal Video Studio: http://localhost:${port}`);
  console.log(`[${nowLabel()}] Logs enabled. API requests and Jimeng calls will be printed here.`);
});
