// Adapter for the original chromEvol form and the results.html runner.
(() => {
'use strict';
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

const normalizeText = text => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
$(function () {
  const byId = id => document.getElementById(id);
  const form = byId('inputForm');
  const button = byId('submitFormBtn');
  const status = byId('runPreparationStatus');
  const pendingReads = new Map();
  // Replace the original preview handlers so Submit waits for file reading.
  for (const id of ['TreeFile', 'CountsFile']) {
    const field = byId(id);
    $(field).off('change');
    field.addEventListener('change', () => {
      const file = field.files[0];
      if (!file) return;
      const pending = file.text().then(text => {
        if (field.files[0] === file) byId(id + '_txt').value = normalizeText(text);
      });
      pendingReads.set(id, pending);
      pending.catch(error => { status.textContent = error.message; });
    });
  }
  // These server features are outside the current browser analysis pipeline.
  form.querySelectorAll('[name="PruneCounts"], #DiscreteTraitModel, #UserDefined, [name="ploidy_ON"], [name="inputEmail"], [name^="MA_"], input[onclick*="AdequacyText"]').forEach(field => {
    field.disabled = true;
    field.required = false;
    field.title = 'Not available in the browser version yet';
    field.style.opacity = '0.45';
    if (field.nextElementSibling?.tagName === 'LABEL') field.nextElementSibling.style.opacity = '0.45';
  });
  byId('AdeqTest_DIV').style.display = 'none';
  ClearModels();
  let homogeneousModels = JSON.stringify(data);
  let heterogeneous = false;
  let maximumRegimes = '2';
  window.changedAnalysisType = function () {
    const next = byId('TimeHeterogeneousModel').checked;
    if (next && !heterogeneous) homogeneousModels = JSON.stringify(data);
    if (!next && heterogeneous) maximumRegimes = byId('maxRateRegimes').value;
    heterogeneous = next;
    byId('transitionPointsDiv').style.display = next ? 'block' : 'none';
    byId('traitModelDiv').style.display = 'none';
    byId('addModelDiv').style.display = next ? 'none' : 'block';
    if (next) {
      AddHeterogeneusModel();
      byId('maxRateRegimes').value = maximumRegimes;
      byId('paramTable').querySelectorAll('input, select, button').forEach(field => field.disabled = true);
    } else {
      data = JSON.parse(homogeneousModels);
      num_data_col = data.length;
      LoadParamTable();
    }
  };
  window.changedAnalysisType();
  const resetButton = () => {
    button.disabled = false;
    button.value = 'Submit — Run defined models';
  };
  resetButton();
  window.addEventListener('pageshow', resetButton);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    button.value = 'Preparing run…';
    status.textContent = 'Preparing parameter files…';
    try {
      await Promise.all([...pendingReads.values()]);
      const tree = normalizeText(byId('TreeFile_txt').value);
      const counts = normalizeText(byId('CountsFile_txt').value);
      const options = {
        analysisType: byId('TimeHeterogeneousModel').checked ? 'TimeHeterogeneous' : 'Homogenous',
        maxRateRegimes: byId('TimeHeterogeneousModel').checked ? byId('maxRateRegimes').value : '1',
        minCladeSize: byId('minCladeSize').value
      };
      const definedModels = data.filter(model => !data_record_is_empty(model)).map(model => ({...model}));
      if (!definedModels.length) throw new Error('Please define at least one model.');
      const [template, defaultsText] = await Promise.all([
        loadText('param_NEW_MODELS_anat.txt'), loadText('DEFAULT_PARAM_VALUES.txt')
      ]);
      const defaults = readDefaults(defaultsText);
      byId('definedModels').value = JSON.stringify(definedModels);
      const nativeFiles = definedModels.map((model, index) => ({
        id: index, modelName: model.name, filename: 'param_' + model.name + '.txt',
        params: createParams(template, model, counts, defaults, options)
      }));
      const startId = crypto.randomUUID();
      sessionStorage.setItem('sincopaInput', JSON.stringify({
        startId, tree, counts, ...options,
        jobTitle: form.elements.jobTitle.value,
        params: createWrapperParams(definedModels, defaults, options), nativeFiles,
        nativeParams: nativeFiles[0].params, nativeFilename: nativeFiles[0].filename
      }));
      sessionStorage.setItem('sincopaPendingStart', startId);
      window.location.href = 'results.html?start=' + encodeURIComponent(startId);
    } catch (error) {
      console.error(error);
      status.textContent = 'Could not prepare run: ' + error.message;
      resetButton();
    }
  });
});
})();
