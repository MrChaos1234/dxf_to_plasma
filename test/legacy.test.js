import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {inflateRawSync} from 'node:zlib';
import {compileLegacyEngine,zipFiles} from '../build-legacy.js';
import {parseDXF,generateGCode} from '../core.js';
import {createPart,PART_TEMPLATES} from '../quick/shapes.js';
import {addStencilText} from '../quick/text.js';
const compiled=await compileLegacyEngine();
function context(descriptors){
 const ctx=vm.createContext({setTimeout,clearTimeout});
 vm.runInContext(`var window=this;ArrayBuffer=undefined;DataView=undefined;Uint8Array=undefined;Uint16Array=undefined;Int8Array=undefined;Uint8ClampedArray=undefined;Int16Array=undefined;Uint32Array=undefined;Int32Array=undefined;Float32Array=undefined;Float64Array=undefined;Symbol=undefined;Map=undefined;Set=undefined;JSON=undefined;Array.from=undefined;Array.prototype.at=undefined;Array.prototype.flat=undefined;Array.prototype.flatMap=undefined;Object.fromEntries=undefined;String.prototype.normalize=undefined;`+(descriptors?'':`Object.defineProperty=function(){throw Error('IE8 plain-object descriptors are unavailable')};`),ctx);
 // IE8 does not implement strict mode. Strip directives in this simulation so
 // V8 does not reject assignments to its modern read-only function.name fields.
 vm.runInContext(descriptors?compiled:compiled.replace(/['"]use strict['"];?/g,''),ctx,{timeout:30000});return ctx;
}
const cfg={feed:1000,delay:.5,dwellUnit:'ms',on:'M8',off:'M9',kerf:1.2,overlap:0,origin:false};
test('legacy engine and polyfills reproduce modern part and Mach3 output without modern globals',()=>{
 const ctx=context(true),xp=ctx.ARC_XP_TEST;
 for(const t of PART_TEMPLATES){
  const p=xp.createPart(t.id,t.defaults),d=xp.parseDXF(p.dxf),s=xp.inferCutSides(d).map(x=>x.side);
  const modern=parseDXF(createPart(t.id,t.defaults).dxf);
  assert.equal(xp.generateGCode(d,{...cfg,cutSides:s}),generateGCode(modern,{...cfg,cutSides:s}));
 }
});
test('precomputed stencil contours match all three modern fonts without typed arrays or descriptors',()=>{
 const ctx=context(false),xp=ctx.ARC_XP_TEST,p=createPart('sign',{width:260,height:85,radius:5});
 assert.equal(vm.runInContext('typeof Uint8Array',ctx),'undefined');
 for(const font of ['allerta-stencil','saira-stencil-one','stardos-stencil']){
  const opts={enabled:true,text:'ARC Äß',font,height:22,tracking:1,lineGap:5,x:0,y:0,bridges:'font',bridgeWidth:1.5,clearance:1};
  const legacy=xp.addStencilText(p,opts),modern=addStencilText(p,opts);
  assert.equal(legacy.dxf,modern.dxf);
  const d=xp.parseDXF(legacy.dxf),s=xp.inferCutSides(d).map(x=>x.side);
  assert.ok(s.slice(1).every(x=>x==='inside'));assert.match(xp.generateGCode(d,{...cfg,cutSides:s}),/M8\nG4 P500\n/);
 }
});
test('legacy export still rejects unsupported geometry, unresolved sides and collapsed kerf offsets',()=>{
 const xp=context(false).ARC_XP_TEST,d=xp.parseDXF(createPart('circle',{diameter:50,bore:1}).dxf);
 assert.throws(()=>xp.generateGCode(d,{...cfg,cutSides:['outside','inside']}),/Schnittfuge/);
 assert.throws(()=>xp.generateGCode(d,{...cfg,cutSides:[null,'inside']}),/manuell/);
 assert.throws(()=>xp.generateGCode({...d,incomplete:true},{...cfg,cutSides:['outside','inside']}),/nicht unterstützte/);
});
test('offline zip has deterministic deflate entries readable by classic ZIP tools',()=>{
 const files={'arc-xp.hta':'\uFEFF<html>ä</html>','arc-xp.html':'<html></html>','LIESMICH.txt':'\uFEFFOffline\r\n'},zip=zipFiles(files);assert.deepEqual(zip,zipFiles(files));
 let offset=0;const found={};
 while(zip.readUInt32LE(offset)===0x04034b50){assert.equal(zip.readUInt16LE(offset+8),8);const size=zip.readUInt32LE(offset+18),length=zip.readUInt16LE(offset+26),name=zip.subarray(offset+30,offset+30+length).toString();found[name]=inflateRawSync(zip.subarray(offset+30+length,offset+30+length+size)).toString();offset+=30+length+size;}
 assert.deepEqual(found,files);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
});
