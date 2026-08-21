import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
});

// Embed pages (/embed/:id?token=…) authenticate every API call with the
// signed token instead of a session cookie — iframes on third-party sites
// can't rely on cookies. The Viewer stashes the token here once at mount.
let embedTokenValue = null;
export function setEmbedToken(token) { embedTokenValue = token || null; }
api.interceptors.request.use((config) => {
  if (embedTokenValue) config.headers['X-Embed-Token'] = embedTokenValue;
  return config;
});

// Only redirect to login on 401 from /auth/me (session check)
// Other 401s are passed through as normal errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && error.config.url === '/auth/me') {
      // Session expired during initial check — let useAuth handle it
    }
    return Promise.reject(error);
  }
);

export default api;
