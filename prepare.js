// The six default models from the supplied index.html.
const definitions = [
  ['DysBnum', 'CONST', 'IGNORE', 'IGNORE'],
  ['DysBnumDup', 'CONST', 'CONST', 'IGNORE'],
  ['DysDup', 'IGNORE', 'CONST', 'IGNORE'],
  ['DysDupDem=', 'IGNORE', 'CONST', '_duplConstR'],
  ['DysDupDem', 'IGNORE', 'CONST', 'CONST'],
  ['Dys', 'IGNORE', 'IGNORE', 'IGNORE']
];
const models = definitions.map(([name, base, duplication, demi]) => ({
  name, _baseNumberR: base, _duplConstR: duplication,
  _gainConstR: 'CONST', _lossConstR: 'CONST', _demiPloidyR: demi
}));
document.getElementById('models').value = JSON.stringify(models, null, 2);

// Homogeneous native parameter generation, once for every defined model.
function readAnalysisOptions() {
  return {
    analysisType: document.querySelector('input[name="analysisType"]:checked').value,
    maxRateRegimes: document.getElementById('maxRateRegimes').value,
    minCladeSize: document.getElementById('minCladeSize').value
  };
}
function updateAnalysisOptions() {
  const heterogeneous = readAnalysisOptions().analysisType === 'TimeHeterogeneous';
  const fields = document.getElementById('transitionOptions');
  fields.hidden = !heterogeneous;
  fields.disabled = !heterogeneous;
}
document.querySelectorAll('input[name="analysisType"]').forEach(radio => {
  radio.addEventListener('change', updateAnalysisOptions);
});
updateAnalysisOptions();

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
    TreesDirArr: '/input/ChromEvol_Tree_1,', AdeqTest: 'NO',
    definedModels: JSON.stringify(definedModels),
    _treesFile: '/input/TreesFile.txt', _dataFile: '/input/countsFile',
    _outDir: '/input/chromevol_out', _name: 'browser_run', _cpusNum: '1'
  };
  return Object.entries(settings).map(([key,value]) => key + ':' + value).join('\n') + '\n';
}
async function loadText(filename) {
  const response = await fetch(filename, {cache: 'no-store'});
  if (!response.ok) throw new Error('Could not load ' + filename + ' (HTTP ' + response.status + ')');
  return response.text();
}
document.getElementById('inputForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const [tree, counts, template, defaultsText] = await Promise.all([
      document.getElementById('tree').files[0].text(),
      document.getElementById('counts').files[0].text(),
      loadText('param_NEW_MODELS_anat.txt'), loadText('DEFAULT_PARAM_VALUES.txt')
    ]);
    const defaults = readDefaults(defaultsText);
    const options = readAnalysisOptions();
    const definedModels = JSON.parse(document.getElementById('models').value);
    const nativeFiles = definedModels.map((model, index) => ({
      id: index, modelName: model.name, filename: 'param_' + model.name + '.txt',
      params: createParams(template, model, counts, defaults, options)
    }));
    sessionStorage.setItem('sincopaInput', JSON.stringify({
      tree, counts, ...options, params: createWrapperParams(definedModels, defaults, options), nativeFiles,
      nativeParams: nativeFiles[0]?.params, nativeFilename: nativeFiles[0]?.filename
    }));
    window.location.href = 'output.html';
  } catch (error) { console.error(error); alert(error.message); }
});
