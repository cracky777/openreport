import api from './api';

// Build or Chat (components/AppShell/ModeSwitch): the user's choice, kept on
// their account by the server, so the next sign-in opens on it.
export const UI_MODES = ['build', 'chat'];

export const saveUiMode = (mode) => api.put('/auth/me/ui-mode', { mode })
  .catch(() => { /* the choice holds for this session; the next sign-in opens on the last one saved */ });

// Where the app opens for this user.
export const homeOf = (user) => (user?.ui_mode === 'chat' ? '/chat' : '/');
