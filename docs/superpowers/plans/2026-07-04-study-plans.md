# Study Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a study-plan page where users can create plans, manage chapter items, track completion progress, and reorder chapters by drag/drop or buttons.

**Architecture:** Follow the existing Puck Office pattern: D1 migrations define schema, `src/worker.js` exposes authenticated JSON APIs, `app.py` mirrors storage behavior for local tests, and `static/study.html` plus `static/app.js` renders the page. Store plans and items in separate tables, calculate progress from item counts, and persist item order with a `position` integer.

**Tech Stack:** Cloudflare Workers, D1/SQLite SQL, vanilla HTML/CSS/JavaScript, Node test runner, Python `unittest`.

---

## File Map

- Create `migrations/0006_study_plans.sql`: D1 tables and indexes for study plans and chapter items.
- Create `static/study.html`: new authenticated top-level page.
- Modify `src/worker.js`: validation, normalize helpers, CRUD/reorder functions, route handling, exports.
- Modify `app.py`: local SQLite schema and `TodoStore` study-plan methods for Python tests.
- Modify `static/app.js`: initialize study page, render plans/items, edit/delete/toggle/reorder interactions.
- Modify `static/style.css`: study-plan page layout, progress bar, chapter rows, drag affordances.
- Modify `static/index.html`, `static/countdowns.html`, `static/notes.html`: add the navigation link.
- Modify `README.md`: add study-plan API endpoints to the API list.
- Modify `tests/test_todo_core.py`: local storage tests.
- Modify `tests/worker.test.mjs`: Worker API and fake D1 support.
- Modify `tests/frontend.test.mjs`: page structure and interaction wiring tests.
- Modify `tests/deploy-config.test.mjs`: migration presence test.

## Task 1: Database Schema and Local Store

**Files:**
- Create: `migrations/0006_study_plans.sql`
- Modify: `app.py`
- Test: `tests/test_todo_core.py`

- [ ] **Step 1: Write failing local storage tests**

Append these tests to `TodoCoreTests` in `tests/test_todo_core.py`:

```python
    def test_study_plans_can_manage_items_progress_and_reorder(self):
        plan = self.store.create_study_plan("李林高数辅导讲义")
        first = self.store.create_study_plan_item(plan["id"], "函数、极限与连续")
        second = self.store.create_study_plan_item(plan["id"], "导数与微分")

        listed = self.store.list_study_plans()
        self.assertEqual([item["title"] for item in listed["plans"][0]["items"]], ["函数、极限与连续", "导数与微分"])
        self.assertEqual(listed["plans"][0]["total_items"], 2)
        self.assertEqual(listed["plans"][0]["completed_items"], 0)
        self.assertEqual(listed["plans"][0]["progress_percent"], 0)

        completed = self.store.update_study_plan_item(first["id"], {"status": "completed"})
        self.assertEqual(completed["status"], "completed")
        self.assertIsNotNone(completed["completed_at"])

        self.store.reorder_study_plan_items(plan["id"], [second["id"], first["id"]])
        after_reorder = self.store.list_study_plans()
        self.assertEqual([item["title"] for item in after_reorder["plans"][0]["items"]], ["导数与微分", "函数、极限与连续"])
        self.assertEqual(after_reorder["plans"][0]["completed_items"], 1)
        self.assertEqual(after_reorder["plans"][0]["progress_percent"], 50)

    def test_study_plan_edit_delete_and_item_validation(self):
        plan = self.store.create_study_plan("  660  ")
        updated = self.store.update_study_plan(plan["id"], {"title": "880"})
        self.assertEqual(updated["title"], "880")

        with self.assertRaises(ValueError):
            self.store.create_study_plan("")
        with self.assertRaises(ValueError):
            self.store.create_study_plan_item(plan["id"], "")
        with self.assertRaises(ValueError):
            self.store.update_study_plan_item(999, {"status": "done"})

        item = self.store.create_study_plan_item(plan["id"], "基础篇")
        self.assertEqual(self.store.delete_study_plan_item(item["id"]), {"ok": True})
        self.store.create_study_plan_item(plan["id"], "强化篇")
        self.assertEqual(self.store.delete_study_plan(plan["id"]), {"ok": True})
        self.assertEqual(self.store.list_study_plans()["plans"], [])

    def test_store_creates_study_plan_indexes(self):
        with self.store.connect() as conn:
            indexes = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}

        self.assertIn("idx_study_plan_items_plan_position", indexes)
        self.assertIn("idx_study_plan_items_plan_status", indexes)
```

- [ ] **Step 2: Run Python tests and verify they fail**

Run:

```bash
python3.11 -m unittest tests.test_todo_core
```

Expected: FAIL with `AttributeError: 'TodoStore' object has no attribute 'create_study_plan'` or missing index failures.

- [ ] **Step 3: Add the D1 migration**

Create `migrations/0006_study_plans.sql`:

```sql
CREATE TABLE IF NOT EXISTS study_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (plan_id) REFERENCES study_plans(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_study_plan_items_plan_position ON study_plan_items(plan_id, position);
CREATE INDEX IF NOT EXISTS idx_study_plan_items_plan_status ON study_plan_items(plan_id, status);
```

- [ ] **Step 4: Add local schema initialization**

In `app.py`, add this constant near `VALID_STATUS`:

```python
VALID_STUDY_ITEM_STATUS = {"pending", "completed"}
```

In `TodoStore.init_db`, after the notes table block and before `countdowns`, add:

```python
            conn.execute("""
                CREATE TABLE IF NOT EXISTS study_plans (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS study_plan_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    plan_id INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    position INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT,
                    FOREIGN KEY (plan_id) REFERENCES study_plans(id) ON DELETE CASCADE
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_study_plan_items_plan_position ON study_plan_items(plan_id, position)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_study_plan_items_plan_status ON study_plan_items(plan_id, status)")
```

- [ ] **Step 5: Add local store methods**

In `app.py`, add these helpers and methods inside `TodoStore`, after `delete_countdown`:

