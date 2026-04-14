import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import ReportCanvas from '../components/Canvas/ReportCanvas';
import Toolbar from '../components/Toolbar/Toolbar';
import PropertyPanel from '../components/PropertyPanel/PropertyPanel';
import { WIDGET_TYPES } from '../components/Widgets';
import api from '../utils/api';

export default function Editor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [report, setReport] = useState(null);
  const [layout, setLayout] = useState([]);
  const [widgets, setWidgets] = useState({});
  const [title, setTitle] = useState('');
  const [selectedWidget, setSelectedWidget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/reports/${id}`)
      .then((res) => {
        const r = res.data.report;
        setReport(r);
        setLayout(r.layout || []);
        setWidgets(r.widgets || {});
        setTitle(r.title);
      })
      .catch(() => navigate('/'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const handleAddWidget = useCallback((type) => {
    const widgetId = uuidv4();
    const defaultSize = WIDGET_TYPES[type]?.defaultSize || { w: 4, h: 3 };

    setLayout((prev) => [
      ...prev,
      {
        i: widgetId,
        x: 0,
        y: Infinity,
        w: defaultSize.w,
        h: defaultSize.h,
      },
    ]);

    setWidgets((prev) => ({
      ...prev,
      [widgetId]: {
        type,
        data: {},
        config: {},
      },
    }));

    setSelectedWidget(widgetId);
  }, []);

  const handleUpdateWidget = useCallback((widgetId, updatedWidget) => {
    setWidgets((prev) => ({
      ...prev,
      [widgetId]: updatedWidget,
    }));
  }, []);

  const handleDeleteWidget = useCallback((widgetId) => {
    setLayout((prev) => prev.filter((item) => item.i !== widgetId));
    setWidgets((prev) => {
      const next = { ...prev };
      delete next[widgetId];
      return next;
    });
    setSelectedWidget(null);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/reports/${id}`, { title, layout, widgets });
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
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ReportCanvas
          layout={layout}
          widgets={widgets}
          selectedWidget={selectedWidget}
          onLayoutChange={setLayout}
          onSelectWidget={setSelectedWidget}
        />
        <PropertyPanel
          widgetId={selectedWidget}
          widget={selectedWidget ? widgets[selectedWidget] : null}
          onUpdate={handleUpdateWidget}
          onDelete={handleDeleteWidget}
        />
      </div>
    </div>
  );
}
