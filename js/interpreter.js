// ============================================================
// C Interpreter — Execution Engine for the Recursion Visualizer
//
// Architecture:
//   - Walks the AST and simulates C execution
//   - Generates typed events at every meaningful step
//   - Captures a full state snapshot AFTER each event
//   - Returns { events, snapshots } for playback
// ============================================================

class RuntimeError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'RuntimeError';
    this.line = line;
  }
}

class ReturnSignal {
  constructor(value) { this.value = value; }
}

class LimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LimitError';
  }
}

// ---- Node / Frame State Constants ----
const NodeState = Object.freeze({
  ACTIVE:    'ACTIVE',
  WAITING:   'WAITING',
  RETURNED:  'RETURNED',
});

class Interpreter {
  constructor(options = {}) {
    this.maxDepth  = options.maxDepth  || 200;
    this.maxEvents = options.maxEvents || 8000;

    // Output
    this.events    = [];
    this.snapshots = [];

    // Function registry (name → FunctionDecl node)
    this.functions = {};

    // --- Live state (mutated as interpretation proceeds) ---
    // Call stack: array of CallFrame (index 0 = main, last = active)
    this.liveStack    = [];
    // Call tree nodes: flat map callId → CallNode
    this.liveNodes    = {};
    // Root call ID
    this.liveRootId   = null;
    // Accumulated output
    this.liveOutput   = '';
    // Currently active call ID
    this.liveActiveId = null;
    // Current source line
    this.liveCurrentLine = 0;
    // Local variables per call: callId → {name: value}
    this.liveLocals   = {};

    this._callCounter = 0;
    this._depth       = 0;
  }

  // ---- ID Generation ----

  _newId() {
    return `c${String(++this._callCounter).padStart(4, '0')}`;
  }

  // ---- Snapshot ----

  _snapshot() {
    return {
      stack:       JSON.parse(JSON.stringify(this.liveStack)),
      nodes:       JSON.parse(JSON.stringify(this.liveNodes)),
      rootId:      this.liveRootId,
      output:      this.liveOutput,
      activeId:    this.liveActiveId,
      currentLine: this.liveCurrentLine,
      locals:      JSON.parse(JSON.stringify(this.liveLocals)),
    };
  }

  // ---- Emit ----

  _emit(event) {
    if (this.events.length >= this.maxEvents) {
      throw new LimitError(
        `Visualization stopped: too many steps (>${this.maxEvents}). ` +
        `Try a smaller input value.`
      );
    }
    event.stepIndex = this.events.length;
    this.events.push(event);
    this.snapshots.push(this._snapshot());
  }

  // ---- Entry point ----

  interpret(ast) {
    // Register all function declarations
    for (const decl of ast.declarations) {
      if (decl.type === 'FunctionDecl') {
        this.functions[decl.name] = decl;
      }
    }

    if (!this.functions['main']) {
      throw new RuntimeError('No main() function found.', 1);
    }

    this._emit({ type: 'PROGRAM_START' });

    const mainId = this._newId();
    this.liveRootId = mainId;
    this._callFunction('main', [], mainId, null, 1);

    this._emit({ type: 'PROGRAM_END', output: this.liveOutput });

    return { events: this.events, snapshots: this.snapshots };
  }

  // ---- Function call ----