```python
    def normalize_study_plan(self, row: sqlite3.Row, items: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        data = dict(row)
        data["items"] = items or []
        total = len(data["items"])
        completed = sum(1 for item in data["items"] if item["status"] == "completed")
        data["total_items"] = total
        data["completed_items"] = completed
        data["progress_percent"] = round((completed / total) * 100) if total else 0
        return data

    def get_study_plan(self, plan_id: int) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM study_plans WHERE id=?", (plan_id,)).fetchone()
            if row is None:
                raise KeyError("学习计划不存在")
            item_rows = conn.execute(
                "SELECT * FROM study_plan_items WHERE plan_id=? ORDER BY position ASC, created_at ASC",
                (plan_id,),
            ).fetchall()
        return self.normalize_study_plan(row, [dict(item) for item in item_rows])

    def list_study_plans(self) -> dict[str, Any]:
        with self.connect() as conn:
            plan_rows = conn.execute("SELECT * FROM study_plans ORDER BY created_at DESC, id DESC").fetchall()
            item_rows = conn.execute("SELECT * FROM study_plan_items ORDER BY plan_id ASC, position ASC, created_at ASC").fetchall()
        items_by_plan: dict[int, list[dict[str, Any]]] = {}
        for item in item_rows:
            items_by_plan.setdefault(item["plan_id"], []).append(dict(item))
        return {"plans": [self.normalize_study_plan(row, items_by_plan.get(row["id"], [])) for row in plan_rows]}

    def create_study_plan(self, title: str) -> dict[str, Any]:
        title = (title or "").strip()
        if not title:
            raise ValueError("学习计划名称不能为空")
        now = now_local().isoformat()
        with self.connect() as conn:
            cur = conn.execute(
                "INSERT INTO study_plans (title, created_at, updated_at) VALUES (?, ?, ?)",
                (title, now, now),
            )
            conn.commit()
        return self.get_study_plan(cur.lastrowid)

    def update_study_plan(self, plan_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        title = str(payload.get("title", "")).strip()
        if not title:
            raise ValueError("学习计划名称不能为空")
        now = now_local().isoformat()
        with self.connect() as conn:
            cur = conn.execute("UPDATE study_plans SET title=?, updated_at=? WHERE id=?", (title, now, plan_id))
            conn.commit()
            if cur.rowcount == 0:
                raise KeyError("学习计划不存在")
        return self.get_study_plan(plan_id)

    def delete_study_plan(self, plan_id: int) -> dict[str, bool]:
        with self.connect() as conn:
            conn.execute("DELETE FROM study_plan_items WHERE plan_id=?", (plan_id,))
            cur = conn.execute("DELETE FROM study_plans WHERE id=?", (plan_id,))
            conn.commit()
        return {"ok": cur.rowcount > 0}

    def create_study_plan_item(self, plan_id: int, title: str) -> dict[str, Any]:
        title = (title or "").strip()
        if not title:
            raise ValueError("章节名称不能为空")
        now = now_local().isoformat()
        with self.connect() as conn:
            if conn.execute("SELECT 1 FROM study_plans WHERE id=?", (plan_id,)).fetchone() is None:
                raise KeyError("学习计划不存在")
            next_position = conn.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM study_plan_items WHERE plan_id=?",
                (plan_id,),
            ).fetchone()[0]
            cur = conn.execute(
                "INSERT INTO study_plan_items (plan_id, title, status, position, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?)",
                (plan_id, title, next_position, now, now),
            )
            conn.execute("UPDATE study_plans SET updated_at=? WHERE id=?", (now, plan_id))
            conn.commit()
        return self.get_study_plan_item(cur.lastrowid)

    def get_study_plan_item(self, item_id: int) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM study_plan_items WHERE id=?", (item_id,)).fetchone()
        if row is None:
            raise KeyError("章节不存在")
        return dict(row)

    def update_study_plan_item(self, item_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        allowed = {"title", "status"}
        updates = {key: value for key, value in payload.items() if key in allowed}
        if "title" in updates:
            updates["title"] = str(updates["title"]).strip()
            if not updates["title"]:
                raise ValueError("章节名称不能为空")
        if "status" in updates and updates["status"] not in VALID_STUDY_ITEM_STATUS:
            raise ValueError("章节状态必须是 pending/completed")
        if not updates:
            return self.get_study_plan_item(item_id)
        now = now_local().isoformat()
        updates["updated_at"] = now
        if updates.get("status") == "completed":
            updates["completed_at"] = now
        elif updates.get("status") == "pending":
            updates["completed_at"] = None
        assignments = ", ".join(f"{key}=?" for key in updates)
        with self.connect() as conn:
            cur = conn.execute(f"UPDATE study_plan_items SET {assignments} WHERE id=?", (*updates.values(), item_id))
            if cur.rowcount == 0:
                raise KeyError("章节不存在")
            plan_id = conn.execute("SELECT plan_id FROM study_plan_items WHERE id=?", (item_id,)).fetchone()[0]
            conn.execute("UPDATE study_plans SET updated_at=? WHERE id=?", (now, plan_id))
            conn.commit()
        return self.get_study_plan_item(item_id)

    def delete_study_plan_item(self, item_id: int) -> dict[str, bool]:
        with self.connect() as conn:
            row = conn.execute("SELECT plan_id FROM study_plan_items WHERE id=?", (item_id,)).fetchone()
            if row is None:
                return {"ok": False}
            cur = conn.execute("DELETE FROM study_plan_items WHERE id=?", (item_id,))
            conn.execute("UPDATE study_plans SET updated_at=? WHERE id=?", (now_local().isoformat(), row["plan_id"]))
            conn.commit()
        return {"ok": cur.rowcount > 0}

    def reorder_study_plan_items(self, plan_id: int, item_ids: list[int]) -> dict[str, Any]:
        if not item_ids:
            return self.get_study_plan(plan_id)
        with self.connect() as conn:
            existing = conn.execute("SELECT id FROM study_plan_items WHERE plan_id=?", (plan_id,)).fetchall()
            existing_ids = {row["id"] for row in existing}
            requested_ids = {int(item_id) for item_id in item_ids}
            if existing_ids != requested_ids:
                raise ValueError("章节排序数据不完整")
            now = now_local().isoformat()
            for position, item_id in enumerate(item_ids, start=1):
                conn.execute("UPDATE study_plan_items SET position=?, updated_at=? WHERE id=? AND plan_id=?", (position, now, item_id, plan_id))
            conn.execute("UPDATE study_plans SET updated_at=? WHERE id=?", (now, plan_id))
            conn.commit()
        return self.get_study_plan(plan_id)
```

- [ ] **Step 6: Run local tests and verify they pass**

Run:

```bash
python3.11 -m unittest tests.test_todo_core
```

