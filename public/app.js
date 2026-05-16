const state = {
  currentTask: null,
  tasks: [],
  pollTimer: null,
  latestTaskId: "",
  activeTab: "plan",
  isLoadingTask: false,
  generationStartTimes: new Map(),
  lastRenderedTask: null
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function localFileToUrl(localPath) {
  if (!localPath) return "";
  const idx = localPath.lastIndexOf("/tasks/");
  if (idx === -1) return "";
  return "/" + localPath.slice(idx + 1);
}

function imagePreviewMarkup(url, title, className = "preview") {
  if (!url) return "";
  const safeUrl = escapeHtml(url);
  const safeTitle = escapeHtml(title || "图片预览");
  return `<img class="${className}" src="${safeUrl}" alt="${safeTitle}" role="button" tabindex="0" data-preview-type="image" data-preview-src="${safeUrl}" data-preview-title="${safeTitle}">`;
}

function shotImagePreviewMarkup(remoteUrl, localFile, title, className = "preview") {
  const url = localFileToUrl(localFile);
  if (!url) {
    return `<div class="${className} missing-file"><span>本地图片准备中...</span></div>`;
  }
  return imagePreviewMarkup(url, title, className);
}

function shotVideoPreviewMarkup(remoteUrl, localFile, title) {
  const url = localFileToUrl(localFile);
  return videoPreviewMarkup(url, title);
}

function videoPreviewMarkup(url, title) {
  if (!url) {
    return `
      <div class="video-links">
        <button class="small video-preview-button" disabled>本地视频准备中</button>
      </div>
    `;
  }
  const safeUrl = escapeHtml(url);
  const safeTitle = escapeHtml(title || "视频预览");
  return `
    <div class="video-links">
      <button class="small video-preview-button" data-preview-type="video" data-preview-src="${safeUrl}" data-preview-title="${safeTitle}">播放生成视频</button>
      <a href="${safeUrl}" target="_blank" rel="noreferrer">下载本地文件</a>
    </div>
  `;
}

function setMessage(text, isError = false) {
  $("formMsg").textContent = text;
  $("formMsg").style.color = isError ? "#C62828" : "#315C46";
}

function setLiveStatus(text) {
  $("liveStatus").textContent = text;
}

function showManualCopy(text) {
  const panel = $("copyFallback");
  const textarea = $("copyFallbackText");
  textarea.value = text;
  panel.hidden = false;
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.select();
  });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const body = await res.json();
  if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function copyText(text) {
  const value = String(text || "");
  if (!value) throw new Error("没有可复制的内容");
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return "copied";
    } catch {
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (ok) return "copied";
  showManualCopy(value);
  return "manual";
}

function requestPayload() {
  return {
    apiBase: $("apiBase").value.trim() || "http://127.0.0.1:5100",
    sessionId: $("sessionId").value.trim()
  };
}

function statusClass(status) {
  if (status === "done") return "status-done";
  if (status === "failed" || status === "partial") return "status-failed";
  if (status === "running") return "status-running";
  if (status === "in_progress") return "status-progress";
  if (status === "planned" || status === "draft") return "status-planned";
  return "";
}

function statusText(status, fallback = "未开始") {
  const labels = {
    approved: "已确认",
    done: "已完成",
    failed: "失败",
    partial: "部分失败",
    running: "生成中",
    in_progress: "制作中",
    planned: "待生成",
    draft: "草稿",
    pending: "等待中"
  };
  return labels[status] || fallback || status || "未开始";
}

