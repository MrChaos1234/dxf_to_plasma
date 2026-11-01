import test from 'node:test';
import assert from 'node:assert/strict';
import {PART_TEMPLATES,createPart} from '../quick/shapes.js';
import {parseDXF,generateGCode} from '../core.js';
import {inferCutSides,prepareToolpaths,toolpathLength} from '../toolpaths.js';
const options={feed:1000,delay:0.5,on:'M8',off:'M9',kerf:1.2,overlap:1,origin:true,cutOrder:'inside-first'};
const make=(type,changes={})=>createPart(type,{...PART_TEMPLATES.find(t=>t.id===type).defaults,...changes});
const drawing=(type,changes)=>parseDXF(make(type,changes).dxf);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('each template generates closed millimeter contours with correct inside/outside roles and cut order',()=>{
  for(const template of PART_TEMPLATES) {
    const part=createPart(template.id,template.defaults),d=parseDXF(part.dxf),sides=inferCutSides(d).map(c=>c.side);
    assert.equal(d.incomplete,false);assert.deepEqual(d.warnings,[]);assert.ok(d.paths.every(p=>p.closed));
    assert.equal(sides[0],'outside');assert.ok(sides.slice(1).every(s=>s==='inside'));
    const code=generateGCode(d,{...options,cutSides:sides});
    assert.match(code,/G21/);assert.ok(!/^G[0123].*\bZ/m.test(code));
    const cuts=code.split('\n').filter(l=>l.startsWith('(Kontur'));
    assert.match(cuts.at(-1),/Kontur 1 - aussen/);
    assert.match(code,/M8\nG4 P0.5/);assert.match(code,/M9\nM2\n$/);
  }
});
test('finished rectangle dimensions and corner radii preserve native arcs',()=>{
  const d=drawing('rectangle',{width:110,height:70,radius:10});
  assert.deepEqual(d.bounds,{minX:0,minY:0,maxX:110,maxY:70});
  assert.equal(d.paths[0].segments.filter(s=>s.type==='arc').length,4);
  near(d.length,2*(110+70)-80+2*Math.PI*10);
  const square=drawing('rectangle',{width:50,height:50,radius:25});
  near(square.length,Math.PI*50);
});
test('circle can be a solid disc or ring and retains compact compensated arcs',()=>{
  assert.equal(drawing('circle').paths.length,1);
  const d=drawing('circle',{diameter:100,bore:40});assert.equal(d.paths.length,2);
  const sides=inferCutSides(d).map(c=>c.side),paths=prepareToolpaths(d,{...options,cutSides:sides,overlap:0});
  near(toolpathLength(paths),Math.PI*(101.2+38.8));
  const code=generateGCode(d,{...options,cutSides:sides,overlap:0});assert.equal(code.split('\n').filter(l=>/^G[23] /.test(l)).length,4);
});
test('tab and two-ended strap have exact extents, semicircles and optional holes',()=>{
  const tab=drawing('tab');assert.deepEqual(tab.bounds,{minX:0,minY:0,maxX:40,maxY:100});assert.equal(tab.paths.length,2);
  const hole=tab.paths[1].segments[0];assert.deepEqual(hole.center,[20,80]);
  assert.equal(drawing('tab',{hole:0}).paths.length,1);
  const strap=drawing('strap');assert.deepEqual(strap.bounds,{minX:0,minY:0,maxX:120,maxY:35});assert.equal(strap.paths.length,3);
  assert.equal(drawing('strap',{length:35,width:35,hole:0}).paths.length,1);
});
test('bolt-circle positions respect count, radius and counterclockwise phase',()=>{
  const d=drawing('flange',{diameter:200,bore:50,boltCircle:130,hole:10,count:8,phase:90});
  assert.equal(d.paths.length,10);
  const centers=d.paths.slice(2).map(p=>p.segments[0].center);
  near(centers[0][0],100);near(centers[0][1],165);
  for(const [x,y] of centers)near(Math.hypot(x-100,y-100),65);
  assert.ok(centers[1][0]<100);
});
test('rectangular flange uses distances from edge to hole centers',()=>{
  const d=drawing('plate',{width:140,height:100,edgeX:15,edgeY:20,bore:0});
  assert.equal(d.paths.length,5);
  assert.deepEqual(d.paths.slice(1).map(p=>p.segments[0].center),[[15,20],[15,80],[125,20],[125,80]]);
});
test('invalid dimensions, radii and fractional/excessive hole counts are rejected',()=>{
  for(const change of [{width:0},{height:NaN},{width:Infinity},{width:'120'},{radius:41},{width:10001}])assert.throws(()=>make('rectangle',change));
  for(const count of [0,1,3.5,33])assert.throws(()=>make('flange',{count}),/Lochanzahl/);
  assert.throws(()=>createPart('unknown',{}),/Unbekannte/);assert.throws(()=>createPart('circle',null),/Ungültige/);
  assert.throws(()=>make('tab',{length:39}),/mindestens so lang/);assert.throws(()=>make('strap',{length:35}),/getrennte/);
});
test('holes cannot touch/overlap each other, the outer boundary or rounded corners',()=>{
  for(const change of [{bore:100},{bore:101}])assert.throws(()=>make('circle',change));
  assert.throws(()=>make('tab',{hole:40}));assert.throws(()=>make('strap',{length:40,hole:10}),/Löcher überlappen/);
  assert.throws(()=>make('flange',{boltCircle:155}),/Außenrand/);
  assert.throws(()=>make('flange',{bore:110}),/Löcher überlappen/);
  assert.throws(()=>make('flange',{count:32,hole:12}),/Löcher überlappen/);
  assert.throws(()=>make('plate',{edgeX:4}),/Außenkontur/);
  assert.throws(()=>make('plate',{radius:40,edgeX:8,edgeY:8,hole:10}),/Außenkontur/);
  assert.throws(()=>make('plate',{edgeX:70}),/Löcher überlappen/);
  assert.throws(()=>make('plate',{bore:130}),/Außenkontur|Löcher überlappen/);
});
test('a valid geometric hole that is smaller than the kerf still blocks machine export',()=>{
  const d=drawing('circle',{bore:1});
  assert.throws(()=>generateGCode(d,{...options,cutSides:['outside','inside']}),/Schnittfuge/);
});
test('part generation does not mutate or fill in operator parameter objects',()=>{
  const input={...PART_TEMPLATES[0].defaults},before=JSON.stringify(input);createPart('rectangle',input);assert.equal(JSON.stringify(input),before);
  assert.throws(()=>createPart('rectangle',{width:120,height:80}),/gültige Zahl/);
});
