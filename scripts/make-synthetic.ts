import fs from 'node:fs';
import { syntheticGrid } from '../tests/fixtures/synthetic';
import { emptyState } from '../src/state';
import { serializeProject } from '../src/project';

const { osm, houses } = syntheticGrid(5, 5, 3);
const s = emptyState();
s.osm = osm;
s.houses = houses;
s.config.groups = 4;
s.config.iterations = 400;
fs.writeFileSync(process.argv[2] ?? 'synthetic-project.json', serializeProject(s));
console.log(`wrote ${houses.length} houses`);
