export default function ShapeWidget({ config }) {
  const shape = config?.shape || 'square';
  const fill = config?.shapeFill || '#3b82f6';
  const stroke = config?.shapeStroke || '#1e40af';
  const strokeWidth = config?.shapeStrokeWidth ?? 2;
  const opacity = config?.shapeOpacity ?? 100;

  if (shape === 'line') {
    const thickness = config?.lineThickness ?? 2;
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center' }}>
        <div style={{
          width: '100%',
          height: thickness,
          backgroundColor: config?.lineColor || '#1e40af',
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
