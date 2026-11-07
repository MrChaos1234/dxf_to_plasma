import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {Script} from 'node:vm';
// Inline trusted local source. Both FTP apps contain all scripts, styles and licenses.
const root=new URL('./',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');
const [css,core,app,sample,clipper,toolpaths,boost,jsbn,presets,layout,shapes,partsApp,splines]=await Promise.all(['style.css','core.js','app.js','sample.dxf','vendor/clipper.js','toolpaths.js','vendor/LICENSE-Boost.txt','vendor/LICENSE-JSBN.txt','presets.js','layout.js','quick/shapes.js','quick/app.js','splines.js'].map(read));
const stripImports=source=>source.replace(/^import .*;\s*$/gm,'');
const stripModule=source=>stripImports(source).replace(/^export \{.*\};\s*$/gm,'').replace(/^export /gm,'');
const moduleCode=(source,names)=>`const {${names.join(',')}} = (() => {\n${stripModule(source)}\nreturn {${names.join(',')}};\n})();`;
const shared=`const THIRD_PARTY_LICENSES = ${JSON.stringify(boost+'\n'+jsbn)};\nconst SAMPLE_DXF = ${JSON.stringify(sample)};\n${moduleCode(clipper,['ClipperLib'])}\n${moduleCode(toolpaths,['joinContours','toolpathLength','offsetContour','prepareToolpaths','inferCutSides','orderToolpaths'])}\n${moduleCode(layout,['positionDrawing','positionToolpaths'])}\n${moduleCode(splines,['splineGeometry'])}\n${moduleCode(core,['parseDXF','generateGCode'])}\n${moduleCode(presets,['PRESET_STORAGE_KEY','validatePreset','upsertPreset','parsePresetLibrary','serializePresetLibrary'])}\n${stripModule(app).replace("await fetch('sample.dxf')",'new Response(SAMPLE_DXF)')}`;
await mkdir(new URL('dist/',root),{recursive:true});await mkdir(new URL('web/',root),{recursive:true});
for(const entry of [{source:'index.html',script:'app.js',dist:'arc.html',web:'index.html',extra:''},{source:'teile.html',script:'quick/app.js',dist:'teile.html',web:'teile.html',extra:`${moduleCode(shapes,['PART_TEMPLATES','createPart'])}\n(() => {\n${stripModule(partsApp)}\n})();`}]) {
  const html=await read(entry.source),script=`(() => {\n${shared}\n${entry.extra}\n})();`;
  new Script(script,{filename:entry.dist+'.js'});
  const output=html.replace('<link rel="stylesheet" href="style.css">',()=>`<style>${css.replace(/@import[^;]+;\s*/g,'')}</style>`).replace(`<script type="module" src="${entry.script}"></script>`,()=>`<script>${script.replace(/<\/script/gi,'<\\/script')}</script>`);
  await writeFile(new URL('dist/'+entry.dist,root),output);await writeFile(new URL('web/'+entry.web,root),output);
  console.log(`Built web/${entry.web} and dist/${entry.dist}`);
}
