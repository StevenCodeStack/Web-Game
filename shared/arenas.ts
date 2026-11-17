import type { ArenaMap } from './types.ts';

export const OFFICIAL_ARENAS: ArenaMap[] = [
  {
    id: 'neon-citadel',
    name: 'Neon Citadel',
    description: 'Elevated central catwalk over symmetrical monolith cover lanes with dual flank corridors.',
    authorId: 'official',
    authorName: 'Prism League',
    isOfficial: true,
    thumbnailUrl: '/src/assets/images/arena_neon_citadel_1794878260976.jpg',
    width: 48,
    depth: 64,
    ceilingHeight: 14,
    createdAt: 1700000000000,
    blocks: [
      // Central elevated bridge
      { id: 'nc-bridge', type: 'bridge', x: 0, y: 3.2, z: 0, w: 18, h: 0.6, d: 5, accent: 'neutral' },
      // Approach ramps to central bridge
      { id: 'nc-ramp-l', type: 'ramp', x: -12.5, y: 0, z: 0, w: 7, h: 3.2, d: 4.5, rotY: 0, accent: 'cobalt' },
      { id: 'nc-ramp-r', type: 'ramp', x: 12.5, y: 0, z: 0, w: 7, h: 3.2, d: 4.5, rotY: Math.PI, accent: 'ember' },
      // Cobalt base cover monoliths (Z negative side)
      { id: 'nc-cob-1', type: 'wall', x: -7, y: 0, z: -18, w: 5, h: 3.0, d: 1.4, accent: 'cobalt' },
      { id: 'nc-cob-2', type: 'wall', x: 7, y: 0, z: -18, w: 5, h: 3.0, d: 1.4, accent: 'cobalt' },
      { id: 'nc-cob-plat', type: 'platform', x: 0, y: 0, z: -22, w: 8, h: 1.4, d: 5, accent: 'cobalt' },
      // Ember base cover monoliths (Z positive side)
      { id: 'nc-emb-1', type: 'wall', x: -7, y: 0, z: 18, w: 5, h: 3.0, d: 1.4, accent: 'ember' },
      { id: 'nc-emb-2', type: 'wall', x: 7, y: 0, z: 18, w: 5, h: 3.0, d: 1.4, accent: 'ember' },
      { id: 'nc-emb-plat', type: 'platform', x: 0, y: 0, z: 22, w: 8, h: 1.4, d: 5, accent: 'ember' },
      // Midfield tactical pillars & bunkers
      { id: 'nc-pil-1', type: 'pillar', x: -10, y: 0, z: -9, w: 2.6, h: 6.5, d: 2.6, accent: 'neutral' },
      { id: 'nc-pil-2', type: 'pillar', x: 10, y: 0, z: -9, w: 2.6, h: 6.5, d: 2.6, accent: 'neutral' },
      { id: 'nc-pil-3', type: 'pillar', x: -10, y: 0, z: 9, w: 2.6, h: 6.5, d: 2.6, accent: 'neutral' },
      { id: 'nc-pil-4', type: 'pillar', x: 10, y: 0, z: 9, w: 2.6, h: 6.5, d: 2.6, accent: 'neutral' },
      { id: 'nc-mid-w1', type: 'wall', x: -17, y: 0, z: -10, w: 1.5, h: 3.2, d: 7, accent: 'cobalt' },
      { id: 'nc-mid-w2', type: 'wall', x: 17, y: 0, z: 10, w: 1.5, h: 3.2, d: 7, accent: 'ember' },
      { id: 'nc-center-low', type: 'wall', x: 0, y: 0, z: 0, w: 3.2, h: 2.2, d: 3.2, accent: 'neutral' },
    ],
    spawns: [
      { x: -6, y: 0.2, z: -27, team: 'cobalt', yaw: 0 },
      { x: 0, y: 1.6, z: -22, team: 'cobalt', yaw: 0 },
      { x: 6, y: 0.2, z: -27, team: 'cobalt', yaw: 0 },
      { x: -6, y: 0.2, z: 27, team: 'ember', yaw: Math.PI },
      { x: 0, y: 1.6, z: 22, team: 'ember', yaw: Math.PI },
      { x: 6, y: 0.2, z: 27, team: 'ember', yaw: Math.PI },
    ],
    pads: [
      { id: 'nc-pad-1', x: -18, y: 0.05, z: 0, kind: 'overcharge' },
      { id: 'nc-pad-2', x: 18, y: 0.05, z: 0, kind: 'overcharge' },
      { id: 'nc-pad-3', x: 0, y: 3.85, z: 0, kind: 'shield' },
    ],
  },
  {
    id: 'reactor-core',
    name: 'Reactor Core',
    description: 'Tight industrial arena anchored by a central energy column and stepped corner bunkers.',
    authorId: 'official',
    authorName: 'Prism League',
    isOfficial: true,
    thumbnailUrl: '/src/assets/images/arena_reactor_core_1794878260653.jpg',
    width: 44,
    depth: 52,
    ceilingHeight: 15,
    createdAt: 1700000001000,
    blocks: [
      // Central reactor column
      { id: 'rc-core', type: 'pillar', x: 0, y: 0, z: 0, w: 4.5, h: 14, d: 4.5, accent: 'ember' },
      // Ring of low cover around core
      { id: 'rc-ring-n', type: 'wall', x: 0, y: 0, z: -8, w: 6, h: 1.8, d: 1.2, accent: 'cobalt' },
      { id: 'rc-ring-s', type: 'wall', x: 0, y: 0, z: 8, w: 6, h: 1.8, d: 1.2, accent: 'ember' },
      { id: 'rc-ring-w', type: 'wall', x: -8, y: 0, z: 0, w: 1.2, h: 2.4, d: 6, accent: 'neutral' },
      { id: 'rc-ring-e', type: 'wall', x: 8, y: 0, z: 0, w: 1.2, h: 2.4, d: 6, accent: 'neutral' },
      // Corner elevated bunkers
      { id: 'rc-bunk-nw', type: 'platform', x: -14, y: 0, z: -15, w: 8, h: 2.2, d: 8, accent: 'cobalt' },
      { id: 'rc-ramp-nw', type: 'ramp', x: -8, y: 0, z: -15, w: 4.5, h: 2.2, d: 4, rotY: Math.PI, accent: 'cobalt' },
      { id: 'rc-bunk-se', type: 'platform', x: 14, y: 0, z: 15, w: 8, h: 2.2, d: 8, accent: 'ember' },
      { id: 'rc-ramp-se', type: 'ramp', x: 8, y: 0, z: 15, w: 4.5, h: 2.2, d: 4, rotY: 0, accent: 'ember' },
      // Diagonal cover walls
      { id: 'rc-diag-1', type: 'wall', x: 12, y: 0, z: -12, w: 6, h: 2.8, d: 1.3, rotY: Math.PI / 4, accent: 'neutral' },
      { id: 'rc-diag-2', type: 'wall', x: -12, y: 0, z: 12, w: 6, h: 2.8, d: 1.3, rotY: Math.PI / 4, accent: 'neutral' },
    ],
    spawns: [
      { x: -14, y: 2.4, z: -15, team: 'cobalt', yaw: 0.4 },
      { x: 4, y: 0.2, z: -21, team: 'cobalt', yaw: 0 },
      { x: -4, y: 0.2, z: -21, team: 'cobalt', yaw: 0 },
      { x: 14, y: 2.4, z: 15, team: 'ember', yaw: Math.PI + 0.4 },
      { x: -4, y: 0.2, z: 21, team: 'ember', yaw: Math.PI },
      { x: 4, y: 0.2, z: 21, team: 'ember', yaw: Math.PI },
    ],
    pads: [
      { id: 'rc-pad-1', x: -15, y: 0.05, z: 0, kind: 'shield' },
      { id: 'rc-pad-2', x: 15, y: 0.05, z: 0, kind: 'overcharge' },
    ],
  },
  {
    id: 'gridiron-overpass',
    name: 'Gridiron Overpass',
    description: 'High-speed dual-overpass stadium built for long-range laser duels and vertical flanks.',
    authorId: 'official',
    authorName: 'Prism League',
    isOfficial: true,
    thumbnailUrl: '/src/assets/images/arena_gridiron_overpass_1794878261889.jpg',
    width: 52,
    depth: 70,
    ceilingHeight: 16,
    createdAt: 1700000002000,
    blocks: [
      // Left and right flanking overpasses
      { id: 'go-over-w', type: 'bridge', x: -19, y: 3.4, z: 0, w: 6, h: 0.6, d: 34, accent: 'cobalt' },
      { id: 'go-over-e', type: 'bridge', x: 19, y: 3.4, z: 0, w: 6, h: 0.6, d: 34, accent: 'ember' },
      // Ramps onto west overpass
      { id: 'go-rw-n', type: 'ramp', x: -19, y: 0, z: -20.5, w: 5.5, h: 3.4, d: 7, rotY: -Math.PI / 2, accent: 'cobalt' },
      { id: 'go-rw-s', type: 'ramp', x: -19, y: 0, z: 20.5, w: 5.5, h: 3.4, d: 7, rotY: Math.PI / 2, accent: 'cobalt' },
      // Ramps onto east overpass
      { id: 'go-re-n', type: 'ramp', x: 19, y: 0, z: -20.5, w: 5.5, h: 3.4, d: 7, rotY: -Math.PI / 2, accent: 'ember' },
      { id: 'go-re-s', type: 'ramp', x: 19, y: 0, z: 20.5, w: 5.5, h: 3.4, d: 7, rotY: Math.PI / 2, accent: 'ember' },
      // Midfield staggered barriers
      { id: 'go-mid-1', type: 'wall', x: -6, y: 0, z: -10, w: 6, h: 2.6, d: 1.4, rotY: 0.25, accent: 'cobalt' },
      { id: 'go-mid-2', type: 'wall', x: 6, y: 0, z: 10, w: 6, h: 2.6, d: 1.4, rotY: 0.25, accent: 'ember' },
      { id: 'go-mid-3', type: 'wall', x: 6, y: 0, z: -10, w: 6, h: 2.6, d: 1.4, rotY: -0.25, accent: 'cobalt' },
      { id: 'go-mid-4', type: 'wall', x: -6, y: 0, z: 10, w: 6, h: 2.6, d: 1.4, rotY: -0.25, accent: 'ember' },
      { id: 'go-hub', type: 'pillar', x: 0, y: 0, z: 0, w: 3.5, h: 5.5, d: 3.5, accent: 'neutral' },
    ],
    spawns: [
      { x: -8, y: 0.2, z: -29, team: 'cobalt', yaw: 0 },
      { x: 0, y: 0.2, z: -29, team: 'cobalt', yaw: 0 },
      { x: 8, y: 0.2, z: -29, team: 'cobalt', yaw: 0 },
      { x: -8, y: 0.2, z: 29, team: 'ember', yaw: Math.PI },
      { x: 0, y: 0.2, z: 29, team: 'ember', yaw: Math.PI },
      { x: 8, y: 0.2, z: 29, team: 'ember', yaw: Math.PI },
    ],
    pads: [
      { id: 'go-pad-1', x: -19, y: 4.05, z: 0, kind: 'overcharge' },
      { id: 'go-pad-2', x: 19, y: 4.05, z: 0, kind: 'overcharge' },
      { id: 'go-pad-3', x: 0, y: 0.05, z: -6, kind: 'shield' },
      { id: 'go-pad-4', x: 0, y: 0.05, z: 6, kind: 'shield' },
    ],
  },
];
