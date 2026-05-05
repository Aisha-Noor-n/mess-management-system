const express = require('express');
const db = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');

const router = express.Router();

// Admin & worker: view all attendance records
router.get('/', authenticate, allowRoles('admin', 'worker'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT a.attendance_id, a.status, a.marked_at, a.remarks,
              s.roll_no, u.name AS student_name, m.meal_date, m.meal_type
       FROM attendance a
       JOIN students s ON s.student_id = a.student_id
       JOIN users u ON u.user_id = s.user_id
       JOIN meals m ON m.meal_id = a.meal_id
       ORDER BY m.meal_date DESC, m.meal_type, u.name`
    );
    return res.json(result.rows);
  } catch (error) { return next(error); }
});

// Student: view own attendance
router.get('/mine', authenticate, allowRoles('student'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT a.attendance_id, a.status, a.marked_at, a.remarks, m.meal_id, m.meal_date, m.meal_type
       FROM attendance a
       JOIN meals m ON m.meal_id = a.meal_id
       JOIN students s ON s.student_id = a.student_id
       WHERE s.user_id = $1
       ORDER BY m.meal_date DESC, m.meal_type`,
      [req.user.id]
    );
    return res.json(result.rows);
  } catch (error) { return next(error); }
});

// Student ONLY: mark own IN/OUT with meal timing enforcement
router.post('/mark', authenticate, allowRoles('student'), async (req, res, next) => {
  try {
    const { mealId, status, remarks } = req.body;
    if (!mealId || !['IN', 'OUT'].includes(status))
      return res.status(400).json({ message: 'Meal and IN/OUT status are required.' });

    const mealCheck = await db.query('SELECT meal_type, meal_date FROM meals WHERE meal_id = $1', [mealId]);
    if (!mealCheck.rows[0]) return res.status(404).json({ message: 'Meal not found.' });

    const { meal_type, meal_date } = mealCheck.rows[0];
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const mealDateStr = new Date(meal_date).toISOString().slice(0, 10);

    if (mealDateStr !== todayStr)
      return res.status(403).json({ message: "You can only mark attendance for today's meals." });

    const timeInMinutes = today.getHours() * 60 + today.getMinutes();
    if (meal_type === 'breakfast' && (timeInMinutes < 420 || timeInMinutes > 540))
      return res.status(403).json({ message: 'Breakfast attendance can only be marked between 7:00 AM and 9:00 AM.' });
    if ((meal_type === 'lunch' || meal_type === 'dinner') && timeInMinutes > 720)
      return res.status(403).json({ message: `${meal_type.charAt(0).toUpperCase() + meal_type.slice(1)} attendance can only be marked before 12:00 PM.` });

    const studentResult = await db.query('SELECT student_id FROM students WHERE user_id = $1', [req.user.id]);
    const student = studentResult.rows[0];
    if (!student) return res.status(404).json({ message: 'Student profile was not found.' });

    const result = await db.query(
      `INSERT INTO attendance (student_id, meal_id, status, remarks)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (student_id, meal_id)
       DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, marked_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [student.student_id, mealId, status, remarks || null]
    );
    return res.json(result.rows[0]);
  } catch (error) { return next(error); }
});

// Admin: mark attendance for any student (no time restriction)
router.post('/admin-mark', authenticate, allowRoles('admin'), async (req, res, next) => {
  try {
    const { studentId, mealId, status, remarks } = req.body;
    if (!studentId || !mealId || !['IN', 'OUT'].includes(status))
      return res.status(400).json({ message: 'Student, meal, and status are required.' });

    const result = await db.query(
      `INSERT INTO attendance (student_id, meal_id, status, remarks)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (student_id, meal_id)
       DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, marked_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [studentId, mealId, status, remarks || null]
    );
    return res.json(result.rows[0]);
  } catch (error) { return next(error); }
});

// Admin & worker: live headcount
router.get('/live', authenticate, allowRoles('admin', 'worker'), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT u.name AS student_name, s.roll_no, s.room_no, m.meal_type, a.marked_at
       FROM attendance a
       JOIN students s ON s.student_id = a.student_id
       JOIN users u ON u.user_id = s.user_id
       JOIN meals m ON m.meal_id = a.meal_id
       WHERE a.status = 'IN' AND m.meal_date = CURRENT_DATE
       ORDER BY m.meal_type, u.name`
    );
    return res.json(result.rows);
  } catch (error) { return next(error); }
});

module.exports = router;
