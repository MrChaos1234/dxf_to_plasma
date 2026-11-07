import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDXF,generateGCode} from '../core.js';
import {inferCutSides,prepareToolpaths} from '../toolpaths.js';
const wrap=(body,unit=4)=>`0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${unit}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${body}\n0\nENDSEC\n0\nEOF\n`;
function entity(p,u,degree=3,{flags=0,weights=[],z=[],extra=[]}={}) {
 return ['0','SPLINE','70',flags,'71',degree,'72',u.length,'73',p.length,...u.flatMap(k=>['40',k]),...weights.flatMap(w=>['41',w]),...p.flatMap(([x,y],i)=>['10',x,'20',y,'30',z[i]||0]),...extra].join('\n');
}
const clamped=[0,0,0,0,1,1,1,1],cfg={feed:1000,delay:0.5,on:'M8',off:'M9',origin:false,kerf:1.2,overlap:0};
// Independent Cox-de Boor basis evaluator, used to densely verify curve-to-polyline error.
function evaluate(p,u,d,t,weights=p.map(()=>1)) {
 const basis=(i,k)=>k===0?(u[i]<=t&&t<u[i+1]?1:0):((u[i+k]-u[i])?(t-u[i])/(u[i+k]-u[i])*basis(i,k-1):0)+((u[i+k+1]-u[i+1])?(u[i+k+1]-t)/(u[i+k+1]-u[i+1])*basis(i+1,k-1):0);
 const b=p.map((_,i)=>basis(i,d)*weights[i]),sum=b.reduce((a,b)=>a+b,0);
 return [0,1].map(axis=>p.reduce((v,q,i)=>v+q[axis]*b[i],0)/sum);
}
function error(point,points) {
 let best=Infinity;
 for(let i=1;i<points.length;i++) {const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy,t=len?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/len)):0;best=Math.min(best,Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy));}
 return best;
}
function verify(p,u,d,weights,unit=4) {
 const drawing=parseDXF(wrap(entity(p,u,d,{weights}),unit)),points=drawing.paths[0].points,scale=unit===1?25.4:1;
 for(let i=0;i<1000;i++){const t=u[d]+(u[p.length]-u[d])*i/1000,q=evaluate(p,u,d,t,weights).map(v=>v*scale);assert.ok(error(q,points)<=0.010001,`error exceeds tolerance at ${t}`);}
 return drawing;
}
test('open cubic spline becomes G1 geometry with exact endpoints and an explicit manual side',()=>{
 const d=verify([[0,0],[0,100],[100,100],[100,0]],clamped,3);
 assert.equal(d.incomplete,false);assert.deepEqual(d.paths[0].points[0],[0,0]);assert.deepEqual(d.paths[0].points.at(-1),[100,0]);
 assert.equal(inferCutSides(d)[0].side,null);assert.match(d.warnings[0],/0,01 mm/);
 const code=generateGCode(d,{...cfg,cutSides:['on']});assert.match(code,/G1 /);assert.ok(!/^G[23] /m.test(code));assert.match(code,/X100 Y0\nM9/);
});
test('rational quadratic quarter circle respects weights and the 0.01 mm tolerance',()=>{
 const d=verify([[100,0],[100,100],[0,100]],[0,0,0,1,1,1],2,[1,Math.SQRT1_2,1]);
 for(const [x,y] of d.paths[0].points)assert.ok(Math.abs(Math.hypot(x,y)-100)<1e-8);
});
test('nonuniform spans, repeated knots and nonclamped endpoints retain the actual NURBS curve',()=>{
 verify([[0,0],[10,40],[50,-10],[80,60],[100,10],[120,0]],[0,0,0,0,0.3,0.8,1,1,1,1],3);
 verify([[0,0],[10,40],[50,-10],[80,60],[100,10],[120,0]],[0,0,0,0.5,0.5,0.7,1,1,1],2,[1,2,1,0.5,1,1]);
 const d=verify([[0,0],[10,40],[50,-10],[80,60]],[0,1,2,3,4,5,6],2);
 assert.deepEqual(d.paths[0].points[0],[5,20]);assert.deepEqual(d.paths[0].points.at(-1),[65,25]);
});
test('subdivision detects excursions hidden by coincident endpoints and midpoint',()=>{
 const d=verify([[0,0],[100,100],[-100,-100],[0,0]],clamped,3);
 assert.ok(d.paths[0].points.some(([x])=>x>20));assert.ok(d.paths[0].points.some(([x])=>x< -20));
});
test('inch spline sampling uses the tolerance in millimeters',()=>{
 const d=verify([[0,0],[0,10],[10,10],[10,0]],clamped,3,undefined,1);
 assert.deepEqual(d.paths[0].points.at(-1),[254,0]);
});
test('closed and periodic splines support automatic sides, compensation and holes-first output',()=>{
 const p=[[0,0],[80,0],[80,80],[0,80],[0,0]],u=[0,0,1,2,3,4,4];
 const d=parseDXF(wrap(entity(p,u,1,{flags:1})+'\n0\nCIRCLE\n10\n40\n20\n40\n40\n5'));
 assert.equal(d.paths[0].closed,true);assert.deepEqual(inferCutSides(d).map(x=>x.side),['outside','inside']);
 const paths=prepareToolpaths(d,{...cfg,cutSides:['outside','inside']});assert.equal(paths.length,2);
 const code=generateGCode(d,{...cfg,cutSides:['outside','inside']});assert.ok(code.indexOf('(Kontur 2')<code.indexOf('(Kontur 1'));
 const periodic=parseDXF(wrap(entity([[0,0],[50,0],[50,50],[0,50],[0,0],[50,0]],[0,1,2,3,4,5,6,7,8],2,{flags:3})));
 assert.equal(periodic.paths[0].closed,true);assert.equal(inferCutSides(periodic)[0].side,'outside');
});
test('a spline endpoint can join an ordinary line into a compensated contour',()=>{
 const d=parseDXF(wrap(entity([[0,0],[0,100],[100,100],[100,0]],clamped)+'\n0\nLINE\n10\n100\n20\n0\n11\n0\n21\n0'));
 assert.equal(d.paths.length,1);assert.equal(d.paths[0].closed,true);assert.equal(inferCutSides(d)[0].side,'outside');
 assert.ok(generateGCode(d,{...cfg,cutSides:['outside']}).includes('M8'));
});
test('malformed, nonplanar, discontinuous and fit-only splines never silently export partial cuts',()=>{
 const p=[[0,0],[0,100],[100,100],[100,0]];
 const invalid=[entity(p,[0,0,0,0,1,1,1]),entity(p,[0,0,0,0,1,0.5,1,1]),entity(p,clamped,3,{weights:[1,-1,1,1]}),entity(p,clamped,3,{weights:[1,1]}),entity(p,clamped,3,{z:[0,0,2,0]}),entity(p,clamped,3,{flags:1}),entity(p,clamped,11),'0\nSPLINE\n71\n3\n11\n0\n21\n0',entity(p,clamped,3,{extra:['31',1]}),entity([[0,0],[10,0],[20,0],[30,0]],[0,0,0.5,0.5,1,1],1)];
 for(const source of invalid)assert.throws(()=>parseDXF(wrap('0\nLINE\n10\n0\n20\n0\n11\n10\n21\n0\n'+source)));
});

test('degree ten curves retain the tolerance without assuming cubic geometry',()=>{
 const p=Array.from({length:11},(_,i)=>[i*10,Math.sin(i*1.7)*50]);
 verify(p,[...Array(11).fill(0),...Array(11).fill(1)],10);
});
test('control-count, weight conditioning and declared-count limits block unreliable input',()=>{
 const p=[[0,0],[0,100],[100,100],[100,0]];
 assert.throws(()=>parseDXF(wrap(entity(Array(4097).fill([0,0]),clamped))),/4096/);
 assert.throws(()=>parseDXF(wrap(entity(p,clamped,3,{weights:[1,1e-20,1,1]}))),/Gewichte/);
 assert.throws(()=>parseDXF(wrap(entity(p,clamped).replace('73\n4','73\n3'))),/Anzahl|anzahl/);
});
