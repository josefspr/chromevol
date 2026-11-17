/* Fixed heterogeneous clades, identified by the MRCA of two existing tips. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./chromevol-validation.js'));else root.ChromevolUserDefined=factory(root.ChromevolValidation);})(globalThis,function(V){
'use strict';
function configure(model,treeText,clades){
  if(typeof clades==='string'){try{clades=JSON.parse(clades);}catch(error){throw new Error('Could not read user-defined clades.');}}
  if(!Array.isArray(clades)||!clades.length)throw new Error('UserDefined requires at least one shift clade (two tip names per line).');
  const root=V.validate_tree(treeText).tree,paths=new Map();
  function visit(node,path){path=[...path,node];if(node.children.length)node.children.forEach(c=>visit(c,path));else{if(paths.has(node.name))throw new Error('Duplicate tree tip: '+node.name);paths.set(node.name,path);}}
  visit(root,[]);
  if(root.children.length<2)throw new Error('UserDefined requires a root with at least two child clades.');
  const first=n=>n.children.length?first(n.children[0]):n.name;
  const tips=[first(root.children[0]),first(root.children[1])],used=new Set([root]);
  const lines=['Model #1 = ('+tips.join(',')+');'];
  for(const [i,pairText] of clades.entries()){
    const pair=Array.isArray(pairText)?pairText.map(String):String(pairText).split(',').map(s=>s.trim());
    if(pair.length!==2||!pair[0]||!pair[1]||pair[0]===pair[1])throw new Error('Shift '+(i+1)+': enter two different tip names separated by a comma.');
    for(const tip of pair)if(!paths.has(tip))throw new Error('Shift '+(i+1)+': tip not found in the prepared tree: '+tip);
    let mrca;const a=paths.get(pair[0]),b=paths.get(pair[1]);for(let j=0;j<Math.min(a.length,b.length)&&a[j]===b[j];j++)mrca=a[j];
    if(used.has(mrca))throw new Error('Shift '+(i+1)+' duplicates the Background root or an earlier shift clade.');
    used.add(mrca);lines.push('Model #'+(i+2)+' = ('+pair.join(',')+');');
  }
  for(const tip of [...tips,...clades.flatMap(p=>Array.isArray(p)?p:String(p).split(',').map(s=>s.trim()))])if(/[(),;\s]/.test(tip))throw new Error('UserDefined tip names must not contain spaces, commas, parentheses or semicolons.');
  let params=model.params.replace(/\r\n?/g,'\n');
  const rates=[...params.matchAll(/^(_(?:baseNumR|baseNum|dupl|gain|loss|demiPloidyR))_1\s*=\s*(\d+);([^\n]+)$/gm)];
  let category=Math.max(0,...rates.map(m=>Number(m[2])));
  for(let regime=2;regime<=clades.length+1;regime++){
    const mapping=new Map();
    for(const m of rates){if(!mapping.has(m[2]))mapping.set(m[2],++category);params+='\n'+m[1]+'_'+regime+' = '+mapping.get(m[2])+';'+m[3];}
  }
  const set=(key,value)=>{const r=new RegExp('^'+key+'\\s*=.*$','gm');params=r.test(params)?params.replace(r,key+' = '+value):params.trimEnd()+'\n'+key+' = '+value+'\n';};
  set('_numOfModels',clades.length+1);set('_maxNumOfModels',clades.length+1);
  set('_minCladeSize',1);set('_nodeIdsFilePath','/input/nodes_splits.txt');set('_backwardPhase','false');
  return {...model,params,extraFiles:[{name:'nodes_splits.txt',bytes:lines.join('\n')+'\n'}]};
}
return {configure};
});
