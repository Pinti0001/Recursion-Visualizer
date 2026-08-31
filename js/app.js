// ============================================================
// app.js — Main Application Orchestrator (Fixed)
// ============================================================
'use strict';

// ================================================================
// TREE RENDERER
// ================================================================

class TreeRenderer {
  constructor(svgEl) {
    this.svgEl = svgEl;
    this.svg   = d3.select(svgEl);
    this.g     = this.svg.append('g').attr('class', 'tree-root');

    this.zoom = d3.zoom()
      .scaleExtent([0.08, 4])
      .on('zoom', (e) => { this.g.attr('transform', e.transform); });
    this.svg.call(this.zoom);

    this._userPanned = false;
    this.svg.on('mousedown.zoom', () => { this._userPanned = true; });

    // d3.tree nodeSize: [width-between-siblings, depth-between-levels]
    this.layout   = d3.tree().nodeSize([130, 100]);
    this._d3root  = null;
  }

  // Build nested structure from flat nodes map.
  // In addition to recursive call children, inject compact event nodes
  // for PRINT events (and RETURN for base cases) that have fired so far.
  _buildHierarchy(nodes, rootId) {
    const node = nodes[rootId];
    if (!node) return null;

    // ── Recursive call children (the real D3 subtrees)
    const callKids = (node.children || [])
      .filter(cid => nodes[cid])
      .map(cid => this._buildHierarchy(nodes, cid))
      .filter(Boolean);

    // ── Print event leaf nodes (one per printf that has executed)
    const printKids = (node.prints || []).map((text, i) => ({
      callId:        `${rootId}-print-${i}`,   // unique stable ID
      _isPrintNode:  true,
      _printText:    text,
      _parentCallId: rootId,
      _kids:         [],
    }));

    // ── Return event leaf node (only for base-case RETURNED nodes)
    const returnKids = (node.state === 'RETURNED' && node.isBaseCase)
      ? [{
          callId:          `${rootId}-return`,
          _isReturnNode:   true,
          _returnValue:    node.returnValue,
          _parentCallId:   rootId,
          _kids:           [],
        }]
      : [];

    // Order: prints first (they happen before child calls), then call children, then return
    return { ...node, _kids: [...printKids, ...callKids, ...returnKids] };
  }

