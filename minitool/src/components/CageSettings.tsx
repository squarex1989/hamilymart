import { useState } from 'react';
import { CAGE_PRESETS, normalizeCage } from '../data/cages';
import type { CageSize } from '../data/cages';
export default function CageSettings({ cage, onChange }: { cage?: CageSize | null; onChange: (value: CageSize | null) => void }) {
  const [draft, setDraft] = useState(() => ({ width: String(cage?.width ?? 80), depth: String(cage?.depth ?? 50), height: String(cage?.height ?? 50) }));
  const [error, setError] = useState('');
  return <div className="cage-settings">
    <h3>笼子内径</h3>
    <label className="field-label" htmlFor="cage-preset">品牌与型号</label>
    <select id="cage-preset" value={cage?.presetId ?? (cage ? 'custom' : '')} onChange={event => {
      setError('');
      const preset = CAGE_PRESETS.find(p => p.id === event.target.value);
      if (preset) { setDraft({ width: String(preset.width), depth: String(preset.depth), height: String(preset.height) }); onChange({ presetId: preset.id, width: preset.width, depth: preset.depth, height: preset.height }); }
      else if (!event.target.value) onChange(null);
      else { const value = { presetId: null, width: 80, depth: 50, height: 50 }; setDraft({ width: '80', depth: '50', height: '50' }); onChange(value); }
    }}>
      <option value="">不显示笼子</option><option value="custom">自定义尺寸</option>
      {CAGE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}（{p.width} × {p.depth} × {p.height}）</option>)}
    </select>
    <form onSubmit={event => { event.preventDefault(); try { const value = normalizeCage({ presetId: cage?.presetId ?? null, ...Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, Number(value)])) }); onChange(value); setError(''); } catch (e) { setError((e as Error).message); } }}>
      <div className="cage-dimensions">{(['width', 'depth', 'height'] as const).map((key, i) => <label key={key}>{['宽', '深', '高'][i]}（cm）<input aria-label={`笼子${['宽', '深', '高'][i]}（cm）`} type="number" inputMode="decimal" min="0.1" max="500" step="0.1" required value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></label>)}</div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button type="submit" className="outline-button full-width">应用尺寸</button>
    </form>
  </div>;
}
