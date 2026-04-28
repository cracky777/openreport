export default function MaxRowsWarning() {
  return (
    <div style={{
      position: 'absolute', bottom: 4, left: 4, right: 4, zIndex: 5,
      background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 500,
      padding: '4px 8px', borderRadius: 4, textAlign: 'center',
      border: '1px solid #fcd34d',
    }}>
      Plus de 1 000 000 de lignes — les données affichées sont tronquées
    </div>
  );
}
