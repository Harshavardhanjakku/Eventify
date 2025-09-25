const express = require('express');
const http = require('http');
const cors = require('cors');
const session = require('express-session');
require('dotenv').config();

// MongoDB removed

// MinIO removed for Eventify (no file storage)

const pool = require('./config/db'); // PostgreSQL for user/media metadata
const { initKeycloak, memoryStore } = require('./middleware/keycloak');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001"],
    methods: ["GET", "POST"]
  }
});
const { getRedis } = require('./config/redis');

// Yjs WebSocket removed

// index.js
app.set('io', io);
app.use(cors());
app.use(express.json());
app.use(session({
  secret: 'someSecret',
  resave: false,
  saveUninitialized: true,
  store: memoryStore
}));

// Initialize Keycloak
const keycloak = initKeycloak();
app.use(keycloak.middleware());

// Ensure database schema exists on startup
async function ensureSchema() {
  try {
    const schemaPath = path.join(__dirname, 'sql', 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    console.log('🗄️  Database schema initialized.');
  } catch (err) {
    console.warn('⚠️  Failed to initialize schema (continuing):', err.message);
  }
}

// Import routes
const usersRoutes = require('./routes/users');
// Media routes removed (no file storage)
const eventsRoutes = require('./routes/events');
const bookingsRoutes = require('./routes/bookings');
const notificationsRoutes = require('./routes/notifications');

const orgInvitesRoutes = require('./routes/orgInvites');
const organizationsRoutes = require('./routes/organizations');



app.use('/users', usersRoutes);
app.use('/events', eventsRoutes);
app.use('/bookings', bookingsRoutes);
app.use('/notifications', notificationsRoutes);

app.use('/uploads', express.static('uploads'));
app.use('/org-invites', orgInvitesRoutes);
app.use('/organizations', organizationsRoutes);



// Socket.IO logic
io.on('connection', (socket) => {
  console.log('🔗 User connected:', socket.id);

  // Event-related placeholders (extend later if needed)

  // Helper keys
  const heldSeatsSetKey = (eventId) => `event:${eventId}:holds`; // Set of seat numbers currently held
  const seatHoldKey = (eventId, seatNo) => `seat:hold:${eventId}:${seatNo}`; // Per-seat hold key
  const socketHoldsKey = (sid) => `sock:${sid}:holds`; // Set of holds owned by socket ("eventId:seatNo")

  // Join an event room and emit current held seats snapshot
  socket.on('seats:join', async ({ eventId }) => {
    try {
      if (!eventId) return;
      socket.join(`event:${eventId}`);
      const redis = getRedis();
      const exists = await redis.exists(heldSeatsSetKey(eventId));
      let held = [];
      if (exists) {
        const members = await redis.smembers(heldSeatsSetKey(eventId));
        // filter out expired holds by checking if per-seat key exists
        const results = await Promise.all(members.map(async (m) => {
          const ttl = await redis.ttl(seatHoldKey(eventId, m));
          if (ttl > 0) return Number(m);
          // prune stale member
          await redis.srem(heldSeatsSetKey(eventId), m);
          return null;
        }));
        held = results.filter((x) => x !== null);
      }
      io.to(socket.id).emit('seats:snapshot', { eventId, held });
    } catch (e) {
      console.error('seats:join error', e.message);
    }
  });

  // Explicit snapshot request (used for periodic reconciliation on clients)
  socket.on('seats:snapshot:request', async ({ eventId }) => {
    try {
      if (!eventId) return;
      const redis = getRedis();
      const exists = await redis.exists(heldSeatsSetKey(eventId));
      let held = [];
      if (exists) {
        const members = await redis.smembers(heldSeatsSetKey(eventId));
        const results = await Promise.all(members.map(async (m) => {
          const ttl = await redis.ttl(seatHoldKey(eventId, m));
          if (ttl > 0) return Number(m);
          await redis.srem(heldSeatsSetKey(eventId), m);
          return null;
        }));
        held = results.filter((x) => x !== null);
      }
      io.to(socket.id).emit('seats:snapshot', { eventId, held });
    } catch (e) {
      console.error('seats:snapshot:request error', e.message);
    }
  });

  // Try to hold a seat for a short time window (e.g., 10s) using Redis NX + EX
  socket.on('seat:hold', async ({ eventId, seatNo, ttlSec = 10 }, cb) => {
    try {
      if (!eventId || !seatNo) return cb?.({ ok: false, error: 'invalid_params' });
      const redis = getRedis();
      const key = seatHoldKey(eventId, seatNo);
      // SET key socketId NX EX ttl
      // enforce a strict max 10s TTL (no keepalive)
      const ttl = Math.min(10, Math.max(1, Number(ttlSec) || 10));
      const result = await redis.set(key, socket.id, 'NX', 'EX', ttl);
      if (result !== 'OK') {
        return cb?.({ ok: false, error: 'already_held' });
      }
      await redis.sadd(heldSeatsSetKey(eventId), seatNo);
      await redis.sadd(socketHoldsKey(socket.id), `${eventId}:${seatNo}`);
      // Broadcast to room that this seat is now held
      io.to(`event:${eventId}`).emit('seat:held', { eventId, seatNo });
      return cb?.({ ok: true, ttl });
    } catch (e) {
      console.error('seat:hold error', e.message);
      return cb?.({ ok: false, error: 'server_error' });
    }
  });

  // Release a held seat (only if owned by this socket)
  socket.on('seat:release', async ({ eventId, seatNo }, cb) => {
    try {
      if (!eventId || !seatNo) return cb?.({ ok: false, error: 'invalid_params' });
      const redis = getRedis();
      const key = seatHoldKey(eventId, seatNo);
      const owner = await redis.get(key);
      if (owner === socket.id) {
        await redis.del(key);
        await redis.srem(heldSeatsSetKey(eventId), seatNo);
        await redis.srem(socketHoldsKey(socket.id), `${eventId}:${seatNo}`);
        io.to(`event:${eventId}`).emit('seat:released', { eventId, seatNo });
        return cb?.({ ok: true });
      }
      return cb?.({ ok: false, error: 'not_owner' });
    } catch (e) {
      console.error('seat:release error', e.message);
      return cb?.({ ok: false, error: 'server_error' });
    }
  });

  // Refresh/extend hold if still owned (optional keep-alive)
  // keepalive disabled to enforce auto-release after TTL

  // Removed legacy media comment/annotation handlers

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    // Best-effort cleanup: release all holds owned by this socket
    (async () => {
      try {
        const redis = getRedis();
        const key = socketHoldsKey(socket.id);
        const items = await redis.smembers(key);
        if (items && items.length) {
          for (const entry of items) {
            const [eventId, seatNo] = entry.split(':');
            const owner = await redis.get(seatHoldKey(eventId, seatNo));
            if (owner === socket.id) {
              await redis.del(seatHoldKey(eventId, seatNo));
              await redis.srem(heldSeatsSetKey(eventId), seatNo);
              io.to(`event:${eventId}`).emit('seat:released', { eventId, seatNo: Number(seatNo) });
            }
          }
        }
        await redis.del(key);
      } catch (e) {
        console.error('cleanup disconnect error', e.message);
      }
    })();
  });
});

// Basic routes
app.get('/', (req, res) => {
  res.json({
    message: "Eventify API Server",
    status: "Running",
    features: [
      "Multi-tenant Event Booking",
      "Waitlist & Real-time Seat Tracking",
      "Role-based Access Control",
      "RabbitMQ Notifications"
    ]
  });
});

app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      postgresql: result.rows[0],
      socketio: 'Ready ✅'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('DB query failed');
  }
});



const PORT = process.env.PORT || 5000;
ensureSchema().finally(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔌 Socket.IO ready for real-time features`);
  });
});
