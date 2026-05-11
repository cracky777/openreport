import { TbPhoto } from 'react-icons/tb';

/**
 * Image widget — renders an <img> with the configured src + fit. The actual
 * URL lives in `config.url`; the property panel handles entry (paste a
 * web URL, or — OSS only — upload a local file which becomes a server-
 * hosted URL). Cloud builds hide the upload path entirely (see
 * `VITE_OPENREPORT_CLOUD` gate in PropertyPanel).
 */
export default function ImageWidget({ config }) {
  const url = config?.url || '';
  const fit = config?.fit || 'contain';
  const alt = config?.alt || '';
  const radius = Number.isFinite(config?.borderRadius) ? config.borderRadius : 0;

  if (!url) {
    // Empty state — guides the user to the property panel.
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 8, color: 'var(--text-disabled)',
        background: 'var(--bg-subtle)', borderRadius: radius,
        border: '2px dashed var(--border-default)',
      }}>
        <TbPhoto size={32} />
        <div style={{ fontSize: 11 }}>Paste a URL in the properties panel</div>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      draggable={false}
      onError={(e) => {
        // Avoid the broken-image icon — replace with a placeholder so the
        // editor stays readable when the URL 404s.
        e.currentTarget.style.display = 'none';
      }}
      style={{
        width: '100%',
        height: '100%',
        objectFit: fit,
        borderRadius: radius,
        display: 'block',
      }}
    />
  );
}
