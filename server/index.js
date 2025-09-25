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

  // Removed legacy media comment/annotation handlers

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
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
