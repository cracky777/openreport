import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import ReportCanvas from '../components/Canvas/ReportCanvas';
import Toolbar from '../components/Toolbar/Toolbar';
import { WidgetConfigPanel, DataModelPanel } from '../components/PropertyPanel/PropertyPanel';
import { WIDGET_TYPES } from '../components/Widgets';
import SettingsPanel from '../components/SettingsPanel/SettingsPanel';
import { useHistory } from '../hooks/useHistory';
import api from '../utils/api';

// Convert data between widget formats
function convertData(data, fromType, toType) {
  if (!data || Object.keys(data).length === 0) return data;

  // Extract labels and values from any source format
  let labels = [];
  let values = [];

  if (data.labels && data.values) {
    // bar, line format
    labels = data.labels;
    values = data.values;
  } else if (data.items) {
    // pie format
    labels = data.items.map((item) => item.name);
    values = data.items.map((item) => item.value);
  } else if (data.columns && data.rows) {
    // table format
    labels = data.rows.map((r) => r[0]);
    values = data.rows.map((r) => parseFloat(r[r.length - 1]) || 0);
  } else if (data.rawRows) {
    // pivotTable format — clear data, will need refetch
    return {};
  } else if (data.value !== undefined) {
    // scorecard format - can't meaningfully convert
    return data;
  } else {
    return data;
  }

  // Convert to target format
  switch (toType) {
    case 'bar':
    case 'line':
      return { labels, values };
    case 'pie':
      return { items: labels.map((name, i) => ({ name, value: values[i] || 0 })) };
    case 'table':
      return {
        columns: ['Label', 'Value'],
        rows: labels.map((l, i) => [String(l), String(values[i] || 0)]),
      };
    case 'scorecard':
      return {
        value: values.reduce((a, b) => a + b, 0).toLocaleString(),
        label: 'Total',
      };
    case 'pivotTable':
      // Pivot table needs raw rows — clear data to force a refetch
      return {};
    default:
      return data;
  }
}

