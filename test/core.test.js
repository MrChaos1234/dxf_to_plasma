import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDXF,generateGCode} from '../core.js';
const dxf = (entities,unit=4) => `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${unit}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}\n0\nENDSEC\n0\nEOF\n`;
const line = '0\nLINE\n10\n10\n20\n20\n11\n30\n21\n20';
const config = {feed:1000,delay:0.5,on:'M3',off:'M5',origin:true};
test('parses LINE coordinates and inch conversion',()=>{
  const drawing = parseDXF(dxf(line,1));
  assert.equal(drawing.paths.length,1);
  assert.equal(drawing.bounds.minX,254);
  assert.equal(drawing.length,508);
  assert.equal(parseDXF(dxf(line,1),'mm').length,20);
});
test('closed lightweight polyline includes closing edge and bulge',()=>{
  const drawing = parseDXF(dxf('0\nLWPOLYLINE\n70\n1\n10\n0\n20\n0\n42\n1\n10\n10\n20\n0\n10\n10\n20\n10'));
  const path = drawing.paths[0];
  assert.equal(path.closed,true);
  assert.deepEqual(path.points[0],path.points.at(-1));
  assert.ok(drawing.bounds.minY < -4.99);
  assert.ok(drawing.length > 39);
});
test('circle and wraparound arc flatten with correct endpoints',()=>{
  const drawing = parseDXF(dxf('0\nCIRCLE\n10\n0\n20\n0\n40\n5\n0\nARC\n10\n0\n20\n0\n40\n5\n50\n350\n51\n10'));
  assert.equal(drawing.paths.length,2);
  assert.ok(Math.abs(drawing.length - (10*Math.PI+5*Math.PI/9)) < 0.02);
  assert.ok(drawing.paths[1].points[0][1] < 0);
  assert.ok(drawing.paths[1].points.at(-1)[1] > 0);
});
test('legacy polyline consumes vertices and preserves closure',()=>{
  const drawing = parseDXF(dxf('0\nPOLYLINE\n70\n1\n0\nVERTEX\n10\n0\n20\n0\n0\nVERTEX\n10\n10\n20\n0\n0\nVERTEX\n10\n10\n20\n10\n0\nSEQEND'));
  assert.equal(drawing.incomplete,false);
  assert.equal(drawing.paths[0].points.length,4);
});
test('XY-only g-code pierces before cutting and turns plasma off before travel',()=>{
  const secondLine='0\nLINE\n10\n40\n20\n20\n11\n60\n21\n20';
  const code = generateGCode(parseDXF(dxf(line+'\n'+secondLine)),{...config,on:'M62 P0',off:'M63 P0'});
  assert.match(code,/G21\nG90\nG17\nG94\nM63 P0/);
  assert.match(code,/G0 X0 Y0\nM62 P0\nG4 P0.5\nG1 X20 Y0 F1000\nM63 P0\n\(Kontur 2\)\nG0 X30 Y0/);
  assert.ok(!/\b[ZC][-\d.]/.test(code),'height and rotary axes must never be commanded');
  assert.equal(code.match(/M62 P0/g).length,2);
  assert.ok(code.endsWith('M63 P0\nM2\n'));
  const original = generateGCode(parseDXF(dxf(line)),{...config,origin:false});
  assert.match(original,/G0 X10 Y20/);
});
test('rejects invalid parameters and injected commands',()=>{
  const drawing = parseDXF(dxf(line));
  for (const change of [{feed:0},{feed:NaN},{delay:-1},{delay:Infinity},{on:'M3\nG0 X100'},{on:'M5'}]) assert.throws(()=>generateGCode(drawing,{...config,...change}));
});
test('unsupported entities prevent partial export',()=>{
  const drawing = parseDXF(dxf(line+'\n0\nINSERT\n2\nBLOCK'));
  assert.equal(drawing.incomplete,true);
  assert.match(drawing.warnings[0],/INSERT/);
  assert.throws(()=>generateGCode(drawing,config),/nicht unterstützte/);
});
test('rejects malformed, binary, nonplanar and empty drawings',()=>{
  for (const text of ['garbage','AutoCAD Binary DXF',dxf(''),dxf(line+'\n30\n2'),dxf(line+'\n230\n-1'),dxf('0\nCIRCLE\n10\n0\n20\n0\n40\n-2')]) assert.throws(()=>parseDXF(text));
});
test('missing units warn and unknown units require override',()=>{
  assert.match(parseDXF(dxf(line,0)).warnings[0],/Millimeter angenommen/);
  assert.throws(()=>parseDXF(dxf(line,99)),/Einheiten/);
  assert.equal(parseDXF(dxf(line,99),'mm').length,20);
});
test('recognizes Windows, classic Mac and BOM-prefixed DXF text',()=>{
  const source = dxf(line);
  for (const text of [source.replace(/\n/g,'\r\n'),source.replace(/\n/g,'\r'),'\uFEFF'+source,source+'\x1a']) {
    assert.equal(parseDXF(text).length,20);
  }
});
test('explains unsupported entity types even when no geometry can load',()=>{
  assert.throws(()=>parseDXF(dxf('0\nINSERT\n2\nplate')),/Gefunden: INSERT \(1\)/);
});
test('reference POINT markers do not block export or affect cut geometry',()=>{
  const marker = '\n0\nPOINT\n10\n9999\n20\n-9999\n30\n42';
  const baseline = parseDXF(dxf(line));
  const drawing = parseDXF(dxf(line+marker));
  assert.equal(drawing.incomplete,false);
  assert.deepEqual(drawing.paths,baseline.paths);
  assert.deepEqual(drawing.bounds,baseline.bounds);
  assert.equal(drawing.length,baseline.length);
  assert.match(drawing.warnings[0],/Ignorierte POINT-Markierungen: 1/);
  assert.equal(generateGCode(drawing,config),generateGCode(baseline,config));
  assert.match(parseDXF(dxf(line+marker+marker)).warnings[0],/Ignorierte POINT-Markierungen: 2/);
});
test('ignoring POINT does not enable partial export or empty cuts',()=>{
  const marker = '\n0\nPOINT\n10\n0\n20\n0';
  const drawing = parseDXF(dxf(line+marker+'\n0\nINSERT\n2\nplate'));
  assert.equal(drawing.incomplete,true);
  assert.throws(()=>generateGCode(drawing,config),/nicht unterstützte/);
  assert.throws(()=>parseDXF(dxf(marker.trim())),/Keine unterstützte Geometrie/);
});
test('a full circle exports as exactly two semicircular G3 moves',()=>{
  const drawing = parseDXF(dxf('0\nCIRCLE\n10\n50\n20\n60\n40\n10'));
  const code = generateGCode(drawing,config);
  assert.deepEqual(code.split('\n').filter(l=>/^G[23] /.test(l)),['G3 X0 Y10 I-10 J0 F1000','G3 X20 Y10 I10 J0']);
  assert.match(code,/G91\.1/);
  assert.equal(code.split('\n').filter(l=>/^G1 X/.test(l)).length,0);
  assert.ok(code.trim().split('\n').length<25);
  assert.ok(Math.abs(drawing.length-20*Math.PI)<1e-10);
  assert.deepEqual(drawing.paths[0].segments.at(-1).end,drawing.paths[0].segments[0].start);
});
test('arc offsets stay relative to arc starts when coordinates are translated',()=>{
  const drawing = parseDXF(dxf('0\nARC\n10\n50\n20\n60\n40\n10\n50\n0\n51\n90'));
  const shifted = generateGCode(drawing,config).split('\n').find(l=>l.startsWith('G3 '));
  const original = generateGCode(drawing,{...config,origin:false}).split('\n').find(l=>l.startsWith('G3 '));
  assert.equal(shifted,'G3 X0 Y10 I-10 J0 F1000');
  assert.equal(original,'G3 X50 Y70 I-10 J0 F1000');
});
test('inch arcs scale center offsets and endpoints as well as radius',()=>{
  const drawing = parseDXF(dxf('0\nARC\n10\n0\n20\n0\n40\n1\n50\n0\n51\n90',1));
  const code = generateGCode(drawing,{...config,origin:false});
  assert.match(code,/G0 X25\.4 Y0/);
  assert.match(code,/G3 X0 Y25\.4 I-25\.4 J0/);
});
test('polyline bulges retain clockwise and counterclockwise arc directions',()=>{
  for (const [bulge,command] of [[1,'G3'],[-1,'G2']]) {
    const drawing = parseDXF(dxf(`0\nLWPOLYLINE\n70\n0\n10\n0\n20\n0\n42\n${bulge}\n10\n10\n20\n0`));
    const code = generateGCode(drawing,{...config,origin:false});
    assert.ok(code.includes(`${command} X10 Y0 I5 J0`));
    assert.ok(Math.abs(drawing.length-5*Math.PI)<1e-10);
  }
});
test('major arcs split into consistent center-relative moves no larger than 180 degrees',()=>{
  for (const bulge of [2,-2]) {
    const drawing = parseDXF(dxf(`0\nLWPOLYLINE\n70\n0\n10\n0\n20\n0\n42\n${bulge}\n10\n10\n20\n0`));
    const segments = drawing.paths[0].segments;
    assert.equal(segments.length,2);
    assert.ok(segments.every(s=>Math.abs(s.sweep)<=Math.PI));
    assert.deepEqual(segments[0].end,segments[1].start);
    assert.deepEqual(segments.at(-1).end,[10,0]);
    // Validate emitted rounded I/J against both the current point and endpoint.
    const code = generateGCode(drawing,{...config,origin:false});
    let current = [0,0];
    for (const row of code.split('\n').filter(l=>/^G[23] /.test(l))) {
      const words = Object.fromEntries([...row.matchAll(/([XYIJ])(-?[\d.]+)/g)].map(m=>[m[1],Number(m[2])]));
      const center = [current[0]+words.I,current[1]+words.J];
      assert.ok(Math.abs(Math.hypot(words.I,words.J)-Math.hypot(words.X-center[0],words.Y-center[1]))<0.000003);
      assert.ok(row.startsWith(bulge>0?'G3 ':'G2 '));
      current = [words.X,words.Y];
    }
  }
});
test('arc bounds include exact cardinal extrema between preview samples',()=>{
  const drawing = parseDXF(dxf('0\nARC\n10\n0\n20\n0\n40\n5\n50\n13\n51\n167'));
  assert.equal(drawing.bounds.maxY,5);
  assert.ok(Math.abs(drawing.length-5*154*Math.PI/180)<1e-10);
});
test('legacy polyline bulges produce arcs and line-only drawings need no arc mode',()=>{
  const drawing = parseDXF(dxf('0\nPOLYLINE\n70\n0\n0\nVERTEX\n10\n0\n20\n0\n42\n-1\n0\nVERTEX\n10\n10\n20\n0\n0\nSEQEND'));
  assert.match(generateGCode(drawing,{...config,origin:false}),/G2 X10 Y0 I5 J0/);
  const code = generateGCode(parseDXF(dxf(line)),config);
  assert.ok(!code.includes('G91.1'));
  assert.equal(code.split('\n').filter(l=>l.includes(' F')).length,1);
});
