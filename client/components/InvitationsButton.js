import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import API from "../lib/api";

export default function InvitationsButton({ keycloak, iconOnly = false }) {
  const [pendingInvites, setPendingInvites] = useState([]);
  const [showInvites, setShowInvites] = useState(false);
  const containerRef = useRef(null);
  const router = useRouter();

  const loadPendingInvites = async () => {
    if (!keycloak?.authenticated || !keycloak?.tokenParsed?.sub) {
      console.log('Keycloak not ready yet, skipping pending invites load');
      return;
    }
    try {
      const userResponse = await API.get(`/users?keycloak_id=${keycloak.tokenParsed.sub}`);
      if (userResponse.data.length > 0) {
        const userId = userResponse.data[0].id;
        const invitesResponse = await API.get(`/org-invites/pending/${userId}`);
        setPendingInvites(invitesResponse.data);
      }
    } catch (error) {
      console.error("Error loading pending invites:", error);
      setPendingInvites([]);
    }
  };

  useEffect(() => {
    if (keycloak?.authenticated && keycloak?.tokenParsed?.sub) {
      loadPendingInvites();
    }
    const handleRefreshInvites = () => loadPendingInvites();
    window.addEventListener("refreshInvites", handleRefreshInvites);
    return () => window.removeEventListener("refreshInvites", handleRefreshInvites);
  }, [keycloak?.authenticated, keycloak?.tokenParsed?.sub]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showInvites) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowInvites(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showInvites]);

  // Close on route change
  useEffect(() => {
    const close = () => setShowInvites(false);
    router.events.on('routeChangeStart', close);
    return () => router.events.off('routeChangeStart', close);
  }, [router.events]);

  const handleAcceptInvite = async (inviteId) => {
    try {
      await API.post(`/org-invites/accept/${inviteId}`);
      alert("✅ Organization invite accepted!");
      loadPendingInvites();
      try {
        const evt = new CustomEvent('refreshOrgs');
        window.dispatchEvent(evt);
      } catch (_) { }
    } catch (error) {
      alert("❌ Failed to accept invite: " + (error.response?.data?.error || error.message));
    }
  };

  const handleRejectInvite = async (inviteId) => {
    try {
      await API.post(`/org-invites/reject/${inviteId}`);
      alert("❌ Organization invite rejected!");
      loadPendingInvites();
    } catch (error) {
      alert("❌ Failed to reject invite: " + (error.response?.data?.error || error.message));
    }
  };

  if (!keycloak?.authenticated) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setShowInvites(!showInvites)}
        className={`px-4 py-2 bg-black/60 backdrop-blur-md text-white/90 rounded-xl hover:bg-black/80 hover:shadow-lg transition-all font-semibold shadow-xl flex items-center gap-2 group border border-white/15 hover:border-white/25 tracking-wide ${iconOnly ? 'px-3' : ''}`}
        aria-label="Open Invitations"
        title="Invitations for you"
      >
        <span className="relative inline-flex items-center">
          <svg className="w-4 h-4 text-cyan-300 group-hover:scale-110 transition-transform duration-200" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 2a6 6 0 00-6 6v2.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 10.586V8a6 6 0 00-6-6zM8 16a2 2 0 104 0H8z" />
          </svg>
          {pendingInvites.length > 0 && (
            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] rounded-full h-4 min-w-4 px-1 flex items-center justify-center font-bold">
              {pendingInvites.length}
            </span>
          )}
        </span>
        {!iconOnly && <span>Invitations</span>}
      </button>

      {showInvites && (
        <div className="absolute left-0 top-full mt-2 w-96 bg-black/90 backdrop-blur-2xl rounded-2xl shadow-xl border border-white/10 z-[9999] overflow-hidden transition-all duration-300">
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white tracking-wide">Organization Invites</h3>
              <button onClick={() => setShowInvites(false)} className="text-white/60 hover:text-white transition-all duration-200 hover:rotate-90">
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>

            {pendingInvites.length === 0 ? (
              <div className="text-center py-10">
                <i className="fas fa-inbox text-4xl text-cyan-300 mb-3"></i>
                <p className="text-white/60 text-sm">No pending invites</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1 custom-scroll">
                {pendingInvites.map((invite) => (
                  <div key={invite.id} className="bg-white/5 rounded-xl p-4 border border-white/10 hover:border-white/20 transition-all duration-300">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="text-sm text-white/70">
                          <span className="font-medium text-white">{invite.invited_by_username}</span> invited you to join
                        </p>
                        <p className="text-base font-semibold text-cyan-300 mt-1">{invite.organization_name}</p>
                        <div className="mt-1">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-300/20 text-cyan-300 border border-cyan-300/30">
                            Role: {String(invite.role).toLowerCase() === 'organizer' ? 'Organizer' : 'User'}
                          </span>
                        </div>
                        {invite.message && (
                          <p className="text-sm text-white/60 italic mt-2 border-l-2 border-cyan-300 pl-3">{invite.message}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button onClick={() => handleAcceptInvite(invite.id)} className="px-4 py-2 rounded-md text-sm font-medium bg-green-500/80 hover:bg-green-500 text-white transition-colors">Accept</button>
                      <button onClick={() => handleRejectInvite(invite.id)} className="px-4 py-2 rounded-md text-sm font-medium bg-red-500/80 hover:bg-red-500 text-white transition-colors">Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


