require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/auto";
const FALLBACK_MODELS = (process.env.OPENROUTER_FALLBACK_MODELS ||
  "google/gemma-2-9b-it:free,microsoft/phi-3-mini-128k-instruct:free,qwen/qwen-2.5-7b-instruct:free")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});
app.use(express.static("public"));

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
      children: assignIds(node.children || [], id)
    };
  });
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
    return res.json(parsed);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});