function elapsedText(isoString) {
  if (!isoString) return "";
  const start = Date.parse(isoString);
  if (!Number.isFinite(start)) return "";
  const ms = Date.now() - start;
  if (ms < 0) return "";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}分${remainSec}秒`;
}

function runningFeedbackText(item, startedKey = "startedAt") {
  if (!item) return null;
  const startedAt = item[startedKey];
  const hasRemote = !!item.remoteUrl;
  const hasLocal = !!item.file;
  
  if (hasRemote && !hasLocal) {
    return `视频云端已生成，正在拉取到本地... (${elapsedText(startedAt)})`;
  }
  
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  return `已生成 ${elapsedText(startedAt)}，仍在处理中，请稍候…`;
}

function isFreshRunning(item, startedKey = "startedAt") {
  if (!item) return false;
  const startedAt = item[startedKey];
  
  // 如果正在运行或者是“有远程地址但没本地文件”的中间状态，都视为 active
  if (item.status === "running" || item.compositionStatus === "running") return true;
  if (item.remoteUrl && !item.file) return true;

  if (!startedAt) return false;
  const started = Date.parse(startedAt);
  return Number.isFinite(started) && Date.now() - started < 15 * 60 * 1000;
}

function saveDetailsStates(container) {
  const states = new Map();
  container.querySelectorAll("details").forEach((d) => {
    const parent = d.closest("[data-asset-id], [data-shot-id]");
    const parentId = parent ? (parent.dataset.assetId || parent.dataset.shotId) : "global";
    const key = parentId + "::" + (d.querySelector("summary")?.textContent || "");
    states.set(key, d.open);
  });
  return states;
}

function restoreDetailsStates(container, states) {
  container.querySelectorAll("details").forEach((d) => {
    const parent = d.closest("[data-asset-id], [data-shot-id]");
    const parentId = parent ? (parent.dataset.assetId || parent.dataset.shotId) : "global";
    const key = parentId + "::" + (d.querySelector("summary")?.textContent || "");
    if (states.has(key)) {
      d.open = states.get(key);
    }
  });
}

function statusLabel(task) {
  if (!task) return "未选择";
  if (!task.script) return "方向阶段";
  if (!task.scriptApproved) return "待确认方案";
  if (task.assetCount && task.approvedAssetCount < task.assetCount) return "资产确认中";
  if (task.status === "done") return "已完成";
  return "已确认方案";
}

function taskPath(task) {
  if (!task) return "animal-video-studio/tasks/<动物>/versions/<版本>/";
  if (task.dir) return task.dir;
  if (task.version) return `animal-video-studio/tasks/${task.animal}/versions/${task.version}/`;
  return `animal-video-studio/tasks/${decodeURIComponent(task.id || "<任务ID>")}/`;
}

function canGenerateFirstFrame(task, shot) {
  const map = new Map((task.assets || []).map((asset) => [asset.id, asset]));
  return (shot.assetRefs || []).every((id) => {
    const asset = map.get(id);
    return asset?.approved && asset.file;
  });
}

function assetNameMap(task) {
  return new Map((task.assets || []).map((asset) => [asset.id, asset.name || asset.id]));
}

function missingShotAssets(task, shot) {
  const map = new Map((task.assets || []).map((asset) => [asset.id, asset]));
  return (shot.assetRefs || []).filter((id) => {
    const asset = map.get(id);
    return !asset?.approved || !asset.file;
  });
}

function renderTask(task) {
  const taskJson = JSON.stringify(task);
  if (state.lastRenderedTaskJson === taskJson) return;
  state.lastRenderedTaskJson = taskJson;

  state.currentTask = task;
  $("pageTitle").textContent = `${task.animal} 工作台`;
  $("pageSubtitle").textContent = `${task.version || "当前版本"} · ${statusLabel(task)}`;
  $("animalTitle").textContent = task.animal;
  $("animalSubtitle").textContent = `${task.version || "当前版本"} · ${task.scriptStyle?.name || "动物科普"} · ${task.totalDuration || 0}s`;
  $("taskStatus").textContent = statusText(task.status);
  $("taskStatus").className = `pill ${statusClass(task.status)}`;

  const assets = task.assets || [];
  const shots = task.shots || [];
  const voiceChunks = task.voiceChunks || [];
  const approvedAssets = assets.filter((asset) => asset.approved).length;
  const compositionCount = shots.filter((shot) => shot.compositionStatus === "done" || shot.firstFrameStatus === "done").length;
  const firstFrames = shots.filter((shot) => shot.approvedFirstFrame).length;
  const videos = shots.filter((shot) => shot.status === "done").length;

  $("taskSummary").innerHTML = `
    <div class="metric"><span>资产</span><strong>${assets.length ? `${approvedAssets}/${assets.length}` : "待补"}</strong></div>
    <div class="metric"><span>组合图</span><strong>${shots.length ? `${compositionCount}/${shots.length}` : "待补"}</strong></div>
    <div class="metric"><span>首帧</span><strong>${shots.length ? `${firstFrames}/${shots.length}` : "待补"}</strong></div>
    <div class="metric"><span>视频</span><strong>${shots.length ? `${videos}/${shots.length}` : "待补"}</strong></div>
  `;

  $("taskPlanBrief").textContent = task.briefMarkdown || task.directionMarkdown || "暂无解说方案。";
  
  const assetsStates = saveDetailsStates($("assets"));
  const shotsStates = saveDetailsStates($("shots"));

  renderAssets(task, assets);
  renderShots(task, shots);
  renderVoice(voiceChunks);
  bindTaskButtons(task);
  renderHome();

  restoreDetailsStates($("assets"), assetsStates);
  restoreDetailsStates($("shots"), shotsStates);
}

function renderAssets(task, assets) {
  if (!assets.length) {
    $("assets").innerHTML = `<p class="muted">还没有 assets.json。</p>`;
    return;
  }
  const shots = task.shots || [];
  const compositionShots = shots.filter((shot) => shot.assetRefs?.length);
  const nameMap = assetNameMap(task);

  const baseHtml = assets.map((asset) => {
    const isRunning = asset.status === "running" && isFreshRunning(asset, "startedAt");
    const runningMsg = isRunning ? runningFeedbackText(asset, "startedAt") : null;
    const canGenerate = task.scriptApproved && !isRunning && !asset.approved && asset.status !== "done";
    const canApprove = asset.file && !asset.approved;

    return `
      <article class="asset-card" data-asset-id="${escapeHtml(asset.id)}">
        <div class="card-head">
          <strong>${escapeHtml(asset.name)}</strong>
          <span class="pill ${asset.approved ? "status-done" : statusClass(asset.status)}">${asset.approved ? "已确认" : statusText(asset.status)}</span>
        </div>
        <p class="muted">${escapeHtml(asset.type)} · ${escapeHtml(asset.id)}</p>
        ${shotImagePreviewMarkup(asset.remoteUrl, asset.file, asset.name)}
        <details>
          <summary>提示词</summary>
          <p class="prompt">${escapeHtml(asset.prompt)}</p>
        </details>
        <div class="shot-actions">
          <button class="small ${canGenerate ? "primary" : ""}" data-generate-asset="${escapeHtml(asset.id)}" ${!task.scriptApproved || isRunning ? "disabled" : ""}>生成基础资产</button>
          <button class="small ${canApprove ? "primary" : ""}" data-approve-asset="${escapeHtml(asset.id)}" ${!asset.file || asset.approved ? "disabled" : ""}>确认资产</button>
          <button class="small" data-rescue-asset="${escapeHtml(asset.id)}">手动补救</button>
        </div>
        ${runningMsg ? `<p class="message info">${escapeHtml(runningMsg)}</p>` : ""}
        ${asset.error ? `<p class="message">${escapeHtml(asset.error)}</p>` : ""}
      </article>
    `;
  }).join("");

  const compositionHtml = compositionShots.map((shot) => {
    const missing = missingShotAssets(task, shot);
    const ready = !missing.length;
    const status = shot.compositionStatus || shot.firstFrameStatus || "planned";
    const isRunning = status === "running" && isFreshRunning(shot, "compositionStartedAt");
    const runningMsg = isRunning ? runningFeedbackText(shot, "compositionStartedAt") : null;
    const firstFrameFileUrl = localFileToUrl(shot.compositionFile || shot.firstFrameFile);
    const canCompose = ready && !isRunning && !shot.approvedFirstFrame && status !== "done";
    const canApprove = firstFrameFileUrl && !shot.approvedFirstFrame;

    return `
      <article class="asset-card composition-card" data-asset-id="composition-${shot.id}">
        <div class="card-head">
          <strong>#${shot.id} · ${escapeHtml(shot.stage)} 组合图</strong>
          <span class="pill ${shot.approvedFirstFrame ? "status-done" : statusClass(status)}">${shot.approvedFirstFrame ? "已确认" : statusText(status)}</span>
        </div>
        <p class="muted">引用：${escapeHtml((shot.assetRefs || []).map((id) => nameMap.get(id) || id).join(" / "))}</p>
        ${shotImagePreviewMarkup(shot.compositionUrl, shot.compositionFile || shot.firstFrameFile, `镜头 ${shot.id} 组合图`)}
        ${runningMsg ? `<p class="message info">${escapeHtml(runningMsg)}</p>` : ""}
        <div class="shot-actions">
          <button class="small ${canCompose ? "primary" : ""}" data-composition="${shot.id}" ${!ready || isRunning ? "disabled" : ""}>生成组合图</button>
          <button class="small ${canApprove ? "primary" : ""}" data-approve-frame="${shot.id}" ${!firstFrameFileUrl || shot.approvedFirstFrame ? "disabled" : ""}>确认首帧</button>
          <button class="small" data-rescue-frame="${shot.id}">手动补救</button>
        </div>
        ${missing.length ? `<p class="message">缺少确认基础资产：${escapeHtml(missing.map(id => nameMap.get(id) || id).join("、"))}</p>` : ""}
        ${shot.compositionError ? `<p class="message">${escapeHtml(shot.compositionError)}</p>` : ""}
      </article>
    `;
  }).join("");

  $("assets").innerHTML = `
    <section class="asset-section">
      <div class="section-head">
        <h3>1. 基础资产</h3>
        <span class="muted">先稳定角色、场景、道具和科学视觉。</span>
      </div>
      <div class="asset-grid">${baseHtml}</div>
    </section>
    <section class="asset-section">
      <div class="section-head">
        <h3>2. 镜头组合图</h3>
        <span class="muted">确认上面的基础资产后，再生成具体的镜头首帧。</span>
      </div>
      <div class="asset-grid">${compositionHtml || `<p class="muted">还没有镜头引用资产。</p>`}</div>
    </section>
  `;
}

function renderShots(task, shots) {
  if (!shots.length) {
    $("shots").innerHTML = `<p class="muted">还没有 shots.json。</p>`;
    return;
  }
  const nameMap = assetNameMap(task);
  $("shots").innerHTML = shots.map((shot) => {
    const firstFrameFileUrl = localFileToUrl(shot.compositionFile || shot.firstFrameFile);
    const firstFrameReady = !!firstFrameFileUrl;
    const compositionStatus = shot.compositionStatus || shot.firstFrameStatus || "planned";
    const compositionRunning = compositionStatus === "running" && isFreshRunning(shot, "compositionStartedAt");
    const videoRunning = shot.status === "running" && isFreshRunning(shot, "startedAt");
    const isVideoDone = shot.status === "done" || !!shot.file;

    const canCompose = !compositionRunning && !shot.approvedFirstFrame && compositionStatus !== "done";
    const canApproveFrame = firstFrameReady && !shot.approvedFirstFrame;
    const canGenerateVideo = shot.approvedFirstFrame && !videoRunning && !isVideoDone;

    return `
      <article class="shot" data-shot-id="${shot.id}">
        <div class="shot-head">
          <strong>#${shot.id} · ${shot.duration}s · ${escapeHtml(shot.stage)}</strong>
          <span class="pill ${isVideoDone ? "status-done" : statusClass(shot.status)}">${isVideoDone ? "已完成" : statusText(shot.status)}</span>
        </div>
        <p>${escapeHtml(shot.narration)}</p>
        <p class="muted">组合图状态：${shot.approvedFirstFrame ? "已确认" : statusText(compositionStatus)}</p>
        ${shotImagePreviewMarkup(shot.compositionUrl, shot.compositionFile || shot.firstFrameFile, `镜头 ${shot.id} 首帧`, "preview wide")}
        <details><summary>首帧提示词</summary><p class="prompt">${escapeHtml(shot.firstFramePrompt)}</p></details>
        <details><summary>视频提示词</summary><p class="prompt">${escapeHtml(shot.videoPrompt)}</p></details>
        <div class="shot-actions">
          <button class="small ${canCompose ? "primary" : ""}" data-composition="${shot.id}" ${compositionRunning ? "disabled" : ""}>生成组合图</button>
          <button class="small ${canApproveFrame ? "primary" : ""}" data-approve-frame="${shot.id}" ${!firstFrameReady || shot.approvedFirstFrame ? "disabled" : ""}>确认首帧</button>
          <button class="small ${canGenerateVideo ? "primary" : ""}" data-generate-shot="${shot.id}" ${!shot.approvedFirstFrame || videoRunning ? "disabled" : ""}>生成视频</button>
          <button class="small" data-rescue-video="${shot.id}">手动补救</button>
        </div>
        ${videoRunning ? `<p class="message info">${runningFeedbackText(shot, "startedAt")}</p>` : ""}
        ${shotVideoPreviewMarkup(shot.remoteUrl, shot.file, `视频 ${shot.id}`)}
      </article>
    `;
  }).join("");
}

function renderVoice(voiceChunks) {
  $("voiceChunks").innerHTML = voiceChunks.map((chunk) => `
    <article class="voice-item">
      <div class="section-head"><strong>配音 ${chunk.id}</strong><button class="small" data-copy="${encodeURIComponent(chunk.text)}">复制</button></div>
      <p class="voice-text">${escapeHtml(chunk.text)}</p>
    </article>
  `).join("");
}

function renderHome() {
  const task = state.currentTask;
  $("homeStatus").textContent = statusLabel(task);
  $("homeStatus").className = `pill ${statusClass(task?.status)}`;
  $("approveScriptBtn").disabled = !task?.id || task.scriptApproved || !task.script;
  $("brief").textContent = task?.briefMarkdown || task?.directionMarkdown || "暂无方案。";
  
  const confirmed = state.tasks.filter((item) => item.scriptApproved);
  $("confirmedAnimals").innerHTML = confirmed.map((task) => `
    <article class="animal-card">
      <button class="animal-open" data-task="${task.id}">${escapeHtml(task.animal)} <small>${escapeHtml(task.version || "")}</small></button>
    </article>
  `).join("");
  document.querySelectorAll(".animal-open").forEach(b => b.onclick = () => openTask(b.dataset.task));
}

function renderHistory() {
  $("history").innerHTML = state.tasks.map((task) => `
    <article class="task-row">
      <button class="task-open" data-task="${task.id}"><strong>${escapeHtml(task.animal)}</strong></button>
      <button class="small danger" data-delete-task="${task.id}">移除</button>
    </article>
  `).join("");
  document.querySelectorAll(".task-open").forEach(b => b.onclick = () => openTask(b.dataset.task));
  document.querySelectorAll("[data-delete-task]").forEach(b => b.onclick = () => deleteTask(b.dataset.deleteTask));
}

async function loadTask(id) {
  const task = await api(`/api/tasks/${id}`);
  renderTask(task);
}

async function openTask(id) {
  location.hash = `#/task/${encodeURIComponent(id)}`;
  setView("task");
  await loadTask(id);
}

