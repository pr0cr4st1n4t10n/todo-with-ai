require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/auto";
const FALLBACK_MODELS = (process.env.OPENROUTER_FALLBACK_MODELS ||
  "google/gemma-2-9b-it:free,microsoft/phi-3-mini-128k-instruct:free,qwen/qwen-2.5-7b-instruct:free")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "dev_access_secret_change_me";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "dev_refresh_secret_change_me";
const ACCESS_TOKEN_EXPIRES = "15m";
const REFRESH_TOKEN_EXPIRES_DAYS = 30;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const DB_FILE = path.join(DATA_DIR, "app-db.json");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const AVATARS_DIR = path.join(UPLOADS_DIR, "avatars");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(AVATARS_DIR, { recursive: true });

const emptyDb = {
  users: [],
  projects: [],
  memberships: [],
  invitations: [],
  tasks: [],
  taskStatusLogs: [],
  planners: [],
  refreshTokens: []
};

if (!fs.existsSync(DB_FILE)) {
  /**
   * В текущем проекте доработок БД не было.
   * Чтобы не тащить отдельный сервер БД и сохранить простоту запуска,
   * используем JSON-файл как минимально подходящее персистентное хранилище.
   */
  fs.writeFileSync(DB_FILE, JSON.stringify(emptyDb, null, 2), "utf-8");
}

function readDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const parsed = JSON.parse(raw || "{}");
    return {
      users: parsed.users || [],
      projects: parsed.projects || [],
      memberships: parsed.memberships || [],
      invitations: parsed.invitations || [],
      tasks: parsed.tasks || [],
      taskStatusLogs: parsed.taskStatusLogs || [],
      planners: parsed.planners || [],
      refreshTokens: parsed.refreshTokens || []
    };
  } catch (error) {
    return { ...emptyDb };
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function makeAvatarUrl(user) {
  if (user.avatarPath) {
    return user.avatarPath;
  }
  const seed = encodeURIComponent(user.id || user.username || "user");
  return `https://api.dicebear.com/9.x/adventurer/png?seed=${seed}&size=128`;
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: makeAvatarUrl(user),
    createdAt: user.createdAt
  };
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, email: user.email },
    ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES }
  );
}

function signRefreshToken(user) {
  return jwt.sign({ sub: user.id }, REFRESH_TOKEN_SECRET, { expiresIn: `${REFRESH_TOKEN_EXPIRES_DAYS}d` });
}

function setRefreshCookie(res, token) {
  res.cookie("refreshToken", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000
  });
}

function clearRefreshCookie(res) {
  res.clearCookie("refreshToken");
}

function getMembership(db, projectId, userId) {
  return db.memberships.find((item) => item.projectId === projectId && item.userId === userId) || null;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const bearerToken = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  const token = bearerToken || null;

  if (!token) {
    return res.status(401).json({ error: "Требуется авторизация" });
  }

  try {
    const payload = jwt.verify(token, ACCESS_TOKEN_SECRET);
    req.auth = { userId: payload.sub };
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Сессия истекла, обновите вход" });
  }
}

function requireProjectMembership(req, res, next) {
  const db = readDb();
  const projectId = req.params.projectId;
  const membership = getMembership(db, projectId, req.auth.userId);
  if (!membership) {
    return res.status(403).json({ error: "Нет доступа к проекту" });
  }
  req.db = db;
  req.membership = membership;
  req.project = db.projects.find((item) => item.id === projectId) || null;
  if (!req.project) {
    return res.status(404).json({ error: "Проект не найден" });
  }
  return next();
}

