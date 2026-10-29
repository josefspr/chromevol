/* Input checks based on validate_tree / validate_counts in the supplied Python pipeline. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ChromevolValidation=factory();})(globalThis,function(){
'use strict';
const normalize=text=>String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
function validate_filename(name){
  if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw new Error('Invalid filename "'+name+'". Use only a-z, A-Z, 0-9, underscore (_), dot (.) and hyphen (-).');
  return name;
}
function validate_tree(text){
  let src=normalize(text).trimEnd();
  if(!src.trim())throw new Error('Tree file is empty.');
  if(/['’"“”]/.test(src))throw new Error('Tree file contains quotes.');
  if(!src.endsWith(';'))src+=';';
  let p=0,leafCount=0;
  const fail=()=>{throw new Error('Error in format of tree file: invalid Newick near character '+(p+1)+'.');};
  function space(){
    while(p<src.length){
      if(/\s/.test(src[p])){p++;continue;}
      if(src[p]==='['){let depth=0;do{if(src[p]==='[')depth++;if(src[p]===']')depth--;p++;}while(depth&&p<src.length);if(depth)fail();continue;}
      break;
    }
  }
  function label(){space();const start=p;while(p<src.length&&!/[(),:;\[\]]/.test(src[p]))p++;return src.slice(start,p).trim();}
  function node(){
    space();let internal=false;const children=[];
    if(src[p]==='('){internal=true;p++;children.push(node());space();while(src[p]===','){p++;children.push(node());space();}if(src[p]!==')')fail();p++;}
    const name=label();if(!internal){if(!name)fail();leafCount++;}
    space();let length=null;
    if(src[p]===':'){
      p++;space();const m=src.slice(p).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
      if(!m||!Number.isFinite(Number(m[0])))fail();length=Number(m[0]);p+=m[0].length;space();
    }
    return {name,length,children};
  }
  const tree=node();space();if(src[p]!==';')fail();p++;space();if(p!==src.length)fail();
  if(leafCount<5)throw new Error('Error in format of tree file: at least 5 tips are required.');
  return {text:src,leafCount,tree};
}
function validate_counts(text){
  const src=normalize(text),lines=src.split('\n');let expectName=true,recordCount=0,isDistribute=false;
  const fail=(line,reason)=>{throw new Error('Error in format of counts file at line '+line+': '+reason);};
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();if(!line)continue;
    if(expectName){
      if(!line.startsWith('>'))fail(i+1,'expected a FASTA header beginning with >.');
      if(!line.slice(1).trim())fail(i+1,'species name is empty.');
      recordCount++;expectName=false;
    }else{
      if(!/^\d+$/.test(line)&&!/^x$/i.test(line)){
        if(!line.split('_').every(value=>/^[1-9][0-9]*=(?:[0-9]*[.])?[0-9]+$/.test(value)))fail(i+1,'expected an integer, X, or a distribution such as 6=0.5_7=0.5.');
        isDistribute=true;
      }
      expectName=true;
    }
  }
  if(!expectName)throw new Error('Error in format of counts file: the last species has no count.');
  if(recordCount<5)throw new Error('Error in format of counts file: at least 5 count records are required.');
  return {text:src,isDistribute,recordCount};
}
return {validate_filename,validate_tree,validate_counts};
});
