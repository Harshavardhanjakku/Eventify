const express = require('express');
const pool = require('../config/db');
const { getRedis } = require('../config/redis');

const router = express.Router();

async function ensureEventsTables() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS eventify_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT CHECK (category IN ('webinar','concert','hackathon')),
      event_date TIMESTAMP NOT NULL,
      total_slots INT NOT NULL CHECK (total_slots >= 0),
      available_slots INT NOT NULL CHECK (available_slots >= 0),
      status TEXT CHECK (status IN ('upcoming','ongoing','completed','cancelled')) DEFAULT 'upcoming',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

router.post('/', async (req, res) => {
    try {
        await ensureEventsTables();
        const { org_id, name, description, category, event_date, total_slots } = req.body || {};
        const { rows } = await pool.query(
            `INSERT INTO eventify_events(org_id, name, description, category, event_date, total_slots, available_slots)
       VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
            [org_id || null, name, description || null, category || null, event_date, total_slots]
        );

        // initialize Redis slots counter
        try {
            const redis = getRedis();
            await redis.set(`event:${rows[0].id}:slots`, total_slots);
        } catch { }

        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM eventify_events ORDER BY event_date DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM eventify_events WHERE id=$1', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'Not found' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Seat map for an event: returns { total, taken: [seat_no,...], held: [seat_no,...] }
router.get('/:id/seats', async (req, res) => {
    try {
        const eventId = req.params.id;
        const { rows: evRows } = await pool.query('SELECT id, total_slots FROM eventify_events WHERE id=$1', [eventId]);
        if (!evRows[0]) return res.status(404).json({ error: 'Not found' });
        const total = Number(evRows[0].total_slots);

        const { rows } = await pool.query("SELECT seat_no FROM eventify_booking_seats WHERE event_id=$1 AND status='booked' ORDER BY seat_no", [eventId]);
        const taken = rows.map(r => Number(r.seat_no));

        // read currently held seats from Redis ephemeral set
        let held = [];
        try {
            const redis = getRedis();
            const setKey = `event:${eventId}:holds`;
            const exists = await redis.exists(setKey);
            if (exists) {
                const members = await redis.smembers(setKey);
                held = members.map(v => Number(v));
            }
        } catch { /* best-effort only */ }

        res.json({ total, taken, held });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { name, description, category, event_date, total_slots } = req.body || {};
        const eventId = req.params.id;

        // Update basic fields including total_slots if provided
        const { rows: updatedRows } = await pool.query(
            `UPDATE eventify_events SET 
        name = COALESCE($2,name),
        description = COALESCE($3,description),
        category = COALESCE($4,category),
        event_date = COALESCE($5,event_date),
        total_slots = COALESCE($6,total_slots),
        updated_at = NOW()
       WHERE id=$1 RETURNING *`,
            [eventId, name, description, category, event_date, total_slots]
        );

        if (!updatedRows[0]) return res.status(404).json({ error: 'Not found' });

        let event = updatedRows[0];
        // If total_slots changed, recompute available_slots = max(total_slots - booked_count, 0)
        if (typeof total_slots === 'number') {
            const { rows: bookedCountRows } = await pool.query(
                `SELECT COUNT(*)::int AS booked_count 
                 FROM eventify_booking_seats 
                 WHERE event_id=$1 AND status='booked'`,
                [eventId]
            );
            const bookedCount = Number(bookedCountRows?.[0]?.booked_count || 0);
            const newAvailable = Math.max(0, Number(total_slots) - bookedCount);
            const { rows: afterAvail } = await pool.query(
                `UPDATE eventify_events SET available_slots=$2, updated_at=NOW() WHERE id=$1 RETURNING *`,
                [eventId, newAvailable]
            );
            event = afterAvail[0] || event;

            // Mirror Redis visible counter to DB available_slots
            try {
                const redis = getRedis();
                await redis.set(`event:${eventId}:slots`, String(newAvailable));
            } catch { /* non-fatal */ }
        }

        res.json(event);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM eventify_events WHERE id=$1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'Not found' });
        try {
            const redis = getRedis();
            await redis.del(`event:${req.params.id}:slots`);
        } catch { }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;


