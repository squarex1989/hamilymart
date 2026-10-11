import { build } from 'vite';
import { mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const website = path.dirname(root);
const python = spawnSync('python3', [path.join(root, 'scripts/convert-models.py')], { stdio: 'inherit' });
if (python.status !== 0) process.exit(python.status || 1);
await build({ configFile: path.join(root, 'vite.config.ts') });
const dist = path.join(root, 'dist');
cpSync(path.join(root, 'generated/models'), path.join(dist, 'models'), { recursive: true });
const thumbs = spawnSync('python3', [path.join(root, 'scripts/convert-thumbnails.py')], { stdio: 'inherit' });
if (thumbs.status !== 0) process.exit(thumbs.status || 1);
writeFileSync(path.join(dist, 'index.html'), `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"><meta name="theme-color" content="#315b45"><title>HamilyMart · 仓鼠造屋所</title><link rel="stylesheet" href="./hamilymart.css"></head><body><div id="root"></div><script src="./app.js"></script></body></html>\n`);
const files=[]; const walk = (dir) => { for (const name of readdirSync(dir)) { const f=path.join(dir,name); if (statSync(f).isDirectory()) walk(f); else files.push({file:path.relative(dist,f),bytes:statSync(f).size}); } }; walk(dist);
writeFileSync(path.join(root, 'generated/build-files.json'), JSON.stringify(files, null, 2));
console.log(`Prepared ${files.length} offline files at ${dist}`);