Expected: OK.

- [ ] **Step 7: Commit**

```bash
git add app.py migrations/0006_study_plans.sql tests/test_todo_core.py
git commit -m "新增学习计划本地存储"
```

## Task 2: Worker API

**Files:**
- Modify: `src/worker.js`
- Test: `tests/worker.test.mjs`

- [ ] **Step 1: Extend fake D1 for study-plan SQL**

In `tests/worker.test.mjs`, update `FakeD1.constructor`:

```js
    this.nextStudyPlanId = 1;
    this.nextStudyPlanItemId = 1;
    this.studyPlans = [];
    this.studyPlanItems = [];
```

In `FakeStatement.all`, add these branches before the final unexpected SQL throw:

```js
    if (sql.startsWith('SELECT * FROM study_plans ORDER BY')) {
      return {
        results: [...this.db.studyPlans].sort((a, b) =>
          b.created_at.localeCompare(a.created_at) ||
          b.id - a.id
        )
      };
    }
    if (sql.startsWith('SELECT * FROM study_plan_items ORDER BY')) {
      return {
        results: [...this.db.studyPlanItems].sort((a, b) =>
          a.plan_id - b.plan_id ||
          a.position - b.position ||
          a.created_at.localeCompare(b.created_at)
        )
      };
    }
```

In `FakeStatement.first`, add:

```js
    if (sql.startsWith('SELECT * FROM study_plans WHERE id=')) {
      return this.db.studyPlans.find((plan) => plan.id === this.params[0]) || null;
    }
    if (sql.startsWith('SELECT * FROM study_plan_items WHERE id=')) {
      return this.db.studyPlanItems.find((item) => item.id === this.params[0]) || null;
    }
    if (sql.startsWith('SELECT 1 FROM study_plans WHERE id=')) {
      return this.db.studyPlans.some((plan) => plan.id === this.params[0]) ? { 1: 1 } : null;
    }
    if (sql.startsWith('SELECT COALESCE(MAX(position), 0) + 1 FROM study_plan_items WHERE plan_id=')) {
      const [planId] = this.params;
      const max = this.db.studyPlanItems
        .filter((item) => item.plan_id === planId)
        .reduce((value, item) => Math.max(value, item.position), 0);
      return { next_position: max + 1 };
    }
```

In `FakeStatement.run`, add:

```js
    if (sql.startsWith('INSERT INTO study_plans')) {
      const [title, now] = this.params;
      const id = this.db.nextStudyPlanId++;
      this.db.studyPlans.push({ id, title, created_at: now, updated_at: now });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith('UPDATE study_plans SET title=')) {
      const [title, now, id] = this.params;
      const plan = this.db.studyPlans.find((item) => item.id === id);
      if (!plan) return { meta: { changes: 0 } };
      plan.title = title;
      plan.updated_at = now;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE study_plans SET updated_at=')) {
      const [now, id] = this.params;
      const plan = this.db.studyPlans.find((item) => item.id === id);
      if (plan) plan.updated_at = now;
      return { meta: { changes: plan ? 1 : 0 } };
    }
    if (sql.startsWith('DELETE FROM study_plan_items WHERE plan_id=')) {
      const [planId] = this.params;
      const before = this.db.studyPlanItems.length;
      this.db.studyPlanItems = this.db.studyPlanItems.filter((item) => item.plan_id !== planId);
      return { meta: { changes: before - this.db.studyPlanItems.length } };
    }
    if (sql.startsWith('DELETE FROM study_plans WHERE id=')) {
      const [id] = this.params;
      const before = this.db.studyPlans.length;
      this.db.studyPlans = this.db.studyPlans.filter((item) => item.id !== id);
      return { meta: { changes: before - this.db.studyPlans.length } };
    }
    if (sql.startsWith('INSERT INTO study_plan_items')) {
      const [plan_id, title, position, now] = this.params;
      const id = this.db.nextStudyPlanItemId++;
      this.db.studyPlanItems.push({
        id,
        plan_id,
        title,
        status: 'pending',
        position,
        created_at: now,
        updated_at: now,
        completed_at: null
      });
      return { meta: { last_row_id: id, changes: 1 } };
    }
    if (sql.startsWith('UPDATE study_plan_items SET')) {
      const id = this.params.at(-1);
      const item = this.db.studyPlanItems.find((entry) => entry.id === id);
      if (!item) return { meta: { changes: 0 } };
      const assignments = sql.match(/UPDATE study_plan_items SET (.+) WHERE id=/)[1].split(', ');
      assignments.forEach((assignment, index) => {
        const key = assignment.split('=')[0];
        item[key] = this.params[index];
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('DELETE FROM study_plan_items WHERE id=')) {
      const [id] = this.params;
      const before = this.db.studyPlanItems.length;
      this.db.studyPlanItems = this.db.studyPlanItems.filter((item) => item.id !== id);
      return { meta: { changes: before - this.db.studyPlanItems.length } };
    }
```

- [ ] **Step 2: Write failing Worker API tests**

Append this test to `tests/worker.test.mjs`:

