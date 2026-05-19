import os
import tempfile
import unittest
from datetime import datetime, timedelta

from app import TodoStore


class TodoCoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp.name, "todos.db")
        self.store = TodoStore(self.db_path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_create_and_list_todos_grouped_by_status_for_month(self):
        first = self.store.create_todo("准备 AI 应用岗面试", "high", "2026-05-12T09:30:00")
        self.store.complete_todo(first["id"])
        self.store.create_todo("投递美团外包资料", "urgent", "2026-05-13T18:00:00")
        self.store.create_todo("下个月事项", "medium", "2026-06-01T10:00:00")

        month = self.store.list_month("2026-05")
        self.assertEqual([item["title"] for item in month["pending"]], ["投递美团外包资料"])
        self.assertEqual([item["title"] for item in month["completed"]], ["准备 AI 应用岗面试"])

    def test_todo_note_is_saved_and_returned_in_month_list(self):
        note = "面试资料：https://example.com/meituan\n记得问双休和社保基数"
        self.store.create_todo("美团面试准备", "high", "2026-05-12T20:00:00", note=note)

        month = self.store.list_month("2026-05")

        self.assertEqual(month["pending"][0]["note"], note)

    def test_daily_reminder_returns_today_and_low_frequency_future_important(self):
        now = datetime(2026, 5, 11, 8, 30)
        today_due = now.replace(hour=20, minute=0)
        future_due = now + timedelta(days=2)
        self.store.create_todo("今晚复习 FastAPI", "medium", today_due.isoformat())
        self.store.create_todo("重要终面", "urgent", future_due.isoformat())
        self.store.create_todo("普通未来事项", "medium", future_due.isoformat())

        data = self.store.daily_reminders(now)
        self.assertEqual([item["title"] for item in data["today"]], ["今晚复习 FastAPI"])
        self.assertEqual([item["title"] for item in data["future_important"]], ["重要终面"])

        data_again = self.store.daily_reminders(now + timedelta(hours=1))
        self.assertEqual(data_again["future_important"], [])

    def test_due_soon_reminder_only_once_for_pending_items(self):
        now = datetime(2026, 5, 11, 14, 30)
        self.store.create_todo("30分钟后截止", "high", (now + timedelta(minutes=25)).isoformat())
        self.store.create_todo("太远的事项", "high", (now + timedelta(hours=2)).isoformat())

        first = self.store.due_soon_reminders(now, 30)
        self.assertEqual([item["title"] for item in first["items"]], ["30分钟后截止"])

        second = self.store.due_soon_reminders(now + timedelta(minutes=1), 30)
        self.assertEqual(second["items"], [])


if __name__ == "__main__":
    unittest.main()
