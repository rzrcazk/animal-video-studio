# 路径存储鲁棒性优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 `server.js` 和 `lib/workflow.js` 中的路径处理逻辑，不再依赖存储在 JSON 中的绝对路径，从而支持项目目录迁移。

**Architecture:** 
1. 在 `server.js` 中引入 `ensureLocalPath` 辅助函数。
2. 修改 `getTask` 以动态纠正 `task.dir`。
3. 修改所有文件访问逻辑（如 `shotReferencePaths`），使其在读取 `asset.file` 或 `shot.firstFrameFile` 时动态解析路径。
4. 修改 `saveTask` 以支持（或准备支持）存储相对路径。

**Tech Stack:** Node.js

---

### Task 1: 引入路径纠正辅助函数

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 在 `server.js` 顶部增加 `ensureLocalPath` 函数**

这个函数会检查路径是否包含 `/tasks/`，如果是，则将其重新锚定到当前的 `tasksDir`。

```javascript
/**
 * 确保路径始终指向当前环境的 tasks 目录
 * 如果路径是错误的绝对路径（例如包含迁移前的旧路径），则重新锚定。
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
```

- [ ] **Step 2: 修改 `getTask` 动态纠正 `task.dir`**

```javascript
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
  // 关键修复：始终以当前计算的 dir 为准，覆盖 JSON 中存储的陈旧绝对路径
  task.dir = dir;
  return task;
}
```

---

### Task 2: 修复资产和镜头的路径引用

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 更新 `shotReferencePaths`**

使用 `ensureLocalPath` 处理资产文件路径。

```javascript
function shotReferencePaths(task, shot) {
  ensureApprovedShotAssets(task, shot);
  return shotAssetRecords(task, shot).map(({ asset }) => {
    if (!asset?.file) throw new Error(`资产「${asset?.name || asset?.id}」没有本地文件，请先生成并下载`);
    return ensureLocalPath(asset.file);
  });
}
```

- [ ] **Step 2: 更新 `generateSingleShot` 中的首帧路径**

```javascript
// 在 generateSingleShot 内部
const result = await generateVideo({
  apiBase: await apiBaseFrom(savedPayload, task),
  token: await tokenFrom(savedPayload),
  prompt: shot.videoPrompt,
  duration: shot.duration,
  firstFrameUrl: shot.firstFrameUrl,
  firstFramePath: ensureLocalPath(shot.firstFrameFile) // 使用辅助函数
});
```

---

### Task 3: 优化存储逻辑（可选但推荐）

虽然我们通过动态纠正解决了读取问题，但最好在保存时也尽可能使用更清晰的路径。

**Files:**
- Modify: `lib/workflow.js`

- [ ] **Step 1: 修改 `createPlan` 或 `saveTask` 以尽量减小绝对路径依赖**

目前的 `saveTask` 会写入整个 `task` 对象。我们可以考虑在 `saveTask` 之前或者内部对路径进行处理。
但考虑到现有逻辑，最简单的方案是在 `server.js` 的 `getTask` 中纠正即可。

---

### Task 4: 验证

- [ ] **Step 1: 验证组合图生成**

尝试对 `shotId: 3` 调用组合图生成接口，确认不再报 ENOENT 错误。

---
