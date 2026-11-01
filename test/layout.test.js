import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDXF,generateGCode} from '../core.js';
import {positionDrawing,positionToolpaths} from '../layout.js';
import {prepareToolpaths,toolpathLength,inferCutSides,orderToolpaths} from '../toolpaths.js';
const wrap=entities=>`0\nSECTION\n2\nENTITIES\n${entities}\n0\nENDSEC\n0\nEOF\n`;
const circle=(x,y,r)=>`0\nCIRCLE\n10\n${x}\n20\n${y}\n40\n${r}`;
const poly=points=>'0\nLWPOLYLINE\n70\n1\n'+points.map(([x,y])=>`10\n${x}\n20\n${y}`).join('\n');
const line=(a,b)=>`0\nLINE\n10\n${a[0]}\n20\n${a[1]}\n11\n${b[0]}\n21\n${b[1]}`;
const drawing=entities=>parseDXF(wrap(entities.join('\n')));
const config={feed:1000,delay:0.5,on:'M8',off:'M9',origin:false,kerf:1};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} must equal ${b}`);
const pointNear=(a,b)=>a.forEach((v,i)=>near(v,b[i]));
const sourceOrder=paths=>paths.map(p=>p.sourceIndex);
test('holes cut before a large enclosing outside contour even when DXF lists it first',()=>{
  const d=drawing([circle(0,0,30),circle(-10,0,3),circle(10,0,3)]);
  const options={...config,cutSides:['outside','inside','inside']},paths=prepareToolpaths(d,options);
  assert.deepEqual(sourceOrder(orderToolpaths(d,paths,options)),[1,2,0]);
  const rows=generateGCode(d,options).split('\n').filter(row=>row.startsWith('(Kontur'));
  assert.deepEqual(rows,['(Kontur 2 - innen)','(Kontur 3 - innen)','(Kontur 1 - aussen)']);
  assert.deepEqual(sourceOrder(orderToolpaths(d,paths,{...options,cutOrder:'file'})),[0,1,2]);
});
test('nesting dependencies take precedence over a simple inside/outside bucket sort',()=>{
  const d=drawing([circle(0,0,40),circle(0,0,20),circle(0,0,10),circle(0,0,4)]);
  const options={...config,cutSides:['outside','inside','outside','inside']};
  assert.deepEqual(sourceOrder(orderToolpaths(d,prepareToolpaths(d,options),options)),[3,2,1,0]);
});
test('separate outside parts use size priority so the largest is last',()=>{
  const d=drawing([circle(0,0,30),circle(70,0,5),line([100,0],[110,0])]);
  const options={...config,cutSides:['outside','outside','on']};
  assert.deepEqual(sourceOrder(orderToolpaths(d,prepareToolpaths(d,options),options)),[2,1,0]);
});
test('contained open cuts precede an enclosing boundary even when both are On line',()=>{
  const d=drawing([circle(0,0,20),line([-5,0],[5,0])]);
  const options={...config,cutSides:['on','on']};
  assert.deepEqual(inferCutSides(d)[1].containers,[0]);
  assert.deepEqual(sourceOrder(orderToolpaths(d,prepareToolpaths(d,options),options)),[1,0]);
});
test('ordering keeps every split loop together before the containing outside cut',()=>{
  const dumbbell=[[0,0],[4,0],[4,1.5],[8,1.5],[8,0],[12,0],[12,4],[8,4],[8,2.5],[4,2.5],[4,4],[0,4]];
  const d=drawing([circle(6,2,30),poly(dumbbell)]),options={...config,kerf:2,cutSides:['outside','inside']};
  const input=prepareToolpaths(d,options),copy=JSON.stringify(input);
  assert.deepEqual(sourceOrder(orderToolpaths(d,input,options)),[1,1,0]);
  assert.equal(JSON.stringify(input),copy);
});
test('rotation, translation and zero subtraction produce exact line coordinates',()=>{
  const d=drawing([poly([[10,20],[30,20],[30,30],[10,30]])]),copy=JSON.stringify(d);
  const p=positionDrawing(d,{angle:90,moveX:100,moveY:50,zeroX:110,zeroY:60});
  pointNear(p.paths[0].segments[0].start,[15,5]);
  pointNear(p.paths[0].segments[0].end,[15,25]);
  near(p.bounds.maxX-p.bounds.minX,10);near(p.bounds.maxY-p.bounds.minY,20);
  assert.equal(JSON.stringify(d),copy);
});
test('rotating circles does not inflate their exact bounds or change arc direction',()=>{
  const d=drawing([circle(50,60,10)]);
  for(const angle of [37,90,-90,360]) {
    const p=positionDrawing(d,{angle});
    near(p.bounds.minX,40);near(p.bounds.maxX,60);near(p.bounds.minY,50);near(p.bounds.maxY,70);
    assert.equal(p.paths[0].segments[0].sweep,Math.PI);
  }
});
test('placed G-code preserves native I/J arcs, overlap and feed in work coordinates',()=>{
  const d=drawing([circle(50,60,10)]);
  const placement={angle:90,moveX:5,moveY:-2,zeroX:40,zeroY:50};
  const code=generateGCode(d,{...config,placement,overlap:5*Math.PI});
  assert.match(code,/G0 X15 Y18\nM8/);
  assert.match(code,/G3 X15 Y-2 I0 J-10 F1000/);
  assert.match(code,/G3 X5 Y8 I0 J-10\nM9/);
  assert.ok(!/^G(?:10|28|92)\b/m.test(code),'setting drawing zero must not alter physical controller offsets or home axes');
});
test('moving a drawing does not move its chosen zero',()=>{
  const d=drawing([line([10,20],[30,20])]);
  const a=positionDrawing(d,{zeroX:5,zeroY:10});
  const b=positionDrawing(d,{moveX:20,moveY:-3,zeroX:5,zeroY:10});
  pointNear(a.paths[0].segments[0].start,[5,10]);pointNear(b.paths[0].segments[0].start,[25,7]);
});
test('world preview coordinates and work-coordinate output differ only by the selected zero',()=>{
  const d=drawing([circle(10,20,4)]),options={...config,cutSides:['outside'],overlap:2};
  const original=prepareToolpaths(d,options),placement={angle:37,moveX:14,moveY:8,zeroX:5,zeroY:7};
  const preview=positionToolpaths(d,original,{...placement,zeroX:0,zeroY:0});
  const output=positionToolpaths(d,original,placement);
  for(let i=0;i<preview[0].segments.length;i++)pointNear(output[0].segments[i].end,preview[0].segments[i].end.map((v,axis)=>v-[5,7][axis]));
  near(toolpathLength(output),toolpathLength(original));
  pointNear(output[0].overlapSegments[0].end,preview[0].overlapSegments[0].end.map((v,axis)=>v-[5,7][axis]));
});
test('invalid placement is rejected rather than producing malformed machine words',()=>{
  const d=drawing([circle(0,0,10)]);
  for(const placement of [{angle:NaN},{moveX:Infinity},{zeroY:NaN}]) {
    assert.throws(()=>positionDrawing(d,placement),/endliche/);
    assert.throws(()=>generateGCode(d,{...config,placement}),/endliche/);
  }
});
