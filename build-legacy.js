import {readFile,writeFile} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import Babel from './vendor/legacy/babel.cjs';
import {parse as parseES3} from './vendor/legacy/acorn.mjs';
import {parseFont} from './vendor/opentype.js';
import {STENCIL_FONTS} from './quick/fonts.js';
const root=new URL('./',import.meta.url),read=name=>readFile(new URL(name,root),'utf8');
export function zipFiles(files){
  const local=[],central=[];let offset=0;
  for(const [name,text] of Object.entries(files)){
    const filename=Buffer.from(name),data=Buffer.from(text),compressed=deflateRawSync(data,{level:9});let crc=0xffffffff;
    for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    local.push(header,filename,compressed);const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(8,10);directory.writeUInt16LE(33,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);central.push(directory,filename);offset+=header.length+filename.length+compressed.length;
  }
  const dirs=Buffer.concat(central),end=Buffer.alloc(22),count=Object.keys(files).length;end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(dirs.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,dirs,end]);
}
function glyphData(){return STENCIL_FONTS.map(f=>{const binary=Buffer.from(f.data,'base64'),font=parseFont(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.length));const glyphs={},chars=[];for(let i=32;i<127;i++)chars.push(String.fromCharCode(i));chars.push('Ä','Ö','Ü','ß');for(const c of chars){const g=font.charToGlyph(c);if(g.index)glyphs[c]={index:g.index,advanceWidth:g.advanceWidth,commands:g.getPath(0,0,font.unitsPerEm).commands};}const kern={};for(const a of Object.values(glyphs))for(const b of Object.values(glyphs)){const k=font.getKerningValue(a,b);if(k)kern[a.index+','+b.index]=k;}return {id:f.id,name:f.name,unitsPerEm:font.unitsPerEm,cap:font.charToGlyph('H').getBoundingBox().y2,glyphs,kerning:kern};});}
const stripModule=source=>source.replace(/^import .*;\s*$/gm,'').replace(/^export \{.*\};\s*$/gm,'').replace(/^export /gm,'');
const moduleCode=(source,names)=>`const {${names.join(',')}} = (() => {\n${stripModule(source)}\nreturn {${names.join(',')}};\n})();`;
async function sourceFiles(){
 const files={clipper:'vendor/clipper.js',toolpaths:'toolpaths.js',layout:'layout.js',splines:'splines.js',core:'core.js',presets:'presets.js',shapes:'quick/shapes.js',text:'quick/text.js',sample:'sample.dxf',boost:'vendor/LICENSE-Boost.txt',jsbn:'vendor/LICENSE-JSBN.txt',openLicense:'vendor/LICENSE-opentype.txt',allertaLicense:'vendor/text-fonts/LICENSE-allerta-stencil.txt',sairaLicense:'vendor/text-fonts/LICENSE-saira-stencil-one.txt',stardosLicense:'vendor/text-fonts/LICENSE-stardos-stencil.txt'};
 return Object.fromEntries(await Promise.all(Object.entries(files).map(async([key,path])=>[key,await read(path)])));
}
function engineSource(sources){
 const fonts=glyphData();
 const adapter=`var LEGACY_FONT_DATA=${JSON.stringify(fonts)};var LEGACY_FONTS=LEGACY_FONT_DATA;\nfunction legacyFont(id){var data=null;for(var i=0;i<LEGACY_FONT_DATA.length;i++)if(LEGACY_FONT_DATA[i].id===id)data=LEGACY_FONT_DATA[i];if(!data)throw new Error('Unbekannte Schrift.');return {unitsPerEm:data.unitsPerEm,charToGlyph:function(c){var g=data.glyphs[c];if(!g)return {index:0};return {index:g.index,advanceWidth:g.advanceWidth,getBoundingBox:function(){return {y2:data.cap};},getPath:function(x,y,size){var commands=[],scale=size/data.unitsPerEm;for(var i=0;i<g.commands.length;i++){var input=g.commands[i],command={type:input.type};for(var k in input)if(k!=='type'&&Object.prototype.hasOwnProperty.call(input,k))command[k]=input[k]*scale+(k.charAt(0)==='x'?x:y);commands.push(command);}return {commands:commands};}};},getKerningValue:function(a,b){return data.kerning[a.index+','+b.index]||0;}};}`;
 const text=sources.text.replace(/function fontFor\(id\) \{[\s\S]*?\n\}\nfunction polygonPaths/,"function fontFor(id) {return legacyFont(id);}\nfunction polygonPaths");
 const engine=[moduleCode(sources.clipper,['ClipperLib']),moduleCode(sources.toolpaths,['joinContours','toolpathLength','offsetContour','prepareToolpaths','inferCutSides','orderToolpaths']),moduleCode(sources.layout,['positionDrawing','positionToolpaths']),moduleCode(sources.splines,['splineGeometry']),moduleCode(sources.core,['parseDXF','generateGCode']),moduleCode(sources.presets,['PRESET_STORAGE_KEY','validatePreset','upsertPreset','parsePresetLibrary','serializePresetLibrary']),moduleCode(sources.shapes,['PART_TEMPLATES','createPart']),adapter,moduleCode(text,['addStencilText','fitStencilText','textPlacementForPart'])].join('\n');
 return engine;
}
export async function buildLegacy(){
 const sources=await sourceFiles();
 const [html,ui,shims,polyfill,json,readme,babelLicense,coreLicense,acornLicense]=await Promise.all(['legacy/index.html','legacy/app.js','legacy/shims.js','vendor/legacy/core-js.js','vendor/legacy/json2.js','legacy/README.txt','vendor/legacy/LICENSE-babel.txt','vendor/legacy/LICENSE-core-js.txt','vendor/legacy/LICENSE-acorn.txt'].map(read));
 const engine=engineSource(sources);
 const licenses=[sources.boost,sources.jsbn,sources.openLicense,sources.allertaLicense,sources.sairaLicense,sources.stardosLicense,coreLicense].join('\n');
 const runtime='(function(){\n'+shims+'\n'+engine+'\nwindow.ARC_XP_TEST={parseDXF:parseDXF,generateGCode:generateGCode,inferCutSides:inferCutSides,createPart:createPart,addStencilText:addStencilText};\nvar LEGACY_SAMPLE='+JSON.stringify(sources.sample)+';\n'+stripModule(ui)+'\n})();';
 const transformed=Babel.transform(runtime,{presets:[['env',{targets:{ie:'6'},modules:false,useBuiltIns:false}]],sourceType:'script',comments:false,compact:false,babelrc:false,configFile:false}).code;
 const engineTest=Babel.transform('(function(){'+shims+'\n'+engine+'\nwindow.ARC_XP_TEST={parseDXF:parseDXF,generateGCode:generateGCode,inferCutSides:inferCutSides,createPart:createPart,addStencilText:addStencilText};})();',{presets:[['env',{targets:{ie:'6'},modules:false,useBuiltIns:false}]],comments:false,compact:false,babelrc:false,configFile:false}).code;
 parseES3(transformed,{ecmaVersion:3});parseES3(polyfill,{ecmaVersion:3});parseES3(json,{ecmaVersion:3});
 await writeFile(new URL('dist/xp-engine.js',root),json+'\n'+polyfill+'\n'+engineTest);
 const script=`var ARC_XP_LICENSES=${JSON.stringify(licenses)};try{\n${json}\n${polyfill}\n${transformed}\n}catch(error){document.getElementById('startup').className='error';document.getElementById('startup').innerHTML='Start fehlgeschlagen. Bitte diese Fehlermeldung und die IE-Version melden: '+String(error.message||error).replace(/&/g,'&amp;').replace(/</g,'&lt;');}`;
 parseES3(script,{ecmaVersion:3});
 const browser=html.replace('/*SCRIPT*/',()=>script.replace(/<\/script/gi,'<\\/script'));
 const application=html.replace('<!--HTA-->','<hta:application id="ArcXP" applicationname="Arc XP" border="thick" caption="yes" sysmenu="yes" singleinstance="yes" scroll="yes" windowstate="maximize">').replace('/*SCRIPT*/',()=>('window.ARC_XP_DESKTOP=true;\n'+script).replace(/<\/script/gi,'<\\/script'));
 const files={'arc-xp.hta':'\uFEFF'+application,'arc-xp.html':'\uFEFF'+browser,'LIESMICH.txt':'\uFEFF'+readme.replace(/\r?\n/g,'\r\n')};
 for(const [name,value] of Object.entries(files))if(name!=='LIESMICH.txt'){await writeFile(new URL('dist/'+name,root),value);await writeFile(new URL('web/'+name,root),value);}
 const zip=zipFiles(files);await writeFile(new URL('dist/arc-xp.zip',root),zip);await writeFile(new URL('web/arc-xp.zip',root),zip);
 console.log('Built web/arc-xp.hta, web/arc-xp.html and web/arc-xp.zip (ES3 syntax).');
}

export async function compileLegacyEngine(){
 const sources=await sourceFiles(),shims=await read('legacy/shims.js'),engine=engineSource(sources);
 const program='(function(){'+shims+'\n'+engine+'\nwindow.ARC_XP_TEST={parseDXF:parseDXF,generateGCode:generateGCode,inferCutSides:inferCutSides,createPart:createPart,addStencilText:addStencilText};})();';
 const output=Babel.transform(program,{presets:[['env',{targets:{ie:'6'},modules:false,useBuiltIns:false}]],comments:false,compact:false,babelrc:false,configFile:false}).code;
 parseES3(output,{ecmaVersion:3});return (await read('vendor/legacy/json2.js'))+'\n'+(await read('vendor/legacy/core-js.js'))+'\n'+output;
}
