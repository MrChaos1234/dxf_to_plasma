// Positive-weight DXF NURBS -> rational Bezier spans -> bounded line segments.
// Every accepted Bezier control hull lies inside the 0.01 mm chord capsule.
const TOLERANCE=0.01;
export function splineGeometry(data,scale) {
  const fail=message=>{throw new Error('SPLINE: '+message);};
  const scalar=(code,fallback)=>{const raw=data.find(p=>p[0]===code)?.[1];const v=raw===undefined?fallback:Number(raw);if(!Number.isFinite(v))fail('Ungültiger Parameter '+code+'.');return v;};
  const degree=scalar(71),flags=scalar(70,0),knots=data.filter(p=>p[0]===40).map(p=>Number(p[1]));
  if(!Number.isInteger(degree)||degree<1||degree>10)fail('Unterstützt werden Grade von 1 bis 10.');
  if(!Number.isInteger(flags)||flags<0)fail('Ungültige Kurvenkennzeichnung.');
  const controls=[];
  for(const [code,raw] of data) {
    const v=Number(raw);
    if(code===10)controls.push([v,NaN]);
    if(code===20){if(!controls.length)fail('Kontrollpunkt ohne X-Koordinate.');controls.at(-1)[1]=v;}
    if([30,31,32,33].includes(code)&&(!Number.isFinite(v)||v!==0))fail('Nur ebene Kurven bei Z=0 werden unterstützt.');
  }
  if(!controls.length)fail('Die Datei enthält nur Anpassungspunkte. Exportiere die Kurve mit Kontrollpunkten und Knotenvektor.');
  if(controls.length<=degree||controls.length>4096)fail('Ungültige oder zu große Kontrollpunktanzahl (höchstens 4096).');
  if(controls.some(p=>p.some(v=>!Number.isFinite(v)||Math.abs(v*scale)>1e9)))fail('Ungültige oder zu große Kontrollpunktkoordinaten.');
  if(knots.length!==controls.length+degree+1||knots.some((k,i)=>!Number.isFinite(k)||(i&&k<knots[i-1])))fail('Ungültiger Knotenvektor.');
  if(scalar(72,knots.length)!==knots.length||scalar(73,controls.length)!==controls.length)fail('Knoten- oder Kontrollpunktanzahl stimmt nicht mit den Daten überein.');
  const start=knots[degree],end=knots[controls.length];
  if(!(end>start)||!Number.isFinite(end-start))fail('Leerer oder ungültiger Parameterbereich.');
  // Normalize the parameter domain to avoid unnecessarily large knot magnitudes.
  const U=knots.map(k=>(k-start)/(end-start));
  if(U.some(k=>!Number.isFinite(k)))fail('Ungültiger Parameterbereich.');
  let run=1;
  for(let i=1;i<U.length;i++){run=U[i]===U[i-1]?run+1:1;if(run>degree+1)fail('Zu hohe Knotenvielfachheit.');}
  const boundaries=[...new Set(U.filter(k=>k>=0&&k<=1))];
  for(const u of boundaries)if(u>0&&u<1&&U.filter(k=>k===u).length>degree)fail('Unterbrochene Kurve an einem inneren Knoten. Teile sie im CAD in einzelne Kurven.');
  let weights=data.filter(p=>p[0]===41).map(p=>Number(p[1]));
  if(weights.length&&weights.length!==controls.length)fail('Gewichtsanzahl stimmt nicht mit den Kontrollpunkten überein.');
  if(!weights.length)weights=controls.map(()=>1);
  if(weights.some(w=>!Number.isFinite(w)||w<=0))fail('Gewichte müssen endlich und größer als null sein.');
  const maxWeight=Math.max(...weights);
  weights=weights.map(w=>w/maxWeight);
  if(weights.some(w=>w<1e-12))fail('Die Gewichte unterscheiden sich zu stark für eine zuverlässige Berechnung.');
  let P=controls.map(([x,y],i)=>[x*scale*weights[i],y*scale*weights[i],weights[i]]),work=0;
  // Insert knots up to degree multiplicity. Each nonempty span then has Bezier controls.
  for(const u of boundaries) {
    let multiplicity=U.filter(k=>k===u).length;
    while(multiplicity<degree) {
      if((work+=P.length)>4000000||P.length>=20000)fail('Kurve zu komplex. Vereinfache sie im CAD.');
      let k=U.length-1;while(U[k]>u)k--;
      const n=P.length-1,Q=new Array(P.length+1);
      for(let i=0;i<=k-degree;i++)Q[i]=P[i];
      for(let i=k-multiplicity;i<=n;i++)Q[i+1]=P[i];
      for(let i=k-degree+1;i<=k-multiplicity;i++) {
        const alpha=(u-U[i])/(U[i+degree]-U[i]);
        Q[i]=P[i].map((v,j)=>alpha*v+(1-alpha)*P[i-1][j]);
      }
      U.splice(k+1,0,u);P=Q;multiplicity++;
    }
  }
  const project=h=>{const p=[h[0]/h[2],h[1]/h[2]];if(p.some(v=>!Number.isFinite(v)))fail('Ungültige Kurvenkoordinaten.');return p;};
  const distance=(p,a,b)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
  };
  const points=[];let subdivisions=0;
  const flatten=(control,depth=0)=>{
    if(++subdivisions>100000)fail('Zu viele Teilsegmente. Vereinfache die Kurve im CAD.');
    const euclidean=control.map(project),a=euclidean[0],b=euclidean.at(-1);
    if(euclidean.every(p=>distance(p,a,b)<=TOLERANCE)) {
      if(!points.length)points.push(a);
      if(Math.hypot(b[0]-points.at(-1)[0],b[1]-points.at(-1)[1])>1e-12)points.push(b);
      return;
    }
    if(depth>=30)fail('Die Genauigkeit von 0,01 mm konnte nicht erreicht werden.');
    let row=control;const left=[row[0]],right=[row.at(-1)];
    while(row.length>1){row=row.slice(1).map((p,i)=>p.map((v,j)=>(v+row[i][j])/2));left.push(row[0]);right.push(row.at(-1));}
    flatten(left,depth+1);flatten(right.reverse(),depth+1);
  };
  for(let i=degree;i<P.length;i++)if(U[i]<U[i+1]&&U[i]>=0&&U[i+1]<=1)flatten(P.slice(i-degree,i+1));
  if(points.length<2)fail('Die Kurve hat keine Schnittlänge.');
  const closed=Boolean(flags&3);
  if(closed) {
    if(Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])>1e-7)fail('Die als geschlossen markierte Kurve schließt nicht. Prüfe die Kontrollpunkte und den Knotenvektor im CAD.');
    points[points.length-1]=points[0];
  }
  return {points:points.map(p=>p.map(v=>v/scale)),closed};
}
