/* Browser orchestration around the same adequacy calculations used by Node. */
(function(root){
'use strict';
const A=root.ChromevolAdequacy,S=root.ChromevolStatistics,C=root.SincopaCore;
async function run(record,input,{execute,simulations=1000,onStatus=()=>{},isStopped=()=>false}){
  const name=C.fitName(record),safe=String(record.modelName).replace(/[^a-zA-Z0-9._=-]/g,'_');
  const folder='adequacy/'+(Number(record.id)+1)+'_'+safe+'/',entries=[];
  const add=(name,content)=>entries.push({name:folder+name,content});
  try{
    let job=A.prepareSimulation(record,input,{simulations});
    const plan=A.baseCorrectionPlan(record,input,job);
    if(plan.required){
      if(plan.needed){
        onStatus('Base-number correction: '+name);
        add('base_correction/second_run.params',plan.job.params);
        const refit=await execute(plan.job,'MA correction '+name);
        for(const f of refit.files||[])add('base_correction/'+f.name,f.bytes);
        if(refit.error||refit.code!==0)throw new Error('Base-number correction failed: '+(refit.error||refit.code));
        const corrected=C.parseRun(record,refit.files||[]);
        if(!corrected.parsed||corrected.summaryError)throw new Error('Base-number correction did not produce a readable final model.');
        const res=refit.files.find(f=>f.name==='chromEvol.res');
        const max=Number(C.textOf(res.bytes).match(/Max allowed chromosome number\s*=\s*(\d+)/)?.[1]);
        if(Number.isFinite(max)){job.maxChromosome=Math.max(job.maxChromosome,max);job.minimumMaxChromosome=max;}
        plan.complete=true;
      }
      job.params=A.setParameter(job.params,'_maxBaseNumTransition',plan.maxBaseNumTransition);
    }
    const {job:unused,...report}=plan;
    add('base_correction.json',JSON.stringify(report,null,2)+'\n');
    add('tree_wo_counts.tree',job.tree);
    for(const f of job.extraFiles)add(f.name,f.bytes);
    const result=await A.boundedSimulations({job,counts:input.counts,isStopped,
      execute:async(attempt,index)=>{
        onStatus('Adequacy: '+name+' — '+simulations+' simulations, attempt '+(index+1));
        return execute(attempt,'MA '+name);
      },onAttempt:({index,job:attempt,result})=>{
        add('attempts/'+(index+1)+'/param_sim.txt',attempt.params);
        for(const f of result.files||[])add('attempts/'+(index+1)+'/simulations/'+f.name,f.bytes);
      }});
    add('param_sim.txt',result.job.params);
    add('simulation_attempts.json',JSON.stringify(result.attempts,null,2)+'\n');
    add('simulation_check.json',JSON.stringify(result.check,null,2)+'\n');
    for(const f of result.result.files||[])add('simulations/'+f.name,f.bytes);
    if(!result.passed)throw new Error(result.check.executionError||'Simulation integrity checks failed; see simulation_check.json.');
    if(isStopped())throw new Error('Stopped');
    onStatus('Calculating adequacy statistics: '+name);
    const tree=record.files.find(f=>f.name==='MLAncestralReconstruction.tree');
    const batch=S.calculateBatch({counts:input.counts,tree:C.textOf(tree.bytes),files:result.result.files,
      simulations,hasBaseNumber:job.hasBaseNumber,baseCorrectionComplete:plan.complete});
    batch.baseCorrection=report;
    batch.fittedModel={name,regimes:job.regimeCount,heterogeneous:job.heterogeneous,
      scope:'Complete selected fit, including every regime; not an independent test of each regime.'};
    if(!batch.provisional)batch.stage=job.heterogeneous?'heterogeneous-model-adequacy':'homogeneous-model-adequacy';
    for(const f of S.batchFiles(batch))add(f.name,f.content);
    return {batch,entries};
  }catch(error){
    add('adequacy_error.json',JSON.stringify({stage:'model-adequacy',passed:false,error:error.message},null,2)+'\n');
    return {error:error.message,entries};
  }
}
function options(input){
  if(input?.adequacy)return input.adequacy;
  const p=C.readParameters(input?.params||'');
  return {enabled:p.AdeqTest==='YES',mode:p.MA_AdequacyTest==='MA_AdequacyTest_user'?'selected':'best',
    selectedName:p.MA_userModelSelect||'',simulations:Number(p.adequacySimulations||1000)};
}
function render(container,records){
  container.replaceChildren();
  const tested=records.filter(r=>r.adequacy||r.adequacyError);
  container.hidden=!tested.length;if(!tested.length)return;
  const element=(tag,value)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=value;return e;};
  const details=element('details');details.className='adequacyResults';
  details.append(element('summary','Model adequacy results'));
  details.append(element('p','Numbers denote two-sided midpoint P-values'));
  const scroll=element('div');scroll.className='scroll';
  const table=element('table');table.setAttribute('aria-label','Model adequacy midpoint P-values');
  const head=element('thead'),header=element('tr');header.append(element('th','Statistic / Model'));
  for(const record of tested)header.append(element('th',record.adequacy?.fittedModel?.name||C.fitName(record)));
  head.append(header);table.append(head);
  const body=element('tbody');
  for(const [key,label] of [['Variance','Variance'],['Entropy','Entropy'],['Parsimony','Parsimony'],['Time_parsimony','Parsimony vs. time']]){
    const row=element('tr');row.append(element('td',label));
    for(const record of tested){
      const test=record.adequacy?.tests?.find(t=>t.statistic===key),p=test?.pValue;
      const valid=typeof p==='number'&&Number.isFinite(p);
      const cell=element('td',valid?p.toFixed(2):'—');
      cell.className=valid?(p<=0.05?'pvInadequate':'pvAdequate'):'';
      cell.title=valid?'P = '+p+(p<=0.05?' (inadequate at 0.05)':' (adequate at 0.05)'):(record.adequacyError||'Not available');
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body);scroll.append(table);details.append(scroll);
  for(const record of tested){
    const name=record.adequacy?.fittedModel?.name||C.fitName(record);
    if(record.adequacy?.provisional)details.append(element('p',name+': diagnostic only ('+record.adequacy.simulations+' simulations). Use 1000 simulations for the full test.'));
    if(record.adequacyError)details.append(element('p',name+': adequacy failed — '+record.adequacyError));
  }
  container.append(details);
}
root.ChromevolAdequacyBrowser={run,options,render};
})(globalThis);
