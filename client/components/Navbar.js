import { useState, useEffect, useRef } from 'react';
import Link from "next/link";
import { useRouter } from "next/router";
import API from '../lib/api';
import InviteToOrgButton from "../components/InviteToOrgButton";
import InvitationsButton from "../components/InvitationsButton";
import OrganizationSwitcher from "./OrganizationSwitcher";
import Breadcrumb from "./Breadcrumb";
import { useOrganization } from '../contexts/OrganizationContext';

export default function Navbar({ keycloak }) {
  const router = useRouter();
  const [pendingInvites, setPendingInvites] = useState([]);
  const [showProfile, setShowProfile] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const profileRef = useRef(null);
  const { loadOrganizations, currentOrganization } = useOrganization();

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
      // Only log non-network errors to avoid console spam
      if (error.code !== 'ERR_NETWORK') {
        console.error('Error loading pending invites:', error);
      }
      // Set empty array on error to prevent UI issues
      setPendingInvites([]);
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

  // Load organizations when user changes
  useEffect(() => {
    if (keycloak?.authenticated && keycloak?.tokenParsed?.sub && currentUserId) {
      loadOrganizations(currentUserId);
    }
  }, [keycloak?.authenticated, currentUserId, loadOrganizations]);

  // Add retry mechanism for organization loading
  useEffect(() => {
    if (!keycloak?.authenticated || !currentUserId) return;
    
    const retryInterval = setInterval(() => {
      // Only retry if we don't have organizations and no current error
      if (currentUserId && !currentOrganization) {
        loadOrganizations(currentUserId, true);
      }
    }, 10000); // Retry every 10 seconds

    return () => clearInterval(retryInterval);
  }, [keycloak?.authenticated, currentUserId, currentOrganization, loadOrganizations]);

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

  // Listen for organization switch events
  useEffect(() => {
    const handleOrgSwitch = () => {
      // Refresh data when organization switches
      if (currentUserId) {
        loadOrganizations(currentUserId, true);
      }
    };
    window.addEventListener('organizationSwitched', handleOrgSwitch);
    return () => window.removeEventListener('organizationSwitched', handleOrgSwitch);
  }, [currentUserId, loadOrganizations]);

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
                <OrganizationSwitcher />
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

      {/* Breadcrumb */}
      {keycloak?.authenticated && currentOrganization && (
        <div className="border-t border-white/10 bg-black/50 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-6 lg:px-8 py-3">
            <Breadcrumb />
          </div>
        </div>
      )}
    </nav>
  );
}
