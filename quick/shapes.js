// Parametric parts. Dimensions describe finished geometry before kerf compensation.
const TAU=Math.PI*2, GAP=0.02;
export const PART_TEMPLATES=[
  {id:'rectangle',name:'Rechteck',description:'Platte · Quadrat · gerundete Ecken',defaults:{width:120,height:80,radius:0},fields:[['width','Breite','mm'],['height','Höhe','mm'],['radius','Eckenradius','mm']]},
  {id:'circle',name:'Kreis / Ring',description:'Scheibe · Unterlegscheibe',defaults:{diameter:100,bore:0},fields:[['diameter','Außendurchmesser','mm'],['bore','Innendurchmesser','mm']]},
  {id:'tab',name:'Lasche',description:'Gerades Ende · runder Kopf · Loch',defaults:{width:40,length:100,hole:12},fields:[['width','Breite','mm'],['length','Gesamtlänge','mm'],['hole','Lochdurchmesser','mm']]},
  {id:'flange',name:'Rundflansch',description:'Mittelöffnung · Schraubenlochkreis',defaults:{diameter:160,bore:60,boltCircle:115,hole:11,count:4,phase:45},fields:[['diameter','Außendurchmesser','mm'],['bore','Mittelöffnung','mm'],['boltCircle','Lochkreis Ø','mm'],['hole','Lochdurchmesser','mm'],['count','Lochanzahl','Stück'],['phase','Startwinkel','°']]},
  {id:'plate',name:'Flanschplatte',description:'Vier Ecklöcher · Mittelöffnung',defaults:{width:140,height:100,radius:8,hole:10,edgeX:15,edgeY:15,bore:40},fields:[['width','Breite','mm'],['height','Höhe','mm'],['radius','Eckenradius','mm'],['hole','Lochdurchmesser','mm'],['edgeX','Lochmitte ab Rand X','mm'],['edgeY','Lochmitte ab Rand Y','mm'],['bore','Mittelöffnung','mm']]},
  {id:'strap',name:'Langlasche',description:'Zwei runde Enden · zwei Löcher',defaults:{length:120,width:35,hole:10},fields:[['length','Gesamtlänge','mm'],['width','Breite','mm'],['hole','Lochdurchmesser','mm']]}
];
const clean=n=>Number(n.toFixed(9));
const circle=(x,y,r)=>['0','CIRCLE','8','Loch','10',clean(x),'20',clean(y),'40',clean(r)].join('\n');
function poly(vertices) {return ['0','LWPOLYLINE','8','Aussenkontur','90',vertices.length,'70',1,...vertices.flatMap(([x,y,b=0])=>['10',clean(x),'20',clean(y),'42',clean(b)])].join('\n');}
function rectangle(w,h,r) {
  if(!r)return poly([[0,0],[w,0],[w,h],[0,h]]);
  const q=Math.tan(Math.PI/8);
  return poly([[r,0],[w-r,0,q],[w,r],[w,h-r,q],[w-r,h],[r,h,q],[0,h-r],[0,r,q]]);
}
export function createPart(type,values) {
  const template=PART_TEMPLATES.find(t=>t.id===type);
  if(!template)throw new Error('Unbekannte Teileform.');
  if(!values||typeof values!=='object')throw new Error('Ungültige Teilemaße.');
  const p={};
  for(const [key,label] of template.fields) {
    const n=values[key];
    if(typeof n!=='number'||!Number.isFinite(n))throw new Error(`${label}: Bitte eine gültige Zahl eingeben.`);
    if(key==='phase') {if(Math.abs(n)>36000)throw new Error('Startwinkel: höchstens ±36000°.');}
    else if(n<0||n>10000)throw new Error(`${label}: Wert muss zwischen 0 und 10000 liegen.`);
    p[key]=n;
  }
  const positive=(key,label)=>{if(p[key]<0.1)throw new Error(`${label} muss mindestens 0,1 mm betragen.`);};
  const holes=[];let outline;
  const addHole=(x,y,d)=>{if(d>0)holes.push({x,y,r:d/2});};
  if(type==='rectangle'||type==='plate') {
    positive('width','Breite');positive('height','Höhe');
    if(p.radius>Math.min(p.width,p.height)/2)throw new Error('Eckenradius darf höchstens die halbe kürzere Seite betragen.');
    outline=rectangle(p.width,p.height,p.radius);
    if(type==='plate') {
      positive('hole','Lochdurchmesser');positive('edgeX','Randabstand X');positive('edgeY','Randabstand Y');
      for(const x of [p.edgeX,p.width-p.edgeX])for(const y of [p.edgeY,p.height-p.edgeY])addHole(x,y,p.hole);
      addHole(p.width/2,p.height/2,p.bore);
      for(const h of holes) {
        const qx=Math.abs(h.x-p.width/2)-(p.width/2-p.radius),qy=Math.abs(h.y-p.height/2)-(p.height/2-p.radius);
        const distance=Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-p.radius;
        if(distance+h.r>=-GAP)throw new Error('Ein Loch liegt zu nah an der Außenkontur. Maße oder Randabstände ändern.');
      }
    }
  } else if(type==='circle'||type==='flange') {
    positive('diameter','Außendurchmesser');
    outline=circle(p.diameter/2,p.diameter/2,p.diameter/2).replace('Loch','Aussenkontur');
    addHole(p.diameter/2,p.diameter/2,p.bore);
    if(p.bore>0&&p.bore/2+GAP>=p.diameter/2)throw new Error('Die Mittelöffnung muss kleiner als der Außendurchmesser sein.');
    if(type==='flange') {
      positive('hole','Lochdurchmesser');positive('boltCircle','Lochkreis');
      if(!Number.isInteger(p.count)||p.count<2||p.count>32)throw new Error('Lochanzahl muss eine ganze Zahl zwischen 2 und 32 sein.');
      if((p.boltCircle+p.hole)/2+GAP>=p.diameter/2)throw new Error('Schraubenlöcher liegen zu nah am Außenrand. Lochkreis oder Lochdurchmesser verkleinern.');
      for(let i=0;i<p.count;i++) {const a=(p.phase%360)*Math.PI/180+i*TAU/p.count;addHole(p.diameter/2+Math.cos(a)*p.boltCircle/2,p.diameter/2+Math.sin(a)*p.boltCircle/2,p.hole);}
    }
  } else if(type==='tab') {
    positive('width','Breite');positive('length','Gesamtlänge');
    if(p.length<p.width)throw new Error('Die Lasche muss mindestens so lang wie breit sein.');
    const r=p.width/2;
    outline=poly([[0,0],[p.width,0],[p.width,p.length-r,1],[0,p.length-r]]);
    addHole(r,p.length-r,p.hole);
    if(p.hole>0&&p.hole/2+GAP>=r)throw new Error('Das Loch muss kleiner als die Laschenbreite sein.');
  } else {
    positive('width','Breite');positive('length','Gesamtlänge');
    if(p.length<p.width)throw new Error('Die Langlasche muss mindestens so lang wie breit sein.');
    const r=p.width/2;
    if(p.length===p.width) {
      if(p.hole>0)throw new Error('Für zwei getrennte Löcher muss die Länge größer als die Breite sein.');
      outline=circle(r,r,r).replace('Loch','Aussenkontur');
    } else {
      outline=poly([[r,0],[p.length-r,0,1],[p.length-r,p.width],[r,p.width,1]]);
      addHole(r,r,p.hole);addHole(p.length-r,r,p.hole);
    }
    if(p.hole>0&&p.hole/2+GAP>=r)throw new Error('Die Löcher müssen kleiner als die Laschenbreite sein.');
  }
  for(let i=0;i<holes.length;i++)for(let j=0;j<i;j++) {
    const a=holes[i],b=holes[j];
    if(Math.hypot(a.x-b.x,a.y-b.y)<=a.r+b.r+GAP)throw new Error('Löcher überlappen oder berühren sich. Durchmesser oder Lochabstände ändern.');
  }
  const dxf=['0','SECTION','2','HEADER','9','$INSUNITS','70','4','0','ENDSEC','0','SECTION','2','ENTITIES',outline,...holes.map(h=>circle(h.x,h.y,h.r)),'0','ENDSEC','0','EOF',''].join('\n');
  return {dxf,name:template.name,filename:`${type}.dxf`,parameters:p};
}
