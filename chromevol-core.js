/* Shared chromEvol parameter, summary and export helpers. No DOM or filesystem access.
 * Node.js: const core = require('./chromevol-core.js');
 * Browser: <script src="chromevol-core.js"></script> exposes SincopaCore.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SincopaCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';
const normalizeText = text => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
function portableParams(text) {
  const inputFields = new Set(['_treesFile','_treeFile','_dataFile','TreesDirArr',
    'TreeFile','CountsFile','TreeFile_txt','CountsFile_txt']);
  return normalizeText(text).split('\n').filter(line => {
    const separator = line.indexOf(':');
    return separator < 0 || !inputFields.has(line.slice(0, separator).trim());
  }).join('\n');
}
function readParameters(text) { return readDefaults(normalizeText(text)); }
function prepareRun({tree, counts, params, template, defaultsText}) {
  tree = normalizeText(tree); counts = normalizeText(counts);
  const settings = readParameters(params);
  const defaults = readDefaults(normalizeText(defaultsText));
  const options = {
    analysisType: settings.analysisType || 'Homogenous',
    maxRateRegimes: settings.maxRateRegimes || '1',
    minCladeSize: settings.minCladeSize || '5'
  };
  let definedModels = JSON.parse(settings.definedModels);
  if (options.analysisType === 'TimeHeterogeneous') definedModels = [{...definedModels[0], name:'Background'}];
  const nativeFiles = definedModels.map((model,id) => ({
    id, modelName:model.name, filename:'param_'+model.name+'.txt',
    params:fixPaths(createParams(template,model,counts,defaults,options))
  }));
  return {tree,counts,params,definedModels,nativeFiles,...options};
}
function createParams(template, model, countsText, defaults, options = {
  analysisType: 'Homogenous', maxRateRegimes: '1', minCladeSize: '5'
}) {
  template = template.replace(/\r\n?/g, "\n");
  // find_MinMax(..., 4): only integer FASTA counts >= 4 determine base number.
  const counts = Object.values(Object.fromEntries(
    countsText.split('>').slice(1).map(record => {
      const lines = record.trim().split(/\r?\n/).filter(line => line.trim());
      return [lines[0], lines[1].trim()];
    })
  )).filter(value => /^\d+$/.test(value) && Number(value) >= 4).map(Number);
  const baseNumber = Math.min(...counts);
  // Match the current server behavior when _fixRoot is read as text.
  const fixRoot = Number(defaults._fixRoot);
  const maxChrNum = Math.max(...counts) > fixRoot ? -10 : fixRoot + 1;
  const replacements = {
    '<OUT_DIR>': '/input/ChromEvol_Tree_1/' + model.name,
    '<CNT_FILE>': '/input/countsFile',
    '<TREE_FILE>': '/input/TreesFile.txt',
    '<MAX_CHR_NUM>': String(maxChrNum),
    '<MIN_CHR_NUM>': '-1',
    '<MIN_CLADE_SIZE>': String(options.minCladeSize),
    '<IS_HETEROGENEOUS>': String(options.analysisType === 'TimeHeterogeneous'),
    '<MAX_NUM_MODELS>': options.analysisType === 'TimeHeterogeneous' ? String(options.maxRateRegimes) : '1'
  };
  for (const [key, value] of Object.entries(replacements)) {
    template = template.split(key).join(value);
  }
  const functions = {
    _baseNumberR: '_baseNumRFunc', _gainConstR: '_gainFunc',
    _lossConstR: '_lossFunc', _duplConstR: '_duplFunc',
    _demiPloidyR: '_demiDuplFunc'
  };
  const parameters = {
    _baseNumberR: '_baseNumR', _gainConstR: '_gain',
    _lossConstR: '_loss', _duplConstR: '_dupl', _demiPloidyR: '_demiPloidyR'
  };
  const values = {
    CONST: '1', LINEAR: '2,0.1', LINEAR_BD: '1', EXP: '2,0.1',
    LOGNORMAL: '8,0.17,0.11', REVERSE_SIGMOID: '8,0.17,0.11'
  };
  const lines = [], assigned = {};
  let index = 1;
  // Object.entries preserves the model JSON order, as Python does.
  for (const [transition, func] of Object.entries(model)) {
    if (transition === 'name') continue;
    if (func === 'IGNORE') {
      lines.push(functions[transition] + ' = IGNORE');
    } else if (Object.hasOwn(values, func)) {
      assigned[transition] = index++ + ';' + values[func];
      lines.push(functions[transition] + ' = ' + func,
        parameters[transition] + '_1 = ' + assigned[transition]);
      if (transition === '_baseNumberR') {
        lines.push('_baseNum_1 = ' + index++ + ';' + baseNumber);
      }
    }
  }
  // Shared rates reuse their source parameter index and initial values.
  for (const [transition, source] of Object.entries(model)) {
    if (transition !== 'name' && Object.hasOwn(assigned, source)) {
      lines.push(functions[transition] + ' = ' + model[source],
        parameters[transition] + '_1 = ' + assigned[source]);
    }
  }
  return template + (template.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n';
}

function readDefaults(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const separator = line.indexOf(':');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
}
function createWrapperParams(definedModels, defaults, options = {analysisType: 'Homogenous', maxRateRegimes: '1', minCladeSize: '5'}) {
  const settings = {...defaults,
    analysisType: options.analysisType, transitionPoints: 'Automatic',
    maxRateRegimes: options.analysisType === 'TimeHeterogeneous' ? String(options.maxRateRegimes) : '1',
    minCladeSize: String(options.minCladeSize), NumberOfTrees: '1',
    AdeqTest: 'NO',
    definedModels: JSON.stringify(definedModels),
    _outDir: '/input/chromevol_out', _name: 'browser_run', _cpusNum: '1'
  };
  return portableParams(Object.entries(settings).map(([key,value]) => key + ':' + value).join('\n') + '\n');
}

function fixPaths(text) {
  text = text.replace(/\r\n?/g, "\n");
  const paths = {
    _treeFile: '/input/TreesFile.txt',
    _dataFile: '/input/countsFile',
    _resultsPathDir: '/results'
  };
  for (const [key, value] of Object.entries(paths)) {
    const pattern = new RegExp('^[ \t]*' + key + '[ \t]*=[^\\n]*$', 'gm');
    if (pattern.test(text)) text = text.replace(pattern, key + ' = ' + value);
    else text += '\n' + key + ' = ' + value + '\n';
  }
  return text;
}
// Parse only the chosen final model, excluding earlier forward-phase models.
function summarizeResults(text) {
  let finalSection = false;
  const result = {regimeCount:1, regimes:[], aicc:null};
  const functions = {}, values = {}, roots = {};
  for (const raw of text.replace(/\r\n?/g,'\n').split('\n')) {
    const line = raw.trim();
    const func = line.match(/^(baseNumR|dupl|gain|demi|loss):\s*(\w+)/);
    if (func && !finalSection) functions[func[1]] = func[2];
    if (line.includes('Previous best chosen models in the forward phase')) break;
    if (line.includes('Best chosen model') || line.includes('Final model parameters are:')) finalSection = true;
    if (!finalSection) continue;
    const count = line.match(/^Number of models in the best model\s*=\s*(\d+)/);
    if (count) result.regimeCount = Number(count[1]);
    const root = line.match(/^#?\s*Model\s*\$?(\d+)\s*=\s*(.+)$/);
    if (root) roots[root[1]] = root[2];
    const aic = line.match(/^AICc of the best model(?: with (\d+) shifts)?\s*=\s*([+\-\d.eE]+)\s*$/);
    if (aic && (aic[1] === undefined || Number(aic[1])+1 === result.regimeCount)) {
      const number = Number(aic[2]); if (Number.isFinite(number)) result.aicc = number;
    }
    if (line.startsWith('#')) continue;
    const rate = line.match(/^Chromosome\.(baseNumR|dupl|gain|demi|loss)(\d+)_(\d+)\s*=\s*([+\-\d.eE]+)\s*$/);
    if (rate) {
      const regime = values[rate[3]] ||= {};
      (regime[rate[1]] ||= {})[rate[2]] = rate[4];
    }
    const base = line.match(/^Chromosome\.baseNum_(\d+)\s*=\s*([+\-\d.eE]+)\s*$/);
    if (base) (values[base[1]] ||= {}).baseNum = base[2];
  }
  if (!Object.keys(values).length) throw new Error('No final model parameters found in chromEvol.res.');
  result.regimeCount = Math.max(result.regimeCount,...Object.keys(values).map(Number));
  for (let index=1;index<=result.regimeCount;index++) {
    const regime = values[index] || {};
    function rateValue(key) {
      const coefficients = regime[key];
      if (!coefficients || coefficients[0] === undefined) return '-';
      const func = functions[key];
      if ((key==='gain'||key==='loss') && coefficients[1] !== undefined) {
        const slope=Number(coefficients[1]).toFixed(2),intercept=Number(coefficients[0]).toFixed(2);
        return 'LINEAR:' + slope + 'x' + (intercept==='0.00'?'':' + '+intercept);
      }
      // Retain every coefficient for nonconstant functions rather than dropping it.
      const formatted = Object.keys(coefficients).sort((a,b)=>Number(a)-Number(b))
        .map(key=>Number(coefficients[key]).toFixed(2)).join(', ');
      return func && func!=='IGNORE' ? func+':'+formatted : formatted;
    }
    result.regimes.push({index, name:index===1?'Background':'Shift '+(index-1), root:roots[index]||'-',
      rows:[rateValue('baseNumR'),rateValue('dupl'),rateValue('gain'),rateValue('demi'),rateValue('loss'),regime.baseNum??'-']});
  }
  result.isHeterogeneous = /The inferred model was set to be\s*:\s*heterogeneous/i.test(text) || result.regimeCount > 1;
  result.selectedShiftCount = result.regimeCount - 1;
  result.shiftModels = [];
  if (result.isHeterogeneous) {
    const scores = new Map();
    // Read only candidate scores from the history; rates above remain from the selected fit.
    for (const match of text.matchAll(/AICc of the best model with (\d+) shifts?\s*=\s*([+\-\d.eE]+)/g)) {
      const value = Number(match[2]);
      if (Number.isFinite(value)) scores.set(Number(match[1]), value);
    }
    if (result.aicc !== null) scores.set(result.selectedShiftCount, result.aicc);
    const minimum = scores.size ? Math.min(...scores.values()) : null;
    result.shiftModels = [...scores].map(([shifts,aicc]) => ({
      shifts, name:shifts === 0 ? 'Background (no shifts)' : shifts + '-shift',
      aicc, deltaAicc:aicc-minimum, selected:shifts === result.selectedShiftCount
    })).sort((a,b)=>a.deltaAicc-b.deltaAicc || a.shifts-b.shifts);
  }
  return result;
}

function convert_to_PhyD3(newick, countsText) {
  const counts = new Map();
  let taxon;
  for (const raw of countsText.split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('>')) taxon = line.slice(1).trim();
    else if (taxon !== undefined) counts.set(taxon, line);
  }
  const text = newick.trim();
  let position = 0;
  function whitespace() { while (/\s/.test(text[position] || '') && position < text.length) position++; }
  function label() {
    whitespace();
    if (text[position] === "'") {
      position++;
      let value = '';
      while (position < text.length) {
        const character = text[position++];
        if (character === "'") {
          if (text[position] === "'") { value += "'"; position++; }
          else return value;
        } else value += character;
      }
      throw new Error('Unclosed quoted Newick label.');
    }
    const start = position;
    while (position < text.length && !/[\s(),:;\[\]]/.test(text[position])) position++;
    return text.slice(start, position);
  }
  function comment() {
    position++;
    let depth = 1, value = '';
    while (position < text.length && depth) {
      const character = text[position++];
      if (character === '[') depth++;
      if (character === ']') depth--;
      if (depth) value += character;
    }
    if (depth) throw new Error('Unclosed Newick comment.');
    return value.trim();
  }
  function subtree() {
    whitespace();
    const node = {name: '', children: []};
    if (text[position] === '(') {
      position++;
      node.children.push(subtree());
      whitespace();
      while (text[position] === ',') { position++; node.children.push(subtree()); whitespace(); }
      if (text[position++] !== ')') throw new Error('Missing Newick closing parenthesis.');
    }
    node.name = label();
    while (position < text.length) {
      whitespace();
      if (text[position] === '[') {
        const annotation = comment();
        // chromEvol can put ancestral node names in bracket comments.
        if (!node.name && /^N\d+(?:-\d+)?$/.test(annotation)) node.name = annotation;
      } else if (text[position] === ':') {
        position++;
        whitespace();
        const match = text.slice(position).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
        if (!match) throw new Error('Invalid Newick branch length.');
        node.length = match[0];
        position += match[0].length;
      } else break;
    }
    return node;
  }
  const root = subtree();
  whitespace();
  if (text[position] === ';') position++;
  whitespace();
  if (position !== text.length) throw new Error('Unexpected content after the Newick tree.');
  function xml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    })[character]);
  }
  function clade(node, depth) {
    const indent = '  '.repeat(depth);
    const lines = [indent + '<clade>'];
    if (node.name) {
      // Remove only chromEvol's numeric count suffix, preserving taxon hyphens.
      const name = counts.has(node.name) ? node.name : node.name.replace(/-\d+$/, '');
      lines.push(indent + '  <name>' + xml(name) + '</name>');
      lines.push(indent + '  <chrom>' + xml(counts.get(name) ?? ' - ') + '</chrom>');
    }
    if (node.length !== undefined) lines.push(indent + '  <branch_length>' + node.length + '</branch_length>');
    for (const child of node.children) lines.push(clade(child, depth + 1));
    lines.push(indent + '</clade>');
    return lines.join('\n');
  }
  // labels/chrom are the PhyD3 extensions used by the original Python function.
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<phyloxml xmlns="http://www.phyloxml.org">\n' +
    '  <phylogeny rooted="false">\n' +
    '    <labels>\n' +
    '      <label type="text"><name show="1">Chromosome Count</name><data tag="chrom"/></label>\n' +
    '      <label type="color"><name>Color label</name><data tag="colortag"/></label>\n' +
    '    </labels>\n' + clade(root, 2) + '\n' +
    '  </phylogeny>\n</phyloxml>\n';
}
function formatDefinedModels(models) {
  const rates = [
    ['_lossConstR', 'Descending dysploidy rate'],
    ['_gainConstR', 'Ascending dysploidy rate'],
    ['_baseNumberR', 'Base (monoploid) number addition rate'],
    ['_duplConstR', 'Duplication rate'],
    ['_demiPloidyR', 'Duplication by 1.5 rate']
  ];
  return models.map(model => model.name + ': ' + rates
    .filter(([key]) => model[key] !== undefined && model[key] !== 'IGNORE')
    .map(([key, label]) => label + ' = ' + model[key]).join(', ')).join('\n') + (models.length ? '\n' : '');
}
function textOf(bytes) {
  return typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
}

function parseRun(model, files, error) {
  const record = {...model, files, error, summaryError:null, aicc:null, parsed:null};
  const res = files.find(file => file.name === 'chromEvol.res');
  if (res) {
    try {
      record.parsed = summarizeResults(textOf(res.bytes));
      if (!error) record.aicc = record.parsed.aicc;
    } catch (parseError) {
      record.summaryError = parseError.message;
    }
  }
  return record;
}
function orderedResults(results) {
  return [...results].sort((a,b) =>
    (a.aicc ?? Infinity) - (b.aicc ?? Infinity) || a.id - b.id);
}

function makeZip(entries) {
  const encoder = new TextEncoder(), chunks = [], directory = [];
  let offset = 0;
  const crcTable = Array.from({length:256}, (_,n) => {
    for(let i=0;i<8;i++) n=(n>>>1)^((n&1)?0xedb88320:0);
    return n>>>0;
  });
  const header = size => {const bytes=new Uint8Array(size);return [bytes,new DataView(bytes.buffer)];};
  for(const entry of entries) {
    const name=encoder.encode(entry.name);
    const data=typeof entry.content==='string'?encoder.encode(entry.content):new Uint8Array(entry.content);
    let crc=0xffffffff;
    for(const byte of data)crc=(crc>>>8)^crcTable[(crc^byte)&255];
    crc=(crc^0xffffffff)>>>0;
    const [local,v]=header(30);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);
    v.setUint16(12,33,true);v.setUint32(14,crc,true);
    v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);
    chunks.push(local,name,data);
    const [central,c]=header(46);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);
    c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);
    c.setUint16(28,name.length,true);c.setUint32(42,offset,true);
    directory.push(central,name);offset+=30+name.length+data.length;
  }
  const dirSize=directory.reduce((sum,part)=>sum+part.length,0);
  const [end,e]=header(22);e.setUint32(0,0x06054b50,true);
  e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);
  e.setUint32(12,dirSize,true);e.setUint32(16,offset,true);
  return new Blob([...chunks,...directory,end],{type:'application/zip'});
}
function fitName(record) {
  if (!record.parsed?.isHeterogeneous) return record.modelName;
  return record.parsed.selectedShiftCount ? record.parsed.selectedShiftCount + '-shift' : 'Background (no shifts)';
}
function summaryCSV(results) {
  const sorted=orderedResults(results), best=sorted.find(r=>r.aicc!==null)?.aicc;
  const columns=sorted.flatMap(record=>(record.parsed?.regimes||[{name:'Unavailable',root:'-',rows:[]}]).map(regime=>({record,regime})));
  const rows=[['Parameter',...columns.map(({record})=>fitName(record))]];
  if(sorted.some(r=>(r.parsed?.regimes.length||1)>1)) {
    rows.push(['Regime',...columns.map(({regime})=>regime.name)]);
    rows.push(['Regime root node',...columns.map(({regime})=>regime.root)]);
  }
  ['Base (monoploid) number addition','Duplication','Ascending dysploidy','Duplication by 1.5','Descending dysploidy','Base (monoploid) number'].forEach((label,index)=>{
    rows.push([label,...columns.map(({regime})=>regime.rows[index]??'-')]);
  });
  if (!sorted.some(record=>record.parsed?.isHeterogeneous)) {
    rows.push(['ΔAIC from best model',...columns.map(({record})=>record.aicc===null?'-':(record.aicc-best).toFixed(4))]);
  }
  for (const record of sorted.filter(record=>record.parsed?.isHeterogeneous)) {
    rows.push([],['Shift-model comparison',record.modelName],['Model','Number of shifts','ΔAIC from best model','Selected fit']);
    for (const candidate of record.parsed.shiftModels) rows.push([candidate.name,candidate.shifts,candidate.deltaAicc.toFixed(4),candidate.selected?'yes':'no']);
  }
  return '\uFEFF'+rows.map(row=>row.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';
}
function exportEntries({input, nativeFiles = input.nativeFiles || [], results, log = ''}) {
  const modelLine=(input.params||'').split(/\r?\n/).find(line=>line.startsWith('definedModels:'));
  const models=input.definedModels||(modelLine?JSON.parse(modelLine.slice('definedModels:'.length)):[]);
  const entries=[
    {name:'input/countsFile',content:input.counts},
    {name:'input/TreesFile.txt',content:input.tree},
    {name:'input/defined_models.txt',content:formatDefinedModels(models)},
    {name:'params.txt',content:portableParams(input.params)},
    {name:'summary.csv',content:summaryCSV(results)},
    {name:'run.log',content:log}
  ];
  const safe=name=>String(name).replace(/[^a-zA-Z0-9._=-]/g,'_').replace(/^\.+$/,'model')||'model';
  for(const model of nativeFiles) entries.push({name:'parameters/'+(Number(model.id)+1)+'_'+safe(model.filename),content:fixPaths(model.params)});
  for(const record of orderedResults(results)) {
    const folder='models/'+(Number(record.id)+1)+'_'+safe(record.modelName)+'/';
    for(const file of record.files)entries.push({name:folder+safe(file.name),content:file.bytes});
    let xml=record.phyloXML;
    if(!xml) {
      const tree=record.files.find(file=>file.name==='MLAncestralReconstruction.tree');
      if(tree)xml=convert_to_PhyD3(textOf(tree.bytes),input.counts);
    }
    if(xml&&!record.files.some(file=>file.name==='MLAncestralReconstruction_phylo.xml'))entries.push({name:folder+'MLAncestralReconstruction_phylo.xml',content:xml});
    if(record.error||record.summaryError)entries.push({name:folder+'run-status.txt',content:[record.error,record.summaryError].filter(Boolean).join('\n')});
  }
  return entries;
}

return Object.freeze({normalizeText,portableParams,readDefaults,readParameters,createParams,createWrapperParams,
  prepareRun,fixPaths,summarizeResults,convert_to_PhyD3,formatDefinedModels,textOf,
  parseRun,orderedResults,fitName,summaryCSV,exportEntries,makeZip});
});
