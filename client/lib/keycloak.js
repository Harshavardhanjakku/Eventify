import Keycloak from "keycloak-js";

const keycloak = new Keycloak({
  url: "http://localhost:8080/",
  realm: "eventify",
  clientId: "eventify-client", // public client for frontend
});

export default keycloak;
