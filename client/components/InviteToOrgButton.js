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
                className="px-4 py-2 bg-purple-100/80 backdrop-blur-md text-purple-700 rounded-xl hover:bg-purple-200 hover:shadow-lg transition-all font-semibold shadow-xl flex items-center gap-2 group border border-purple-200/50 hover:border-purple-300 tracking-wide"
            >
                Invite to Org
            </button>

            {open && (
                <div className="fixed inset-0 z-[10000] flex items-start justify-center p-4 pt-24">
                    <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)}></div>
                    <div ref={modalRef} className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200">
                        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
                                    <i className="fa-solid fa-user-plus"></i>
                                </div>
                                <div>
                                    <div className="text-lg font-semibold text-gray-800">Invite to Organization</div>
                                    <div className="text-xs text-gray-500">Search and invite users to your organization</div>
                                </div>
                            </div>
                            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            <div>
                                <div className="text-xs font-semibold text-gray-500 mb-2">SEARCH USERS</div>
                                <div className="relative">
                                    <input
                                        value={search}
                                        onChange={onChangeSearch}
                                        placeholder="Search by username or email..."
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-300"
                                    />
                                    {loading && (
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                                            <i className="fa-solid fa-spinner animate-spin"></i>
                                        </div>
                                    )}
                                </div>

                                {results.length > 0 && (
                                    <div className="mt-3 max-h-48 overflow-y-auto border border-gray-100 rounded-xl">
                                        {results.map((u) => (
                                            <button
                                                key={u.id}
                                                onClick={() => { setSelectedUser(u); setSearch(u.username || u.email || ''); }}
                                                aria-selected={selectedUser?.id === u.id}
                                                className={`w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between ${selectedUser?.id === u.id ? 'bg-purple-50 border-l-4 border-purple-400' : ''}`}
                                            >
                                                <div>
                                                    <div className="text-sm font-medium text-gray-800">{u.username}</div>
                                                    <div className="text-xs text-gray-500">{u.email}</div>
                                                </div>
                                                {selectedUser?.id === u.id && (
                                                    <i className="fa-solid fa-check text-purple-600"></i>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div>
                                <div className="text-xs font-semibold text-gray-500 mb-2">ASSIGN ROLE</div>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => setRole("User")}
                                        className={`p-4 rounded-xl border text-left ${role !== "Organizer" ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}
                                    >
                                        <div className="font-semibold">User</div>
                                        <div className="text-xs text-gray-500">Can raise tickets</div>
                                    </button>
                                    <button
                                        onClick={() => setRole("Organizer")}
                                        className={`p-4 rounded-xl border text-left ${role === "Organizer" ? 'bg-purple-50 border-purple-200' : 'bg-white border-gray-200'}`}
                                    >
                                        <div className="font-semibold">Organizer</div>
                                        <div className="text-xs text-gray-500">Can create & manage events</div>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-gray-100 flex items-center justify-between gap-3">
                            <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50">Cancel</button>
                            <button
                                onClick={sendInvite}
                                disabled={!selectedUser || sending}
                                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold shadow"
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


