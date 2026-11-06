import { useEffect, useState } from 'react';
import api from '../utils/api';
import { DemoContext } from '../utils/demo';
import Editor from './Editor';

const msgStyle = { padding: 40, color: 'var(--text-disabled)' };

// The public demo (demo.openreport.io): the editor, without an account, on the
// one report the instance names. Changes stay in this tab.
export default function Demo() {
  const [state, setState] = useState({ reportId: null, failed: false });
  useEffect(() => {
    api.get('/demo')
      .then((res) => setState({ reportId: res.data?.reportId || null, failed: !res.data?.reportId }))
      .catch(() => setState({ reportId: null, failed: true }));
  }, []);
  if (state.failed) return <div style={msgStyle}>This instance has no demo.</div>;
  if (!state.reportId) return <div style={msgStyle}>Loading the demo...</div>;
  return (
    <DemoContext.Provider value>
      <Editor reportId={state.reportId} />
    </DemoContext.Provider>
  );
}
