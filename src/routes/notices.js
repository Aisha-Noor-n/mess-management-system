const express = require('express');
const db = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');

const router = express.Router();

// All authenticated users can read notices
router.get('/', authenticate, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT notice_id, title, body, posted_at, posted_by_name
       FROM notices ORDER BY posted_at DESC LIMIT 20`
    );
    return res.json(result.rows);
  } catch (error) { return next(error); }
});

// Admin only: post notice
router.post('/', authenticate, allowRoles('admin'), async (req, res, next) => {
  try {
    const { title, body } = req.body;
    if (!title || !body)
      return res.status(400).json({ message: 'Title and body are required.' });

    const result = await db.query(
      `INSERT INTO notices (title, body, posted_by_name) VALUES ($1, $2, $3) RETURNING *`,
      [title, body, req.user.name]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) { return next(error); }
});

// Admin only: delete notice
router.delete('/:id', authenticate, allowRoles('admin'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM notices WHERE notice_id = $1', [req.params.id]);
    return res.json({ message: 'Notice deleted.' });
  } catch (error) { return next(error); }
});

module.exports = router;