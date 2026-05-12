const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const statusToast = document.getElementById("statusToast");
const authStatus = document.getElementById("authStatus");
const authTitle = document.getElementById("authTitle");
const authModeLogin = document.getElementById("authModeLogin");
const authModeRegister = document.getElementById("authModeRegister");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const navAvatar = document.getElementById("navAvatar");
const navUserLabel = document.getElementById("navUserLabel");

const tabs = {
  dashboard: document.getElementById("dashboardTab"),
  projects: document.getElementById("projectsTab"),
  profile: document.getElementById("profileTab"),
  settings: document.getElementById("settingsTab")
};

const state = {
  token: localStorage.getItem("accessToken") || "",
  currentUser: null,
  projects: [],
  activeProjectId: null,
  activeProject: null,
  projectMembers: []
};

function roleLabel(role) {
  if (role === "employer") return "работодатель";
  if (role === "worker") return "работник";
  return role;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function memberLineHtml(user, roleSuffix) {
  const u = escapeHtml(user.username);
  const dn = escapeHtml(user.displayName || user.username);
  return `<a href="#" class="profile-ref" data-username="${u}">${dn} <span class="muted">@${u}</span></a>${roleSuffix}`;
}

let assigneeTipHideTimer = null;
let assigneeTipAnchor = null;
const assigneeTooltipLayer = document.createElement("div");
assigneeTooltipLayer.className = "assignee-hover-tip";
assigneeTooltipLayer.style.display = "none";
assigneeTooltipLayer.setAttribute("role", "tooltip");

function hideAssigneeTooltipLayer() {
  clearTimeout(assigneeTipHideTimer);
  assigneeTooltipLayer.style.display = "none";
  assigneeTooltipLayer.style.visibility = "hidden";
  assigneeTipAnchor = null;
  document.removeEventListener("scroll", hideAssigneeTooltipLayer, true);
  window.removeEventListener("resize", placeAssigneeTooltipLayer);
}

function scheduleHideAssigneeTooltipLayer() {
  clearTimeout(assigneeTipHideTimer);
  assigneeTipHideTimer = setTimeout(hideAssigneeTooltipLayer, 180);
}

function placeAssigneeTooltipLayer() {
  if (!assigneeTipAnchor) return;
  assigneeTooltipLayer.style.display = "block";
  assigneeTooltipLayer.style.position = "fixed";
  assigneeTooltipLayer.style.visibility = "hidden";
  assigneeTooltipLayer.style.left = "0";
  assigneeTooltipLayer.style.top = "0";
  assigneeTooltipLayer.style.transform = "none";
  const tw = Math.max(assigneeTooltipLayer.offsetWidth, 200);
  const th = Math.max(assigneeTooltipLayer.offsetHeight, 36);
  const r = assigneeTipAnchor.getBoundingClientRect();
  const margin = 10;
  let top = r.bottom + margin;
  let left = r.left + r.width / 2 - tw / 2;
  if (top + th > window.innerHeight - margin) {
    top = r.top - th - margin;
  }
  if (top < margin) top = margin;
  if (left + tw > window.innerWidth - margin) left = window.innerWidth - tw - margin;
  if (left < margin) left = margin;
  assigneeTooltipLayer.style.left = `${Math.round(left)}px`;
  assigneeTooltipLayer.style.top = `${Math.round(top)}px`;
  assigneeTooltipLayer.style.visibility = "visible";
}

function bindAssigneeTooltip(host, getPayload) {
  const show = () => {
    clearTimeout(assigneeTipHideTimer);
    hideAssigneeTooltipLayer();
    assigneeTipAnchor = host;
    const payload = getPayload();
    fillAssigneeTooltip(assigneeTooltipLayer, payload.node, payload.assignee);
    document.body.appendChild(assigneeTooltipLayer);
    document.addEventListener("scroll", hideAssigneeTooltipLayer, true);
    window.addEventListener("resize", placeAssigneeTooltipLayer);
    placeAssigneeTooltipLayer();
  };
  host.onmouseenter = show;
  host.onmouseleave = (ev) => {
    if (assigneeTooltipLayer.contains(ev.relatedTarget)) return;
    scheduleHideAssigneeTooltipLayer();
  };
  host.onfocus = show;
  host.onblur = hideAssigneeTooltipLayer;
}

assigneeTooltipLayer.addEventListener("mouseenter", () => clearTimeout(assigneeTipHideTimer));
assigneeTooltipLayer.addEventListener("mouseleave", (ev) => {
  if (assigneeTipAnchor && (assigneeTipAnchor === ev.relatedTarget || assigneeTipAnchor.contains(ev.relatedTarget))) return;
  scheduleHideAssigneeTooltipLayer();
});

function resetProjectUiState() {
  state.activeProjectId = null;
  state.activeProject = null;
  state.projectMembers = [];
  document.getElementById("projectDetails").classList.add("hidden");
  document.getElementById("projectDetailsEmpty").classList.remove("hidden");
  const statusNode = document.getElementById("status");
  const suggestionsNode = document.getElementById("suggestions");
  const estimationNode = document.getElementById("estimation");
  const treeNode = document.getElementById("treeContainer");
  if (statusNode) {
    statusNode.textContent = "Готов к работе.";
    statusNode.style.color = "#92a0be";
  }
  if (suggestionsNode) {
    suggestionsNode.innerHTML = "";
  }
  if (estimationNode) {
    estimationNode.innerHTML = "";
  }
  if (treeNode) {
    treeNode.innerHTML = "<p class='muted'>Пока пусто. Выбери проект.</p>";
  }
}

let toastStack = document.getElementById("toastStack");
if (!toastStack) {
  toastStack = document.createElement("div");
  toastStack.id = "toastStack";
  document.body.appendChild(toastStack);
}

function showToast(message, isError = false) {
  if (appView.classList.contains("hidden")) {
    authStatus.textContent = message;
    authStatus.classList.toggle("error", isError);
    return;
  }

  const item = document.createElement("div");
  item.className = "toast-item" + (isError ? " error" : "");

  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.textContent = isError ? "\u2715" : "\u2713";

  const msg = document.createElement("span");
  msg.className = "toast-msg";
  msg.textContent = message;

  const close = document.createElement("button");
  close.className = "toast-close";
  close.textContent = "\xd7";
  close.setAttribute("aria-label", "\u0417\u0430\u043a\u0440\u044b\u0442\u044c");
  close.addEventListener("click", () => removeToast(item));

  item.append(icon, msg, close);
  toastStack.appendChild(item);

  item._toastTimer = setTimeout(() => removeToast(item), 4000);
}

function removeToast(item) {
  clearTimeout(item._toastTimer);
  item.classList.add("leaving");
  item.addEventListener("animationend", () => item.remove(), { once: true });
}

async function request(url, options = {}) {
  const headers = {
    ...(options.headers || {})
  };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include"
  });
  const rawText = await response.text().catch(() => "");
  let data = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch (error) {
      data = {};
    }
  }
  if (response.status === 401 && url !== "/api/auth/refresh") {
    const refreshed = await refreshToken();
    if (refreshed) {
      return request(url, options);
    }
  }
  if (!response.ok) {
    const message = (data && data.error) || rawText || `Ошибка запроса (${response.status})`;
    throw new Error(message);
  }
  return data;
}

