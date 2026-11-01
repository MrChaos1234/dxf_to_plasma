import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDXF,generateGCode} from '../core.js';
import {prepareToolpaths,toolpathLength} from '../toolpaths.js';
const wrap=entities=>`0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}\n0\nENDSEC\n0\nEOF\n`;
const poly=points=>'0\nLWPOLYLINE\n70\n1\n'+points.map(([x,y])=>`10\n${x}\n20\n${y}`).join('\n');
const line=(a,b)=>`0\nLINE\n10\n${a[0]}\n20\n${a[1]}\n11\n${b[0]}\n21\n${b[1]}`;
const rectangle=[[0,0],[20,0],[20,10],[0,10]];
const config={feed:1000,delay:0.5,on:'M8',off:'M9',origin:true,kerf:2};
const bounds=path=>path.points.reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
const near=(actual,expected,tolerance=0.011)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} should be near ${expected}`);
const apply=(drawing,...sides)=>prepareToolpaths(drawing,{...config,cutSides:sides});

test('per-contour choices offset by half the kerf without changing source geometry',()=>{
  const d=parseDXF(wrap(poly(rectangle))),before=JSON.stringify(d);
  assert.deepEqual(bounds(apply(d,'on')[0]),[0,0,20,10]);
  assert.deepEqual(bounds(apply(d,'inside')[0]),[1,1,19,9]);
  const out=apply(d,'outside')[0];
  bounds(out).forEach((v,i)=>near(v,[-1,-1,21,11][i]));
  assert.equal(JSON.stringify(d),before);
  assert.ok(out.segments.length<=10,'rounded outside rectangle should retain compact arcs');
  assert.equal(out.segments.filter(s=>s.type==='arc').length,4);
});
test('inside and outside mean the same for either contour winding',()=>{
  for(const points of [rectangle,rectangle.slice().reverse()]) {
    const d=parseDXF(wrap(poly(points)));
    assert.deepEqual(bounds(apply(d,'inside')[0]),[1,1,19,9]);
    bounds(apply(d,'outside')[0]).forEach((v,i)=>near(v,[-1,-1,21,11][i]));
  }
});
test('nested circles have independent choices and remain two exact arcs each',()=>{
  const d=parseDXF(wrap('0\nCIRCLE\n10\n50\n20\n60\n40\n10\n0\nCIRCLE\n10\n50\n20\n60\n40\n4'));
  const paths=apply(d,'outside','inside');
  assert.equal(paths.length,2);
  for(const [i,radius] of [[0,11],[1,3]]) {
    assert.equal(paths[i].segments.length,2);
    for(const s of paths[i].segments)near(Math.hypot(s.start[0]-s.center[0],s.start[1]-s.center[1]),radius,1e-10);
  }
  const code=generateGCode(d,{...config,cutSides:['outside','inside']});
  assert.equal(code.split('\n').filter(l=>/^G[23] /.test(l)).length,4);
  assert.match(code,/G40/);assert.ok(!code.includes('G41'));assert.ok(!code.includes('G42'));
  assert.match(code,/G3 X-1 Y10 I-11 J0/);
  assert.match(code,/\(Kontur 1 - aussen\)/);assert.match(code,/\(Kontur 2 - innen\)/);
});
test('concave L contour offsets the inner corner and preserves long edges',()=>{
  const d=parseDXF(wrap(poly([[0,0],[10,0],[10,4],[6,4],[6,10],[0,10]])));
  const p=apply(d,'inside')[0];
  assert.deepEqual(bounds(p),[1,1,9,9]);
  assert.ok(p.segments.some(s=>s.type==='line'&&Math.hypot(s.end[0]-s.start[0],s.end[1]-s.start[1])>5));
  assert.ok(p.segments.some(s=>s.type==='arc'));
});
test('narrow-neck erosion preserves every resulting loop',()=>{
  const d=parseDXF(wrap(poly([[0,0],[4,0],[4,1.5],[8,1.5],[8,0],[12,0],[12,4],[8,4],[8,2.5],[4,2.5],[4,4],[0,4]])));
  const paths=apply(d,'inside');
  assert.equal(paths.length,2);
  assert.ok(paths.every(p=>p.closed&&p.sourceIndex===0&&p.cutSide==='inside'));
  const code=generateGCode(d,{...config,cutSides:['inside']});
  assert.equal(code.split('\n').filter(l=>l==='M8').length,2);
});
test('inward collapse, invalid kerf and self intersections block output',()=>{
  const d=parseDXF(wrap(poly(rectangle)));
  for(const kerf of [0,-1,NaN,Infinity,1001])assert.throws(()=>prepareToolpaths(d,{kerf,cutSides:['inside']}),/Schnittfugenbreite/i);
  assert.throws(()=>prepareToolpaths(d,{kerf:30,cutSides:['inside']}),/fällt vollständig weg/);
  const circle=parseDXF(wrap('0\nCIRCLE\n10\n0\n20\n0\n40\n1'));
  assert.throws(()=>apply(circle,'inside'),/fällt vollständig weg/);
  const crossed=parseDXF(wrap(poly([[0,0],[10,10],[0,10],[10,0]])));
  assert.throws(()=>apply(crossed,'outside'),/Fläche|schneidet/);
  const unequalCross=parseDXF(wrap(poly([[0,0],[15,10],[0,10],[10,0]])));
  assert.throws(()=>apply(unequalCross,'inside'),/schneidet/);
});
test('open paths only permit on-line output',()=>{
  const d=parseDXF(wrap(line([0,0],[10,0])));
  assert.equal(apply(d,'on').length,1);
  for(const side of ['inside','outside'])assert.throws(()=>apply(d,side),/geschlossene Kontur/);
  assert.throws(()=>apply(d,'unknown'),/Unbekannte Schnittseite/);
});
test('separate unordered and reversed DXF lines become a single closed contour',()=>{
  const entities=[line([20,0],[0,0]),line([0,10],[20,10]),line([0,0],[0,10]),line([20,10],[20,0])];
  const d=parseDXF(wrap(entities.join('\n')));
  assert.equal(d.paths.length,1);assert.equal(d.paths[0].closed,true);
  assert.equal(d.paths[0].segments.length,4);
  assert.deepEqual(bounds(apply(d,'inside')[0]),[1,1,19,9]);
  const code=generateGCode(d,{...config,cutSides:['outside']});
  assert.equal(code.split('\n').filter(l=>l==='M8').length,1);
});
test('joining does not invent connections at T branches, gaps, or across layers',()=>{
  const branch=parseDXF(wrap([line([0,0],[10,0]),line([10,0],[20,0]),line([10,0],[10,10])].join('\n')));
  assert.equal(branch.paths.length,3);assert.ok(branch.paths.every(p=>!p.closed));
  const gap=parseDXF(wrap([line([0,0],[10,0]),line([10.01,0],[20,0])].join('\n')));
  assert.equal(gap.paths.length,2);
  const layers=parseDXF(wrap(line([0,0],[10,0])+'\n8\nA\n'+line([10,0],[20,0])+'\n8\nB'));
  assert.equal(layers.paths.length,2);
});
test('joined reversed arcs retain their true sweep and closed-circle compensation',()=>{
  const d=parseDXF(wrap('0\nARC\n10\n0\n20\n0\n40\n10\n50\n0\n51\n180\n0\nARC\n10\n0\n20\n0\n40\n10\n50\n180\n51\n360'));
  assert.equal(d.paths.length,1);assert.equal(d.paths[0].closed,true);
  const paths=apply(d,'outside');
  near(toolpathLength(paths),22*Math.PI,1e-8);
  assert.equal(paths[0].segments.length,2);
});
test('mixed on/inside/outside assignments preserve order and unaffected contours',()=>{
  const shifted=rectangle.map(([x,y])=>[x+40,y]);
  const d=parseDXF(wrap([poly(rectangle),poly(shifted),'0\nCIRCLE\n10\n100\n20\n10\n40\n5'].join('\n')));
  const paths=apply(d,'on','inside','outside');
  assert.deepEqual(paths.map(p=>p.cutSide),['on','inside','outside']);
  assert.deepEqual(paths[0].segments,d.paths[0].segments);
  assert.deepEqual(bounds(paths[1]),[41,1,59,9]);
  near(paths[2].segments[0].start[0],106);
});
test('complex concave offsets stay a half kerf from the reference edges',()=>{
  // A stepped pocket and a concave star exercise both convex and reentrant joins.
  const shapes=[[[0,0],[30,0],[30,8],[22,8],[22,17],[30,17],[30,25],[0,25],[0,17],[8,17],[8,8],[0,8]],Array.from({length:12},(_,i)=>{const angle=i*Math.PI/6,r=i%2?12:25;return [35+r*Math.cos(angle),35+r*Math.sin(angle)];})];
  const distanceToEdge=(p,a,b)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
  };
  for(const shape of shapes)for(const side of ['inside','outside']) {
    const d=parseDXF(wrap(poly(shape)));
    for(const path of apply(d,side))for(const point of path.points) {
      const nearest=Math.min(...shape.map((a,i)=>distanceToEdge(point,a,shape[(i+1)%shape.length])));
      near(nearest,1,0.011);
    }
  }
});
test('a reversed polyline arc keeps its clockwise direction when joined to a line',()=>{
  const d=parseDXF(wrap(line([0,0],[10,0])+'\n0\nLWPOLYLINE\n70\n0\n10\n0\n20\n0\n42\n1\n10\n10\n20\n0'));
  assert.equal(d.paths.length,1);assert.equal(d.paths[0].closed,true);
  assert.equal(d.paths[0].segments[1].sweep,-Math.PI);
  assert.match(generateGCode(d,{...config,origin:false}),/G2 X0 Y0 I-5 J0/);
  assert.ok(apply(d,'outside')[0].segments.some(s=>s.type==='arc'&&s.sweep<0));
});
test('closed-contour overlap follows edges for exactly the requested distance',()=>{
  const d=parseDXF(wrap(poly(rectangle)));
  const paths=prepareToolpaths(d,{...config,overlap:25});
  assert.equal(paths[0].overlapSegments.length,2);
  assert.deepEqual(paths[0].overlapSegments[0].end,[20,0]);
  assert.deepEqual(paths[0].overlapSegments[1].end,[20,5]);
  near(toolpathLength(paths),85,1e-10);
  assert.deepEqual(d.paths[0].segments.at(-1).end,[0,0],'source geometry stays closed and unchanged');
  const code=generateGCode(d,{...config,overlap:25});
  assert.match(code,/\(Ueberlappung 25 mm\)\nG1 X20 Y0\nG1 X20 Y5\nM9/);
  assert.equal(code.split('\n').filter(row=>row==='M8').length,1,'overlap must not pierce again');
  assert.ok(!/\bZ[-\d.]/.test(code));
});
test('circular overlap uses native arcs on the compensated radius',()=>{
  const d=parseDXF(wrap('0\nCIRCLE\n10\n0\n20\n0\n40\n10'));
  const options={...config,origin:false,cutSides:['inside'],overlap:9*Math.PI/2};
  const paths=prepareToolpaths(d,options),extra=paths[0].overlapSegments;
  assert.equal(extra.length,1);assert.equal(extra[0].type,'arc');
  near(extra[0].sweep,Math.PI/2,1e-10);near(extra[0].end[0],0,1e-10);near(extra[0].end[1],9,1e-10);
  near(toolpathLength(paths),9*Math.PI*2.5,1e-10);
  const code=generateGCode(d,options);
  assert.equal(code.split('\n').filter(row=>/^G3 /.test(row)).length,3);
  assert.match(code,/G3 X0 Y9 I-9 J0\nM9/);
});
test('clockwise overlap retains direction and correct center offsets',()=>{
  const d=parseDXF(wrap('0\nLWPOLYLINE\n70\n1\n10\n10\n20\n0\n42\n-1\n10\n-10\n20\n0\n42\n-1'));
  const code=generateGCode(d,{...config,origin:false,overlap:5*Math.PI});
  assert.match(code,/G2 X0 Y-10 I-10 J0\nM9/);
  assert.equal(code.split('\n').filter(row=>/^G2 /.test(row)).length,3);
});
test('overlap only affects closed contours and validates against the actual toolpath',()=>{
  const d=parseDXF(wrap(line([0,0],[10,0])));
  const zero=generateGCode(d,config);
  assert.equal(generateGCode(d,{...config,overlap:100}),zero);
  const closed=parseDXF(wrap(poly(rectangle)));
  assert.equal(generateGCode(closed,{...config,overlap:0}),generateGCode(closed,config));
  for(const overlap of [-1,NaN,Infinity])assert.throws(()=>prepareToolpaths(closed,{...config,overlap}),/Überlappung/);
  for(const overlap of [60,61])assert.throws(()=>prepareToolpaths(closed,{...config,overlap}),/kürzer als/);
  const circle=parseDXF(wrap('0\nCIRCLE\n10\n0\n20\n0\n40\n2'));
  assert.throws(()=>prepareToolpaths(circle,{...config,cutSides:['inside'],overlap:7}),/Kontur 1: Die Überlappung muss kürzer/);
});
test('each loop from a split offset receives its own overlap',()=>{
  const d=parseDXF(wrap(poly([[0,0],[4,0],[4,1.5],[8,1.5],[8,0],[12,0],[12,4],[8,4],[8,2.5],[4,2.5],[4,4],[0,4]])));
  const options={...config,cutSides:['inside'],overlap:0.5};
  const paths=prepareToolpaths(d,options);
  assert.equal(paths.length,2);assert.ok(paths.every(p=>p.overlapLength===0.5));
  const base=prepareToolpaths(d,{...options,overlap:0});
  near(toolpathLength(paths)-toolpathLength(base),1,1e-9);
  assert.equal(generateGCode(d,options).split('(Ueberlappung 0.5 mm)').length-1,2);
});
