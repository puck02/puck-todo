import hashlib
import os
import unittest
from unittest.mock import patch

import app


class AuthCoreTests(unittest.TestCase):
    def test_password_hash_and_session_cookie_round_trip(self):
        salt = b'test-salt'
        iterations = 10000
        expected = hashlib.pbkdf2_hmac('sha256', b'correct-password', salt, iterations, dklen=32)
        password_hash = 'pbkdf2_sha256${}${}${}'.format(
            iterations,
            app.b64url_encode(salt),
            app.b64url_encode(expected),
        )

        with patch.dict(os.environ, {
            'ADMIN_EMAIL': 'admin@example.com',
            'ADMIN_PASSWORD_HASH': password_hash,
            'AUTH_SECRET': 'test-auth-secret',
        }, clear=False):
            self.assertTrue(app.verify_password('correct-password', password_hash))
            self.assertFalse(app.verify_password('wrong-password', password_hash))

            cookie = app.create_session_cookie('admin@example.com', 'test-auth-secret')
            cookie_value = cookie.split(';', 1)[0].split('=', 1)[1]
            user = app.session_user('{}={}'.format(app.SESSION_COOKIE, cookie_value))
            self.assertEqual(user['email'], 'admin@example.com')


if __name__ == '__main__':
    unittest.main()
