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

        // FCFS: Atomic capacity check with waitlist placement
        const eventRes = await client.query('SELECT available_slots, total_slots FROM eventify_events WHERE id=$1 FOR UPDATE', [event_id]);
        if (!eventRes.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Event not found' });
        }
        const currentAvailable = eventRes.rows[0].available_slots;
        const totalSlots = eventRes.rows[0].total_slots;

        let status = 'confirmed';
        let waiting_number = null;
        let waitlist_position = null;

        // FCFS Logic: If enough seats available, confirm immediately
        if (currentAvailable >= seats) {
            status = 'confirmed';
        } else {
            // Place on waitlist in FCFS order
            status = 'waiting';
            waiting_number = await redis.rpush(`event:${event_id}:waitlist`, user_id);
            waitlist_position = waiting_number;
        }

        const { rows } = await client.query(
            `INSERT INTO eventify_bookings(event_id, user_id, seats, status, waiting_number)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
            [event_id, user_id, seats, status, waiting_number]
        );

        // Initialize allocated array for response
        let allocated = [];

        // FCFS Seat Allocation: Honor preferred seats when free, otherwise auto-assign
        if (status === 'confirmed') {
            // Get currently taken seats
            const takenRes = await client.query("SELECT seat_no FROM eventify_booking_seats WHERE event_id=$1 AND status='booked' ORDER BY seat_no", [event_id]);
            const taken = new Set(takenRes.rows.map(r => Number(r.seat_no)));
            let desired = [];
            
            // Preferred seats logic: Honor if all requested seats are free
            if (Array.isArray(seat_numbers) && seat_numbers.length === seats) {
                const nums = seat_numbers.map(Number);
                // Check if any requested seats are already taken
                const occupiedSeats = nums.filter(n => n > 0 && taken.has(n));
                if (occupiedSeats.length > 0) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({ 
                        error: 'Seat conflict', 
                        message: `Seat(s) ${occupiedSeats.join(', ')} are already booked. Please select other seats.`,
                        occupiedSeats 
                    });
                }
                // If all preferred seats are free, use them
                if (nums.every(n => n > 0 && !taken.has(n))) {
                    desired = nums;
                }
            }

            const allocateNextAvailable = async () => {
                // recompute taken each time to avoid race conditions
                const tRes = await client.query("SELECT seat_no FROM eventify_booking_seats WHERE event_id=$1 AND status='booked' ORDER BY seat_no", [event_id]);
                const tSet = new Set(tRes.rows.map(r => Number(r.seat_no)));
                let seat = 1;
                while (tSet.has(seat)) seat++;
                return seat;
            };

            while (allocated.length < seats) {
                const candidate = desired.length > 0 ? desired.shift() : await allocateNextAvailable();
                try {
                    await client.query(
                        "INSERT INTO eventify_booking_seats(event_id, booking_id, user_id, seat_no, status) VALUES($1,$2,$3,$4,'booked')",
                        [event_id, rows[0].id, user_id, candidate]
                    );
                    allocated.push(candidate);
                    // best-effort: clear any existing hold
                    try { await redis.del(`seat:hold:${event_id}:${candidate}`); await redis.srem(`event:${event_id}:holds`, candidate); } catch {}
                } catch (e) {
                    // Unique violation -> seat got booked concurrently. Retry with next available
                    if (e && e.code === '23505') {
                        // skip and retry loop without incrementing allocated count
                        desired = desired.filter(n => n !== candidate);
                        continue;
                    }
                    throw e;
                }
            }

            await client.query('UPDATE eventify_events SET available_slots = GREATEST(available_slots - $1, 0), updated_at = NOW() WHERE id=$2', [allocated.length, event_id]);
            // broadcast seat:booked to room
            try {
                const io = req.app.get('io');
                if (io) {
                    for (const s of allocated) {
                        io.to(`event:${event_id}`).emit('seat:booked', { eventId: event_id, seatNo: s });
                    }
                    // Also broadcast availability update
                    io.to(`event:${event_id}`).emit('event:availability:updated', { 
                        eventId: event_id, 
                        availableSlots: currentAvailable - allocated.length 
                    });
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

        // Return booking with status-specific information
        const response = { ...rows[0] };
        if (status === 'confirmed' && allocated.length > 0) {
            response.allocatedSeats = allocated;
            response.message = 'Booking confirmed! Your seats have been reserved.';
        } else if (status === 'waiting') {
            response.waitlistPosition = waitlist_position;
            response.message = `Added to waitlist at position ${waitlist_position}. You'll be notified if seats become available.`;
        }
        res.status(201).json(response);
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
             WHERE b.user_id = $1 AND b.status != 'cancelled'
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

// GET /bookings/waitlist/:eventId/:userId - Get user's waitlist position
router.get('/waitlist/:eventId/:userId', async (req, res) => {
    try {
        const { eventId, userId } = req.params;
        const redis = getRedis();
        
        // Get waitlist from Redis
        const waitlist = await redis.lrange(`event:${eventId}:waitlist`, 0, -1);
        const position = waitlist.indexOf(userId) + 1; // 1-based position
        
        if (position === 0) {
            return res.status(404).json({ error: 'User not found on waitlist' });
        }
        
        res.json({
            eventId,
            userId,
            position,
            totalOnWaitlist: waitlist.length,
            estimatedWaitTime: position > 1 ? `${position - 1} people ahead` : 'Next in line'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
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


