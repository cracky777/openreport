import { TbWand } from 'react-icons/tb';
import SchemaCanvas from '../components/SchemaCanvas/SchemaCanvas';
import RLSDialog from '../components/SchemaCanvas/RLSDialog';

// Step 1 of the model wizard: the visual schema (SchemaCanvas) + the RLS
// dialog. Extracted verbatim from pages/ModelEditor.jsx (LOT 6.3). Thin
// wrapper — mostly a pass-through of the wizard's shared state to SchemaCanvas,
// so it is prop-heavy by nature (assumed). Owns only its two layout styles.
const _hs41 = { flex: 1, position: 'relative', overflow: 'hidden' };
const _hs42 = {
  position: 'absolute', top: 12, left: 12, zIndex: 10,
  display: 'flex', alignItems: 'center', gap: 10,
  background: 'var(--bg-panel)', borderRadius: 6, padding: '6px 6px 6px 12px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)', fontSize: 12, color: 'var(--text-muted)',
};
const detectBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
  fontSize: 12, fontWeight: 500, borderRadius: 6, cursor: 'pointer',
  border: '1px solid var(--border-default)', background: 'var(--bg-subtle)', color: 'var(--text-primary)',
};

export default function Step1Schema({
  schemaTablesData,
  tablePositions, setTablePositions,
  joins, setJoins,
  dimensions, setDimensions,
  measures, setMeasures,
  addDimension, addMeasure,
  modelId, datasourceId,
  isNumeric, isDateType,
  columnTypes, setColumnType,
  validateColumnType, validatingColumn, validationResults,
  rls, setRls,
  rlsDialogTable, setRlsDialogTable,
  setSelectedTables, tableColumns,
  onDetectRelationships, detecting,
}) {
  return (
    <div style={_hs41}>
      <div style={_hs42}>
        Drag column dots to create joins. Click D/M to mark dimensions/measures.
        <button
          type="button"
          className="btn-hover"
          style={detectBtn}
          onClick={onDetectRelationships}
          disabled={detecting}
          title="Join the tables through the foreign keys the database declares and key column names (customer_id, id_customer, FK_customer…), from fact to dimension tables, without loops"
        >
          <TbWand size={14} /> {detecting ? 'Detecting…' : 'Detect relationships'}
        </button>
      </div>
      <SchemaCanvas
        tables={schemaTablesData}
        positions={tablePositions}
        joins={joins}
        dimensions={dimensions}
        measures={measures}
        onPositionsChange={setTablePositions}
        onJoinsChange={setJoins}
        onAddDimension={addDimension}
        onAddMeasure={addMeasure}
        modelId={modelId}
        datasourceId={datasourceId}
        isNumeric={isNumeric}
        isDateType={isDateType}
        columnTypes={columnTypes}
        onColumnTypeChange={setColumnType}
        onValidateColumnType={validateColumnType}
        validatingColumn={validatingColumn}
        validationResults={validationResults}
        rlsTable={rls?.enabled ? rls?.table : null}
        onOpenRLS={(tableName) => setRlsDialogTable(tableName)}
        onRemoveTable={(tableName) => {
          setSelectedTables((prev) => prev.filter((t) => t !== tableName));
          setTablePositions((prev) => {
            const next = { ...prev };
            delete next[tableName];
            return next;
          });
          setJoins((prev) => prev.filter((j) => j.from_table !== tableName && j.to_table !== tableName));
          setDimensions((prev) => prev.filter((d) => d.table !== tableName));
          setMeasures((prev) => prev.filter((m) => m.table !== tableName));
          if (rls?.table === tableName) setRls({});
        }}
      />
      {rlsDialogTable && (
        <RLSDialog
          modelId={modelId}
          tableName={rlsDialogTable}
          tableColumns={tableColumns[rlsDialogTable] || []}
          rls={rls}
          onChange={setRls}
          onClose={() => setRlsDialogTable(null)}
        />
      )}
    </div>
  );
}
