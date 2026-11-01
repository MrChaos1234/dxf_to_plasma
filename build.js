import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {Script} from 'node:vm';
// Inline trusted local source to produce an offline file, without a bundler dependency.
const root = new URL('./',import.meta.url);
const read = name => readFile(new URL(name,root),'utf8');
const [html,css,core,app,sample,clipper,toolpaths,boost,jsbn,presets,layout] = await Promise.all(['index.html','style.css','core.js','app.js','sample.dxf','vendor/clipper.js','toolpaths.js','vendor/LICENSE-Boost.txt','vendor/LICENSE-JSBN.txt','presets.js','layout.js'].map(read));
const stripImports = source => source.replace(/^import .*;\s*$/gm,'');
const moduleCode = (source,names) => `const {${names.join(',')}} = (() => {\n${stripImports(source).replace(/^export \{.*\};\s*$/gm,'').replace(/^export /gm,'')}\nreturn {${names.join(',')}};\n})();`;
const script = `(() => {\nconst THIRD_PARTY_LICENSES = ${JSON.stringify(boost+"\n"+jsbn)};\nconst SAMPLE_DXF = ${JSON.stringify(sample)};\n${moduleCode(clipper,['ClipperLib'])}\n${moduleCode(toolpaths,['joinContours','toolpathLength','offsetContour','prepareToolpaths','inferCutSides','orderToolpaths'])}\n${moduleCode(layout,['positionDrawing','positionToolpaths'])}\n${moduleCode(core,['parseDXF','generateGCode'])}\n${moduleCode(presets,['PRESET_STORAGE_KEY','validatePreset','upsertPreset','parsePresetLibrary','serializePresetLibrary'])}\n${stripImports(app).replace("await fetch('sample.dxf')",'new Response(SAMPLE_DXF)')}\n})();`;
new Script(script,{filename:'arc-standalone.js'}); // Catch bundling errors before writing the download.
const output = html
  .replace('<link rel="stylesheet" href="style.css">',()=>`<style>${css.replace(/@import[^;]+;\s*/g,'')}</style>`)
  .replace('<script type="module" src="app.js"></script>',()=>`<script>${script.replace(/<\/script/gi,'<\\/script')}</script>`);
await mkdir(new URL('dist/',root),{recursive:true});
await writeFile(new URL('dist/arc.html',root),output);
await mkdir(new URL('web/',root),{recursive:true});
await writeFile(new URL('web/index.html',root),output);
console.log('Built dist/arc.html and web/index.html — standalone app ready for FTP or offline use.');
