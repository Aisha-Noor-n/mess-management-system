const express = require('express');
const db = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, allowRoles('admin'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT f.feedback_id, f.message, f.rating, f.status, f.submitted_at, f.admin_reply,
              s.roll_no, u.name AS student_name
       FROM feedback f
       JOIN students s ON s.student_id = f.student_id
       JOIN users u ON u.user_id = s.user_id
       ORDER BY f.submitted_at DESC`
    );
    return res.json(result.rows);
  } catch (error) { return next(error); }
});

router.post('/', authenticate, allowRoles('student'), async (req, res, next) => {
  try {
    const { message, rating } = req.body;
    if (!message || !rating)
      return res.status(400).json({ message: 'Feedback message and rating are required.' });

    const studentResult = await db.query('SELECT student_id FROM students WHERE user_id = $1', [req.user.id]);
    const result = await db.query(
      `INSERT INTO feedback (student_id, message, rating) VALUES ($1, $2, $3) RETURNING *`,
      [studentResult.rows[0].student_id, message, rating]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) { return next(error); }
});

router.patch('/:id/status', authenticate, allowRoles('admin'), async (req, res, next) => {
  try {
    const { status, adminReply } = req.body;
    const result = await db.query(
      `UPDATE feedback SET status = $1, admin_reply = COALESCE($2, admin_reply)
       WHERE feedback_id = $3 RETURNING *`,
      [status, adminReply || null, req.params.id]
    );
    return res.json(result.rows[0]);
  } catch (error) { return next(error); }
});

module.exports = router;