  render(snapshot, animateReturnFromId = null) {
    // ── Cancel ALL ongoing D3 transitions to prevent ghost rendering
    this.g.selectAll('*').interrupt();
    this.g.selectAll('.return-badge').remove();

    const { nodes, rootId } = snapshot;
    const treeEmpty = document.getElementById('tree-empty');

    if (!rootId || !nodes[rootId]) {
      this.g.selectAll('.t-link, .t-node, .ev-node').remove();
      if (treeEmpty) treeEmpty.style.display = 'flex';
      return;
    }
    if (treeEmpty) treeEmpty.style.display = 'none';

    // ── Build D3 hierarchy (includes event leaf nodes)
    const hierarchyData = this._buildHierarchy(nodes, rootId);
    if (!hierarchyData) return;

    const root = d3.hierarchy(hierarchyData, d => d._kids);
    this.layout(root);
    this._d3root = root;

    if (!this._userPanned) this._autoCenter(root);

    const allLinks = root.links();
    const allDesc  = root.descendants();

    // Split descendants: function-call nodes vs event leaf nodes
    const fnDesc    = allDesc.filter(d => !d.data._isPrintNode && !d.data._isReturnNode);
    const evDesc    = allDesc.filter(d =>  d.data._isPrintNode ||  d.data._isReturnNode);

    // ── Links ──────────────────────────────────────────────────────
    const linkSel = this.g.selectAll('.t-link')
      .data(allLinks, d => `${d.source.data.callId}→${d.target.data.callId}`);

    linkSel.exit().interrupt().remove();

    // Enter: give event links a different style (dashed)
    const linkEnter = linkSel.enter().append('path')
      .attr('class', d => {
        const isEvLink = d.target.data._isPrintNode || d.target.data._isReturnNode;
        return isEvLink ? 't-link ev-link' : 't-link';
      })
      .attr('d', d => this._linkPath(d, d.target.data._isPrintNode || d.target.data._isReturnNode))
      .style('opacity', 0);

    linkEnter.transition().duration(180).style('opacity', 1);

    linkSel.interrupt()
      .attr('d', d => this._linkPath(d, d.target.data._isPrintNode || d.target.data._isReturnNode))
      .style('opacity', 1);

    // ── Function-call nodes ────────────────────────────────────────
    const fnSel = this.g.selectAll('.t-node')
      .data(fnDesc, d => d.data.callId);

    fnSel.exit().interrupt().remove();

    const fnEnter = fnSel.enter().append('g')
      .attr('class', d => `t-node ${TreeRenderer.nodeStateClass(d.data)}`)
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .style('opacity', 0);

    // Glow ring
    fnEnter.append('rect').attr('class', 'node-glow')
      .attr('x', -62).attr('y', -38).attr('width', 124).attr('height', 76).attr('rx', 14);
    // Body
    fnEnter.append('rect').attr('class', 'node-body')
      .attr('x', -56).attr('y', -34).attr('width', 112).attr('height', 68).attr('rx', 10);
    fnEnter.append('text').attr('class', 'node-fn').attr('text-anchor', 'middle').attr('y', -10);
    fnEnter.append('text').attr('class', 'node-args').attr('text-anchor', 'middle').attr('y', 7);
    fnEnter.append('text').attr('class', 'node-status').attr('text-anchor', 'middle').attr('y', 24);

    fnEnter.transition().duration(180).style('opacity', 1);

    const allFnNodes = fnEnter.merge(fnSel);
    allFnNodes.interrupt().style('opacity', 1);
    allFnNodes.attr('transform', d => `translate(${d.x},${d.y})`);

    allFnNodes.each(function(d) {
      const nd  = d.data;
      const sel = d3.select(this);

      sel.attr('class', `t-node ${TreeRenderer.nodeStateClass(nd)}`);

      const fnLabel = `${nd.fn}(${Object.values(nd.args || {}).join(', ')})`;
      sel.select('.node-fn').text(fnLabel);

      const argsLabel = Object.entries(nd.args || {})
        .map(([k, v]) => `${k} = ${v}`).join('  ');
      sel.select('.node-args').text(argsLabel);

      let status = '';
      switch (nd.state) {
        case 'ACTIVE':   status = '● EXECUTING'; break;
        case 'WAITING':  status = '◌ WAITING…';  break;
        case 'RETURNED':
          status = nd.isBaseCase ? `★ BASE  ${nd.returnValue}` : `↩ ${nd.returnValue}`;
          break;
      }
      sel.select('.node-status').text(status);
    });

    // ── Event nodes (PRINT / RETURN) ───────────────────────────────
    const evSel = this.g.selectAll('.ev-node')
      .data(evDesc, d => d.data.callId);

    evSel.exit().interrupt().remove();

    const evEnter = evSel.enter().append('g')
      .attr('class', d => d.data._isPrintNode ? 'ev-node ev-print' : 'ev-node ev-return')
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .style('opacity', 0);

    // Event node body (shorter rect)
    evEnter.append('rect').attr('class', 'ev-body')
      .attr('x', -50).attr('y', -22).attr('width', 100).attr('height', 44).attr('rx', 8);

    // Icon line (top)
    evEnter.append('text').attr('class', 'ev-icon').attr('text-anchor', 'middle').attr('y', -5);

    // Value line (bottom)
    evEnter.append('text').attr('class', 'ev-value').attr('text-anchor', 'middle').attr('y', 14);

    evEnter.transition().duration(180).style('opacity', 1);

    const allEvNodes = evEnter.merge(evSel);
    allEvNodes.interrupt().style('opacity', 1);
    allEvNodes.attr('transform', d => `translate(${d.x},${d.y})`);

    allEvNodes.each(function(d) {
      const nd  = d.data;
      const sel = d3.select(this);

      if (nd._isPrintNode) {
        sel.attr('class', 'ev-node ev-print');
        sel.select('.ev-icon').text('🖨 PRINT');
        // Sanitize for display: replace \n with ↵, show in quotes, trim if long
        const disp = nd._printText
          .replace(/\n/g, '↵').replace(/\r/g, '').replace(/\t/g, '⇥');
        const label = disp.length > 14 ? `"${disp.slice(0, 13)}…"` : `"${disp}"`;
        sel.select('.ev-value').text(label);
      } else {
        // Return event node
        sel.attr('class', 'ev-node ev-return');
        sel.select('.ev-icon').text('↩ RETURN');
        sel.select('.ev-value').text(String(nd._returnValue));
      }
    });

    // ── Return-value floating badge ─────────────────────────────────
    if (animateReturnFromId) {
      this._animateReturnBadge(animateReturnFromId, root);
    }
  }

  // isEventLink = true when the target is a PRINT or RETURN event node (shorter, 44px tall)
  _linkPath(d, isEventLink = false) {
    const srcHalf = 34;   // function nodes are 68px tall
    const tgtHalf = isEventLink ? 22 : 34; // event nodes are 44px tall
    const sx = d.source.x, sy = d.source.y + srcHalf;
    const tx = d.target.x, ty = d.target.y - tgtHalf;
    const my = (sy + ty) / 2;
    return `M${sx},${sy} C${sx},${my} ${tx},${my} ${tx},${ty}`;
  }