  _callFunction(name, argValues, callId, parentId, callLine) {
    if (this._depth >= this.maxDepth) {
      throw new RuntimeError(
        `Stack overflow: recursion depth exceeded ${this.maxDepth}. ` +
        `Possible infinite recursion.`,
        callLine
      );
    }

    const decl = this.functions[name];
    if (!decl) {
      throw new RuntimeError(`Undefined function: '${name}'`, callLine);
    }

    // Build argument map
    const args = {};
    decl.params.forEach((p, i) => {
      args[p.name] = argValues[i] !== undefined ? argValues[i] : 0;
    });

    // === Update live state BEFORE emitting FUNCTION_CALL ===

    // Mark parent as WAITING
    if (parentId) {
      const parentFrame = this.liveStack.find(f => f.callId === parentId);
      if (parentFrame) parentFrame.state = NodeState.WAITING;
      if (this.liveNodes[parentId]) {
        this.liveNodes[parentId].state = NodeState.WAITING;
      }
    }

    // Create call frame
    const frame = {
      callId,
      fn:         name,
      args:       { ...args },
      state:      NodeState.ACTIVE,
      line:       decl.line,
      callerLine: callLine,
      parentId:   parentId || null,
      returnValue: null,
    };
    this.liveStack.push(frame);

    // Create call node in tree
    const node = {
      callId,
      fn:          name,
      args:        { ...args },
      state:       NodeState.ACTIVE,
      returnValue: null,
      parentId:    parentId || null,
      children:    [],
      isBaseCase:  false,
    };
    this.liveNodes[callId] = node;

    // Register as child of parent
    if (parentId && this.liveNodes[parentId]) {
      this.liveNodes[parentId].children.push(callId);
    }

    this.liveActiveId    = callId;
    this.liveLocals[callId] = { ...args };
    this.liveCurrentLine = decl.line;

    // Emit FUNCTION_CALL — snapshot shows child ACTIVE, parent WAITING
    this._emit({
      type:     'FUNCTION_CALL',
      callId,
      fn:       name,
      args:     { ...args },
      parentId: parentId || null,
      line:     callLine,
    });

    // === Execute body ===
    this._depth++;
    let returnValue = 0;
    try {
      const env = { ...args }; // per-call environment (flat scoping)
      this._execBlock(decl.body, env, callId);
    } catch (sig) {
      if (sig instanceof ReturnSignal) {
        returnValue = sig.value !== undefined ? sig.value : 0;
      } else {
        throw sig;
      }
    }
    this._depth--;

    // === Update live state for return ===

    // Pop frame
    this.liveStack.pop();

    // Mark node as RETURNED
    const thisNode = this.liveNodes[callId];
    thisNode.state       = NodeState.RETURNED;
    thisNode.returnValue = returnValue;
    thisNode.isBaseCase  = thisNode.children.length === 0;

    // Mark parent as ACTIVE again
    if (parentId) {
      const parentFrame = this.liveStack.find(f => f.callId === parentId);
      if (parentFrame) {
        parentFrame.state = NodeState.ACTIVE;
        this.liveCurrentLine = parentFrame.line;
      }
      if (this.liveNodes[parentId]) {
        this.liveNodes[parentId].state = NodeState.ACTIVE;
      }
      this.liveActiveId = parentId;
    } else {
      this.liveActiveId    = null;
      this.liveCurrentLine = 0;
    }

    // Emit FUNCTION_RETURN — snapshot shows child RETURNED, parent ACTIVE
    this._emit({
      type:     'FUNCTION_RETURN',
      callId,
      fn:       name,
      value:    returnValue,
      parentId: parentId || null,
    });

    return returnValue;
  }

  // ---- Block / Statements ----

  _execBlock(block, env, callId) {
    for (const stmt of block.body) {
      this._execStmt(stmt, env, callId);
    }
  }

  _execStmt(stmt, env, callId) {
    switch (stmt.type) {
      case 'EmptyStmt':
        return;

      case 'VarDecl': {
        this._setLine(stmt.line, callId);
        this._emit({ type: 'LINE_EXECUTE', callId, line: stmt.line });

        let value = 0;
        if (stmt.init !== null) {
          value = this._evalExpr(stmt.init, env, callId);
        }
        env[stmt.name] = value;
        this.liveLocals[callId][stmt.name] = value;
        this._emit({ type: 'VAR_ASSIGN', callId, name: stmt.name, value, line: stmt.line });
        return;
      }

      case 'ExprStmt': {
        this._setLine(stmt.line, callId);
        this._emit({ type: 'LINE_EXECUTE', callId, line: stmt.line });
        this._evalExpr(stmt.expr, env, callId);
        return;
      }

      case 'ReturnStmt': {
        this._setLine(stmt.line, callId);
        this._emit({ type: 'LINE_EXECUTE', callId, line: stmt.line });
        let value = 0;
        if (stmt.value !== null) {
          value = this._evalExpr(stmt.value, env, callId);
        }
        throw new ReturnSignal(value);
      }

      case 'IfStmt': {
        this._setLine(stmt.line, callId);
        this._emit({ type: 'LINE_EXECUTE', callId, line: stmt.line });

        const condText     = this._exprText(stmt.condition);
        const condResolved = this._resolveText(stmt.condition, env);
        const condVal      = this._evalExpr(stmt.condition, env, callId);
        const result       = condVal !== 0;

        this._emit({
          type:         'CONDITION_CHECK',
          callId,
          exprText:     condText,
          resolvedText: condResolved,
          result,
          line:         stmt.line,
        });

        if (result) {
          this._execStmt(stmt.then, env, callId);
        } else if (stmt.else) {
          this._execStmt(stmt.else, env, callId);
        }
        return;
      }

      case 'WhileStmt': {
        let iters = 0;
        while (true) {
          this._setLine(stmt.line, callId);
          this._emit({ type: 'LINE_EXECUTE', callId, line: stmt.line });
          const val = this._evalExpr(stmt.condition, env, callId);
          if (!val) break;
          this._execStmt(stmt.body, env, callId);
          if (++iters > 2000) throw new RuntimeError('Possible infinite loop detected (>2000 iterations)', stmt.line);
        }
        return;
      }

      case 'ForStmt': {
        if (stmt.init) this._execStmt(stmt.init, env, callId);
        let iters = 0;
        while (true) {
          this._setLine(stmt.line, callId);
          this._emit({ type: 'LINE_EXECUTE', callId, line: stmt.line });
          if (stmt.condition) {
            const val = this._evalExpr(stmt.condition, env, callId);
            if (!val) break;
          }
          this._execStmt(stmt.body, env, callId);
          if (stmt.update) this._evalExpr(stmt.update, env, callId);
          if (++iters > 2000) throw new RuntimeError('Possible infinite loop detected (>2000 iterations)', stmt.line);
        }
        return;
      }

      case 'BlockStmt': {
        const innerEnv = { ...env };
        this._execBlock(stmt, innerEnv, callId);
        // Sync back simple variables (flat scoping)
        Object.assign(env, innerEnv);
        return;
      }

      default:
        throw new RuntimeError(`Unknown statement type: ${stmt.type}`, 0);
    }
  }

