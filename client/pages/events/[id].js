import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { io } from "socket.io-client";
import API from "../../lib/api";
import { useOrganization } from "../../contexts/OrganizationContext";

export default function EventSeatPage() {
    const router = useRouter();
    const { id } = router.query || {};
    const [eventData, setEventData] = useState(null);
    const [seatsState, setSeatsState] = useState({ seats: [], max: 0 });
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");
    const [bookingLoading, setBookingLoading] = useState(false);
    const [quantity, setQuantity] = useState(1);
    const [waitlistPosition, setWaitlistPosition] = useState(null);
    const [isOnWaitlist, setIsOnWaitlist] = useState(false);
    const [showWaitlistConfirmation, setShowWaitlistConfirmation] = useState(false);
    const [waitlistExpiresAt, setWaitlistExpiresAt] = useState(null);
    const [connected, setConnected] = useState(true);
    const [currentUserId, setCurrentUserId] = useState(null);
    const socketRef = useRef(null);
    const holdTimersRef = useRef(new Map());
    const { currentOrganization, loadOrganizations } = useOrganization();

    // load current user id via /users?keycloak_id if available in window (kept minimal)
    useEffect(() => {
        (async () => {
            try {
                const keycloakId = window?.keycloak?.tokenParsed?.sub;
                if (!keycloakId) return;
                const userResponse = await API.get(`/users?keycloak_id=${keycloakId}`);
                const user = userResponse.data?.[0];
                if (user?.id) {
                    setCurrentUserId(user.id);
                    // Load organizations for the user
                    await loadOrganizations(user.id);
                }
            } catch (error) {
                console.error('Failed to load user data:', error);
            }
        })();
    }, [loadOrganizations]);

    useEffect(() => {
        if (!id) return;
        (async () => {
            setLoading(true);
            try {
                const ev = await API.get(`/events/${id}`);
                const seats = await API.get(`/events/${id}/seats`);
                const { total, taken } = seats.data || { total: ev.data.total_slots, taken: [] };
                const grid = Array.from({ length: total }, (_, i) => ({ seat_no: i + 1, taken: taken?.includes(i + 1), held: false, selected: false }));
                setEventData(ev.data);
                setSeatsState({ seats: grid, max: Math.max(0, Number(ev.data.available_slots) || 0) });
            } catch (e) {
                setMessage('❌ Failed to load event seats: ' + (e.response?.data?.error || e.message));
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    // realtime wiring (reuse logic from SeatRealtime)
    useEffect(() => {
        if (!id) return;
        const sock = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000', { transports: ['websocket'] });
        socketRef.current = sock;
        sock.emit('seats:join', { eventId: id });
        setConnected(true);
        sock.on('connect', () => setConnected(true));
        sock.on('disconnect', () => setConnected(false));
        const onSnapshot = ({ eventId: eid, held }) => {
            if (String(eid) !== String(id)) return;
            setSeatsState(prev => ({ ...prev, seats: prev.seats.map(s => ({ ...s, held: held.includes(s.seat_no) })) }));
        };
        const onHeld = ({ eventId: eid, seatNo }) => {
            if (String(eid) !== String(id)) return;
            setSeatsState(prev => ({ ...prev, seats: prev.seats.map(s => s.seat_no === seatNo ? { ...s, held: true } : s) }));
        };
        const onReleased = ({ eventId: eid, seatNo }) => {
            if (String(eid) !== String(id)) return;
            setSeatsState(prev => ({ ...prev, seats: prev.seats.map(s => s.seat_no === seatNo ? { ...s, held: false, selected: false, _countdown: 0 } : s) }));
        };
        sock.on('seats:snapshot', onSnapshot);
        sock.on('seat:held', onHeld);
        sock.on('seat:released', onReleased);
        const onBooked = ({ eventId: eid, seatNo }) => {
            if (String(eid) !== String(id)) return;
            setSeatsState(prev => ({ ...prev, seats: prev.seats.map(s => s.seat_no === seatNo ? { ...s, taken: true, held: false, selected: false, _countdown: 0 } : s) }));
        };
        const onFreed = ({ eventId: eid, seatNo }) => {
            if (String(eid) !== String(id)) return;
            setSeatsState(prev => ({ ...prev, seats: prev.seats.map(s => s.seat_no === seatNo ? { ...s, taken: false, held: false, selected: false, _countdown: 0 } : s) }));
        };
        sock.on('seat:booked', onBooked);
        sock.on('seat:freed', onFreed);
        
        // Handle availability updates
        const onAvailabilityUpdate = ({ eventId: eid, availableSlots }) => {
            if (String(eid) !== String(id)) return;
            setEventData(prev => ({ ...prev, available_slots: availableSlots }));
        };
        sock.on('event:availability:updated', onAvailabilityUpdate);

        // Handle waitlist notifications
        const onSeatAvailableForWaitlist = ({ eventId: eid, userId, seatNo, expiresAt, message, countdown }) => {
            if (String(eid) !== String(id) || String(userId) !== String(currentUserId)) return;
            setMessage(`🎉 ${message}`);
            // Show confirmation button or modal
            setShowWaitlistConfirmation(true);
            setWaitlistExpiresAt(expiresAt);
            
            // Start countdown timer
            if (countdown) {
                let timeLeft = countdown;
                const timer = setInterval(() => {
                    timeLeft--;
                    if (timeLeft <= 0) {
                        clearInterval(timer);
                        setShowWaitlistConfirmation(false);
                        setMessage('⏰ Time expired. You remain on the waitlist.');
                        // Notify server about timeout
                        try {
                            API.post('/bookings/waitlist/timeout', { event_id: id, user_id: currentUserId });
                        } catch {}
                    }
                }, 1000);
            }
        };
        sock.on('seatAvailableForWaitlist', onSeatAvailableForWaitlist);

        // Handle waitlist seat confirmation
        const onWaitlistSeatConfirmed = ({ eventId: eid, userId, seatNo }) => {
            if (String(eid) !== String(id)) return;
            setMessage(`✅ Seat ${seatNo} has been confirmed by another user.`);
            setIsOnWaitlist(false);
            setWaitlistPosition(null);
        };
        sock.on('waitlistSeatConfirmed', onWaitlistSeatConfirmed);
        const reconcileId = setInterval(() => { try { sock.emit('seats:snapshot:request', { eventId: id }); } catch {} }, 2000);
        return () => {
            try { for (const idc of holdTimersRef.current.values()) clearInterval(idc); holdTimersRef.current.clear(); } catch {}
            clearInterval(reconcileId);
            sock.off('seats:snapshot', onSnapshot);
            sock.off('seat:held', onHeld);
            sock.off('seat:released', onReleased);
            sock.off('seat:booked', onBooked);
            sock.off('seat:freed', onFreed);
            sock.off('event:availability:updated', onAvailabilityUpdate);
            sock.off('seatAvailableForWaitlist', onSeatAvailableForWaitlist);
            sock.off('waitlistSeatConfirmed', onWaitlistSeatConfirmed);
            sock.disconnect();
            socketRef.current = null;
        };
    }, [id]);

    if (loading) return <div className="min-h-screen bg-black text-white flex items-center justify-center">Loading…</div>;
    if (!eventData) return <div className="min-h-screen bg-black text-white flex items-center justify-center">Event not found</div>;

    const selectedCount = seatsState.seats.filter(s => s.selected).length;
    const minCountdown = seatsState.seats.filter(s => s.selected && typeof s._countdown === 'number').reduce((min, s) => Math.min(min, s._countdown), Infinity);

    return (
        <div className="min-h-screen bg-black text-white p-6">
            <div className="max-w-5xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold">{eventData.name}</h1>
                        <div className="text-white/60 text-sm">{new Date(eventData.event_date).toLocaleString()}</div>
                    </div>
                    <button onClick={() => router.push('/media')} className="px-3 py-2 text-sm rounded-lg border border-white/15 hover:bg-white/10">Back</button>
                </div>

                {/* urgency banner */}
                <div className="mb-4">
                    {isFinite(minCountdown) ? (
                        <div className="p-3 rounded-xl border border-yellow-400/30 bg-yellow-400/10 text-yellow-300 text-sm flex items-center gap-4">
                            <span className="font-medium">Your selection is on hold. Confirm within <span className="font-bold">{minCountdown}s</span>.</span>
                            <div className="ml-auto w-40 h-2 bg-white/10 rounded-full overflow-hidden">
                                <div style={{ width: `${Math.max(0, Math.min(100, (minCountdown / 10) * 100))}%` }} className="h-2 bg-yellow-400"></div>
                            </div>
                        </div>
                    ) : (
                        (() => {
                            const left = Array.isArray(seatsState?.seats) ? seatsState.seats.filter(s => !s.taken && !s.held).length : Number(eventData.available_slots || 0);
                            return (
                                <div className="p-3 rounded-xl border border-white/10 bg-white/5 text-white/80 text-sm flex items-center gap-3">
                                    <span className="font-medium">Hurry up! Limited slots left</span>
                                    <span className="px-2 py-0.5 rounded-lg bg-cyan-300/15 text-cyan-300 border border-cyan-300/30 text-xs">{left}</span>
                                </div>
                            );
                        })()
                    )}
                </div>

                {/* waitlist status */}
                {isOnWaitlist && waitlistPosition && (
                    <div className="mb-3 p-4 rounded-xl border border-yellow-400/30 bg-yellow-400/10 text-yellow-300">
                        <div className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-full bg-yellow-400/20 flex items-center justify-center">
                                <span className="text-yellow-300 text-sm">⏳</span>
                            </div>
                            <div>
                                <div className="font-semibold">You're on the waitlist!</div>
                                <div className="text-sm text-yellow-200">Position: {waitlistPosition} • You'll be notified when seats become available</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* connection banner */}
                {!connected && (
                    <div className="mb-3 p-3 rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 text-sm">Disconnected from server; attempting to reconnect… seat map may be stale.</div>
                )}

                {/* quantity selector */}
                <div className="mb-4 flex items-center gap-3">
                    <label className="text-sm text-white/70">Tickets</label>
                    <input type="number" min={1} max={Math.max(1, Number(eventData.available_slots) || 1)} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(Number(eventData.available_slots) || 1, Number(e.target.value) || 1)))} className="w-20 px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm" />
                    <button onClick={() => {
                        // auto-hold the first N available seats
                        const sock = socketRef.current; if (!sock) return;
                        const desired = quantity;
                        const free = seatsState.seats.filter(s => !s.taken && !s.held && !s.selected).slice(0, desired);
                        for (const seat of free) {
                            sock.emit('seat:hold', { eventId: id, seatNo: seat.seat_no, ttlSec: 10 }, (resp) => {
                                if (resp?.ok) {
                                    const ttl = Number(resp.ttl || 10);
                                    setSeatsState(prev => ({ ...prev, seats: prev.seats.map(x => x.seat_no === seat.seat_no ? { ...x, selected: true, held: true, _countdown: ttl } : x) }));
                                    if (holdTimersRef.current.has(seat.seat_no)) clearInterval(holdTimersRef.current.get(seat.seat_no));
                                    const idt = setInterval(() => {
                                        setSeatsState(prev => ({ ...prev, seats: prev.seats.map(x => {
                                            if (x.seat_no !== seat.seat_no) return x; const rem = (typeof x._countdown === 'number' ? x._countdown : ttl) - 1;
                                            if (rem <= 0) { try { clearInterval(holdTimersRef.current.get(seat.seat_no)); holdTimersRef.current.delete(seat.seat_no); } catch {}; return { ...x, selected: false, held: false, _countdown: 0 }; }
                                            return { ...x, _countdown: rem };
                                        }) }));
                                    }, 1000);
                                    holdTimersRef.current.set(seat.seat_no, idt);
                                }
                            });
                        }
                    }} className="px-3 py-2 rounded-lg bg-white/10 border border-white/15 text-sm">Auto-select</button>
                </div>

                {/* grid */}
                <div className="grid grid-cols-8 md:grid-cols-10 gap-3 max-h-[60vh] overflow-y-auto p-4 bg-white/5 rounded-xl border border-white/10 mb-6">
                    {seatsState.seats.map(s => (
                        <button
                            key={s.seat_no}
                            disabled={s.taken || (s.held && !s.selected)}
                            onClick={() => {
                                const sock = socketRef.current; if (!sock) return;
                                if (s.selected) {
                                    try { if (holdTimersRef.current.has(s.seat_no)) { clearInterval(holdTimersRef.current.get(s.seat_no)); holdTimersRef.current.delete(s.seat_no); } } catch {}
                                    sock.emit('seat:release', { eventId: id, seatNo: s.seat_no }, () => {});
                                    setSeatsState(prev => ({ ...prev, seats: prev.seats.map(x => x.seat_no === s.seat_no ? { ...x, selected: false, held: false } : x) }));
                                    return;
                                }
                                sock.emit('seat:hold', { eventId: id, seatNo: s.seat_no, ttlSec: 10 }, (resp) => {
                                    if (resp?.ok) {
                                        const ttl = Number(resp.ttl || 10);
                                        setSeatsState(prev => ({ ...prev, seats: prev.seats.map(x => x.seat_no === s.seat_no ? { ...x, selected: true, held: true, _countdown: ttl } : x) }));
                                        if (holdTimersRef.current.has(s.seat_no)) clearInterval(holdTimersRef.current.get(s.seat_no));
                                        const idt = setInterval(() => {
                                            setSeatsState(prev => ({ ...prev, seats: prev.seats.map(x => {
                                                if (x.seat_no !== s.seat_no) return x; const rem = (typeof x._countdown === 'number' ? x._countdown : ttl) - 1;
                                                if (rem <= 0) { try { clearInterval(holdTimersRef.current.get(s.seat_no)); holdTimersRef.current.delete(s.seat_no); } catch {}; return { ...x, selected: false, held: false, _countdown: 0 }; }
                                                return { ...x, _countdown: rem };
                                            }) }));
                                        }, 1000);
                                        holdTimersRef.current.set(s.seat_no, idt);
                                    }
                                });
                            }}
                            className={`relative w-12 h-12 rounded-xl text-sm font-semibold transition-all ${s.taken ? 'bg-red-500/20 text-red-400 border border-red-500/30 cursor-not-allowed opacity-60' : s.selected ? 'bg-cyan-300 text-black border-2 border-cyan-300' : s.held ? 'bg-yellow-400/30 text-yellow-300 border border-yellow-400/40 cursor-not-allowed' : 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 hover:border-green-400'}`}
                        >
                            {s.seat_no}
                            {s.selected && typeof s._countdown === 'number' && (
                                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/70 border border-white/20 text-white text-[10px] flex items-center justify-center">{s._countdown}</span>
                            )}
                        </button>
                    ))}
                </div>

                <div className="flex items-center justify-between">
                    <div className="text-sm text-white/60">{selectedCount === 0 ? 'Select at least one seat to continue' : `${selectedCount} seat(s) selected`}</div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => router.push('/media')} className="px-4 py-2 rounded-xl border border-white/20 text-white/80 font-medium hover:bg-white/10">Cancel</button>
                        {eventData.available_slots > 0 ? (
                            <button disabled={bookingLoading || selectedCount === 0} onClick={async () => {
                                const selected = seatsState.seats.filter(s => s.selected).map(s => s.seat_no);
                                try {
                                    setBookingLoading(true);
                                    // simple idempotency token per attempt
                                    const token = `${id}:${currentUserId}:${Date.now()}`;
                                    const response = await API.post('/bookings', { event_id: id, user_id: currentUserId, seats: selected.length, seat_numbers: selected, idempotency_key: token });
                                    
                                    // Handle different booking statuses
                                    if (response.data.status === 'confirmed') {
                                        setMessage('✅ Booking confirmed! Your seats have been reserved.');
                                        try { const sock = socketRef.current; if (sock) { for (const num of selected) sock.emit('seat:release', { eventId: id, seatNo: num }, () => {}); } } catch {}
                                        router.push('/media');
                                    } else if (response.data.status === 'waiting') {
                                        setMessage(`⏳ Added to waitlist at position ${response.data.waitlistPosition}. You'll be notified if seats become available.`);
                                        setWaitlistPosition(response.data.waitlistPosition);
                                        setIsOnWaitlist(true);
                                        // Don't redirect, let user see waitlist status
                                    }
                                } catch (e) {
                                    if (e.response?.status === 409 && e.response?.data?.occupiedSeats) {
                                        setMessage(`❌ Seat(s) ${e.response.data.occupiedSeats.join(', ')} are already booked. Please select other seats.`);
                                    } else {
                                        setMessage('❌ Failed to book: ' + (e.response?.data?.error || e.message));
                                    }
                                } finally {
                                    setBookingLoading(false);
                                }
                            }} className="px-6 py-2 bg-cyan-300 hover:bg-cyan-400 text-black rounded-xl text-sm font-semibold disabled:opacity-50">Book Selected</button>
                        ) : (
                            <button disabled={bookingLoading} onClick={async () => {
                                try {
                                    setBookingLoading(true);
                                    const response = await API.post('/bookings/waitlist', { event_id: id, user_id: currentUserId });
                                    
                                    if (response.data.status === 'already_waiting') {
                                        setMessage(`⏳ You're already on the waitlist at position ${response.data.position}.`);
                                        setWaitlistPosition(response.data.position);
                                        setIsOnWaitlist(true);
                                    } else {
                                        setMessage(`⏳ ${response.data.message}`);
                                        setWaitlistPosition(response.data.position);
                                        setIsOnWaitlist(true);
                                    }
                                } catch (e) {
                                    setMessage('❌ Failed to join waitlist: ' + (e.response?.data?.error || e.message));
                                } finally {
                                    setBookingLoading(false);
                                }
                            }} className="px-6 py-2 bg-yellow-400 hover:bg-yellow-500 text-black rounded-xl text-sm font-semibold disabled:opacity-50">Join Waitlist</button>
                        )}
                    </div>
                </div>

                {message && (
                    <div className="mt-4 text-sm text-white/80">{message}</div>
                )}

                {/* Waitlist Confirmation Modal */}
                {showWaitlistConfirmation && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6 max-w-md mx-4 border border-white/20">
                            <div className="text-center">
                                <div className="text-4xl mb-4">🎉</div>
                                <h3 className="text-xl font-bold text-white mb-2">Seat Available!</h3>
                                <p className="text-white/80 mb-4">Hurry up! A seat is available for you. Confirm within 5 seconds.</p>
                                <div className="mb-4">
                                    <div className="w-full bg-gray-700 rounded-full h-2">
                                        <div className="bg-yellow-400 h-2 rounded-full animate-pulse" style={{width: '100%'}}></div>
                                    </div>
                                    <p className="text-yellow-400 text-sm mt-2">⏰ 5 seconds remaining</p>
                                </div>
                                <div className="flex gap-3">
                                    <button 
                                        onClick={async () => {
                                            try {
                                                setBookingLoading(true);
                                                const response = await API.post('/bookings/waitlist/confirm', { 
                                                    event_id: id, 
                                                    user_id: currentUserId 
                                                });
                                                setMessage('✅ ' + response.data.message);
                                                setShowWaitlistConfirmation(false);
                                                setIsOnWaitlist(false);
                                                setWaitlistPosition(null);
                                                router.push('/media');
                                            } catch (e) {
                                                setMessage('❌ Failed to confirm: ' + (e.response?.data?.error || e.message));
                                            } finally {
                                                setBookingLoading(false);
                                            }
                                        }}
                                        className="px-6 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold"
                                    >
                                        Confirm Booking
                                    </button>
                                    <button 
                                        onClick={() => {
                                            setShowWaitlistConfirmation(false);
                                            setMessage('⏳ You declined the seat. You remain on the waitlist.');
                                        }}
                                        className="px-6 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-xl font-semibold"
                                    >
                                        Decline
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

