// client/lib/api.js
import axios from 'axios';

const API = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000',
  headers: {
    'Content-Type': 'application/json',
  },
});

API.interceptors.request.use((config) => {
  // Try to get token from Keycloak first, then fallback to localStorage
  let token = null;

  // Check if Keycloak is available and has a token
  if (typeof window !== 'undefined' && window.keycloak && window.keycloak.token) {
    token = window.keycloak.token;
    console.log('🔑 Using Keycloak token for API request:', config.url);
  } else {
    // Fallback to localStorage
    token = localStorage.getItem('token');
    console.log('🔑 Using localStorage token for API request:', config.url);
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    console.log('✅ Authorization header set for:', config.url);
  } else {
    console.log('❌ No token found for API request:', config.url);
  }
  return config;
}, (error) => Promise.reject(error));

// Add response interceptor for better error handling
API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ERR_NETWORK') {
      console.error('Network error - server might be down:', error.message);
    } else if (error.response) {
      console.error('API Error:', error.response.status, error.response.data);
    } else {
      console.error('API Error:', error.message);
    }
    return Promise.reject(error);
  }
);

export default API;