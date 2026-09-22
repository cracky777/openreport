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
  return { role: m.role, text: [m.text, ...digests, ...reads].filter(Boolean).join('\n').slice(0, MAX_SENT_CHARS) };
}

/**
 * @param {string} url            the chat route: a report's (editor) or a model's (Ask)
 * @param {function} getExtraBody what this surface sends along with the conversation
 */
export function useAiChat(url, getExtraBody) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  const send = useCallback(async (text, extra) => {
    const question = text.trim();
    if (!question || loading) return false;
    const next = [...messages, { role: 'user', text: question }];
    setMessages(next);
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await api.post(url, {
        messages: next.slice(-MAX_SENT_MESSAGES).map(toWire),
        ...(getExtraBody ? getExtraBody() : {}),
        ...extra,
      }, { signal: controller.signal });
      setMessages((prev) => [...prev, { role: 'assistant', answerId: uuidv4(), question, text: res.data.reply || '', proposals: res.data.proposals || [], reads: res.data.reads || [] }]);
      return true;
    } catch (err) {
      // An unanswered question leaves the thread: two user turns in a row is
      // a shape some providers refuse. The caller keeps the text to re-send.
      setMessages(messages);
      if (!controller.signal.aborted) toast(err.response?.data?.error || 'The assistant did not answer');
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

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => { abortRef.current?.abort(); setMessages([]); }, []);

  return { messages, loading, send, cancel, reset, setOutcome };
}
