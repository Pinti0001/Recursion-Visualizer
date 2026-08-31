// ============================================================
// C Parser — Recursive-Descent Parser for the Recursion Visualizer
// Produces an AST from a token stream produced by the Lexer.
// ============================================================

class ParseError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'ParseError';
    this.line = line;
  }
}

const TYPE_TOKENS = new Set([TokenType.INT, TokenType.VOID, TokenType.CHAR]);

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  // ---- Helpers ----

  peek(offset = 0) {
    const idx = this.pos + offset;
    return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1];
  }

  advance() {
    const t = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  check(type) {
    return this.peek().type === type;
  }

  match(...types) {
    if (types.includes(this.peek().type)) return this.advance();
    return null;
  }

  expect(type, hint = '') {
    const t = this.peek();
    if (t.type !== type) {
      const msg = `Expected ${type}${hint ? ' (' + hint + ')' : ''} but got '${t.value ?? t.type}' at line ${t.line}`;
      throw new ParseError(msg, t.line);
    }
    return this.advance();
  }

  isType() {
    return TYPE_TOKENS.has(this.peek().type);
  }

  // Look ahead to determine if we're at a function declaration
  // vs. a variable declaration. A function decl has: TYPE IDENT (
  isFunctionDecl() {
    if (!this.isType()) return false;
    const next = this.peek(1);
    const afterNext = this.peek(2);
    return next.type === TokenType.IDENTIFIER && afterNext.type === TokenType.LPAREN;
  }

  // ---- Top-level ----

  parseProgram() {
    const decls = [];
    while (!this.check(TokenType.EOF)) {
      if (this.isFunctionDecl()) {
        decls.push(this.parseFunctionDecl());
      } else {
        // Global variable (skip for now, just consume to avoid infinite loop)
        throw new ParseError(
          `Expected a function declaration at line ${this.peek().line}. Global variables are not supported.`,
          this.peek().line
        );
      }
    }
    return { type: 'Program', declarations: decls };
  }

  parseFunctionDecl() {
    const retTypeTok = this.advance(); // INT, VOID, CHAR
    const nameTok = this.expect(TokenType.IDENTIFIER, 'function name');
    this.expect(TokenType.LPAREN);
    const params = this.parseParams();
    this.expect(TokenType.RPAREN);
    const body = this.parseBlock();
    return {
      type: 'FunctionDecl',
      returnType: retTypeTok.value,
      name: nameTok.value,
      params,
      body,
      line: retTypeTok.line,
    };
  }

  parseParams() {
    const params = [];
    if (this.check(TokenType.RPAREN)) return params;
    // void means no params
    if (this.peek().value === 'void' && this.peek(1).type === TokenType.RPAREN) {
      this.advance();
      return params;
    }
    do {
      if (!this.isType()) {
        throw new ParseError(`Expected parameter type at line ${this.peek().line}`, this.peek().line);
      }
      const typeTok = this.advance();
      const nameTok = this.expect(TokenType.IDENTIFIER, 'parameter name');
      params.push({ typeName: typeTok.value, name: nameTok.value, line: typeTok.line });
    } while (this.match(TokenType.COMMA));
    return params;
  }

  // ---- Statements ----

  parseBlock() {
    const line = this.peek().line;
    this.expect(TokenType.LBRACE);
    const body = [];
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      body.push(this.parseStatement());
    }
    this.expect(TokenType.RBRACE);
    return { type: 'BlockStmt', body, line };
  }

  parseStatement() {
    const t = this.peek();

    // Variable declaration
    if (this.isType() && this.peek(1).type === TokenType.IDENTIFIER &&
        this.peek(2).type !== TokenType.LPAREN) {
      return this.parseVarDecl();
    }

    switch (t.type) {
      case TokenType.RETURN: return this.parseReturn();
      case TokenType.IF:     return this.parseIf();
      case TokenType.WHILE:  return this.parseWhile();
      case TokenType.FOR:    return this.parseFor();
      case TokenType.LBRACE: return this.parseBlock();
      case TokenType.SEMICOLON:
        this.advance();
        return { type: 'EmptyStmt', line: t.line };
      default:
        return this.parseExprStmt();
    }
  }

  parseVarDecl() {
    const typeTok = this.advance();
    const nameTok = this.expect(TokenType.IDENTIFIER, 'variable name');
    let init = null;
    if (this.match(TokenType.ASSIGN)) {
      init = this.parseExpression();
    }
    this.expect(TokenType.SEMICOLON);
    return {
      type: 'VarDecl',
      varType: typeTok.value,
      name: nameTok.value,
      init,
      line: typeTok.line,
    };
  }

  parseReturn() {
    const tok = this.expect(TokenType.RETURN);
    let value = null;
    if (!this.check(TokenType.SEMICOLON)) {
      value = this.parseExpression();
    }
    this.expect(TokenType.SEMICOLON);
    return { type: 'ReturnStmt', value, line: tok.line };
  }

  parseIf() {
    const tok = this.expect(TokenType.IF);
    this.expect(TokenType.LPAREN);
    const condition = this.parseExpression();
    this.expect(TokenType.RPAREN);
    const then = this.parseStatement();
    let elseBody = null;
    if (this.match(TokenType.ELSE)) {
      elseBody = this.parseStatement();
    }
    return {
      type: 'IfStmt',
      condition,
      then,
      else: elseBody,
      line: tok.line,
    };
  }

  parseWhile() {
    const tok = this.expect(TokenType.WHILE);
    this.expect(TokenType.LPAREN);
    const condition = this.parseExpression();
    this.expect(TokenType.RPAREN);
    const body = this.parseStatement();
    return { type: 'WhileStmt', condition, body, line: tok.line };
  }

  parseFor() {
    const tok = this.expect(TokenType.FOR);
    this.expect(TokenType.LPAREN);

    // Init (can be var decl or expression)
    let init = null;
    if (!this.check(TokenType.SEMICOLON)) {
      if (this.isType() && this.peek(1).type === TokenType.IDENTIFIER) {
        init = this.parseVarDecl(); // consumes ;
      } else {
        init = this.parseExprStmt(); // consumes ;
      }
    } else {
      this.advance(); // ;
    }

    // Condition
    let condition = null;
    if (!this.check(TokenType.SEMICOLON)) {
      condition = this.parseExpression();
    }
    this.expect(TokenType.SEMICOLON);

    // Update
    let update = null;
    if (!this.check(TokenType.RPAREN)) {
      update = this.parseExpression();
    }
    this.expect(TokenType.RPAREN);
    const body = this.parseStatement();

    return { type: 'ForStmt', init, condition, update, body, line: tok.line };
  }

  parseExprStmt() {
    const expr = this.parseExpression();
    this.expect(TokenType.SEMICOLON);
    return { type: 'ExprStmt', expr, line: expr.line };
  }

  // ---- Expressions (precedence climbing) ----

  parseExpression() {
    return this.parseAssignment();
  }

  parseAssignment() {
    const left = this.parseOr();
    if (this.check(TokenType.ASSIGN)) {
      const tok = this.advance();
      const right = this.parseAssignment();
      return { type: 'AssignExpr', target: left, value: right, line: tok.line };
    }
    return left;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.check(TokenType.OR)) {
      const op = this.advance().value;
      const right = this.parseAnd();
      left = { type: 'BinaryExpr', op, left, right, line: left.line };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseEquality();
    while (this.check(TokenType.AND)) {
      const op = this.advance().value;
      const right = this.parseEquality();
      left = { type: 'BinaryExpr', op, left, right, line: left.line };
    }
    return left;
  }

  parseEquality() {
    let left = this.parseComparison();
    while (this.check(TokenType.EQ) || this.check(TokenType.NEQ)) {
      const op = this.advance().value;
      const right = this.parseComparison();
      left = { type: 'BinaryExpr', op, left, right, line: left.line };
    }
    return left;
  }

  parseComparison() {
    let left = this.parseAddition();
    while ([TokenType.LT, TokenType.GT, TokenType.LTE, TokenType.GTE].includes(this.peek().type)) {
      const op = this.advance().value;
      const right = this.parseAddition();
      left = { type: 'BinaryExpr', op, left, right, line: left.line };
    }
    return left;
  }

  parseAddition() {
    let left = this.parseMultiplication();
    while (this.check(TokenType.PLUS) || this.check(TokenType.MINUS)) {
      const op = this.advance().value;
      const right = this.parseMultiplication();
      left = { type: 'BinaryExpr', op, left, right, line: left.line };
    }
    return left;
  }

  parseMultiplication() {
    let left = this.parseUnary();
    while ([TokenType.STAR, TokenType.SLASH, TokenType.PERCENT].includes(this.peek().type)) {
      const op = this.advance().value;
      const right = this.parseUnary();
      left = { type: 'BinaryExpr', op, left, right, line: left.line };
    }
    return left;
  }

  parseUnary() {
    if (this.check(TokenType.MINUS)) {
      const tok = this.advance();
      const operand = this.parseUnary();
      return { type: 'UnaryExpr', op: '-', operand, line: tok.line };
    }
    if (this.check(TokenType.NOT)) {
      const tok = this.advance();
      const operand = this.parseUnary();
      return { type: 'UnaryExpr', op: '!', operand, line: tok.line };
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const t = this.peek();

    if (t.type === TokenType.NUMBER) {
      this.advance();
      return { type: 'NumberLiteral', value: t.value, line: t.line };
    }

    if (t.type === TokenType.STRING) {
      this.advance();
      return { type: 'StringLiteral', value: t.value, line: t.line };
    }

    if (t.type === TokenType.IDENTIFIER) {
      this.advance();
      // Function call
      if (this.check(TokenType.LPAREN)) {
        this.advance(); // (
        const args = this.parseArgList();
        this.expect(TokenType.RPAREN);
        return { type: 'CallExpr', callee: t.value, args, line: t.line };
      }
      return { type: 'Identifier', name: t.value, line: t.line };
    }

    if (t.type === TokenType.LPAREN) {
      this.advance();
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN);
      return expr;
    }

    throw new ParseError(
      `Unexpected token '${t.value ?? t.type}' at line ${t.line}`,
      t.line
    );
  }

  parseArgList() {
    const args = [];
    if (this.check(TokenType.RPAREN)) return args;
    do {
      args.push(this.parseExpression());
    } while (this.match(TokenType.COMMA));
    return args;
  }
}