```js
test('Worker study plan API manages plans items progress and reorder', async () => {
  const db = new FakeD1();

  const denied = await request(db, '/api/study-plans');
  assert.equal(denied.res.status, 401);

  const createdPlan = await authenticatedRequest(db, '/api/study-plans', {
    method: 'POST',
    body: JSON.stringify({ title: '李林高数辅导讲义' })
  });
  assert.equal(createdPlan.res.status, 201);
  assert.equal(createdPlan.body.title, '李林高数辅导讲义');
  assert.equal(createdPlan.body.progress_percent, 0);

  const first = await authenticatedRequest(db, `/api/study-plans/${createdPlan.body.id}/items`, {
    method: 'POST',
    body: JSON.stringify({ title: '函数、极限与连续' })
  });
  const second = await authenticatedRequest(db, `/api/study-plans/${createdPlan.body.id}/items`, {
    method: 'POST',
    body: JSON.stringify({ title: '导数与微分' })
  });
  assert.equal(first.res.status, 201);
  assert.equal(second.res.status, 201);

  const completed = await authenticatedRequest(db, `/api/study-plan-items/${first.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' })
  });
  assert.equal(completed.body.status, 'completed');
  assert.ok(completed.body.completed_at);

  const reordered = await authenticatedRequest(db, `/api/study-plans/${createdPlan.body.id}/items/reorder`, {
    method: 'POST',
    body: JSON.stringify({ item_ids: [second.body.id, first.body.id] })
  });
  assert.equal(reordered.res.status, 200);
  assert.deepEqual(reordered.body.items.map((item) => item.title), ['导数与微分', '函数、极限与连续']);

  const listed = await authenticatedRequest(db, '/api/study-plans');
  assert.equal(listed.body.plans[0].total_items, 2);
  assert.equal(listed.body.plans[0].completed_items, 1);
  assert.equal(listed.body.plans[0].progress_percent, 50);

  const renamed = await authenticatedRequest(db, `/api/study-plans/${createdPlan.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: '李林高数' })
  });
  assert.equal(renamed.body.title, '李林高数');

  const deletedItem = await authenticatedRequest(db, `/api/study-plan-items/${second.body.id}`, { method: 'DELETE' });
  assert.equal(deletedItem.body.ok, true);

  const deletedPlan = await authenticatedRequest(db, `/api/study-plans/${createdPlan.body.id}`, { method: 'DELETE' });
  assert.equal(deletedPlan.body.ok, true);
  const empty = await authenticatedRequest(db, '/api/study-plans');
  assert.deepEqual(empty.body.plans, []);
});
```

- [ ] **Step 3: Run Worker tests and verify they fail**

Run:

```bash
npm test -- tests/worker.test.mjs
```

Expected: FAIL with `Not found` for `/api/study-plans`.

- [ ] **Step 4: Add Worker validation and normalize helpers**

In `src/worker.js`, add this constant near existing status constants:

```js
const VALID_STUDY_ITEM_STATUS = new Set(['pending', 'completed']);
```

Add these helpers after `normalizeCountdown`:

```js
function normalizeStudyPlan(row, items = []) {
  const total_items = items.length;
  const completed_items = items.filter((item) => item.status === 'completed').length;
  return {
    ...row,
    items,
    total_items,
    completed_items,
    progress_percent: total_items ? Math.round((completed_items / total_items) * 100) : 0
  };
}

function normalizeStudyPlanItem(row) {
  return {
    ...row,
    status: row.status || 'pending',
    completed_at: row.completed_at ?? null
  };
}

function validateStudyPlanPayload(payload) {
  const title = String(payload.title || '').trim();
  if (!title) throw new HttpError('学习计划名称不能为空');
  return { title };
}

function validateStudyPlanItemPayload(payload, partial = false) {
  const updates = {};
  if ('title' in payload || !partial) {
    updates.title = String(payload.title || '').trim();
    if (!updates.title) throw new HttpError('章节名称不能为空');
  }
  if ('status' in payload) {
    updates.status = String(payload.status || '');
    if (!VALID_STUDY_ITEM_STATUS.has(updates.status)) throw new HttpError('章节状态必须是 pending/completed');
  }
  return updates;
}
```

- [ ] **Step 5: Add Worker study-plan functions**

In `src/worker.js`, add these functions after countdown functions:

```js
async function getStudyPlan(db, id) {
  const row = await db.prepare('SELECT * FROM study_plans WHERE id=?').bind(id).first();
  if (!row) throw new HttpError('学习计划不存在', 404);
  const { results = [] } = await db.prepare('SELECT * FROM study_plan_items WHERE plan_id=? ORDER BY position ASC, created_at ASC').bind(id).all();
  return normalizeStudyPlan(row, results.map(normalizeStudyPlanItem));
}

async function listStudyPlans(db) {
  const [{ results: plans = [] }, { results: items = [] }] = await Promise.all([
    db.prepare('SELECT * FROM study_plans ORDER BY created_at DESC, id DESC').all(),
    db.prepare('SELECT * FROM study_plan_items ORDER BY plan_id ASC, position ASC, created_at ASC').all()
  ]);
  const itemsByPlan = new Map();
  for (const item of items.map(normalizeStudyPlanItem)) {
    if (!itemsByPlan.has(item.plan_id)) itemsByPlan.set(item.plan_id, []);
    itemsByPlan.get(item.plan_id).push(item);
  }
  return { plans: plans.map((plan) => normalizeStudyPlan(plan, itemsByPlan.get(plan.id) || [])) };
}

async function createStudyPlan(db, payload) {
  const data = validateStudyPlanPayload(payload);
  const now = nowIso();
  const result = await db.prepare('INSERT INTO study_plans (title, created_at, updated_at) VALUES (?, ?, ?)').bind(data.title, now, now).run();
  return getStudyPlan(db, result.meta.last_row_id);
}

async function updateStudyPlan(db, id, payload) {
  const data = validateStudyPlanPayload(payload);
  const result = await db.prepare('UPDATE study_plans SET title=?, updated_at=? WHERE id=?').bind(data.title, nowIso(), id).run();
  if (!result.meta.changes) throw new HttpError('学习计划不存在', 404);
  return getStudyPlan(db, id);
}

async function deleteStudyPlan(db, id) {
  await db.prepare('DELETE FROM study_plan_items WHERE plan_id=?').bind(id).run();
  const result = await db.prepare('DELETE FROM study_plans WHERE id=?').bind(id).run();
  return { ok: result.meta.changes > 0 };
}

async function getStudyPlanItem(db, id) {
  const row = await db.prepare('SELECT * FROM study_plan_items WHERE id=?').bind(id).first();
  if (!row) throw new HttpError('章节不存在', 404);
  return normalizeStudyPlanItem(row);
}

async function createStudyPlanItem(db, planId, payload) {
  const data = validateStudyPlanItemPayload(payload);
  const exists = await db.prepare('SELECT 1 FROM study_plans WHERE id=?').bind(planId).first();
  if (!exists) throw new HttpError('学习计划不存在', 404);
  const positionRow = await db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM study_plan_items WHERE plan_id=?').bind(planId).first();
  const now = nowIso();
  const result = await db.prepare('INSERT INTO study_plan_items (plan_id, title, status, position, created_at, updated_at) VALUES (?, ?, \'pending\', ?, ?, ?)').bind(planId, data.title, positionRow.next_position, now, now).run();
  await db.prepare('UPDATE study_plans SET updated_at=? WHERE id=?').bind(now, planId).run();
  return getStudyPlanItem(db, result.meta.last_row_id);
}

async function updateStudyPlanItem(db, id, payload) {
  const updates = validateStudyPlanItemPayload(payload, true);
  const keys = Object.keys(updates);
  if (!keys.length) return getStudyPlanItem(db, id);
  updates.updated_at = nowIso();
  if (updates.status === 'completed') updates.completed_at = updates.updated_at;
  if (updates.status === 'pending') updates.completed_at = null;
  const assignments = Object.keys(updates).map((key) => `${key}=?`).join(', ');
  const result = await db.prepare(`UPDATE study_plan_items SET ${assignments} WHERE id=?`).bind(...Object.values(updates), id).run();
  if (!result.meta.changes) throw new HttpError('章节不存在', 404);
  return getStudyPlanItem(db, id);
}

async function deleteStudyPlanItem(db, id) {
  const result = await db.prepare('DELETE FROM study_plan_items WHERE id=?').bind(id).run();
  return { ok: result.meta.changes > 0 };
}

async function reorderStudyPlanItems(db, planId, payload) {
  const itemIds = Array.isArray(payload.item_ids) ? payload.item_ids.map(toId) : [];
  const plan = await getStudyPlan(db, planId);
  const existingIds = new Set(plan.items.map((item) => item.id));
  const requestedIds = new Set(itemIds);
  if (itemIds.length !== plan.items.length || existingIds.size !== requestedIds.size || !itemIds.every((id) => existingIds.has(id))) {
    throw new HttpError('章节排序数据不完整');
  }
  const now = nowIso();
  await Promise.all(itemIds.map((itemId, index) =>
    db.prepare('UPDATE study_plan_items SET position=?, updated_at=? WHERE id=?').bind(index + 1, now, itemId).run()
  ));
  await db.prepare('UPDATE study_plans SET updated_at=? WHERE id=?').bind(now, planId).run();
  return getStudyPlan(db, planId);
}
```

- [ ] **Step 6: Add Worker routes and exports**

In `handleApi`, before the final `throw new HttpError`, add:

```js
  if (parts[1] === 'study-plans') {
    if (method === 'GET' && parts.length === 2) return json(await listStudyPlans(env.DB));
    if (method === 'POST' && parts.length === 2) return json(await createStudyPlan(env.DB, await readJson(request)), 201);
    if (parts.length >= 3) {
      const id = toId(parts[2]);
      if (method === 'PATCH' && parts.length === 3) return json(await updateStudyPlan(env.DB, id, await readJson(request)));
      if (method === 'DELETE' && parts.length === 3) return json(await deleteStudyPlan(env.DB, id));
      if (method === 'POST' && parts.length === 4 && parts[3] === 'items') return json(await createStudyPlanItem(env.DB, id, await readJson(request)), 201);
      if (method === 'POST' && parts.length === 5 && parts[3] === 'items' && parts[4] === 'reorder') return json(await reorderStudyPlanItems(env.DB, id, await readJson(request)));
    }
  }

  if (parts[1] === 'study-plan-items' && parts.length === 3) {
    const id = toId(parts[2]);
    if (method === 'PATCH') return json(await updateStudyPlanItem(env.DB, id, await readJson(request)));
    if (method === 'DELETE') return json(await deleteStudyPlanItem(env.DB, id));
  }
```

In the export block, add:

```js
  createStudyPlan,
  createStudyPlanItem,
  listStudyPlans,
  reorderStudyPlanItems,
  validateStudyPlanItemPayload,
  validateStudyPlanPayload,
```

- [ ] **Step 7: Run Worker tests and verify they pass**

Run:

```bash
npm test -- tests/worker.test.mjs
```

Expected: all Worker tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/worker.js tests/worker.test.mjs
git commit -m "新增学习计划接口"
```

## Task 3: Static Page, Navigation, and Styles

**Files:**
- Create: `static/study.html`
- Modify: `static/index.html`
- Modify: `static/countdowns.html`
- Modify: `static/notes.html`
- Modify: `static/style.css`
- Test: `tests/frontend.test.mjs`

- [ ] **Step 1: Write failing frontend structure test**

Append this test to `tests/frontend.test.mjs`:

```js
test('office UI includes a study plans page', async () => {
  const [homeHtml, notesHtml, countdownHtml, studyHtml, style] = await Promise.all([
    readFile(new URL('../static/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/notes.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/countdowns.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/study.html', import.meta.url), 'utf8'),
    readFile(new URL('../static/style.css', import.meta.url), 'utf8')
  ]);

  for (const html of [homeHtml, notesHtml, countdownHtml, studyHtml]) {
    assert.match(html, /href="\/study\.html"/);
    assert.match(html, />学习计划</);
  }
  assert.match(studyHtml, /data-page="study"/);
  assert.match(studyHtml, /aria-current="page">学习计划</);
  assert.match(studyHtml, /id="studyPlanForm"/);
  assert.match(studyHtml, /id="studyPlanTitleInput"/);
  assert.match(studyHtml, /id="studyPlansList"/);
  assert.match(studyHtml, /id="studyPlansMeta"/);
  assert.match(studyHtml, /type="module"/);

  assert.match(style, /\.study-plan-card/);
  assert.match(style, /\.study-progress-bar/);
  assert.match(style, /\.study-item-row/);
  assert.match(style, /\.drag-handle/);
});
```

- [ ] **Step 2: Run frontend test and verify it fails**

Run:

```bash
npm test -- tests/frontend.test.mjs
```

Expected: FAIL with missing `static/study.html`.

- [ ] **Step 3: Add study navigation to existing pages**

In each top nav in `static/index.html`, `static/countdowns.html`, and `static/notes.html`, add:

```html
        <a href="/study.html">学习计划</a>
```

Keep the existing active link unchanged on each page.

- [ ] **Step 4: Create study page HTML**

Create `static/study.html`:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Puck Office 学习计划。" />
  <meta name="theme-color" content="#f4f0e8" />
  <title>Puck Office · 学习计划</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body data-page="study">
  <a class="skip-link" href="#content">跳到内容</a>
  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="/">Puck Office</a>
      <nav class="main-nav" aria-label="主导航">
        <a href="/">待办</a>
        <a href="/countdowns.html">倒数日</a>
        <a class="active" href="/study.html" aria-current="page">学习计划</a>
        <a href="/notes.html">笔记</a>
      </nav>
      <button id="logoutButton" class="logout-btn" type="button">退出</button>
    </div>
  </header>

  <main id="content" class="shell">
    <section class="page-head">
      <div>
        <p class="eyebrow">Study</p>
        <h1>学习计划</h1>
      </div>
    </section>

    <section class="panel composer">
      <div class="panel-head compact-head">
        <h2>新增计划</h2>
      </div>
      <form id="studyPlanForm" class="form-grid study-plan-form">
        <label class="field title-field">
          <span>计划名称</span>
          <input id="studyPlanTitleInput" type="text" maxlength="120" placeholder="李林高数辅导讲义" required />
        </label>
        <button class="primary-btn" type="submit">添加</button>
      </form>
    </section>

    <section class="panel list-panel study-panel">
      <div class="panel-head">
        <div>
          <h2>全部计划</h2>
          <p id="studyPlansMeta">Loading...</p>
        </div>
      </div>
      <div id="studyPlansList" class="study-plans-list"></div>
    </section>
  </main>

  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 5: Add study styles**

Append to `static/style.css` before the responsive media queries:

```css
.study-plan-form {
  grid-template-columns: minmax(220px, 1fr) 106px;
}

.study-plans-list {
  display: grid;
}

.study-plan-card {
  display: grid;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--line);
  background: rgba(255, 253, 248, 0.68);
}