export default function Editor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [report, setReport] = useState(null);
  const [model, setModel] = useState(null);
  const [selectedWidget, setSelectedWidget] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  // Cross-filtering: { dimensionName: [selectedValues] } — empty array = no filter
  const [reportFilters, setReportFilters] = useState({});
  // Cross-highlight: which widget is the source and what value is highlighted
  const [crossHighlight, setCrossHighlight] = useState(null); // { widgetId, value }
  const crossHighlightRef = useRef(null);
  crossHighlightRef.current = crossHighlight;

  // Called by slicers when selection changes
  const handleSlicerFilter = useCallback((widgetId, dimensionName, selectedValues) => {
    setReportFilters((prev) => {
      const next = { ...prev };
      if (!selectedValues || selectedValues.length === 0) {
        delete next[dimensionName];
      } else {
        next[dimensionName] = selectedValues;
      }
      return next;
    });
  }, []);

  // Called by chart widgets when user clicks a data point
  const crossFilterSourceRef = useRef(null);
  const handleCrossFilter = useCallback((sourceWidgetId, dimensionName, value) => {
    const prev = crossHighlightRef.current;
    const isSame = prev && prev.widgetId === sourceWidgetId && prev.value === value;
    if (isSame) {
      crossFilterSourceRef.current = null;
      setCrossHighlight(null);
      setReportFilters((p) => { const n = { ...p }; delete n[dimensionName]; return n; });
    } else {
      crossFilterSourceRef.current = sourceWidgetId;
      setCrossHighlight({ widgetId: sourceWidgetId, value });
      setReportFilters((p) => ({ ...p, [dimensionName]: [value] }));
    }
  }, []);
  // When filters change, refetch all widgets
  // Cross-filter refetch with debounce + abort + loading indicator
  const prevFiltersJson = useRef('{}');
  const abortControllerRef = useRef(null);
  const debounceTimerRef = useRef(null);

  useEffect(() => {
    const json = JSON.stringify(reportFilters || {});
    if (json === prevFiltersJson.current) return;
    prevFiltersJson.current = json;
    if (!model) return;

    // Abort previous in-flight requests
    if (abortControllerRef.current) abortControllerRef.current.abort();
    // Clear previous debounce
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    const sourceId = crossFilterSourceRef.current;
    crossFilterSourceRef.current = null;
    const currentWidgets = history.state.widgets;

    const toFetch = Object.entries(currentWidgets).filter(([wId, w]) => {
      if (!w || w.type === 'filter' || w.type === 'text') return false;
      if (wId === sourceId) return false;
      const b = w.dataBinding || {};
      return (b.selectedDimensions?.length > 0 || b.selectedMeasures?.length > 0);
    });

    if (toFetch.length === 0) return;

    // Mark all target widgets as loading
    history.set((prev) => {
      const next = { ...prev, widgets: { ...prev.widgets } };
      toFetch.forEach(([wId]) => {
        if (next.widgets[wId]) next.widgets[wId] = { ...next.widgets[wId], _loading: true };
      });
      return next;
    });

    // Debounce 150ms — if user clicks rapidly, only the last one fires
    debounceTimerRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const promises = toFetch.map(([wId, w]) => {
        const binding = w.dataBinding || {};
        const dims = binding.selectedDimensions || [];
        const meass = binding.selectedMeasures || [];
        const grpBy = binding.groupBy || [];
        const colDimsB = binding.columnDimensions || [];
        const allDims = [...dims, ...grpBy.filter((g) => !dims.includes(g)), ...colDimsB.filter((g) => !dims.includes(g) && !grpBy.includes(g))];

        return api.post(`/models/${model.id}/query`, {
          dimensionNames: allDims, measureNames: meass,
          limit: w.config?.dataLimit || 1000, filters: reportFilters,
        }, { signal: controller.signal }).then((res) => {
          const rows = res.data?.rows;
          if (!rows || rows.length === 0) return { wId, data: null };
          let newData = {};
          const keys = Object.keys(rows[0]);
          if (w.type === 'pivotTable') {
            const rowDimNames = dims.filter((d) => !colDimsB.includes(d));
            newData = { rawRows: rows,
              _rowDims: rowDimNames.map((d) => { const def = (model.dimensions || []).find((x) => x.name === d); return def?.label || def?.name || d; }),
              _colDims: colDimsB.map((d) => { const def = (model.dimensions || []).find((x) => x.name === d); return def?.label || def?.name || d; }),
              _measures: meass.map((m) => { const def = (model.measures || []).find((x) => x.name === m); return def?.label || def?.name || m; }),
            };
          } else if (w.type === 'table') {
            newData = { columns: keys, rows: rows.map((r) => Object.values(r).map((v) => v != null ? String(v) : '')) };
          } else if (w.type === 'pie') {
            newData = { items: rows.map((r) => ({ name: String(r[keys[0]]), value: Number(r[keys[keys.length - 1]]) || 0 })) };
          } else if (grpBy.length > 0 && keys.length >= 3) {
            const [axisKey, groupKey] = keys; const valueKey = keys[keys.length - 1];
            const ul = [...new Set(rows.map((r) => String(r[axisKey])))];
            const ug = [...new Set(rows.map((r) => String(r[groupKey])))];
            newData = { labels: ul, series: ug.map((gv) => ({ name: gv, values: ul.map((l) => { const row = rows.find((r) => String(r[axisKey]) === l && String(r[groupKey]) === gv); return row ? Number(row[valueKey]) || 0 : 0; }) })) };
          } else {
            newData = { labels: rows.map((r) => String(r[keys[0]])), values: rows.map((r) => Number(r[keys[keys.length - 1]]) || 0) };
          }
          const mf = {};
          meass.forEach((mn) => { const md = (model.measures || []).find((x) => x.name === mn); if (md?.format) mf[md.label || md.name] = md.format; });
          newData._measureFormats = mf;
          if (dims.length > 0) newData._dimName = dims[0];
          return { wId, data: newData };
        }).catch(() => ({ wId, data: null }));
      });

      // Wait for ALL to complete, then batch update
      Promise.all(promises).then((results) => {
        if (controller.signal.aborted) return;
        history.set((prev) => {
          const next = { ...prev, widgets: { ...prev.widgets } };
          results.forEach(({ wId, data }) => {
            if (next.widgets[wId]) {
              next.widgets[wId] = { ...next.widgets[wId], _loading: false, ...(data ? { data } : {}) };
            }
          });
          return next;
        });
      });
    }, 150);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [reportFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [settings, setSettings] = useState({});
  const [showSettings, setShowSettings] = useState(false);

  // Undo/redo state: tracks layout + widgets together
  const history = useHistory({ layout: [], widgets: {} });
  const { layout, widgets } = history.state;

  const setLayout = useCallback((updater) => {
    history.set((prev) => ({
      ...prev,
      layout: typeof updater === 'function' ? updater(prev.layout) : updater,
    }));
  }, [history]);

  const setWidgets = useCallback((updater) => {
    history.set((prev) => ({
      ...prev,
      widgets: typeof updater === 'function' ? updater(prev.widgets) : updater,
    }));
  }, [history]);

  // Batch update layout + widgets together (single undo step)
  const setLayoutAndWidgets = useCallback((layoutUpdater, widgetsUpdater) => {
    history.set((prev) => ({
      layout: typeof layoutUpdater === 'function' ? layoutUpdater(prev.layout) : layoutUpdater,
      widgets: typeof widgetsUpdater === 'function' ? widgetsUpdater(prev.widgets) : widgetsUpdater,
    }));
  }, [history]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/reports/${id}`);
        const r = res.data.report;
        setReport(r);
        setTitle(r.title);
        setSettings(r.settings || {});
        history.set({ layout: r.layout || [], widgets: r.widgets || {} });

        if (r.model_id) {
          const modelRes = await api.get(`/models/${r.model_id}`);
          setModel(modelRes.data.model);
        }
      } catch {
        navigate('/');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, navigate]);

  // Keyboard shortcuts: Delete, Ctrl+Z, Ctrl+Y
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Delete selected widget
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWidget) {
        // Don't delete if user is typing in an input
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        e.preventDefault();
        handleDeleteWidget(selectedWidget);
      }

      // Ctrl+Z = undo
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      }

      // Ctrl+Y or Ctrl+Shift+Z = redo
      if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        history.redo();
      }

      // Ctrl+C = copy selected widget
      if (e.ctrlKey && e.key === 'c' && selectedWidget) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const widgetData = widgets[selectedWidget];
        const layoutItem = layout.find((l) => l.i === selectedWidget);
        if (widgetData && layoutItem) {
          setClipboard({ widget: JSON.parse(JSON.stringify(widgetData)), layout: { ...layoutItem } });
        }
      }

      // Ctrl+V = paste copied widget
      if (e.ctrlKey && e.key === 'v' && clipboard) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        const newId = uuidv4();
        const newLayout = {
          ...clipboard.layout,
          i: newId,
          x: (clipboard.layout.x || 0) + 20,
          y: (clipboard.layout.y || 0) + 20,
        };
        const newWidget = JSON.parse(JSON.stringify(clipboard.widget));
        // Clear fetched data to avoid stale cache
        if (newWidget.data) delete newWidget.data._fetchedBinding;
        setLayoutAndWidgets(
          (prev) => [...prev, newLayout],
          (prev) => ({ ...prev, [newId]: newWidget }),
        );
        setSelectedWidget(newId);
        // Update clipboard position for next paste
        setClipboard({ widget: clipboard.widget, layout: newLayout });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedWidget, history, clipboard, widgets, layout, setLayoutAndWidgets]);

  const handleAddWidget = useCallback((type, subType) => {
    const widgetId = uuidv4();
    const defaultSize = WIDGET_TYPES[type]?.defaultSize || { w: 24, h: 16 };

    // If a widget is selected, transform it instead of adding a new one
    if (selectedWidget && widgets[selectedWidget]) {
      const existing = widgets[selectedWidget];
      const convertedData = convertData(existing.data, existing.type, type);

      // Clean dataBinding: remove fields not supported by the new type
      const newBinding = { ...existing.dataBinding };
      if (type !== 'bar') {
        delete newBinding.groupBy;
      }

      setWidgets((prev) => ({
        ...prev,
        [selectedWidget]: {
          ...existing,
          type,
          data: convertedData,
          dataBinding: newBinding,
          config: {
            ...existing.config,
            subType: subType || undefined,
          },
        },
      }));
      return;
    }

    const pw = settings.pageWidth || 1140;
    const ph = settings.pageHeight || 800;
    const ww = defaultSize.w * 20;
    const wh = defaultSize.h * 20;

    setLayoutAndWidgets(
      (prevLayout) => [
        ...prevLayout,
        {
          i: widgetId,
          x: Math.max(0, Math.round((pw - ww) / 2)),
          y: Math.max(0, Math.round((ph - wh) / 2)),
          w: ww,
          h: wh,
        },
      ],
      (prevWidgets) => ({
        ...prevWidgets,
        [widgetId]: {
          type,
          data: {},
          config: subType ? { subType } : {},
        },
      })
    );

    setSelectedWidget(widgetId);
  }, [selectedWidget, widgets, setWidgets, setLayoutAndWidgets]);

  const handleUpdateWidget = useCallback((widgetId, updatedWidget) => {
    setWidgets((prev) => ({
      ...prev,
      [widgetId]: updatedWidget,
    }));
  }, [setWidgets]);

  const handleBringToFront = useCallback((widgetId) => {
    setLayout((prev) => {
      const maxZ = Math.max(...prev.map((item) => item.z || 1));
      return prev.map((item) => item.i === widgetId ? { ...item, z: maxZ + 1 } : item);
    });
  }, [setLayout]);

  const handleSendToBack = useCallback((widgetId) => {
    setLayout((prev) => {
      const minZ = Math.min(...prev.map((item) => item.z || 1));
      return prev.map((item) => item.i === widgetId ? { ...item, z: Math.max(1, minZ - 1) } : item);
    });
  }, [setLayout]);

  const handleBringForward = useCallback((widgetId) => {
    setLayout((prev) => {
      const currentZ = prev.find((item) => item.i === widgetId)?.z || 1;
      return prev.map((item) => item.i === widgetId ? { ...item, z: currentZ + 1 } : item);
    });
  }, [setLayout]);

  const handleSendBackward = useCallback((widgetId) => {
    setLayout((prev) => {
      const currentZ = prev.find((item) => item.i === widgetId)?.z || 1;
      return prev.map((item) => item.i === widgetId ? { ...item, z: Math.max(1, currentZ - 1) } : item);
    });
  }, [setLayout]);

  const handleDeleteWidget = useCallback((widgetId) => {
    setLayoutAndWidgets(
      (prevLayout) => prevLayout.filter((item) => item.i !== widgetId),
      (prevWidgets) => {
        const next = { ...prevWidgets };
        delete next[widgetId];
        return next;
      }
    );
    setSelectedWidget(null);
  }, [setLayoutAndWidgets]);

  const handleLoadMore = useCallback(async (widgetId) => {
    const widget = widgets[widgetId];
    if (!widget || widget.type !== 'table' || !model) return;
    if (widget.data?._loadingMore || widget.data?._hasMore === false) return;

    const binding = widget.dataBinding || {};
    const dims = binding.selectedDimensions || [];
    const meass = binding.selectedMeasures || [];
    if (dims.length === 0 && meass.length === 0) return;

    const currentRows = widget.data?.rows || [];
    const dataLimit = widget.config?.dataLimit || 1000;

    // Mark as loading
    setWidgets((prev) => ({
      ...prev,
      [widgetId]: { ...prev[widgetId], data: { ...prev[widgetId].data, _loadingMore: true } },
    }));

    try {
      const res = await api.post(`/models/${model.id}/query`, {
        dimensionNames: dims,
        measureNames: meass,
        limit: dataLimit,
        offset: currentRows.length,
      });

      const newRows = res.data.rows;
      const hasMore = newRows.length >= dataLimit;

      setWidgets((prev) => {
        const w = prev[widgetId];
        if (!w) return prev;
        const existingRows = w.data?.rows || [];
        const columns = w.data?.columns || (newRows.length > 0 ? Object.keys(newRows[0]) : []);
        const appendedRows = newRows.map((r) => Object.values(r).map((v) => v != null ? String(v) : ''));

        return {
          ...prev,
          [widgetId]: {
            ...w,
            data: {
              columns,
              rows: [...existingRows, ...appendedRows],
              _loadingMore: false,
              _hasMore: hasMore,
            },
          },
        };
      });
    } catch (err) {
      console.error('Load more failed:', err);
      setWidgets((prev) => ({
        ...prev,
        [widgetId]: { ...prev[widgetId], data: { ...prev[widgetId].data, _loadingMore: false } },
      }));
    }
  }, [widgets, model, setWidgets]);

  const reloadModel = useCallback(async () => {
    if (!report?.model_id) return;
    try {
      const res = await api.get(`/models/${report.model_id}`);
      setModel(res.data.model);

      // Invalidate cache on all widgets so they refetch with updated measures
      setWidgets((prev) => {
        const next = {};
        for (const [id, w] of Object.entries(prev)) {
          if (w.data?._fetchedBinding) {
            next[id] = { ...w, data: { ...w.data, _fetchedBinding: null } };
          } else {
            next[id] = w;
          }
        }
        return next;
      });
    } catch (err) {
      console.error('Failed to reload model:', err);
    }
  }, [report?.model_id, setWidgets]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/reports/${id}`, { title, layout, widgets, settings });
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, color: '#94a3b8' }}>Loading report...</div>;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Toolbar
        reportTitle={title}
        onTitleChange={setTitle}
        onAddWidget={handleAddWidget}
        onSave={handleSave}
        saving={saving}
        modelName={model?.name}
        modelId={model?.id}
        onUndo={history.undo}
        onRedo={history.redo}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onOpenSettings={() => setShowSettings(true)}
        reportId={id}
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ReportCanvas
          layout={layout}
          widgets={widgets}
          selectedWidget={selectedWidget}
          onLayoutChange={setLayout}
          onSelectWidget={setSelectedWidget}
          settings={settings}
          onLoadMore={handleLoadMore}
          onWidgetUpdate={handleUpdateWidget}
          reportFilters={reportFilters}
          onSlicerFilter={handleSlicerFilter}
          onCrossFilter={handleCrossFilter}
          crossHighlight={crossHighlight}
        />
        <WidgetConfigPanel
          widgetId={selectedWidget}
          widget={selectedWidget ? widgets[selectedWidget] : null}
          onUpdate={handleUpdateWidget}
          onDelete={handleDeleteWidget}
          onBringToFront={handleBringToFront}
          onSendToBack={handleSendToBack}
          onBringForward={handleBringForward}
          onSendBackward={handleSendBackward}
          model={model}
        />
        <DataModelPanel
          widgetId={selectedWidget}
          widget={selectedWidget ? widgets[selectedWidget] : null}
          onUpdate={handleUpdateWidget}
          model={model}
          onModelUpdate={reloadModel}
          reportFilters={crossHighlight?.widgetId === selectedWidget ? {} : reportFilters}
        />
      </div>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSettingsChange={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
