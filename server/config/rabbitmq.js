const amqplib = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://happening:happening@rabbitmq:5672';

let connectionPromise;

async function getConnection() {
  if (!connectionPromise) {
    connectionPromise = amqplib.connect(RABBITMQ_URL);
  }
  return connectionPromise;
}

async function publish(queueName, message) {
  const conn = await getConnection();
  const channel = await conn.createChannel();
  try {
    await channel.assertQueue(queueName, { durable: true });
    channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
      persistent: true,
      contentType: 'application/json',
    });
  } finally {
    await channel.close();
  }
}

module.exports = {
  getConnection,
  publish,
};