async function loadHistory() {
  state.tasks = await api("/api/tasks");
  renderHistory();
  const currentId = routeTaskId();
  if (currentId) await loadTask(currentId); else { setView("home"); renderHome(); }
}

function routeTaskId() {
  const m = location.hash.match(/^#\/task\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function runTaskAction(path, msg) {
  setMessage("处理中...");
  try {
    const task = await api(path, { method: "POST", body: JSON.stringify(requestPayload()) });
    renderTask(task);
    setMessage(msg);
  } catch (e) { setMessage(e.message, true); }
}

function bindTaskButtons(task) {
  document.querySelectorAll("[data-generate-asset]").forEach(b => b.onclick = () => runTaskAction(`/api/tasks/${task.id}/assets/${b.dataset.generateAsset}/generate`, "已提交。"));
  document.querySelectorAll("[data-approve-asset]").forEach(b => b.onclick = () => runTaskAction(`/api/tasks/${task.id}/assets/${b.dataset.approveAsset}/approve`, "已确认。"));
  document.querySelectorAll("[data-composition]").forEach(b => b.onclick = () => runTaskAction(`/api/tasks/${task.id}/shots/${b.dataset.composition}/composition`, "组合中..."));
  document.querySelectorAll("[data-approve-frame]").forEach(b => b.onclick = () => runTaskAction(`/api/tasks/${task.id}/shots/${b.dataset.approveFrame}/approve-first-frame`, "已确认首帧。"));
  document.querySelectorAll("[data-generate-shot]").forEach(b => b.onclick = () => runTaskAction(`/api/tasks/${task.id}/shots/${b.dataset.generateShot}/generate`, "生成视频中..."));
  
  // 绑定手动补救按钮
  document.querySelectorAll("[data-rescue-asset]").forEach(b => b.onclick = () => openRescueDialog("asset", b.dataset.rescueAsset));
  document.querySelectorAll("[data-rescue-frame]").forEach(b => b.onclick = () => openRescueDialog("shot", b.dataset.rescueFrame, "frame"));
  document.querySelectorAll("[data-rescue-video]").forEach(b => b.onclick = () => openRescueDialog("shot", b.dataset.rescueVideo, "video"));
}

let currentRescueContext = null;

function openRescueDialog(type, id, subType = "") {
  currentRescueContext = { type, id, subType };
  $("rescueUrl").value = "";
  $("rescueFileInput").value = "";
  $("rescueMsg").textContent = "";
  $("rescueDialog").hidden = false;
  
  const title = type === "asset" ? `资产 ${id}` : `分镜 ${id} (${subType === "video" ? "视频" : "首帧"})`;
  $("rescueDialog").querySelector("h3").textContent = `手动补救: ${title}`;
}

async function submitRescue(mode) {
  const { type, id, subType } = currentRescueContext;
  const taskId = state.currentTask.id;
  const msgEl = $("rescueMsg");
  msgEl.textContent = "正在处理...";
  msgEl.style.color = "var(--running)";

  try {
    let resultTask;
    if (mode === "url") {
      const url = $("rescueUrl").value.trim();
      if (!url) throw new Error("请输入有效的 URL");
      resultTask = await api(`/api/tasks/${taskId}/import`, {
        method: "POST",
        body: JSON.stringify({ type, id, url, isSkipFirstFrame: subType === "video" })
      });
    } else {
      const file = $("rescueFileInput").files[0];
      if (!file) throw new Error("请先选择文件");
      const formData = new FormData();
      formData.append("type", type);
      formData.append("id", id);
      formData.append("file", file);
      if (subType === "video") formData.append("isSkipFirstFrame", "true");
      
      const res = await fetch(`/api/tasks/${taskId}/import`, { method: "POST", body: formData });
      resultTask = await res.json();
      if (!res.ok || resultTask.ok === false) throw new Error(resultTask.error || "上传失败");
    }

    renderTask(resultTask);
    $("rescueDialog").hidden = true;
    setMessage("导入成功");
  } catch (e) {
    msgEl.textContent = e.message;
    msgEl.style.color = "var(--bad)";
  }
}

$("closeRescueDialog").onclick = () => $("rescueDialog").hidden = true;
$("rescueViaUrlBtn").onclick = () => submitRescue("url");
$("rescueViaFileBtn").onclick = () => submitRescue("file");

function setView(v) { $("homeView").hidden = (v === "task"); $("taskView").hidden = (v !== "task"); }
function setTab(t) { 
  state.activeTab = t; 
  document.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("is-active", b.dataset.tab === t));
  document.querySelectorAll("[data-panel]").forEach(p => p.hidden = p.dataset.panel !== t);
}

