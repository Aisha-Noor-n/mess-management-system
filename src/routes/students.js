const express = require('express');
const db = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, allowRoles('admin', 'worker'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT s.student_id, s.roll_no, u.name, u.email, s.department, s.room_no, s.phone, s.joined_on
       FROM students s
       JOIN users u ON u.user_id = s.user_id
       ORDER BY s.student_id`
    );
    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

router.get('/me', authenticate, allowRoles('student'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT s.student_id, s.roll_no, u.name, u.email, s.department, s.room_no, s.phone, s.joined_on
       FROM students s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.user_id = $1`,
      [req.user.id]
    );
    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.post('/', authenticate, allowRoles('admin'), async (req, res, next) => {
  const client = db;
  try {
    const { name, email, password, rollNo, department, roomNo, phone } = req.body;

    if (!name || !email || !password || !rollNo || !department || !roomNo) {
      return res.status(400).json({ message: 'Missing required student information.' });
    }

    const userResult = await client.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'student')
       RETURNING user_id, name, email, role`,
      [name, email, password]
    );

    const studentResult = await client.query(
      `INSERT INTO students (user_id, roll_no, department, room_no, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userResult.rows[0].user_id, rollNo, department, roomNo, phone || null]
    );

    return res.status(201).json({ user: userResult.rows[0], student: studentResult.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put('/me', authenticate, allowRoles('student'), async (req, res, next) => {
  try {
    const { name, phone, roomNo } = req.body;
    if (!name || !roomNo)
      return res.status(400).json({ message: 'Name and room number are required.' });

    await db.query('UPDATE users SET name = $1 WHERE user_id = $2', [name, req.user.id]);
    await db.query('UPDATE students SET phone = $1, room_no = $2 WHERE user_id = $3', [phone || null, roomNo, req.user.id]);

    const result = await db.query(
      `SELECT s.student_id, s.roll_no, u.name, u.email, s.department, s.room_no, s.phone, s.joined_on
       FROM students s JOIN users u ON u.user_id = s.user_id WHERE s.user_id = $1`,
      [req.user.id]
    );
    return res.json(result.rows[0]);
  } catch (error) { return next(error); }
});

router.delete('/:id', authenticate, allowRoles('admin'), async (req, res, next) => {
  try {
    const result = await db.query(
      `DELETE FROM users
       WHERE user_id = (SELECT user_id FROM students WHERE student_id = $1)
       RETURNING user_id`,
      [req.params.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Student was not found.' });
    }

    return res.json({ message: 'Student deleted.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;;
