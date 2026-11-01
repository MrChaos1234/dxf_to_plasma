import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDXF,generateGCode} from '../core.js';
import {inferCutSides,prepareToolpaths} from '../toolpaths.js';
const wrap=entities=>`0\nSECTION\n2\nENTITIES\n${entities}\n0\nENDSEC\n0\nEOF\n`;
const circle=(x,y,r)=>`0\nCIRCLE\n10\n${x}\n20\n${y}\n40\n${r}`;
const poly=points=>'0\nLWPOLYLINE\n70\n1\n'+points.map(([x,y])=>`10\n${x}\n20\n${y}`).join('\n');
const line=(a,b)=>`0\nLINE\n10\n${a[0]}\n20\n${a[1]}\n11\n${b[0]}\n21\n${b[1]}`;
const drawing=entities=>parseDXF(wrap(entities.join('\n')));
const sides=d=>inferCutSides(d).map(result=>result.side);
const config={feed:1000,delay:0.5,on:'M8',off:'M9',origin:true,kerf:1};
test('sample holes are inside and the plate boundary is outside',()=>{
  const d=parseDXF(readFileSync(new URL('../sample.dxf',import.meta.url),'utf8'));
  assert.deepEqual(sides(d),['inside','inside','inside','inside','outside']);
  assert.match(inferCutSides(d)[0].reason,/hole/);
});
test('nested holes and material islands use nesting depth regardless of file order',()=>{
  const d=drawing([circle(0,0,5),circle(0,0,20),circle(0,0,10),circle(0,0,2)]);
  assert.deepEqual(sides(d),['outside','outside','inside','inside']);
});
test('winding does not change a boundary role and disjoint parts are outside',()=>{
  const outer=[[0,0],[30,0],[30,30],[0,30]],inner=[[5,5],[15,5],[15,15],[5,15]];
  for(const reverse of [false,true]) {
    const d=drawing([poly(reverse?outer.slice().reverse():outer),poly(reverse?inner.slice().reverse():inner),circle(50,15,5)]);
    assert.deepEqual(sides(d),['outside','inside','outside']);
  }
});
test('actual concave containment is used instead of bounding boxes',()=>{
  const d=drawing([poly([[0,0],[20,0],[20,5],[5,5],[5,20],[0,20]]),circle(12,12,2),circle(2.5,10,1)]);
  assert.deepEqual(sides(d),['outside','outside','inside']);
});
test('crossing, touching, duplicate and near-coincident boundaries remain unassigned',()=>{
  for(const offset of [0,6,10,10.01]) {
    const d=drawing([circle(0,0,5),circle(offset,0,5)]);
    assert.deepEqual(sides(d),[null,null],`circles at spacing ${offset} should need review`);
    assert.match(inferCutSides(d)[0].reason,/touch|cross|boundary/);
  }
  assert.deepEqual(sides(drawing([circle(0,0,5),circle(10.2,0,5)])),['outside','outside']);
});
test('an ambiguous enclosing contour also leaves its descendants unassigned',()=>{
  const d=drawing([circle(0,0,10),circle(5,0,5),circle(5,0,1)]);
  assert.deepEqual(sides(d),[null,null,null]);
  assert.match(inferCutSides(d)[2].reason,/enclosing/);
});
test('open paths require a manual choice, without invalidating unrelated closed geometry',()=>{
  const d=drawing([circle(0,0,10),line([-2,0],[2,0]),line([30,0],[40,0])]);
  assert.deepEqual(sides(d),['outside',null,null]);
  assert.match(inferCutSides(d)[1].reason,/Open contour/);
});
test('an open stroke crossing a closed boundary makes the relationship uncertain',()=>{
  const d=drawing([poly([[0,0],[10,0],[10,10],[0,10]]),circle(2,2,1),line([-1,5],[11,5])]);
  assert.deepEqual(sides(d),[null,null,null]);
});
test('invalid and unsupported geometry is not used to guess material boundaries',()=>{
  const crossed=drawing([poly([[0,0],[10,10],[0,10],[10,0]]),circle(5,5,1)]);
  assert.deepEqual(sides(crossed),[null,null]);
  const incomplete=drawing([circle(0,0,10),'0\nINSERT\n2\nunknown']);
  assert.deepEqual(sides(incomplete),[null]);
  assert.match(inferCutSides(incomplete)[0].reason,/Unsupported/);
});
test('unassigned contours can be previewed but never silently omitted from export',()=>{
  const d=drawing([circle(0,0,10),line([30,0],[40,0])]),cutSides=sides(d);
  const options={...config,cutSides};
  assert.throws(()=>prepareToolpaths(d,options),/Contour 2: choose/);
  const preview=prepareToolpaths(d,options,{allowUnassigned:true});
  assert.equal(preview.length,1);assert.equal(preview[0].sourceIndex,0);
  assert.throws(()=>generateGCode(d,options,preview),/Contour 2: choose/);
  assert.ok(generateGCode(d,{...config,cutSides:['outside','on']}).includes('Contour 2'));
});
test('analysis does not mutate geometry and oversized drawings fall back to manual review',()=>{
  const d=drawing([circle(0,0,10),circle(0,0,5)]),original=JSON.stringify(d);
  inferCutSides(d);assert.equal(JSON.stringify(d),original);
  const large={...d,paths:Array(501).fill(d.paths[0])};
  assert.ok(inferCutSides(large).every(result=>result.side===null));
});
