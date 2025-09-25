import { useEffect, useState } from "react";
// import "@fortawesome/fontawesome-free/css/all.min.css";
import "../styles/globals.css";
import Navbar from "../components/Navbar";
import keycloak from "../lib/keycloak";

export default function MyApp({ Component, pageProps }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const boot = async () => {
      try {
        // Avoid multiple initialization during Fast Refresh / remounts
        if (typeof window !== 'undefined' && window.__kcInitDone) {
          window.keycloak = keycloak;
          if (keycloak?.token) localStorage.setItem('token', keycloak.token);
          setIsAuthenticated(Boolean(keycloak?.authenticated || keycloak?.token));
          setLoading(false);
          return;
        }

        const authenticated = await keycloak.init({
          onLoad: "check-sso",
          checkLoginIframe: false,
        });

        if (typeof window !== 'undefined') {
          window.__kcInitDone = true;
          window.keycloak = keycloak;
        }

        setIsAuthenticated(authenticated);
        if (authenticated) {
          localStorage.setItem('token', keycloak.token);
          keycloak.onTokenExpired = () => {
            keycloak.updateToken(70).then((refreshed) => {
              if (refreshed) {
                localStorage.setItem('token', keycloak.token);
              }
            });
          };
        }
      } catch (err) {
        console.error("Keycloak init failed:", err);
      } finally {
        setLoading(false);
      }
    };
    boot();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div>
      <Navbar keycloak={keycloak} />
      <Component {...pageProps} keycloak={keycloak} />
    </div>
  );
}
