/* Match taxa using the two choices in the original pipeline's edit_counts_file. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./chromevol-validation.js'));else root.ChromevolMatchCounts=factory(root.ChromevolValidation);})(globalThis,function(V){
'use strict';
function matchCounts(treeText,countsText,mode='PruneTree'){
  if(!['PruneTree','Xcounts'].includes(mode))throw new Error('Choose a counts-to-phylogeny matching option.');
  const parsed=V.validate_tree(treeText),countsCheck=V.validate_counts(countsText),counts=new Map();
  let name;for(const raw of countsCheck.text.split('\n')){
    const line=raw.trim();if(!line)continue;
    if(line.startsWith('>')){name=line.slice(1).trim();if(counts.has(name))throw new Error('Duplicate species in counts file: '+name);}
    else counts.set(name,/^x$/i.test(line)?'X':line);
  }
  const tips=[],seen=new Set();
  function collect(n){if(n.children.length)n.children.forEach(collect);else{if(seen.has(n.name))throw new Error('Duplicate tip name in tree: '+n.name);seen.add(n.name);tips.push(n.name);}}
  collect(parsed.tree);
  const missing=tips.filter(n=>!counts.has(n)),extra=[...counts.keys()].filter(n=>!seen.has(n));
  if(!tips.some(n=>counts.has(n)&&!/^x$/i.test(counts.get(n))))throw new Error('The tree and counts have no matching taxon with observed counts. Check that species names match exactly.');
  const report={mode,missingCounts:missing,removedCounts:extra,prunedTips:mode==='PruneTree'?missing:[],assignedX:mode==='Xcounts'?missing:[],inputTips:tips.length,inputCountRecords:counts.size};
  let tree=parsed.tree;
  function prune(n,isRoot=false){
    if(!n.children.length)return counts.has(n.name)?n:null;
    n.children=n.children.map(c=>prune(c)).filter(Boolean);
    if(!n.children.length)return null;
    if(n.children.length===1){
      const child=n.children[0];
      // Sum collapsed edges. A new root has no incoming edge (as drop.tip does).
      child.length=isRoot?n.length:(n.length===null&&child.length===null?null:(n.length||0)+(child.length||0));
      return child;
    }
    return n;
  }
  if(mode==='PruneTree'&&missing.length)tree=prune(tree,true);
  function write(n){return (n.children.length?'('+n.children.map(write).join(',')+')':'')+n.name+(n.length===null?'':':'+n.length);}
  const finalTips=tips.filter(n=>mode==='Xcounts'||counts.has(n));
  if(finalTips.length<5)throw new Error('Matching leaves fewer than 5 tree tips/count records. At least 5 are required.');
  const outputCounts=finalTips.map(n=>'>'+n+'\n'+(counts.get(n)??'X')+'\n').join('');
  const outputTree=mode==='PruneTree'&&missing.length?write(tree)+';\n':parsed.text;
  V.validate_tree(outputTree);V.validate_counts(outputCounts);
  report.outputTips=finalTips.length;report.outputCountRecords=finalTips.length;
  const list=names=>names.length?names.join(', '):'None';
  const summary=[
    'Match counts to phylogeny: '+(mode==='PruneTree'?'Remove tips with no counts data':'Assign missing taxa as X'),
    'Tree tips: '+report.inputTips+' -> '+report.outputTips,
    'Count records: '+report.inputCountRecords+' -> '+report.outputCountRecords,
    'Tree taxa without count records: '+list(missing),
    'Removed counts absent from the tree: '+list(extra),
    'Pruned tree tips: '+list(report.prunedTips),
    'Assigned X: '+list(report.assignedX),
    'Species names are matched exactly (case-sensitive).',
    'Existing X records are retained in both modes.'
  ].join('\n')+'\n';
  return {tree:outputTree,counts:outputCounts,report,summary};
}
return {matchCounts};
});
