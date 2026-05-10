import { fontStack, loadGoogleFont } from '../../utils/googleFonts';

export default function TextWidget({ data, config }) {
  if (config?.fontFamily) loadGoogleFont(config.fontFamily);
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: config?.verticalAlign || 'flex-start',
        justifyContent: config?.textAlign || 'flex-start',
        padding: 16,
        fontSize: config?.fontSize || 16,
        color: config?.color || '#334155',
        fontFamily: config?.fontFamily ? fontStack(config.fontFamily) : undefined,
        fontWeight: config?.bold ? 700 : 400,
        fontStyle: config?.italic ? 'italic' : 'normal',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {data?.text || 'Double-click to edit text'}
    </div>
  );
}
