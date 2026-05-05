const express = require('express');
const db = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');

const router = express.Router();

// All roles: view bills (students see only theirs)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const params = [];
    let where = '';
    if (req.user.role === 'student') {
      params.push(req.user.id);
      where = 'WHERE s.user_id = $1';
    }
    const result = await db.query(
      `SELECT b.bill_id, b.bill_month, b.bill_year, b.meal_count, b.total_amount, b.status,
              s.roll_no, u.name AS student_name,
              COALESCE(SUM(p.amount), 0) AS paid_amount
       FROM bills b
       JOIN students s ON s.student_id = b.student_id
       JOIN users u ON u.user_id = s.user_id
       LEFT JOIN payments p ON p.bill_id = b.bill_id
       ${where}
       GROUP BY b.bill_id, s.roll_no, u.name
       ORDER BY b.bill_year DESC, b.bill_month DESC, u.name`,
      params
    );
    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

// Admin: generate bills for a month
router.post('/generate', authenticate, allowRoles('admin'), async (req, res, next) => {
  try {
    const month = Number(req.body.month);
    const year  = Number(req.body.year);
    if (!month || !year || month < 1 || month > 12) {
      return res.status(400).json({ message: 'Valid month and year are required.' });
    }
    const result = await db.query(
      `INSERT INTO bills (student_id, bill_month, bill_year, meal_count, total_amount, status)
       SELECT s.student_id, $1, $2,
              COUNT(m.meal_id)::int,
              COALESCE(SUM(m.cost_per_student), 0)::numeric(10,2),
              'unpaid'
       FROM students s
       LEFT JOIN attendance a ON a.student_id = s.student_id
       LEFT JOIN meals m ON m.meal_id = a.meal_id
            AND EXTRACT(MONTH FROM m.meal_date) = $1
            AND EXTRACT(YEAR  FROM m.meal_date) = $2
            AND a.status = 'IN'
       GROUP BY s.student_id
       ON CONFLICT (student_id, bill_month, bill_year)
       DO UPDATE SET meal_count   = EXCLUDED.meal_count,
                     total_amount = EXCLUDED.total_amount,
                     generated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [month, year]
    );
    return res.status(201).json({ generated: result.rowCount, bills: result.rows });
  } catch (error) {
    return next(error);
  }
});

// Admin: record a verified payment
router.post('/:id/payments', authenticate, allowRoles('admin'), async (req, res, next) => {
  try {
    const { amount, method, referenceNo } = req.body;
    await db.query(
      `INSERT INTO payments (bill_id, amount, method, reference_no)
       VALUES ($1, $2, $3, $4)`,
      [req.params.id, amount, method || 'cash', referenceNo || null]
    );
    await db.query(
      `UPDATE bills
       SET status = CASE
         WHEN paid.total_paid >= bills.total_amount THEN 'paid'
         WHEN paid.total_paid > 0                   THEN 'partial'
         ELSE 'unpaid'
       END
       FROM (SELECT bill_id, COALESCE(SUM(amount),0) AS total_paid
             FROM payments WHERE bill_id = $1 GROUP BY bill_id) paid
       WHERE bills.bill_id = paid.bill_id`,
      [req.params.id]
    );
    return res.status(201).json({ message: 'Payment recorded.' });
  } catch (error) {
    return next(error);
  }
});

// Student: self-pay — submit payment proof; admin verifies and it auto-posts
router.post('/:id/self-pay', authenticate, allowRoles('student'), async (req, res, next) => {
  try {
    const { amount, method, referenceNo } = req.body;

    if (!amount || !method) {
      return res.status(400).json({ message: 'Amount and payment method are required.' });
    }

    // Verify the bill belongs to this student
    const check = await db.query(
      `SELECT b.bill_id, b.total_amount, b.status
       FROM bills b
       JOIN students s ON s.student_id = b.student_id
       WHERE b.bill_id = $1 AND s.user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (!check.rows.length) {
      return res.status(403).json({ message: 'Bill not found or does not belong to you.' });
    }

    const bill = check.rows[0];
    if (bill.status === 'paid') {
      return res.status(400).json({ message: 'This bill is already fully paid.' });
    }

    // Insert the payment
    await db.query(
      `INSERT INTO payments (bill_id, amount, method, reference_no)
       VALUES ($1, $2, $3, $4)`,
      [req.params.id, amount, method, referenceNo || null]
    );

    // Update bill status
    await db.query(
      `UPDATE bills
       SET status = CASE
         WHEN paid.total_paid >= bills.total_amount THEN 'paid'
         WHEN paid.total_paid > 0                   THEN 'partial'
         ELSE 'unpaid'
       END
       FROM (SELECT bill_id, COALESCE(SUM(amount),0) AS total_paid
             FROM payments WHERE bill_id = $1 GROUP BY bill_id) paid
       WHERE bills.bill_id = paid.bill_id`,
      [req.params.id]
    );

    return res.status(201).json({ message: 'Payment submitted successfully.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