function ensureEmployer(req, res, next) {
  if (req.membership.role !== "employer") {
    return res.status(403).json({ error: "Только Работодатель может выполнять это действие" });
  }
  return next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATARS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || ".png");
    cb(null, `${req.auth.userId}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});
app.use(express.static("public"));
app.use("/uploads", express.static(UPLOADS_DIR));

function assignIds(nodes, prefix = "node") {
  if (!Array.isArray(nodes)) {
    return [];
  }

  return nodes.map((node, index) => {
    const id = node.id || `${prefix}-${Date.now()}-${index}`;
    return {
      id,
      title: node.title || "Новая задача",
      details: node.details || "",
      priority: node.priority || "Средний",
      completed: Boolean(node.completed),
      assigneeId: null,
      assigneeTakenAt: null,
      assigneeCompletedAt: null,
      children: assignIds(node.children || [], id)
    };
  });
}

function normalizePlannerTree(nodes) {
  if (!Array.isArray(nodes)) {
    return [];
  }
  return nodes.map((node, index) => {
    const id = node.id || `node-${Date.now()}-${index}`;
    return {
      id,
      title: (node.title || "Новая задача").trim(),
      details: (node.details || "").trim(),
      priority: node.priority || "Средний",
      completed: Boolean(node.completed),
      assigneeId: node.assigneeId || null,
      assigneeTakenAt: node.assigneeTakenAt || null,
      assigneeCompletedAt: Boolean(node.completed) ? node.assigneeCompletedAt || null : null,
      children: normalizePlannerTree(node.children || [])
    };
  });
}

function findPlannerNodeById(nodes, nodeId) {
  for (const node of nodes || []) {
    if (node.id === nodeId) {
      return node;
    }
    const nested = findPlannerNodeById(node.children || [], nodeId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function walkPlannerNodes(nodes, visitor) {
  for (const node of nodes || []) {
    visitor(node);
    walkPlannerNodes(node.children || [], visitor);
  }
}

function collectPlannerNodes(nodes, acc = []) {
  for (const node of nodes || []) {
    acc.push(node);
    collectPlannerNodes(node.children || [], acc);
  }
  return acc;
}

function setPlannerAssigneeRecursively(node, assigneeId) {
  const now = new Date().toISOString();
  const previous = node.assigneeId;
  node.assigneeId = assigneeId;
  if (!previous || previous !== assigneeId) {
    node.assigneeTakenAt = now;
  }
  for (const child of node.children || []) {
    setPlannerAssigneeRecursively(child, assigneeId);
  }
}

function releasePlannerAssigneeRecursively(node, assigneeId) {
  if (node.assigneeId === assigneeId) {
    node.assigneeId = null;
    node.assigneeTakenAt = null;
    node.assigneeCompletedAt = null;
  }
  for (const child of node.children || []) {
    releasePlannerAssigneeRecursively(child, assigneeId);
  }
}

function completePlannerNodeRecursivelyForAssignee(node, assigneeId) {
  const now = new Date().toISOString();
  if (node.assigneeId === assigneeId) {
    if (!node.completed) {
      node.completed = true;
      node.assigneeCompletedAt = now;
    }
  }
  for (const child of node.children || []) {
    completePlannerNodeRecursivelyForAssignee(child, assigneeId);
  }
}

function uncompletePlannerNodeRecursivelyForAssignee(node, assigneeId) {
  if (node.assigneeId === assigneeId) {
    node.completed = false;
    node.assigneeCompletedAt = null;
  }
  for (const child of node.children || []) {
    uncompletePlannerNodeRecursivelyForAssignee(child, assigneeId);
  }
}

function safeParseJson(input) {
  try {
    return JSON.parse(input);
  } catch (error) {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(input.slice(start, end + 1));
    }
    throw error;
  }
}

async function askAI(systemPrompt, userPrompt) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set in .env");
  }

  const modelsToTry = [OPENROUTER_MODEL, ...FALLBACK_MODELS];
  let lastError = "Unknown OpenRouter error";

  for (const model of modelsToTry) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "TaskVibe AI"
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      lastError = text;
      continue;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }

  throw new Error(`OpenRouter API error: ${lastError}`);
}

app.post("/api/generate-todo", async (req, res) => {
  try {
    const { taskDescription } = req.body;
    if (!taskDescription) {
      return res.status(400).json({ error: "Нужно заполнить описание задачи" });
    }

    const systemPrompt =
      "Ты senior project manager. Отвечай только валидным JSON на русском языке формата: {\"tree\":[{\"title\":\"string\",\"details\":\"string\",\"priority\":\"Низкий|Средний|Высокий\",\"children\":[...]}]}. Нужен иерархический todo: 3-6 верхних веток, у каждой 2-5 подпунктов.";
    const userPrompt = `Сгенерируй детальный древовидный план работ для задачи:\n${taskDescription}\nНикакого текста вне JSON.`;

    const content = await askAI(systemPrompt, userPrompt);
    const parsed = safeParseJson(content);
    return res.json({ tree: assignIds(parsed.tree || []) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/improve-todo", async (req, res) => {
  try {
    const { taskDescription, tree } = req.body;
    if (!Array.isArray(tree) || tree.length === 0) {
      return res.status(400).json({ error: "Добавь хотя бы одну ветку в todo" });
    }

    const systemPrompt =
      "Ты помощник по планированию. Отвечай только валидным JSON на русском языке формата: {\"suggestions\":[\"string\"],\"improvedTree\":[{\"title\":\"string\",\"details\":\"string\",\"priority\":\"Низкий|Средний|Высокий\",\"children\":[...]}]}.";
    const userPrompt = `Главная цель: ${taskDescription || "Не указана"}\nТекущий древовидный todo:\n${JSON.stringify(
      tree
    )}\nПредложи улучшения и верни обновленное дерево.`;

    const content = await askAI(systemPrompt, userPrompt);
    const parsed = safeParseJson(content);
    return res.json({
      suggestions: parsed.suggestions || [],
      improvedTree: assignIds(parsed.improvedTree || [])
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/suggest-branch", async (req, res) => {
  try {
    const { taskDescription, selectedNode, tree } = req.body;
    if (!selectedNode?.title) {
      return res.status(400).json({ error: "Выбери ветку для подсказок" });
    }

    const systemPrompt =
      "Ты AI-помощник по декомпозиции задач. Отвечай только валидным JSON: {\"tips\":[\"string\"],\"suggestedChildren\":[{\"title\":\"string\",\"details\":\"string\",\"priority\":\"Низкий|Средний|Высокий\"}]} на русском языке.";
    const userPrompt = `Контекст проекта: ${taskDescription || "Не указан"}\nВыбранная ветка: ${JSON.stringify(
      selectedNode
    )}\nПолное дерево: ${JSON.stringify(
      tree || []
    )}\nПредложи улучшения именно для этой ветки и 2-4 дочерние задачи.`;

    const content = await askAI(systemPrompt, userPrompt);
    const parsed = safeParseJson(content);
    return res.json({
      tips: parsed.tips || [],
      suggestedChildren: assignIds(parsed.suggestedChildren || [], selectedNode.id || "branch")
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/estimate", async (req, res) => {
  try {
    const { hourlyRate, tree } = req.body;
    if (!Array.isArray(tree) || tree.length === 0) {
      return res.status(400).json({ error: "Список задач пуст" });
    }

    const rate = Number(hourlyRate) || 0;
    const systemPrompt =
      "Ты эксперт по оценке задач. Отвечай только валидным JSON на русском: {\"items\":[{\"id\":\"string\",\"task\":\"string\",\"hours\":number,\"comment\":\"string\"}],\"totalHours\":number,\"confidence\":\"Низкая|Средняя|Высокая\",\"risks\":[\"string\"]}. Для каждого item.id используй ИМЕННО id узла из входного дерева.";
    const userPrompt = `Оцени трудоемкость в часах для этого древовидного todo:\n${JSON.stringify(
      tree
    )}\nВерни оценку для каждого узла дерева, включая вложенные. Оценка для одного специалиста.`;

    const content = await askAI(systemPrompt, userPrompt);
    const parsed = safeParseJson(content);
    parsed.totalCost = Number((Number(parsed.totalHours || 0) * rate).toFixed(2));
    parsed.hourlyRate = rate;
    const nodeById = {};
    walkPlannerNodes(tree, (node) => {
      if (node?.id) {
        nodeById[node.id] = node;
      }
    });
    const payoutBuckets = {};
    for (const item of parsed.items || []) {
      const node = item?.id ? nodeById[item.id] : null;
      if (!node || !node.completed || !node.assigneeId) {
        continue;
      }
      const hours = Number(item.hours) || 0;
      if (hours <= 0) {
        continue;
      }
      payoutBuckets[node.assigneeId] = (payoutBuckets[node.assigneeId] || 0) + hours * rate;
    }
    const usersById = Object.fromEntries(readDb().users.map((user) => [user.id, user]));
    parsed.payoutByWorker = Object.entries(payoutBuckets).map(([userId, amount]) => {
      const user = usersById[userId];
      return {
        userId,
        username: user?.username || "unknown",
        displayName: user?.displayName || user?.username || "Unknown",
        amount: Number(amount.toFixed(2))
      };
    });
    return res.json(parsed);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "Нужны username, email и password" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Пароль должен быть не короче 6 символов" });
    }

    const db = readDb();
    const usernameLower = String(username).trim().toLowerCase();
    const emailLower = String(email).trim().toLowerCase();
    if (db.users.some((item) => item.username.toLowerCase() === usernameLower)) {
      return res.status(409).json({ error: "Такой username уже занят" });
    }
    if (db.users.some((item) => item.email.toLowerCase() === emailLower)) {
      return res.status(409).json({ error: "Такой email уже зарегистрирован" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: makeId("usr"),
      username: usernameLower,
      email: emailLower,
      passwordHash,
      displayName: displayName?.trim() || usernameLower,
      bio: "",
      avatarPath: "",
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    writeDb(db);

    return res.status(201).json({ user: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: "Нужны логин и пароль" });
    }
    const db = readDb();
    const needle = String(login).trim().toLowerCase();
    const user = db.users.find(
      (item) => item.username.toLowerCase() === needle || item.email.toLowerCase() === needle
    );
    if (!user) {
      return res.status(401).json({ error: "Неверный логин или пароль" });
    }
    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      return res.status(401).json({ error: "Неверный логин или пароль" });
    }

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    db.refreshTokens = db.refreshTokens.filter((item) => item.userId !== user.id);
    db.refreshTokens.push({
      id: makeId("rt"),
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString()
    });
    writeDb(db);
    setRefreshCookie(res, refreshToken);

    return res.json({ accessToken, user: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/refresh", (req, res) => {
  try {
    const { refreshToken } = req.cookies;
    if (!refreshToken) {
      return res.status(401).json({ error: "Refresh token отсутствует" });
    }
    const db = readDb();
    const saved = db.refreshTokens.find((item) => item.token === refreshToken);
    if (!saved) {
      return res.status(401).json({ error: "Refresh token не найден" });
    }
    let payload;
    try {
      payload = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
    } catch (error) {
      db.refreshTokens = db.refreshTokens.filter((item) => item.token !== refreshToken);
      writeDb(db);
      clearRefreshCookie(res);
      return res.status(401).json({ error: "Refresh token истек" });
    }

    const user = db.users.find((item) => item.id === payload.sub);
    if (!user) {
      return res.status(401).json({ error: "Пользователь не найден" });
    }
    const accessToken = signAccessToken(user);
    return res.json({ accessToken, user: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  const db = readDb();
  db.refreshTokens = db.refreshTokens.filter((item) => item.userId !== req.auth.userId);
  writeDb(db);
  clearRefreshCookie(res);
  return res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.auth.userId);
  if (!user) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }
  return res.json({ user: sanitizeUser(user) });
});

app.get("/api/profile/me", requireAuth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.auth.userId);
  if (!user) {
    return res.status(404).json({ error: "Профиль не найден" });
  }
  const memberships = db.memberships.filter((item) => item.userId === user.id);
  const projects = memberships
    .map((item) => {
      const project = db.projects.find((p) => p.id === item.projectId);
      if (!project) {
        return null;
      }
      return { id: project.id, name: project.name, role: item.role };
    })
    .filter(Boolean);
  return res.json({ profile: sanitizeUser(user), projects });
});

app.get("/api/profile/:username", requireAuth, (req, res) => {
  const db = readDb();
  const username = String(req.params.username || "").trim().toLowerCase();
  const user = db.users.find((item) => item.username === username);
  if (!user) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }
  const memberships = db.memberships.filter((item) => item.userId === user.id);
  const projects = memberships
    .map((item) => {
      const project = db.projects.find((p) => p.id === item.projectId);
      if (!project) {
        return null;
      }
      return { id: project.id, name: project.name, role: item.role };
    })
    .filter(Boolean);
  return res.json({ profile: sanitizeUser(user), projects });
});

app.patch("/api/profile/me", requireAuth, (req, res) => {
  const { displayName, bio, username } = req.body;
  const db = readDb();
  const userIndex = db.users.findIndex((item) => item.id === req.auth.userId);
  if (userIndex === -1) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }
  const user = db.users[userIndex];

  if (username) {
    const normalized = String(username).trim().toLowerCase();
    if (!normalized) {
      return res.status(400).json({ error: "Username не может быть пустым" });
    }
    const usernameBusy = db.users.some(
      (item) => item.id !== user.id && item.username.toLowerCase() === normalized
    );
    if (usernameBusy) {
      return res.status(409).json({ error: "Username уже занят" });
    }
    user.username = normalized;
  }

  if (typeof displayName === "string") {
    user.displayName = displayName.trim() || user.displayName;
  }
  if (typeof bio === "string") {
    user.bio = bio.trim();
  }

  db.users[userIndex] = user;
  writeDb(db);
  return res.json({ profile: sanitizeUser(user) });
});

app.post("/api/profile/avatar", requireAuth, upload.single("avatar"), (req, res) => {
  const db = readDb();
  const userIndex = db.users.findIndex((item) => item.id === req.auth.userId);
  if (userIndex === -1) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "Файл аватара не получен" });
  }
  db.users[userIndex].avatarPath = `/uploads/avatars/${req.file.filename}`;
  writeDb(db);
  return res.json({ profile: sanitizeUser(db.users[userIndex]) });
});

app.post("/api/profile/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Нужны текущий и новый пароль" });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "Новый пароль должен быть не короче 6 символов" });
  }
  const db = readDb();
  const userIndex = db.users.findIndex((item) => item.id === req.auth.userId);
  if (userIndex === -1) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }
  const user = db.users[userIndex];
  const passwordOk = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!passwordOk) {
    return res.status(401).json({ error: "Текущий пароль неверный" });
  }
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  db.users[userIndex] = user;
  writeDb(db);
  return res.json({ ok: true });
});

app.get("/api/dashboard", requireAuth, (req, res) => {
  const db = readDb();
  const userId = req.auth.userId;
  const memberships = db.memberships.filter((item) => item.userId === userId);
  const projects = memberships
    .map((item) => {
      const project = db.projects.find((p) => p.id === item.projectId);
      if (!project) {
        return null;
      }
      return { id: project.id, name: project.name, role: item.role, createdAt: project.createdAt };
    })
    .filter(Boolean);
  const pendingInvitations = db.invitations
    .filter((item) => item.status === "pending" && item.invitedUserId === userId)
    .map((item) => {
      const project = db.projects.find((p) => p.id === item.projectId);
      return {
        ...item,
        projectName: project?.name || "Проект"
      };
    });
  return res.json({
    projects,
    pendingInvitations
  });
});

app.get("/api/projects", requireAuth, (req, res) => {
  const db = readDb();
  const memberships = db.memberships.filter((item) => item.userId === req.auth.userId);
  const projects = memberships
    .map((membership) => {
      const project = db.projects.find((item) => item.id === membership.projectId);
      if (!project) {
        return null;
      }
      return {
        ...project,
        role: membership.role
      };
    })
    .filter(Boolean);
  return res.json({ projects });
});

app.post("/api/projects", requireAuth, (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: "У проекта должно быть название" });
  }
  const db = readDb();
  const project = {
    id: makeId("prj"),
    name: name.trim(),
    description: (description || "").trim(),
    createdAt: new Date().toISOString(),
    ownerId: req.auth.userId,
    settings: {
      workerCanUpdateAnyTask: false
    }
  };
  db.projects.push(project);
  db.memberships.push({
    id: makeId("mem"),
    projectId: project.id,
    userId: req.auth.userId,
    role: "employer",
    createdAt: new Date().toISOString()
  });
  writeDb(db);
  return res.status(201).json({ project });
});

app.get("/api/projects/:projectId", requireAuth, requireProjectMembership, (req, res) => {
  const members = req.db.memberships
    .filter((item) => item.projectId === req.project.id)
    .map((item) => {
      const user = req.db.users.find((u) => u.id === item.userId);
      return {
        user: user ? sanitizeUser(user) : null,
        role: item.role
      };
    })
    .filter((item) => item.user);

  const invitations = req.db.invitations.filter((item) => item.projectId === req.project.id);
  return res.json({
    project: {
      ...req.project,
      yourRole: req.membership.role
    },
    members,
    invitations
  });
});

app.patch("/api/projects/:projectId", requireAuth, requireProjectMembership, ensureEmployer, (req, res) => {
  const { name, description } = req.body;
  const projectIndex = req.db.projects.findIndex((item) => item.id === req.project.id);
  if (projectIndex < 0) {
    return res.status(404).json({ error: "Проект не найден" });
  }
  if (typeof name === "string" && name.trim()) {
    req.db.projects[projectIndex].name = name.trim();
  }
  if (typeof description === "string") {
    req.db.projects[projectIndex].description = description.trim();
  }
  writeDb(req.db);
  return res.json({ project: req.db.projects[projectIndex] });
});

app.delete("/api/projects/:projectId", requireAuth, requireProjectMembership, ensureEmployer, (req, res) => {
  req.db.projects = req.db.projects.filter((item) => item.id !== req.project.id);
  req.db.memberships = req.db.memberships.filter((item) => item.projectId !== req.project.id);
  req.db.invitations = req.db.invitations.filter((item) => item.projectId !== req.project.id);
  req.db.planners = req.db.planners.filter((item) => item.projectId !== req.project.id);
  const taskIds = req.db.tasks.filter((item) => item.projectId === req.project.id).map((item) => item.id);
  req.db.tasks = req.db.tasks.filter((item) => item.projectId !== req.project.id);
  req.db.taskStatusLogs = req.db.taskStatusLogs.filter((item) => !taskIds.includes(item.taskId));
  writeDb(req.db);
  return res.json({ ok: true });
});

app.get("/api/projects/:projectId/planner", requireAuth, requireProjectMembership, (req, res) => {
  const existing = req.db.planners.find((item) => item.projectId === req.project.id) || null;
  return res.json({
    planner: existing
      ? {
          taskDescription: existing.taskDescription || "",
          hourlyRate: existing.hourlyRate || 0,
          tree: Array.isArray(existing.tree) ? existing.tree : []
        }
      : { taskDescription: "", hourlyRate: 500, tree: [] }
  });
});

app.put(
  "/api/projects/:projectId/planner",
  requireAuth,
  requireProjectMembership,
  ensureEmployer,
  (req, res) => {
    const { taskDescription, hourlyRate, tree } = req.body;
    if (tree !== undefined && !Array.isArray(tree)) {
      return res.status(400).json({ error: "tree должен быть массивом" });
    }

    const index = req.db.planners.findIndex((item) => item.projectId === req.project.id);
    const now = new Date().toISOString();
    const next = {
      id: index >= 0 ? req.db.planners[index].id : makeId("pln"),
      projectId: req.project.id,
      taskDescription: typeof taskDescription === "string" ? taskDescription : "",
      hourlyRate: Number(hourlyRate) || 0,
      tree: normalizePlannerTree(Array.isArray(tree) ? tree : []),
      updatedAt: now,
      updatedBy: req.auth.userId
    };
    if (index >= 0) {
      req.db.planners[index] = next;
    } else {
      req.db.planners.push(next);
    }
    writeDb(req.db);
    return res.json({ planner: next });
  }
);

app.post(
  "/api/projects/:projectId/planner/nodes/:nodeId/take",
  requireAuth,
  requireProjectMembership,
  (req, res) => {
    if (req.membership.role !== "worker") {
      return res.status(403).json({ error: "Только Работник может брать задачи из плана" });
    }
    const planner = req.db.planners.find((item) => item.projectId === req.project.id);
    if (!planner) {
      return res.status(404).json({ error: "AI Planner для проекта не найден" });
    }
    const node = findPlannerNodeById(planner.tree || [], req.params.nodeId);
    if (!node) {
      return res.status(404).json({ error: "Задача в AI Planner не найдена" });
    }
    const targetNodes = collectPlannerNodes([node]);
    const blocked = targetNodes.find(
      (item) => item.completed || (item.assigneeId && item.assigneeId !== req.auth.userId)
    );
    if (blocked) {
      return res.status(409).json({ error: "Ветка содержит занятые или завершенные задачи" });
    }
    setPlannerAssigneeRecursively(node, req.auth.userId);
    planner.updatedAt = new Date().toISOString();
    planner.updatedBy = req.auth.userId;
    writeDb(req.db);
    return res.json({ ok: true, node });
  }
);

app.post(
  "/api/projects/:projectId/planner/nodes/:nodeId/cancel",
  requireAuth,
  requireProjectMembership,
  (req, res) => {
    if (req.membership.role !== "worker") {
      return res.status(403).json({ error: "Только Работник может отменять свои задачи из плана" });
    }
    const planner = req.db.planners.find((item) => item.projectId === req.project.id);
    if (!planner) {
      return res.status(404).json({ error: "AI Planner для проекта не найден" });
    }
    const node = findPlannerNodeById(planner.tree || [], req.params.nodeId);
    if (!node) {
      return res.status(404).json({ error: "Задача в AI Planner не найдена" });
    }
    if (!node.assigneeId || node.assigneeId !== req.auth.userId) {
      return res.status(403).json({ error: "Вы не являетесь исполнителем этой задачи" });
    }
    if (node.completed) {
      return res.status(400).json({ error: "Нельзя отменить задачу после отметки выполнения" });
    }
    releasePlannerAssigneeRecursively(node, req.auth.userId);
    planner.updatedAt = new Date().toISOString();
    planner.updatedBy = req.auth.userId;
    writeDb(req.db);
    return res.json({ ok: true, node });
  }
);

app.post(
  "/api/projects/:projectId/planner/nodes/:nodeId/complete",
  requireAuth,
  requireProjectMembership,
  (req, res) => {
    if (req.membership.role !== "worker") {
      return res.status(403).json({ error: "Только Работник может отмечать задачи выполненными" });
    }
    const planner = req.db.planners.find((item) => item.projectId === req.project.id);
    if (!planner) {
      return res.status(404).json({ error: "AI Planner для проекта не найден" });
    }
    const node = findPlannerNodeById(planner.tree || [], req.params.nodeId);
    if (!node) {
      return res.status(404).json({ error: "Задача в AI Planner не найдена" });
    }
    if (!node.assigneeId || node.assigneeId !== req.auth.userId) {
      return res.status(403).json({ error: "Вы можете завершать только свои задачи" });
    }
    completePlannerNodeRecursivelyForAssignee(node, req.auth.userId);
    planner.updatedAt = new Date().toISOString();
    planner.updatedBy = req.auth.userId;
    writeDb(req.db);
    return res.json({ ok: true, node });
  }
);

app.post(
  "/api/projects/:projectId/planner/nodes/:nodeId/uncomplete",
  requireAuth,
  requireProjectMembership,
  (req, res) => {
    if (req.membership.role !== "worker") {
      return res.status(403).json({ error: "Только Работник может менять статус выполнения задач" });
    }
    const planner = req.db.planners.find((item) => item.projectId === req.project.id);
    if (!planner) {
      return res.status(404).json({ error: "AI Planner для проекта не найден" });
    }
    const node = findPlannerNodeById(planner.tree || [], req.params.nodeId);
    if (!node) {
      return res.status(404).json({ error: "Задача в AI Planner не найдена" });
    }
    if (!node.assigneeId || node.assigneeId !== req.auth.userId) {
      return res.status(403).json({ error: "Вы можете менять статус только своих задач" });
    }
    uncompletePlannerNodeRecursivelyForAssignee(node, req.auth.userId);
    planner.updatedAt = new Date().toISOString();
    planner.updatedBy = req.auth.userId;
    writeDb(req.db);
    return res.json({ ok: true, node });
  }
);

app.get("/api/invitations/pending", requireAuth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.auth.userId);
  if (!user) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }
  const pending = db.invitations
    .filter((item) => item.status === "pending" && item.invitedUserId === user.id)
    .map((item) => {
      const project = db.projects.find((p) => p.id === item.projectId);
      return {
        ...item,
        projectName: project?.name || "Проект"
      };
    });
  return res.json({ invitations: pending });
});

app.post(
  "/api/projects/:projectId/invitations",
  requireAuth,
  requireProjectMembership,
  ensureEmployer,
  (req, res) => {
    const { username, role } = req.body;
    if (!username) {
      return res.status(400).json({ error: "Нужно указать username" });
    }
    if (!["employer", "worker"].includes(role)) {
      return res.status(400).json({ error: "Роль должна быть worker (работник) или employer (работодатель)." });
    }
    const targetUsername = String(username).trim().toLowerCase();
    const targetUser = req.db.users.find((item) => item.username === targetUsername);
    if (!targetUser) {
      return res.status(404).json({ error: "Пользователь с таким username не найден" });
    }
    const alreadyMember = targetUser && getMembership(req.db, req.project.id, targetUser.id);
    if (alreadyMember) {
      return res.status(409).json({ error: "Этот пользователь уже в проекте" });
    }

    const invitation = {
      id: makeId("inv"),
      projectId: req.project.id,
      username: targetUsername,
      role,
      invitedBy: req.auth.userId,
      invitedUserId: targetUser.id,
      status: "pending",
      createdAt: new Date().toISOString(),
      respondedAt: null
    };
    req.db.invitations.push(invitation);
    writeDb(req.db);
    return res.status(201).json({ invitation });
  }
);

app.post("/api/invitations/:invitationId/respond", requireAuth, (req, res) => {
  const { action } = req.body;
  if (!["accept", "decline"].includes(action)) {
    return res.status(400).json({ error: "action должен быть accept или decline" });
  }
  const db = readDb();
  const user = db.users.find((item) => item.id === req.auth.userId);
  if (!user) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }
  const invitation = db.invitations.find((item) => item.id === req.params.invitationId);
  if (!invitation) {
    return res.status(404).json({ error: "Приглашение не найдено" });
  }
  const isAllowed = invitation.invitedUserId === user.id;
  if (!isAllowed) {
    return res.status(403).json({ error: "Вы не можете отвечать на это приглашение" });
  }
  if (invitation.status !== "pending") {
    return res.status(400).json({ error: "На приглашение уже ответили" });
  }

  invitation.status = action === "accept" ? "accepted" : "declined";
  invitation.respondedAt = new Date().toISOString();
  invitation.invitedUserId = user.id;
  if (action === "accept") {
    const existsMembership = getMembership(db, invitation.projectId, user.id);
    if (!existsMembership) {
      db.memberships.push({
        id: makeId("mem"),
        projectId: invitation.projectId,
        userId: user.id,
        role: invitation.role,
        createdAt: new Date().toISOString()
      });
    }
  }

  writeDb(db);
  return res.json({ invitation });
});

app.get("/api/projects/:projectId/tasks", requireAuth, requireProjectMembership, (req, res) => {
  const tasks = req.db.tasks
    .filter((item) => item.projectId === req.project.id)
    .map((task) => {
      const assignee = task.assigneeId ? req.db.users.find((u) => u.id === task.assigneeId) : null;
      const createdBy = req.db.users.find((u) => u.id === task.createdBy);
      const logs = req.db.taskStatusLogs
        .filter((item) => item.taskId === task.id)
        .map((item) => {
          const actor = req.db.users.find((u) => u.id === item.changedBy);
          return { ...item, changedByUsername: actor?.username || "unknown" };
        });
      return {
        ...task,
        assignee: assignee ? sanitizeUser(assignee) : null,
        createdBy: createdBy ? sanitizeUser(createdBy) : null,
        statusLogs: logs
      };
    });
  return res.json({ tasks });
});

app.post("/api/projects/:projectId/tasks", requireAuth, requireProjectMembership, ensureEmployer, (req, res) => {
  const { title, description, assigneeId } = req.body;
  if (!title?.trim()) {
    return res.status(400).json({ error: "У задачи должен быть заголовок" });
  }
  if (assigneeId) {
    const membership = getMembership(req.db, req.project.id, assigneeId);
    if (!membership) {
      return res.status(400).json({ error: "Исполнитель должен быть участником проекта" });
    }
  }
  const task = {
    id: makeId("tsk"),
    projectId: req.project.id,
    title: title.trim(),
    description: (description || "").trim(),
    status: "todo",
    assigneeId: assigneeId || null,
    createdBy: req.auth.userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  req.db.tasks.push(task);
  req.db.taskStatusLogs.push({
    id: makeId("log"),
    taskId: task.id,
    fromStatus: null,
    toStatus: "todo",
    changedBy: req.auth.userId,
    changedAt: new Date().toISOString()
  });
  writeDb(req.db);
  return res.status(201).json({ task });
});

app.patch("/api/projects/:projectId/tasks/:taskId", requireAuth, requireProjectMembership, (req, res) => {
  const taskIndex = req.db.tasks.findIndex(
    (item) => item.projectId === req.project.id && item.id === req.params.taskId
  );
  if (taskIndex < 0) {
    return res.status(404).json({ error: "Задача не найдена" });
  }
  const task = req.db.tasks[taskIndex];
  const { title, description, assigneeId, status } = req.body;

  const canManageTask = req.membership.role === "employer";
  const canChangeStatus = canManageTask;
  const canEditTask = canManageTask;

  if ((title !== undefined || description !== undefined || assigneeId !== undefined) && !canEditTask) {
    return res.status(403).json({ error: "Только Работодатель может редактировать задачу" });
  }
  if (status !== undefined && !canChangeStatus) {
    return res.status(403).json({ error: "Недостаточно прав для смены статуса" });
  }

  if (typeof title === "string" && title.trim()) {
    task.title = title.trim();
  }
  if (typeof description === "string") {
    task.description = description.trim();
  }
  if (assigneeId !== undefined) {
    if (assigneeId) {
      const membership = getMembership(req.db, req.project.id, assigneeId);
      if (!membership) {
        return res.status(400).json({ error: "Исполнитель должен быть участником проекта" });
      }
      task.assigneeId = assigneeId;
    } else {
      task.assigneeId = null;
    }
  }
  if (status !== undefined) {
    if (!["todo", "in_progress", "done"].includes(status)) {
      return res.status(400).json({ error: "Неверный статус задачи" });
    }
    if (task.status !== status) {
      req.db.taskStatusLogs.push({
        id: makeId("log"),
        taskId: task.id,
        fromStatus: task.status,
        toStatus: status,
        changedBy: req.auth.userId,
        changedAt: new Date().toISOString()
      });
      task.status = status;
    }
  }

  task.updatedAt = new Date().toISOString();
  req.db.tasks[taskIndex] = task;
  writeDb(req.db);
  return res.json({ task });
});

app.post(
  "/api/projects/:projectId/tasks/:taskId/take",
  requireAuth,
  requireProjectMembership,
  (req, res) => {
    if (req.membership.role !== "worker") {
      return res.status(403).json({ error: "Только Работник может брать задачи" });
    }

    const taskIndex = req.db.tasks.findIndex(
      (item) => item.projectId === req.project.id && item.id === req.params.taskId
    );
    if (taskIndex < 0) {
      return res.status(404).json({ error: "Задача не найдена" });
    }

    const task = req.db.tasks[taskIndex];
    if (task.assigneeId && task.assigneeId !== req.auth.userId) {
      return res
        .status(409)
        .json({ error: "Задача уже взята другим участником" });
    }
    if (task.status === "done") {
      return res.status(400).json({ error: "Нельзя взять завершенную задачу" });
    }

    const previousStatus = task.status;
    task.assigneeId = req.auth.userId;
    task.status = "in_progress";
    task.updatedAt = new Date().toISOString();

    req.db.taskStatusLogs.push({
      id: makeId("log"),
      taskId: task.id,
      fromStatus: previousStatus,
      toStatus: task.status,
      changedBy: req.auth.userId,
      changedAt: new Date().toISOString()
    });

    req.db.tasks[taskIndex] = task;
    writeDb(req.db);
    return res.json({ task });
  }
);

app.post(
  "/api/projects/:projectId/tasks/:taskId/cancel",
  requireAuth,
  requireProjectMembership,
  (req, res) => {
    if (req.membership.role !== "worker") {
      return res.status(403).json({ error: "Только Работник может отменять свои задачи" });
    }

    const taskIndex = req.db.tasks.findIndex(
      (item) => item.projectId === req.project.id && item.id === req.params.taskId
    );
    if (taskIndex < 0) {
      return res.status(404).json({ error: "Задача не найдена" });
    }

    const task = req.db.tasks[taskIndex];
    if (!task.assigneeId || task.assigneeId !== req.auth.userId) {
      return res.status(403).json({ error: "Вы не являетесь исполнителем этой задачи" });
    }

    const previousStatus = task.status;
    task.assigneeId = null;
    task.status = "todo";
    task.updatedAt = new Date().toISOString();

    req.db.taskStatusLogs.push({
      id: makeId("log"),
      taskId: task.id,
      fromStatus: previousStatus,
      toStatus: task.status,
      changedBy: req.auth.userId,
      changedAt: new Date().toISOString()
    });

    req.db.tasks[taskIndex] = task;
    writeDb(req.db);
    return res.json({ task });
  }
);

app.post(
  "/api/projects/:projectId/tasks/from-tree",
  requireAuth,
  requireProjectMembership,
  ensureEmployer,
  (req, res) => {
    const { tree } = req.body;
    if (!Array.isArray(tree) || tree.length === 0) {
      return res.status(400).json({ error: "Дерево задач пусто" });
    }

    function walk(nodes, projectId, createdBy, db, accTasks, accLogs) {
      for (const node of nodes) {
        const status = node.completed ? "done" : "todo";
        const taskId = makeId("tsk");
        const now = new Date().toISOString();

        accTasks.push({
          id: taskId,
          projectId,
          title: (node.title || "Задача").trim(),
          description: (node.details || "").trim(),
          status,
          assigneeId: null,
          createdBy,
          createdAt: now,
          updatedAt: now
        });

        accLogs.push({
          id: makeId("log"),
          taskId,
          fromStatus: null,
          toStatus: status,
          changedBy: createdBy,
          changedAt: now
        });

        if (Array.isArray(node.children) && node.children.length) {
          walk(node.children, projectId, createdBy, db, accTasks, accLogs);
        }
      }
    }

    const tasksToAdd = [];
    const logsToAdd = [];
    walk(tree, req.project.id, req.auth.userId, req.db, tasksToAdd, logsToAdd);

    if (!tasksToAdd.length) {
      return res.status(400).json({ error: "Не удалось построить задачи из дерева" });
    }

    req.db.tasks.push(...tasksToAdd);
    req.db.taskStatusLogs.push(...logsToAdd);
    writeDb(req.db);

    return res.status(201).json({ created: tasksToAdd.length });
  }
);

app.delete(
  "/api/projects/:projectId/tasks/:taskId",
  requireAuth,
  requireProjectMembership,
  ensureEmployer,
  (req, res) => {
    const exists = req.db.tasks.some((item) => item.id === req.params.taskId && item.projectId === req.project.id);
    if (!exists) {
      return res.status(404).json({ error: "Задача не найдена" });
    }
    req.db.tasks = req.db.tasks.filter((item) => item.id !== req.params.taskId);
    req.db.taskStatusLogs = req.db.taskStatusLogs.filter((item) => item.taskId !== req.params.taskId);
    writeDb(req.db);
    return res.json({ ok: true });
  }
);


app.patch(
  "/api/projects/:projectId/members/:userId/role",
  requireAuth,
  requireProjectMembership,
  ensureEmployer,
  (req, res) => {
    const targetUserId = req.params.userId;
    const { role } = req.body;
    if (!["employer", "worker"].includes(role)) {
      return res.status(400).json({ error: "Роль должна быть employer или worker" });
    }
    if (req.project.ownerId === targetUserId) {
      return res.status(400).json({ error: "Нельзя изменить роль владельца проекта" });
    }
    if (targetUserId === req.auth.userId) {
      return res.status(400).json({ error: "Нельзя изменить свою собственную роль" });
    }
    const membership = req.db.memberships.find(
      (item) => item.projectId === req.project.id && item.userId === targetUserId
    );
    if (!membership) {
      return res.status(404).json({ error: "Участник не найден" });
    }
    membership.role = role;
    writeDb(req.db);
    return res.json({ ok: true, role });
  }
);

app.delete(
  "/api/projects/:projectId/members/:userId",
  requireAuth,
  requireProjectMembership,
  (req, res) => {
    const targetUserId = req.params.userId;

    if (req.project.ownerId === targetUserId) {
      return res.status(400).json({ error: "Нельзя удалить владельца проекта" });
    }

    const isSelf = targetUserId === req.auth.userId;
    const isEmployer = req.membership.role === "employer";

    if (!isSelf && !isEmployer) {
      return res
        .status(403)
        .json({ error: "Только работодатель может исключать других участников" });
    }

    const before = req.db.memberships.length;
    req.db.memberships = req.db.memberships.filter(
      (item) => !(item.projectId === req.project.id && item.userId === targetUserId)
    );
    if (req.db.memberships.length === before) {
      return res.status(404).json({ error: "Участник не найден" });
    }

    req.db.tasks = req.db.tasks.map((task) =>
      task.projectId === req.project.id && task.assigneeId === targetUserId
        ? { ...task, assigneeId: null }
        : task
    );
    writeDb(req.db);
    return res.json({ ok: true });
  }
);

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
