import { evaluateColorCondition } from '../../utils/conditionalFormat';

export default function ShapeWidget({ config, data }) {
  const shape = config?.shape || 'square';
  // When a colorMeasure is bound and a rule matches, override the static fill
  // so arrow/line shapes also reflect the conditional formatting.
  const cc = config?.colorCondition;
  const conditionalColor = cc?.enabled ? evaluateColorCondition(cc, data?._colorValue) : null;
  const fill = conditionalColor || config?.shapeFill || '#7c3aed';
  const stroke = config?.shapeStroke || '#6d28d9';
  const strokeWidth = config?.shapeStrokeWidth ?? 2;
  const opacity = config?.shapeOpacity ?? 100;

  if (shape === 'line') {
    const thickness = config?.lineThickness ?? 2;
    const rotation = config?.lineRotation ?? 0;
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
        <div style={{
          width: '100%',
          height: thickness,
          backgroundColor: conditionalColor || config?.lineColor || '#6d28d9',
          // Rotate around the line's own centre. The outer flex centres the
          // line first so a 45° / 90° rotation keeps it visually inside the
          // widget's bounding box; the box itself doesn't grow with the
          // rotated line, so a near-vertical line in a wide-but-shallow
          // shape may visually extend beyond the box — give the shape a
          // taller bounding rectangle (resize on the canvas) if needed.
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
          transformOrigin: 'center center',
        }} />
      </div>
    );
  }

  if (shape === 'arrow') {
    const direction = config?.arrowDirection || 'right';
    const rotations = { right: 0, down: 90, left: 180, up: 270 };
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: opacity / 100 }}>
        <svg viewBox="0 0 100 60" style={{ width: '80%', height: '80%', transform: `rotate(${rotations[direction] || 0}deg)` }}>
          <polygon points="0,15 70,15 70,0 100,30 70,60 70,45 0,45" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
        </svg>
      </div>
    );
  }

  // square & round: container IS the shape, render nothing
  if (shape === 'square' || shape === 'round') {
    return null;
  }
}
