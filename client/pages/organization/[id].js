import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import API from "../../lib/api";

export default function OrganizationOverview({ keycloak }) {
    const router = useRouter();
    const { id: orgId } = router.query;

    const [organization, setOrganization] = useState(null);
    const [members, setMembers] = useState([]);
    const [currentUserId, setCurrentUserId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        const init = async () => {
            if (!keycloak?.authenticated) {
                setLoading(false);
                return;
            }
            try {
                const keycloakId = keycloak.tokenParsed?.sub;
                const userResponse = await API.get(`/users?keycloak_id=${keycloakId}`);
                if (userResponse.data.length === 0) {
                    setError("User not found");
                    setLoading(false);
                    return;
                }
                setCurrentUserId(userResponse.data[0].id);
            } catch (e) {
                console.error("Failed to resolve current user", e);
                setError("Failed to resolve current user");
                setLoading(false);
            }
        };
        init();
    }, [keycloak]);

    useEffect(() => {
        const loadOrg = async () => {
            if (!orgId || !currentUserId) return;
            try {
                // Verify access: ensure user belongs to this org
                const myOrgs = await API.get(`/organizations/user/${currentUserId}`);
                const hasAccess = (myOrgs.data || []).some(o => String(o.id) === String(orgId));
                if (!hasAccess) {
                    setError("You don't have access to this organization");
                    setLoading(false);
                    return;
                }
                const orgRes = await API.get(`/organizations/${orgId}`);
                setOrganization(orgRes.data);
                setLoading(false);
            } catch (e) {
                console.error("Failed to load organization", e);
                setError("Failed to load organization");
                setLoading(false);
            }
        };
        loadOrg();
    }, [orgId, currentUserId]);

    const loadMembers = async () => {
        if (!orgId) return;
        setLoadingMembers(true);
        try {
            const res = await API.get(`/organizations/${orgId}/members`);
            setMembers(res.data || []);
        } catch (e) {
            console.error("Failed to load members", e);
            setMembers([]);
        } finally {
            setLoadingMembers(false);
        }
    };

    useEffect(() => {
        if (orgId) loadMembers();
    }, [orgId]);

    const formatDate = (d) => new Date(d).toLocaleDateString();

    if (!keycloak?.authenticated) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center">
                <div className="text-center p-12 bg-white/80 backdrop-blur-3xl rounded-3xl border border-blue-200/50 shadow-2xl max-w-md">
                    <h1 className="text-2xl font-bold text-gray-800 mb-4">Access Denied</h1>
                    <p className="text-gray-600">Please log in to view this organization.</p>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading organization...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center">
                <div className="text-center p-12 bg-white/80 backdrop-blur-3xl rounded-3xl border border-blue-200/50 shadow-2xl max-w-md">
                    <div className="text-red-500 text-6xl mb-4">⚠️</div>
                    <h1 className="text-2xl font-bold text-gray-800 mb-2">Error</h1>
                    <p className="text-gray-600">{error}</p>
                    <button onClick={() => router.push('/organizations')} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Back to Organizations</button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 p-6">
            <div className="max-w-7xl mx-auto">
                <div className="mb-6">
                    <button onClick={() => router.push('/organizations')} className="mb-4 flex items-center text-blue-600 hover:text-blue-700 transition-colors">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                        Back to Organizations
                    </button>
                    <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-1">{organization?.name || 'Organization'}</h1>
                    <p className="text-gray-600 text-sm">Created {organization?.created_at ? formatDate(organization.created_at) : ''} • Members {members.length}</p>
                </div>

                <div className="grid md:grid-cols-3 gap-6">
                    <div className="md:col-span-1 space-y-4">
                        <div className="bg-white rounded-2xl p-5 border border-gray-200">
                            <h3 className="text-sm font-bold text-gray-900 mb-3">Overview</h3>
                            <div className="space-y-2 text-sm text-gray-700">
                                <div className="flex justify-between"><span>Keycloak Org ID</span><span className="font-mono">{organization?.keycloak_org_id || '-'}</span></div>
                                <div className="flex justify-between"><span>Members</span><span>{members.length}</span></div>
                            </div>
                        </div>
                    </div>

                    <div className="md:col-span-2">
                        <div className="bg-white rounded-2xl p-5 border border-gray-200">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-bold text-gray-900">Members</h3>
                                <button onClick={loadMembers} className="px-3 py-1.5 text-xs rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50">Refresh</button>
                            </div>
                            {loadingMembers ? (
                                <div className="text-center py-8">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                                    <p className="text-gray-500 text-sm">Loading members...</p>
                                </div>
                            ) : (
                                <div className="space-y-3 max-h-[50vh] overflow-y-auto">
                                    {members.map((m) => (
                                        <div key={m.id} className="flex items-center justify-between p-4 bg-blue-50/50 rounded-xl border border-blue-200">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold text-sm">{m.username?.[0]?.toUpperCase?.()}</div>
                                                <div>
                                                    <div className="font-medium text-gray-900">{m.username}</div>
                                                    <div className="text-xs text-gray-600">{m.email}</div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className="px-2 py-1 rounded-full text-[0.7rem] font-bold uppercase border bg-white/70 text-gray-700">{m.role}</span>
                                                <div className="text-[11px] text-gray-500 mt-1">Joined {formatDate(m.joined_at)}</div>
                                            </div>
                                        </div>
                                    ))}
                                    {members.length === 0 && (
                                        <div className="text-center text-gray-500 text-sm py-8">No members found</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
