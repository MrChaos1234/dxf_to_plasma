import test from 'node:test';
import assert from 'node:assert/strict';
import {createPart} from '../quick/shapes.js';
import {addStencilText,fitStencilText,textPlacementForPart} from '../quick/text.js';
import {STENCIL_FONTS} from '../quick/fonts.js';
import {parseDXF,generateGCode} from '../core.js';
import {inferCutSides} from '../toolpaths.js';
const base=()=>createPart('sign',{width:260,height:85,radius:5});
const opts={enabled:true,text:'WERKSTATT',font:'allerta-stencil',height:22,tracking:1,lineGap:5,x:0,y:0,bridges:'font',bridgeWidth:1.5,clearance:1};
function inspect(part) {
 const d=parseDXF(part.dxf),sides=inferCutSides(d).map(s=>s.side);
 assert.equal(sides[0],'outside');assert.ok(sides.slice(1).every(s=>s==='inside'),'all letter material must stay connected to the plate');
 assert.ok(d.paths.every(p=>p.closed));assert.equal(d.incomplete,false);
 return d;
}
test('all three actual stencil fonts generate contained, island-free letter cuts and inner-first G-code',()=>{
 for(const font of STENCIL_FONTS){
  const p=addStencilText(base(),{...opts,font:font.id}),d=inspect(p);
  const code=generateGCode(d,{feed:1000,delay:.5,dwellUnit:'ms',on:'M8',off:'M9',kerf:1.2,overlap:0,cutSides:inferCutSides(d).map(s=>s.side)});
  const order=code.split('\n').filter(l=>l.startsWith('(Kontur'));assert.match(order.at(-1),/Kontur 1 - aussen/);assert.match(code,/M8\nG4 P500\n/);
  assert.match(p.filename,/text_werkstatt.dxf$/);assert.ok(p.textInfo.width>150);
 }
});
test('A B D O P Q R 0 6 8 9 and German umlauts have no loose counter islands',()=>{
 const plate=createPart('sign',{width:2000,height:120,radius:5});
 for(const f of STENCIL_FONTS)inspect(addStencilText(plate,{...opts,text:'AB DOPQR 0689 ÄÖÜ ß',font:f.id,height:35,tracking:3,clearance:0.5}));
});
test('horizontal, vertical and cross bridges generate actual interruptions in the cutouts',()=>{
 const original=addStencilText(base(),{...opts,text:'ARC',clearance:0.5}),before=parseDXF(original.dxf).paths.slice(1);
 const area=paths=>paths.reduce((sum,p)=>sum+Math.abs(p.points.reduce((a,v,i)=>{const q=p.points[(i+1)%p.points.length];return a+v[0]*q[1]-q[0]*v[1];},0)/2),0);
 for(const bridges of ['horizontal','vertical','cross']) {
  const result=addStencilText(base(),{...opts,text:'ARC',bridges,clearance:0.5}),d=inspect(result);
  assert.ok(area(d.paths.slice(1))<area(before));
 }
});
test('multiline text, tracking and positive/negative offsets change geometry predictably',()=>{
 const plate=createPart('sign',{width:300,height:180,radius:5});
 const p=addStencilText(plate,{...opts,text:'ARC\n123',x:15,y:-10});const d=inspect(p);
 const points=d.paths.slice(1).flatMap(p=>p.points),minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
 assert.ok(Math.abs((minX+maxX)/2-165)<0.001);assert.ok(Math.abs((minY+maxY)/2-80)<0.001);
 assert.ok(p.textInfo.height>opts.height*2);
 const a=addStencilText(plate,{...opts,text:'ARC',tracking:1}),b=addStencilText(plate,{...opts,text:'ARC',tracking:4});
 assert.ok(Math.abs(b.textInfo.width-a.textInfo.width-6)<0.001);
});
test('text cannot cross the outer edge, mounting holes or a central opening',()=>{
 assert.throws(()=>addStencilText(base(),{...opts,x:100}),/Außenrand/);
 const flange=createPart('flange',{diameter:200,bore:60,boltCircle:140,hole:10,count:4,phase:0});
 assert.throws(()=>addStencilText(flange,{...opts,text:'ARC',height:25}),/Loch/);
 const plate=createPart('plate',{width:260,height:85,radius:5,hole:10,edgeX:20,edgeY:20,bore:0});
 assert.throws(()=>addStencilText(plate,{...opts,text:'O',x:110,y:22.5,height:20}),/Loch|Außenrand/);
});
test('empty, unsupported, overlong or ill-conditioned input blocks text generation',()=>{
 for(const change of [{text:''},{text:'😀'},{text:'A'.repeat(61)},{text:'A\nB\nC\nD'},{font:'unknown'},{height:NaN},{height:7},{clearance:0},{bridges:'unknown'}])assert.throws(()=>addStencilText(base(),{...opts,...change}));
 assert.throws(()=>addStencilText(base(),{...opts,text:'I',bridges:'vertical',bridgeWidth:20}),/entfernt/);
 assert.throws(()=>addStencilText(base(),{...opts,text:'AB08',clearance:8}),/Abstand|Stege/);
});
test('automatic fitting returns a checked half-millimeter height and does not silently move text',()=>{
 const height=fitStencilText(base(),opts);assert.ok(height>=opts.height);assert.equal(height*2,Math.round(height*2));inspect(addStencilText(base(),{...opts,height}));
 assert.throws(()=>fitStencilText(base(),{...opts,x:1000}),/passt/);
});
test('disabled text leaves the native part unchanged and a narrow font component blocks kerf export',()=>{
 const part=base();assert.equal(addStencilText(part,{enabled:false}),part);
 const p=addStencilText(part,{...opts,text:'.',height:8,clearance:0.1});const d=parseDXF(p.dxf);
 assert.throws(()=>generateGCode(d,{feed:1000,delay:.5,on:'M8',off:'M9',kerf:10,overlap:0,cutSides:inferCutSides(d).map(s=>s.side)}),/Schnittfuge/);
});

