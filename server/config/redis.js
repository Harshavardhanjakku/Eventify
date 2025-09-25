const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

let redisClient;

function getRedis() {
  if (!redisClient) {
    redisClient = new Redis(redisUrl);
  }
  return redisClient;
}

module.exports = {
  getRedis,
};