async function refreshToken() {
  try {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include"
    });
    if (!response.ok) {
      return false;
    }
    const data = await response.json();
    state.token = data.accessToken;
    state.currentUser = data.user;
    localStorage.setItem("accessToken", state.token);
    return true;
  } catch (error) {
    return false;
  }
}

function setAuthenticatedUi(isAuthenticated) {
  authView.classList.toggle("hidden", isAuthenticated);
  appView.classList.toggle("hidden", !isAuthenticated);
}

function setAuthMode(mode) {
  const isLogin = mode === "login";
  authTitle.textContent = isLogin ? "Вход" : "Регистрация";
  loginForm.classList.toggle("hidden", !isLogin);
  registerForm.classList.toggle("hidden", isLogin);
  authModeLogin.classList.toggle("active", isLogin);
  authModeRegister.classList.toggle("active", !isLogin);
  authStatus.textContent = isLogin ? "Готов к входу." : "Готов к регистрации.";
  authStatus.classList.remove("error");
}

function renderNavUser() {
  if (!state.currentUser) {
    return;
  }
  navAvatar.src = state.currentUser.avatarUrl;
  navUserLabel.innerHTML = memberLineHtml(state.currentUser, "");
}

function activateTab(tabName) {
  Object.entries(tabs).forEach(([key, el]) => {
    el.classList.toggle("hidden", key !== tabName);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
}

async function bootstrapAuth() {
  if (!state.token) {
    const refreshed = await refreshToken();
    if (!refreshed) {
      setAuthenticatedUi(false);
      return;
    }
  }
  const me = await request("/api/auth/me");
  state.currentUser = me.user;
  resetProjectUiState();
  setAuthenticatedUi(true);
  renderNavUser();
  await Promise.all([loadDashboard(), loadProjects(), loadProfile()]);
}

function applyLoginResult(data) {
  state.token = data.accessToken;
  state.currentUser = data.user;
  localStorage.setItem("accessToken", state.token);
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

authModeLogin.addEventListener("click", () => setAuthMode("login"));
authModeRegister.addEventListener("click", () => setAuthMode("register"));

document.getElementById("registerBtn").addEventListener("click", async () => {
  try {
    const username = document.getElementById("regUsernameInput").value.trim();
    const email = document.getElementById("regEmailInput").value.trim();
    const displayName = document.getElementById("regDisplayNameInput").value.trim();
    const password = document.getElementById("regPasswordInput").value;

    await request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username,
        email,
        displayName,
        password
      })
    });

    const data = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        login: username || email,
        password
      })
    });

    applyLoginResult(data);
    resetProjectUiState();
    setAuthenticatedUi(true);
    renderNavUser();
    await Promise.all([loadDashboard(), loadProjects(), loadProfile()]);
    showToast("Аккаунт создан и вход выполнен.");
  } catch (error) {
    showToast(error.message, true);
  }
});

document.getElementById("loginBtn").addEventListener("click", async () => {
  try {
    const data = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        login: document.getElementById("loginInput").value.trim(),
        password: document.getElementById("loginPasswordInput").value
      })
    });
    applyLoginResult(data);
    resetProjectUiState();
    setAuthenticatedUi(true);
    renderNavUser();
    await Promise.all([loadDashboard(), loadProjects(), loadProfile()]);
    showToast("Вход выполнен.");
  } catch (error) {
    showToast(error.message, true);
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await request("/api/auth/logout", { method: "POST" });
  } catch (error) {
    // no-op
  }
  state.token = "";
  state.currentUser = null;
  localStorage.removeItem("accessToken");
  resetProjectUiState();
  setAuthenticatedUi(false);
});

