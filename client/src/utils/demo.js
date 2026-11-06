import { createContext, useContext } from 'react';

// On the public demo instance (pages/Demo.jsx) the editor works on a copy kept
// in the browser: no save, no assistant, no way out to the rest of the app.
// The server refuses all of it anyway (server/utils/demoMode.js); this only
// keeps the controls that cannot work off the screen.
export const DemoContext = createContext(false);

export function useDemo() {
  return useContext(DemoContext);
}
