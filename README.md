# 📊 Основной алгоритм (RU):
1. **Пользователь вводит цель проекта** для генерации структуры задач.
2. **Пользователь запускает генерацию дерева** и получает иерархический To-Do.
3. Система **генерирует и улучшает данные** через AI и получает:
   - **Ветки и подветки задач**
   - **Приоритеты** (низкий/средний/высокий)
   - **Подсказки по выбранной ветке**
   - **Оценку часов по задачам**
4. Пользователь редактирует дерево вручную:
   - ➕ Добавляет корневые ветки и подветки
   - ✅ Отмечает выполненные задачи
   - 🗑️ Удаляет лишние пункты
5. Пользователь запускает **расчет часов и стоимости**:
   - **Полная стоимость**
   - **Стоимость выполненных задач**
   - **Стоимость с вычетом выполненных**

---

# ⚙️ Набор технологий, инструментов и библиотек (RU):

## 🖥️ Языки программирования:
- **HTML5** – Структура страницы
- **CSS** – Стилизация интерфейса (neon/glass UI)
- **JavaScript** – Основная логика фронтенда

## 📚 Библиотеки и платформы:
- **Node.js** – Среда выполнения серверной части
- **Express** – Backend API
- **dotenv** – Работа с переменными окружения
- **CORS** – Кросс-доменные запросы

## 🤖 AI-интеграции:
- **OpenRouter API** – доступ к LLM-моделям
- **Fallback free models** – резервные бесплатные модели для устойчивой работы

---

# 📊 Core Algorithm (EN):
1. **User enters a project goal** to generate a task structure.
2. **User triggers tree generation** and receives a hierarchical To-Do.
3. System **generates and improves data** via AI and retrieves:
   - **Task branches and sub-branches**
   - **Priorities** (low/medium/high)
   - **AI tips for selected branch**
   - **Hour estimates per task**
4. User edits the tree manually:
   - ➕ Add root branches and child branches
   - ✅ Mark completed tasks
   - 🗑️ Remove unnecessary items
5. User runs **hours and cost estimation**:
   - **Total cost**
   - **Completed tasks cost**
   - **Remaining cost (excluding completed tasks)**

---

# ⚙️ Technology Stack (EN):

## 🖥️ Programming Languages:
- **HTML5** – Page structure
- **CSS** – Interface styling (neon/glass UI)
- **JavaScript** – Frontend application logic

## 📚 Libraries and Platforms:
- **Node.js** – Backend runtime
- **Express** – Backend API framework
- **dotenv** – Environment variable management
- **CORS** – Cross-origin request handling

## 🤖 AI Integrations:
- **OpenRouter API** – LLM access layer
- **Fallback free models** – backup free models for better availability
