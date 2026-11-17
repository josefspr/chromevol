/* Discrete-trait input and native parameter generation, shared by browser and Node. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./chromevol-validation.js'));
  else root.ChromevolTrait=factory(root.ChromevolValidation);
})(typeof globalThis!=='undefined'?globalThis:this,function(validation){
'use strict';
const fields=['numTraitStates','piParams','traitModel','global_rate','entry_rates','exit_rates','symPair_rates','pairRate_rates','rootFrequencies','fixedRootValue'];
function validate(tree,text,settings){
  const n=Number(settings.numTraitStates);
  if(!Number.isInteger(n)||n<2)throw new Error('Number of trait states must be an integer of at least 2.');
  const records=new Map();let name;
  for(const raw of String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/)){
    const line=raw.trim();if(!line)continue;
    if(line.startsWith('>')){
      if(name!==undefined&&!records.has(name))throw new Error('Missing trait state for '+name+'.');
      name=line.slice(1).trim();
      if(!name||records.has(name))throw new Error('Empty or duplicate taxon in trait file: '+name);
    }else{
      if(name===undefined||records.has(name)||!/^\d+$/.test(line)||Number(line)>=n)throw new Error('Trait file must contain one integer state from 0 to '+(n-1)+' per taxon.');
      records.set(name,Number(line));
    }
  }
  if(name!==undefined&&!records.has(name))throw new Error('Missing trait state for '+name+'.');
  const tips=[];function visit(node){if(node.children.length)node.children.forEach(visit);else tips.push(node.name);}
  visit(validation.validate_tree(tree).tree);
  const missing=tips.filter(t=>!records.has(t));
  if(missing.length)throw new Error('Trait file is missing tree taxa: '+missing.join(', '));
  const observed=new Set(tips.map(t=>records.get(t)));
  if(observed.size!==n)throw new Error('Every specified trait state must occur in the matched tree.');
  const values=(value,count,label)=>{
    const a=String(value??'').split(',').map(s=>s.trim());
    if(a.length!==count||a.some(s=>!s||!Number.isFinite(Number(s))||Number(s)<0))throw new Error(label+' requires '+count+' nonnegative numbers separated by commas.');
    return a.map(Number);
  };
  const pi=values(settings.piParams,n,'Pi parameters');
  if(Math.abs(pi.reduce((a,b)=>a+b,0)-1)>1e-8)throw new Error('Pi parameters must sum to 1.');
  const lines=['_traitFilePath = /input/traitFile','_traitStateModel = '+settings.traitModel,'_numberOfTraitStates = '+n,...pi.map((v,i)=>'_pi'+i+' = '+v)];
  const add=(key,value)=>lines.push(key+' = '+value);
  switch(settings.traitModel){
    case 'singleRate':add('_global_rate',values(settings.global_rate,1,'Global rate')[0]);break;
    case 'ratePerEntry':case 'ratePerExit':{
      const entry=settings.traitModel==='ratePerEntry',key=entry?'entry':'exit';
      values(settings[key+'_rates'],n,key+' rates').forEach((v,i)=>add('_'+key+'_rate_'+i,v));break;
    }
    case 'symPairRate':case 'pairRateModel':{
      const symmetric=settings.traitModel==='symPairRate',source=symmetric?settings.symPair_rates:settings.pairRate_rates;
      const rates=new Map();
      for(const item of String(source||'').split(',')){
        const m=item.trim().match(/^_rate_(\d+)_(\d+)\s*=\s*(\S+)$/);
        if(!m)throw new Error('Pair rates must use _rate_i_j=value, separated by commas.');
        let i=Number(m[1]),j=Number(m[2]);const v=Number(m[3]);
        if(i>=n||j>=n||i===j||!Number.isFinite(v)||v<0)throw new Error('Invalid trait pair rate: '+item);
        if(symmetric&&i>j)[i,j]=[j,i];
        const key='_rate_'+i+'_'+j;
        if(rates.has(key))throw new Error('Duplicate trait pair rate: '+key);
        rates.set(key,v);
      }
      if(rates.size!==(symmetric?n*(n-1)/2:n*(n-1)))throw new Error('Provide a rate for every '+(symmetric?'unordered':'ordered')+' pair of trait states.');
      rates.forEach((v,k)=>add(k,v));break;
    }
    default:throw new Error('Unknown trait transition model: '+settings.traitModel);
  }
  const root=settings.rootFrequencies||'stationaryTraitRootFreqs';
  if(!['stationaryTraitRootFreqs','weightedTraitRootFreqs','fixedRootTraitState'].includes(root))throw new Error('Unknown trait root frequency setting: '+root);
  if(!['stationaryTraitRootFreqs','weightedTraitRootFreqs','fixedRootTraitState'].includes(root))throw new Error('Unknown trait root frequency option.');
  add('_weightedTraitRootFreqs',root==='weightedTraitRootFreqs');
  add('_fixedTraitRootFreqs',root==='fixedRootTraitState');
  if(root==='fixedRootTraitState'){
    const value=String(settings.fixedRootValue??'').trim();
    if(!/^\d+$/.test(value)||Number(value)>=n)throw new Error('Fixed trait root value must be from 0 to '+(n-1)+'.');
    add('_fixedRootTraitState',Number(value));
  }
  add('_runOnlyJointModel',false);
  return {text:tips.map(t=>'>'+t+'\n'+records.get(t)).join('\n')+'\n',lines,removedTaxa:[...records.keys()].filter(t=>!tips.includes(t))};
}
function configure(model,checked){
  return {...model,params:model.params.replace(/^_traitFilePath\s*=.*$/gm,'')+'\n'+checked.lines.join('\n')+'\n',extraFiles:[...(model.extraFiles||[]),{name:'traitFile',bytes:checked.text}]};
}
return {fields,validate,configure};
});
