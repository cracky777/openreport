import { useEffect, useState, useCallback, useRef } from 'react';

/**
 * Fetches the list of custom visuals installed on a workspace, plus the
 * caller's role in that workspace so the toolbar knows whether to show the
 * upload/delete affordances. Returns:
 *   - visuals: [{ id, name, version, manifest, hasIcon, iconUrl, bundleUrl }]
 *   - canManage: true when the current user can upload/delete in this workspace
 *   - loading, error
 *   - refresh(): re-fetch (e.g. after upload/delete)
 *   - getById(id): convenience lookup
 */
export function useCustomVisuals(workspaceId) {
  const [visuals, setVisuals] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(workspaceId);
  wsRef.current = workspaceId;

  // Fetch visuals + permissions independently so a hang on one doesn't keep
  // the other stuck in Loading. AbortController gives each call a 10s ceiling
  // so a missing server-side route (e.g. server not restarted) surfaces as an
  // error instead of an indefinite spinner.
  const fetchWithTimeout = (url, ms = 10000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { credentials: 'include', signal: ctrl.signal }).finally(() => clearTimeout(timer));
  };

  const refresh = useCallback(async () => {
    const wsId = wsRef.current;
    if (!wsId) { setVisuals([]); setCanManage(false); return; }
    setLoading(true);
    setError(null);

    // Visuals
    fetchWithTimeout(`/api/workspaces/${wsId}/visuals`)
      .then(async (res) => {
        if (res.ok) {
          const json = await res.json();
          setVisuals((json.visuals || []).map((v) => ({
            ...v,
            bundleUrl: `/api/workspaces/${wsId}/visuals/${v.id}/bundle.js`,
            iconUrl: v.hasIcon ? `/api/workspaces/${wsId}/visuals/${v.id}/icon` : null,
          })));
        } else if (res.status === 401 || res.status === 404) {
          setVisuals([]);
          if (res.status === 404) setError('Custom visuals API not found — restart the server to load the new route.');
        } else {
          setError(`Visuals HTTP ${res.status}`);
          setVisuals([]);
        }
      })
      .catch((e) => {
        setError(String(e.message || e));
        setVisuals([]);
      })
      .finally(() => setLoading(false));

    // Permissions — runs in parallel; failures don't block the visuals call
    fetchWithTimeout(`/api/workspaces/${wsId}`)
      .then(async (res) => {
        if (res.ok) {
          const json = await res.json();
          setCanManage(json.userRole === 'admin');
        } else {
          setCanManage(false);
        }
      })
      .catch(() => setCanManage(false));
  }, []);

  useEffect(() => { refresh(); }, [workspaceId, refresh]);

  const getById = useCallback((id) => visuals.find((v) => v.id === id) || null, [visuals]);

  return { visuals, canManage, loading, error, refresh, getById };
}
