const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');
const authHooks = require('../hooks/auth');

const router = express.Router();

// List all users
router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, display_name, role, created_at FROM users ORDER BY created_at ASC').all();
  res.json({ users });
});

// Update user role
router.put('/users/:id/role', requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be admin, editor, or viewer' });
  }
  // Prevent removing the last admin
  if (role !== 'admin') {
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
    if (target?.role === 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get();
      if (adminCount.c <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last admin' });
      }
    }
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ message: 'Role updated' });
});

// Create user (admin only)
router.post('/users', requireAdmin, async (req, res) => {
  const { email, password, displayName, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  const userRole = ['admin', 'editor', 'viewer'].includes(role) ? role : 'viewer';

  db.prepare('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)').run(
    id, email, passwordHash, displayName || email.split('@')[0], userRole
  );

  // Same post-register hooks as /api/auth/register: in cloud mode this provisions
  // a personal org for the new user. The hook receives the creator's `req` so
  // the cloud's session-based active-org logic doesn't accidentally swap onto
  // the new user's org for the admin who triggered the creation.
  const newUser = { id, email, display_name: displayName || email.split('@')[0], role: userRole };
  await authHooks.runPostRegister({ user: newUser, req: { session: null, user: req.user } });

  res.status(201).json({ user: newUser });
});

// Delete user
router.delete('/users/:id', requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ message: 'User deleted' });
});

// Reset user password
router.put('/users/:id/password', requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password too short' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ message: 'Password reset' });
});

module.exports = router;
