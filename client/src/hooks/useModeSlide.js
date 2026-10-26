import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { saveUiMode, homeOf } from '../utils/uiMode';

// Build and Chat sit side by side, Chat to the right of Build (asked by
// Jonathan in place of a Build / Chat switch): the Assistant bar of Build
// slides Chat in, the Build bar of Chat slides Build back. A view transition
// (index.css, keyed by `data-slide` on the root) plays the slide; a browser
// without one simply changes page. The account remembers the side the user
// ends on, so the next sign-in opens there.
const SLIDE_MS = 700;

export function useModeSlide() {
  const navigate = useNavigate();
  const { updateUser } = useAuth();
  return async (mode) => {
    const root = document.documentElement;
    root.dataset.slide = mode === 'chat' ? 'to-chat' : 'to-build';
    setTimeout(() => { delete root.dataset.slide; }, SLIDE_MS);
    saveUiMode(mode);
    // The account changes after the move: on Build with ui_mode still 'chat'
    // the shell would redirect to Chat, so the move says where it is going.
    await navigate(homeOf({ ui_mode: mode }), { viewTransition: true, state: { mode } });
    updateUser({ ui_mode: mode });
  };
}