function startPolling() {
  setInterval(async () => {
    try { await loadHistory(); setLiveStatus(`同步于 ${new Date().toLocaleTimeString()}`); } catch (e) {}
  }, 3000);
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (b) {
    const res = await copyText(decodeURIComponent(b.dataset.copy));
    b.textContent = "已复制"; setTimeout(() => b.textContent = "复制", 1000);
  }
  const trigger = e.target.closest("[data-preview-src]");
  if (trigger) openMediaPreview(trigger);
});

function openMediaPreview(t) {
  $("mediaPreviewTitle").textContent = t.dataset.previewTitle || "预览";
  $("mediaPreviewBody").innerHTML = t.dataset.previewType === "video" ? `<video src="${t.dataset.previewSrc}" controls autoplay></video>` : `<img src="${t.dataset.previewSrc}">`;
  $("mediaPreview").hidden = false;
}

$("closeMediaPreview").onclick = () => $("mediaPreview").hidden = true;
$("homeBtn").onclick = $("backHomeBtn").onclick = () => location.hash = "#/";
$("approveScriptBtn").onclick = () => runTaskAction(`/api/tasks/${state.currentTask.id}/approve-script`, "方案已确认。");

document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => setTab(b.dataset.tab));

await loadHistory();
setTab("plan");
startPolling();
