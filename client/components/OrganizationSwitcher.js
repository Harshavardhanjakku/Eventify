import { useState, useRef, useEffect } from 'react';
import { useOrganization } from '../contexts/OrganizationContext';

export default function OrganizationSwitcher({ className = "" }) {
  const {
    organizations,
    currentOrganization,
    loading,
    switching,
    error,
    switchToOrganization,
    clearError
  } = useOrganization();

  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);

  // Removed recent organizations functionality

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [isOpen]);

  // Filter organizations based on search
  const filteredOrgs = organizations.filter(org =>
    org.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Handle organization switch
  const handleOrgSwitch = async (org) => {
    if (org.id === currentOrganization?.id) {
      setIsOpen(false);
      return;
    }

    try {
      await switchToOrganization(org);
      setIsOpen(false);
      setSearchTerm('');
    } catch (error) {
      // Error is handled by context
    }
  };

  // Get role color and label
  const getRoleInfo = (role) => {
    const roleMap = {
      'orgadmin': { color: 'purple', label: 'Admin' },
      'owner': { color: 'purple', label: 'Owner' },
      'organizer': { color: 'blue', label: 'Organizer' },
      'user': { color: 'green', label: 'Member' },
      'customer': { color: 'green', label: 'Customer' },
      'viewer': { color: 'green', label: 'Viewer' }
    };
    return roleMap[role?.toLowerCase()] || { color: 'gray', label: role || 'Unknown' };
  };

  if (loading && organizations.length === 0) {
    return (
      <div className={`px-5 py-3 rounded-2xl bg-gradient-to-r from-white/5 to-white/10 border border-white/10 backdrop-blur-sm ${className}`}>
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-white/20 border-t-cyan-300 rounded-full animate-spin"></div>
          <span className="text-sm font-medium text-white/80">Loading organizations...</span>
        </div>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className={`px-5 py-3 rounded-2xl bg-gradient-to-r from-red-500/10 to-red-500/20 border border-red-500/20 backdrop-blur-sm ${className}`}>
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
            <svg className="w-3 h-3 text-red-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="text-sm font-medium text-red-300">No organizations found</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Current Organization Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={switching}
        className="group flex items-center gap-4 px-5 py-3 rounded-2xl bg-gradient-to-r from-white/8 to-white/12 border border-white/20 hover:border-white/30 text-white/90 font-medium shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed min-w-[240px] backdrop-blur-sm hover:from-white/12 hover:to-white/16"
      >
        {switching ? (
          <>
            <div className="w-6 h-6 border-2 border-white/20 border-t-cyan-300 rounded-full animate-spin"></div>
            <span className="text-sm font-medium">Switching...</span>
          </>
        ) : (
          <>
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/20 transition-all duration-300 group-hover:bg-white/15 group-hover:border-white/30">
              <svg className="w-4 h-4 text-white/80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 4h12M6 4v16M6 4H5m13 0v16m0-16h1m-1 16H6m12 0h1M6 20H5M9 7h1v1H9V7Zm5 0h1v1h-1V7Zm-5 4h1v1H9v-1Zm5 0h1v1h-1v-1Zm-3 4h2a1 1 0 0 1 1 1v4h-4v-4a1 1 0 0 1 1-1Z"/>
              </svg>
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="font-semibold text-base truncate">{currentOrganization?.name || 'Select Organization'}</div>
              {currentOrganization && (
                <div className="text-xs text-white/70 font-medium">
                  {getRoleInfo(currentOrganization.role).label}
                </div>
              )}
            </div>
            <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-all duration-300">
              <svg 
                className={`w-4 h-4 text-white/70 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </>
        )}
      </button>

      {/* Error Message */}
      {error && (
        <div className="absolute top-full left-0 right-0 mt-3 p-4 bg-gradient-to-r from-red-500/15 to-red-500/25 border border-red-500/30 rounded-2xl text-red-300 text-sm backdrop-blur-sm shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                <svg className="w-3 h-3 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <span className="font-medium">{error}</span>
            </div>
            <button
              onClick={clearError}
              className="w-6 h-6 rounded-lg bg-red-500/20 hover:bg-red-500/30 flex items-center justify-center text-red-400 hover:text-red-300 transition-all duration-200"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-3 bg-gradient-to-br from-black/95 to-black/90 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/20 z-[9999] overflow-hidden">
          {/* Search Input */}
          <div className="p-5 border-b border-white/10">
            <div className="relative">
              <input
                ref={searchRef}
                type="text"
                placeholder="Search organizations..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-3 pl-12 bg-black/60 border border-white/20 rounded-2xl text-white placeholder-white/60 text-sm focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30 outline-none transition-all duration-300 backdrop-blur-sm shadow-inner"
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.6)',
                  color: 'white',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  appearance: 'none'
                }}
              />
              <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
                <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
          </div>

          {/* All Organizations */}
          <div className="max-h-80 overflow-y-auto">
            {filteredOrgs.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/5 flex items-center justify-center">
                  <svg className="w-8 h-8 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <div className="text-white/60 text-sm font-medium">
                  {searchTerm ? 'No organizations found' : 'No organizations available'}
                </div>
              </div>
            ) : (
              <div className="p-2">
                {filteredOrgs.map(org => {
                  const roleInfo = getRoleInfo(org.role);
                  const isCurrent = org.id === currentOrganization?.id;
                  
                  return (
                    <button
                      key={org.id}
                      onClick={() => handleOrgSwitch(org)}
                      disabled={isCurrent}
                      className={`group w-full flex items-center gap-3 p-3 rounded-2xl transition-all duration-300 text-left ${
                        isCurrent 
                          ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-400/30 cursor-not-allowed' 
                          : 'hover:bg-white/8 hover:border-white/20 border border-transparent'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-300 ${
                        isCurrent 
                          ? 'bg-cyan-500/20 border-cyan-400/40' 
                          : 'bg-white/10 border-white/20 group-hover:bg-white/15 group-hover:border-white/30'
                      }`}>
                        <svg className="w-5 h-5 text-white/80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 4h12M6 4v16M6 4H5m13 0v16m0-16h1m-1 16H6m12 0h1M6 20H5M9 7h1v1H9V7Zm5 0h1v1h-1V7Zm-5 4h1v1H9v-1Zm5 0h1v1h-1v-1Zm-3 4h2a1 1 0 0 1 1 1v4h-4v-4a1 1 0 0 1 1-1Z"/>
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-base truncate mb-1">{org.name}</div>
                        <div className="flex items-center gap-3">
                          <span className={`px-3 py-1 rounded-xl text-xs font-semibold ${
                            roleInfo.color === 'purple' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                            roleInfo.color === 'blue' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                            'bg-green-500/20 text-green-300 border border-green-500/30'
                          }`}>
                            {roleInfo.label}
                          </span>
                          {org.member_count && (
                            <span className="text-xs text-white/60 font-medium">
                              {org.member_count} members
                            </span>
                          )}
                        </div>
                      </div>
                      {isCurrent && (
                        <div className="w-6 h-6 rounded-full bg-cyan-400 flex items-center justify-center">
                          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-white/10 bg-gradient-to-r from-white/5 to-white/8">
            <div className="flex items-center justify-center gap-2 text-xs text-white/60 font-medium">
              <div className="w-2 h-2 rounded-full bg-cyan-400"></div>
              <span>{organizations.length} organization{organizations.length !== 1 ? 's' : ''} available</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}