test('additional bridges explicitly report tiny uncut details and remain exportable at the default kerf',()=>{
 const p=addStencilText(base(),{...opts,bridges:'horizontal'});assert.ok(p.textInfo.simplified>0);
 const d=inspect(p);assert.doesNotThrow(()=>generateGCode(d,{feed:1000,delay:.5,on:'M8',off:'M9',kerf:1.2,overlap:0,cutSides:inferCutSides(d).map(s=>s.side)}));
 assert.equal(addStencilText(base(),opts).textInfo.simplified,0);
});

test('upright tabs align text along the body below the hole and retain connected stencil cuts',()=>{
 const p=createPart('tab',{width:40,length:100,hole:12}),position=textPlacementForPart(p);
 assert.deepEqual(position,{x:0,y:-13,angle:90});
 const settings={...opts,text:'ARC',...position},height=fitStencilText(p,settings),d=inspect(addStencilText(p,{...settings,height}));
 const vertices=d.paths.slice(2).flatMap(path=>path.points);
 assert.ok(Math.max(...vertices.map(p=>p[1]))<74);
 assert.ok(Math.min(...vertices.map(p=>p[1]))>0);
 assert.doesNotThrow(()=>generateGCode(d,{feed:1000,delay:.5,on:'M8',off:'M9',kerf:1.2,overlap:0,cutSides:inferCutSides(d).map(s=>s.side)}));
});
test('strap placement stays between the end holes and text rotation changes actual exported extents',()=>{
 const p=createPart('strap',{length:120,width:35,hole:10}),position=textPlacementForPart(p);
 assert.deepEqual(position,{x:0,y:0,angle:0});
 const settings={...opts,text:'ARC',...position},height=fitStencilText(p,settings);inspect(addStencilText(p,{...settings,height}));
 const a=addStencilText(base(),{...opts,text:'ARC'}),b=addStencilText(base(),{...opts,text:'ARC',angle:90});
 assert.ok(Math.abs(a.textInfo.width-b.textInfo.height)<0.001);assert.ok(Math.abs(a.textInfo.height-b.textInfo.width)<0.001);
 assert.throws(()=>addStencilText(base(),{...opts,angle:NaN}),/gültige/);
});
