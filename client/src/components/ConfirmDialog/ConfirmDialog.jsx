import Modal from '../Modal/Modal';
import { actionModalTitle, actionModalActions, actionModalBtnSecondary, actionModalBtnPrimary } from '../dashboardModalStyles';

// The question that needs a sentence to make sense.
//
// Its sibling ConfirmDeleteButton covers the obvious case: a delete button
// arms itself, and two clicks say everything there was to say. But "clear this
// workspace's cache", "remove this table from the model", "save a model with
// nothing flagged on it" all carry a consequence the user can't be expected to
// know — and a button that only says "click again" cannot carry it. That
// sentence is the whole value of the prompt, so it gets a dialog.
//
// Replaces the last window.confirm() calls. Being a Portal (through Modal) is
// also what lets an SVG canvas ask a question: the node just sets state, with
// no <button> to nest inside <svg>.
export default function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal onClose={onCancel} width={460}>
      <div style={actionModalTitle}>{title}</div>
      {body && <div style={bodyStyle}>{body}</div>}
      <div style={actionModalActions}>
        <button className="btn-hover" style={actionModalBtnSecondary} onClick={onCancel}>{cancelLabel}</button>
        <button
          autoFocus
          className={danger ? 'btn-hover' : 'btn-hover btn-hover-primary'}
          style={danger ? dangerBtn : actionModalBtnPrimary}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// whiteSpace: pre-line — several of these prompts list their reasons one per
// line, and a plain string is the least ceremonious way to pass a list.
const bodyStyle = {
  fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)',
  marginBottom: 16, whiteSpace: 'pre-line',
};
const dangerBtn = {
  padding: '6px 14px', fontSize: 13, fontWeight: 600,
  background: 'var(--state-danger)', border: 'none',
  borderRadius: 8, color: '#fff', cursor: 'pointer',
};
