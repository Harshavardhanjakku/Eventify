const amqplib = require('amqplib');
require('dotenv').config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://eventify:eventify@rabbitmq:5672';
const QUEUE = process.env.NOTIFICATIONS_QUEUE || 'notifications';

async function start() {
    const conn = await amqplib.connect(RABBITMQ_URL);
    const channel = await conn.createChannel();
    await channel.assertQueue(QUEUE, { durable: true });
    channel.prefetch(10);
    console.log(`📬 Notifications worker listening on queue: ${QUEUE}`);

    channel.consume(QUEUE, async (msg) => {
        if (!msg) return;
        try {
            const payload = JSON.parse(msg.content.toString());
            // Simulate notification sending. Plug your email/SMS/push provider here.
            const { type, eventId, userId, seats } = payload;
            console.log(`🔔 Notification: ${type} | event=${eventId} user=${userId} seats=${seats ?? ''}`);
            // TODO: integrate with real email service
            channel.ack(msg);
        } catch (e) {
            console.error('❌ Failed to process notification:', e.message);
            // requeue once; if repeatedly failing, move to DLQ in future
            channel.nack(msg, false, false);
        }
    });
}

start().catch((e) => {
    console.error('Notifications worker failed to start:', e.message);
    process.exit(1);
});


