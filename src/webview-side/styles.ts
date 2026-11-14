// The styles of the page and of the panel. The content security policy allows no inline styles, so the webviews use a
// constructable stylesheet. The colors come from the theme of VS Code. The 2 colors of the writers come from the design
// canvas: amber for the user and pink for Claude, with darker values for a light theme.

const CSS = `
:root { --sg-you: #f2b544; --sg-claude: #f07fc9; --sg-ok: var(--vscode-testing-iconPassed, #73c991);
  --sg-warn: var(--vscode-editorWarning-foreground, #cca700); --sg-border: var(--vscode-widget-border, rgba(128, 128, 128, 0.35));
  --sg-engine: var(--vscode-charts-blue, #3794ff); --sg-cool: var(--vscode-charts-blue, #3794ff); --sg-warm: var(--vscode-charts-yellow, #cca700);
  --sg-hot: var(--vscode-charts-orange, #d18616); }
body.vscode-light { --sg-you: #9a6700; --sg-claude: #b0297e; }
body.vscode-high-contrast, body.vscode-high-contrast-light { --sg-you: var(--vscode-charts-yellow); --sg-claude: var(--vscode-charts-purple);
  --sg-border: var(--vscode-contrastBorder); }
html, body { margin: 0; padding: 0; }
body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.45; }
body.page-body { background: var(--vscode-editor-background); }
p { margin: 0 0 8px; }
h1, h2 { margin: 0; font-weight: 600; }
.muted { color: var(--vscode-descriptionForeground); }
.grow { flex: 1; min-width: 0; }
.label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
.name { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }

/* the bar of the 5 stages. A dot shows the writer of a stage */
.stages { display: flex; flex-wrap: wrap; gap: 3px; margin: 6px 0 0; padding: 0; list-style: none; }
.stage { display: inline-flex; align-items: center; gap: 4px; padding: 0 5px; border: 1px solid var(--sg-border); border-radius: 4px;
  font-size: 11px; white-space: nowrap; color: var(--vscode-descriptionForeground); }
.stage.current { border-color: var(--vscode-focusBorder); color: var(--vscode-foreground); background: var(--vscode-list-inactiveSelectionBackground, transparent); }
.stage.done { color: var(--vscode-foreground); }
.stage .check { color: var(--sg-ok); }
.large .stage { gap: 6px; padding: 2px 9px; font-size: 12px; }
.dots { display: inline-flex; }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; }
.dots .dot + .dot { margin-left: -2px; }
.dot.user { background: var(--sg-you); }
.dot.claude { background: var(--sg-claude); }

/* the stage of the task with the badges of its writers */
.head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 2px; }
.badge { display: inline-block; padding: 0 5px; border-radius: 999px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; line-height: 1.5; }
.badge.user { color: var(--sg-you); background: color-mix(in srgb, var(--sg-you) 16%, transparent); }
.badge.claude { color: var(--sg-claude); background: color-mix(in srgb, var(--sg-claude) 16%, transparent); }
.title { margin: 0 0 2px; font-size: 14px; font-weight: 600; }
.section { margin-top: 14px; }
.rule { margin: 8px 0; padding: 4px 8px; border-left: 2px solid var(--sg-border); }
.banner { margin: 8px 0; padding: 6px 8px; border-left: 3px solid var(--sg-warn); background: color-mix(in srgb, var(--sg-warn) 10%, transparent); }

/* a request that the user types in Claude Code. A click copies the words */
.tell { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; width: 100%; margin: 0 0 8px; padding: 4px 8px;
  box-sizing: border-box; border: 1px dashed var(--sg-border); border-radius: 4px; background: none; color: inherit; font: inherit;
  text-align: left; cursor: pointer; }
.tell:hover { border-color: var(--sg-claude); }
.tell .who { flex: none; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--sg-claude); }
.tell .words { font-family: var(--vscode-editor-font-family); font-size: 12px; }

/* the buttons in the style of VS Code */
.buttons { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 0; }
.btn { padding: 2px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; font: inherit; line-height: 18px;
  cursor: pointer; }
.btn.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
.btn.primary:hover { background: var(--vscode-button-hoverBackground); }
.btn.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
.btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.btn.small { padding: 0 8px; font-size: 11px; }
.btn:focus-visible, .tell:focus-visible, summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }

.btn:disabled { opacity: 0.5; cursor: default; }
.small { font-size: 11px; }
/* a text button, for example a part of the brief or the line of a question */
.link { padding: 0; border: 0; background: none; color: var(--vscode-textLink-foreground); font: inherit; text-align: left; cursor: pointer; }
.link:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
.link.part { color: inherit; }

/* stage 1: the parts of the brief, the questions of Claude and the gate */
.row-head { display: flex; align-items: baseline; gap: 6px; margin: 12px 0 2px; }
.row-head > .muted { margin-left: auto; }
.mark.q { color: var(--sg-claude); }
.notice { margin: 8px 0; padding: 4px 8px; border-left: 3px solid var(--sg-warn); }
.gate { margin: 14px 0 0; padding-top: 10px; border-top: 1px solid color-mix(in srgb, var(--sg-border) 60%, transparent); }
.gate > .btn.primary { padding: 3px 14px; }

/* stage 2: the survey. The badge Model marks the words of Claude, and the badge Engine the facts of DataFlow */
.intro { margin: 10px 0 4px; }
.badge.engine { color: var(--sg-engine); background: color-mix(in srgb, var(--sg-engine) 16%, transparent); }
.id { flex: none; min-width: 2.4em; font-family: var(--vscode-editor-font-family); color: var(--vscode-descriptionForeground); }
.chips { flex: none; display: inline-flex; flex-wrap: wrap; gap: 3px; }
.chip { padding: 0 6px; border: 1px solid var(--sg-border); border-radius: 4px; background: none; color: inherit; font: inherit; font-size: 11px;
  line-height: 18px; cursor: pointer; }
.chip.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-inactiveSelectionBackground, transparent); }
.chip.tool { cursor: default; font-family: var(--vscode-editor-font-family); }
.mono { font-family: var(--vscode-editor-font-family); }
/* a hook: its id, its title with its kind and place below it, and its heat. A long name breaks, so no text goes over a column */
.block { display: block; }
.hooks .row .grow, .list .grow { overflow-wrap: anywhere; }
.hooks .row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: baseline; width: 100%;
  margin: 2px 0; padding: 4px 6px; box-sizing: border-box; border: 1px solid transparent; border-radius: 4px; background: none; color: inherit;
  font: inherit; text-align: left; cursor: pointer; }
.hooks .row:hover { background: var(--vscode-list-hoverBackground, transparent); }
.hooks .row.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-inactiveSelectionBackground, transparent); }
.heat { padding: 0 6px; border-radius: 999px; font-size: 11px; white-space: nowrap; }
.heat.cool { color: var(--sg-cool); background: color-mix(in srgb, var(--sg-cool) 14%, transparent); }
.heat.warm { color: var(--sg-warm); background: color-mix(in srgb, var(--sg-warm) 14%, transparent); }
.heat.hot, .heat.very-hot { color: var(--sg-hot); background: color-mix(in srgb, var(--sg-hot) 16%, transparent); }
.heat.very-hot { font-weight: 700; }
.heat.none { color: var(--vscode-descriptionForeground); background: color-mix(in srgb, var(--sg-border) 35%, transparent); }
.code { margin: 8px 0; padding: 6px 0; overflow-x: auto; border: 1px solid var(--sg-border); border-radius: 4px;
  background: var(--vscode-textCodeBlock-background, transparent); font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size, 12px); line-height: 1.5; }
.code-line { display: flex; white-space: pre; }
.code-line .ln { flex: none; width: 3.5em; padding-right: 10px; text-align: right; color: var(--vscode-editorLineNumber-foreground); user-select: none; }
.code-line.hook { background: color-mix(in srgb, var(--vscode-focusBorder) 14%, transparent); box-shadow: inset 2px 0 var(--vscode-focusBorder); }
.answer { margin: 10px 0 0; }
.answer > p { margin-bottom: 4px; }
.answer textarea { display: block; width: 100%; box-sizing: border-box; min-height: 3em; margin: 0 0 4px; padding: 4px 6px; resize: vertical;
  border: 1px solid var(--vscode-input-border, var(--sg-border)); background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  font: inherit; }
.answer textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }

/* stage 3: the order. Each task has its place, its text, its hooks, its size, its needs and its buttons. A task for later
   is dim, and a task with a warning has the color of the warning */
.order-list { margin: 6px 0 8px; padding: 0; list-style: none; }
.order-row { margin: 0 0 6px; padding: 6px 8px; border: 1px solid var(--sg-border); border-radius: 4px; }
.order-row.later { opacity: 0.6; }
.order-row.warn { border-color: color-mix(in srgb, var(--sg-warn) 70%, transparent); }
.order-main, .order-add, .order-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.order-meta { margin: 4px 0 0 2.9em; }
.order-add { margin: 0 0 8px; padding: 6px 8px; border: 1px dashed var(--sg-border); border-radius: 4px; }
.order-num { flex: none; min-width: 1.8em; padding: 0 4px; border-radius: 999px; text-align: center; font-size: 12px; font-weight: 700;
  color: var(--sg-you); background: color-mix(in srgb, var(--sg-you) 16%, transparent); }
.order-row.later .order-num { color: var(--vscode-descriptionForeground); background: color-mix(in srgb, var(--sg-border) 40%, transparent); }
.order-input, .order-text { flex: 1 1 180px; min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
.order-input { box-sizing: border-box; height: 24px; padding: 0 6px; border: 1px solid var(--vscode-input-border, var(--sg-border)); border-radius: 2px;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground); font: inherit; font-weight: 600; }
.order-input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.order-row.nosurvey .order-input { border-color: color-mix(in srgb, var(--sg-you) 60%, transparent); }
.tag { flex: none; padding: 0 6px; border-radius: 999px; font-size: 11px; white-space: nowrap; }
.tag.user { color: var(--sg-you); background: color-mix(in srgb, var(--sg-you) 14%, transparent); }
.tag.claude { color: var(--sg-claude); background: color-mix(in srgb, var(--sg-claude) 14%, transparent); }
.order-hooks { flex: none; display: inline-flex; flex-wrap: wrap; gap: 3px; }
.order-size { flex: none; min-width: 3.5em; padding: 0 5px; border-radius: 4px; text-align: center; font-size: 11px;
  background: color-mix(in srgb, var(--sg-border) 30%, transparent); }
.order-needs { flex: none; font-size: 12px; }
.order-buttons { flex: none; display: inline-flex; align-items: center; gap: 4px; }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 24px; padding: 0; border: 1px solid var(--sg-border);
  border-radius: 4px; background: none; color: inherit; cursor: pointer; }
.icon-btn:disabled, .chip:disabled { opacity: 0.35; cursor: default; }
.pill { min-width: 4.5em; padding: 1px 9px; border: 1px solid var(--sg-border); border-radius: 11px; background: none; color: inherit; font: inherit;
  cursor: pointer; white-space: nowrap; }
.pill.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-inactiveSelectionBackground, transparent); }
.order-note, .order-warn { display: flex; align-items: baseline; gap: 6px; margin: 5px 0 0; padding: 3px 6px; border-radius: 4px; }
.order-note > :not(.badge), .order-warn > :not(.badge) { min-width: 0; overflow-wrap: anywhere; }
.order-note.user { background: color-mix(in srgb, var(--sg-you) 8%, transparent); }
.order-note.claude { background: color-mix(in srgb, var(--sg-claude) 8%, transparent); }
.order-warn { background: color-mix(in srgb, var(--sg-warn) 12%, transparent); }
.badge.check { color: var(--vscode-foreground); background: color-mix(in srgb, var(--sg-border) 50%, transparent); }
.row-head > .state { margin-left: auto; }
.hint { font-size: 11px; color: var(--vscode-descriptionForeground); }
.ok-text { color: var(--sg-ok); }
.warn-text { color: var(--sg-warn); }
.check-line { margin: 4px 0; }
.icon-btn:focus-visible, .pill:focus-visible, .chip:focus-visible, .link:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }

/* stage 4: the plan. The 5 colors of the risk levels come from the design canvas, with darker values for a light theme */
:root { --sg-l1: #8a97a8; --sg-l2: #a3adba; --sg-l3: #d9a36a; --sg-l4: #f0835a; --sg-l5: #ff5c6c; }
body.vscode-light { --sg-l1: #56606e; --sg-l2: #66707d; --sg-l3: #9a5b16; --sg-l4: #b8410e; --sg-l5: #c0182c; }
.lv-0 { --lv: var(--sg-border); }
.lv-1 { --lv: var(--sg-l1); }
.lv-2 { --lv: var(--sg-l2); }
.lv-3 { --lv: var(--sg-l3); }
.lv-4 { --lv: var(--sg-l4); }
.lv-5 { --lv: var(--sg-l5); }
.risk-bar { flex: none; display: inline-flex; gap: 2px; }
.risk-bar .seg { width: 5px; height: 10px; border-radius: 1px; background: color-mix(in srgb, var(--sg-border) 60%, transparent); }
.risk-bar .seg.on { background: var(--lv); }
.level-name { font-weight: 600; color: var(--lv); }
.steps { display: flex; flex-direction: column; gap: 3px; margin: 6px 0 0; }
.step-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 8px; box-sizing: border-box; border: 1px solid var(--sg-border);
  border-radius: 4px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.step-row:hover { background: var(--vscode-list-hoverBackground, transparent); }
.step-row.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-inactiveSelectionBackground, transparent); }
.step-row .grow { font-weight: 600; overflow-wrap: anywhere; }
.step-num { flex: none; min-width: 1.6em; padding: 0 4px; border-radius: 999px; text-align: center; font-size: 11px; font-weight: 700;
  color: var(--sg-engine); background: color-mix(in srgb, var(--sg-engine) 16%, transparent); }
.step-title { font-weight: 600; }
.dots.writer { justify-content: flex-end; width: 16px; }
.badge.rule { color: var(--vscode-foreground); background: color-mix(in srgb, var(--sg-border) 50%, transparent); }
.rule-box { display: flex; align-items: baseline; gap: 6px; margin: 4px 0; padding: 4px 6px; border-radius: 4px;
  background: color-mix(in srgb, var(--sg-border) 15%, transparent); }
.places { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
.checks, .reasons { margin: 4px 0 8px; padding: 0; list-style: none; }
.reasons { padding-left: 4px; }
.heat-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 4px 0 2px; }
.heat-title { font-weight: 600; }
.band-cool { color: var(--sg-cool); }
.band-warm { color: var(--sg-warm); }
.band-hot, .band-very-hot { color: var(--sg-hot); }
.flames { display: inline-flex; align-items: center; gap: 1px; }
.flames svg { fill: color-mix(in srgb, var(--sg-border) 70%, transparent); }
.flames svg.on { fill: currentColor; }
.signals { display: grid; grid-template-columns: 2.6em minmax(0, 1fr); gap: 0 8px; margin: 4px 0 8px; padding: 0; list-style: none; font-size: 12px; }
.signals li { display: contents; }
.signals .pts { text-align: right; font-weight: 600; }
.profile { display: flex; gap: 2px; height: 8px; margin: 6px 0; }
.profile .seg { flex: 1; border-radius: 1px; background: var(--lv); }
.writers { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--vscode-descriptionForeground); }
.writers span { display: inline-flex; align-items: center; gap: 5px; }
.writers strong { color: var(--vscode-foreground); }
.note-field { display: block; margin: 8px 0 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
.note-field input { display: block; width: 100%; box-sizing: border-box; height: 24px; margin: 2px 0 0; padding: 0 6px;
  border: 1px solid var(--vscode-input-border, var(--sg-border)); border-radius: 2px; background: var(--vscode-input-background);
  color: var(--vscode-input-foreground); font: inherit; }
.note-field input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.step-row:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }

/* stage 5: the build. The steps in sequence, the current step with the color of its level, and the receipt of Claude
   with a mark of the user on each change */
:root { --sg-issue: var(--vscode-errorForeground, #f14c4c); --sg-added: var(--vscode-gitDecoration-addedResourceForeground, #81b88b);
  --sg-removed: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); }
.build-steps { display: flex; flex-direction: column; gap: 1px; margin: 4px 0 8px; padding: 0; list-style: none; }
.build-step { display: flex; align-items: center; gap: 6px; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.build-step .grow { overflow-wrap: anywhere; }
.build-step.current { font-weight: 600; background: var(--vscode-list-inactiveSelectionBackground, transparent); }
.build-step.st-done .grow { color: var(--vscode-descriptionForeground); }
.build-step .step-num { color: var(--lv); background: color-mix(in srgb, var(--lv) 16%, transparent); }
.state-glyph { flex: none; width: 1.1em; text-align: center; color: var(--vscode-descriptionForeground); }
.state-glyph.st-done { color: var(--sg-ok); }
.state-chip { flex: none; padding: 0 6px; border-radius: 999px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--vscode-descriptionForeground); background: color-mix(in srgb, var(--sg-border) 40%, transparent); }
.state-chip.st-open.claude, .state-chip.st-receipt { color: var(--sg-claude); background: color-mix(in srgb, var(--sg-claude) 14%, transparent); }
.state-chip.st-open.user { color: var(--sg-you); background: color-mix(in srgb, var(--sg-you) 14%, transparent); }
.state-chip.st-done { color: var(--sg-ok); background: color-mix(in srgb, var(--sg-ok) 14%, transparent); }
.current-step { margin: 8px 0 0; padding: 8px 10px; border: 1px solid var(--sg-border); border-left: 3px solid var(--lv); border-radius: 4px; }
.current-step .row-head { flex-wrap: wrap; row-gap: 2px; margin-top: 0; }
/* a narrow panel breaks the row between its parts, not in a part */
.current-step .row-head > * { white-space: nowrap; }
.receipt { margin: 10px 0 0; padding-top: 6px; border-top: 1px solid color-mix(in srgb, var(--sg-border) 60%, transparent); }
progress.walk-track { display: block; width: 100%; height: 4px; margin: 8px 0 2px; border: 0; border-radius: 2px; appearance: none;
  background: color-mix(in srgb, var(--sg-border) 50%, transparent); }
progress.walk-track::-webkit-progress-bar { border-radius: 2px; background: color-mix(in srgb, var(--sg-border) 50%, transparent); }
progress.walk-track::-webkit-progress-value { border-radius: 2px; background: var(--sg-ok); }
.changes { margin: 6px 0; padding: 0; list-style: none; }
.change { margin: 0 0 6px; padding: 6px 8px; border: 1px solid var(--sg-border); border-left: 3px dashed var(--sg-claude); border-radius: 4px; }
.change.m-ok { border-left: 3px solid var(--sg-ok); }
.change.m-issue { border-left: 3px solid var(--sg-issue); }
.change.m-question { border-left: 3px solid var(--sg-warn); }
.change-head { display: flex; align-items: baseline; gap: 6px; }
.change-title { font-weight: 600; overflow-wrap: anywhere; }
.change-place { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin: 2px 0 4px; }
.change-num { flex: none; min-width: 1.6em; padding: 0 4px; border-radius: 999px; text-align: center; font-size: 11px; font-weight: 700;
  color: var(--sg-claude); background: color-mix(in srgb, var(--sg-claude) 16%, transparent); }
.change-num.m-ok { color: var(--sg-ok); background: color-mix(in srgb, var(--sg-ok) 16%, transparent); }
.change-num.m-issue { color: var(--sg-issue); background: color-mix(in srgb, var(--sg-issue) 16%, transparent); }
.change-num.m-question { color: var(--sg-warn); background: color-mix(in srgb, var(--sg-warn) 16%, transparent); }
.plus { color: var(--sg-added); }
.minus { color: var(--sg-removed); }
.marks { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 0; }
.mark-btn { padding: 0 9px; border: 1px solid var(--sg-border); border-radius: 11px; background: none; color: inherit; font: inherit; font-size: 12px;
  line-height: 20px; cursor: pointer; }
.mark-btn:hover { background: var(--vscode-list-hoverBackground, transparent); }
.mark-btn.m-ok.on { border-color: var(--sg-ok); color: var(--sg-ok); }
.mark-btn.m-issue.on { border-color: var(--sg-issue); color: var(--sg-issue); }
.mark-btn.m-question.on { border-color: var(--sg-warn); color: var(--sg-warn); }
.mark-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.diff .code { margin: 4px 0; font-size: 11px; }
.code-line.add { background: var(--vscode-diffEditor-insertedLineBackground, rgba(155, 185, 85, 0.2)); }
.code-line.del { background: var(--vscode-diffEditor-removedLineBackground, rgba(255, 0, 0, 0.2)); }

/* stage 5: a frame of Claude. The holes are decisions of the user, so an open hole has the color of the user */
.holes { display: flex; flex-direction: column; gap: 3px; margin: 6px 0; padding: 0; list-style: none; }
.hole-row { display: flex; align-items: baseline; gap: 6px; width: 100%; padding: 3px 6px; box-sizing: border-box; border: 1px solid var(--sg-border);
  border-radius: 4px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.hole-row:hover { background: var(--vscode-list-hoverBackground, transparent); }
.hole-row.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-inactiveSelectionBackground, transparent); }
.hole-row .grow { overflow-wrap: anywhere; }
.hole-row:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.change-num.h-open, .change-num.h-empty { color: var(--sg-you); background: color-mix(in srgb, var(--sg-you) 16%, transparent); }
.change-num.h-done.by-user, .change-num.h-changed { color: var(--sg-you); background: color-mix(in srgb, var(--sg-you) 30%, transparent); }
.change-num.h-done.by-claude { color: var(--sg-claude); background: color-mix(in srgb, var(--sg-claude) 16%, transparent); }
.hole-state { flex: none; font-size: 11px; color: var(--vscode-descriptionForeground); }
.hole-state.by-user, .hole-state.h-changed { color: var(--sg-you); }
.hole-state.by-claude { color: var(--sg-claude); }
.hole-detail { margin: 8px 0 0; padding: 6px 8px; border: 1px solid var(--sg-border); border-left: 3px dashed var(--sg-you); border-radius: 4px; }
.hole-detail .row-head { margin-top: 0; }
.hole-question { margin: 2px 0; font-weight: 600; }
.hint-btn:disabled { opacity: 1; cursor: default; }
.hint-btn.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-inactiveSelectionBackground, transparent); }
.hint-btn.answer.on { border-color: var(--sg-claude); color: var(--sg-claude); }
.frame-request { margin: 8px 0 0; }
.frame-request .btn { margin-bottom: 4px; }

/* stage 5: the navigator. A callout is a fact of the engine: a problem, a warning or an other fact */
.navigator { margin: 12px 0 0; padding-top: 6px; border-top: 1px solid color-mix(in srgb, var(--sg-border) 60%, transparent); }
.callouts, .answers { display: flex; flex-direction: column; gap: 3px; margin: 6px 0; padding: 0; list-style: none; }
.callout-row { display: flex; align-items: baseline; gap: 6px; width: 100%; padding: 3px 6px; box-sizing: border-box; border: 1px solid var(--sg-border);
  border-left: 3px solid var(--k); border-radius: 4px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.callout-row:hover { background: var(--vscode-list-hoverBackground, transparent); }
.callout-row.on { border-color: var(--vscode-focusBorder); border-left-color: var(--k); background: var(--vscode-list-inactiveSelectionBackground, transparent); }
.callout-row .grow { overflow-wrap: anywhere; }
.callout-row.s-held, .callout-row.s-closed, .callout-row.s-waiting { opacity: 0.65; }
.callout-row:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.k-problem { --k: var(--sg-issue); }
.k-warning { --k: var(--sg-hot); }
.k-info { --k: var(--sg-claude); }
.kind-chip { flex: none; padding: 0 6px; border-radius: 999px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--k); background: color-mix(in srgb, var(--k) 16%, transparent); }
.callout-detail { margin: 6px 0 0; padding: 6px 8px; border: 1px solid var(--sg-border); border-left: 3px solid var(--k); border-radius: 4px; }
.answer-row { padding: 4px 0; }
.answer-row + .answer-row { border-top: 1px solid color-mix(in srgb, var(--sg-border) 50%, transparent); }
.answer-row.resolved { opacity: 0.65; }
.mark-btn.voice.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-inactiveSelectionBackground, transparent); }

/* phase 9: the tabs of stage 5, the loose ends, and the ledger */
.tabs { display: flex; flex-wrap: wrap; gap: 2px; margin: 10px 0 4px; border-bottom: 1px solid var(--sg-border); }
.tab { padding: 3px 10px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--vscode-descriptionForeground); font: inherit;
  cursor: pointer; }
.tab:hover { color: var(--vscode-foreground); }
.tab.on { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
.tab:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.page-tabs { max-width: 1100px; margin: 12px auto 0; padding: 0 28px; box-sizing: border-box; }
.loose-ends { margin: 4px 0 0; padding: 0; list-style: none; }
.loose-end { padding: 6px 0; }
.loose-end + .loose-end { border-top: 1px solid color-mix(in srgb, var(--sg-border) 50%, transparent); }
.loose-end.s-closed, .loose-end.s-handed { opacity: 0.75; }
.loose-end .row-head { margin-top: 0; }
.message-text { margin: 4px 0; padding: 6px 8px; border: 1px solid var(--sg-border); border-radius: 4px; white-space: pre-wrap; overflow-wrap: anywhere;
  font-family: var(--vscode-editor-font-family); font-size: 12px; }
.points { margin: 4px 0 0; padding: 0; list-style: none; }
.point { display: flex; align-items: baseline; gap: 6px; padding: 2px 0; }
.point-glyph { flex: none; width: 1.2em; text-align: center; font-weight: 700; }
.point > :not(.point-glyph) { min-width: 0; overflow-wrap: anywhere; }
.point.p-ok .point-glyph { color: var(--sg-ok); }
.point.p-missing .point-glyph, .point.p-wrong .point-glyph { color: var(--sg-issue); }
.point.p-question .point-glyph { color: var(--sg-warn); }
.ledger-table { width: 100%; margin: 6px 0; border-collapse: collapse; font-size: 12px; }
.table-wrap { max-width: 100%; overflow-x: auto; }
.ledger-table th, .ledger-table td { padding: 3px 6px; border-bottom: 1px solid color-mix(in srgb, var(--sg-border) 50%, transparent); text-align: left;
  font-variant-numeric: tabular-nums; }
.ledger-table td:first-child { overflow-wrap: anywhere; }
.ledger-table th { font-weight: 600; color: var(--vscode-descriptionForeground); }
.ledger-table td.warn { color: var(--sg-warn); font-weight: 600; }
.hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* lists: the setup, the decisions and the tasks */
.list { margin: 4px 0 0; padding: 0; list-style: none; }
.list li { display: flex; align-items: baseline; gap: 6px; padding: 3px 0; }
.list li + li { border-top: 1px solid color-mix(in srgb, var(--sg-border) 50%, transparent); }
.mark { flex: none; width: 1em; text-align: center; font-weight: 700; }
.ok .mark { color: var(--sg-ok); }
.todo .mark { color: var(--sg-warn); }
.time { flex: none; font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
.by-guard .text { color: var(--vscode-descriptionForeground); }
.active-task { font-weight: 600; }
details > summary { cursor: pointer; }
.problems { color: var(--vscode-errorForeground); }

/* the panel beside the text editor */
.panel { padding: 8px 12px 16px; }

/* the page in the editor area */
.page { max-width: 1100px; margin: 0 auto; padding: 20px 28px 32px; }
.page-title { margin: 4px 0 2px; font-size: 20px; }
.grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 20px; margin-top: 18px; align-items: start; }
.column { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.card { padding: 12px 14px; border: 1px solid var(--sg-border); border-radius: 6px; }
.card > h2 { margin-bottom: 6px; }
@media (max-width: 760px) { .grid { grid-template-columns: minmax(0, 1fr); } }
`;

export function applyStyles(): void {
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(CSS);
	document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
