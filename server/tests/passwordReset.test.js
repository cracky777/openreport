// "Forgot password": the mailed link sets a new password once, and the answer
// never tells whether an address has an account. The mailer is replaced, so
// the test reads the link it would have sent. The limiter allows five calls
// per IP for the whole file (it is created once, when routes/auth.js loads).
jest.mock('../utils/mailer', () => ({
  isConfigured: () => true,
  publicUrl: () => 'https://reports.example.com',
  sendMail: jest.fn(() => Promise.resolve(true)),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const mailer = require('../utils/mailer');
const { buildRealAuthApp } = require('./helpers/realAuthApp');
const { db } = require('./helpers/testApp');

const app = buildRealAuthApp();
const settle = () => new Promise((r) => setImmediate(r));

test('a mailed link sets a new password once, whatever the case of the address typed', async () => {
  const id = uuid();
  const email = `reset-${Math.random().toString(36).slice(2, 9)}@test.local`;
  db.prepare('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)')
    .run(id, email, bcrypt.hashSync('old password!', 4), 'Test', 'viewer');

  const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@test.local' });
  const known = await request(app).post('/api/auth/forgot-password').send({ email: ` ${email.toUpperCase()} ` });
  await settle();
  expect(unknown.status).toBe(200);
  expect(known.body).toEqual(unknown.body);
  expect(mailer.sendMail).toHaveBeenCalledTimes(1);

  const { to, text } = mailer.sendMail.mock.calls[0][0];
  expect(to).toBe(email);
  const token = decodeURIComponent(text.match(/https:\/\/reports\.example\.com\/reset-password\?token=(\S+)/)[1]);
  const stored = db.prepare('SELECT token_hash FROM password_resets WHERE user_id = ?').get(id);
  expect(stored.token_hash).not.toBe(token);

  expect((await request(app).post('/api/auth/reset-password').send({ token: 'forged', password: 'brand new password' })).status).toBe(400);
  expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'brand new password' })).status).toBe(200);
  // Spent: the same link can't be used again.
  expect(require('../utils/passwordReset').consume(token)).toBeNull();

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id);
  expect(bcrypt.compareSync('brand new password', row.password_hash)).toBe(true);
  expect(db.prepare('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND used_at IS NULL').get(id).n).toBe(0);
});