  _autoCenter(root) {
    const desc = root.descendants();
    if (!desc.length) return;

    const xs   = desc.map(d => d.x);
    const ys   = desc.map(d => d.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const midX = (minX + maxX) / 2;

    const W = this.svgEl.clientWidth  || 600;
    const H = this.svgEl.clientHeight || 400;

    const treeW = (maxX - minX) + 200;
    const treeH = (maxY - minY) + 180;
    const scale = Math.min(W / treeW, (H - 80) / treeH, 1.3);

    this.svg.call(
      this.zoom.transform,
      d3.zoomIdentity.translate(W / 2 - scale * midX, 60).scale(scale)
    );
  }

  _animateReturnBadge(fromCallId, root) {
    const fromD3   = root.descendants().find(d => d.data.callId === fromCallId);
    const parentD3 = fromD3?.parent;
    if (!fromD3 || !parentD3) return;

    const val = fromD3.data.returnValue;
    if (val === null || val === undefined) return;

    const badge = this.g.append('g')
      .attr('class', 'return-badge')
      .attr('transform', `translate(${fromD3.x},${fromD3.y - 40})`);

    badge.append('rect')
      .attr('x', -30).attr('y', -14)
      .attr('width', 60).attr('height', 28)
      .attr('rx', 14)
      .attr('fill', 'var(--color-returned)')
      .attr('stroke', 'rgba(255,255,255,0.25)')
      .attr('stroke-width', 1.5);

    badge.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '4px')
      .attr('fill', '#fff')
      .attr('font-size', '12px')
      .attr('font-weight', '700')
      .text(`↑ ${val}`);

    badge.transition()
      .duration(500).ease(d3.easeCubicOut)
      .attr('transform', `translate(${parentD3.x},${parentD3.y + 38})`)
      .style('opacity', 0)
      .remove();
  }

  static nodeStateClass(nd) {
    return `node-${(nd.state || 'RETURNED').toLowerCase()}`;
  }

  resetCamera() {
    this._userPanned = false;
    if (this._d3root) this._autoCenter(this._d3root);
  }

  clearTree() {
    this.g.selectAll('*').interrupt();
    this.g.selectAll('*').remove();
    this._d3root   = null;
    this._userPanned = false;
    const el = document.getElementById('tree-empty');
    if (el) el.style.display = 'flex';
  }
}


// ================================================================
// STACK RENDERER
// ================================================================

class StackRenderer {
  constructor(containerEl) {
    this.container = containerEl;
  }

  // event is passed so we can show the RETURNING frame at the top
  // during FUNCTION_RETURN events (before the frame disappears next step)
  render(snapshot, event) {
    const { stack, nodes, locals } = snapshot;

    // Build the display list. For FUNCTION_RETURN, inject a "RETURNING" pseudo-frame
    // at the top so the user sees what is returning and its value.
    let displayFrames = [...stack];

    if (event && event.type === 'FUNCTION_RETURN') {
      const retNode = nodes[event.callId];
      displayFrames.push({
        callId:      event.callId,
        fn:          event.fn,
        args:        (retNode && retNode.args) || {},
        state:       'RETURNING',
        returnValue: event.value,
        _synthetic:  true,
      });
    }

    // Reverse so newest/top frame is first in the DOM (top of list)
    const frames = [...displayFrames].reverse();

    if (!frames.length) {
      this.container.innerHTML = '<div class="stack-empty">No active calls</div>';
      return;
    }

    this.container.innerHTML = frames.map((f, i) => {
      let cls, tag;

      if (f.state === 'RETURNING') {
        cls = 'stack-frame stack-returning';
        tag = '<span class="frame-tag returning-tag">RETURNING ↩</span>';
      } else if (i === 0) {
        cls = 'stack-frame stack-top';
        tag = '<span class="frame-tag active-tag">ACTIVE ◄</span>';
      } else if (f.state === 'WAITING') {
        cls = 'stack-frame stack-waiting';
        tag = '<span class="frame-tag waiting-tag">WAITING</span>';
      } else {
        cls = 'stack-frame';
        tag = '';
      }

      // Parameters
      const argsHtml = Object.entries(f.args || {})
        .map(([k, v]) =>
          `<span class="frame-var">` +
          `<span class="var-name">${k}</span>` +
          ` = <span class="var-val">${v}</span></span>`)
        .join('');

      // Local variables not in args
      const argKeys = new Set(Object.keys(f.args || {}));
      const localEntries = Object.entries((locals && locals[f.callId]) || {})
        .filter(([k]) => !argKeys.has(k));
      const localsHtml = localEntries.map(([k, v]) =>
        `<span class="frame-var local">` +
        `<span class="var-name">${k}</span>` +
        ` = <span class="var-val">${v}</span></span>`).join('');

      // Return value for RETURNING frame
      const retHtml = f.state === 'RETURNING'
        ? `<span class="frame-return-val">returns: <strong>${f.returnValue}</strong></span>`
        : '';

      return `
        <div class="${cls}" data-call-id="${f.callId}">
          <div class="frame-header">
            <span class="frame-fn">${f.fn}()</span>
            ${tag}
          </div>
          <div class="frame-vars">${argsHtml}${localsHtml}${retHtml}</div>
        </div>`;
    }).join('');
  }

