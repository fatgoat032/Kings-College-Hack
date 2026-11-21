// Demo forts built in code: tall, dense towers with blobs inside and on top.
// Same Level JSON shape as src/shared/level.js (which stays untouched).
import { WORLD } from './config.js';

const G = WORLD.groundY;

function builder(name) {
  const blocks = [];
  const pigs = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  return {
    block(material, x, y, w, h) {
      blocks.push({ id: id('b'), material, x, y, w, h, angle: 0 });
    },
    pig(x, y, r = 22) {
      pigs.push({ id: id('p'), x, y, r });
    },
    // One storey: two posts plus a floor on top. base = y of the surface it stands on.
    // Returns the y of the new floor's top surface.
    storey(cx, base, { post = 'wood', floor = 'wood', width = 180, height = 110, pig = true, pigR = 22 } = {}) {
      const half = width / 2 - 14;
      this.block(post, cx - half, base - height / 2, 22, height);
      this.block(post, cx + half, base - height / 2, 22, height);
      this.block(floor, cx, base - height - 10, width, 20);
      if (pig) this.pig(cx, base - pigR, pigR);
      return base - height - 20;
    },
    level() {
      return { version: 1, blocks, pigs, meta: { source: 'sample', name } };
    },
  };
}

function pencilTowers() {
  const b = builder('Pencil towers');
  // left tower: 3 storeys
  let top = b.storey(1020, G, { post: 'stone', floor: 'wood' });
  top = b.storey(1020, top, { post: 'wood', floor: 'wood', pigR: 20 });
  top = b.storey(1020, top, { post: 'ice', floor: 'ice', pig: false });
  b.pig(1020, top - 24, 24);
  // right tower: 4 storeys, TNT in the middle
  top = b.storey(1330, G, { post: 'wood', floor: 'wood', pig: false });
  b.block('tnt', 1330, G - 25, 50, 50);
  top = b.storey(1330, top, { post: 'wood', floor: 'stone', pigR: 20 });
  top = b.storey(1330, top, { post: 'ice', floor: 'wood' });
  top = b.storey(1330, top, { post: 'ice', floor: 'ice', height: 90, pigR: 18 });
  b.pig(1330, top - 20, 20);
  return b.level();
}

function sketchCastle() {
  const b = builder('Sketch castle');
  // stone keep in the middle, wood wings either side
  let wing = b.storey(980, G, { post: 'wood', floor: 'wood', width: 150, pigR: 20 });
  b.block('ice', 980, wing - 40, 22, 80);
  b.pig(980, wing - 80 - 20, 20);
  let keep = b.storey(1200, G, { post: 'stone', floor: 'stone', width: 200 });
  keep = b.storey(1200, keep, { post: 'wood', floor: 'wood', width: 200, pig: false });
  b.block('tnt', 1200, keep + 105, 50, 50);
  keep = b.storey(1200, keep, { post: 'ice', floor: 'wood', width: 160, pigR: 22 });
  b.pig(1200, keep - 26, 26);
  wing = b.storey(1420, G, { post: 'wood', floor: 'wood', width: 150, pigR: 20 });
  wing = b.storey(1420, wing, { post: 'ice', floor: 'ice', width: 150, height: 90, pigR: 18 });
  return b.level();
}

function bigStack() {
  const b = builder('The big stack');
  // a pyramid of storeys: 3 wide at the bottom, 2, then 1, crowned with blobs
  const xs = [[1000, 1200, 1400], [1100, 1300], [1200]];
  const mats = [
    { post: 'stone', floor: 'wood' },
    { post: 'wood', floor: 'ice' },
    { post: 'ice', floor: 'wood' },
  ];
  let base = G;
  xs.forEach((row, level) => {
    let top = base;
    row.forEach((x, i) => {
      top = b.storey(x, base, { ...mats[level], width: 200, height: 100, pig: (i + level) % 2 === 0, pigR: 20 });
    });
    base = top;
  });
  b.pig(1200, base - 26, 26);
  b.block('tnt', 1300, G - 25, 50, 50);
  return b.level();
}

export const demoLevels = [pencilTowers(), sketchCastle(), bigStack()];
