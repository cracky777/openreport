import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
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
