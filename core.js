import {joinContours,prepareToolpaths,orderToolpaths} from './toolpaths.js';
import {positionToolpaths} from './layout.js';

// Geometry is expressed in millimeters. Sampled points serve the preview only;
// exact line/arc segments are retained for machine output and measurements.
const TAU = Math.PI * 2;
const radians = degrees => degrees * Math.PI / 180;
function curve(cx, cy, radius, start, sweep) {
  const count = Math.max(2, Math.ceil(Math.abs(sweep) / radians(5)), Math.ceil(Math.abs(sweep) * radius / 2));
  if (count > 100000) throw new Error('Curve is too large to process safely. Check the DXF units.');
  return Array.from({length: count + 1}, (_, i) => {
    const angle = start + sweep * i / count;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
}
function bulgeSegment(a, b, bulge) {
  if (!bulge) return {points:[a,b],segments:[{type:'line',start:a,end:b}]};
  const dx = b[0] - a[0], dy = b[1] - a[1], chord = Math.hypot(dx, dy);
  if (!chord) return {points:[a,b],segments:[]};
  const offset = chord * (1 - bulge * bulge) / (4 * bulge);
  const cx = (a[0] + b[0]) / 2 - dy / chord * offset;
  const cy = (a[1] + b[1]) / 2 + dx / chord * offset;
  return arcGeometry([cx,cy],Math.hypot(a[0]-cx,a[1]-cy),Math.atan2(a[1]-cy,a[0]-cx),4*Math.atan(bulge),a,b);
}
function arcGeometry(center, radius, startAngle, sweep, start, end) {
  const position = angle => [center[0]+radius*Math.cos(angle),center[1]+radius*Math.sin(angle)];
  start ||= position(startAngle);
  end ||= Math.abs(sweep) === TAU ? start : position(startAngle+sweep);
  const points = curve(...center,radius,startAngle,sweep);
  points[0] = start; points[points.length-1] = end;
  // At most 180 degrees per block avoids ambiguous same-endpoint full circles.
  const count = Math.max(1,Math.ceil(Math.abs(sweep)/Math.PI));
  const segments = [];
  let previous = start;
  for (let i=1;i<=count;i++) {
    const next = i === count ? end : position(startAngle+sweep*i/count);
    segments.push({type:'arc',start:previous,end:next,center,sweep:sweep/count});
    previous = next;
  }
  return {points,segments};
}
export function parseDXF(text, unitOverride = 'auto') {
  if (text.startsWith('AutoCAD Binary DXF')) throw new Error('Binary DXF is unsupported. Export as ASCII DXF.');
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\x1a\s*$/, '').trimEnd().split('\n');
  if (lines.length % 2) throw new Error('Invalid ASCII DXF: incomplete group-code pair.');
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!lines[i].trim() || !Number.isInteger(code)) throw new Error('Invalid DXF group code.');
    pairs.push([code, lines[i + 1].trim()]);
  }
  if (!pairs.some(([c,v]) => c === 0 && v === 'EOF')) throw new Error('Invalid DXF: missing EOF marker.');
  const unitIndex = pairs.findIndex(([c,v]) => c === 9 && v === '$INSUNITS');
  const unitCode = unitIndex >= 0 && pairs[unitIndex + 1]?.[0] === 70 ? Number(pairs[unitIndex + 1][1]) : 0;
  const scales = {1:25.4, 2:304.8, 4:1, 5:10, 6:1000};
  const warnings = new Set();
  if (unitOverride === 'auto' && unitCode && !scales[unitCode]) throw new Error('Unsupported DXF units. Select the drawing units manually.');
  const scale = unitOverride === 'auto' ? (scales[unitCode] || 1) : ({mm:1, inch:25.4, cm:10, m:1000}[unitOverride]);
  if (!scale) throw new Error('Invalid drawing units.');
  if (!unitCode && unitOverride === 'auto') warnings.add('Drawing units are unspecified; assuming millimeters. Confirm the dimensions.');
  const records = [];
  let section = '', current = null;
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === 0 && value === 'SECTION') { section = pairs[i + 1]?.[1]; current = null; }
    else if (code === 0 && value === 'ENDSEC') { section = ''; current = null; }
    else if (section === 'ENTITIES' && code === 0) { current = {type:value, data:[]}; records.push(current); }
    else if (current) current.data.push([code,value]);
  }
  const paths = [], skipped = {};
  let pointMarkers = 0;
  const num = (record, code, fallback) => {
    const raw = record.data.find(p => p[0] === code)?.[1];
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isFinite(value)) throw new Error(`Invalid ${record.type} coordinate or parameter (${code}).`);
    return value;
  };
  const add = (record, points, closed = false, segments = null) => {
    if (points.length < 2) return;
    if (points.some(p => p.some(v => !Number.isFinite(v)))) throw new Error('Invalid geometry.');
    segments ||= points.slice(1).map((end,i)=>({type:'line',start:points[i],end}));
    if (!segments.length) return;
    const scaled = p => p.map(v=>v*scale);
    paths.push({points:points.map(scaled), segments:segments.map(s=>({...s,start:scaled(s.start),end:scaled(s.end),...(s.center?{center:scaled(s.center)}:{})})), closed, layer:record.data.find(p => p[0] === 8)?.[1] || '0'});
  };
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    // POINT has no cut contour. CAD exporters often include reference markers.
    // Ignore its position, including Z, rather than treating it as cutting geometry.
    if (r.type === 'POINT') { pointMarkers++; continue; }
    // Arbitrary object coordinate systems and nonplanar geometry need a proper transform.
    if (num(r,210,0) !== 0 || num(r,220,0) !== 0 || num(r,230,1) !== 1 || num(r,30,0) !== 0 || num(r,31,0) !== 0 || num(r,38,0) !== 0) {
      throw new Error('Only flat drawings in the XY plane at Z=0 are supported. Flatten the drawing before exporting.');
    }
    if (r.type === 'LINE') add(r, [[num(r,10),num(r,20)], [num(r,11),num(r,21)]]);
    else if (r.type === 'CIRCLE' || r.type === 'ARC') {
      const radius = num(r,40);
      if (radius <= 0) throw new Error('Arc and circle radii must be positive.');
      const start = r.type === 'CIRCLE' ? 0 : radians(num(r,50));
      const end = r.type === 'CIRCLE' ? TAU : radians(num(r,51));
      const sweep = r.type === 'CIRCLE' ? TAU : ((end - start) % TAU + TAU) % TAU;
      if (!sweep) throw new Error('ARC has identical start and end angles. Use a CIRCLE entity for a full circle.');
      const geometry = arcGeometry([num(r,10),num(r,20)],radius,start,sweep);
      add(r,geometry.points,r.type === 'CIRCLE',geometry.segments);
    } else if (r.type === 'LWPOLYLINE' || r.type === 'POLYLINE') {
      const vertices = [];
      if (r.type === 'LWPOLYLINE') {
        for (const [code,value] of r.data) {
          if (code === 10) vertices.push({x:Number(value),y:NaN,b:0});
          else if (code === 20 && vertices.length) vertices.at(-1).y = Number(value);
          else if (code === 42 && vertices.length) vertices.at(-1).b = Number(value);
        }
      } else {
        if (num(r,70,0) & (8|16|64)) throw new Error('3D polylines and meshes are unsupported. Flatten the drawing.');
        while (records[i + 1]?.type === 'VERTEX') {
          const vertex = records[++i];
          if (num(vertex,30,0) !== 0) throw new Error('Nonplanar polyline. Flatten the drawing.');
          vertices.push({x:num(vertex,10), y:num(vertex,20), b:num(vertex,42,0)});
        }
        if (records[i + 1]?.type === 'SEQEND') i++;
      }
      if (vertices.some(v => ![v.x,v.y,v.b].every(Number.isFinite))) throw new Error('Invalid polyline vertex.');
      const closed = Boolean(num(r,70,0) & 1), points = [], segments = [];
      for (let j = 0; j < vertices.length - (closed ? 0 : 1); j++) {
        const a = vertices[j], b = vertices[(j + 1) % vertices.length];
        const segment = bulgeSegment([a.x,a.y],[b.x,b.y],a.b);
        for (let k = points.length ? 1 : 0; k < segment.points.length; k++) points.push(segment.points[k]);
        segments.push(...segment.segments);
      }
      add(r,points,closed,segments);
    } else if (r.type !== 'SEQEND') skipped[r.type] = (skipped[r.type] || 0) + 1;
  }
  if (pointMarkers) warnings.add(`Ignored ${pointMarkers} POINT marker${pointMarkers === 1 ? '' : 's'}; point markers have no cut path and are not used for piercing or drilling.`);
  if (Object.keys(skipped).length) warnings.add(`Unsupported entities omitted: ${Object.entries(skipped).map(([k,v]) => `${k} (${v})`).join(', ')}. Export is blocked to prevent an incomplete cut; explode or remove these entities in CAD.`);
  if (!paths.length) throw new Error(`No supported geometry found.${Object.keys(skipped).length ? ` Found: ${Object.entries(skipped).map(([type,count]) => `${type} (${count})`).join(', ')}.` : ''} Use LINE, ARC, CIRCLE, LWPOLYLINE or 2D POLYLINE entities. Explode blocks first.`);
  const bounds = {minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  const include = ([x,y]) => {bounds.minX=Math.min(bounds.minX,x);bounds.minY=Math.min(bounds.minY,y);bounds.maxX=Math.max(bounds.maxX,x);bounds.maxY=Math.max(bounds.maxY,y);};
  let length = 0;
  for (const path of paths) for (const segment of path.segments) {
    include(segment.start); include(segment.end);
    if (segment.type === 'line') length += Math.hypot(segment.end[0]-segment.start[0],segment.end[1]-segment.start[1]);
    else {
      const [cx,cy] = segment.center;
      const radius = Math.hypot(segment.start[0]-cx,segment.start[1]-cy);
      const angle = Math.atan2(segment.start[1]-cy,segment.start[0]-cx);
      length += radius*Math.abs(segment.sweep);
      for (let i=0;i<4;i++) {
        const cardinal = i*Math.PI/2;
        const delta = segment.sweep>0 ? cardinal-angle : angle-cardinal;
        const travel = ((delta%TAU)+TAU)%TAU;
        if (travel<=Math.abs(segment.sweep)+1e-12) include([cx+radius*Math.cos(cardinal),cy+radius*Math.sin(cardinal)]);
      }
    }
  }
  return {paths:joinContours(paths),bounds,length,warnings:[...warnings], incomplete:Object.keys(skipped).length > 0};
}
const fmt = value => Number(value.toFixed(6)).toString();
export function generateGCode(drawing, settings, prepared = null) {
  if (drawing.incomplete) throw new Error('Export blocked: the drawing contains unsupported entities.');
  const unassigned=settings.cutSides?.findIndex(side=>side===null) ?? -1;
  if(unassigned>=0)throw new Error(`Contour ${unassigned+1}: choose a cut side manually before exporting.`);
  const {feed,delay,on,off,origin} = settings;
  if (![feed,delay].every(Number.isFinite) || feed<=0 || delay<0) throw new Error('Use a positive feed rate and a nonnegative pierce delay.');
  for (const command of [on,off]) {
    if (!/^M\d{1,3}(?:\s+[SP]\d+(?:\.\d+)?)?$/i.test(command.trim())) throw new Error('Torch commands must be a single M-code, optionally followed by S or P (for example M3 or M3 S1000).');
  }
  if (on.trim().toUpperCase() === off.trim().toUpperCase()) throw new Error('Plasma on and off commands must be different.');
  let toolpaths=orderToolpaths(drawing,prepared || prepareToolpaths(drawing,settings),settings);
  if(settings.placement)toolpaths=positionToolpaths(drawing,toolpaths,settings.placement);
  const offset = !settings.placement&&origin ? [drawing.bounds.minX,drawing.bounds.minY] : [0,0];
  const xy = p => `X${fmt(p[0]-offset[0])} Y${fmt(p[1]-offset[1])}`;
  const hasArcs = toolpaths.some(path=>path.segments.some(s=>s.type==='arc'));
  const code = ['(DXF to Plasma - verify in controller simulation before cutting)', '(Millimeters; absolute coordinates; G94 mm/min; G4 P seconds)', 'G40','G21','G90','G17','G94'];
  if (hasArcs) code.push('(I/J center offsets relative to each arc start)','G91.1');
  code.push(off.trim().toUpperCase());
  for (const path of toolpaths) {
    code.push(`(Contour ${path.sourceIndex+1}${path.cutSide==='on'?'':` - ${path.cutSide}`})`, `G0 ${xy(path.segments[0].start)}`,on.trim().toUpperCase());
    if (delay > 0) code.push(`G4 P${fmt(delay)}`);
    let firstMove=true;
    const emit=segment=>{
      const feedWord=firstMove?` F${fmt(feed)}`:'';firstMove=false;
      if (segment.type === 'line') code.push(`G1 ${xy(segment.end)}${feedWord}`);
      else code.push(`${segment.sweep<0?'G2':'G3'} ${xy(segment.end)} I${fmt(segment.center[0]-segment.start[0])} J${fmt(segment.center[1]-segment.start[1])}${feedWord}`);
    };
    for (const segment of path.segments) emit(segment);
    if (path.overlapSegments?.length) {
      code.push(`(Overlap ${fmt(path.overlapLength)} mm)`);
      for (const segment of path.overlapSegments) emit(segment);
    }
    code.push(off.trim().toUpperCase());
  }
  code.push(off.trim().toUpperCase(),'M2');
  return code.join('\n') + '\n';
}