.study-plan-card:last-child {
  border-bottom: 0;
}

.study-plan-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
}

.study-plan-title {
  margin: 0;
  color: var(--ink);
  font-size: 17px;
  line-height: 1.3;
  font-weight: 760;
}

.study-progress {
  display: grid;
  gap: 7px;
}

.study-progress-text {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.study-progress-track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(73, 65, 50, 0.1);
}

.study-progress-bar {
  display: block;
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width .18s ease;
}

.study-item-form {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 86px;
  gap: 10px;
}

.study-items {
  display: grid;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}

.study-item-row {
  display: grid;
  grid-template-columns: 28px 26px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  background: rgba(255, 254, 251, 0.74);
}

.study-item-row:last-child {
  border-bottom: 0;
}

.study-item-row.dragging {
  opacity: .52;
}

.drag-handle {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--muted);
  cursor: grab;
}

.drag-handle:active {
  cursor: grabbing;
}

.study-item-title {
  min-width: 0;
  margin: 0;
  color: var(--ink);
  font-size: 14px;
  font-weight: 680;
  line-height: 1.35;
}

.study-item-row.completed .study-item-title {
  color: var(--quiet);
  text-decoration: line-through;
  text-decoration-color: rgba(30, 31, 28, 0.28);
}

.study-item-actions {
  display: flex;
  gap: 5px;
  align-items: center;
}
```

- [ ] **Step 6: Run frontend structure test and verify it passes**

Run:

```bash
npm test -- tests/frontend.test.mjs
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add static/study.html static/index.html static/countdowns.html static/notes.html static/style.css tests/frontend.test.mjs
git commit -m "新增学习计划页面结构"
```

## Task 4: Frontend Study Interactions

**Files:**
- Modify: `static/app.js`
- Test: `tests/frontend.test.mjs`

- [ ] **Step 1: Write failing study interaction wiring test**

Append this test to `tests/frontend.test.mjs`:

```js
test('study plans page wires API progress and reorder interactions', async () => {
  const app = await readFile(new URL('../static/app.js', import.meta.url), 'utf8');

  assert.match(app, /import \{ escapeHtml, renderMarkdown \} from '\/markdown\.js'/);
  assert.match(app, /function\s+initStudyPage/);
  assert.match(app, /\/api\/study-plans/);
  assert.match(app, /\/api\/study-plan-items/);
  assert.match(app, /function\s+studyProgress/);
  assert.match(app, /study-progress-bar/);
  assert.match(app, /study-item-row/);
  assert.match(app, /dragstart/);
  assert.match(app, /drop/);
  assert.match(app, /reorderStudyItems/);
  assert.match(app, /data-study-action="move-up"/);
  assert.match(app, /data-study-action="move-down"/);
});
```

- [ ] **Step 2: Run frontend test and verify it fails**

Run:

```bash
npm test -- tests/frontend.test.mjs
```

Expected: FAIL because `initStudyPage` is missing.

- [ ] **Step 3: Update the markdown import**

At the top of `static/app.js`, replace the existing import with:

```js
import { escapeHtml, renderMarkdown } from '/markdown.js';
```

- [ ] **Step 4: Add the study page state and rendering code**

In `static/app.js`, before the final page initialization block, add:

```js
function studyProgress(plan) {
  const total = plan.total_items ?? plan.items?.length ?? 0;
  const completed = plan.completed_items ?? (plan.items || []).filter((item) => item.status === 'completed').length;
  return {
    total,
    completed,
    percent: total ? Math.round((completed / total) * 100) : 0
  };
}

