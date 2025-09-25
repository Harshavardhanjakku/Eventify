const Keycloak = require('keycloak-connect');
const session = require('express-session');
const dotenv = require('dotenv');
dotenv.config();

let _keycloak;
const memoryStore = new session.MemoryStore();

function initKeycloak() {
  if (_keycloak) {
    console.warn("Trying to init Keycloak again!");
    return _keycloak;
  } else {
    console.log("Initializing Keycloak...");
    _keycloak = new Keycloak({ store: memoryStore }, {
      "realm": process.env.KEYCLOAK_REALM,
      "auth-server-url": process.env.KEYCLOAK_SERVER_URL,
      "ssl-required": "external",
      "resource": process.env.KEYCLOAK_CLIENT_ID,
      "bearer-only": true,
      "confidential-port": 0,
      "credentials": {
        "secret": process.env.KEYCLOAK_CLIENT_SECRET
      }
    });
    return _keycloak;
  }
}

function getKeycloak() {
  if (!_keycloak) {
    console.error("Keycloak has not been initialized. Call initKeycloak first.");
  }
  return _keycloak;
}

module.exports = {
  initKeycloak,
  getKeycloak,
  memoryStore
};
