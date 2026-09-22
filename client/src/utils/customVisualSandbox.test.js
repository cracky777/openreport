import { describe, it, expect } from 'vitest';
import { buildSrcDoc, NO_NETWORK_CSP } from './customVisualSandbox';

const BUNDLE = 'OpenReportRegisterVisual({ render() {} });';

describe('buildSrcDoc', () => {
  it('an uploaded visual gets no CSP: it may load a library from a CDN', () => {
    const doc = buildSrcDoc(BUNDLE);
    expect(doc).not.toContain('Content-Security-Policy');
    expect(doc).toContain(BUNDLE);
  });

  it('an AI-written visual gets the no-network policy before any script', () => {
    const doc = buildSrcDoc(BUNDLE, { restrictNetwork: true });
    const csp = doc.indexOf('Content-Security-Policy');
    expect(csp).toBeGreaterThan(-1);
    // A policy only binds what is parsed after it.
    expect(csp).toBeLessThan(doc.indexOf('<script'));
    expect(csp).toBeLessThan(doc.indexOf('<style'));
    expect(doc).toContain(NO_NETWORK_CSP);
  });

  it('the policy closes every outbound channel a CSP can, and allows no eval', () => {
    expect(NO_NETWORK_CSP).toContain("default-src 'none'");
    expect(NO_NETWORK_CSP).toContain("form-action 'none'");
    expect(NO_NETWORK_CSP).toContain("base-uri 'none'");
    expect(NO_NETWORK_CSP).not.toContain('unsafe-eval');
    expect(NO_NETWORK_CSP).not.toMatch(/https?:|\*/);
    // connect-src, frame-src, font-src, media-src… all fall back to default-src.
    expect(NO_NETWORK_CSP).not.toContain('connect-src');
  });

  it('a </script> inside the bundle cannot close the tag it sits in', () => {
    const doc = buildSrcDoc('var s = "</script><script>alert(1)</script>";', { restrictNetwork: true });
    expect(doc).not.toContain('</script><script>alert(1)');
    expect(doc).toContain('<\\/script><script>alert(1)<\\/script>');
  });
});
