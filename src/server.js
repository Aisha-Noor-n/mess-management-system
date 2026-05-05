const path = require('path');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config();

const db = require('./db');
const authRoutes       = require('./routes/auth');
const studentRoutes    = require('./routes/students');
const workerRoutes     = require('./routes/workers');
const mealRoutes       = require('./routes/meals');
const attendanceRoutes = require('./routes/attendance');
const feedbackRoutes   = require('./routes/feedback');
const billRoutes       = require('./routes/bills');
const reportRoutes     = require('./routes/reports');
const noticeRoutes     = require('./routes/notices');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth',       authRoutes);
app.use('/api/students',   studentRoutes);
app.use('/api/workers',    workerRoutes);
app.use('/api/meals',      mealRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/feedback',   feedbackRoutes);
app.use('/api/bills',      billRoutes);
app.use('/api/reports',    reportRoutes);
app.use('/api/notices',    noticeRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use((req, res) => res.status(404).json({ message: 'Route not found.' }));
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ message: 'Something went wrong.', detail: error.message });
});

// ── Auto-generate bills on 1st of every month at 00:05 ──────────────────────
cron.schedule('5 0 1 * *', async () => {
  try {
    const now = new Date();
    // Bill for the previous month
    let month = now.getMonth(); // 0-based, so this is last month
    let year  = now.getFullYear();
    if (month === 0) { month = 12; year -= 1; }

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
                     generated_at = CURRENT_TIMESTAMP`,
      [month, year]
    );
    console.log(`[cron] Auto-generated bills for ${month}/${year}: ${result.rowCount} bills`);
  } catch (err) {
    console.error('[cron] Bill generation failed:', err.message);
  }
});

app.listen(port, () => {
  console.log(`Mess In/Out Management System running at http://localhost:${port}`);
});