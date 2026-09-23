// Copies only the browser files the app loads into public/vendor (committed, so hosting needs no build step).
import {mkdir, copyFile, rm} from 'node:fs/promises';
await rm('public/vendor', {recursive: true, force: true});
await mkdir('public/vendor/maplibre-gl', {recursive: true});
await mkdir('public/vendor/supabase', {recursive: true});
for (const f of ['maplibre-gl.js', 'maplibre-gl.css']) await copyFile(`node_modules/maplibre-gl/dist/${f}`, `public/vendor/maplibre-gl/${f}`);
await copyFile('node_modules/maplibre-gl/LICENSE.txt', 'public/vendor/maplibre-gl/LICENSE.txt');
await copyFile('node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'public/vendor/supabase/supabase.js');
await copyFile('node_modules/@supabase/supabase-js/LICENSE', 'public/vendor/supabase/LICENSE');
console.log('Vendored MapLibre and Supabase browser builds.');
