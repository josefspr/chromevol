(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./chromevol-statistics.js'));else root.ChromevolAdequacy=factory(root.ChromevolStatistics);})(globalThis,function(statistics){
'use strict';
// Simulation preparation and integrity checks for the staged adequacy pipeline.
const text=bytes=>typeof bytes==='string'?bytes:new TextDecoder().decode(bytes);
function selectModels(results,mode,selectedName) {
  const usable=results.filter(r=>!r.error&&!r.summaryError&&r.parsed&&Number.isFinite(r.aicc)).sort((a,b)=>a.aicc-b.aicc||a.id-b.id);
  if(!usable.length)throw new Error('No successfully fitted model is available for simulation.');
  if(mode==='best')return [usable[0]];
  if(mode==='all')return usable;
  const selected=usable.find(r=>r.modelName===selectedName);
  if(!selected)throw new Error('Selected adequacy model was not successfully fitted: '+selectedName);
  return [selected];
}
function countsVector(counts) {
  const values=counts.split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('>'));
  if(values.some(s=>!/^\d+$/.test(s)))throw new Error('This first simulation test requires integer counts without X/missing values.');
  return values.map(Number);
}
function simulationTree(newick) {
  // Parse and rewrite Newick; preserve topology and lengths, remove state suffixes and internal labels.
  const src=newick.trim();let p=0;
  const space=()=>{while(p<src.length&&/\s/.test(src[p]))p++;};
  function label(){space();if(src[p]==="'"){p++;let s='';while(p<src.length){const c=src[p++];if(c==="'"){if(src[p]==="'"){s+="'";p++;}else return s;}else s+=c;}throw new Error('Unclosed Newick label.');}const start=p;while(p<src.length&&!/[\s(),:;\[\]]/.test(src[p]))p++;return src.slice(start,p);}
  function comment(){let n=0;do{const c=src[p++];if(c==='[')n++;if(c===']')n--;}while(n&&p<src.length);if(n)throw new Error('Unclosed Newick comment.');}
  function subtree(){space();const children=[];if(src[p]==='('){p++;children.push(subtree());space();while(src[p]===','){p++;children.push(subtree());space();}if(src[p++]!==')')throw new Error('Invalid Newick tree.');}
    let name=label(),length='';space();while(p<src.length){if(src[p]==='[')comment();else if(src[p]===':'){p++;const start=p;while(p<src.length&&!/[\s,);\[]/.test(src[p]))p++;length=':'+src.slice(start,p);}else break;space();}
    if(children.length)return '('+children.join(',')+')'+length;
    const match=name.match(/^(.*)-(\d+)$/);if(!match)throw new Error('ML tree tip lacks an integer chromosome suffix: '+name);
    name=match[1];return (/^[^\s():;,\[\]'"]+$/.test(name)?name:"'"+name.replace(/'/g,"''")+"'")+length;
  }
  const result=subtree();space();if(src[p]===';')p++;space();if(p!==src.length)throw new Error('Unexpected content after ML tree.');return result+';\n';
}
// Locate each shift by its exact node identifier in the same scaled ML tree used for simulation.
// Each pair of representative child tips specifies the clade's MRCA to chromEvol.
function createNodesSplits(final,treeText,regimeCount) {
  const {parseNewick}=statistics;
  const roots=[...final.matchAll(/^\s*#\s*Model\s+\$(\d+)\s*=\s*(\S+)/gm)].map(m=>({model:Number(m[1]),root:m[2]}));
  if(roots.length!==regimeCount||new Set(roots.map(r=>r.model)).size!==regimeCount)throw new Error('Incomplete fitted regime roots in chromEvol.res.');
  const tree=parseNewick(treeText),nodes=[];
  function visit(n){nodes.push(n);n.children.forEach(visit);}visit(tree);
  const tip=n=>n.children.length?tip(n.children[0]):n.name.replace(/-\d+$/,'');
  const lines=[];
  for(const {model,root} of roots){
    const matches=nodes.filter(n=>n.name===root||n.name.replace(/-\d+$/,'')===root);
    if(matches.length!==1)throw new Error('Cannot uniquely locate fitted regime root '+root+' in ML ancestral tree.');
    const node=matches[0];
    if(node.children.length!==2)throw new Error('Regime root '+root+' must have two children.');
    const tips=node.children.map(tip);
    if(tips.some(name=>/[(),;\s]/.test(name)))throw new Error('Regime partition cannot encode taxon name with spaces or punctuation.');
    lines.push('Model #'+model+' = ('+tips.join(',')+');');
  }
  return lines.join('\n')+'\n';
}
function prepareSimulation(record,input,{simulations=10,maxChromosome}={}) {
  const res=record.files.find(f=>f.name==='chromEvol.res'),tree=record.files.find(f=>f.name==='MLAncestralReconstruction.tree');
  if(!res||!tree)throw new Error('Simulation requires chromEvol.res and MLAncestralReconstruction.tree.');
  const content=text(res.bytes),start=content.indexOf('Best chosen model');
  const final=content.slice(start).split('Previous best chosen models in the forward phase')[0];
  function number(pattern,label){const m=content.match(pattern);if(!m)throw new Error('Missing '+label+' in chromEvol.res.');return Number(m[1]);}
  const min=number(/Min allowed chromosome number\s*=\s*(\d+)/,'minimum chromosome number');
  const inferredMax=number(/Max allowed chromosome number\s*=\s*(\d+)/,'maximum chromosome number');
  const counts=countsVector(input.counts),realMax=Math.max(...counts);
  const max=maxChromosome??Math.max(inferredMax,realMax,Math.min(realMax*10,200));
  const freq=new Map([...final.matchAll(/F\[(\d+)\]\s*=\s*([+\-\d.eE]+)/g)].map(m=>[Number(m[1]),Number(m[2])]));
  if(!freq.size)throw new Error('No final root frequencies found.');
  const freqText=Array.from({length:Math.max(...freq.keys())-min+1},(_,i)=>String(freq.get(min+i)||0)).join('\n')+'\n';
  const funcNames={baseNumR:'_baseNumRFunc',dupl:'_duplFunc',loss:'_lossFunc',gain:'_gainFunc',demi:'_demiDuplFunc'};
  const functions={};
  for(const m of content.slice(0,start).matchAll(/^\s*(baseNumR|dupl|loss|gain|demi):\s*(\w+)/gm))functions[m[1]]=m[2];
  if(Object.keys(functions).length!==5)throw new Error('Incomplete rate-function definitions in result file.');
  const regimeCount=Number(final.match(/Number of models in the best model\s*=\s*(\d+)/)?.[1]||1);
  const heterogeneous=regimeCount>1;
  const parameters=new Map();
  for(const m of final.matchAll(/^Chromosome\.(baseNumR|baseNum|dupl|gain|loss|demi)(\d*)_(\d+)\s*=\s*([+\-\d.eE]+)/gm)){
    const key=m[1]+'_'+m[3];
    if(!parameters.has(key))parameters.set(key,[]);parameters.get(key)[Number(m[2]||0)]=m[4];
  }
  let category=1;
  const lines=[
    '_resultsPathDir = /results','_treeFile = /input/TreesFile.txt','_dataFile = /results',
    '_fixedFrequenciesFilePath = /input/root_freq','_minChrNum = '+min,'_maxChrInferred = '+inferredMax,
    '_maxChrNum = '+max,'_branchMul = 1.0','_heterogeneousModel = '+heterogeneous,'_nodeIdsFilePath = '+(heterogeneous?'/input/nodes_splits.txt':'none'),
    '_numOfModels = '+regimeCount,'_maxNumOfModels = '+regimeCount,'_simulateData = true','_seed = 100',
    '_numOfSimulatedData = '+simulations,'_numOfRequiredSimulatedData = '+simulations,'_fracAllowedFailedSimulations = 0.01'
  ];
  for(const [rate,func] of Object.entries(functions))lines.push(funcNames[rate]+' = '+func);
  for(let regime=1;regime<=regimeCount;regime++){
    let found=false;
    for(const [key,values] of parameters){
      const [rate,index]=key.split('_');if(Number(index)!==regime)continue;found=true;
      lines.push('_'+(rate==='demi'?'demiPloidyR':rate)+'_'+regime+' = '+category+++';'+values.join(','));
    }
    if(!found)throw new Error('Missing fitted parameters for regime '+regime);
  }
  if(functions.baseNumR!=='IGNORE'){
    const base=Math.max(...[...parameters].filter(([key])=>/^baseNum_/.test(key)).map(([,values])=>Number(values[0])));
    if(!Number.isFinite(base))throw new Error('Missing fitted base numbers.');
    lines.push('_maxBaseNumTransition = '+Math.max(Math.max(...counts)-Math.min(...counts),base));
  }
  const extraFiles=[{name:'root_freq',bytes:freqText}];
  if(heterogeneous)extraFiles.push({name:'nodes_splits.txt',bytes:createNodesSplits(final,text(tree.bytes),regimeCount)});
  return {regimeCount,heterogeneous,params:lines.join('\n')+'\n',tree:simulationTree(text(tree.bytes)),extraFiles,maxChromosome:max,initialMaxChromosome:Math.max(realMax,Math.min(realMax*10,200)),minimumMaxChromosome:inferredMax,simulations,hasBaseNumber:functions.baseNumR!=='IGNORE'};
}
function checkSimulations(files,job) {
  const byName=new Map(files.map(f=>[f.name,f])),missing=[],touching=[];
  for(let i=0;i<job.simulations;i++) {
    for(const name of ['counts.fasta','simulatedDataAncestors.tree','simulatedEvolutionPaths.txt'])if(!byName.has(i+'/'+name))missing.push(i+'/'+name);
    const events=byName.get(i+'/simulatedEvolutionPaths.txt');
    if(events){const states=[...text(events.bytes).matchAll(/(?:from state:\s*|to state\s*=\s*)(\d+)/g)].map(m=>Number(m[1]));if(states.includes(job.maxChromosome))touching.push(i);}
  }
  return {stage:'simulation-integrity-check',requestedSimulations:job.simulations,maxChromosome:job.maxChromosome,
    filesComplete:!missing.length,missingFiles:missing,boundaryTouchingSimulations:touching,
    boundaryRetryRequired:touching.length>0.01*job.simulations,
    baseNumberModel:job.hasBaseNumber,
    note:'This file reports simulation integrity. See adequacy.json for statistics when checks pass. The base_correction.json and simulation_attempts.json files record correction and retry decisions.'};
}
function setParameter(params,key,value) {
  const expression=new RegExp('^'+key+'\\s*=.*$','gm');
  return expression.test(params)?params.replace(expression,key+' = '+value):params.trimEnd()+'\n'+key+' = '+value+'\n';
}
function baseCorrectionPlan(record,input,job) {
  if(!job.hasBaseNumber)return {required:false,needed:false,complete:true};
  const {parseNewick}=statistics;
  const treeFile=record.files.find(f=>f.name==='MLAncestralReconstruction.tree');
  const tree=parseNewick(text(treeFile.bytes));let largest=0;
  const state=node=>{const m=node.name.match(/-(\d+)$/);if(!m)throw new Error('Cannot read ancestral chromosome count at '+node.name);return Number(m[1]);};
  function visit(node){for(const child of node.children){largest=Math.max(largest,Math.abs(state(node)-state(child)));visit(child);}}
  visit(tree);
  const values=countsVector(input.counts),range=Math.max(...values)-Math.min(...values);
  const bases=[...job.params.matchAll(/^_baseNum_\d+\s*=\s*\d+;([\d.eE+-]+)/gm)].map(m=>Number(m[1]));
  if(!bases.length)throw new Error('Base-number model has no inferred base number.');
  const base=Math.max(...bases);
  const needed=largest<range;
  const maxBaseNumTransition=needed?Math.max(base+1,Math.max(largest,3)):range;
  const plan={required:true,needed,complete:!needed,inferredBaseNumber:base,inferredBaseNumbers:bases,countsRange:range,
    maxTransitionOnTree:largest,maxBaseNumTransition,
    simulationRatePolicy:'initial-fit',
    note:'Matches supplied Python: simulation rates, root frequencies and empirical statistics remain from the initial fit; the second-run maximum-transition setting is passed to simulations.'};
  if(!needed)return plan;
  const get=key=>{const m=job.params.match(new RegExp('^'+key+'\\s*=\\s*(.+)$','m'));if(!m)throw new Error('Missing '+key);return m[1];};
  const settings=[
    '_resultsPathDir = /results','_dataFile = /input/countsFile','_treeFile = /input/TreesFile.txt',
    '_maxChrNum = -10','_minChrNum = '+get('_minChrNum'),'_branchMul = 999',
    '_tolParamOptimization = 0.1','_optimizePointsNum = 1','_optimizeIterNum = 1',
    '_optimizeIterNumNextRounds = 0,1','_optimizePointsNumNextRounds = 2,1','_seed = 1',
    '_optimizationMethod = Brent','_backwardPhase = false','_maxParsimonyBound = true',
    '_baseNumOptimizationMethod = Ranges'
  ];
  for(const line of job.params.split('\n')) {
    if(/^_(baseNumRFunc|duplFunc|demiDuplFunc|gainFunc|lossFunc|numOfModels|maxNumOfModels|minCladeSize|heterogeneousModel|nodeIdsFilePath)\s*=/.test(line)||/^_(baseNumR|baseNum|dupl|gain|loss|demiPloidyR)_\d+\s*=/.test(line))settings.push(line);
  }
  settings.push('_maxBaseNumTransition = '+maxBaseNumTransition,'_useMaxBaseTransitonNumForOpt = true','_simulateData = false');
  plan.job={params:settings.join('\n')+'\n',tree:job.tree,counts:input.counts,extraFiles:job.extraFiles};
  return plan;
}
async function boundedSimulations({job,counts,execute,onAttempt=()=>{},isStopped=()=>false}) {
  const initialMax=job.initialMaxChromosome??job.maxChromosome,minimum=job.minimumMaxChromosome??job.maxChromosome,attempts=[];let result,check,current;
  for(let index=0;index<5;index++) {
    if(isStopped())throw new Error('Stopped');
    current={...job,maxChromosome:Math.max(minimum,initialMax+200*index)};
    current.params=setParameter(job.params,'_maxChrNum',current.maxChromosome);
    result=await execute({...current,simulationCount:job.simulations,counts},index);
    const error=result.error||(result.code!==0?'Exit code '+result.code:null);
    check=checkSimulations(result.files||[],current);
    check.executionError=error;
    check.passed=check.filesComplete&&!error&&!check.boundaryRetryRequired;
    attempts.push({attempt:index+1,...check});
    await onAttempt({index,job:current,result,check});
    if(check.passed||error||isStopped())break;
  }
  return {job:current,result,check,attempts,passed:check.passed&&!isStopped()};
}

return {createNodesSplits,setParameter,baseCorrectionPlan,boundedSimulations,selectModels,prepareSimulation,checkSimulations,simulationTree};

});