  clear() {
    this.container.innerHTML = '<div class="stack-empty">No active calls</div>';
  }
}


// ================================================================
// EXPLANATION GENERATOR
// ================================================================

function generateExplanation(events, snapshots, idx) {
  if (idx < 0 || idx >= events.length) return null;

  const ev   = events[idx];
  const snap = snapshots[idx];
  const prev = idx > 0 ? events[idx - 1] : null;
  const prevSnap = idx > 0 ? snapshots[idx - 1] : null;
  const next = idx < events.length - 1 ? events[idx + 1] : null;
  const nextSnap = idx < events.length - 1 ? snapshots[idx + 1] : null;

  return {
    justHappened: prev  ? _describeEvent(prev,  prevSnap)  : null,
    nowHappening: _describeEvent(ev, snap),
    next:         next  ? _describeEvent(next,  nextSnap)  : null,
  };
}

function _sig(fn, args) {
  return `${fn}(${Object.values(args || {}).join(', ')})`;
}

function _describeEvent(ev, snap) {
  if (!ev) return null;

  switch (ev.type) {
    case 'PROGRAM_START':
      return {
        icon: '▶',
        title: 'Program starts',
        detail: 'Execution begins. main() is about to be called.',
      };

    case 'FUNCTION_CALL': {
      const fnSig = _sig(ev.fn, ev.args);
      const argEntries = Object.entries(ev.args || {});
      const argsStr = argEntries.map(([k, v]) => `${k} = ${v}`).join(', ');
      if (!ev.parentId) {
        return {
          icon: '📞',
          title: `main() called`,
          detail: 'Entry point. A new stack frame is created.',
        };
      }
      const parentNode = snap && snap.nodes[ev.parentId];
      const parentSig = parentNode ? _sig(parentNode.fn, parentNode.args) : '(parent)';
      return {
        icon: '📞',
        title: `${parentSig} calls ${fnSig}`,
        detail: argsStr
          ? `Parameter${argEntries.length > 1 ? 's' : ''}: ${argsStr}\nA new stack frame is created.`
          : 'A new stack frame is created.',
      };
    }

    case 'LINE_EXECUTE': {
      const activeNode = snap && snap.activeId && snap.nodes[snap.activeId];
      const fn = activeNode ? _sig(activeNode.fn, activeNode.args) : '';
      return {
        icon: '→',
        title: `Line ${ev.line} executes`,
        detail: fn ? `Inside ${fn}` : 'Current line is highlighted in the editor.',
      };
    }

    case 'CONDITION_CHECK': {
      const result = ev.result ? '✓ TRUE' : '✗ FALSE';
      const branch = ev.result
        ? 'The if-block will execute.'
        : 'The if-block is skipped.';
      return {
        icon: ev.result ? '✅' : '❌',
        title: `if (${ev.exprText})`,
        detail: `With actual values: ${ev.resolvedText}\nResult: ${result}\n${branch}`,
      };
    }

    case 'PRINT': {
      const shown = ev.output.replace(/\n/g, '↵').replace(/\t/g, '⇥');
      return {
        icon: '🖨️',
        title: 'printf() writes output',
        detail: `Printed: "${shown}"\nSee Program Output panel.`,
      };
    }

    case 'VAR_ASSIGN': {
      const activeNode = snap && snap.activeId && snap.nodes[snap.activeId];
      const fn = activeNode ? activeNode.fn : '';
      return {
        icon: '📝',
        title: `${ev.name} = ${ev.value}`,
        detail: fn
          ? `Variable '${ev.name}' set to ${ev.value} inside ${fn}()`
          : `Variable '${ev.name}' assigned ${ev.value}`,
      };
    }

    case 'RETURN_VALUE_RECEIVED': {
      const fromNode = snap && snap.nodes[ev.fromCallId];
      const fromSig  = fromNode ? _sig(fromNode.fn, fromNode.args) : `${ev.fn}()`;
      const toNode   = snap && snap.activeId && snap.nodes[snap.activeId];
      const toSig    = toNode ? _sig(toNode.fn, toNode.args) : '(caller)';
      return {
        icon: '⬆️',
        title: `${fromSig} → ${ev.value}`,
        detail: `${toSig} receives the value ${ev.value} and continues executing.`,
      };
    }

    case 'EXPRESSION_EVAL':
      return {
        icon: '🧮',
        title: `${ev.exprText}`,
        detail: `Both recursive calls completed.\nFinal result: ${ev.result}`,
      };

    case 'FUNCTION_RETURN': {
      const retNode = snap && snap.nodes[ev.callId];
      const isBase  = retNode && retNode.isBaseCase;
      const parentNode = ev.parentId && snap && snap.nodes[ev.parentId];
      const parentSig  = parentNode ? _sig(parentNode.fn, parentNode.args) : null;
      const fnSig      = retNode ? _sig(ev.fn, retNode.args) : `${ev.fn}()`;
      const detail = [
        isBase ? '★ This is a BASE CASE — recursion stops here.' : null,
        `Returns: ${ev.value}`,
        parentSig ? `Stack frame removed. Control returns to ${parentSig}.` : 'Stack frame removed.',
      ].filter(Boolean).join('\n');
      return {
        icon: isBase ? '★' : '↩️',
        title: `${fnSig} returns ${ev.value}`,
        detail,
      };
    }

    case 'PROGRAM_END':
      return {
        icon: '🏁',
        title: 'Program complete',
        detail: snap
          ? `All functions have returned.\nFinal output: ${snap.output || '(none)'}`
          : 'Execution finished.',
      };

    default:
      return { icon: 'ℹ️', title: ev.type, detail: '' };
  }
}


