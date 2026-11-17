import { useState } from 'react';
import { Trash2, Save, Download, Upload, Plus } from 'lucide-react';
import type { ArenaBlock, ArenaBlockType, ArenaMap, PadPoint, SpawnPoint, TeamId, UserProfile } from '../../shared/types.ts';
import { OFFICIAL_ARENAS } from '../../shared/arenas.ts';
import { apiFetch } from '../lib/config.ts';

interface ArenaBuilderProps {
  user: UserProfile | null;
  token: string | null;
  onOpenAuth: () => void;
  onArenaSaved: (arena: ArenaMap) => void;
}

type ToolMode = 'wall' | 'platform' | 'bridge' | 'pillar' | 'ramp' | 'spawn-cobalt' | 'spawn-ember' | 'pad-shield' | 'pad-overcharge' | 'select';

export function ArenaBuilder({ user, token, onOpenAuth, onArenaSaved }: ArenaBuilderProps) {
  const [name, setName] = useState('Sector Meridian');
  const [description, setDescription] = useState('Custom symmetrical tactical arena with flanking cover.');
  const [width, setWidth] = useState(48);
  const [depth, setDepth] = useState(60);
  const [blocks, setBlocks] = useState<ArenaBlock[]>(() => structuredClone(OFFICIAL_ARENAS[0].blocks));
  const [spawns, setSpawns] = useState<SpawnPoint[]>(() => structuredClone(OFFICIAL_ARENAS[0].spawns));
  const [pads, setPads] = useState<PadPoint[]>(() => structuredClone(OFFICIAL_ARENAS[0].pads));
  const [tool, setTool] = useState<ToolMode>('wall');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) || null;

  function loadTemplate(templateId: string) {
    if (templateId === 'blank') {
      setBlocks([]);
      setSpawns([
        { x: 0, y: 0.2, z: -22, team: 'cobalt', yaw: 0 },
        { x: 0, y: 0.2, z: 22, team: 'ember', yaw: Math.PI },
      ]);
      setPads([]);
      setSelectedBlockId(null);
      return;
    }
    const found = OFFICIAL_ARENAS.find((a) => a.id === templateId);
    if (found) {
      setWidth(found.width);
      setDepth(found.depth);
      setBlocks(structuredClone(found.blocks));
      setSpawns(structuredClone(found.spawns));
      setPads(structuredClone(found.pads));
      setSelectedBlockId(null);
    }
  }

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const nz = (e.clientY - rect.top) / rect.height;
    const worldX = Math.round((nx - 0.5) * width);
    const worldZ = Math.round((nz - 0.5) * depth);

    if (tool === 'select') {
      setSelectedBlockId(null);
      return;
    }

    if (tool === 'spawn-cobalt' || tool === 'spawn-ember') {
      const team: TeamId = tool === 'spawn-cobalt' ? 'cobalt' : 'ember';
      setSpawns((prev) => [...prev, { x: worldX, y: 0.2, z: worldZ, team, yaw: team === 'cobalt' ? 0 : Math.PI }]);
      return;
    }

    if (tool === 'pad-shield' || tool === 'pad-overcharge') {
      const kind = tool === 'pad-shield' ? 'shield' : 'overcharge';
      setPads((prev) => [...prev, { id: `pad-${Date.now()}`, x: worldX, y: 0.05, z: worldZ, kind }]);
      return;
    }

    const defaults: Record<ArenaBlockType, { w: number; h: number; d: number; y: number }> = {
      wall: { w: 5, h: 2.8, d: 1.4, y: 0 },
      platform: { w: 7, h: 1.8, d: 6, y: 0 },
      bridge: { w: 12, h: 0.6, d: 4, y: 3.0 },
      pillar: { w: 2.6, h: 6, d: 2.6, y: 0 },
      ramp: { w: 6, h: 3.0, d: 4, y: 0 },
    };
    const spec = defaults[tool];
    const id = `blk-${Date.now().toString(36)}`;
    const newBlock: ArenaBlock = {
      id,
      type: tool,
      x: worldX,
      y: spec.y,
      z: worldZ,
      w: spec.w,
      h: spec.h,
      d: spec.d,
      rotY: 0,
      accent: worldZ < 0 ? 'cobalt' : worldZ > 0 ? 'ember' : 'neutral',
    };
    setBlocks((prev) => [...prev, newBlock]);
    setSelectedBlockId(id);
  }

  function updateSelected(patch: Partial<ArenaBlock>) {
    if (!selectedBlockId) return;
    setBlocks((prev) => prev.map((b) => (b.id === selectedBlockId ? { ...b, ...patch } : b)));
  }

  function deleteSelected() {
    if (!selectedBlockId) return;
    setBlocks((prev) => prev.filter((b) => b.id !== selectedBlockId));
    setSelectedBlockId(null);
  }

  async function handleSave() {
    if (!user || !token) {
      onOpenAuth();
      return;
    }
    setFeedback(null);
    setSaving(true);
    try {
      const res = await apiFetch<{ arena: ArenaMap }>('/api/arenas', {
        method: 'POST',
        token,
        body: JSON.stringify({
          name,
          description,
          width,
          depth,
          ceilingHeight: 14,
          blocks,
          spawns,
          pads,
        }),
      });
      setFeedback({ kind: 'ok', text: `Published "${res.arena.name}" to custom arenas.` });
      onArenaSaved(res.arena);
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  function exportJson() {
    const payload = { name, description, width, depth, ceilingHeight: 14, blocks, spawns, pads };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'custom-arena'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<ArenaMap>;
        if (parsed.name) setName(parsed.name);
        if (parsed.description) setDescription(parsed.description);
        if (parsed.width) setWidth(parsed.width);
        if (parsed.depth) setDepth(parsed.depth);
        if (Array.isArray(parsed.blocks)) setBlocks(parsed.blocks);
        if (Array.isArray(parsed.spawns)) setSpawns(parsed.spawns);
        if (Array.isArray(parsed.pads)) setPads(parsed.pads);
        setFeedback({ kind: 'ok', text: 'Imported arena blueprint JSON.' });
      } catch {
        setFeedback({ kind: 'err', text: 'Invalid JSON arena blueprint file.' });
      }
    };
    reader.readAsText(file);
  }

  const tools: { id: ToolMode; label: string }[] = [
    { id: 'select', label: 'Select' },
    { id: 'wall', label: 'Cover Wall' },
    { id: 'pillar', label: 'Pillar' },
    { id: 'platform', label: 'Platform' },
    { id: 'bridge', label: 'Catwalk' },
    { id: 'ramp', label: 'Ramp' },
    { id: 'spawn-cobalt', label: 'Cobalt Spawn' },
    { id: 'spawn-ember', label: 'Ember Spawn' },
    { id: 'pad-shield', label: 'Shield Pad' },
    { id: 'pad-overcharge', label: 'Overcharge Pad' },
  ];

  return (
    <section className="mx-auto max-w-[1280px] px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-cyan-400 mb-1">Custom Arena Architect</div>
          <h1 className="font-display text-3xl font-bold text-slate-50">Tactical Map Builder</h1>
          <p className="text-sm text-slate-400 mt-1">
            Click the floor grid to place Cannon.js physics blocks, elevated bridges, spawns, and energy pads.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Load template"
            onChange={(e) => loadTemplate(e.target.value)}
            defaultValue=""
            className="px-3 py-2 rounded-lg border border-white/10 bg-[#11151E] text-xs font-medium text-slate-200 focus:outline-none focus:border-cyan-400"
          >
            <option value="" disabled>
              Load Template...
            </option>
            <option value="blank">Blank Grid</option>
            {OFFICIAL_ARENAS.map((a) => (
              <option key={a.id} value={a.id}>
                Base: {a.name}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-[#11151E] hover:bg-[#181D29] text-xs font-semibold text-slate-200 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            Import
            <input type="file" accept="application/json" onChange={importJson} className="hidden" />
          </label>

          <button
            type="button"
            onClick={exportJson}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-[#11151E] hover:bg-[#181D29] text-xs font-semibold text-slate-200 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-xs font-semibold text-slate-950 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Publishing...' : 'Publish Arena'}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-lg border px-4 py-2.5 text-xs font-medium ${
            feedback.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Placement Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-xl border border-white/8 bg-[#11151E]">
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTool(t.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              tool === t.id
                ? 'bg-cyan-500 text-slate-950'
                : 'text-slate-300 hover:bg-white/6 hover:text-white'
            }`}
          >
            {t.id !== 'select' && <Plus className="w-3 h-3" />}
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Blueprint Canvas */}
        <div className="lg:col-span-8 rounded-xl border border-white/8 bg-[#0B0E15] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-3">
            <span>
              Top-Down Blueprint · {width}m × {depth}m · {blocks.length} structures
            </span>
            <span>
              Spawns: {spawns.filter((s) => s.team === 'cobalt').length} Cobalt /{' '}
              {spawns.filter((s) => s.team === 'ember').length} Ember
            </span>
          </div>

          <div className="relative w-full overflow-hidden rounded-lg border border-white/8 bg-[#070A10]">
            <svg
              viewBox={`${-width / 2} ${-depth / 2} ${width} ${depth}`}
              onClick={handleSvgClick}
              className="w-full h-[500px] cursor-crosshair select-none"
            >
              {/* Grid lines */}
              <defs>
                <pattern id="arenaGrid" width="4" height="4" patternUnits="userSpaceOnUse">
                  <path d="M 4 0 L 0 0 0 4" fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="0.12" />
                </pattern>
              </defs>
              <rect x={-width / 2} y={-depth / 2} width={width} height={depth} fill="url(#arenaGrid)" />
              <line x1={-width / 2} y1={0} x2={width / 2} y2={0} stroke="rgba(255,255,255,0.12)" strokeWidth="0.15" />

              {/* Blocks */}
              {blocks.map((b) => {
                const isSelected = b.id === selectedBlockId;
                const fill =
                  b.type === 'bridge'
                    ? 'rgba(56,189,248,0.22)'
                    : b.type === 'ramp'
                      ? 'rgba(245,158,11,0.25)'
                      : b.accent === 'cobalt'
                        ? 'rgba(56,189,248,0.35)'
                        : b.accent === 'ember'
                          ? 'rgba(249,115,22,0.35)'
                          : 'rgba(148,163,184,0.3)';
                const stroke = isSelected ? '#22D3EE' : 'rgba(255,255,255,0.45)';
                const deg = ((b.rotY || 0) * 180) / Math.PI;

                return (
                  <g
                    key={b.id}
                    transform={`translate(${b.x}, ${b.z}) rotate(${-deg})`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelectedBlockId(b.id);
                    }}
                    className="cursor-pointer"
                  >
                    <rect
                      x={-b.w / 2}
                      y={-b.d / 2}
                      width={b.w}
                      height={b.d}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={isSelected ? 0.4 : 0.18}
                    />
                    <text
                      x={0}
                      y={0.4}
                      textAnchor="middle"
                      fontSize="1.1"
                      fill="#E2E8F0"
                      pointerEvents="none"
                    >
                      {b.type[0].toUpperCase()}
                    </text>
                  </g>
                );
              })}

              {/* Pads */}
              {pads.map((p) => (
                <g
                  key={p.id}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setPads((prev) => prev.filter((item) => item.id !== p.id));
                  }}
                  className="cursor-pointer"
                >
                  <circle
                    cx={p.x}
                    cy={p.z}
                    r={1.1}
                    fill={p.kind === 'overcharge' ? 'rgba(245,158,11,0.45)' : 'rgba(16,185,129,0.45)'}
                    stroke={p.kind === 'overcharge' ? '#F59E0B' : '#10B981'}
                    strokeWidth="0.25"
                  />
                </g>
              ))}

              {/* Spawns */}
              {spawns.map((s, idx) => (
                <g
                  key={`${s.team}-${idx}`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (spawns.filter((sp) => sp.team === s.team).length > 1) {
                      setSpawns((prev) => prev.filter((_, i) => i !== idx));
                    }
                  }}
                  className="cursor-pointer"
                >
                  <circle
                    cx={s.x}
                    cy={s.z}
                    r={0.95}
                    fill={s.team === 'cobalt' ? '#38BDF8' : '#F97316'}
                    stroke="#FFFFFF"
                    strokeWidth="0.2"
                  />
                </g>
              ))}
            </svg>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Click any block to inspect/resize. Click a spawn or pad to remove it (minimum 1 spawn per team).
          </p>
        </div>

        {/* Right Inspector */}
        <div className="lg:col-span-4 space-y-5 rounded-xl border border-white/8 bg-[#11151E] p-5">
          <div className="space-y-3">
            <h2 className="font-display text-lg font-bold text-slate-100">Arena Metadata</h2>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Map Name</label>
              <input
                type="text"
                value={name}
                maxLength={42}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0B0E15] border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-cyan-400"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Description</label>
              <textarea
                rows={2}
                value={description}
                maxLength={160}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#0B0E15] border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-cyan-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Width (m)</label>
                <input
                  type="number"
                  min={24}
                  max={80}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value) || 48)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0E15] border border-white/10 text-sm font-mono-tabular text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Depth (m)</label>
                <input
                  type="number"
                  min={24}
                  max={90}
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value) || 60)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0E15] border border-white/10 text-sm font-mono-tabular text-slate-100"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-white/8 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-100">Selected Block</h2>
              {selectedBlock && (
                <button
                  type="button"
                  onClick={deleteSelected}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-500/15 text-red-300 hover:bg-red-500/25 text-xs font-semibold cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              )}
            </div>

            {selectedBlock ? (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">X Position</label>
                  <input
                    type="number"
                    step={0.5}
                    value={selectedBlock.x}
                    onChange={(e) => updateSelected({ x: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0B0E15] border border-white/10 font-mono-tabular text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Z Position</label>
                  <input
                    type="number"
                    step={0.5}
                    value={selectedBlock.z}
                    onChange={(e) => updateSelected({ z: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0B0E15] border border-white/10 font-mono-tabular text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Base Y (Elevation)</label>
                  <input
                    type="number"
                    step={0.5}
                    min={0}
                    max={10}
                    value={selectedBlock.y}
                    onChange={(e) => updateSelected({ y: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0B0E15] border border-white/10 font-mono-tabular text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Height (H)</label>
                  <input
                    type="number"
                    step={0.2}
                    min={0.4}
                    max={12}
                    value={selectedBlock.h}
                    onChange={(e) => updateSelected({ h: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0B0E15] border border-white/10 font-mono-tabular text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Width (W)</label>
                  <input
                    type="number"
                    step={0.5}
                    min={0.8}
                    max={40}
                    value={selectedBlock.w}
                    onChange={(e) => updateSelected({ w: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0B0E15] border border-white/10 font-mono-tabular text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Depth (D)</label>
                  <input
                    type="number"
                    step={0.5}
                    min={0.8}
                    max={40}
                    value={selectedBlock.d}
                    onChange={(e) => updateSelected({ d: Number(e.target.value) })}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0B0E15] border border-white/10 font-mono-tabular text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Rotation (deg)</label>
                  <input
                    type="number"
                    step={15}
                    value={Math.round(((selectedBlock.rotY || 0) * 180) / Math.PI)}
                    onChange={(e) => updateSelected({ rotY: (Number(e.target.value) * Math.PI) / 180 })}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0B0E15] border border-white/10 font-mono-tabular text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Accent Trim</label>
                  <select
                    value={selectedBlock.accent || 'neutral'}
                    onChange={(e) => updateSelected({ accent: e.target.value as 'cobalt' | 'ember' | 'neutral' })}
                    className="w-full px-2.5 py-1.5 rounded bg-[#0B0E15] border border-white/10 text-slate-100"
                  >
                    <option value="neutral">Neutral</option>
                    <option value="cobalt">Cobalt</option>
                    <option value="ember">Ember</option>
                  </select>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Select any structure on the blueprint canvas to modify its elevation, dimensions, rotation, or trim.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