async function loadDashboard() {
  const data = await request("/api/dashboard");
  document.getElementById("dashboardProjects").innerHTML = data.projects.length
    ? data.projects.map((item) => `<div class="card-item"><strong>${item.name}</strong> — ${roleLabel(item.role)}</div>`).join("")
    : "<p class='muted'>Нет активных проектов. Создай первый в разделе Проекты.</p>";

  document.getElementById("pendingInvitations").innerHTML = data.pendingInvitations.length
    ? data.pendingInvitations
        .map(
          (inv) => `<div class="card-item">
            <strong>${inv.projectName}</strong> — роль: ${roleLabel(inv.role)}
            <div class="row"><button class="btn mini" onclick="respondInvitation('${inv.id}','accept')">Принять</button>
            <button class="btn mini" onclick="respondInvitation('${inv.id}','decline')">Отклонить</button></div>
          </div>`
        )
        .join("")
    : "<p class='muted'>Нет ожидающих приглашений.</p>";
}

window.respondInvitation = async (invitationId, action) => {
  try {
    await request(`/api/invitations/${invitationId}/respond`, {
      method: "POST",
      body: JSON.stringify({ action })
    });
    showToast("Ответ на приглашение отправлен.");
    await Promise.all([loadDashboard(), loadProjects(), loadProfile()]);
  } catch (error) {
    showToast(error.message, true);
  }
};

async function loadProjects() {
  const data = await request("/api/projects");
  state.projects = data.projects;
  const hasActiveProject = state.projects.some((project) => project.id === state.activeProjectId);
  if (!hasActiveProject) {
    resetProjectUiState();
  }
  const listEl = document.getElementById("projectsList");
  listEl.innerHTML = data.projects.length
    ? data.projects
        .map(
          (project) =>
            `<button class="project-item ${state.activeProjectId === project.id ? "selected" : ""}" onclick="selectProject('${project.id}')">${project.name}<span>${roleLabel(project.role)}</span></button>`
        )
        .join("")
    : "<p class='muted'>У тебя пока нет проектов.</p>";
}

window.selectProject = async (projectId) => {
  state.activeProjectId = projectId;
  await loadProjects();
  await loadProjectDetails(projectId);
};

async function loadProjectDetails(projectId) {
  const data = await request(`/api/projects/${projectId}`);
  state.activeProject = data.project;
  state.projectMembers = data.members;
  document.getElementById("projectDetailsEmpty").classList.add("hidden");
  document.getElementById("projectDetails").classList.remove("hidden");
  document.getElementById("projectTitle").textContent = data.project.name;
  document.getElementById("projectMeta").textContent = `Ваша роль: ${roleLabel(data.project.yourRole)}. Создан: ${new Date(data.project.createdAt).toLocaleString()}`;
  document.getElementById("editProjectDescription").value = data.project.description || "";

  const isEmployer = data.project.yourRole === "employer";

  document.getElementById("projectMembers").innerHTML = data.members
    .map((item) => {
      const roleSuffix = ` — ${roleLabel(item.role)}`;
      const line = memberLineHtml(item.user, roleSuffix);
      const isOwner = item.user.id === data.project.ownerId;
      const isSelf = state.currentUser && item.user.id === state.currentUser.id;

      if (isSelf) {
        return `<div class="card-item row spread"><span>${line}</span><button class="btn mini" onclick="exitProject()">Выйти</button></div>`;
      }

      if (!isEmployer || isOwner) {
        return `<div class="card-item">${line}</div>`;
      }

      const otherRole = item.role === "employer" ? "worker" : "employer";
      const changeRoleLabel = item.role === "employer" ? "Сделать работником" : "Сделать работодателем";
      return `<div class="card-item row spread"><span>${line}</span><div class="row">
        <button class="btn mini" onclick="changeMemberRole('${item.user.id}','${otherRole}')">${changeRoleLabel}</button>
        <button class="btn mini ghost" onclick="kickMember('${item.user.id}')">Исключить</button>
      </div></div>`;
    })
    .join("");

  await loadPlanner();

  const plannerSection = document.getElementById("plannerSection");
  if (plannerSection) {
    plannerSection.classList.toggle("hidden", false);
  }

  document.querySelectorAll("#projectDetails .employer-only, #plannerSection .employer-only").forEach((el) => {
    el.classList.toggle("hidden", !isEmployer);
  });
}

document.getElementById("createProjectBtn").addEventListener("click", async () => {
  try {
    await request("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("newProjectName").value.trim(),
        description: document.getElementById("newProjectDescription").value.trim()
      })
    });
    document.getElementById("newProjectName").value = "";
    document.getElementById("newProjectDescription").value = "";
    await Promise.all([loadProjects(), loadDashboard(), loadProfile()]);
    showToast("Проект создан.");
  } catch (error) {
    showToast(error.message, true);
  }
});

document.getElementById("saveProjectBtn").addEventListener("click", async () => {
  if (!state.activeProjectId) {
    return;
  }
  try {
    await request(`/api/projects/${state.activeProjectId}`, {
      method: "PATCH",
      body: JSON.stringify({
        description: document.getElementById("editProjectDescription").value
      })
    });
    showToast("Проект обновлен.");
    await Promise.all([loadProjectDetails(state.activeProjectId), loadProjects()]);
  } catch (error) {
    showToast(error.message, true);
  }
});

document.getElementById("deleteProjectBtn").addEventListener("click", async () => {
  if (!state.activeProjectId) {
    return;
  }
  try {
    if (!state.activeProject || state.activeProject.yourRole !== "employer") {
      showToast("Только работодатель может удалить проект.", true);
      return;
    }
    await request(`/api/projects/${state.activeProjectId}`, { method: "DELETE" });
    state.activeProjectId = null;
    document.getElementById("projectDetails").classList.add("hidden");
    document.getElementById("projectDetailsEmpty").classList.remove("hidden");
    await Promise.all([loadProjects(), loadDashboard(), loadProfile()]);
    showToast("Проект удален.");
  } catch (error) {
    showToast(error.message, true);
  }
});

