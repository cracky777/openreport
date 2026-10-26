// The studio's conversation, kept for the tab (useAiChat `keepKey`): the report
// assistant's thread, and the model assistant's beside it.
export const studioThreadKey = (reportId) => `openreport.studioThread.${reportId}`;

// A thread to open the studio on: a whole report Let's Talk proposed, laid in
// the studio's conversation as its card (`autoApply`) — applied there at once,
// then given its look by the designer like any report the studio builds.
export function seedStudioThread(reportId, messages) {
  try { sessionStorage.setItem(studioThreadKey(reportId), JSON.stringify(messages)); } catch { /* storage blocked: the studio opens on an empty thread */ }
}

// Changes left unsaved: the kept thread would show their cards as applied on
// a report that never got them, and the assistant would believe it too.
export function dropStudioThread(reportId) {
  try {
    sessionStorage.removeItem(studioThreadKey(reportId));
    sessionStorage.removeItem(`${studioThreadKey(reportId)}.model`);
  } catch { /* storage blocked: nothing was kept */ }
}
