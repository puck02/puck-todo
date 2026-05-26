import unittest
from pathlib import Path


class TodoEditUiTests(unittest.TestCase):
    def test_static_app_js_includes_edit_action(self):
        app_js = Path(__file__).resolve().parents[1] / 'static' / 'app.js'
        text = app_js.read_text(encoding='utf-8')
        self.assertIn('编辑', text)
        self.assertIn("method: 'PATCH'", text)
        self.assertIn('/api/todos/${item.id}', text)


if __name__ == '__main__':
    unittest.main()