document.getElementById("sendInviteBtn").addEventListener("click", async () => {
  if (!state.activeProjectId) {
    return;
  }
  try {
    await request(`/api/projects/${state.activeProjectId}/invitations`, {
      method: "POST",
      body: JSON.stringify({
        username: document.getElementById("inviteUsernameInput").value.trim(),
        role: document.getElementById("inviteRoleInput").value
      })
    });
    document.getElementById("inviteUsernameInput").value = "";
    await loadProjectDetails(state.activeProjectId);
    showToast("Приглашение отправлено.");
  } catch (error) {
    showToast(error.message, true);
  }
});

window.kickMember = async (userId) => {
  try {
    await request(`/api/projects/${state.activeProjectId}/members/${userId}`, { method: "DELETE" });
    await Promise.all([loadProjectDetails(state.activeProjectId), loadDashboard()]);
    showToast("Участник удален из проекта.");
  } catch (error) {
    showToast(error.message, true);
  }
};

window.changeMemberRole = async (userId, newRole) => {
  try {
    await request(`/api/projects/${state.activeProjectId}/members/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role: newRole })
    });
    await Promise.all([loadProjectDetails(state.activeProjectId), loadDashboard()]);
    showToast(`Роль изменена на ${newRole === "employer" ? "работодатель" : "работник"}.`);
  } catch (error) {
    showToast(error.message, true);
  }
};

window.exitProject = async () => {
  if (!state.activeProject || !state.currentUser) {
    return;
  }
  try {
    await request(
      `/api/projects/${state.activeProject.id}/members/${state.currentUser.id}`,
      { method: "DELETE" }
    );
    if (state.activeProjectId === state.activeProject.id) {
      state.activeProjectId = null;
      state.activeProject = null;
      document.getElementById("projectDetails").classList.add("hidden");
      document.getElementById("projectDetailsEmpty").classList.remove("hidden");
    }
    await Promise.all([loadProjects(), loadDashboard(), loadProfile()]);
    showToast("Вы вышли из проекта.");
  } catch (error) {
    showToast(error.message, true);
  }
};

async function takePlannerNode(nodeId) {
  return request(`/api/projects/${state.activeProjectId}/planner/nodes/${nodeId}/take`, {
    method: "POST"
  });
}

async function cancelPlannerNode(nodeId) {
  return request(`/api/projects/${state.activeProjectId}/planner/nodes/${nodeId}/cancel`, {
    method: "POST"
  });
}

async function completePlannerNode(nodeId) {
  return request(`/api/projects/${state.activeProjectId}/planner/nodes/${nodeId}/complete`, {
    method: "POST"
  });
}

async function uncompletePlannerNode(nodeId) {
  return request(`/api/projects/${state.activeProjectId}/planner/nodes/${nodeId}/uncomplete`, {
    method: "POST"
  });
}

async function loadProfile() {
  const data = await request("/api/profile/me");
  state.currentUser = data.profile;
  renderNavUser();
  document.getElementById("profileAvatar").src = data.profile.avatarUrl;
  document.getElementById("profileDisplayName").value = data.profile.displayName || "";
  document.getElementById("profileUsername").value = data.profile.username || "";
  document.getElementById("profileBio").value = data.profile.bio || "";
  document.getElementById("profileProjects").innerHTML = data.projects.length
    ? data.projects.map((item) => `<div class="card-item">${item.name} — ${roleLabel(item.role)}</div>`).join("")
    : "<p class='muted'>Пока нет участия в проектах.</p>";
}

document.getElementById("saveProfileBtn").addEventListener("click", async () => {
  try {
    await request("/api/profile/me", {
      method: "PATCH",
      body: JSON.stringify({
        displayName: document.getElementById("profileDisplayName").value.trim(),
        username: document.getElementById("profileUsername").value.trim(),
        bio: document.getElementById("profileBio").value.trim()
      })
    });
    const avatarInput = document.getElementById("avatarInput");
    if (avatarInput.files?.length) {
      const formData = new FormData();
      formData.append("avatar", avatarInput.files[0]);
      await request("/api/profile/avatar", {
        method: "POST",
        body: formData,
        headers: {}
      });
      avatarInput.value = "";
    }
    await Promise.all([loadProfile(), loadProjects(), loadDashboard()]);
    showToast("Профиль сохранен.");
  } catch (error) {
    showToast(error.message, true);
  }
});

document.getElementById("changePasswordBtn").addEventListener("click", async () => {
  try {
    await request("/api/profile/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: document.getElementById("currentPasswordInput").value,
        newPassword: document.getElementById("newPasswordInput").value
      })
    });
    document.getElementById("currentPasswordInput").value = "";
    document.getElementById("newPasswordInput").value = "";
    showToast("Пароль обновлен.");
  } catch (error) {
    showToast(error.message, true);
  }
});

const taskDescriptionEl = document.getElementById("taskDescription");
const hourlyRateEl = document.getElementById("hourlyRate");
const statusEl = document.getElementById("status");
const suggestionsEl = document.getElementById("suggestions");
const estimationEl = document.getElementById("estimation");
const treeContainer = document.getElementById("treeContainer");
const selectedNodeLabel = document.getElementById("selectedNodeLabel");
const branchTipsEl = document.getElementById("branchTips");

const generateBtn = document.getElementById("generateBtn");
const improveBtn = document.getElementById("improveBtn");
const estimateBtn = document.getElementById("estimateBtn");
const addRootBtn = document.getElementById("addRootBtn");
const branchTipsBtn = document.getElementById("branchTipsBtn");
const applyAiChildrenBtn = document.getElementById("applyAiChildrenBtn");

let todoTree = [];
let selectedNodeId = null;
let lastSuggestedChildren = [];
let hoursByNodeId = {};
const priorities = ["Низкий", "Средний", "Высокий"];

let plannerSaveTimer = null;
async function savePlannerNow() {
  if (!state.activeProjectId || !isEmployerActive()) {
    return;
  }
  try {
    await request(`/api/projects/${state.activeProjectId}/planner`, {
      method: "PUT",
      body: JSON.stringify({
        taskDescription: taskDescriptionEl.value.trim(),
        hourlyRate: Number(hourlyRateEl.value) || 0,
        tree: todoTree
      })
    });
    setStatus("AI Planner сохранен.");
  } catch (error) {
    setStatus(`AI Planner не сохранен: ${error.message}`, true);
  }
}

function isEmployerActive() {
  return Boolean(state.activeProject && state.activeProject.yourRole === "employer");
}

function schedulePlannerSave() {
  if (plannerSaveTimer) clearTimeout(plannerSaveTimer);
  plannerSaveTimer = setTimeout(() => savePlannerNow(), 600);
}

async function loadPlanner() {
  if (!state.activeProjectId) {
    return;
  }
  try {
    const data = await request(`/api/projects/${state.activeProjectId}/planner`);
    const planner = data.planner || {};
    taskDescriptionEl.value = planner.taskDescription || "";
    if (planner.hourlyRate !== undefined && planner.hourlyRate !== null) {
      hourlyRateEl.value = String(planner.hourlyRate);
    }
    todoTree = Array.isArray(planner.tree) ? planner.tree : [];
    hoursByNodeId = {};
    selectedNodeId = null;
    selectedNodeLabel.textContent = "Ветка не выбрана";
    branchTipsEl.innerHTML = "";
    renderTree();
    setStatus(todoTree.length ? "План загружен." : "Готов к работе.");
  } catch (error) {
    // если плана нет — просто оставляем пустым
    todoTree = [];
    renderTree();
  }
}

function makeId() {
  return `node-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
}
function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#ff9090" : "#92a0be";
}
function findNodeById(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findNodeById(node.children || [], id);
    if (nested) return nested;
  }
  return null;
}

