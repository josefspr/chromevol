(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ChromevolStatistics=factory();})(globalThis,function(){
'use strict';
// First three statistics from the supplied model-adequacy pipeline.
function pythonRound(value,digits=2) {
  if(!Number.isFinite(value)||value===0)return value;
  const sign=value<0?-1:1,buffer=new ArrayBuffer(8),v=new DataView(buffer);v.setFloat64(0,Math.abs(value));
  const high=v.getUint32(0),low=v.getUint32(4),exp=(high>>>20)&2047;
  let n=(BigInt(high&0xfffff)<<32n)|BigInt(low),e;
  if(exp){n|=1n<<52n;e=exp-1023-52;}else e=-1074;
  let d=1n;n*=10n**BigInt(digits);if(e>=0)n<<=BigInt(e);else d<<=BigInt(-e);
  let q=n/d;const r=n%d;if(2n*r>d||(2n*r===d&&q%2n))q++;
  return sign*Number(q)/10**digits;
}
function parseCounts(text) {
  const counts=new Map();let name;
  for(const raw of text.replace(/^\uFEFF/,'').split(/\r\n?|\n/)) {
    const line=raw.trim();if(!line)continue;
    if(line.startsWith('>')){name=line.slice(1).trim();continue;}
    if(name===undefined||!/^\d+$/.test(line))throw new Error('This comparison requires integer FASTA counts without missing data.');
    if(counts.has(name))throw new Error('Repeated counts entry: '+name);
    counts.set(name,Number(line));
  }
  if(!counts.size)throw new Error('Empty counts input.');return counts;
}
function parseNewick(text) {
  let p=0;const s=text.trim();
  function ws(){while(p<s.length&&/\s/.test(s[p]))p++;}
  function label(){ws();if(s[p]==="'"){let out='';p++;while(p<s.length){const c=s[p++];if(c==="'"){if(s[p]==="'"){out+="'";p++;}else return out;}else out+=c;}throw new Error('Unclosed Newick quote.');}const start=p;while(p<s.length&&!/[\s(),:;\[\]]/.test(s[p]))p++;return s.slice(start,p);}
  function node(){ws();const children=[];if(s[p]==='('){p++;children.push(node());ws();while(s[p]===','){p++;children.push(node());ws();}if(s[p++]!==')')throw new Error('Invalid Newick parentheses.');}
    const name=label();let length=0;ws();while(p<s.length){if(s[p]===':'){p++;const m=s.slice(p).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);if(!m)throw new Error('Invalid branch length.');length=Number(m[0]);p+=m[0].length;}else if(s[p]==='['){let depth=0;do{if(s[p]==='[')depth++;if(s[p]===']')depth--;p++;}while(depth&&p<s.length);if(depth)throw new Error('Unclosed Newick comment.');}else break;ws();}
    return {name,length,children};}
  const root=node();ws();if(s[p]===';')p++;ws();if(p!==s.length)throw new Error('Unexpected Newick suffix.');return root;
}
function statistics(countsText,treeText) {
  const counts=parseCounts(countsText),values=[...counts.values()],n=values.length;
  const mean=values.reduce((a,b)=>a+b,0)/n;
  const variance=values.reduce((sum,x)=>sum+(x-mean)**2,0)/n;
  const frequencies=new Map();for(const value of values)frequencies.set(value,(frequencies.get(value)||0)+1);
  let entropy=0;for(const frequency of frequencies.values()){const p=frequency/n;entropy-=p*Math.log(p);}
  const tree=parseNewick(treeText);let score=0;const seen=new Set();
  function visit(node){
    if(!node.children.length){
      const name=counts.has(node.name)?node.name:node.name.replace(/-\d+$/,'');
      if(!counts.has(name))throw new Error('Tree taxon missing from counts: '+name);
      if(seen.has(name))throw new Error('Repeated tree taxon: '+name);seen.add(name);return new Set([counts.get(name)]);
    }
    if(node.children.length!==2)throw new Error('The reference Fitch implementation requires a binary tree.');
    const a=visit(node.children[0]),b=visit(node.children[1]);const shared=new Set([...a].filter(x=>b.has(x)));
    if(shared.size)return shared;score++;return new Set([...a,...b]);
  }
  visit(tree);if(seen.size!==counts.size)throw new Error('Counts and tree contain different taxon sets.');
  return {Variance:pythonRound(variance),Entropy:pythonRound(entropy),Parsimony:score};
}
function midpointPvalue(distribution,observed) {
  if(!distribution.length)throw new Error('No simulation statistics.');
  const lower=distribution.filter(x=>x<observed).length,equal=distribution.filter(x=>x===observed).length;
  const pLower=pythonRound((lower+equal/2)/distribution.length,3);
  const p=2*Math.min(pLower,1-pLower);
  return {pValue:p,adequate:p>0.05};
}
// ACCTRAN-style edge changes for a single unordered character on a rooted binary tree.
// Uses Fitch state sets, preorder restriction, and equal allocation of unresolved changes.
function timeParsimony(treeText) {
  const root=parseNewick(treeText),edges=[];
  const intersection=(a,b)=>new Set([...a].filter(value=>b.has(value)));
  function post(node,depth) {
    node.depth=depth;
    if(!node.children.length){
      const match=node.name.match(/^(.*)-(\d+)$/);
      if(!match)throw new Error('Time parsimony requires chromosome suffixes in tip labels.');
      if(/\d/.test(match[1]))throw new Error('Digit-containing taxon names need separate reference verification.');
      node.states=new Set([Number(match[2])]);return;
    }
    if(node.children.length!==2)throw new Error('Time parsimony currently requires a rooted binary tree.');
    node.outEdges=[];for(const child of node.children){if(child.length<0)throw new Error('Negative tree branch length.');post(child,depth+child.length);const edge={parent:node,child};edges.push(edge);node.outEdges.push(edge);}
    const [a,b]=node.children,common=intersection(a.states,b.states);
    node.localChange=common.size?0:1;
    node.states=common.size?common:new Set([...a.states,...b.states]);
  }
  post(root,0);
  function restrict(node){for(const child of node.children){if(child.children.length){const common=intersection(node.states,child.states);if(common.size)child.states=common;restrict(child);}}}
  restrict(root);
  for(const edge of edges)edge.changes=intersection(edge.parent.states,edge.child.states).size?0:1;
  function allocate(node){if(!node.children.length)return;
    const out=node.outEdges,remaining=node.localChange-out.reduce((a,e)=>a+e.changes,0);
    if(remaining>0)for(const edge of out)edge.changes+=remaining/out.length;
    for(const child of node.children)allocate(child);
  }
  allocate(root);
  const n=edges.length,mx=edges.reduce((a,e)=>a+e.child.depth,0)/n,my=edges.reduce((a,e)=>a+e.changes,0)/n;
  let numerator=0,denominator=0;
  for(const edge of edges){numerator+=(edge.child.depth-mx)*(edge.changes-my);denominator+=(edge.child.depth-mx)**2;}
  if(!denominator)throw new Error('Time parsimony regression has no variation in node depth.');
  return pythonRound(numerator/denominator);
}

function calculateBatch({counts,tree,files,simulations,hasBaseNumber=false,baseCorrectionComplete=false}) {
  const decode=x=>typeof x==='string'?x:new TextDecoder().decode(x);
  const keys=['Variance','Entropy','Parsimony','Time_parsimony'];
  const empirical={dataset:'empirical',...statistics(counts,tree),Time_parsimony:timeParsimony(tree)};
  const table=new Map(files.map(f=>[f.name,f.bytes])),rows=[empirical];
  for(let i=0;i<simulations;i++) {
    const countsName=i+'/counts.fasta',treeName=i+'/simulatedDataAncestors.tree';
    if(!table.has(countsName)||!table.has(treeName))throw new Error('Missing simulation files for '+i);
    rows.push({dataset:'simulation_'+i,...statistics(decode(table.get(countsName)),tree),Time_parsimony:timeParsimony(decode(table.get(treeName)))});
  }
  const values=keys.map(statistic=>({statistic,empirical:empirical[statistic],...midpointPvalue(rows.slice(1).map(row=>row[statistic]),empirical[statistic])}));
  const provisional=simulations<1000||(hasBaseNumber&&!baseCorrectionComplete);
  return {stage:provisional?'statistics-validation':'homogeneous-model-adequacy',simulations,provisional,
    warnings:[...(simulations<1000?['Only '+simulations+' simulations; use 1000 for the original workflow.']:[]),...(hasBaseNumber&&!baseCorrectionComplete?['Base-number correction is incomplete; these results are diagnostic only.']:[])],
    statistics:rows,tests:values};
}
function batchFiles(batch) {
  const keys=['Variance','Entropy','Parsimony','Time_parsimony'];
  const csv=(rows)=>rows.map(row=>row.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';
  return [
    {name:'adequacy.json',content:JSON.stringify(batch,null,2)+'\n'},
    {name:'statistics.csv',content:csv([['dataset',...keys],...batch.statistics.map(row=>[row.dataset,...keys.map(k=>row[k])])])},
    {name:'pvalues.csv',content:csv([['statistic','empirical','pValue','classification','provisional'],...batch.tests.map(t=>[t.statistic,t.empirical,t.pValue,t.adequate?'Adequate':'Inadequate',batch.provisional])])},
    {name:'orig_stats',content:keys.map(k=>batch.statistics[0][k]).join(',')},
    {name:'PVs',content:batch.tests.map(t=>t.pValue).join('\n')+'\n'},
    {name:'stats_dist_sims',content:keys.map(k=>'['+batch.statistics.slice(1).map(row=>row[k]).join(', ')+']').join('\n')+'\n'},
    {name:batch.provisional?'diagnostic_results.txt':'final_results',content:(batch.provisional?'DIAGNOSTIC ONLY — '+batch.warnings.join(' ')+'\n':'')+batch.tests.map(t=>t.statistic+' is '+(t.adequate?'Adequate':'Inadequate')).join('\n')+'\n'}
  ];
}
return {timeParsimony,calculateBatch,batchFiles,pythonRound,parseCounts,parseNewick,statistics,midpointPvalue};

});