  // ---- Expression evaluation ----

  _evalExpr(expr, env, callId) {
    switch (expr.type) {
      case 'NumberLiteral':
        return expr.value;

      case 'StringLiteral':
        return expr.value;

      case 'Identifier': {
        if (!(expr.name in env)) {
          throw new RuntimeError(`Undefined variable: '${expr.name}'`, expr.line);
        }
        return env[expr.name];
      }

      case 'AssignExpr': {
        if (expr.target.type !== 'Identifier') {
          throw new RuntimeError('Invalid assignment target', expr.line);
        }
        const val = this._evalExpr(expr.value, env, callId);
        env[expr.target.name] = val;
        if (this.liveLocals[callId]) {
          this.liveLocals[callId][expr.target.name] = val;
        }
        this._emit({ type: 'VAR_ASSIGN', callId, name: expr.target.name, value: val, line: expr.line });
        return val;
      }

      case 'BinaryExpr': {
        const lv = this._evalExpr(expr.left, env, callId);
        const rv = this._evalExpr(expr.right, env, callId);
        const result = this._applyOp(expr.op, lv, rv);
        // Emit EXPRESSION_EVAL when either side involved a function call
        if (this._containsCall(expr.left) || this._containsCall(expr.right)) {
          this._emit({
            type:     'EXPRESSION_EVAL',
            callId,
            leftVal:  lv,
            rightVal: rv,
            op:       expr.op,
            result,
            exprText: `${this._fmt(lv)} ${expr.op} ${this._fmt(rv)} = ${this._fmt(result)}`,
            line:     expr.line,
          });
        }
        return result;
      }

      case 'UnaryExpr': {
        const val = this._evalExpr(expr.operand, env, callId);
        if (expr.op === '-') return -val;
        if (expr.op === '!') return val !== 0 ? 0 : 1;
        return val;
      }

      case 'CallExpr': {
        // Built-in: printf
        if (expr.callee === 'printf') {
          return this._evalPrintf(expr, env, callId);
        }

        // User-defined function call
        const argVals   = expr.args.map(a => this._evalExpr(a, env, callId));
        const childId   = this._newId();
        const retVal    = this._callFunction(expr.callee, argVals, childId, callId, expr.line);

        // Restore active state for current call after child returns
        this._setLine(expr.line, callId);

        // Emit return value received
        this._emit({
          type:       'RETURN_VALUE_RECEIVED',
          callId,
          fromCallId: childId,
          fn:         expr.callee,
          value:      retVal,
          line:       expr.line,
        });

        return retVal;
      }

      default:
        throw new RuntimeError(`Unknown expression type: ${expr.type}`, 0);
    }
  }

  // ---- printf ----

