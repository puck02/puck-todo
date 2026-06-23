# Countdown Frequency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the countdown page to support one-time, monthly recurring, and anniversary events.

**Architecture:** Keep the existing `countdowns` resource and add recurrence fields to the same D1 table. The Worker validates and stores event metadata, while the frontend computes human-readable day counts from stored fields using local calendar days.

**Tech Stack:** Vanilla HTML/CSS/JS, Cloudflare Worker, D1 migrations, Python local mirror, Node test runner, Python unittest.

---

### Task 1: Tests

**Files:**
- Modify: `tests/worker.test.mjs`
- Modify: `tests/frontend.test.mjs`
- Modify: `tests/test_todo_core.py`
- Modify: `tests/deploy-config.test.mjs`

- [ ] Add failing tests for monthly and anniversary countdown payloads.
- [ ] Add failing tests for frontend controls and status helper output.
- [ ] Add failing tests for Python local countdown storage.
- [ ] Run targeted tests and confirm failure is due to missing frequency support.

### Task 2: Data and API

**Files:**
- Create: `migrations/0004_countdown_frequency.sql`
- Modify: `src/worker.js`
- Modify: `app.py`

- [ ] Add D1 columns for `event_type`, `repeat_month`, and `repeat_day`.
- [ ] Validate three event types in Worker and Python storage.
- [ ] Normalize old rows as `once`.
- [ ] Return recurrence fields from list and create APIs.

### Task 3: Frontend

**Files:**
- Modify: `static/countdowns.html`
- Modify: `static/app.js`
- Modify: `static/style.css`

- [ ] Add type selector and conditional inputs.
- [ ] Compute monthly next occurrence and anniversary next occurrence on the client.
- [ ] Render primary and secondary status text on countdown cards.
- [ ] Keep optimistic add, delete animation, and operation lockout behavior.

### Task 4: Verification and Delivery

**Files:**
- All modified files.

- [ ] Run `npm test`.
- [ ] Run `python3.11 -m unittest discover -s tests`.
- [ ] Run syntax and diff checks.
- [ ] Run Wrangler dry-run.
- [ ] Commit with a concise Chinese message and push.
