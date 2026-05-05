const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Student self-registration
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, rollNo, department, roomNo, phone } = req.body;
    if (!name || !email || !password || !rollNo || !department || !roomNo)
      return res.status(400).json({ message: 'Name, email, password, roll number, department and room number are required.' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    // Check email uniqueness
    const existing = await db.query('SELECT user_id FROM users WHERE email = $1', [email]);
    if (existing.rows.length)
      return res.status(409).json({ message: 'An account with this email already exists.' });

    // Check roll number uniqueness
    const existingRoll = await db.query('SELECT student_id FROM students WHERE roll_no = $1', [rollNo]);
    if (existingRoll.rows.length)
      return res.status(409).json({ message: 'A student with this roll number already exists.' });

    const userResult = await db.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'student') RETURNING user_id, name, email, role`,
      [name, email, password]
    );
    const studentResult = await db.query(
      `INSERT INTO students (user_id, roll_no, department, room_no, phone) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userResult.rows[0].user_id, rollNo, department, roomNo, phone || null]
    );

    return res.status(201).json({ message: 'Account created successfully. You can now sign in.' });
  } catch (error) { return next(error); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

    const result = await db.query(
      `SELECT user_id, name, email, password_hash, role, is_active FROM users WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user || !user.is_active || user.password_hash !== password)
      return res.status(401).json({ message: 'Invalid login details.' });

    const token = jwt.sign(
      { id: user.user_id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '8h' }
    );
    return res.json({ token, user: { id: user.user_id, name: user.name, email: user.email, role: user.role } });
  } catch (error) { return next(error); }
});

// Change password (any authenticated user)
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Current and new password are required.' });
    if (newPassword.length < 6)
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });

    const result = await db.query('SELECT password_hash FROM users WHERE user_id = $1', [req.user.id]);
    if (!result.rows[0] || result.rows[0].password_hash !== currentPassword)
      return res.status(401).json({ message: 'Current password is incorrect.' });

    await db.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [newPassword, req.user.id]);
    return res.json({ message: 'Password updated successfully.' });
  } catch (error) { return next(error); }
});

module.exports = router;
