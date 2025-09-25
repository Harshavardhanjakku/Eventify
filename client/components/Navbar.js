import { useState, useEffect, useRef } from 'react';
import Link from "next/link";
import { useRouter } from "next/router";
import API from '../lib/api';
import InviteToOrgButton from "../components/InviteToOrgButton";
import InvitationsButton from "../components/InvitationsButton";

export default function Navbar({ keycloak }) {
  const router = useRouter();
  const [pendingInvites, setPendingInvites] = useState([]);
  const [showProfile, setShowProfile] = useState(false);
  const [orgs, setOrgs] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const profileRef = useRef(null);
  const [showOrgs, setShowOrgs] = useState(false);
  const orgsHoverTimer = useRef(null);

  const links = [];

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
        try {
          const event = new CustomEvent('pendingInviteCount', { detail: invitesResponse.data.length });
          window.dispatchEvent(event);
        } catch (_) { }
      }
    } catch (error) {
      console.error('Error loading pending invites:', error);
      try {
        const event = new CustomEvent('pendingInviteCount', { detail: 0 });
        window.dispatchEvent(event);
      } catch (_) { }
    }
  };

  useEffect(() => {
    if (keycloak?.authenticated && keycloak?.tokenParsed?.sub) {
      loadPendingInvites();
    }
    const handleRefreshInvites = () => loadPendingInvites();
    window.addEventListener('refreshInvites', handleRefreshInvites);
    return () => window.removeEventListener('refreshInvites', handleRefreshInvites);
  }, [keycloak?.authenticated, keycloak?.tokenParsed?.sub]);

  // Load current user and their organizations for dropdown + respond to refresh events
  useEffect(() => {
    const loadUserAndOrgs = async () => {
      if (!keycloak?.authenticated || !keycloak?.tokenParsed?.sub) return;
      try {
        // Ensure we always resolve latest user id
        let uid = currentUserId;
        if (!uid) {
          const userRes = await API.get(`/users?keycloak_id=${keycloak.tokenParsed.sub}`);
          if (userRes.data?.length) {
            uid = userRes.data[0].id;
            setCurrentUserId(uid);
          }
        }
        if (!uid) return;
        const orgRes = await API.get(`/organizations/user/${uid}`);
        setOrgs(Array.isArray(orgRes.data) ? orgRes.data : []);
      } catch (e) {
        console.error('Failed to load organizations for navbar:', e);
        setOrgs([]);
      }
    };

    // initial load
    loadUserAndOrgs();

    // listen for external refresh events (e.g., after accepting an invite)
    const handleRefreshOrgs = () => {
      loadUserAndOrgs();
    };
    window.addEventListener('refreshOrgs', handleRefreshOrgs);
    return () => window.removeEventListener('refreshOrgs', handleRefreshOrgs);
  }, [keycloak?.authenticated, keycloak?.tokenParsed?.sub, currentUserId]);

  const handleSwitchToOrg = (org) => {
    if (!org?.id) return;
    router.push(`/switch/${org.id}`);
  };

  // Close profile on outside click or route change
  useEffect(() => {
    if (!showProfile) return;
    const handleClickOutside = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setShowProfile(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    const close = () => setShowProfile(false);
    router.events.on('routeChangeStart', close);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      router.events.off('routeChangeStart', close);
    };
  }, [showProfile, router.events]);

  // Ensure orgs dropdown closes on route change or outside click
  useEffect(() => {
    if (!showOrgs) return;
    const close = () => setShowOrgs(false);
    router.events.on('routeChangeStart', close);
    const handleDocClick = (e) => {
      // If click is far away from the container, close. We rely on mouseleave too; this is extra safety
      // No specific ref for container since mouseleave covers most cases
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => {
      router.events.off('routeChangeStart', close);
      document.removeEventListener('mousedown', handleDocClick);
    };
  }, [showOrgs, router.events]);

  const handleAcceptInvite = async (inviteId) => {
    try {
      await API.post(`/org-invites/accept/${inviteId}`);
      alert('✅ Organization invite accepted!');
      loadPendingInvites();
      try {
        const evt = new CustomEvent('refreshOrgs');
        window.dispatchEvent(evt);
      } catch (_) { }
    } catch (error) {
      alert('❌ Failed to accept invite: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleRejectInvite = async (inviteId) => {
    try {
      await API.post(`/org-invites/reject/${inviteId}`);
      alert('❌ Organization invite rejected!');
      loadPendingInvites();
    } catch (error) {
      alert('❌ Failed to reject invite: ' + (error.response?.data?.error || error.message));
    }
  };


  return (
    <nav className="bg-black/90 backdrop-blur-xl border-b border-white/10 shadow-[0_2px_10px_rgba(0,0,0,0.5)] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* Logo */}
          <div
            className="flex-shrink-0 cursor-pointer select-none group"
            onClick={() => router.push('/media')}
          >
            <span className="font-brand text-2xl font-extrabold text-white group-hover:text-cyan-300 transition-all duration-300">
              Eventify
            </span>
          </div>



          {/* Right side: primary actions + profile */}
          <div className="flex items-center space-x-3">
            {keycloak?.authenticated && (
              <>
                {/* Organizations dropdown with stable hover */}
                <div
                  className="relative"
                  onMouseEnter={() => {
                    if (orgsHoverTimer.current) {
                      clearTimeout(orgsHoverTimer.current);
                      orgsHoverTimer.current = null;
                    }
                    setShowOrgs(true);
                  }}
                  onMouseLeave={() => {
                    // Delay closing slightly to allow cursor to move into panel
                    if (orgsHoverTimer.current) clearTimeout(orgsHoverTimer.current);
                    orgsHoverTimer.current = setTimeout(() => setShowOrgs(false), 200);
                  }}
                >
                  <button className="px-4 py-2 rounded-xl bg-black/60 border border-white/15 hover:border-white/25 text-white/90 text-sm font-semibold shadow-sm hover:shadow transition flex items-center gap-1">
                    <span>Organizations</span>
                    <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>

                  {/* Dropdown panel */}
                  {showOrgs && (
                    <div
                      className="absolute left-0 top-full mt-1 w-80 bg-black/90 backdrop-blur-xl rounded-2xl shadow-xl border border-white/10 z-[9999] p-3"
                      onMouseEnter={() => {
                        if (orgsHoverTimer.current) {
                          clearTimeout(orgsHoverTimer.current);
                          orgsHoverTimer.current = null;
                        }
                      }}
                      onMouseLeave={() => {
                        if (orgsHoverTimer.current) clearTimeout(orgsHoverTimer.current);
                        orgsHoverTimer.current = setTimeout(() => setShowOrgs(false), 200);
                      }}
                    >
                      {(() => {
                        const toLower = (v) => String(v || '').toLowerCase();
                        const managedOrgs = orgs.filter(o => {
                          const r = toLower(o.role);
                          return r === 'orgadmin' || r === 'owner';
                        });
                        const memberOrgs = orgs.filter(o => {
                          const r = toLower(o.role);
                          return !(r === 'orgadmin' || r === 'owner');
                        });

                        const renderRoleLabel = (role) => {
                          const r = toLower(role);
                          if (r === 'organizer') return 'Organizer';
                          if (r === 'agent') return 'Agent';
                          if (r === 'customer' || r === 'viewer') return 'Customer';
                          if (r === 'user') return 'User';
                          if (r === 'owner' || r === 'orgadmin') return 'OrgAdmin';
                          return role;
                        };

                        return (
                          <>
                            <div className="mb-2">
                              <div className="text-xs text-white/60 px-2 pb-1">You manage</div>
                              {managedOrgs.length > 0 ? (
                                managedOrgs.map(org => (
                                  <div key={`${org.id}-admin`} className="flex items-center justify-between p-3 rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5 mb-2">
                                    <div>
                                      <div className="text-sm font-semibold text-white truncate max-w-[12rem]">{org.name}</div>
                                      <div className="text-xs text-white/60">Role: OrgAdmin</div>
                                    </div>
                                    {/* Switch action hidden for OrgAdmin-managed orgs */}
                                  </div>
                                ))
                              ) : (
                                <div className="px-2 py-3 text-xs text-white/60">No organizations to manage</div>
                              )}
                            </div>

                            <div className="mt-2">
                              <div className="text-xs text-white/60 px-2 pb-1">You work in</div>
                              {memberOrgs.length > 0 ? (
                                memberOrgs.map(org => (
                                  <div key={`${org.id}-member`} className="flex items-center justify-between p-3 rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5 mb-2">
                                    <div>
                                      <div className="text-sm font-semibold text-white truncate max-w-[12rem]">{org.name}</div>
                                      <div className="text-xs text-white/60">Role: {renderRoleLabel(org.role)}</div>
                                    </div>
                                    <button onClick={() => handleSwitchToOrg(org)} className="px-3 py-1.5 text-xs rounded-lg border border-white/20 text-white hover:bg-white/10 font-semibold">Switch</button>
                                  </div>
                                ))
                              ) : (
                                <div className="px-2 py-3 text-xs text-white/60">No organizations joined</div>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
                <InviteToOrgButton keycloak={keycloak} />
                <InvitationsButton keycloak={keycloak} iconOnly />
              </>
            )}

            {/* Profile / Auth */}
            {keycloak?.authenticated ? (
              <div className="relative" ref={profileRef}>
                <button onClick={() => setShowProfile(v => !v)} className="w-8 h-8 rounded-xl bg-white/10 text-white font-bold flex items-center justify-center border border-white/15">
                  {keycloak?.tokenParsed?.preferred_username?.[0]?.toUpperCase?.() || 'U'}
                </button>
                {showProfile && (
                  <div className="absolute right-0 mt-2 w-56 bg-black/90 backdrop-blur-xl rounded-xl shadow-xl border border-white/10 z-[9999]">
                    <div className="px-4 py-3 border-b border-white/10">
                      <div className="text-sm font-semibold text-white">{keycloak?.tokenParsed?.preferred_username}</div>
                      <div className="text-xs text-white/60 truncate">{keycloak?.tokenParsed?.email}</div>
                    </div>
                    <button onClick={() => {
                      setShowProfile(false);
                      try {
                        const ok = window.confirm('Are you sure you want to logout?');
                        if (!ok) return;
                      } catch (_) { /* fallback if confirm blocked */ }
                      keycloak.logout({ redirectUri: window.location.origin });
                    }} className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-white/10">Logout</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <a href="#features" className="hidden md:inline-block px-3 py-2 text-sm text-white/80 hover:text-white">Features</a>
                <a href="#how-it-works" className="hidden md:inline-block px-3 py-2 text-sm text-white/80 hover:text-white">How it works</a>
                <a href="#tech" className="hidden md:inline-block px-3 py-2 text-sm text-white/80 hover:text-white">Tech</a>
                <a href="#bonus" className="hidden md:inline-block px-3 py-2 text-sm text-white/80 hover:text-white">Bonus</a>
                <button
                  onClick={() => keycloak.login()}
                  className="px-5 py-2 rounded-full bg-white text-black hover:bg-white/90 text-sm font-semibold shadow transition-all duration-200"
                >
                  Get Started
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
