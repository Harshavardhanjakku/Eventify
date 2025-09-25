import { createContext, useContext, useReducer, useEffect } from 'react';
import API from '../lib/api';

const OrganizationContext = createContext();

// Action types
const ORG_ACTIONS = {
  SET_LOADING: 'SET_LOADING',
  SET_ORGANIZATIONS: 'SET_ORGANIZATIONS',
  SET_CURRENT_ORG: 'SET_CURRENT_ORG',
  SET_ERROR: 'SET_ERROR',
  CLEAR_ERROR: 'CLEAR_ERROR',
  REFRESH_ORGS: 'REFRESH_ORGS',
  SET_SWITCHING: 'SET_SWITCHING'
};

// Initial state
const initialState = {
  organizations: [],
  currentOrganization: null,
  loading: false,
  switching: false,
  error: null,
  lastUpdated: null
};

// Reducer
function organizationReducer(state, action) {
  switch (action.type) {
    case ORG_ACTIONS.SET_LOADING:
      return { ...state, loading: action.payload, error: null };
    
    case ORG_ACTIONS.SET_ORGANIZATIONS:
      return { 
        ...state, 
        organizations: action.payload, 
        loading: false, 
        lastUpdated: Date.now(),
        error: null 
      };
    
    case ORG_ACTIONS.SET_CURRENT_ORG:
      return { 
        ...state, 
        currentOrganization: action.payload, 
        switching: false,
        error: null 
      };
    
    case ORG_ACTIONS.SET_ERROR:
      return { 
        ...state, 
        error: action.payload, 
        loading: false, 
        switching: false 
      };
    
    case ORG_ACTIONS.CLEAR_ERROR:
      return { ...state, error: null };
    
    case ORG_ACTIONS.REFRESH_ORGS:
      return { ...state, loading: true, error: null };
    
    case ORG_ACTIONS.SET_SWITCHING:
      return { ...state, switching: action.payload };
    
    default:
      return state;
  }
}

// Provider component
export function OrganizationProvider({ children, keycloak }) {
  const [state, dispatch] = useReducer(organizationReducer, initialState);

  // Load organizations from API
  const loadOrganizations = async (userId, forceRefresh = false) => {
    if (!userId) return;
    
    // Check if we have recent data (less than 5 minutes old)
    if (!forceRefresh && state.lastUpdated && (Date.now() - state.lastUpdated) < 300000) {
      return;
    }

    dispatch({ type: ORG_ACTIONS.SET_LOADING, payload: true });
    
    try {
      const response = await API.get(`/organizations/user/${userId}`);
      const orgs = Array.isArray(response.data) ? response.data : [];
      
      dispatch({ type: ORG_ACTIONS.SET_ORGANIZATIONS, payload: orgs });
      
      // Restore current org from localStorage if available
      const savedOrgId = localStorage.getItem('currentOrganizationId');
      if (savedOrgId && orgs.find(org => org.id === savedOrgId)) {
        const savedOrg = orgs.find(org => org.id === savedOrgId);
        dispatch({ type: ORG_ACTIONS.SET_CURRENT_ORG, payload: savedOrg });
      } else if (orgs.length > 0) {
        // Default to first organization (prefer admin/owner roles)
        const sortedOrgs = orgs.sort((a, b) => {
          const aRole = String(a.role).toLowerCase();
          const bRole = String(b.role).toLowerCase();
          const aPriority = aRole === 'owner' ? 3 : aRole === 'orgadmin' ? 2 : aRole === 'organizer' ? 1 : 0;
          const bPriority = bRole === 'owner' ? 3 : bRole === 'orgadmin' ? 2 : bRole === 'organizer' ? 1 : 0;
          return bPriority - aPriority;
        });
        dispatch({ type: ORG_ACTIONS.SET_CURRENT_ORG, payload: sortedOrgs[0] });
      }
    } catch (error) {
      console.error('Failed to load organizations:', error);
      dispatch({ 
        type: ORG_ACTIONS.SET_ERROR, 
        payload: 'Failed to load organizations. Please try again.' 
      });
    }
  };

  // Switch to organization
  const switchToOrganization = async (organization) => {
    if (!organization) return;
    
    dispatch({ type: ORG_ACTIONS.SET_SWITCHING, payload: true });
    dispatch({ type: ORG_ACTIONS.CLEAR_ERROR });
    
    try {
      // Validate user has access to this organization
      const hasAccess = state.organizations.some(org => org.id === organization.id);
      if (!hasAccess) {
        throw new Error('You do not have access to this organization');
      }
      
      // Simulate network delay for better UX
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Save to localStorage
      localStorage.setItem('currentOrganizationId', organization.id);
      localStorage.setItem('currentOrganizationName', organization.name);
      
      // Update state
      dispatch({ type: ORG_ACTIONS.SET_CURRENT_ORG, payload: organization });
      
      // Trigger refresh of organization-specific data
      window.dispatchEvent(new CustomEvent('organizationSwitched', { 
        detail: { organization } 
      }));
      
    } catch (error) {
      console.error('Failed to switch organization:', error);
      dispatch({ 
        type: ORG_ACTIONS.SET_ERROR, 
        payload: error.message || 'Failed to switch organization' 
      });
    }
  };

  // Refresh organizations
  const refreshOrganizations = async (userId) => {
    await loadOrganizations(userId, true);
  };

  // Clear error
  const clearError = () => {
    dispatch({ type: ORG_ACTIONS.CLEAR_ERROR });
  };

  // Get user's role in current organization
  const getCurrentUserRole = () => {
    if (!state.currentOrganization) return null;
    return state.currentOrganization.role;
  };

  // Check if user can manage current organization
  const canManageOrganization = () => {
    const role = getCurrentUserRole();
    return role === 'orgadmin' || role === 'owner';
  };

  // Get organization by ID
  const getOrganizationById = (id) => {
    return state.organizations.find(org => org.id === id);
  };

  const value = {
    ...state,
    loadOrganizations,
    switchToOrganization,
    refreshOrganizations,
    clearError,
    getCurrentUserRole,
    canManageOrganization,
    getOrganizationById
  };

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}

// Custom hook to use organization context
export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
}

export default OrganizationContext;