chromEvol — Node.js launcher for Windows and Linux

1. PREPARE

Extract this ZIP to a folder. Keep all included files together.
Node.js must be installed. Check in PowerShell (Windows) or a terminal (Linux):

node --version

If the command is unavailable, install Node.js from https://nodejs.org and reopen
the terminal. No npm packages, Python or R are required by this launcher.

The ZIP contains the launcher, shared calculation modules, parameter template,
default settings, and a matching chromEvol.js / chromEvol.wasm pair.
If updating the WASM build later, replace BOTH chromEvol.js and chromEvol.wasm.

2. SAVE YOUR INPUTS

On the website results page, click Download parameters file and save params.txt.
Use your original tree and chromosome counts files. Copy all three inputs into
this folder, or pass their full paths to the launcher.
params.txt must be the website's original wrapper file containing definedModels
JSON, rather than a native param_Model.txt.
The input file names are arbitrary: the command-line arguments specify them.
Homogeneous or heterogeneous analysis and defined models come from params.txt.
The program creates its own virtual-filesystem paths; you do not need to edit them.

3. RUN FITTING

Open PowerShell or a terminal in the extracted folder. The following one-line
command works on both Windows and Linux. Substitute your input file names:

node ./run-models.js --tree "./TreesFile.txt" --counts "./countsFile" --params "./params.txt" --output "./results.zip"

Quotes allow paths containing spaces. Use your preferred output ZIP name.
The launcher fits all defined models (one Background search for heterogeneous
analysis), calculates the summary, and writes the results ZIP.

4. OPTIONAL MODEL ADEQUACY

Adequacy needs an explicit --adequacy argument in Node, even if the downloaded
params.txt has the browser adequacy checkbox enabled.

Quick diagnostic check on the best model (10 simulations):

node ./run-models.js --tree "./TreesFile.txt" --counts "./countsFile" --params "./params.txt" --adequacy best --adequacy-sims 10 --output "./results-ma-check.zip" > ma-check.log 2>&1

Full original simulation count (1000 simulations):

node ./run-models.js --tree "./TreesFile.txt" --counts "./countsFile" --params "./params.txt" --adequacy best --adequacy-sims 1000 --output "./results-ma.zip" > ma.log 2>&1

For one named homogeneous model, replace --adequacy best with:
--adequacy selected --adequacy-model "Dys"
Use the actual model name from your parameters.
For heterogeneous analysis, --adequacy best tests the whole final fitted model,
including every selected rate regime/shift. The archive folder retains the launch
name Background, while adequacy.json records the fitted name, such as 1-shift.
The calculation has the same supported-data scope as the website adequacy code:
rooted binary tree, matching taxa, integer counts without missing data, and no
digits in the taxon-name portion. Partition labels cannot contain spaces,
parentheses, commas or semicolons.
Ten-simulation results are marked diagnostic. Use 1000 for the original workflow.
Raw simulations, PVs, CSV/JSON statistics and correction/retry reports are included.

5. DISPLAY YOUR RESULTS

Open zip_viewer.html on the website and upload the generated results ZIP. It opens
results.html with the model summary, model output links and any adequacy PVs table.
The ZIP is read locally by the browser. You can also extract it to inspect files.

6. NOTES

Keep the terminal open while running; keep the computer awake.
Ctrl+C stops the launcher. Completed model outputs are retained when possible.
Node runs use direct WASM loading in separate processes, preserving the earlier
performance fix. Console output can be redirected as shown above.
To list options: node ./run-models.js --help
The launcher does not require GitHub credentials or an internet connection to run
after Node.js is installed and these files have been downloaded.