  _evalPrintf(expr, env, callId) {
    if (expr.args.length === 0) return 0;

    const fmtVal = this._evalExpr(expr.args[0], env, callId);
    let result = '';

    if (typeof fmtVal !== 'string') {
      result = String(fmtVal);
    } else {
      let argIdx = 1;
      for (let i = 0; i < fmtVal.length; i++) {
        if (fmtVal[i] === '%' && i + 1 < fmtVal.length) {
          const spec = fmtVal[i + 1];
          if (spec === 'd' || spec === 'i') {
            const v = argIdx < expr.args.length ? this._evalExpr(expr.args[argIdx++], env, callId) : 0;
            result += String(Math.trunc(Number(v)));
            i++;
          } else if (spec === 's') {
            const v = argIdx < expr.args.length ? this._evalExpr(expr.args[argIdx++], env, callId) : '';
            result += String(v);
            i++;
          } else if (spec === 'c') {
            const v = argIdx < expr.args.length ? this._evalExpr(expr.args[argIdx++], env, callId) : 0;
            result += String.fromCharCode(Number(v));
            i++;
          } else if (spec === 'f') {
            const v = argIdx < expr.args.length ? this._evalExpr(expr.args[argIdx++], env, callId) : 0;
            result += Number(v).toFixed(2);
            i++;
          } else {
            result += fmtVal[i];
          }
        } else {
          result += fmtVal[i];
        }
      }
    }

    this.liveOutput += result;
    this._emit({ type: 'PRINT', callId, output: result, line: expr.line });
    return 0;
  }

  // ---- Operator application ----

  _applyOp(op, l, r) {
    switch (op) {
      case '+':  return l + r;
      case '-':  return l - r;
      case '*':  return l * r;
      case '/':  return r !== 0 ? Math.trunc(l / r) : 0;
      case '%':  return r !== 0 ? l % r : 0;
      case '<':  return l < r  ? 1 : 0;
      case '>':  return l > r  ? 1 : 0;
      case '<=': return l <= r ? 1 : 0;
      case '>=': return l >= r ? 1 : 0;
      case '==': return l === r ? 1 : 0;
      case '!=': return l !== r ? 1 : 0;
      case '&&': return (l !== 0 && r !== 0) ? 1 : 0;
      case '||': return (l !== 0 || r !== 0) ? 1 : 0;
      default: throw new RuntimeError(`Unknown operator: ${op}`, 0);
    }
  }

  // ---- Helpers ----

  _setLine(line, callId) {
    this.liveCurrentLine = line;
    const frame = this.liveStack.find(f => f.callId === callId);
    if (frame) frame.line = line;
  }

  _containsCall(expr) {
    if (!expr) return false;
    if (expr.type === 'CallExpr') return true;
    if (this._containsCall(expr.left))    return true;
    if (this._containsCall(expr.right))   return true;
    if (this._containsCall(expr.operand)) return true;
    if (this._containsCall(expr.value))   return true;
    return false;
  }

  _fmt(val) {
    if (typeof val === 'string') return `"${val}"`;
    return String(val);
  }

  _exprText(expr) {
    if (!expr) return '';
    switch (expr.type) {
      case 'NumberLiteral': return String(expr.value);
      case 'StringLiteral': return `"${expr.value.replace(/\n/g, '\\n')}"`;
      case 'Identifier':    return expr.name;
      case 'BinaryExpr':    return `${this._exprText(expr.left)} ${expr.op} ${this._exprText(expr.right)}`;
      case 'UnaryExpr':     return `${expr.op}${this._exprText(expr.operand)}`;
      case 'CallExpr':      return `${expr.callee}(${expr.args.map(a => this._exprText(a)).join(', ')})`;
      default:              return '?';
    }
  }

  _resolveText(expr, env) {
    if (!expr) return '';
    switch (expr.type) {
      case 'NumberLiteral': return String(expr.value);
      case 'StringLiteral': return `"${expr.value}"`;
      case 'Identifier':    return expr.name in env ? String(env[expr.name]) : expr.name;
      case 'BinaryExpr':    return `${this._resolveText(expr.left, env)} ${expr.op} ${this._resolveText(expr.right, env)}`;
      case 'UnaryExpr':     return `${expr.op}${this._resolveText(expr.operand, env)}`;
      case 'CallExpr':      return `${expr.callee}(${expr.args.map(a => this._resolveText(a, env)).join(', ')})`;
      default:              return this._exprText(expr);
    }
  }
}

// ---- Run pipeline: source → events + snapshots ----

function runPipeline(sourceCode, options = {}) {
  try {
    const lexer   = new Lexer(sourceCode);
    const tokens  = lexer.tokenize();

    const parser  = new Parser(tokens);
    const ast     = parser.parseProgram();

    const interp  = new Interpreter(options);
    const result  = interp.interpret(ast);

    return { success: true, ...result };
  } catch (err) {
    return {
      success: false,
      error: {
        type:    err.name || 'Error',
        message: err.message || String(err),
        line:    err.line || null,
      },
    };
  }
}