function formatPlannerDate(iso) {
  if (!iso) {
    return "—";
  }
  try {
    return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return String(iso);
  }
}

function fillAssigneeTooltip(tipEl, node, assignee) {
  tipEl.replaceChildren();
  const title = document.createElement("div");
  title.className = "assignee-tip-title";
  if (assignee) {
    const link = document.createElement("a");
    link.href = "#";
    link.className = "profile-ref";
    link.dataset.username = assignee.username;
    link.textContent = `${assignee.displayName} (@${assignee.username})`;
    title.appendChild(link);
  } else if (node.assigneeId) {
    title.textContent = "Исполнитель назначен";
  } else {
    title.textContent = "Нет исполнителя";
  }
  tipEl.appendChild(title);
  const takenRow = document.createElement("div");
  takenRow.className = "assignee-tip-row";
  takenRow.textContent = `Взял задачу: ${formatPlannerDate(node.assigneeTakenAt)}`;
  tipEl.appendChild(takenRow);
  const doneRow = document.createElement("div");
  doneRow.className = "assignee-tip-row";
  doneRow.textContent = node.completed
    ? `Отметил выполненной: ${formatPlannerDate(node.assigneeCompletedAt)}`
    : "Выполнено: ещё нет";
  tipEl.appendChild(doneRow);
}