// ================================================================
// PLAYBACK CONTROLLER
// ================================================================

class PlaybackController {
  constructor({ onStep }) {
    this.events    = [];
    this.snapshots = [];
    this.step      = -1;
    this.playing   = false;
    this.speed     = 1;
    this._timer    = null;
    this.onStep    = onStep;
  }

  load(events, snapshots) {
    this.events    = events;
    this.snapshots = snapshots;
    this.step      = -1;
    this.pause();
  }

  get total()   { return this.events.length; }
  get atStart() { return this.step <= 0; }
  get atEnd()   { return this.step >= this.total - 1; }

  goTo(idx) {
    this.step = Math.max(0, Math.min(idx, this.total - 1));
    this.onStep(this.step);
  }

  stepForward()  { if (!this.atEnd)   this.goTo(this.step + 1); }
  stepBackward() { if (!this.atStart) this.goTo(this.step - 1); }

  restart()  { this.pause(); this.goTo(0); }
  goToEnd()  { this.pause(); this.goTo(this.total - 1); }

  play() {
    if (this.playing || this.atEnd) return;
    this.playing = true;
    this._schedule();
  }

  pause() {
    this.playing = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  togglePlay() {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(s) { this.speed = s; }

  _schedule() {
    if (!this.playing) return;
    const delay = 600 / this.speed;
    this._timer = setTimeout(() => {
      if (!this.playing) return;
      this.stepForward();
      if (this.atEnd) { this.playing = false; return; }
      this._schedule();
    }, delay);
  }
}


// ================================================================
// CODE EDITOR WRAPPER
// ================================================================

class CodeEditorWrapper {
  constructor(textareaEl) {
    this.editor = CodeMirror.fromTextArea(textareaEl, {
      mode:           'text/x-csrc',
      theme:          'one-dark',
      lineNumbers:    true,
      lineWrapping:   false,
      tabSize:        4,
      indentWithTabs: false,
      autofocus:      true,
      extraKeys: { 'Tab': cm => cm.execCommand('indentMore') },
    });
    this._activeLine = null;
  }

  getValue()     { return this.editor.getValue(); }
  setValue(code) { this.editor.setValue(code); this.clearHighlight(); }
  refresh()      { this.editor.refresh(); }

  highlightLine(lineNum) {
    if (this._activeLine !== null) {
      this.editor.removeLineClass(this._activeLine, 'background', 'cm-active-line');
      this.editor.removeLineClass(this._activeLine, 'gutter',     'cm-active-gutter');
    }
    if (lineNum > 0) {
      const ln = lineNum - 1; // CodeMirror is 0-indexed
      this.editor.addLineClass(ln, 'background', 'cm-active-line');
      this.editor.addLineClass(ln, 'gutter',     'cm-active-gutter');
      this.editor.scrollIntoView({ line: ln, ch: 0 }, 60);
      this._activeLine = ln;
    } else {
      this._activeLine = null;
    }
  }

  clearHighlight() { this.highlightLine(0); }
}


// ================================================================
// EXECUTION INFO PANEL — Build meaningful HTML per event type
// ================================================================

function buildExecInfoHTML(event, snapshot) {
  if (!event || !snapshot) {
    return '<div class="info-placeholder">Press <strong>▶ Visualize</strong> to begin</div>';
  }

  const { nodes, stack, locals, activeId, currentLine } = snapshot;
  const activeNode  = activeId && nodes[activeId];
  const activeFrame = stack.length ? stack[stack.length - 1] : null; // topmost frame

  // Helper: key=value rows
  const kvRow = (k, v, cls = '') =>
    `<div class="info-kv ${cls}">` +
    `<span class="kv-key">${k}</span>` +
    `<span class="kv-eq">=</span>` +
    `<span class="kv-val">${v}</span></div>`;

  // Helper: section block
  const section = (label, body) =>
    `<div class="info-section"><div class="info-label">${label}</div>${body}</div>`;

  // Helper: call signature display
  const callSig = (node) => node
    ? `<span class="info-fn">${node.fn}(${Object.values(node.args || {}).join(', ')})</span>`
    : '';

  // Helper: args table
  const argsSection = (args) => {
    const entries = Object.entries(args || {});
    if (!entries.length) return '';
    return section('Parameters', entries.map(([k, v]) => kvRow(k, v)).join(''));
  };

  // Helper: locals table (non-arg vars)
  const localsSection = (callId, args) => {
    const argKeys = new Set(Object.keys(args || {}));
    const entries = Object.entries((locals[callId]) || {})
      .filter(([k]) => !argKeys.has(k));
    if (!entries.length) return '';
    return section('Local Variables', entries.map(([k, v]) => kvRow(k, v, 'local')).join(''));
  };

  switch (event.type) {

    case 'PROGRAM_START':
      return `
        <div class="info-banner info-banner-start">▶ Program Starting</div>
        <div class="info-section">
          <div class="info-detail">main() will be called to begin execution.</div>
        </div>`;

    case 'FUNCTION_CALL': {
      const callNode = nodes[event.callId];
      const parentNode = event.parentId ? nodes[event.parentId] : null;
      const isMain = !event.parentId;
      return `
        <div class="info-banner info-banner-call">📞 ${isMain ? 'Entry Point' : 'Function Called'}</div>
        <div class="info-section">
          <div class="info-label">Function</div>
          ${callSig(callNode || { fn: event.fn, args: event.args })}
        </div>
        ${argsSection(event.args)}
        ${parentNode ? section('Called from',
            `<span class="info-fn-small">${_sig(parentNode.fn, parentNode.args)}</span>`) : ''}
        <div class="info-section">
          <div class="info-detail">New stack frame created.</div>
        </div>`;
    }

    case 'LINE_EXECUTE': {
      const node = activeNode || (event.callId ? nodes[event.callId] : null);
      return `
        <div class="info-banner info-banner-line">→ Line ${event.line}</div>
        ${node ? `<div class="info-section"><div class="info-label">In</div>${callSig(node)}</div>` : ''}
        ${node ? argsSection(node.args) : ''}
        ${node ? localsSection(event.callId, node.args) : ''}`;
    }

    case 'CONDITION_CHECK': {
      const cls  = event.result ? 'cond-true' : 'cond-false';
      const icon = event.result ? '✅ TRUE'   : '❌ FALSE';
      const branch = event.result ? 'if-block will execute' : 'if-block is skipped';
      return `
        <div class="info-banner info-banner-cond">🔍 Condition Check</div>
        <div class="info-section">
          <div class="info-label">Expression</div>
          <div class="cond-expr">${event.exprText}</div>
          <div class="cond-resolved">with values: ${event.resolvedText}</div>
        </div>
        <div class="info-section info-condition ${cls}">
          <div class="cond-result-big">${icon}</div>
          <div class="info-detail">${branch}</div>
        </div>`;
    }

    case 'PRINT': {
      const shown = event.output.replace(/\n/g, '↵').replace(/\t/g, '⇥');
      return `
        <div class="info-banner info-banner-print">🖨️ printf()</div>
        <div class="info-section">
          <div class="info-label">Printed</div>
          <div class="print-out">"${shown}"</div>
        </div>
        <div class="info-section">
          <div class="info-detail">Output appended to console →</div>
        </div>`;
    }

    case 'VAR_ASSIGN': {
      const node = activeNode || (event.callId ? nodes[event.callId] : null);
      return `
        <div class="info-banner info-banner-assign">📝 Variable Set</div>
        ${node ? `<div class="info-section"><div class="info-label">In</div>${callSig(node)}</div>` : ''}
        <div class="info-section">
          <div class="info-label">Assignment</div>
          ${kvRow(event.name, event.value)}
        </div>`;
    }

    case 'RETURN_VALUE_RECEIVED': {
      const fromNode = nodes[event.fromCallId];
      const toNode   = activeNode;
      const fromSig  = fromNode ? _sig(fromNode.fn, fromNode.args) : `${event.fn}()`;
      const toSig    = toNode   ? _sig(toNode.fn,   toNode.args)   : '(caller)';
      return `
        <div class="info-banner info-banner-recv">⬆️ Value Received</div>
        <div class="info-section">
          <div class="info-label">From</div>
          <span class="info-fn-small">${fromSig}</span>
        </div>
        <div class="info-section">
          <div class="info-label">Value</div>
          <div class="return-val-big">${event.value}</div>
        </div>
        <div class="info-section">
          <div class="info-label">Into</div>
          <span class="info-fn-small">${toSig}</span>
        </div>`;
    }

    case 'EXPRESSION_EVAL': {
      return `
        <div class="info-banner info-banner-eval">🧮 Expression Computed</div>
        <div class="info-section">
          <div class="info-label">Computation</div>
          <div class="eval-expr">${event.exprText}</div>
        </div>
        <div class="info-section">
          <div class="info-label">Result</div>
          <div class="return-val-big">${event.result}</div>
        </div>`;
    }

    case 'FUNCTION_RETURN': {
      // The returning node — it's in snapshot.nodes even after return (state = RETURNED)
      const retNode  = nodes[event.callId];
      const isBase   = retNode && retNode.isBaseCase;
      const parentNode = event.parentId ? nodes[event.parentId] : null;
      const fnSig    = retNode ? _sig(event.fn, retNode.args) : `${event.fn}()`;
      return `
        <div class="info-banner ${isBase ? 'info-banner-base' : 'info-banner-return'}">
          ${isBase ? '★ Base Case' : '↩️ Function Returns'}
        </div>
        <div class="info-section">
          <div class="info-label">Returning</div>
          <span class="info-fn-small">${fnSig}</span>
        </div>
        <div class="info-section">
          <div class="info-label">Return Value</div>
          <div class="return-val-big">${event.value}</div>
        </div>
        ${parentNode ? section('Back to',
            `<span class="info-fn-small">${_sig(parentNode.fn, parentNode.args)}</span>`) : ''}
        ${isBase ? `<div class="info-section info-base-tag">Recursion stops here — no more calls</div>` : ''}`;
    }

    case 'PROGRAM_END': {
      const callCount = Object.keys(nodes).length;
      return `
        <div class="info-banner info-banner-end">🏁 Program Complete</div>
        <div class="info-section">
          <div class="info-detail">All functions returned. ${callCount} total function call${callCount !== 1 ? 's' : ''}.</div>
        </div>`;
    }

    default:
      return `<div class="info-banner">${event.type}</div>`;
  }
}

function _sig(fn, args) {
  return `${fn}(${Object.values(args || {}).join(', ')})`;
}


// ================================================================
// MAIN APP
// ================================================================

class App {
  constructor() {
    this.codeEditor   = new CodeEditorWrapper(document.getElementById('code-textarea'));
    this.treeRenderer = new TreeRenderer(document.getElementById('tree-svg'));
    this.stackRenderer= new StackRenderer(document.getElementById('stack-frames'));
    this.playback     = new PlaybackController({ onStep: idx => this._onStep(idx) });

    this.events    = [];
    this.snapshots = [];

    this._initControls();
    this._initExampleSelector();
    this._loadExample('fibonacci');
  }

  // ── Controls ─────────────────────────────────────────────────

  _initControls() {
    const $ = id => document.getElementById(id);

    $('btn-visualize').addEventListener('click', () => this.visualize());
    $('btn-restart').addEventListener('click',   () => this.playback.restart());
    $('btn-prev').addEventListener('click',      () => this.playback.stepBackward());
    $('btn-play').addEventListener('click',      () => this._togglePlay());
    $('btn-next').addEventListener('click',      () => this.playback.stepForward());
    $('btn-end').addEventListener('click',       () => this.playback.goToEnd());
    $('btn-reset-camera').addEventListener('click', () => this.treeRenderer.resetCamera());

    $('speed-select').addEventListener('change', e => {
      this.playback.setSpeed(parseFloat(e.target.value));
    });

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'TEXTAREA' || e.target.closest('.CodeMirror')) return;
      if (e.key === 'ArrowRight' || e.key === 'n') { e.preventDefault(); this.playback.stepForward(); }
      if (e.key === 'ArrowLeft'  || e.key === 'p') { e.preventDefault(); this.playback.stepBackward(); }
      if (e.key === ' ')                            { e.preventDefault(); this._togglePlay(); }
      if (e.key === 'r')                            { e.preventDefault(); this.playback.restart(); }
    });
  }

  _initExampleSelector() {
    const sel = document.getElementById('example-select');
    sel.addEventListener('change', e => {
      if (e.target.value) {
        this._loadExample(e.target.value);
        e.target.value = '';
      }
    });
  }

  _loadExample(key) {
    const ex = EXAMPLES[key];
    if (!ex) return;
    this.codeEditor.setValue(ex.code);
    document.getElementById('example-desc').textContent = ex.description;
    this._clearVisualization();
  }

  _clearVisualization() {
    this.treeRenderer.clearTree();
    this.stackRenderer.clear();
    this.codeEditor.clearHighlight();
    this._setOutput('');
    this._setExplanation(null);
    this._updateStepCounter(0, 0);
    this._setExecInfo(null, null);
    this.playback.load([], []);
    document.getElementById('error-panel').style.display = 'none';
    this._setPlayBtn(false);
  }

  // ── Visualize ────────────────────────────────────────────────

  visualize() {
    const code = this.codeEditor.getValue().trim();
    if (!code) return;

    const btn = document.getElementById('btn-visualize');
    btn.disabled    = true;
    btn.textContent = 'Analyzing…';
    document.getElementById('error-panel').style.display = 'none';

    // Yield to the browser to paint the "Analyzing…" state, then run
    setTimeout(() => {
      const result = runPipeline(code, { maxDepth: 150, maxEvents: 8000 });

      btn.disabled    = false;
      btn.textContent = '▶ Visualize';

      if (!result.success) {
        this._showError(result.error);
        return;
      }

      // 1. Clear UI (resets playback to empty)
      this._clearVisualization();

      // 2. Load new events
      this.events    = result.events;
      this.snapshots = result.snapshots;
      this.playback.load(this.events, this.snapshots);

      // 3. Jump to first step
      this.playback.goTo(0);
    }, 20);
  }

  // ── Step handler ─────────────────────────────────────────────

  _onStep(idx) {
    if (idx < 0 || idx >= this.events.length) return;

    const event    = this.events[idx];
    const snapshot = this.snapshots[idx];

    // Which call returned (for badge animation)?
    const animateReturnFrom = (event.type === 'FUNCTION_RETURN' && event.parentId)
      ? event.callId : null;

    // Render tree
    this.treeRenderer.render(snapshot, animateReturnFrom);

    // Render call stack — pass event so FUNCTION_RETURN can show returning frame
    this.stackRenderer.render(snapshot, event);

    // Highlight source line
    this.codeEditor.highlightLine(snapshot.currentLine);

    // Update output panel (only what has been printed so far)
    this._setOutput(snapshot.output);

    // Update execution info
    this._setExecInfo(event, snapshot);

    // Update bottom explanation
    const expl = generateExplanation(this.events, this.snapshots, idx);
    this._setExplanation(expl);

    // Update step counter + progress bar
    this._updateStepCounter(idx + 1, this.events.length);

    // Update button states
    this._setPlayBtn(this.playback.playing);
    document.getElementById('btn-prev').disabled = this.playback.atStart;
    document.getElementById('btn-next').disabled = this.playback.atEnd;
    document.getElementById('btn-end').disabled  = this.playback.atEnd;
  }

  _togglePlay() {
    this.playback.togglePlay();
    this._setPlayBtn(this.playback.playing);
  }

  _setPlayBtn(playing) {
    document.getElementById('btn-play').textContent = playing ? '⏸ Pause' : '▶ Play';
  }

  // ── Execution Info ───────────────────────────────────────────

  _setExecInfo(event, snapshot) {
    document.getElementById('exec-info').innerHTML =
      buildExecInfoHTML(event, snapshot);
  }

  // ── Output ───────────────────────────────────────────────────

  _setOutput(text) {
    const el = document.getElementById('output-content');
    el.textContent = text || '';
    if (text) el.scrollTop = el.scrollHeight;
  }

  // ── Explanation ──────────────────────────────────────────────

  _setExplanation(expl) {
    const panel = document.getElementById('explanation-panel');

    if (!expl) {
      panel.innerHTML =
        '<div class="expl-placeholder">Step through the execution to see explanations.</div>';
      return;
    }

    const card = (data, cls) => {
      if (!data) return `<div class="expl-card ${cls} expl-empty">—</div>`;
      const detailHtml = data.detail
        ? data.detail.split('\n').map(l => `<p>${l}</p>`).join('')
        : '';
      return `
        <div class="expl-card ${cls}">
          <div class="expl-icon">${data.icon || 'ℹ️'}</div>
          <div class="expl-body">
            <div class="expl-title">${data.title}</div>
            ${detailHtml ? `<div class="expl-detail">${detailHtml}</div>` : ''}
          </div>
        </div>`;
    };

    panel.innerHTML = `
      <div class="expl-row">
        <div class="expl-col">
          <div class="expl-col-label">JUST HAPPENED</div>
          ${card(expl.justHappened, 'expl-past')}
        </div>
        <div class="expl-col expl-col-now">
          <div class="expl-col-label expl-now-label">▶ HAPPENING NOW</div>
          ${card(expl.nowHappening, 'expl-now')}
        </div>
        <div class="expl-col">
          <div class="expl-col-label">COMING NEXT</div>
          ${card(expl.next, 'expl-future')}
        </div>
      </div>`;
  }

  // ── Step Counter ─────────────────────────────────────────────

  _updateStepCounter(current, total) {
    document.getElementById('step-counter').textContent =
      total > 0 ? `Step ${current} / ${total}` : 'Ready';
    const pct = total > 0 ? (current / total) * 100 : 0;
    document.getElementById('progress-bar').style.width = `${pct}%`;
  }

  // ── Error Panel ──────────────────────────────────────────────

  _showError(error) {
    this._clearVisualization();
    const panel = document.getElementById('error-panel');
    panel.style.display = 'flex';
    panel.innerHTML = `
      <div class="error-icon">⚠️</div>
      <div class="error-body">
        <div class="error-type">${error.type}</div>
        <div class="error-msg">${error.message}</div>
        ${error.line ? `<div class="error-line">Line ${error.line}</div>` : ''}
        <div class="error-hint">Supported: int/void, if/else, while/for, return, printf, recursion</div>
      </div>`;
    this.codeEditor.highlightLine(error.line || 0);
  }
}


// ── Bootstrap ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  setTimeout(() => window.app.codeEditor.refresh(), 100);
});
