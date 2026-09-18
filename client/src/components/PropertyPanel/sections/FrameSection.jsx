// Section 9 — Frame. The box around the visual, the same for all fifteen
// widget types: the title's type, the border, the background, the shadow,
// the rotation, and the seam line of a merged block.
import { Section, SubSection, Field, RangeInput, ColorInput } from '../controls';
import FontPicker from '../../FontPicker/FontPicker';
import { parseIntOrNull } from '../../../utils/input';

export default function FrameSection({ ctx }) {
  const { widget, updateConfig, inputStyle, sections } = ctx;
  const type = widget.type;
  const cfg = widget.config || {};
  // An image sits directly on the canvas by default: no border, see-through.
  const borderOn = cfg.borderEnabled ?? (type !== 'image');
  const transparent = cfg.transparentBg ?? (type === 'image');
  const gradient = cfg.gradientBg || {};
  const shadow = cfg.shadow || {};
  return (
    <Section id="frame" title="Frame" sectionState={sections}>
      <Field label="Title font">
        <FontPicker value={cfg.titleFontFamily} onChange={(v) => updateConfig('titleFontFamily', v)} />
      </Field>
      <SubSection label="Border">
        <Field label="Show border">
          <input type="checkbox" checked={borderOn} onChange={(e) => updateConfig('borderEnabled', e.target.checked)} />
        </Field>
        {borderOn && (
          <Field label="Border color">
            <ColorInput value={cfg.borderColor || '#e2e8f0'} onChange={(v) => updateConfig('borderColor', v)} />
          </Field>
        )}
        <Field label="Border radius" vertical>
          <RangeInput min={0} max={type === 'image' ? 64 : 24} value={cfg.borderRadius ?? (type === 'image' ? 0 : 8)}
            onChange={(e) => updateConfig('borderRadius', parseIntOrNull(e.target.value))} />
        </Field>
      </SubSection>
      <SubSection label="Background">
        <Field label="Transparent">
          <input type="checkbox" checked={transparent} onChange={(e) => updateConfig('transparentBg', e.target.checked)} />
        </Field>
        {!transparent && (
          <>
            <Field label="Gradient">
              <input type="checkbox" checked={gradient.enabled ?? false}
                onChange={(e) => updateConfig('gradientBg', { ...gradient, enabled: e.target.checked })} />
            </Field>
            {gradient.enabled ? (
              <>
                <Field label="Angle" vertical>
                  <RangeInput min={0} max={360} value={gradient.angle ?? 180} suffix="°"
                    onChange={(e) => updateConfig('gradientBg', { ...gradient, angle: parseIntOrNull(e.target.value) })} />
                </Field>
                <Field label="Color 1">
                  <ColorInput value={gradient.color1 || '#ffffff'} onChange={(v) => updateConfig('gradientBg', { ...gradient, color1: v })} />
                </Field>
                <Field label="Color 2">
                  <ColorInput value={gradient.color2 || '#e2e8f0'} onChange={(v) => updateConfig('gradientBg', { ...gradient, color2: v })} />
                </Field>
              </>
            ) : (
              <Field label="Color">
                <ColorInput value={cfg.backgroundColor || '#ffffff'} onChange={(v) => updateConfig('backgroundColor', v)} />
              </Field>
            )}
          </>
        )}
      </SubSection>
      <SubSection label="Shadow">
        <Field label="Show shadow">
          <input type="checkbox" checked={shadow.enabled ?? false}
            onChange={(e) => updateConfig('shadow', { ...shadow, enabled: e.target.checked })} />
        </Field>
        {shadow.enabled && (
          <>
            <Field label="Type">
              <select value={shadow.type || 'outer'} onChange={(e) => updateConfig('shadow', { ...shadow, type: e.target.value })} style={{ ...inputStyle, marginBottom: 0 }}>
                <option value="outer">Outer</option>
                <option value="inner">Inner</option>
              </select>
            </Field>
            <Field label="Angle" vertical>
              <RangeInput min={0} max={360} value={shadow.angle ?? 135} suffix="°"
                onChange={(e) => updateConfig('shadow', { ...shadow, angle: parseIntOrNull(e.target.value) })} />
            </Field>
            <Field label="Blur" vertical>
              <RangeInput min={0} max={40} value={shadow.blur ?? 10}
                onChange={(e) => updateConfig('shadow', { ...shadow, blur: parseIntOrNull(e.target.value) })} />
            </Field>
            <Field label="Spread" vertical>
              <RangeInput min={0} max={20} value={shadow.spread ?? 2}
                onChange={(e) => updateConfig('shadow', { ...shadow, spread: parseIntOrNull(e.target.value) })} />
            </Field>
            <Field label="Shadow color">
              <ColorInput value={shadow.color || '#000000'} onChange={(v) => updateConfig('shadow', { ...shadow, color: v })} />
            </Field>
          </>
        )}
      </SubSection>
      {/* The seam line of a merged block. Its on/off switch is on the canvas,
          at the seam; only the colour is here. */}
      {cfg.mergeGroup && cfg.mergeSeparator && (
        <Field label="Separator color">
          <ColorInput value={cfg.mergeSeparatorColor || '#e2e8f0'} onChange={(v) => updateConfig('mergeSeparatorColor', v)} />
        </Field>
      )}
      <Field label="Rotation" vertical>
        <RangeInput min={0} max={360} value={cfg.rotation ?? 0} suffix="°"
          onChange={(e) => updateConfig('rotation', parseIntOrNull(e.target.value))} />
      </Field>
    </Section>
  );
}
