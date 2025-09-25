const express = require('express');
const pool = require('../config/db');
const { getRedis } = require('../config/redis');
const { publish } = require('../config/rabbitmq');

const router = express.Router();

async function ensureBookingTables() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS eventify_bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL,
      user_id UUID NOT NULL,
      seats INT NOT NULL CHECK (seats > 0),
      status TEXT NOT NULL CHECK (status IN ('confirmed','waiting','cancelled')),
      waiting_number INT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
    // per-seat table (idempotent)
    await pool.query(`
    CREATE TABLE IF NOT EXISTS eventify_booking_seats (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL,
      booking_id UUID,
      user_id UUID,
      seat_no INT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('booked','cancelled')) DEFAULT 'booked',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        await ensureBookingTables();
        const { event_id, user_id, seats, seat_numbers, idempotency_key } = req.body || {};
        const redis = getRedis();

        // Idempotency: if key provided, ensure single processing per (event,user,key)
        let idempoKey = null;
        if (idempotency_key) {
            idempoKey = `booking:idempo:${event_id}:${user_id}:${idempotency_key}`;
            const setOk = await redis.set(idempoKey, '1', 'NX', 'EX', 60);
            if (setOk !== 'OK') {
                // Already processed or in-flight
                return res.status(409).json({ error: 'duplicate_request' });
            }
        }

        await client.query('BEGIN');

        // atomic slots decrement using Redis
        const remaining = await redis.decrby(`event:${event_id}:slots`, seats);

        let status = 'confirmed';
        let waiting_number = null;
        if (remaining < 0) {
            // revert overshoot
            await redis.incrby(`event:${event_id}:slots`, seats);
            status = 'waiting';
            waiting_number = await redis.rpush(`event:${event_id}:waitlist`, user_id);
        }

        const { rows } = await client.query(
            `INSERT INTO eventify_bookings(event_id, user_id, seats, status, waiting_number)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
            [event_id, user_id, seats, status, waiting_number]
        );

        // keep eventify_events.available_slots in sync and allocate seat numbers for confirmed eventify_bookings
        if (status === 'confirmed') {
            const takenRes = await client.query("SELECT seat_no FROM eventify_booking_seats WHERE event_id=$1 AND status='booked' ORDER BY seat_no", [event_id]);
            const taken = new Set(takenRes.rows.map(r => Number(r.seat_no)));
            let seatNos = [];
            if (Array.isArray(seat_numbers) && seat_numbers.length === seats) {
                // use desired seats if all are free
                for (const s of seat_numbers.map(Number)) {
                    if (s <= 0 || taken.has(s)) { seatNos = []; break; }
                    seatNos.push(s);
                }
            }
            if (seatNos.length !== seats) {
                // fallback: auto-assign lowest available
                seatNos = [];
                let seat = 1;
                while (seatNos.length < seats) {
                    if (!taken.has(seat)) seatNos.push(seat);
                    seat++;
                }
            }
            for (const s of seatNos) {
                await client.query("INSERT INTO eventify_booking_seats(event_id, booking_id, user_id, seat_no, status) VALUES($1,$2,$3,$4,'booked')", [event_id, rows[0].id, user_id, s]);
                // best-effort: clear any existing hold
                try { await redis.del(`seat:hold:${event_id}:${s}`); await redis.srem(`event:${event_id}:holds`, s); } catch {}
            }
            await client.query('UPDATE eventify_events SET available_slots = GREATEST(available_slots - $1, 0), updated_at = NOW() WHERE id=$2', [seats, event_id]);
            // broadcast seat:booked to room
            try {
                const io = req.app.get('io');
                if (io) {
                    for (const s of seatNos) {
                        io.to(`event:${event_id}`).emit('seat:booked', { eventId: event_id, seatNo: s });
                    }
                }
            } catch {}
        }

        await client.query('COMMIT');

        // notify asynchronously
        try {
            await publish('notifications', {
                type: status === 'confirmed' ? 'booking_confirmed' : 'booking_waitlisted',
                eventId: event_id,
                userId: user_id,
                seats,
            });
        } catch { }

        res.status(201).json(rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// GET /eventify_bookings/user/:userId - list eventify_bookings for a user (with event details)
router.get('/user/:userId', async (req, res) => {
    try {
        await ensureBookingTables();
        const userId = req.params.userId;
        const { rows } = await pool.query(
            `SELECT b.id as booking_id, b.event_id, b.user_id, b.seats, b.status, b.waiting_number, b.created_at, b.updated_at,
                    e.name as event_name, e.description as event_description, e.category, e.event_date, e.total_slots, e.available_slots, e.org_id
             FROM eventify_bookings b
             JOIN eventify_events e ON e.id = b.event_id
             WHERE b.user_id = $1
             ORDER BY b.created_at DESC`,
            [userId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/:id/cancel', async (req, res) => {
    const client = await pool.connect();
    try {
        const bookingId = req.params.id;
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM eventify_bookings WHERE id=$1 FOR UPDATE', [bookingId]);
        const booking = rows[0];
        if (!booking) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Not found' });
        }
        if (booking.status === 'cancelled') {
            await client.query('ROLLBACK');
            return res.json(booking);
        }

        await client.query("UPDATE eventify_bookings SET status='cancelled', updated_at=NOW() WHERE id=$1", [bookingId]);

        // free seats for this booking
        const freedRes = await client.query("UPDATE eventify_booking_seats SET status='cancelled' WHERE booking_id=$1 AND status='booked' RETURNING seat_no", [bookingId]);
        const freedCount = freedRes.rowCount || 0;

        const redis = getRedis();
        if (freedCount > 0) {
            await redis.incrby(`event:${booking.event_id}:slots`, freedCount);
            await client.query('UPDATE eventify_events SET available_slots = available_slots + $1, updated_at = NOW() WHERE id=$2', [freedCount, booking.event_id]);
            // broadcast freed seats
            try { const io = req.app.get('io'); if (io) { for (const r of freedRes.rows) { io.to(`event:${booking.event_id}`).emit('seat:freed', { eventId: booking.event_id, seatNo: Number(r.seat_no) }); } } } catch {}

            // promote from waitlist for each freed seat
            for (let i = 0; i < freedCount; i++) {
                const nextUserId = await redis.lpop(`event:${booking.event_id}:waitlist`);
                if (!nextUserId) break;

                const { rows: promotedRows } = await client.query(
                    `UPDATE eventify_bookings SET status='confirmed', waiting_number=NULL, updated_at=NOW()
                     WHERE id = (
                        SELECT id FROM eventify_bookings WHERE event_id=$1 AND user_id=$2 AND status='waiting' ORDER BY created_at ASC LIMIT 1
                     ) RETURNING id`,
                    [booking.event_id, nextUserId]
                );

                if (promotedRows[0]) {
                    // allocate one seat number to this promoted booking
                    const takenRes = await client.query("SELECT seat_no FROM eventify_booking_seats WHERE event_id=$1 AND status='booked' ORDER BY seat_no", [booking.event_id]);
                    const taken = new Set(takenRes.rows.map(r => Number(r.seat_no)));
                    let seat = 1;
                    while (taken.has(seat)) seat++;
                    await client.query("INSERT INTO eventify_booking_seats(event_id, booking_id, user_id, seat_no, status) VALUES($1,$2,$3,$4,'booked')", [booking.event_id, promotedRows[0].id, nextUserId, seat]);
                    await client.query('UPDATE eventify_events SET available_slots = GREATEST(available_slots - 1, 0), updated_at = NOW() WHERE id=$1', [booking.event_id]);
                    try { const io = req.app.get('io'); if (io) { io.to(`event:${booking.event_id}`).emit('seat:booked', { eventId: booking.event_id, seatNo: seat }); } } catch {}
                    try { await publish('notifications', { type: 'waitlist_promoted', eventId: booking.event_id, userId: nextUserId }); } catch { }
                } else {
                    // nobody to promote; push seat back to availability handled above
                    break;
                }
            }
        }

        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;

// Additional endpoints
// GET seats for a booking
router.get('/:id/seats', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // read existing seats
        let result = await client.query("SELECT seat_no, status FROM eventify_booking_seats WHERE booking_id=$1 ORDER BY seat_no", [req.params.id]);
        if (result.rows.length === 0) {
            // Backfill for legacy eventify_bookings: allocate seats now if booking is confirmed
            const { rows: bRows } = await client.query('SELECT * FROM eventify_bookings WHERE id=$1 FOR UPDATE', [req.params.id]);
            const booking = bRows[0];
            if (booking && booking.status === 'confirmed' && Number(booking.seats) > 0) {
                const takenRes = await client.query("SELECT seat_no FROM eventify_booking_seats WHERE event_id=$1 AND status='booked' ORDER BY seat_no", [booking.event_id]);
                const taken = new Set(takenRes.rows.map(r => Number(r.seat_no)));
                const seatNos = [];
                let seat = 1;
                while (seatNos.length < Number(booking.seats)) {
                    if (!taken.has(seat)) seatNos.push(seat);
                    seat++;
                }
                for (const s of seatNos) {
                    await client.query("INSERT INTO eventify_booking_seats(event_id, booking_id, user_id, seat_no, status) VALUES($1,$2,$3,$4,'booked')", [booking.event_id, booking.id, booking.user_id, s]);
                }
                result = await client.query("SELECT seat_no, status FROM eventify_booking_seats WHERE booking_id=$1 ORDER BY seat_no", [req.params.id]);
            }
        }
        await client.query('COMMIT');
        res.json(result.rows);
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Cancel specific seats for a booking
router.post('/:id/cancel-seats', async (req, res) => {
    const client = await pool.connect();
    try {
        const bookingId = req.params.id;
        const { seat_numbers } = req.body || {};
        if (!Array.isArray(seat_numbers) || seat_numbers.length === 0) return res.status(400).json({ error: 'seat_numbers required' });
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM eventify_bookings WHERE id=$1 FOR UPDATE', [bookingId]);
        const booking = rows[0];
        if (!booking) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }

        const seatRes = await client.query("UPDATE eventify_booking_seats SET status='cancelled' WHERE booking_id=$1 AND seat_no = ANY($2) AND status='booked' RETURNING seat_no", [bookingId, seat_numbers]);
        const cancelledCount = seatRes.rowCount || 0;
        if (cancelledCount === 0) { await client.query('ROLLBACK'); return res.json({ ok: true, cancelled: 0 }); }

        await client.query('UPDATE eventify_events SET available_slots = available_slots + $1, updated_at = NOW() WHERE id=$2', [cancelledCount, booking.event_id]);
        // broadcast freed seats
        try { const io = req.app.get('io'); if (io) { for (const r of seatRes.rows) { io.to(`event:${booking.event_id}`).emit('seat:freed', { eventId: booking.event_id, seatNo: Number(r.seat_no) }); } } } catch {}

        const redis = getRedis();
        for (let i = 0; i < cancelledCount; i++) {
            const nextUserId = await redis.lpop(`event:${booking.event_id}:waitlist`);
            if (!nextUserId) break;
            const { rows: promotedRows } = await client.query(
                `UPDATE eventify_bookings SET status='confirmed', waiting_number=NULL, updated_at=NOW()
                 WHERE id = (
                    SELECT id FROM eventify_bookings WHERE event_id=$1 AND user_id=$2 AND status='waiting' ORDER BY created_at ASC LIMIT 1
                 ) RETURNING id`,
                [booking.event_id, nextUserId]
            );
            if (promotedRows[0]) {
                const takenRes = await client.query("SELECT seat_no FROM eventify_booking_seats WHERE event_id=$1 AND status='booked' ORDER BY seat_no", [booking.event_id]);
                const taken = new Set(takenRes.rows.map(r => Number(r.seat_no)));
                let seat = 1;
                while (taken.has(seat)) seat++;
                await client.query("INSERT INTO eventify_booking_seats(event_id, booking_id, user_id, seat_no, status) VALUES($1,$2,$3,$4,'booked')", [booking.event_id, promotedRows[0].id, nextUserId, seat]);
                await client.query('UPDATE eventify_events SET available_slots = GREATEST(available_slots - 1, 0), updated_at = NOW() WHERE id=$1', [booking.event_id]);
                try { const io = req.app.get('io'); if (io) { io.to(`event:${booking.event_id}`).emit('seat:booked', { eventId: booking.event_id, seatNo: seat }); } } catch {}
            }
        }

        await client.query('COMMIT');
        res.json({ ok: true, cancelled: cancelledCount });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});


