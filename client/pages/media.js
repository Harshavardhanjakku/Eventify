import { useEffect, useMemo, useState } from "react";
import API from "../lib/api";
import InvitationsButton from "../components/InvitationsButton";
import { useRouter } from "next/router";

export default function MediaPage({ keycloak }) {
    const [events, setEvents] = useState([]);
    const [organizations, setOrganizations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentUserId, setCurrentUserId] = useState(null);
    // Booking flow now happens via the View → seat selection modal only
    const [bookingLoading, setBookingLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [myBookings, setMyBookings] = useState([]);
    // Create-event form state
    const [creating, setCreating] = useState(false);
    const [newEvent, setNewEvent] = useState({ org_id: "", name: "", description: "", category: "webinar", event_date: "", total_slots: 50 });
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
    // Organization modal state
    const [showOrgModal, setShowOrgModal] = useState(false);
    const [selectedOrg, setSelectedOrg] = useState(null);
    const [orgMembers, setOrgMembers] = useState([]);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const router = useRouter();
    const switchOrgId = router?.query?.id || router?.query?.orgId || null;
    const isSwitchView = Boolean(switchOrgId);

    const toLower = (v) => String(v || '').toLowerCase();
    const userOrgIdsForBooking = useMemo(() => {
        const ids = new Set();
        for (const o of organizations) {
            const r = toLower(o.role);
            if (r === 'user' || r === 'customer' || r === 'viewer') ids.add(o.id);
        }
        return ids;
    }, [organizations]);

    const organizerOrgIds = useMemo(() => {
        const ids = new Set();
        for (const o of organizations) {
            const r = toLower(o.role);
            if (r === 'organizer') ids.add(o.id);
        }
        return ids;
    }, [organizations]);

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

    const fetchOrganizationsForUser = async (userId) => {
        try {
            const res = await API.get(`/organizations/user/${userId}`);
            setOrganizations(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            console.error("Error fetching organizations for user", err);
            setOrganizations([]);
        }
    };

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
                    await Promise.all([
                        fetchOrganizationsForUser(uid),
                        fetchMyBookings(uid)
                    ]);
                }
                await fetchEvents();
            } finally {
                setLoading(false);
            }
        };
        init();
    }, [keycloak?.authenticated]);

    // Direct booking button removed; booking is handled inside the seat selection modal

    if (!keycloak?.authenticated) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center">
                <div className="text-center p-12 bg-white/80 backdrop-blur-3xl rounded-3xl border border-blue-200/50 shadow-2xl max-w-md">
                    <h2 className="text-3xl font-bold text-gray-800 mb-4 tracking-wide">Happening</h2>
                    <p className="text-gray-600 mb-8 leading-relaxed">Your multi-tenant support portal</p>
                    <button onClick={() => keycloak.login()} className="px-8 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-2xl hover:from-blue-400 hover:to-blue-500 transition-all font-bold shadow-2xl hover:shadow-3xl hover:scale-105 transform duration-300 border border-blue-300 tracking-wider">ENTER</button>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-6 shadow-2xl"></div>
                    <p className="text-gray-700 text-xl font-semibold tracking-wide">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white p-6">
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

            {/* Organizations Section */}
            <div className="px-8 pb-12">
                <div className="max-w-7xl mx-auto">
                    <div className="flex items-center justify-between mb-8">
                        <div className="flex items-center gap-6">
                            <h2 className="text-2xl font-bold text-white tracking-wide">Your Organizations</h2>
                            <div className="text-sm text-white/60">{organizations.length} organizations</div>
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
                                
                                return (
                                    <div key={org.id} className="group relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl p-6 hover:bg-white/10 transition-all duration-300">
                                        {/* Role indicator bar */}
                                        <div className={`absolute left-0 top-0 h-full w-1 rounded-l-2xl ${
                                            isAdmin ? 'bg-gradient-to-b from-purple-500 to-indigo-500' :
                                            isOrganizer ? 'bg-gradient-to-b from-blue-500 to-cyan-500' :
                                            'bg-gradient-to-b from-emerald-500 to-teal-500'
                                        }`}></div>
                                        
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
                                <h2 className="text-2xl font-bold text-white tracking-wide">Upcoming Events</h2>
                                <div className="text-sm text-white/60">{events.filter(ev => userOrgIdsForBooking.has(ev.org_id)).filter(ev => !isSwitchView || String(ev.org_id) === String(switchOrgId)).length} events</div>
                            </div>
                            <button onClick={fetchEvents} className="px-4 py-2 bg-white/10 backdrop-blur-xl border border-white/15 rounded-xl text-sm font-medium text-white hover:bg-white/15 transition-all duration-300 shadow-lg inline-flex items-center justify-center">
                                <svg width="20" height="20" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                    <path fill="#6597BB" stroke="#041E31" strokeWidth="3" d="M 93,62 C 83,82 65,96 48,96 32,96 19,89 15,79 L 5,90 5,53 40,53 29,63 c 0,0 5,14 26,14 16,0 38,-15 38,-15 z"/>
                                    <path fill="#6597BB" stroke="#041E31" strokeWidth="3" d="M 5,38 C 11,18 32,4 49,4 65,4 78,11 85,21 L 95,10 95,47 57,47 68,37 C 68,37 63,23 42,23 26,23 5,38 5,38 z"/>
                                </svg>
                            </button>
                        </div>

                        {events.filter(ev => userOrgIdsForBooking.has(ev.org_id)).filter(ev => !isSwitchView || String(ev.org_id) === String(switchOrgId)).length === 0 ? (
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
                                {events
                                    .filter(ev => userOrgIdsForBooking.has(ev.org_id))
                                    .filter(ev => !isSwitchView || String(ev.org_id) === String(switchOrgId))
                                    .map((ev) => (
                                        <div key={ev.id} className="group relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl p-4">
                                            <div className="text-lg font-semibold text-white mb-1">{ev.name}</div>
                                            <div className="text-sm text-white/70 mb-2 line-clamp-2">{ev.description || "No description"}</div>
                                            <div className="flex items-center justify-between text-sm text-white/80">
                                                <span>{ev.category || 'event'}</span>
                                                <span>{ev.event_date ? new Date(ev.event_date).toLocaleString() : ''}</span>
                                            </div>
                                            <div className="flex items-center justify-between mt-3 text-xs text-white/60">
                                                <span>Total: {ev.total_slots}</span>
                                                <span>Available: {ev.available_slots}</span>
                                            </div>
                                            <div className="mt-4 flex items-center gap-2">
                                                <button onClick={async () => {
                                                    try {
                                                        const res = await API.get(`/events/${ev.id}/seats`);
                                                        const { total, taken } = res.data || { total: ev.total_slots, taken: [] };
                                                        // Build seat grid metadata
                                                        const seats = Array.from({ length: total }, (_, i) => ({ seat_no: i + 1, taken: taken?.includes(i + 1) }));
                                                        setSeatSelect({ event: ev, seats, max: Math.max(0, Number(ev.available_slots) || 0) });
                                                        setShowSeatSelect(true);
                                                    } catch (e) {
                                                        setMessage('❌ Failed to load seats: ' + (e.response?.data?.error || e.message));
                                                    }
                                                }} className="px-3 py-2 bg-white/10 text-white hover:bg-white/15 border border-white/15 rounded-xl text-sm font-semibold">Book</button>
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
                                <h2 className="text-2xl font-bold text-white tracking-wide">Your Events</h2>
                                <div className="text-sm text-white/60">{myBookings.length} bookings</div>
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
                                                <span>Status: confirmed</span>
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
                                <h3 className="text-xl font-semibold text-white">Events organized by you</h3>
                                <div className="text-sm text-white/70">{events.filter(ev => organizerOrgIds.has(ev.org_id)).filter(ev => !isSwitchView || String(ev.org_id) === String(switchOrgId)).length} events</div>
                            </div>
                            <button onClick={fetchEvents} className="px-3 py-1.5 bg-white/10 backdrop-blur-2xl border border-white/15 rounded-lg text-xs font-medium text-white hover:bg-white/15 shadow inline-flex items-center justify-center">
                                <svg width="18" height="18" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                    <path fill="#6597BB" stroke="#041E31" strokeWidth="3" d="M 93,62 C 83,82 65,96 48,96 32,96 19,89 15,79 L 5,90 5,53 40,53 29,63 c 0,0 5,14 26,14 16,0 38,-15 38,-15 z"/>
                                    <path fill="#6597BB" stroke="#041E31" strokeWidth="3" d="M 5,38 C 11,18 32,4 49,4 65,4 78,11 85,21 L 95,10 95,47 57,47 68,37 C 68,37 63,23 42,23 26,23 5,38 5,38 z"/>
                                </svg>
                            </button>
                        </div>

                        {events.filter(ev => organizerOrgIds.has(ev.org_id)).filter(ev => !isSwitchView || String(ev.org_id) === String(switchOrgId)).length === 0 ? (
                            <div className="text-center py-10 bg-white/80 backdrop-blur-3xl rounded-2xl border border-blue-200/50 shadow">
                                <p className="text-gray-600">No events created yet. Use the Create Event button to add one.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {events.filter(ev => organizerOrgIds.has(ev.org_id)).filter(ev => !isSwitchView || String(ev.org_id) === String(switchOrgId)).map((ev) => {
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
                <div className="fixed inset-0 z-[10000] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/40" onClick={() => setShowCreateModal(false)}></div>
                    <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-4xl mx-4 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-semibold text-gray-800">Create Event</h3>
                            <button onClick={() => setShowCreateModal(false)} className="text-gray-500 hover:text-gray-700">✕</button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-gray-700 mb-1">Organization</label>
                                {isSwitchView ? (
                                    <select value={newEvent.org_id || String(switchOrgId || '')} onChange={(e) => setNewEvent({ ...newEvent, org_id: e.target.value })} disabled className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50">
                                        <option value={String(switchOrgId || '')}>{organizations.find(o => String(o.id) === String(switchOrgId))?.name || 'Selected organization'}</option>
                                    </select>
                                ) : (
                                    <select value={newEvent.org_id} onChange={(e) => setNewEvent({ ...newEvent, org_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                                        <option value="">Select organization</option>
                                        {organizations.filter(o => String(o.role).toLowerCase() === 'organizer').map(o => (
                                            <option key={o.id} value={o.id}>{o.name}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm text-gray-700 mb-1">Name</label>
                                <input value={newEvent.name} onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Event name" />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-sm text-gray-700 mb-1">Description</label>
                                <textarea value={newEvent.description} onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" rows={3} placeholder="Event description" />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-700 mb-1">Category</label>
                                <select value={newEvent.category} onChange={(e) => setNewEvent({ ...newEvent, category: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                                    <option value="webinar">Webinar</option>
                                    <option value="concert">Concert</option>
                                    <option value="hackathon">Hackathon</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-700 mb-1">Event Date & Time</label>
                                <input type="datetime-local" value={newEvent.event_date} onChange={(e) => setNewEvent({ ...newEvent, event_date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-700 mb-1">Total Slots</label>
                                <input type="number" min={1} value={newEvent.total_slots} onChange={(e) => setNewEvent({ ...newEvent, total_slots: Math.max(1, Number(e.target.value) || 1) })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                            </div>
                        </div>
                        <div className="mt-4 flex justify-end gap-2">
                            <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 rounded-xl border text-sm">Cancel</button>
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
                                        total_slots: newEvent.total_slots
                                    });
                                    setMessage("✅ Event created");
                                    await fetchEvents();
                                    setNewEvent({ org_id: "", name: "", description: "", category: "webinar", event_date: "", total_slots: 50 });
                                    setShowCreateModal(false);
                                    try { document.getElementById('organizer-events-list')?.scrollIntoView({ behavior: 'smooth' }); } catch (_) { }
                                } catch (e) {
                                    setMessage("❌ Failed to create event: " + (e.response?.data?.error || e.message));
                                } finally {
                                    setCreating(false);
                                }
                            }} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50">{creating ? 'Creating...' : 'Create Event'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Edit Event Description */}
            {showEditModal && editingEvent && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/40" onClick={() => setShowEditModal(false)}></div>
                    <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-xl mx-4 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-semibold text-gray-800">Edit Event</h3>
                            <button onClick={() => setShowEditModal(false)} className="text-gray-500 hover:text-gray-700">✕</button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-gray-700 mb-1">Name</label>
                                <input disabled value={editingEvent.name || ''} className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50" />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-700 mb-1">Description</label>
                                <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" rows={4} placeholder="Event description" />
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <button onClick={() => setShowEditModal(false)} className="px-4 py-2 rounded-xl border text-sm">Cancel</button>
                            <button onClick={async () => {
                                try {
                                    await API.put(`/events/${editingEvent.id}`, { description: editDescription });
                                    setMessage('✅ Event updated');
                                    await fetchEvents();
                                    setShowEditModal(false);
                                } catch (e) {
                                    setMessage('❌ Failed to update: ' + (e.response?.data?.error || e.message));
                                }
                            }} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold">Save</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal: Manage Seats for a Booking */}
            {showManageSeatsModal && manageBooking && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/40" onClick={() => setShowManageSeatsModal(false)}></div>
                    <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-xl mx-4 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-semibold text-gray-800">Manage Seats - {manageBooking.event_name}</h3>
                            <button onClick={() => setShowManageSeatsModal(false)} className="text-gray-500 hover:text-gray-700">✕</button>
                        </div>
                        <div className="text-sm text-gray-600 mb-3">Select seats to cancel. Confirmed seats are listed below.</div>
                        <div className="grid grid-cols-6 gap-2 max-h-60 overflow-auto p-2 border rounded-lg">
                            {manageSeats.map((s, idx) => (
                                <label key={`${s.booking_id || 'b'}-${s.seat_no}-${idx}`} className={`flex items-center gap-2 text-xs px-2 py-1 rounded border ${s.status === 'booked' ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                                    <input type="checkbox" disabled={s.status !== 'booked'} onChange={(e) => {
                                        if (e.target.checked) setManageSeats(prev => prev.map((x, i) => i === idx ? { ...x, _selected: true } : x));
                                        else setManageSeats(prev => prev.map((x, i) => i === idx ? { ...x, _selected: false } : x));
                                    }} />
                                    Seat {s.seat_no}
                                </label>
                            ))}
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <button onClick={() => setShowManageSeatsModal(false)} className="px-4 py-2 rounded-xl border text-sm">Close</button>
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
                            }} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold">Cancel Selected</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Seat selection modal for booking */}
            {showSeatSelect && seatSelect?.event && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/40" onClick={() => setShowSeatSelect(false)}></div>
                    <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-3xl mx-4 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xl font-semibold text-gray-800">Select Seats - {seatSelect.event.name}</h3>
                            <button onClick={() => setShowSeatSelect(false)} className="text-gray-500 hover:text-gray-700">✕</button>
                        </div>
                        <div className="text-sm text-gray-600 mb-3">Green = available, Red = booked. Select any available seats{typeof seatSelect?.max === 'number' ? ` (max ${seatSelect.max})` : ''}.</div>
                        <div className="grid grid-cols-5 gap-2 max-h-[420px] overflow-auto p-2 border rounded-lg">
                            {seatSelect.seats.map(s => (
                                <button key={s.seat_no} disabled={s.taken} onClick={() => {
                                    setSeatSelect(prev => ({ ...prev, seats: prev.seats.map(x => x.seat_no === s.seat_no ? { ...x, selected: !x.selected } : x) }));
                                }} className={`px-2 py-2 text-xs rounded ${s.taken ? 'bg-red-200 text-red-800 cursor-not-allowed' : (s.selected ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200')}`}>
                                    {s.seat_no}
                                </button>
                            ))}
                        </div>
                        <div className="mt-5 flex items-center justify-between gap-3">
                            <div className="text-xs text-gray-600">Selected: {seatSelect.seats.filter(s => s.selected).length}</div>
                            <div className="flex gap-2">
                                <button onClick={() => setShowSeatSelect(false)} className="px-4 py-2 rounded-xl border text-sm">Close</button>
                                <button onClick={async () => {
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
                                        await API.post('/bookings', { event_id: seatSelect.event.id, user_id: currentUserId, seats: selected.length, seat_numbers: selected });
                                        setMessage('✅ Booking submitted');
                                        setShowSeatSelect(false);
                                        await Promise.all([fetchEvents(), fetchMyBookings(currentUserId)]);
                                    } catch (e) {
                                        setMessage('❌ Failed to book: ' + (e.response?.data?.error || e.message));
                                    } finally {
                                        setBookingLoading(false);
                                    }
                                }} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold">Book Selected</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Create Event button - only when allowed */}
            {(!isSwitchView || isSwitchOrganizer) && (
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="fixed bottom-6 right-6 z-[9000] px-5 py-3 rounded-2xl bg-indigo-600 text-white shadow-2xl hover:bg-indigo-700 text-sm font-semibold"
                    title="Create Event"
                >
                    Create Event
                </button>
            )}

            {/* Organization Details Modal */}
            {showOrgModal && selectedOrg && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6 z-50">
                    <div className="bg-black/90 backdrop-blur-xl rounded-3xl max-w-5xl w-full max-h-[90vh] overflow-y-auto border border-white/10 shadow-2xl">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-6 border-b border-white/10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-cyan-500 text-white flex items-center justify-center font-bold">
                                    {selectedOrg.name?.[0]?.toUpperCase()}
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
                        <div className="flex justify-end space-x-3 p-6 border-t border-white/10">
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
                <div className={`max-w-7xl mx-auto mb-6 ${message.includes('✅') ? 'text-green-700' : 'text-red-700'}`}>{message}</div>
            )}
        </div>
    );
}
