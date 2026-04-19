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

function makeId() {
  return `node-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#ff9090" : "#92a0be";
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Ошибка запроса");
  }
  return data;
}

function findNodeById(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const nested = findNodeById(node.children || [], id);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function updateNodeById(nodes, id, updater) {
  return nodes.map((node) => {
    if (node.id === id) {
      return updater(node);
    }
    return { ...node, children: updateNodeById(node.children || [], id, updater) };
  });
}

function deleteNodeById(nodes, id) {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => ({ ...node, children: deleteNodeById(node.children || [], id) }));
}

function setCompletionRecursively(node, completed) {
  return {
    ...node,
    completed,
    children: (node.children || []).map((child) => setCompletionRecursively(child, completed))
  };
}

function collectCompletedNodeIds(nodes, acc = []) {
  for (const node of nodes) {
    if (node.completed) {
      acc.push(node.id);
    }
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
  todoTree.forEach((node) => {
    rootList.appendChild(renderNode(node, 0));
  });
  treeContainer.appendChild(rootList);
}

function renderNode(node, depth = 0) {
  const wrap = document.createElement("div");
  wrap.className = `node ${node.id === selectedNodeId ? "selected" : ""}`;
  wrap.style.setProperty("--depth", String(depth));
  wrap.style.setProperty("--depth-hue", String((depth * 26) % 360));
  if (node.completed) {
    wrap.classList.add("done");
  }

  const card = document.createElement("div");
  card.className = "node-card";

  const titleInput = document.createElement("input");
  titleInput.className = "node-title";
  titleInput.value = node.title;
  titleInput.placeholder = "Название задачи";
  titleInput.addEventListener("input", () => {
    todoTree = updateNodeById(todoTree, node.id, (current) => ({ ...current, title: titleInput.value }));
  });

  const prioritySelect = document.createElement("select");
  prioritySelect.className = "node-priority";
  priorities.forEach((item) => {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    if ((node.priority || "Средний") === item) {
      option.selected = true;
    }
    prioritySelect.appendChild(option);
  });
  prioritySelect.addEventListener("change", () => {
    todoTree = updateNodeById(todoTree, node.id, (current) => ({ ...current, priority: prioritySelect.value }));
  });

  const selectBtn = document.createElement("button");
  selectBtn.className = "btn mini";
  selectBtn.textContent = "Выбрать";
  selectBtn.addEventListener("click", () => {
    selectedNodeId = node.id;
    selectedNodeLabel.textContent = `Выбрано: ${node.title}`;
    renderTree();
  });

  const topRow = document.createElement("div");
  topRow.className = "node-top";

  const doneWrap = document.createElement("label");
  doneWrap.className = "done-toggle";
  const doneCheckbox = document.createElement("input");
  doneCheckbox.type = "checkbox";
  doneCheckbox.checked = Boolean(node.completed);
  doneCheckbox.addEventListener("change", () => {
    todoTree = updateNodeById(todoTree, node.id, (current) =>
      setCompletionRecursively(current, doneCheckbox.checked)
    );
    renderTree();
  });
  const doneText = document.createElement("span");
  doneText.textContent = "Готово";
  doneWrap.append(doneCheckbox, doneText);

  const nodeHours = hoursByNodeId[node.id];
  const hoursBadge = document.createElement("span");
  hoursBadge.className = "hours-badge";
  hoursBadge.textContent = nodeHours !== undefined ? `${Number(nodeHours).toFixed(1)} ч` : "—";
  hoursBadge.title = "Оценка часов по задаче";

  topRow.append(titleInput, prioritySelect, selectBtn, doneWrap, hoursBadge);
  card.appendChild(topRow);

  const detailsInput = document.createElement("textarea");
  detailsInput.className = "node-details";
  detailsInput.value = node.details || "";
  detailsInput.placeholder = "Комментарий или критерий готовности";
  detailsInput.style.minHeight = "78px";
  detailsInput.addEventListener("input", () => {
    todoTree = updateNodeById(todoTree, node.id, (current) => ({ ...current, details: detailsInput.value }));
  });
  card.appendChild(detailsInput);

  const actions = document.createElement("div");
  actions.className = "node-actions";

  const addChildBtn = document.createElement("button");
  addChildBtn.className = "btn mini";
  addChildBtn.textContent = "+ Подветка";
  addChildBtn.addEventListener("click", () => {
    todoTree = updateNodeById(todoTree, node.id, (current) => ({
      ...current,
      children: [
        ...(current.children || []),
        {
          id: makeId(),
          title: "Новая подзадача",
          details: "",
          priority: "Средний",
          completed: Boolean(node.completed),
          children: []
        }
      ]
    }));
    renderTree();
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
  });

  actions.append(addChildBtn, removeBtn);
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
    const data = await postJson("/api/generate-todo", {
      taskDescription: taskDescriptionEl.value.trim()
    });
    todoTree = data.tree || [];
    hoursByNodeId = {};
    selectedNodeId = null;
    selectedNodeLabel.textContent = "Ветка не выбрана";
    renderTree();
    setStatus("Дерево задач готово.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

improveBtn.addEventListener("click", async () => {
  try {
    setStatus("ИИ улучшает структуру todo...");
    estimationEl.innerHTML = "";
    const data = await postJson("/api/improve-todo", {
      taskDescription: taskDescriptionEl.value.trim(),
      tree: todoTree
    });
    todoTree = data.improvedTree || todoTree;
    hoursByNodeId = {};
    renderTree();
    const suggestions = data.suggestions || [];
    suggestionsEl.innerHTML = suggestions.length
      ? `<h3>Что улучшил ИИ</h3><ul class="list">${suggestions.map((s) => `<li>${s}</li>`).join("")}</ul>`
      : "<p class='muted'>ИИ не предложил новых общих улучшений.</p>";
    setStatus("Дерево обновлено и дополнено.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

addRootBtn.addEventListener("click", () => {
  todoTree.push({
    id: makeId(),
    title: "Новая ветка",
    details: "",
    priority: "Средний",
    completed: false,
    children: []
  });
  renderTree();
});

branchTipsBtn.addEventListener("click", async () => {
  try {
    const selectedNode = findNodeById(todoTree, selectedNodeId);
    if (!selectedNode) {
      throw new Error("Сначала выбери ветку");
    }

    setStatus("Запрашиваю подсказки по ветке...");
    const data = await postJson("/api/suggest-branch", {
      taskDescription: taskDescriptionEl.value.trim(),
      selectedNode,
      tree: todoTree
    });

    lastSuggestedChildren = data.suggestedChildren || [];
    branchTipsEl.innerHTML = `
      <ul class="list">${(data.tips || []).map((tip) => `<li>${tip}</li>`).join("")}</ul>
      ${
        lastSuggestedChildren.length
          ? `<p class="muted">ИИ предложил ${lastSuggestedChildren.length} подветки. Нажми "Добавить AI-подветки".</p>`
          : "<p class='muted'>Новых подветок не предложено.</p>"
      }
    `;
    setStatus("Подсказки для ветки готовы.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

applyAiChildrenBtn.addEventListener("click", () => {
  if (!selectedNodeId || !lastSuggestedChildren.length) {
    setStatus("Нет AI-подветок для добавления", true);
    return;
  }

  todoTree = updateNodeById(todoTree, selectedNodeId, (current) => ({
    ...current,
    children: [...(current.children || []), ...lastSuggestedChildren]
  }));
  lastSuggestedChildren = [];
  renderTree();
  setStatus("AI-подветки добавлены.");
});

estimateBtn.addEventListener("click", async () => {
  try {
    setStatus("Считаю часы и стоимость...");
    const data = await postJson("/api/estimate", {
      hourlyRate: hourlyRateEl.value,
      tree: todoTree
    });

    hoursByNodeId = {};
    (data.items || []).forEach((item) => {
      if (item.id) {
        hoursByNodeId[item.id] = Number(item.hours) || 0;
      }
    });
    renderTree();

    const rows = (data.items || [])
      .map((item) => `<li><strong>${item.task}</strong>: ${item.hours} ч — ${item.comment || "Без комментария"}</li>`)
      .join("");

    const completedIds = new Set(collectCompletedNodeIds(todoTree));
    const completedHours = (data.items || []).reduce((sum, item) => {
      if (item.id && completedIds.has(item.id)) {
        return sum + (Number(item.hours) || 0);
      }
      return sum;
    }, 0);
    const completedCost = Number((completedHours * (Number(data.hourlyRate) || 0)).toFixed(2));
    const remainingCost = Number(((Number(data.totalCost) || 0) - completedCost).toFixed(2));
    const hasCompleted = completedIds.size > 0;

    estimationEl.innerHTML = `
      <h3>Детальная оценка</h3>
      <ul class="list">${rows}</ul>
      <div class="metrics">
        <div class="metric"><p class="label">Всего часов</p><p class="value">${Number(data.totalHours || 0).toFixed(1)}</p></div>
        <div class="metric"><p class="label">Ставка за час</p><p class="value">${Number(data.hourlyRate || 0).toFixed(0)}</p></div>
        <div class="metric"><p class="label">Полная стоимость</p><p class="value">${Number(data.totalCost || 0).toFixed(2)}</p></div>
        ${
          hasCompleted
            ? `<div class="metric"><p class="label">Стоимость выполненных</p><p class="value">${completedCost.toFixed(
                2
              )}</p></div>
        <div class="metric"><p class="label">Стоимость с вычетом выполненных</p><p class="value">${Math.max(
          remainingCost,
          0
        ).toFixed(2)}</p></div>`
            : ""
        }
        <div class="metric"><p class="label">Уверенность</p><p class="value">${data.confidence || "N/A"}</p></div>
      </div>
      ${
        Array.isArray(data.risks) && data.risks.length
          ? `<h3>Риски</h3><ul class="list">${data.risks.map((risk) => `<li>${risk}</li>`).join("")}</ul>`
          : ""
      }
    `;
    setStatus("Расчет завершен.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

renderTree();
