// Local copy of sample levels in the plan's Level JSON format, used until
// src/shared/level.js lands on main. Swap the import over to src/shared once it exists.

export const sampleLevels = [
  {
    version: 1,
    blocks: [
      { id: 'b1', material: 'wood', x: 1100, y: 790, w: 20, h: 120, angle: 0 },
      { id: 'b2', material: 'wood', x: 1240, y: 790, w: 20, h: 120, angle: 0 },
      { id: 'b3', material: 'wood', x: 1170, y: 720, w: 180, h: 20, angle: 0 },
      { id: 'b4', material: 'ice', x: 1130, y: 670, w: 20, h: 80, angle: 0 },
      { id: 'b5', material: 'ice', x: 1210, y: 670, w: 20, h: 80, angle: 0 },
      { id: 'b6', material: 'wood', x: 1170, y: 620, w: 120, h: 20, angle: 0 },
    ],
    pigs: [
      { id: 'p1', x: 1170, y: 828, r: 22 },
      { id: 'p2', x: 1170, y: 688, r: 20 },
    ],
    meta: { source: 'sample', name: 'Two storeys' },
  },
  {
    version: 1,
    blocks: [
      { id: 'b1', material: 'stone', x: 1000, y: 800, w: 30, h: 100, angle: 0 },
      { id: 'b2', material: 'stone', x: 1160, y: 800, w: 30, h: 100, angle: 0 },
      { id: 'b3', material: 'wood', x: 1080, y: 740, w: 210, h: 20, angle: 0 },
      { id: 'b4', material: 'tnt', x: 1080, y: 705, w: 50, h: 50, angle: 0 },
      { id: 'b5', material: 'ice', x: 1320, y: 790, w: 20, h: 120, angle: 0 },
      { id: 'b6', material: 'ice', x: 1440, y: 790, w: 20, h: 120, angle: 0 },
      { id: 'b7', material: 'ice', x: 1380, y: 720, w: 160, h: 20, angle: 0 },
    ],
    pigs: [
      { id: 'p1', x: 1080, y: 828, r: 22 },
      { id: 'p2', x: 1380, y: 828, r: 22 },
      { id: 'p3', x: 1380, y: 690, r: 18 },
    ],
    meta: { source: 'sample', name: 'TNT on top' },
  },
  {
    version: 1,
    blocks: [
      { id: 'b1', material: 'wood', x: 950, y: 810, w: 20, h: 80, angle: 0 },
      { id: 'b2', material: 'wood', x: 1050, y: 810, w: 20, h: 80, angle: 0 },
      { id: 'b3', material: 'wood', x: 1000, y: 760, w: 140, h: 20, angle: 0 },
      { id: 'b4', material: 'stone', x: 1200, y: 760, w: 40, h: 180, angle: 0 },
      { id: 'b5', material: 'wood', x: 1350, y: 790, w: 20, h: 120, angle: 0 },
      { id: 'b6', material: 'wood', x: 1500, y: 790, w: 20, h: 120, angle: 0 },
      { id: 'b7', material: 'wood', x: 1425, y: 720, w: 190, h: 20, angle: 0 },
      { id: 'b8', material: 'tnt', x: 1425, y: 685, w: 50, h: 50, angle: 0 },
      { id: 'b9', material: 'ice', x: 1200, y: 660, w: 120, h: 20, angle: 0 },
    ],
    pigs: [
      { id: 'p1', x: 1000, y: 828, r: 20 },
      { id: 'p2', x: 1425, y: 828, r: 24 },
      { id: 'p3', x: 1200, y: 634, r: 16 },
    ],
    meta: { source: 'sample', name: 'Castle wall' },
  },
];