function collectNodeIds(node, acc = []) {
  if (!node) {
    return acc;
  }
  acc.push(node.id);
  for (const child of node.children || []) {
    collectNodeIds(child, acc);
  }
  return acc;
}
function updateNodeById(nodes, id, updater) {
  return nodes.map((node) =>
    node.id === id ? updater(node) : { ...node, children: updateNodeById(node.children || [], id, updater) }
  );
}
function deleteNodeById(nodes, id) {
  return nodes.filter((node) => node.id !== id).map((node) => ({ ...node, children: deleteNodeById(node.children || [], id) }));
}
function setCompletionRecursively(node, completed) {
  return { ...node, completed, children: (node.children || []).map((child) => setCompletionRecursively(child, completed)) };
}
function collectCompletedNodeIds(nodes, acc = []) {
  for (const node of nodes) {
    if (node.completed) acc.push(node.id);
    collectCompletedNodeIds(node.children || [], acc);
  }
  return acc;
}
function renderTree() {
  treeContainer.innerHTML = "";
  if (!todoTree.length) {
    treeContainer.innerHTML = "<p class='muted'>Пока пусто. Сгенерируй дерево или добавь первую ветку вручную.</p>";
    return;
  }
  const rootList = document.createElement("div");
  rootList.className = "tree-root";
  todoTree.forEach((node) => rootList.appendChild(renderNode(node, 0)));
  const scrollWrap = document.createElement("div");
  scrollWrap.className = "tree-scroll";
  scrollWrap.appendChild(rootList);
  treeContainer.appendChild(scrollWrap);
}
function renderNode(node, depth = 0) {
  const wrap = document.createElement("div");
  wrap.className = `node ${node.id === selectedNodeId ? "selected" : ""}`;
  wrap.style.setProperty("--depth-hue", String((depth * 26) % 360));
  if (node.completed) wrap.classList.add("done");

  const card = document.createElement("div");
  card.className = "node-card";
  const canEditPlanner = isEmployerActive();
  const isWorker = !canEditPlanner;
  const isCurrentUserAssignee = Boolean(state.currentUser && node.assigneeId === state.currentUser.id);
  const assignee = state.projectMembers
    .map((item) => item.user)
    .find((user) => user && user.id === node.assigneeId);

  const titleInput = document.createElement("input");
  titleInput.className = "node-title";
  titleInput.value = node.title;
  titleInput.placeholder = "Название задачи";
  titleInput.disabled = !canEditPlanner;
  if (canEditPlanner) {
    titleInput.addEventListener("input", () => {
      todoTree = updateNodeById(todoTree, node.id, (current) => ({ ...current, title: titleInput.value }));
      schedulePlannerSave();
    });
  }
  const prioritySelect = document.createElement("select");
  prioritySelect.className = "node-priority";
  prioritySelect.disabled = !canEditPlanner;
  priorities.forEach((item) => {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    option.selected = (node.priority || "Средний") === item;
    prioritySelect.appendChild(option);
  });
  if (canEditPlanner) {
    prioritySelect.addEventListener("change", () => {
      todoTree = updateNodeById(todoTree, node.id, (current) => ({ ...current, priority: prioritySelect.value }));
      schedulePlannerSave();
    });
  }
  const selectBtn = document.createElement("button");
  selectBtn.className = "btn mini";
  selectBtn.textContent = "Выбрать";
  if (canEditPlanner) {
    selectBtn.addEventListener("click", () => {
      selectedNodeId = node.id;
      selectedNodeLabel.textContent = `Выбрано: ${node.title}`;
      renderTree();
    });
  } else {
    selectBtn.classList.add("hidden");
  }
  const topRow = document.createElement("div");
  topRow.className = "node-top";
  const doneWrap = document.createElement("label");
  doneWrap.className = "done-toggle";
  const doneCheckbox = document.createElement("input");
  doneCheckbox.type = "checkbox";
  doneCheckbox.checked = Boolean(node.completed);
  doneCheckbox.disabled = !canEditPlanner;
  if (canEditPlanner) {
    doneCheckbox.addEventListener("change", () => {
      todoTree = updateNodeById(todoTree, node.id, (current) => setCompletionRecursively(current, doneCheckbox.checked));
      renderTree();
      schedulePlannerSave();
    });
  }
  const doneText = document.createElement("span");
  doneText.textContent = "Готово";
  doneWrap.append(doneCheckbox, doneText);
  const assigneeSlot = document.createElement("span");
  assigneeSlot.className = "assignee-slot";
  if (assignee) {
    const host = document.createElement("span");
    host.className = "assignee-avatar-host";
    host.tabIndex = 0;
    const avatarImg = document.createElement("img");
    avatarImg.className = "avatar micro";
    avatarImg.src = assignee.avatarUrl;
    avatarImg.alt = assignee.displayName || assignee.username;
    avatarImg.addEventListener("error", () => {
      if (avatarImg.dataset.avatarFallback) return;
      avatarImg.dataset.avatarFallback = "1";
      avatarImg.src = `https://api.dicebear.com/9.x/croodles/png?seed=${encodeURIComponent(assignee.id)}&size=128`;
    });
    bindAssigneeTooltip(host, () => {
      const cur = findNodeById(todoTree, node.id) || node;
      const mem = state.projectMembers
        .map((item) => item.user)
        .find((user) => user && user.id === cur.assigneeId);
      return { node: cur, assignee: mem || null };
    });
    host.append(avatarImg);
    assigneeSlot.appendChild(host);
  } else if (node.assigneeId) {
    const host = document.createElement("span");
    host.className = "assignee-avatar-host assignee-unknown-host";
    host.tabIndex = 0;
    const stub = document.createElement("span");
    stub.className = "assignee-unknown-circle";
    stub.textContent = "?";
    stub.setAttribute("aria-label", "Исполнитель не в списке участников");
    bindAssigneeTooltip(host, () => ({ node: findNodeById(todoTree, node.id) || node, assignee: null }));
    host.append(stub);
    assigneeSlot.appendChild(host);
  } else {
    const label = document.createElement("span");
    label.className = "hours-badge";
    label.textContent = "свободно";
    assigneeSlot.appendChild(label);
  }
  const effortBadge = document.createElement("span");
  effortBadge.className = "hours-badge";
  effortBadge.textContent = hoursByNodeId[node.id] !== undefined ? `${Number(hoursByNodeId[node.id]).toFixed(1)} ч` : "—";
  topRow.append(titleInput, prioritySelect, selectBtn, doneWrap, assigneeSlot, effortBadge);
  card.appendChild(topRow);
  const detailsInput = document.createElement("textarea");
  detailsInput.className = "node-details";
  detailsInput.value = node.details || "";
  detailsInput.placeholder = "Комментарий или критерий готовности";
  detailsInput.disabled = !canEditPlanner;
  if (canEditPlanner) {
    detailsInput.addEventListener("input", () => {
      todoTree = updateNodeById(todoTree, node.id, (current) => ({ ...current, details: detailsInput.value }));
      schedulePlannerSave();
    });
  }
  card.appendChild(detailsInput);
  const actions = document.createElement("div");
  actions.className = "node-actions";
  if (canEditPlanner) {
    const addChildBtn = document.createElement("button");
    addChildBtn.className = "btn mini";
    addChildBtn.textContent = "+ Подветка";
    addChildBtn.addEventListener("click", () => {
      todoTree = updateNodeById(todoTree, node.id, (current) => ({
        ...current,
        children: [
          ...(current.children || []),
          { id: makeId(), title: "Новая подзадача", details: "", priority: "Средний", completed: Boolean(node.completed), assigneeId: null, children: [] }
        ]
      }));
      renderTree();
      schedulePlannerSave();
    });
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn mini";
    removeBtn.textContent = "Удалить";
    removeBtn.addEventListener("click", () => {
      todoTree = deleteNodeById(todoTree, node.id);
      if (selectedNodeId === node.id) {
        selectedNodeId = null;
        selectedNodeLabel.textContent = "Ветка не выбрана";
        branchTipsEl.innerHTML = "";
      }
      renderTree();
      schedulePlannerSave();
    });
    actions.append(addChildBtn, removeBtn);
  } else if (isWorker) {
    if (isCurrentUserAssignee) {
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn mini";
      cancelBtn.textContent = "Отменить";
      cancelBtn.disabled = Boolean(node.completed);
      cancelBtn.addEventListener("click", async () => {
        try {
          await cancelPlannerNode(node.id);
          await Promise.all([loadPlanner(), loadDashboard()]);
          showToast("Задача возвращена в общий пул.");
        } catch (error) {
          showToast(error.message, true);
        }
      });
      actions.appendChild(cancelBtn);
    } else if (!node.assigneeId) {
      const takeBtn = document.createElement("button");
      takeBtn.className = "btn mini";
      takeBtn.textContent = "Взять";
      takeBtn.disabled = Boolean(node.completed);
      takeBtn.addEventListener("click", async () => {
        try {
          const targetNode = findNodeById(todoTree, node.id);
          const idsToTake = collectNodeIds(targetNode);
          for (const id of idsToTake) {
            await takePlannerNode(id);
          }
          await Promise.all([loadPlanner(), loadDashboard()]);
          showToast("Ветка взята в работу вместе с подветками.");
        } catch (error) {
          showToast(error.message, true);
        }
      });
      actions.appendChild(takeBtn);
    }
    const completeBtn = document.createElement("button");
    completeBtn.className = "btn mini";
    completeBtn.textContent = node.completed ? "Снять выполнено" : "Выполнено";
    completeBtn.disabled = !isCurrentUserAssignee;
    completeBtn.addEventListener("click", async () => {
      try {
        if (node.completed) {
          await uncompletePlannerNode(node.id);
        } else {
          await completePlannerNode(node.id);
        }
        await Promise.all([loadPlanner(), loadDashboard()]);
        showToast(node.completed ? "Статус выполнения снят." : "Задача отмечена выполненной.");
      } catch (error) {
        if (String(error.message || "").includes("Cannot POST")) {
          showToast("Сервер не обновлен: endpoint завершения задачи недоступен. Перезапусти backend.", true);
          return;
        }
        showToast(error.message, true);
      }
    });
    actions.appendChild(completeBtn);
  }
  card.appendChild(actions);
  wrap.appendChild(card);
  if (node.children?.length) {
    const childWrap = document.createElement("div");
    childWrap.className = "node-children";
    node.children.forEach((child) => childWrap.appendChild(renderNode(child, depth + 1)));
    wrap.appendChild(childWrap);
  }
  return wrap;
}

