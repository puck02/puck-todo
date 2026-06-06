# Apple Notes Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing Puck Todo frontend to an Apple Notes inspired paper-minimal interface without changing backend behavior.

**Architecture:** Keep the current static frontend architecture. `static/index.html` remains the semantic shell, `static/app.js` continues to own rendering and API calls, and `static/style.css` owns the complete visual language.

**Tech Stack:** Python standard library server, SQLite, vanilla HTML/CSS/JavaScript, existing `unittest` tests.

---

## File Structure

- Modify `static/index.html`: add small semantic hooks and meta polish only when needed for styling or accessibility.
- Modify `static/style.css`: replace the current glass-heavy visual system with Apple Notes style paper surfaces, denser lists, refined controls, responsive behavior, and focus states.
- Modify `static/app.js`: keep API behavior intact; only adjust action labels or ARIA strings if needed for the new visual treatment.
- Keep `docs/superpowers/specs/2026-06-06-apple-notes-redesign-design.md` as the source design spec.

## Task 1: Baseline Verification

**Files:**
- Test: `tests/test_todo_core.py`
- Test: `tests/test_todo_edit_ui.py`

- [ ] **Step 1: Run existing tests before editing**

Run:

```bash
python3.11 -m unittest discover -s tests
```

Expected: all tests pass before visual changes. The system `python3` is Python 3.6.8 in this workspace, so use `python3.11`.

- [ ] **Step 2: Inspect frontend entry points**

Run:

```bash
sed -n '1,220p' static/index.html
sed -n '1,360p' static/style.css
sed -n '1,340p' static/app.js
```

Expected: confirm the app is vanilla static frontend and edit/delete/complete actions are rendered in `static/app.js`.

## Task 2: HTML and Interaction Hooks

**Files:**
- Modify: `static/index.html`
- Modify: `static/app.js`

- [ ] **Step 1: Add only low-risk hooks**

Use existing IDs and classes. If extra hooks are needed, add classes such as `app-title`, `quote-line`, or `list-section`; do not rename IDs used by JavaScript.

- [ ] **Step 2: Refine action button display without changing behavior**

In `static/app.js`, action buttons may use shorter visual labels while preserving readable titles:

```javascript
edit.textContent = '编辑';
edit.title = '编辑待办';
del.textContent = '删除';
del.title = '删除待办';
```

Expected: `tests/test_todo_edit_ui.py` still finds `编辑`, `PATCH`, and `/api/todos/${item.id}`.

- [ ] **Step 3: Run UI text regression test**

Run:

```bash
python3.11 -m unittest tests.test_todo_edit_ui
```

Expected: pass.

## Task 3: Apple Notes Paper Visual System

**Files:**
- Modify: `static/style.css`

- [ ] **Step 1: Replace design tokens**

Set CSS variables for a warm paper palette, softer text hierarchy, restrained priority colors, and small-radius paper surfaces:

```css
:root {
  --paper: #f7f3ea;
  --paper-deep: #eee7d9;
  --surface: rgba(255, 252, 246, 0.86);
  --surface-solid: #fffdf8;
  --ink: #1d1d1f;
  --muted: rgba(29, 29, 31, 0.58);
  --hairline: rgba(92, 78, 55, 0.14);
  --accent: #b86f18;
}
```

- [ ] **Step 2: Rework major layout surfaces**

Update `.shell`, `.hero`, `.month-card`, `.panel`, `.composer`, and `.columns` so the page feels like a calm notebook: wider whitespace, fewer shadows, thin separators, and no blue glass background.

- [ ] **Step 3: Rework form controls**

Use paper-like inputs, clear focus rings, stable heights, and responsive grid behavior. Keep existing input IDs and form IDs untouched.

- [ ] **Step 4: Rework todo list rows**

Make `.todo-item` read as list rows instead of floating cards: subtle separators, compact metadata, priority badges with muted colors, and completed rows visually quiet.

- [ ] **Step 5: Rework modal and toast**

Make `.modal-card` and `.toast` consistent with the paper system while keeping dialog readability and visible contrast.

- [ ] **Step 6: Preserve motion accessibility**

Keep:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; }
}
```

Expected: no functionality selectors or JavaScript IDs are removed.

## Task 4: Verification and Commit

**Files:**
- Verify: `static/index.html`
- Verify: `static/style.css`
- Verify: `static/app.js`
- Test: `tests/test_todo_core.py`
- Test: `tests/test_todo_edit_ui.py`

- [ ] **Step 1: Run tests**

Run:

```bash
python3.11 -m unittest discover -s tests
```

Expected: all tests pass.

- [ ] **Step 2: Start the app and verify HTTP**

Run:

```bash
python3.11 app.py --host 0.0.0.0 --port 8787
curl -sSf http://127.0.0.1:8787/ >/dev/null
curl -sSf http://127.0.0.1:8787/api/health
```

Expected: root page returns HTML and health endpoint returns JSON.

- [ ] **Step 3: Check git diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional files are changed.

- [ ] **Step 4: Commit**

Run:

```bash
git add static/index.html static/style.css static/app.js docs/superpowers/plans/2026-06-06-apple-notes-redesign.md
git commit -m "style: 美化待办纸感界面"
```
