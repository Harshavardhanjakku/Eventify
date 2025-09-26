import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import API from "../lib/api";
import InvitationsButton from "../components/InvitationsButton";
import { useRouter } from "next/router";
import { useOrganization } from "../contexts/OrganizationContext";

export default function MediaPage({ keycloak }) {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [switchingOrg, setSwitchingOrg] = useState(false);
    const [currentUserId, setCurrentUserId] = useState(null);
    const { 
        organizations, 
        currentOrganization, 
        loadOrganizations, 
        switchToOrganization,
        loading: orgLoading,
        error: orgError 
    } = useOrganization();
    // Booking flow now happens via the View → seat selection modal only
    const [bookingLoading, setBookingLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [myBookings, setMyBookings] = useState([]);
    // Create-event form state
    const [creating, setCreating] = useState(false);
    const [newEvent, setNewEvent] = useState({ 
        org_id: "", 
        name: "", 
        description: "", 
        category: "webinar", 
        event_date: "", 
        total_slots: 50,
        location: "",
        price: 0,
        max_attendees: 100,
        tags: "",
        event_type: "online",
        duration: 60,
        requirements: "",
        contact_email: "",
        contact_phone: "",
        created_by: currentUserId
    });
    const [showCreateModal, setShowCreateModal] = useState(false);
    // Edit-event modal state
    const [showEditModal, setShowEditModal] = useState(false);
    const [editingEvent, setEditingEvent] = useState(null); // event object
    const [editDescription, setEditDescription] = useState("");
    // Manage seats modal
    const [showManageSeatsModal, setShowManageSeatsModal] = useState(false);
    const [manageBooking, setManageBooking] = useState(null);
    const [manageSeats, setManageSeats] = useState([]);
    // Seat selection for upcoming events
    const [showSeatSelect, setShowSeatSelect] = useState(false);
    const [seatSelect, setSeatSelect] = useState(null);
    const socketRef = useRef(null);
    const holdTimersRef = useRef(new Map()); // key: seatNo -> intervalId
    // Organization modal state
    const [showOrgModal, setShowOrgModal] = useState(false);
    const [selectedOrg, setSelectedOrg] = useState(null);
    const [orgMembers, setOrgMembers] = useState([]);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const router = useRouter();
    const switchOrgId = router?.query?.id || router?.query?.orgId || null;
    const isSwitchView = Boolean(switchOrgId);

    const toLower = (v) => String(v || '').toLowerCase();
    // Enhanced role-based event filtering
    const userOrgIdsForBooking = useMemo(() => {
        if (!currentOrganization) return new Set();
        
        // Only show events from current organization
        return new Set([currentOrganization.id]);
    }, [currentOrganization]);

    const organizerOrgIds = useMemo(() => {
        if (!currentOrganization) return new Set();
        
        // Only show events from current organization if user has organizer role
        const hasOrganizerRole = ['owner', 'orgadmin', 'organizer'].includes(currentOrganization.role?.toLowerCase());
        return hasOrganizerRole ? new Set([currentOrganization.id]) : new Set();
    }, [currentOrganization]);

    // Separate events by user's relationship to them

    const availableEvents = useMemo(() => {
        if (!currentUserId) return [];
        return events.filter(ev => 
            userOrgIdsForBooking.has(ev.org_id) && 
            ev.created_by !== currentUserId && // Exclude events created by current user
            (!isSwitchView || String(ev.org_id) === String(switchOrgId))
        );
    }, [events, userOrgIdsForBooking, currentUserId, isSwitchView, switchOrgId]);

    const managedEvents = useMemo(() => {
        if (!currentUserId) return [];
        return events.filter(ev => 
            organizerOrgIds.has(ev.org_id) && 
            ev.created_by === currentUserId && // Only show events created by current user
            (!isSwitchView || String(ev.org_id) === String(switchOrgId))
        );
    }, [events, organizerOrgIds, currentUserId, isSwitchView, switchOrgId]);

    const switchOrgRole = useMemo(() => {
        if (!isSwitchView) return null;
        const org = organizations.find(o => String(o.id) === String(switchOrgId));
        return toLower(org?.role);
    }, [organizations, isSwitchView, switchOrgId]);
    const isSwitchOrganizer = switchOrgRole === 'organizer';

    // In switch-organizer view, default new event's org to the switched org
    useEffect(() => {
        if (isSwitchView && isSwitchOrganizer && switchOrgId && !newEvent.org_id) {
            setNewEvent(prev => ({ ...prev, org_id: String(switchOrgId) }));
        }
    }, [isSwitchView, isSwitchOrganizer, switchOrgId]);

    // Update newEvent with current user ID when it changes
    useEffect(() => {
        if (currentUserId) {
            setNewEvent(prev => ({ ...prev, created_by: currentUserId }));
        }
    }, [currentUserId]);

    const showUpcomingSection = !isSwitchView || !isSwitchOrganizer;
    const showYourEventsSection = !isSwitchView || !isSwitchOrganizer;

    const getCurrentUser = async () => {
        if (!keycloak?.authenticated) return null;
        try {
            const keycloakId = keycloak.tokenParsed?.sub;
            const userResponse = await API.get(`/users?keycloak_id=${keycloakId}`);
            if (userResponse.data.length === 0) {
                const newUser = await API.post("/users", {
                    keycloak_id: keycloakId,
                    username: keycloak.tokenParsed?.preferred_username || "Unknown",
                    email: keycloak.tokenParsed?.email || "",
                    role: "user",
                });
                return { id: newUser.data.id };
            }
            const user = userResponse.data[0];
            return { id: user.id };
        } catch (err) {
            console.error("Error getting current user:", err);
            return null;
        }
    };

    const fetchEvents = async () => {
        try {
            const res = await API.get("/events");
            setEvents(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            console.error("Error fetching events", err);
            setEvents([]);
        }
    };

    // Remove fetchOrganizationsForUser - now handled by context

    const fetchMyBookings = async (userId) => {
        if (!userId) return setMyBookings([]);
        try {
            const res = await API.get(`/bookings/user/${userId}`);
            setMyBookings(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            console.error('Error fetching my bookings', err);
            setMyBookings([]);
        }
    };

    const fetchOrgMembers = async (orgId) => {
        setLoadingMembers(true);
        try {
            const response = await API.get(`/organizations/${orgId}/members`);
            setOrgMembers(response.data);
        } catch (err) {
            console.error("Error fetching organization members:", err);
            setOrgMembers([]);
        } finally {
            setLoadingMembers(false);
        }
    };

    useEffect(() => {
        const init = async () => {
            if (!keycloak?.authenticated) {
                setLoading(false);
                return;
            }
            try {
                const userData = await getCurrentUser();
                const uid = userData?.id || null;
                setCurrentUserId(uid);
                if (uid) {
                    // Load organizations through context
                    await loadOrganizations(uid);
                    await fetchMyBookings(uid);
                }
                await fetchEvents();
            } finally {
                setLoading(false);
            }
        };
        init();
    }, [keycloak?.authenticated, loadOrganizations]);

    // Listen for organization switches and refresh data
    useEffect(() => {
        const handleOrgSwitch = async () => {
            if (currentUserId && currentOrganization) {
                setSwitchingOrg(true);
                try {
                    await Promise.all([
                        fetchEvents(),
                        fetchMyBookings(currentUserId)
                    ]);
                } finally {
                    setSwitchingOrg(false);
                }
            }
        };

        window.addEventListener('organizationSwitched', handleOrgSwitch);
        return () => window.removeEventListener('organizationSwitched', handleOrgSwitch);
    }, [currentUserId, currentOrganization]);

    // Direct booking button removed; booking is handled inside the seat selection modal

    if (!keycloak?.authenticated) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="text-center p-12 bg-black/90 backdrop-blur-xl rounded-3xl border border-white/10 shadow-2xl max-w-md">
                    <h2 className="text-3xl font-bold text-white mb-4 tracking-wide">Eventify</h2>
                    <p className="text-white/70 mb-8 leading-relaxed">Your modern event management platform</p>
                    <button onClick={() => keycloak.login()} className="px-8 py-3 bg-cyan-300 hover:bg-cyan-400 text-black rounded-2xl transition-all font-bold shadow-2xl hover:shadow-3xl hover:scale-105 transform duration-300 tracking-wider">Get Started</button>
                </div>
            </div>
        );
    }

    if (loading || orgLoading) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-white/20 border-t-cyan-300 rounded-full animate-spin mb-6 shadow-2xl"></div>
                    <p className="text-white text-xl font-semibold tracking-wide">
                        {orgLoading ? 'Loading organizations...' : 'Loading...'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white p-6">
            {/* Organization Switching Indicator */}
            {switchingOrg && (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
                    <div className="bg-gradient-to-r from-cyan-500/20 to-blue-500/20 backdrop-blur-xl border border-cyan-400/30 rounded-2xl px-6 py-3 shadow-2xl">
                        <div className="flex items-center gap-3">
                            <div className="w-5 h-5 border-2 border-white/20 border-t-cyan-300 rounded-full animate-spin"></div>
                            <span className="text-sm font-medium text-white">
                                Switching to {currentOrganization?.name}...
                            </span>
                        </div>
                    </div>
                </div>
            )}

            <div className="pt-12 px-8 pb-4">
                <div className="max-w-7xl mx-auto">
                    <div className="mb-12">
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-6">
                                <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-black text-2xl font-bold border border-white/15 bg-white/90">
                                    {keycloak.tokenParsed?.preferred_username?.[0]?.toUpperCase?.()}
                                </div>
                                <div className="flex items-center gap-4">
                                    <h1 className="text-3xl font-bold text-white mb-1 tracking-wide">Welcome {keycloak.tokenParsed?.preferred_username}</h1>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Current Organization Indicator */}
            {currentOrganization && (
                <div className="px-8 pb-4">
                    <div className="max-w-7xl mx-auto">
                        <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 backdrop-blur-xl border border-cyan-400/20 rounded-2xl p-4">
                            <div className="flex items-center gap-3">
                                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center border border-white/20">
                                    <svg className="w-4 h-4 text-white/80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 4h12M6 4v16M6 4H5m13 0v16m0-16h1m-1 16H6m12 0h1M6 20H5M9 7h1v1H9V7Zm5 0h1v1h-1V7Zm-5 4h1v1H9v-1Zm5 0h1v1h-1v-1Zm-3 4h2a1 1 0 0 1 1 1v4h-4v-4a1 1 0 0 1 1-1Z"/>
                                    </svg>
                                </div>
                                <div>
                                    <div className="text-white font-semibold text-sm">
                                        Currently viewing: {currentOrganization.name}
                                    </div>
                                    <div className="text-cyan-300 text-xs font-medium">
                                        {currentOrganization.role?.charAt(0).toUpperCase() + currentOrganization.role?.slice(1)} • {currentOrganization.member_count || 0} members
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Organization Error Message */}
            {orgError && (
                <div className="px-8 pb-4">
                    <div className="max-w-7xl mx-auto">
                        <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
                            <div className="flex items-center justify-between">
                                <span>{orgError}</span>
                                <button
                                    onClick={() => loadOrganizations(currentUserId, true)}
                                    className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-xs font-medium transition-colors"
                                >
                                    Retry
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Organizations Section */}
            <div className="px-8 pb-12">
                <div className="max-w-7xl mx-auto">
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-6">
                            <h2 className="text-2xl font-bold text-white tracking-wide">Your Organizations</h2>
                            <div className="text-sm text-white/60">{organizations.length} organizations</div>
                            {currentOrganization && (
                                <div className="text-sm text-cyan-300">
                                    Currently viewing: <span className="font-semibold">{currentOrganization.name}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {organizations.length === 0 ? (
                        <div className="text-center py-20 bg-white/5 backdrop-blur-3xl rounded-3xl border border-white/10 shadow-2xl">
                            <div className="text-6xl mb-6">
                                <i className="fa-solid fa-building" style={{ color: "#96C2DB", fontSize: "45px" }}></i>
                            </div>
                            <h3 className="text-xl font-bold text-white mb-4 tracking-wide">NO ORGANIZATIONS FOUND</h3>
                            <p className="text-white/70 mb-8 max-w-md mx-auto leading-relaxed">You're not part of any organizations yet. Ask an admin to invite you!</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {organizations.map((org) => {
                                const role = String(org.role).toLowerCase();
                                const isAdmin = role === 'orgadmin' || role === 'owner';
                                const isOrganizer = role === 'organizer';
                                const isUser = role === 'user' || role === 'customer' || role === 'viewer';
                                const isCurrent = currentOrganization?.id === org.id;
                                
                                return (
                                    <div key={org.id} className={`group relative rounded-2xl border backdrop-blur-xl shadow-2xl p-3 transition-all duration-300 ${
                                        isCurrent 
                                            ? 'border-cyan-400/50 bg-cyan-500/10 hover:bg-cyan-500/15' 
                                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                                    }`}>
                                        {/* Role indicator bar */}
                                        <div className={`absolute left-0 top-0 h-full w-1 rounded-l-2xl ${
                                            isAdmin ? 'bg-gradient-to-b from-purple-500 to-indigo-500' :
                                            isOrganizer ? 'bg-gradient-to-b from-blue-500 to-cyan-500' :
                                            'bg-gradient-to-b from-emerald-500 to-teal-500'
                                        }`}></div>
                                        
                                        {/* Current organization indicator */}
                                        {isCurrent && (
                                            <div className="absolute top-4 right-4 w-3 h-3 bg-cyan-400 rounded-full animate-pulse"></div>
                                        )}
                                        
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex-1">
                                                <h3 className="text-lg font-bold text-white mb-1 truncate">{org.name}</h3>
                                                <p className="text-xs text-white/60">Created {new Date(org.created_at).toLocaleDateString()}</p>
                                            </div>
                                            <span className={`px-3 py-1 rounded-full text-[0.7rem] font-bold uppercase ${
                                                isAdmin ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                                                isOrganizer ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                                                'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                            }`}>
                                                {isAdmin ? 'Admin' : isOrganizer ? 'Organizer' : 'Member'}
                                            </span>
                                        </div>

                                        {/* Organization stats */}
                                        <div className="grid grid-cols-2 gap-4 mb-6">
                                            <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                                                <div className="text-xs text-white/60 mb-1">Members</div>
                                                <div className="text-lg font-bold text-white">{org.member_count || 0}</div>
                                            </div>
                                            <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                                                <div className="text-xs text-white/60 mb-1">Owner</div>
                                                <div className="text-sm font-medium text-white truncate">
                                                    {org.owner_username || (org.name?.startsWith('org-of-') ? org.name.replace('org-of-', '').charAt(0).toUpperCase() + org.name.replace('org-of-', '').slice(1) : 'Unknown')}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Organization features */}
                                        <div className="space-y-2 mb-6">
                                            <div className="flex items-center gap-2 text-sm text-white/70">
                                                <i className="fa-solid fa-users text-cyan-300"></i>
                                                <span>Team Collaboration</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-sm text-white/70">
                                                <i className="fa-solid fa-calendar text-cyan-300"></i>
                                                <span>Event Management</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-sm text-white/70">
                                                <i className="fa-solid fa-bell text-cyan-300"></i>
                                                <span>Notifications</span>
                                            </div>
                                        </div>

                                        {/* Action buttons */}
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => {
                                                    // Show organization details modal
                                                    setSelectedOrg(org);
                                                    setShowOrgModal(true);
                                                    fetchOrgMembers(org.id);
                                                }}
                                                className="flex-1 px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 rounded-xl text-sm font-semibold transition-all duration-300"
                                            >
                                                View Details
                                            </button>
                                            {!isCurrent && (
                                                <button 
                                                    onClick={() => switchToOrganization(org)}
                                                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl text-sm font-semibold transition-all duration-300"
                                                >
                                                    Switch
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {showUpcomingSection && (
                <div className="px-8 pb-12">
                    <div className="max-w-7xl mx-auto">
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-6">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center border border-green-500/30">
                                        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/>
                                        </svg>
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-white tracking-wide">Events</h2>
                                        <p className="text-sm text-white/60">Events you can book</p>
                                    </div>
                                </div>
                                <div className="text-sm text-white/60 bg-white/5 px-3 py-1 rounded-full border border-white/10">
                                    {availableEvents.length} events
                                </div>
                            </div>
                            <button onClick={fetchEvents} className="px-4 py-2 bg-white/10 backdrop-blur-xl border border-white/15 rounded-xl text-sm font-medium text-white hover:bg-white/15 transition-all duration-300 shadow-lg inline-flex items-center justify-center">
                                <svg width="20" height="20" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                    <path fill="#6597BB" stroke="#041E31" strokeWidth="3" d="M 93,62 C 83,82 65,96 48,96 32,96 19,89 15,79 L 5,90 5,53 40,53 29,63 c 0,0 5,14 26,14 16,0 38,-15 38,-15 z"/>
                                    <path fill="#6597BB" stroke="#041E31" strokeWidth="3" d="M 5,38 C 11,18 32,4 49,4 65,4 78,11 85,21 L 95,10 95,47 57,47 68,37 C 68,37 63,23 42,23 26,23 5,38 5,38 z"/>
                                </svg>
                            </button>
                        </div>

                        {availableEvents.length === 0 ? (
                            <div className="text-center py-20 bg-white/5 backdrop-blur-3xl rounded-3xl border border-white/10 shadow-2xl">
                                <div className="text-6xl mb-6">
                                    <i className="fa-solid fa-folder-open" style={{ color: "#96C2DB", fontSize: "45px" }}></i>
                                </div>
                                <h3 className="text-xl font-bold text-white mb-4 tracking-wide">NO EVENTS FOUND</h3>
                                <p className="text-white/70 mb-8 max-w-md mx-auto leading-relaxed">Check back later for upcoming events.</p>
                                <button onClick={fetchEvents} className="inline-flex items-center justify-center gap-3 px-6 py-3 bg-white/10 backdrop-blur-md text-white rounded-2xl hover:bg-white/15 transition-all font-bold shadow-2xl hover:shadow-3xl group border border-white/20 tracking-wide">
                                    <svg width="22" height="22" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                        <path fill="#ffffff" stroke="#ffffff" strokeWidth="0" d="M 93,62 C 83,82 65,96 48,96 32,96 19,89 15,79 L 5,90 5,53 40,53 29,63 c 0,0 5,14 26,14 16,0 38,-15 38,-15 z"/>
                                        <path fill="#ffffff" stroke="#ffffff" strokeWidth="0" d="M 5,38 C 11,18 32,4 49,4 65,4 78,11 85,21 L 95,10 95,47 57,47 68,37 C 68,37 63,23 42,23 26,23 5,38 5,38 z"/>
                                    </svg>
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                                {availableEvents.map((ev) => (
                                        <div key={ev.id} className="group relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl p-4">
                                            <div className="text-lg font-semibold text-white mb-1">{ev.name}</div>
                                            <div className="text-sm text-white/70 mb-2 line-clamp-2">{ev.description || "No description"}</div>
                                            <div className="flex items-center justify-between text-sm text-white/80">
                                                <span>{ev.category || 'event'}</span>
                                                <span>{ev.event_date ? new Date(ev.event_date).toLocaleString() : ''}</span>
                                            </div>
                                            <div className="flex items-center justify-between mt-3 text-xs text-white/60">
                                                <span>Total: {ev.total_slots}</span>
                                                <span className={ev.available_slots > 0 ? 'text-green-400' : 'text-red-400'}>
                                                    {ev.available_slots > 0 ? `Available: ${ev.available_slots}` : 'No slots left'}
                                                </span>
                                            </div>
                                            <div className="mt-4 flex items-center gap-2">
                                                {ev.available_slots > 0 ? (
                                                    <button onClick={() => router.push(`/events/${ev.id}`)} className="px-3 py-2 bg-white/10 text-white hover:bg-white/15 border border-white/15 rounded-xl text-sm font-semibold">Book</button>
                                                ) : (
                                                    <button disabled className="px-3 py-2 bg-red-500/20 text-red-300 border border-red-500/30 rounded-xl text-sm font-semibold cursor-not-allowed opacity-60">Sold Out</button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Your Events (booked by you) */}
            {showYourEventsSection && (
                <div className="px-8 pb-12">
                    <div className="max-w-7xl mx-auto">
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-6">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center border border-cyan-500/30">
                                        <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/>
                                        </svg>
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-white tracking-wide">Your Bookings</h2>
                                        <p className="text-sm text-white/60">Events you've booked</p>
                                    </div>
                                </div>
                                <div className="text-sm text-white/60 bg-white/5 px-3 py-1 rounded-full border border-white/10">
                                    {myBookings.length} bookings
                                </div>
                            </div>
                            <button onClick={() => fetchMyBookings(currentUserId)} className="px-4 py-2 bg-white/10 backdrop-blur-2xl border border-white/15 rounded-xl text-sm font-medium text-white hover:bg白/15 transition-all duration-300 shadow-lg inline-flex items-center justify-center">
                                <svg width="20" height="20" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                    <path fill="#6597BB" stroke="#041E31" strokeWidth="3" d="M 93,62 C 83,82 65,96 48,96 32,96 19,89 15,79 L 5,90 5,53 40,53 29,63 c 0,0 5,14 26,14 16,0 38,-15 38,-15 z"/>
                                    <path fill="#6597BB" stroke="#041E31" strokeWidth="3" d="M 5,38 C 11,18 32,4 49,4 65,4 78,11 85,21 L 95,10 95,47 57,47 68,37 C 68,37 63,23 42,23 26,23 5,38 5,38 z"/>
                                </svg>
                            </button>
                        </div>

                        {myBookings.length === 0 ? (
                            <div className="text-center py-10 bg-white/5 backdrop-blur-3xl rounded-2xl border border-white/10 shadow">
                                <p className="text-white/70">You haven't booked any events yet.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                                {(() => {
                                    // group bookings by event_id
                                    const groups = new Map();
                                    for (const b of myBookings) {
                                        if (!groups.has(b.event_id)) groups.set(b.event_id, { event: b, bookings: [], totalSeats: 0 });
                                        const g = groups.get(b.event_id);
                                        g.bookings.push(b);
                                        g.totalSeats += Number(b.seats) || 0;
                                    }
                                    return Array.from(groups.values()).map(g => (
                                        <div key={`event-${g.event.event_id}`} className="group relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl p-4">
                                            <div className="text-lg font-semibold text-white mb-1">{g.event.event_name}</div>
                                            <div className="text-sm text-white/70 mb-2 line-clamp-2">{g.event.event_description || 'No description'}</div>
                                            <div className="flex items-center justify-between text-sm text-white/80">
                                                <span>{g.event.category || 'event'}</span>
                                                <span>{g.event.event_date ? new Date(g.event.event_date).toLocaleString() : ''}</span>
                                            </div>
                                            <div className="flex items-center justify-between mt-3 text-xs text-white/60">
                                                <span>Seats: {g.totalSeats}</span>
                                                <span className={g.bookings[0]?.status === 'waiting' ? 'text-yellow-400' : 'text-green-400'}>
                                                    Status: {g.bookings[0]?.status === 'waiting' ? `waiting (position ${g.bookings[0]?.waiting_number})` : 'confirmed'}
                                                </span>
                                            </div>
                                            <div className="mt-4 flex items-center gap-2">
                                                <button onClick={async () => {
                                                    try {
                                                        // Load seats for each booking in the group
                                                        const seatLists = await Promise.all(g.bookings.map(async bk => {
                                                            const res = await API.get(`/bookings/${bk.booking_id}/seats`);
                                                            const arr = Array.isArray(res.data) ? res.data : [];
                                                            return arr.map(x => ({ ...x, booking_id: bk.booking_id }));
                                                        }));
                                                        const merged = seatLists.flat();
                                                        setManageSeats(merged);
                                                        setManageBooking({ event_id: g.event.event_id, event_name: g.event.event_name, grouped: true, bookings: g.bookings });
                                                        setShowManageSeatsModal(true);
                                                    } catch (e) {
                                                        setMessage('❌ Failed to load seats: ' + (e.response?.data?.error || e.message));
                                                    }
                                                }} className="px-3 py-1.5 text-xs rounded-lg bg-white/10 text-white hover:bg-white/15 border border-white/15 font-semibold">View</button>
                                                <button onClick={async () => {
                                                    try {
                                                        const ok = window.confirm('Cancel all your seats for this event?');
                                                        if (!ok) return;
                                                        // cancel each booking fully
                                                        await Promise.all(g.bookings.map(bk => API.post(`/bookings/${bk.booking_id}/cancel`)));
                                                        setMessage('✅ Booking(s) cancelled');
                                                        await Promise.all([fetchEvents(), fetchMyBookings(currentUserId)]);
                                                    } catch (e) {
                                                        setMessage('❌ Failed to cancel: ' + (e.response?.data?.error || e.message));
                                                    }
                                                }} className="px-3 py-1.5 text-xs rounded-lg bg-white/10 text-red-300 hover:bg-white/15 border border-white/15 font-semibold">Cancel</button>
                                            </div>
                                        </div>
                                    ));
                                })()}
                            </div>
                        )}
                    </div>
                </div>
            )}


            {/* Events organized by you */}
            {(!isSwitchView || isSwitchOrganizer) && (
                <div className="px-8 pb-20" id="organizer-events-list">
                    <div className="max-w-7xl mx-auto">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-6">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
                                        <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-semibold text-white">Events organized by you</h3>
                                        <p className="text-sm text-white/60">Events you manage</p>
                                    </div>
                                </div>
                                <div className="text-sm text-white/70">{managedEvents.length} events</div>
                            </div>
                            <button onClick={fetchEvents} className="px-3 py-1.5 bg-white/10 backdrop-blur-2xl border border-white/15 rounded-lg text-xs font-medium text-white hover:bg-white/15 shadow inline-flex items-center justify-center">
                                <svg width="18" height="18" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                    <path fill="#6597BB" stroke="#041E31" strokeWidth="3" d="M 93,62 C 83,82 65,96 48,96 32,96 19,89 15,79 L 5,90 5,53 40,53 29,63 c 0,0 5,14 26,14 16,0 38,-15 38,-15 z"/>
                                    <path fill="#6597BB" stroke="#041E31" strokeWidth="3" d="M 5,38 C 11,18 32,4 49,4 65,4 78,11 85,21 L 95,10 95,47 57,47 68,37 C 68,37 63,23 42,23 26,23 5,38 5,38 z"/>
                                </svg>
                            </button>
                        </div>

                        {managedEvents.length === 0 ? (
                            <div className="text-center py-10 bg-white/5 backdrop-blur-3xl rounded-2xl border border-white/10 shadow">
                                <p className="text-white/70">No events created yet. Use the Create Event button to add one.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {managedEvents.map((ev) => {
                                    const org = organizations.find(o => o.id === ev.org_id);
                                    return (
                                        <div key={`org-${ev.id}`} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                                            <div className="mb-3 h-1.5 w-12 rounded-full" style={{ backgroundColor: (ev.category || '').toLowerCase() === 'hackathon' ? 'rgba(168,85,247,0.6)' : (ev.category || '').toLowerCase() === 'concert' ? 'rgba(0,255,255,0.6)' : 'rgba(255,255,255,0.25)' }}></div>
                                            <div className="flex items-center justify-between">
                                                <div className="text-lg font-semibold text-white">{ev.name}</div>
                                                <span className="text-xs text-white/60">{org?.name || '—'}</span>
                                            </div>
                                            <div className="text-sm text-white/70 mt-1 line-clamp-2">{ev.description || 'No description'}</div>
                                            <div className="flex items-center justify-between text-xs text-white/80 mt-2">
                                                <span>{ev.category}</span>
                                                <span>{ev.event_date ? new Date(ev.event_date).toLocaleString() : ''}</span>
                                            </div>
                                            <div className="flex items-center justify-between mt-3 text-xs text-white/60">
                                                <span>Total: {ev.total_slots}</span>
                                                <span>Available: {ev.available_slots}</span>
                                            </div>
                                            <div className="mt-4 flex items-center gap-2">
                                                <button
                                                    onClick={() => { setEditingEvent(ev); setEditDescription(ev.description || ""); setShowEditModal(true); }}
                                                    className="p-2 text-white/80 hover:text-white transition inline-flex items-center"
                                                    aria-label="Edit event"
                                                    title="Edit"
                                                >
                                                    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                                        <line x1="21" y1="21" x2="3" y2="21" stroke="rgb(44,169,188)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                        <path d="M19.88,7,11,15.83,7,17l1.17-4,8.88-8.88A2.09,2.09,0,0,1,20,4,2.09,2.09,0,0,1,19.88,7Z" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                </button>
                                                <button onClick={async () => {
                                                    if (!confirm('Delete this event?')) return;
                                                    try { await API.delete(`/events/${ev.id}`); await fetchEvents(); setMessage('✅ Event deleted'); } catch (e) { setMessage('❌ Failed to delete: ' + (e.response?.data?.error || e.message)); }
                                                }} className="p-2 text-red-300 hover:text-red-400 transition inline-flex items-center" aria-label="Delete event" title="Delete">
                                                    <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                                        <path d="M9 10V44H39V10H9Z" fill="#2F88FF" stroke="#fff" strokeWidth="3" strokeLinejoin="round"/>
                                                        <path d="M20 20V33" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                                                        <path d="M28 20V33" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                                                        <path d="M4 10H44" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                                                        <path d="M16 10L19.289 4H28.7771L32 10H16Z" fill="#2F88FF" stroke="#fff" strokeWidth="3" strokeLinejoin="round"/>
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modal: Create Event */}
            {showCreateModal && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}></div>
                    <div className="relative bg-black/90 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 w-full max-w-6xl mx-4 max-h-[90vh] overflow-y-auto">
                        {/* Header */}
                        <div className="sticky top-0 bg-black/90 backdrop-blur-xl border-b border-white/10 p-6 rounded-t-3xl">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-cyan-300/20 text-cyan-300 flex items-center justify-center">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                        </div>
                                    <div>
                                        <h3 className="text-2xl font-bold text-white">Create Event</h3>
                                        <p className="text-sm text-white/60">Fill in the details to create a new event</p>
                                    </div>
                                </div>
                                <button onClick={() => setShowCreateModal(false)} className="w-8 h-8 rounded-lg bg-white/10 text-white/60 hover:text-white hover:bg-white/20 flex items-center justify-center transition-all">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* Form Content */}
                        <div className="p-6 space-y-6">
                            {/* Basic Information */}
                            <div className="space-y-4">
                                <h4 className="text-lg font-semibold text-white flex items-center gap-2">
                                    <div className="w-1 h-6 bg-cyan-300 rounded-full"></div>
                                    Basic Information
                                </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Organization *</label>
                                {isSwitchView ? (
                                            <select value={newEvent.org_id || String(switchOrgId || '')} onChange={(e) => setNewEvent({ ...newEvent, org_id: e.target.value })} disabled className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white/60 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300">
                                        <option value={String(switchOrgId || '')}>{organizations.find(o => String(o.id) === String(switchOrgId))?.name || 'Selected organization'}</option>
                                    </select>
                                ) : (
                                            <select value={newEvent.org_id} onChange={(e) => setNewEvent({ ...newEvent, org_id: e.target.value })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300">
                                        <option value="">Select organization</option>
                                        {organizations.filter(o => String(o.role).toLowerCase() === 'organizer').map(o => (
                                            <option key={o.id} value={o.id}>{o.name}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                            <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Event Name *</label>
                                        <input value={newEvent.name} onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white placeholder-white/50 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300" placeholder="Enter event name" />
                            </div>
                            </div>
                            <div>
                                    <label className="block text-sm font-medium text-white/80 mb-2">Description</label>
                                    <textarea value={newEvent.description} onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white placeholder-white/50 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300" rows={3} placeholder="Describe your event..." />
                                </div>
                            </div>

                            {/* Event Details */}
                            <div className="space-y-4">
                                <h4 className="text-lg font-semibold text-white flex items-center gap-2">
                                    <div className="w-1 h-6 bg-cyan-300 rounded-full"></div>
                                    Event Details
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Category</label>
                                        <select value={newEvent.category} onChange={(e) => setNewEvent({ ...newEvent, category: e.target.value })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300">
                                    <option value="webinar">Webinar</option>
                                            <option value="conference">Conference</option>
                                            <option value="workshop">Workshop</option>
                                    <option value="hackathon">Hackathon</option>
                                            <option value="meetup">Meetup</option>
                                            <option value="concert">Concert</option>
                                            <option value="exhibition">Exhibition</option>
                                            <option value="other">Other</option>
                                </select>
                            </div>
                            <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Event Type</label>
                                        <select value={newEvent.event_type} onChange={(e) => setNewEvent({ ...newEvent, event_type: e.target.value })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300">
                                            <option value="online">Online</option>
                                            <option value="offline">Offline</option>
                                            <option value="hybrid">Hybrid</option>
                                        </select>
                            </div>
                            <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Duration (minutes)</label>
                                        <input type="number" min={15} step={15} value={newEvent.duration} onChange={(e) => setNewEvent({ ...newEvent, duration: Number(e.target.value) || 60 })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white placeholder-white/50 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300" placeholder="60" />
                            </div>
                        </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Event Date & Time *</label>
                                        <input type="datetime-local" value={newEvent.event_date} onChange={(e) => setNewEvent({ ...newEvent, event_date: e.target.value })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Location</label>
                                        <input value={newEvent.location} onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white placeholder-white/50 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300" placeholder="Event location or online link" />
                                    </div>
                                </div>
                            </div>

                            {/* Capacity & Pricing */}
                            <div className="space-y-4">
                                <h4 className="text-lg font-semibold text-white flex items-center gap-2">
                                    <div className="w-1 h-6 bg-cyan-300 rounded-full"></div>
                                    Capacity & Pricing
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Total Slots</label>
                                        <input type="number" min={1} value={newEvent.total_slots} onChange={(e) => setNewEvent({ ...newEvent, total_slots: Math.max(1, Number(e.target.value) || 1) })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Max Attendees</label>
                                        <input type="number" min={1} value={newEvent.max_attendees} onChange={(e) => setNewEvent({ ...newEvent, max_attendees: Math.max(1, Number(e.target.value) || 100) })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Price ($)</label>
                                        <input type="number" min={0} step={0.01} value={newEvent.price} onChange={(e) => setNewEvent({ ...newEvent, price: Number(e.target.value) || 0 })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300" placeholder="0.00" />
                                    </div>
                                </div>
                            </div>

                            {/* Additional Information */}
                            <div className="space-y-4">
                                <h4 className="text-lg font-semibold text-white flex items-center gap-2">
                                    <div className="w-1 h-6 bg-cyan-300 rounded-full"></div>
                                    Additional Information
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Tags</label>
                                        <input value={newEvent.tags} onChange={(e) => setNewEvent({ ...newEvent, tags: e.target.value })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white placeholder-white/50 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300" placeholder="tech, workshop, free (comma separated)" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Requirements</label>
                                        <input value={newEvent.requirements} onChange={(e) => setNewEvent({ ...newEvent, requirements: e.target.value })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white placeholder-white/50 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300" placeholder="Laptop, internet connection, etc." />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Contact Email</label>
                                        <input type="email" value={newEvent.contact_email} onChange={(e) => setNewEvent({ ...newEvent, contact_email: e.target.value })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white placeholder-white/50 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300" placeholder="contact@example.com" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-white/80 mb-2">Contact Phone</label>
                                        <input type="tel" value={newEvent.contact_phone} onChange={(e) => setNewEvent({ ...newEvent, contact_phone: e.target.value })} className="w-full border border-white/20 rounded-xl px-4 py-3 text-sm bg-white/5 text-white placeholder-white/50 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300" placeholder="+1 (555) 123-4567" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="sticky bottom-0 bg-black/90 backdrop-blur-xl border-t border-white/10 p-6 rounded-b-3xl">
                            <div className="flex items-center justify-between gap-4">
                                <div className="text-xs text-white/60">
                                    * Required fields
                                </div>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setShowCreateModal(false)} className="px-6 py-3 rounded-xl border border-white/20 text-white/80 font-medium hover:bg-white/10 transition-all">
                                        Cancel
                                    </button>
                            <button disabled={creating} onClick={async () => {
                                if (!newEvent.org_id || !newEvent.name || !newEvent.event_date) {
                                    setMessage("❌ Please fill organization, name and date");
                                    return;
                                }
                                setCreating(true);
                                setMessage("");
                                try {
                                    await API.post('/events', {
                                        org_id: isSwitchView ? (newEvent.org_id || switchOrgId) : newEvent.org_id,
                                        name: newEvent.name,
                                        description: newEvent.description,
                                        category: newEvent.category,
                                        event_date: newEvent.event_date,
                                        total_slots: newEvent.total_slots,
                                        location: newEvent.location,
                                        price: newEvent.price,
                                        max_attendees: newEvent.max_attendees,
                                        tags: newEvent.tags,
                                        event_type: newEvent.event_type,
                                        duration: newEvent.duration,
                                        requirements: newEvent.requirements,
                                        contact_email: newEvent.contact_email,
                                        contact_phone: newEvent.contact_phone,
                                        created_by: currentUserId
                                    });
                                            setMessage("✅ Event created successfully");
                                    await fetchEvents();
                                            setNewEvent({ 
                                                org_id: "", 
                                                name: "", 
                                                description: "", 
                                                category: "webinar", 
                                                event_date: "", 
                                                total_slots: 50,
                                                location: "",
                                                price: 0,
                                                max_attendees: 100,
                                                tags: "",
                                                event_type: "online",
                                                duration: 60,
                                                requirements: "",
                                                contact_email: "",
                                                contact_phone: ""
                                            });
                                    setShowCreateModal(false);
                                    try { document.getElementById('organizer-events-list')?.scrollIntoView({ behavior: 'smooth' }); } catch (_) { }
                                } catch (e) {
                                    setMessage("❌ Failed to create event: " + (e.response?.data?.error || e.message));
                                } finally {
                                    setCreating(false);
                                }
                                    }} className="px-8 py-3 bg-cyan-300 hover:bg-cyan-400 text-black font-semibold rounded-xl transition-all disabled:opacity-50 flex items-center gap-2">
                                        {creating ? (
                                            <>
                                                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
                                                    <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor"/>
                                                </svg>
                                                Creating...
                                            </>
                                        ) : (
                                            <>
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                                </svg>
                                                Create Event
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Edit Event Description */}
            {showEditModal && editingEvent && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setShowEditModal(false)}></div>
                    <div className="relative bg-black/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 w-full max-w-xl mx-4 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-semibold text-white">Edit Event</h3>
                            <button onClick={() => setShowEditModal(false)} className="text-white/60 hover:text-white">✕</button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-white/60 mb-1">Name</label>
                                <input disabled value={editingEvent.name || ''} className="w-full border border-white/20 rounded-lg px-3 py-2 text-sm bg-white/5 text-white placeholder-white/50" />
                            </div>
                            <div>
                                <label className="block text-sm text-white/60 mb-1">Description</label>
                                <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="w-full border border-white/20 rounded-lg px-3 py-2 text-sm bg-white/5 text-white placeholder-white/50 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 outline-none transition-all duration-300" rows={4} placeholder="Event description" />
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <button onClick={() => setShowEditModal(false)} className="px-4 py-2 rounded-xl border border-white/20 text-white/80 font-medium hover:bg-white/10 text-sm">Cancel</button>
                            <button onClick={async () => {
                                try {
                                    await API.put(`/events/${editingEvent.id}`, { description: editDescription });
                                    setMessage('✅ Event updated');
                                    await fetchEvents();
                                    setShowEditModal(false);
                                } catch (e) {
                                    setMessage('❌ Failed to update: ' + (e.response?.data?.error || e.message));
                                }
                            }} className="px-6 py-2 bg-cyan-300 hover:bg-cyan-400 text-black rounded-xl text-sm font-semibold">Save</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Manage Seats for a Booking */}
            {showManageSeatsModal && manageBooking && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowManageSeatsModal(false)}></div>
                    <div className="relative bg-black/90 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden">
                        {/* Header */}
                        <div className="sticky top-0 bg-black/90 backdrop-blur-xl border-b border-white/10 p-6 rounded-t-3xl">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-cyan-300/20 text-cyan-300 flex items-center justify-center">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                        </div>
                                    <div>
                                        <h3 className="text-2xl font-bold text-white">Manage Seats</h3>
                                        <p className="text-sm text-white/60">{manageBooking.event_name}</p>
                                    </div>
                                </div>
                                <button onClick={() => setShowManageSeatsModal(false)} className="w-8 h-8 rounded-lg bg-white/10 text-white/60 hover:text-white hover:bg-white/20 flex items-center justify-center transition-all">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-6">
                            {/* Urgency banner with global countdown and limited slots */}
                            <div className="mb-4">
                                {(() => {
                                    try {
                                        const selected = Array.isArray(seatSelect?.seats) ? seatSelect.seats.filter(s => s.selected && typeof s._countdown === 'number') : [];
                                        if (selected.length > 0) {
                                            const remaining = Math.max(0, Math.min(...selected.map(s => s._countdown)));
                                            const pct = Math.max(0, Math.min(100, (remaining / 10) * 100));
                                            return (
                                                <div className="p-3 rounded-xl border border-yellow-400/30 bg-yellow-400/10 text-yellow-300 text-sm flex items-center gap-4">
                                                    <span className="font-medium">Your selection is on hold. Hurry up — confirm within <span className="font-bold">{remaining}s</span>.</span>
                                                    <div className="ml-auto w-40 h-2 bg-white/10 rounded-full overflow-hidden">
                                                        <div style={{ width: `${pct}%` }} className="h-2 bg-yellow-400"></div>
                                                    </div>
                                                </div>
                                            );
                                        }
                                        const left = Number(seatSelect?.event?.available_slots ?? 0);
                                        return (
                                            <div className="p-3 rounded-xl border border-white/10 bg-white/5 text-white/80 text-sm flex items-center gap-3">
                                                <span className="font-medium">Hurry up! Limited slots left</span>
                                                <span className="px-2 py-0.5 rounded-lg bg-cyan-300/15 text-cyan-300 border border-cyan-300/30 text-xs">{left}</span>
                                            </div>
                                        );
                                    } catch {
                                        return null;
                                    }
                                })()}
                            </div>
                            <div className="mb-6 p-4 rounded-xl bg-white/5 border border-white/10">
                                <p className="text-sm text-white/80">Select seats to cancel. Confirmed seats are listed below.</p>
                            </div>
                            
                            <div className="grid grid-cols-6 gap-3 max-h-60 overflow-y-auto p-4 bg-white/5 rounded-xl border border-white/10">
                            {manageSeats.map((s, idx) => (
                                    <label key={`${s.booking_id || 'b'}-${s.seat_no}-${idx}`} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl border transition-all cursor-pointer ${s.status === 'booked' ? 'bg-green-500/20 border-green-500/30 text-green-300 hover:bg-green-500/30' : 'bg-white/5 border-white/20 text-white/60 opacity-60 cursor-not-allowed'}`}>
                                        <input 
                                            type="checkbox" 
                                            disabled={s.status !== 'booked'} 
                                            onChange={(e) => {
                                        if (e.target.checked) setManageSeats(prev => prev.map((x, i) => i === idx ? { ...x, _selected: true } : x));
                                        else setManageSeats(prev => prev.map((x, i) => i === idx ? { ...x, _selected: false } : x));
                                            }} 
                                            className="w-4 h-4 rounded border-white/20 bg-white/5 text-cyan-300 focus:ring-cyan-300 focus:ring-2"
                                        />
                                    Seat {s.seat_no}
                                </label>
                            ))}
                        </div>
                        </div>

                        {/* Footer */}
                        <div className="sticky bottom-0 bg-black/90 backdrop-blur-xl border-t border-white/10 p-6 rounded-b-3xl">
                            <div className="flex items-center justify-between gap-4">
                                <div className="text-xs text-white/60">
                                    {manageSeats.filter(s => s._selected && s.status === 'booked').length} seat(s) selected for cancellation
                                </div>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setShowManageSeatsModal(false)} className="px-6 py-3 rounded-xl border border-white/20 text-white/80 font-medium hover:bg-white/10 transition-all">
                                        Close
                                    </button>
                            <button onClick={async () => {
                                const selected = manageSeats.filter(s => s._selected && s.status === 'booked');
                                if (selected.length === 0) { setShowManageSeatsModal(false); return; }
                                try {
                                    const ok = window.confirm(`Cancel ${selected.length} seat(s)?`);
                                    if (!ok) return;
                                    if (manageBooking?.grouped) {
                                        // group by booking_id and call API per booking
                                        const byBooking = new Map();
                                        for (const s of selected) {
                                            if (!byBooking.has(s.booking_id)) byBooking.set(s.booking_id, []);
                                            byBooking.get(s.booking_id).push(s.seat_no);
                                        }
                                        for (const [bid, seatNos] of byBooking.entries()) {
                                            await API.post(`/bookings/${bid}/cancel-seats`, { seat_numbers: seatNos });
                                        }
                                    } else {
                                        const toCancel = selected.map(s => s.seat_no);
                                        await API.post(`/bookings/${manageBooking.booking_id}/cancel-seats`, { seat_numbers: toCancel });
                                    }
                                    setMessage('✅ Selected seats cancelled');
                                    setShowManageSeatsModal(false);
                                    await Promise.all([fetchEvents(), fetchMyBookings(currentUserId)]);
                                } catch (e) {
                                    setMessage('❌ Failed to cancel seats: ' + (e.response?.data?.error || e.message));
                                }
                                    }} className="px-8 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold transition-all">
                                        Cancel Selected
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Seat selection modal for booking */}
            {showSeatSelect && seatSelect?.event && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowSeatSelect(false)}></div>
                    <div className="relative bg-black/90 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden">
                        {/* Header */}
                        <div className="sticky top-0 bg-black/90 backdrop-blur-xl border-b border-white/10 p-6 rounded-t-3xl">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-cyan-300/20 text-cyan-300 flex items-center justify-center">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                        </div>
                                    <div>
                                        <h3 className="text-2xl font-bold text-white">Select Seats</h3>
                                        <p className="text-sm text-white/60">{seatSelect.event.name}</p>
                                    </div>
                                </div>
                                <button onClick={() => setShowSeatSelect(false)} className="w-8 h-8 rounded-lg bg-white/10 text-white/60 hover:text-white hover:bg-white/20 flex items-center justify-center transition-all">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* Socket wiring */}
                        <SeatRealtime
                            eventId={seatSelect.event.id}
                            socketRef={socketRef}
                            seatSelect={seatSelect}
                            setSeatSelect={setSeatSelect}
                            holdTimersRef={holdTimersRef}
                        />

                        {/* Content */}
                        <div className="p-6">
                            {/* Legend */}
                            <div className="mb-6 p-4 rounded-xl bg-white/5 border border-white/10">
                                <div className="flex items-center gap-6 text-sm">
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 rounded bg-green-500"></div>
                                        <span className="text-white/80">Available</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 rounded bg-red-500"></div>
                                        <span className="text-white/80">Booked</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 rounded bg-cyan-300"></div>
                                        <span className="text-white/80">Selected</span>
                                    </div>
                                    {typeof seatSelect?.max === 'number' && (
                                        <div className="ml-auto text-cyan-300 font-medium">
                                            Max: {seatSelect.max} seats
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Seat Grid */}
                            <div className="grid grid-cols-8 md:grid-cols-10 gap-3 max-h-[400px] overflow-y-auto p-4 bg-white/5 rounded-xl border border-white/10">
                                {seatSelect.seats.map(s => (
                                    <button
                                        key={s.seat_no}
                                        disabled={s.taken || (s.held && !s.selected)}
                                        onClick={() => {
                                            const sock = socketRef.current;
                                            if (!sock) return;
                                            // Toggle selection: if already selected by me, release; else try to hold
                                            if (s.selected) {
                                                // Stop keepalive
                                                const key = s.seat_no;
                                                if (holdTimersRef.current.has(key)) {
                                                    clearInterval(holdTimersRef.current.get(key));
                                                    holdTimersRef.current.delete(key);
                                                }
                                                sock.emit('seat:release', { eventId: seatSelect.event.id, seatNo: s.seat_no }, () => {});
                                                setSeatSelect(prev => ({
                                                    ...prev,
                                                    seats: prev.seats.map(x => x.seat_no === s.seat_no ? { ...x, selected: false, held: false } : x)
                                                }));
                                                return;
                                            }

                                            // Try to hold seat via socket first with a 10s TTL
                                            sock.emit('seat:hold', { eventId: seatSelect.event.id, seatNo: s.seat_no, ttlSec: 10 }, (resp) => {
                                                if (resp?.ok) {
                                                    const ttl = Number(resp.ttl || 10);
                                                    // mark selected, held and start a local countdown
                                                    setSeatSelect(prev => ({
                                                        ...prev,
                                                        seats: prev.seats.map(x => x.seat_no === s.seat_no ? { ...x, selected: true, held: true, _countdown: ttl } : x)
                                                    }));
                                                    const key = s.seat_no;
                                                    if (holdTimersRef.current.has(key)) clearInterval(holdTimersRef.current.get(key));
                                                    const id = setInterval(() => {
                                                        setSeatSelect(prev => {
                                                            const nextSeats = prev.seats.map(x => {
                                                                if (x.seat_no !== key) return x;
                                                                const remaining = typeof x._countdown === 'number' ? x._countdown - 1 : ttl - 1;
                                                                if (remaining <= 0) {
                                                                    // stop timer; server will auto-release; reflect locally
                                                                    try { clearInterval(holdTimersRef.current.get(key)); holdTimersRef.current.delete(key); } catch {}
                                                                    return { ...x, selected: false, held: false, _countdown: 0 };
                                                                }
                                                                return { ...x, _countdown: remaining };
                                                            });
                                                            return { ...prev, seats: nextSeats };
                                                        });
                                                    }, 1000);
                                                    holdTimersRef.current.set(key, id);
                                                } else {
                                                    setSeatSelect(prev => ({
                                                        ...prev,
                                                        seats: prev.seats.map(x => x.seat_no === s.seat_no ? { ...x, held: true, selected: false } : x)
                                                    }));
                                                }
                                            });
                                        }}
                                        className={`
                                            relative w-12 h-12 rounded-xl text-sm font-semibold transition-all duration-200 transform hover:scale-105 active:scale-95
                                            ${s.taken
                                                ? 'bg-red-500/20 text-red-400 border border-red-500/30 cursor-not-allowed opacity-60'
                                                : s.selected
                                                    ? 'bg-cyan-300 text-black border-2 border-cyan-300 shadow-lg shadow-cyan-300/25'
                                                    : s.held
                                                        ? 'bg-yellow-400/30 text-yellow-300 border border-yellow-400/40 cursor-not-allowed'
                                                        : 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 hover:border-green-400'
                                            }
                                        `}
                                    >
                                    {s.seat_no}
                                    {s.selected && typeof s._countdown === 'number' && (
                                        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/70 border border-white/20 text-white text-[10px] flex items-center justify-center">
                                            {s._countdown}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>

                            {/* Selection Summary */}
                            <div className="mt-6 p-4 rounded-xl bg-white/5 border border-white/10">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="text-sm text-white/60">
                                            Selected Seats: 
                                            <span className="ml-2 text-cyan-300 font-semibold text-lg">
                                                {seatSelect.seats.filter(s => s.selected).length}
                                            </span>
                                        </div>
                                        {seatSelect.seats.filter(s => s.selected).length > 0 && (
                                            <div className="text-xs text-white/50">
                                                {seatSelect.seats.filter(s => s.selected).map(s => s.seat_no).join(', ')}
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-sm text-white/60">
                                        Total Available: {seatSelect.seats.filter(s => !s.taken).length}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="sticky bottom-0 bg-black/90 backdrop-blur-xl border-t border-white/10 p-6 rounded-b-3xl">
                            <div className="flex items-center justify-between gap-4">
                                <div className="text-xs text-white/60">
                                    {seatSelect.seats.filter(s => s.selected).length === 0 
                                        ? "Select at least one seat to continue"
                                        : `${seatSelect.seats.filter(s => s.selected).length} seat(s) selected`
                                    }
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => {
                                            try {
                                                const sock = socketRef.current;
                                                if (sock && seatSelect?.seats) {
                                                    const owned = seatSelect.seats.filter(x => x.selected);
                                                    for (const x of owned) {
                                                        // stop timers and release
                                                        if (holdTimersRef.current.has(x.seat_no)) {
                                                            clearInterval(holdTimersRef.current.get(x.seat_no));
                                                            holdTimersRef.current.delete(x.seat_no);
                                                        }
                                                        sock.emit('seat:release', { eventId: seatSelect.event.id, seatNo: x.seat_no }, () => {});
                                                    }
                                                }
                                            } catch {}
                                            setShowSeatSelect(false);
                                        }} 
                                        className="px-6 py-3 rounded-xl border border-white/20 text-white/80 font-medium hover:bg-white/10 transition-all"
                                    >
                                        Close
                                    </button>
                                    <button 
                                        disabled={bookingLoading || seatSelect.seats.filter(s => s.selected).length === 0}
                                        onClick={async () => {
                                    const selected = seatSelect.seats.filter(s => s.selected).map(s => s.seat_no);
                                    if (selected.length === 0) {
                                        alert('Select at least 1 seat.');
                                        return;
                                    }
                                    if (typeof seatSelect?.max === 'number' && selected.length > seatSelect.max) {
                                        alert(`You can select up to ${seatSelect.max} seat(s).`);
                                        return;
                                    }
                                    try {
                                        setBookingLoading(true);
                                                await API.post('/bookings', { 
                                                    event_id: seatSelect.event.id, 
                                                    user_id: currentUserId, 
                                                    seats: selected.length, 
                                                    seat_numbers: selected 
                                                });
                                                setMessage('✅ Booking submitted successfully');
                                        setShowSeatSelect(false);
                                                // Release any holds we created
                                                try {
                                                    const sock = socketRef.current;
                                                    if (sock) {
                                                        const owned = seatSelect.seats.filter(x => x.selected);
                                                        for (const x of owned) {
                                                            sock.emit('seat:release', { eventId: seatSelect.event.id, seatNo: x.seat_no }, () => {});
                                                        }
                                                    }
                                                } catch {}
                                        await Promise.all([fetchEvents(), fetchMyBookings(currentUserId)]);
                                    } catch (e) {
                                        setMessage('❌ Failed to book: ' + (e.response?.data?.error || e.message));
                                    } finally {
                                        setBookingLoading(false);
                                    }
                                        }} 
                                        className="px-8 py-3 bg-cyan-300 hover:bg-cyan-400 text-black font-semibold rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {bookingLoading ? (
                                            <>
                                                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
                                                    <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor"/>
                                                </svg>
                                                Booking...
                                            </>
                                        ) : (
                                            <>
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                    <path d="M9 12L11 14L15 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                </svg>
                                                Book Selected
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Create Event button - only when allowed */}
            {(!isSwitchView || isSwitchOrganizer) && (
                <div className="fixed bottom-6 right-6 z-[9000] group">
                    {/* Tooltip */}
                    <div className="absolute bottom-full right-0 mb-3 px-3 py-2 bg-black/90 backdrop-blur-sm text-white text-sm font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0 pointer-events-none whitespace-nowrap">
                        Create Event
                        <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-black/90"></div>
                    </div>
                    
                    {/* Main Button */}
                <button
                    onClick={() => setShowCreateModal(true)}
                        className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-xl hover:shadow-2xl flex items-center justify-center transition-all duration-300 transform hover:scale-105 active:scale-95 group-hover:from-blue-600 group-hover:to-blue-700 border border-blue-400/20"
                    title="Create Event"
                >
                        {/* Background glow effect */}
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-400/20 to-blue-600/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                        
                        {/* Plus Icon */}
                        <svg 
                            width="24px" 
                            height="24px" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            xmlns="http://www.w3.org/2000/svg"
                            className="relative z-10 transition-transform duration-300 group-hover:rotate-90"
                        >
                            <path 
                                d="M12 5V19M5 12H19" 
                                stroke="currentColor" 
                                strokeWidth="2.5" 
                                strokeLinecap="round" 
                                strokeLinejoin="round"
                            />
                        </svg>
                        
                        {/* Ripple effect on click */}
                        <div className="absolute inset-0 rounded-2xl bg-white/20 scale-0 group-active:scale-100 transition-transform duration-150"></div>
                </button>
                </div>
            )}

            {/* Organization Details Modal */}
            {showOrgModal && selectedOrg && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6 z-50">
                    <div className="bg-black/90 backdrop-blur-xl rounded-3xl max-w-5xl w-full max-h-[90vh] overflow-y-auto border border-white/10 shadow-2xl">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-4 border-b border-white/10">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/20">
                                    <svg className="w-5 h-5 text-white/80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 4h12M6 4v16M6 4H5m13 0v16m0-16h1m-1 16H6m12 0h1M6 20H5M9 7h1v1H9V7Zm5 0h1v1h-1V7Zm-5 4h1v1H9v-1Zm5 0h1v1h-1v-1Zm-3 4h2a1 1 0 0 1 1 1v4h-4v-4a1 1 0 0 1 1-1Z"/>
                                    </svg>
                                </div>
                                <div>
                                    <h2 className="text-xl font-extrabold text-white">{selectedOrg.name}</h2>
                                    <p className="text-white/60 text-xs mt-0.5">Organization Overview</p>
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    setShowOrgModal(false);
                                    setSelectedOrg(null);
                                    setOrgMembers([]);
                                }}
                                className="w-9 h-9 bg-white/10 hover:bg-white/20 rounded-lg flex items-center justify-center text-white/60 hover:text-white transition-all border border-white/20"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="p-6">
                            {/* Organization Snapshot */}
                            <div className="grid md:grid-cols-3 gap-6 mb-8">
                                <div className="space-y-4 md:col-span-1">
                                    <h3 className="text-sm font-bold text-white">Organization Snapshot</h3>
                                    <div className="space-y-3">
                                        <div>
                                            <span className="text-white/60 text-xs">Name</span>
                                            <p className="font-medium text-white">{selectedOrg.name}</p>
                                        </div>
                                        <div>
                                            <span className="text-white/60 text-xs">Owner</span>
                                            <p className="font-medium text-white">
                                                {selectedOrg.owner_username || (selectedOrg.name?.startsWith('org-of-') ? selectedOrg.name.replace('org-of-', '').charAt(0).toUpperCase() + selectedOrg.name.replace('org-of-', '').slice(1) : 'Unknown')}
                                            </p>
                                        </div>
                                        <div>
                                            <span className="text-white/60 text-xs">Created</span>
                                            <p className="font-medium text-white">
                                                {new Date(selectedOrg.created_at).toLocaleDateString()}
                                            </p>
                                        </div>
                                        <div>
                                            <span className="text-white/60 text-xs">Members</span>
                                            <p className="font-medium text-white">{selectedOrg.member_count}</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-4 md:col-span-2">
                                    <h3 className="text-sm font-bold text-white">Your Membership</h3>
                                    <div className="space-y-3">
                                        <div>
                                            <span className="text-white/60 text-xs">Role</span>
                                            <div className="mt-1">
                                                <span className={`px-3 py-1 rounded-full text-[0.7rem] font-bold uppercase ${
                                                    String(selectedOrg.role).toLowerCase() === 'orgadmin' || String(selectedOrg.role).toLowerCase() === 'owner' 
                                                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                                                    String(selectedOrg.role).toLowerCase() === 'organizer'
                                                        ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                                                        'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                                }`}>
                                                    {String(selectedOrg.role).toLowerCase() === 'orgadmin' || String(selectedOrg.role).toLowerCase() === 'owner' ? 'Admin' :
                                                     String(selectedOrg.role).toLowerCase() === 'organizer' ? 'Organizer' : 'Member'}
                                                </span>
                                            </div>
                                        </div>
                                        {selectedOrg.joined_at && (
                                            <div>
                                                <span className="text-white/60 text-xs">Joined</span>
                                                <p className="font-medium text-white">
                                                    {new Date(selectedOrg.joined_at).toLocaleDateString()}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Members Directory */}
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-sm font-bold text-white">Member Directory</h3>
                                    <button 
                                        onClick={() => fetchOrgMembers(selectedOrg.id)}
                                        className="px-3 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 rounded-lg text-xs font-semibold transition-all duration-300"
                                    >
                                        Refresh
                                    </button>
                                </div>
                                {loadingMembers ? (
                                    <div className="text-center py-8">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto mb-4"></div>
                                        <p className="text-white/60 text-sm">Loading members...</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3 max-h-64 overflow-y-auto">
                                        {orgMembers.map((member) => (
                                            <div
                                                key={member.id}
                                                className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 transition-all"
                                            >
                                                <div className="flex items-center space-x-3">
                                                    <div className="w-8 h-8 bg-cyan-500 text-white rounded-full flex items-center justify-center">
                                                        <span className="text-white text-sm font-semibold">
                                                            {member.username.charAt(0).toUpperCase()}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-white">{member.username}</p>
                                                        <p className="text-sm text-white/60">{member.email}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <span className={`px-3 py-1 rounded-full text-[0.7rem] font-bold uppercase ${
                                                        String(member.role).toLowerCase() === 'orgadmin' || String(member.role).toLowerCase() === 'owner' 
                                                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                                                        String(member.role).toLowerCase() === 'organizer'
                                                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                                                            'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                                    }`}>
                                                        {String(member.role).toLowerCase() === 'orgadmin' || String(member.role).toLowerCase() === 'owner' ? 'Admin' :
                                                         String(member.role).toLowerCase() === 'organizer' ? 'Organizer' : 'Member'}
                                                    </span>
                                                    <p className="text-xs text-white/60 mt-1">
                                                        Joined {new Date(member.joined_at).toLocaleDateString()}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="flex justify-end space-x-3 p-4 border-t border-white/10">
                            <button
                                onClick={() => {
                                    setShowOrgModal(false);
                                    setSelectedOrg(null);
                                    setOrgMembers([]);
                                }}
                                className="px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 rounded-lg text-sm font-semibold transition-all duration-300"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {message && (
                <div className={`max-w-7xl mx-auto mb-6 px-8 ${message.includes('✅') ? 'text-green-400' : 'text-red-400'}`}>{message}</div>
            )}
        </div>
    );
}

// Lightweight component to attach to socket events and keep local state in sync
function SeatRealtime({ eventId, socketRef, seatSelect, setSeatSelect, holdTimersRef }) {
    useEffect(() => {
        const sock = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000', {
            transports: ['websocket'],
        });
        socketRef.current = sock;
        sock.emit('seats:join', { eventId });

        const onSnapshot = ({ eventId: eid, held }) => {
            if (eid !== eventId) return;
            setSeatSelect(prev => ({
                ...prev,
                // Overwrite held state from snapshot for all seats so viewers stay in sync
                seats: prev.seats.map(s => ({ ...s, held: held.includes(s.seat_no) }))
            }));
        };
        const onHeld = ({ eventId: eid, seatNo }) => {
            if (eid !== eventId) return;
            setSeatSelect(prev => ({
                ...prev,
                seats: prev.seats.map(s => s.seat_no === seatNo ? { ...s, held: true } : s)
            }));
        };
        const onReleased = ({ eventId: eid, seatNo }) => {
            if (eid !== eventId) return;
            setSeatSelect(prev => ({
                ...prev,
                seats: prev.seats.map(s => s.seat_no === seatNo ? { ...s, held: false, selected: false } : s)
            }));
        };

        sock.on('seats:snapshot', onSnapshot);
        sock.on('seat:held', onHeld);
        sock.on('seat:released', onReleased);
        const onBooked = ({ eventId: eid, seatNo }) => {
            if (eid !== eventId) return;
            setSeatSelect(prev => ({
                ...prev,
                seats: prev.seats.map(s => s.seat_no === seatNo ? { ...s, taken: true, held: false, selected: false, _countdown: 0 } : s)
            }));
        };
        const onFreed = ({ eventId: eid, seatNo }) => {
            if (eid !== eventId) return;
            setSeatSelect(prev => ({
                ...prev,
                seats: prev.seats.map(s => s.seat_no === seatNo ? { ...s, taken: false, held: false, selected: false, _countdown: 0 } : s)
            }));
        };
        sock.on('seat:booked', onBooked);
        sock.on('seat:freed', onFreed);

        // Periodic reconciliation to reflect TTL expiries even if no release event fires
        const reconcileId = setInterval(() => {
            try { sock.emit('seats:snapshot:request', { eventId }); } catch {}
        }, 3000);

        return () => {
            try {
                // clear local timers
                for (const id of holdTimersRef.current.values()) clearInterval(id);
                holdTimersRef.current.clear();
            } catch {}
            clearInterval(reconcileId);
            sock.off('seats:snapshot', onSnapshot);
            sock.off('seat:held', onHeld);
            sock.off('seat:released', onReleased);
            sock.off('seat:booked', onBooked);
            sock.off('seat:freed', onFreed);
            sock.disconnect();
            socketRef.current = null;
        };
    }, [eventId]);

    return null;
}