generateBtn.addEventListener("click", async () => {
  try {
    setStatus("ИИ собирает дерево задач...");
    suggestionsEl.innerHTML = "";
    estimationEl.innerHTML = "";
    branchTipsEl.innerHTML = "";
    const data = await request("/api/generate-todo", { method: "POST", body: JSON.stringify({ taskDescription: taskDescriptionEl.value.trim() }) });
    todoTree = data.tree || [];
    hoursByNodeId = {};
    selectedNodeId = null;
    selectedNodeLabel.textContent = "Ветка не выбрана";
    renderTree();
    setStatus("Дерево задач готово.");
    schedulePlannerSave();
  } catch (error) {
    setStatus(error.message, true);
  }
});
improveBtn.addEventListener("click", async () => {
  try {
    setStatus("ИИ улучшает структуру todo...");
    const data = await request("/api/improve-todo", { method: "POST", body: JSON.stringify({ taskDescription: taskDescriptionEl.value.trim(), tree: todoTree }) });
    todoTree = data.improvedTree || todoTree;
    hoursByNodeId = {};
    renderTree();
    const suggestions = data.suggestions || [];
    suggestionsEl.innerHTML = suggestions.length ? `<h3>Что улучшил ИИ</h3><ul class="list">${suggestions.map((s) => `<li>${s}</li>`).join("")}</ul>` : "<p class='muted'>ИИ не предложил новых улучшений.</p>";
    setStatus("Дерево обновлено.");
    schedulePlannerSave();
  } catch (error) {
    setStatus(error.message, true);
  }
});
addRootBtn.addEventListener("click", () => {
  todoTree.push({ id: makeId(), title: "Новая ветка", details: "", priority: "Средний", completed: false, assigneeId: null, children: [] });
  renderTree();
  schedulePlannerSave();
});
branchTipsBtn.addEventListener("click", async () => {
  try {
    const selectedNode = findNodeById(todoTree, selectedNodeId);
    if (!selectedNode) throw new Error("Сначала выбери ветку");
    const data = await request("/api/suggest-branch", { method: "POST", body: JSON.stringify({ taskDescription: taskDescriptionEl.value.trim(), selectedNode, tree: todoTree }) });
    lastSuggestedChildren = data.suggestedChildren || [];
    branchTipsEl.innerHTML = `<ul class="list">${(data.tips || []).map((tip) => `<li>${tip}</li>`).join("")}</ul>`;
    setStatus("Подсказки готовы.");
  } catch (error) {
    setStatus(error.message, true);
  }
});
applyAiChildrenBtn.addEventListener("click", () => {
  if (!selectedNodeId || !lastSuggestedChildren.length) return setStatus("Нет AI-подветок для добавления", true);
  todoTree = updateNodeById(todoTree, selectedNodeId, (current) => ({ ...current, children: [...(current.children || []), ...lastSuggestedChildren] }));
  lastSuggestedChildren = [];
  renderTree();
  schedulePlannerSave();
});
estimateBtn.addEventListener("click", async () => {
  try {
    const data = await request("/api/estimate", { method: "POST", body: JSON.stringify({ hourlyRate: hourlyRateEl.value, tree: todoTree }) });
    hoursByNodeId = {};
    (data.items || []).forEach((item) => {
      if (item.id) hoursByNodeId[item.id] = Number(item.hours) || 0;
    });
    renderTree();
    const rows = (data.items || []).map((item) => `<li><strong>${item.task}</strong>: ${item.hours} ч — ${item.comment || "Без комментария"}</li>`).join("");
    const completedIds = new Set(collectCompletedNodeIds(todoTree));
    const completedHours = (data.items || []).reduce((sum, item) => (item.id && completedIds.has(item.id) ? sum + (Number(item.hours) || 0) : sum), 0);
    const completedCost = Number((completedHours * (Number(data.hourlyRate) || 0)).toFixed(2));
    const remainingCost = Number(((Number(data.totalCost) || 0) - completedCost).toFixed(2));
    const payoutRows = (data.payoutByWorker || [])
      .map((item) => {
        const u = escapeHtml(item.username);
        const dn = escapeHtml(item.displayName || item.username);
        return `<li><a href="#" class="profile-ref" data-username="${u}"><strong>${dn}</strong> <span class="muted">@${u}</span></a> — ${Number(item.amount || 0).toFixed(2)}</li>`;
      })
      .join("");
    estimationEl.innerHTML = `<h3>Детальная оценка</h3><ul class="list">${rows}</ul><div class="metrics">
      <div class="metric"><p class="label">Всего часов</p><p class="value">${Number(data.totalHours || 0).toFixed(1)}</p></div>
      <div class="metric"><p class="label">Полная стоимость</p><p class="value">${Number(data.totalCost || 0).toFixed(2)}</p></div>
      <div class="metric"><p class="label">Стоимость выполненных</p><p class="value">${completedCost.toFixed(2)}</p></div>
      <div class="metric"><p class="label">Стоимость с вычетом выполненных</p><p class="value">${Math.max(remainingCost, 0).toFixed(2)}</p></div>
      <div class="metric"><p class="label">Уверенность</p><p class="value">${data.confidence || "N/A"}</p></div>
    </div>
    <h3>Выплаты работникам за выполненные задачи</h3>
    ${payoutRows ? `<ul class="list">${payoutRows}</ul>` : "<p class='muted'>Пока нет выполненных задач, назначенных работникам.</p>"}`;
    setStatus("Расчет завершен.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

function closeProfileModal() {
  const modal = document.getElementById("profileModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function openUserProfile(username) {
  if (!username) return;
  if (state.currentUser && username === state.currentUser.username) {
    closeProfileModal();
    hideAssigneeTooltipLayer();
    activateTab("profile");
    return;
  }
  try {
    const data = await request(`/api/profile/${encodeURIComponent(username)}`);
    const profile = data.profile;
    const projects = data.projects || [];
    const u = escapeHtml(profile.username);
    const dn = escapeHtml(profile.displayName || profile.username);
    const bioRaw = profile.bio || "";
    const bioPara = bioRaw
      ? `<p class="profile-view-bio">${escapeHtml(bioRaw).replace(/\n/g, "<br>")}</p>`
      : `<p class="muted">Нет описания.</p>`;
    const projectsBlock = projects.length
      ? `<ul class="list">${projects
          .map((p) => `<li>${escapeHtml(p.name)} — ${roleLabel(p.role)}</li>`)
          .join("")}</ul>`
      : "<p class=\"muted\">Пока без проектов.</p>";
    document.getElementById("profileModalContent").innerHTML = `
      <div class="profile-view">
        <img class="avatar large" alt="" src=${JSON.stringify(profile.avatarUrl)} />
        <p class="profile-view-line"><strong>${dn}</strong> <span class="muted">@${u}</span></p>
        <p class="muted profile-view-meta">На сайте с ${new Date(profile.createdAt).toLocaleDateString("ru-RU")}</p>
        ${bioPara}
        <h4>Участие в проектах</h4>
        ${projectsBlock}
      </div>`;
    document.getElementById("profileModalHeading").textContent = `Профиль: ${dn}`;
    const modal = document.getElementById("profileModal");
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  } catch (err) {
    showToast(err.message, true);
  }
}

function initProfileUi() {
  const modal = document.getElementById("profileModal");
  const backdrop = document.getElementById("profileModalBackdrop");
  const closeBtn = document.getElementById("profileModalClose");
  if (!modal || !backdrop || !closeBtn) return;
  backdrop.addEventListener("click", closeProfileModal);
  closeBtn.addEventListener("click", closeProfileModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) closeProfileModal();
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a.profile-ref");
    if (!a || !a.dataset.username) return;
    e.preventDefault();
    hideAssigneeTooltipLayer();
    openUserProfile(a.dataset.username);
  });
  if (navAvatar) {
    navAvatar.style.cursor = "pointer";
    navAvatar.addEventListener("click", () => {
      if (state.currentUser) openUserProfile(state.currentUser.username);
    });
  }
}

taskDescriptionEl.addEventListener("input", () => schedulePlannerSave());
hourlyRateEl.addEventListener("input", () => schedulePlannerSave());

renderTree();
setAuthMode("login");
initProfileUi();
bootstrapAuth().catch(() => setAuthenticatedUi(false));