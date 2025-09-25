const express = require('express');
const pool = require('../config/db');
const router = express.Router();

async function ensureNotificationsTable() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS eventify_notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      event_id UUID,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

router.get('/user/:userId', async (req, res) => {
    try {
        await ensureNotificationsTable();
        const { rows } = await pool.query(
            'SELECT * FROM eventify_notifications WHERE user_id=$1 ORDER BY created_at DESC',
            [req.params.userId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;


