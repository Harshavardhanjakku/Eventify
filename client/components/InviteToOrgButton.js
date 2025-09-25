import { useEffect, useMemo, useRef, useState } from "react";
import API from "../lib/api";

export default function InviteToOrgButton({ keycloak }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const [role, setRole] = useState("User");
    const [sending, setSending] = useState(false);
    const modalRef = useRef(null);

    const canInteract = Boolean(keycloak?.authenticated);

    const mappedRole = useMemo(() => role, [role]);

    useEffect(() => {
        if (!open) {
            setSearch("");
            setResults([]);
            setSelectedUser(null);
            setRole("User");
        }
    }, [open]);

    // Close on outside click and Escape key
    useEffect(() => {
        if (!open) return;
        const onDown = (e) => {
            if (modalRef.current && !modalRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        const onKey = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const performSearch = async (q) => {
        if (!q || q.trim().length < 2) {
            setResults([]);
            return;
        }
        setLoading(true);
        try {
            const res = await API.get(`/users?search=${encodeURIComponent(q)}`);
            setResults(Array.isArray(res.data) ? res.data : []);
        } catch (_) {
            setResults([]);
        } finally {
            setLoading(false);
        }
    };

    const onChangeSearch = (e) => {
        const q = e.target.value;
        setSearch(q);
        performSearch(q);
    };

    const sendInvite = async () => {
        if (!selectedUser || !selectedUser.email) {
            alert("Please select a user to invite");
            return;
        }
        setSending(true);
        try {
            await API.post("/org-invites/send", {
                email: selectedUser.email,
                invited_by: keycloak?.tokenParsed?.sub,
                role: mappedRole,
                message: "",
            });
            alert("✅ Invitation sent");
            try {
                const evt = new CustomEvent("refreshInvites");
                window.dispatchEvent(evt);
            } catch (_) { }
            setOpen(false);
        } catch (err) {
            alert("❌ Failed to send invite: " + (err?.response?.data?.error || err?.message));
        } finally {
            setSending(false);
        }
    };

    if (!canInteract) return null;

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(true)}
                className="w-8 h-8 rounded-xl bg-white/10 backdrop-blur-md text-white hover:bg-white/20 hover:shadow-lg transition-all font-semibold shadow-xl flex items-center justify-center group border border-white/20 hover:border-white/30"
                title="Invite to Organization"
            >
                <svg width="16px" height="16px" viewBox="0 -2 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" clipRule="evenodd" d="M9.5 0C12.5376 0 15 2.46243 15 5.5C15 8.5376 12.5376 11 9.5 11C6.46243 11 4 8.5376 4 5.5C4 2.46243 6.46243 0 9.5 0zM0.949967 20C0.425315 20 0 19.613 0 19.1357V17.3215C0 14.9348 2.12657 13 4.74983 13H14.2502C16.8734 13 19 14.9348 19 17.3215V19.1357C19 19.613 18.5747 20 18.05 20H0.949967zM21.5 7C21.5 6.44772 21.0523 6 20.5 6C19.9477 6 19.5 6.44772 19.5 7V8.5H18C17.4477 8.5 17 8.9477 17 9.5C17 10.0523 17.4477 10.5 18 10.5H19.5V12C19.5 12.5523 19.9477 13 20.5 13C21.0523 13 21.5 12.5523 21.5 12V10.5H23C23.5523 10.5 24 10.0523 24 9.5C24 8.9477 23.5523 8.5 23 8.5H21.5V7z" fill="currentColor"/>
                </svg>
            </button>

            {open && (
                <div className="fixed inset-0 z-[10000] flex items-start justify-center p-4 pt-24">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)}></div>
                    <div ref={modalRef} className="relative w-full max-w-2xl bg-black/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10">
                        <div className="p-6 border-b border-white/10 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-white/10 text-white flex items-center justify-center">
                                    <i className="fa-solid fa-user-plus"></i>
                                </div>
                                <div>
                                    <div className="text-lg font-semibold text-white">Invite to Organization</div>
                                    <div className="text-xs text-white/60">Search and invite users to your organization</div>
                                </div>
                            </div>
                            <button onClick={() => setOpen(false)} className="text-white/60 hover:text-white">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                                    <div>
                                <div className="text-xs font-semibold text-white/60 mb-2">SEARCH USERS</div>
                                        <div className="relative">
                                            <input
                                                value={search}
                                                onChange={onChangeSearch}
                                                placeholder="Search by username or email..."
                                        className="w-full px-4 py-3 rounded-xl border border-white/20 bg-white/5 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:border-cyan-300"
                                            />
                                            {loading && (
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60">
                                            <i className="fa-solid fa-spinner animate-spin"></i>
                                                </div>
                                            )}
                                        </div>

                                        {results.length > 0 && (
                                    <div className="mt-3 max-h-48 overflow-y-auto border border-white/20 rounded-xl bg-white/5">
                                                {results.map((u) => (
                                                    <button
                                                        key={u.id}
                                                        onClick={() => { setSelectedUser(u); setSearch(u.username || u.email || ''); }}
                                                aria-selected={selectedUser?.id === u.id}
                                                className={`w-full text-left px-4 py-3 hover:bg-white/10 flex items-center justify-between ${selectedUser?.id === u.id ? 'bg-cyan-300/20 border-l-4 border-cyan-300' : ''}`}
                                                    >
                                                            <div>
                                                    <div className="text-sm font-medium text-white">{u.username}</div>
                                                    <div className="text-xs text-white/60">{u.email}</div>
                                                        </div>
                                                        {selectedUser?.id === u.id && (
                                                    <i className="fa-solid fa-check text-cyan-300"></i>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                </div>

                                    <div>
                                <div className="text-xs font-semibold text-white/60 mb-2">ASSIGN ROLE</div>
                                <div className="grid grid-cols-2 gap-3">
                                            <button
                                                onClick={() => setRole("User")}
                                        className={`p-4 rounded-xl border text-left ${role !== "Organizer" ? 'bg-white/10 border-white/20' : 'bg-white/5 border-white/10'}`}
                                    >
                                        <div className="font-semibold text-white">User</div>
                                        <div className="text-xs text-white/60">Can raise tickets</div>
                                            </button>
                                            <button
                                                onClick={() => setRole("Organizer")}
                                        className={`p-4 rounded-xl border text-left ${role === "Organizer" ? 'bg-cyan-300/20 border-cyan-300' : 'bg-white/5 border-white/10'}`}
                                    >
                                        <div className="font-semibold text-white">Organizer</div>
                                        <div className="text-xs text-white/60">Can create & manage events</div>
                                            </button>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-white/10 flex items-center justify-between gap-3">
                            <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-xl border border-white/20 text-white/80 font-medium hover:bg-white/10">Cancel</button>
                            <button
                                onClick={sendInvite}
                                disabled={!selectedUser || sending}
                                className="px-5 py-2 rounded-xl bg-cyan-300 hover:bg-cyan-400 disabled:opacity-50 text-black font-semibold shadow"
                            >
                                {sending ? "Sending..." : "Send Invite"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}