function initStudyPage() {
  const state = { plans: [], busy: false, draggedItemId: null };
  const studyPlanForm = $('studyPlanForm');
  const studyPlanTitleInput = $('studyPlanTitleInput');
  const studyPlansMeta = $('studyPlansMeta');
  const studyPlansList = $('studyPlansList');

  function setStudyBusy(busy) {
    state.busy = busy;
    document.body.classList.toggle('study-locked', state.busy);
    for (const el of document.querySelectorAll('body[data-page="study"] button, body[data-page="study"] input')) {
      el.disabled = state.busy || el.dataset.orderBoundary === 'true';
    }
  }

  function findPlan(planId) {
    return state.plans.find((plan) => String(plan.id) === String(planId));
  }

  function findItem(itemId) {
    for (const plan of state.plans) {
      const item = (plan.items || []).find((entry) => String(entry.id) === String(itemId));
      if (item) return { plan, item };
    }
    return { plan: null, item: null };
  }

  function updatePlanProgress(plan) {
    const progress = studyProgress(plan);
    plan.total_items = progress.total;
    plan.completed_items = progress.completed;
    plan.progress_percent = progress.percent;
  }

  function replacePlan(plan) {
    state.plans = state.plans.map((item) => String(item.id) === String(plan.id) ? plan : item);
  }

  function renderStudyPlans() {
    studyPlansMeta.textContent = `${state.plans.length} 个计划`;
    if (!state.plans.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '暂无学习计划。';
      studyPlansList.replaceChildren(empty);
      setStudyBusy(state.busy);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const plan of state.plans) {
      const progress = studyProgress(plan);
      const card = document.createElement('article');
      card.className = 'study-plan-card';
      card.dataset.planId = String(plan.id);

      const head = document.createElement('div');
      head.className = 'study-plan-head';
      const titleWrap = document.createElement('div');
      const title = document.createElement('h2');
      title.className = 'study-plan-title';
      title.textContent = plan.title;
      const progressWrap = document.createElement('div');
      progressWrap.className = 'study-progress';
      const progressText = document.createElement('p');
      progressText.className = 'study-progress-text';
      progressText.textContent = `${progress.completed}/${progress.total} · ${progress.percent}%`;
      const progressTrack = document.createElement('div');
      progressTrack.className = 'study-progress-track';
      const progressBar = document.createElement('span');
      progressBar.className = 'study-progress-bar';
      progressBar.style.width = `${progress.percent}%`;
      progressTrack.appendChild(progressBar);
      progressWrap.append(progressText, progressTrack);
      titleWrap.append(title, progressWrap);

      const planActions = document.createElement('div');
      planActions.className = 'actions';
      planActions.innerHTML = `
        <button class="icon-btn" type="button" data-study-action="edit-plan">编辑</button>
        <button class="icon-btn danger" type="button" data-study-action="delete-plan">删除</button>
      `;
      head.append(titleWrap, planActions);

      const itemForm = document.createElement('form');
      itemForm.className = 'study-item-form';
      itemForm.dataset.studyAction = 'add-item';
      itemForm.innerHTML = `
        <label class="field">
          <span>章节</span>
          <input name="title" type="text" maxlength="120" placeholder="函数、极限与连续" required />
        </label>
        <button class="ghost-action" type="submit">添加</button>
      `;

      const items = document.createElement('div');
      items.className = 'study-items';
      if (!plan.items?.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '暂无章节。';
        items.appendChild(empty);
      } else {
        plan.items.forEach((item, index) => {
          const row = document.createElement('div');
          row.className = `study-item-row ${item.status === 'completed' ? 'completed' : ''}`;
          row.draggable = true;
          row.dataset.itemId = String(item.id);
          row.innerHTML = `
            <button class="drag-handle" type="button" title="拖拽排序" aria-label="拖拽排序">⋮⋮</button>
            <button class="check ${item.status === 'completed' ? 'done' : ''}" type="button" data-study-action="toggle-item" aria-label="切换完成：${item.title}"></button>
            <p class="study-item-title">${escapeHtml(item.title)}</p>
            <div class="study-item-actions">
              <button class="icon-btn" type="button" data-study-action="move-up" ${index === 0 ? 'disabled data-order-boundary="true"' : ''}>上移</button>
              <button class="icon-btn" type="button" data-study-action="move-down" ${index === plan.items.length - 1 ? 'disabled data-order-boundary="true"' : ''}>下移</button>
              <button class="icon-btn" type="button" data-study-action="edit-item">编辑</button>
              <button class="icon-btn danger" type="button" data-study-action="delete-item">删除</button>
            </div>
          `;
          items.appendChild(row);
        });
      }

      card.append(head, itemForm, items);
      fragment.appendChild(card);
    }
    studyPlansList.replaceChildren(fragment);
    setStudyBusy(state.busy);
  }

  async function loadStudyPlans() {
    const data = await request('/api/study-plans');
    state.plans = data.plans || [];
    renderStudyPlans();
  }

  async function reorderStudyItems(plan, itemIds) {
    const previous = [...plan.items];
    plan.items = itemIds.map((id) => previous.find((item) => String(item.id) === String(id)));
    updatePlanProgress(plan);
    renderStudyPlans();
    try {
      const saved = await request(`/api/study-plans/${plan.id}/items/reorder`, {
        method: 'POST',
        body: JSON.stringify({ item_ids: itemIds.map(Number) })
      });
      replacePlan(saved);
      renderStudyPlans();
    } catch (err) {
      plan.items = previous;
      updatePlanProgress(plan);
      renderStudyPlans();
      toast(err.message);
    }
  }

  studyPlanForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const title = studyPlanTitleInput.value;
    setStudyBusy(true);
    try {
      const plan = await request('/api/study-plans', { method: 'POST', body: JSON.stringify({ title }) });
      state.plans = [plan, ...state.plans];
      studyPlanTitleInput.value = '';
      renderStudyPlans();
      toast('已添加');
    } catch (err) {
      toast(err.message);
    } finally {
      setStudyBusy(false);
    }
  });

  studyPlansList.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-study-action="add-item"]');
    if (!form) return;
    event.preventDefault();
    const card = form.closest('[data-plan-id]');
    const plan = findPlan(card.dataset.planId);
    const input = form.elements.title;
    try {
      const item = await request(`/api/study-plans/${plan.id}/items`, { method: 'POST', body: JSON.stringify({ title: input.value }) });
      plan.items = [...(plan.items || []), item];
      updatePlanProgress(plan);
      input.value = '';
      renderStudyPlans();
      toast('已添加章节');
    } catch (err) {
      toast(err.message);
    }
  });

  studyPlansList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-study-action]');
    if (!button || state.busy) return;
    const card = button.closest('[data-plan-id]');
    const plan = card ? findPlan(card.dataset.planId) : null;
    const row = button.closest('[data-item-id]');
    const action = button.dataset.studyAction;

    if (action === 'edit-plan') {
      const title = prompt('计划名称', plan.title);
      if (!title) return;
      const saved = await request(`/api/study-plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
      replacePlan(saved);
      renderStudyPlans();
    }
    if (action === 'delete-plan') {
      if (!confirm(`删除学习计划「${plan.title}」及其全部章节？`)) return;
      await request(`/api/study-plans/${plan.id}`, { method: 'DELETE' });
      state.plans = state.plans.filter((item) => String(item.id) !== String(plan.id));
      renderStudyPlans();
      toast('已删除');
    }
    if (row && action === 'toggle-item') {
      const { item } = findItem(row.dataset.itemId);
      const status = item.status === 'completed' ? 'pending' : 'completed';
      const saved = await request(`/api/study-plan-items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      Object.assign(item, saved);
      updatePlanProgress(plan);
      renderStudyPlans();
    }
    if (row && action === 'edit-item') {
      const { item } = findItem(row.dataset.itemId);
      const title = prompt('章节名称', item.title);
      if (!title) return;
      const saved = await request(`/api/study-plan-items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
      Object.assign(item, saved);
      renderStudyPlans();
    }
    if (row && action === 'delete-item') {
      const { item } = findItem(row.dataset.itemId);
      if (!confirm(`删除章节「${item.title}」？`)) return;
      await request(`/api/study-plan-items/${item.id}`, { method: 'DELETE' });
      plan.items = plan.items.filter((entry) => String(entry.id) !== String(item.id));
      updatePlanProgress(plan);
      renderStudyPlans();
    }
    if (row && (action === 'move-up' || action === 'move-down')) {
      const index = plan.items.findIndex((item) => String(item.id) === row.dataset.itemId);
      const targetIndex = action === 'move-up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= plan.items.length) return;
      const next = [...plan.items];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      await reorderStudyItems(plan, next.map((item) => item.id));
    }
  });

  studyPlansList.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.study-item-row');
    if (!row) return;
    state.draggedItemId = row.dataset.itemId;
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
  });

  studyPlansList.addEventListener('dragend', (event) => {
    event.target.closest('.study-item-row')?.classList.remove('dragging');
    state.draggedItemId = null;
  });

  studyPlansList.addEventListener('dragover', (event) => {
    if (!state.draggedItemId) return;
    if (event.target.closest('.study-item-row')) event.preventDefault();
  });

  studyPlansList.addEventListener('drop', async (event) => {
    const targetRow = event.target.closest('.study-item-row');
    if (!targetRow || !state.draggedItemId || targetRow.dataset.itemId === state.draggedItemId) return;
    event.preventDefault();
    const card = targetRow.closest('[data-plan-id]');
    const plan = findPlan(card.dataset.planId);
    const ids = plan.items.map((item) => String(item.id));
    const from = ids.indexOf(state.draggedItemId);
    const to = ids.indexOf(targetRow.dataset.itemId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await reorderStudyItems(plan, ids);
  });

  loadStudyPlans().catch(err => toast(err.message));
}
```

- [ ] **Step 5: Wire the study page initializer**

At the bottom of `static/app.js`, add:

```js
if (page === 'study') {
  initLogoutButton();
  initStudyPage();
}
```

- [ ] **Step 6: Run frontend tests and syntax check**

Run:

```bash
npm test -- tests/frontend.test.mjs
node --check static/app.js
```

Expected: frontend tests and syntax check pass.

- [ ] **Step 7: Commit**

```bash
git add static/app.js tests/frontend.test.mjs
git commit -m "实现学习计划前端交互"
```

## Task 5: README and Deployment Test Coverage

**Files:**
- Modify: `README.md`
- Modify: `tests/deploy-config.test.mjs`

- [ ] **Step 1: Add deploy-config migration assertions**

In `tests/deploy-config.test.mjs`, replace the existing `Promise.all` destructuring with:

```js
  const [wrangler, workflow, migration, countdownMigration, countdownFrequencyMigration, performanceMigration, studyMigration, ciPrepare] = await Promise.all([
    readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0003_countdowns.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0004_countdown_frequency.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0005_performance_indexes.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0006_study_plans.sql', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/prepare-ci-wrangler-config.mjs', import.meta.url), 'utf8')
  ]);
```

Then add these assertions near the migration assertions:

```js
  assert.match(performanceMigration, /idx_todos_status_due_at/);
  assert.match(studyMigration, /CREATE TABLE IF NOT EXISTS study_plans/);
  assert.match(studyMigration, /CREATE TABLE IF NOT EXISTS study_plan_items/);
  assert.match(studyMigration, /idx_study_plan_items_plan_position/);
  assert.match(studyMigration, /idx_study_plan_items_plan_status/);
```

- [ ] **Step 2: Run deployment test**

Run:

```bash
npm test -- tests/deploy-config.test.mjs
```

Expected: deployment test passes after Task 1 migration exists.

- [ ] **Step 3: Update README API list**

In `README.md`, add these API endpoints after the countdown or notes endpoints:

```text
GET    /api/study-plans
POST   /api/study-plans
PATCH  /api/study-plans/{id}
DELETE /api/study-plans/{id}
POST   /api/study-plans/{id}/items
POST   /api/study-plans/{id}/items/reorder
PATCH  /api/study-plan-items/{id}
DELETE /api/study-plan-items/{id}
```

Also update the opening description to include 学习计划:

```markdown
轻量个人办公站：Cloudflare Workers + D1 + 原生 HTML/CSS/JS。当前功能包括月度待办、倒数日、学习计划、独立笔记、Markdown 实时预览。
```

- [ ] **Step 4: Run deployment test**

Run:

```bash
npm test -- tests/deploy-config.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add README.md tests/deploy-config.test.mjs
git commit -m "补充学习计划文档和迁移测试"
```

## Task 6: Full Verification

**Files:**
- No new files. Verify the complete branch.

- [ ] **Step 1: Run all Node tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run all Python tests with Python 3.11**

Run:

```bash
python3.11 -m unittest discover -s tests
```

Expected: all tests pass. Do not use system `python` or `python3`; this repo needs Python 3.11 because system Python is 3.6.

- [ ] **Step 3: Run syntax checks**

Run:

```bash
node --check static/app.js
node --check src/worker.js
python3.11 -m py_compile app.py remind.py
```

Expected: all commands exit 0 with no syntax errors.

- [ ] **Step 4: Check git diff**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` exits 0. `git status --short` shows only intended changes if any remain uncommitted.

- [ ] **Step 5: Final commit if any verification-only edits were needed**

If `git status --short` is not empty, commit the remaining intentional fixes:

```bash
git add README.md app.py src/worker.js static/app.js static/style.css static/study.html static/index.html static/countdowns.html static/notes.html tests/test_todo_core.py tests/worker.test.mjs tests/frontend.test.mjs tests/deploy-config.test.mjs migrations/0006_study_plans.sql
git commit -m "完善学习计划功能"
```

Expected: working tree clean after commit.

## Self-Review

- Spec coverage: data model, CRUD APIs, progress calculation, drag/drop sorting, up/down sorting, page structure, deletion confirmation, and verification commands are covered by Tasks 1-6.
- Placeholder scan: no unfinished placeholder markers or unspecified "handle later" work remains in this plan.
- Type consistency: API names use `study-plans` for plan routes and `study-plan-items` for item routes; persisted item order uses `item_ids`; status values are `pending` and `completed` across Worker, Python, and frontend.
