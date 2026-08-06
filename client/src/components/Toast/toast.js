// App-wide toast, exposed as a module-level pub/sub rather than a hook so that
// non-component code (e.g. the createModelAndNavigate helper) can raise one
// without threading state through props. <ToastHost/> — mounted once in the
// app's RootLayout — subscribes here and renders whatever is pushed.
let _id = 0;
const listeners = new Set();

export function subscribeToasts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// type: 'error' (default) | 'success' | 'info' — drives the colour coding.
export function toast(message, type = 'error') {
  if (!message) return;
  listeners.forEach((fn) => fn({ id: ++_id, message: String(message), type }));
}
