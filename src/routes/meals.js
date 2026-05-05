const express = require('express');
const db = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT meal_id, meal_date, meal_type, planned_count, cost_per_student
       FROM meals ORDER BY meal_date DESC, meal_type`
    );
    return res.json(result.rows);
  } catch (error) { return next(error); }
});

router.post('/', authenticate, allowRoles('admin', 'worker'), async (req, res, next) => {
  try {
    const { mealDate, mealType, plannedCount, costPerStudent } = req.body;
    if (!mealDate || !mealType)
      return res.status(400).json({ message: 'Meal date and type are required.' });

    const result = await db.query(
      `INSERT INTO meals (meal_date, meal_type, planned_count, cost_per_student)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [mealDate, mealType, plannedCount || 0, costPerStudent || 0]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) { return next(error); }
});

// Auto-schedule today's 3 meals in one click
router.post('/auto-schedule', authenticate, allowRoles('admin', 'worker'), async (req, res, next) => {
  try {
    const { plannedCount, costPerStudent, date } = req.body;
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const types = ['breakfast', 'lunch', 'dinner'];
    const results = [];

    for (const type of types) {
      const r = await db.query(
        `INSERT INTO meals (meal_date, meal_type, planned_count, cost_per_student)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (meal_date, meal_type) DO NOTHING
         RETURNING *`,
        [targetDate, type, plannedCount || 50, costPerStudent || 100]
      );
      if (r.rows[0]) results.push(r.rows[0]);
    }
    return res.status(201).json({ scheduled: results.length, meals: results });
  } catch (error) { return next(error); }
});

module.exports = router;
