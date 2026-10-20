import { useState, useRef, useCallback } from 'react';
import api from '../utils/api';
import { toast } from '../components/Toast/toast';
import { v4 as uuidv4 } from 'uuid';
import { describeProposal } from '../utils/aiProposal';

// The server is stateless: every turn resends the conversation, as text. A
// proposal goes back as a one-line digest with what the author did with it:
// that is the model's only memory of its own cards, and it keeps an assistant
// turn that was a card and no words from being sent empty, which providers refuse.
//
// What the assistant read from the cache goes back too, for the session only:
// read once, it stays known — "among these clients" then names them instead
// of guessing. It is what the provider was already sent on the turn it was
// read, and it goes nowhere else (the server keeps no conversation).
const MAX_SENT_MESSAGES = 20;
// The server's MAX_MESSAGE_CHARS. Words first, then the cards, then the reads:
// when a turn is too long, the tail of the last read is what gives way.
const MAX_SENT_CHARS = 8000;

function describeRead(read) {
  const filters = read.filters?.length ? ` · filters ${JSON.stringify(read.filters)}` : '';
  const more = read.truncated ? ', more rows exist' : '';
  return `[Read from the cache: dimensions ${read.dimensions.join(', ') || 'none'} · measures ${read.measures.join(', ')}${filters} → ${read.rows.length} rows${more}: ${JSON.stringify(read.rows)}]`;
}

export function toWire(m) {
  const digests = (m.proposals || []).map((p, j) => describeProposal(p, m.outcomes?.[j]));
  const reads = (m.reads || []).map(describeRead);
  // A review turn's images are gone; what remains is that the page was looked at.
  const text = m.role === 'user' && m.review ? '[You were shown the page before and after the change you proposed, and asked to review it]' : m.text;
  return { role: m.role, text: [text, ...digests, ...reads].filter(Boolean).join('\n').slice(0, MAX_SENT_CHARS) };
}

/**
 * @param {string} url            the chat route: a report's (editor) or a model's (Ask)
 * @param {function} getExtraBody what this surface sends along with the conversation
 * @returns `send` resolves to the assistant's turn (false when it failed); every turn carries `at`
 */
export function useAiChat(url, getExtraBody) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  // `extra.images`: the page before and after a change, for the assistant to
  // review it (the studio). They go with this request only — the thread keeps
  // the words — and the turn is shown as a review, not as a question typed.
  const send = useCallback(async (text, extra = {}) => {
    const question = text.trim();
    if (!question || loading) return false;
    const { images, ...body } = extra;
    const review = Array.isArray(images) && images.length > 0;
    const next = [...messages, { role: 'user', text: question, at: Date.now(), ...(review ? { review: true } : {}) }];
    setMessages(next);
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await api.post(url, {
        messages: next.slice(-MAX_SENT_MESSAGES).map(toWire),
        ...(getExtraBody ? getExtraBody() : {}),
        ...body,
        ...(review ? { images, review: true } : {}),
      }, { signal: controller.signal });
      const reply = { role: 'assistant', answerId: uuidv4(), question, text: res.data.reply || '', proposals: res.data.proposals || [], reads: res.data.reads || [], at: Date.now(), ...(review ? { review: true } : {}) };
      setMessages((prev) => [...prev, reply]);
      return reply;
    } catch (err) {
      // An unanswered question leaves the thread: two user turns in a row is
      // a shape some providers refuse. The caller keeps the text to re-send.
      // A review that failed (a provider without vision) is simply not shown.
      setMessages(messages);
      if (!controller.signal.aborted && !review) toast(err.response?.data?.error || 'The assistant did not answer');
      return false;
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [messages, loading, url, getExtraBody]);

  // `extra`: what the surface wants to keep on the message along with the outcome (where it was added).
  const setOutcome = useCallback((msgIdx, proposalIdx, outcome, extra) => {
    setMessages((prev) => prev.map((m, i) => (i === msgIdx ? { ...m, ...extra, outcomes: { ...m.outcomes, [proposalIdx]: outcome } } : m)));
  }, []);

  // What the surface noted on an answer (a request passed on to the other assistant).
  const mark = useCallback((answerId, patch) => {
    setMessages((prev) => prev.map((m) => (m.answerId === answerId ? { ...m, ...patch } : m)));
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => { abortRef.current?.abort(); setMessages([]); }, []);

  return { messages, loading, send, cancel, reset, setOutcome, mark };
}
