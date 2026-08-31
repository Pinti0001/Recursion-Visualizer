// ============================================================
// C Lexer — tokenizes C source code for the Recursion Visualizer
// ============================================================

const TokenType = Object.freeze({
  // Types
  INT: 'INT', VOID: 'VOID', CHAR: 'CHAR',
  // Control flow
  RETURN: 'RETURN', IF: 'IF', ELSE: 'ELSE',
  WHILE: 'WHILE', FOR: 'FOR',
  // Identifier / literals
  IDENTIFIER: 'IDENTIFIER',
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  // Arithmetic
  PLUS: 'PLUS', MINUS: 'MINUS', STAR: 'STAR',
  SLASH: 'SLASH', PERCENT: 'PERCENT',
  // Comparison
  EQ: 'EQ', NEQ: 'NEQ',
  LT: 'LT', GT: 'GT', LTE: 'LTE', GTE: 'GTE',
  // Logic
  AND: 'AND', OR: 'OR', NOT: 'NOT',
  // Assignment
  ASSIGN: 'ASSIGN',
  // Punctuation
  LPAREN: 'LPAREN', RPAREN: 'RPAREN',
  LBRACE: 'LBRACE', RBRACE: 'RBRACE',
  LBRACKET: 'LBRACKET', RBRACKET: 'RBRACKET',
  SEMICOLON: 'SEMICOLON', COMMA: 'COMMA',
  // Special
  EOF: 'EOF',
});

const KEYWORDS = {
  int: TokenType.INT,
  void: TokenType.VOID,
  char: TokenType.CHAR,
  return: TokenType.RETURN,
  if: TokenType.IF,
  else: TokenType.ELSE,
  while: TokenType.WHILE,
  for: TokenType.FOR,
};

class Token {
  constructor(type, value, line) {
    this.type = type;
    this.value = value;
    this.line = line;
  }
  toString() {
    return `Token(${this.type}, ${JSON.stringify(this.value)}, L${this.line})`;
  }
}

class LexError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'LexError';
    this.line = line;
  }
}

class Lexer {
  constructor(source) {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.tokens = [];
  }

  peek(offset = 0) {
    return this.source[this.pos + offset] || '';
  }

  advance() {
    const ch = this.source[this.pos++];
    if (ch === '\n') this.line++;
    return ch;
  }

  error(msg) {
    throw new LexError(msg, this.line);
  }

  skipWhitespaceAndComments() {
    while (this.pos < this.source.length) {
      const ch = this.peek();
      // Whitespace
      if (/\s/.test(ch)) { this.advance(); continue; }
      // Line comment //
      if (ch === '/' && this.peek(1) === '/') {
        while (this.pos < this.source.length && this.peek() !== '\n') this.advance();
        continue;
      }
      // Block comment /* */
      if (ch === '/' && this.peek(1) === '*') {
        this.advance(); this.advance(); // skip /*
        while (this.pos < this.source.length) {
          if (this.peek() === '*' && this.peek(1) === '/') {
            this.advance(); this.advance(); break;
          }
          this.advance();
        }
        continue;
      }
      break;
    }
  }

  readNumber() {
    const line = this.line;
    let num = '';
    while (/\d/.test(this.peek())) num += this.advance();
    return new Token(TokenType.NUMBER, parseInt(num, 10), line);
  }

  readIdentOrKeyword() {
    const line = this.line;
    let ident = '';
    while (/[a-zA-Z0-9_]/.test(this.peek())) ident += this.advance();
    const type = KEYWORDS[ident] || TokenType.IDENTIFIER;
    return new Token(type, ident, line);
  }

  readString() {
    const line = this.line;
    this.advance(); // skip opening "
    let value = '';
    while (this.pos < this.source.length && this.peek() !== '"') {
      if (this.peek() === '\\') {
        this.advance();
        const esc = this.advance();
        switch (esc) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '\\': value += '\\'; break;
          case '"': value += '"'; break;
          case '0': value += '\0'; break;
          default: value += '\\' + esc;
        }
      } else {
        value += this.advance();
      }
    }
    if (this.peek() !== '"') this.error('Unterminated string literal');
    this.advance(); // skip closing "
    return new Token(TokenType.STRING, value, line);
  }

  readCharLiteral() {
    const line = this.line;
    this.advance(); // skip opening '
    let ch;
    if (this.peek() === '\\') {
      this.advance();
      const esc = this.advance();
      switch (esc) {
        case 'n': ch = '\n'.charCodeAt(0); break;
        case 't': ch = '\t'.charCodeAt(0); break;
        case '0': ch = 0; break;
        default: ch = esc.charCodeAt(0);
      }
    } else {
      ch = this.advance().charCodeAt(0);
    }
    if (this.peek() !== "'") this.error("Unterminated char literal");
    this.advance(); // skip closing '
    return new Token(TokenType.NUMBER, ch, line);
  }

  tokenize() {
    while (this.pos < this.source.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.source.length) break;

      const line = this.line;
      const ch = this.peek();

      // Numbers
      if (/\d/.test(ch)) { this.tokens.push(this.readNumber()); continue; }

      // Identifiers / keywords
      if (/[a-zA-Z_]/.test(ch)) { this.tokens.push(this.readIdentOrKeyword()); continue; }

      // String literals
      if (ch === '"') { this.tokens.push(this.readString()); continue; }

      // Char literals
      if (ch === "'") { this.tokens.push(this.readCharLiteral()); continue; }

      // Operators and punctuation
      this.advance();
      switch (ch) {
        case '+': this.tokens.push(new Token(TokenType.PLUS, '+', line)); break;
        case '-': this.tokens.push(new Token(TokenType.MINUS, '-', line)); break;
        case '*': this.tokens.push(new Token(TokenType.STAR, '*', line)); break;
        case '/': this.tokens.push(new Token(TokenType.SLASH, '/', line)); break;
        case '%': this.tokens.push(new Token(TokenType.PERCENT, '%', line)); break;
        case '(': this.tokens.push(new Token(TokenType.LPAREN, '(', line)); break;
        case ')': this.tokens.push(new Token(TokenType.RPAREN, ')', line)); break;
        case '{': this.tokens.push(new Token(TokenType.LBRACE, '{', line)); break;
        case '}': this.tokens.push(new Token(TokenType.RBRACE, '}', line)); break;
        case '[': this.tokens.push(new Token(TokenType.LBRACKET, '[', line)); break;
        case ']': this.tokens.push(new Token(TokenType.RBRACKET, ']', line)); break;
        case ';': this.tokens.push(new Token(TokenType.SEMICOLON, ';', line)); break;
        case ',': this.tokens.push(new Token(TokenType.COMMA, ',', line)); break;
        case '=':
          if (this.peek() === '=') { this.advance(); this.tokens.push(new Token(TokenType.EQ, '==', line)); }
          else this.tokens.push(new Token(TokenType.ASSIGN, '=', line));
          break;
        case '!':
          if (this.peek() === '=') { this.advance(); this.tokens.push(new Token(TokenType.NEQ, '!=', line)); }
          else this.tokens.push(new Token(TokenType.NOT, '!', line));
          break;
        case '<':
          if (this.peek() === '=') { this.advance(); this.tokens.push(new Token(TokenType.LTE, '<=', line)); }
          else this.tokens.push(new Token(TokenType.LT, '<', line));
          break;
        case '>':
          if (this.peek() === '=') { this.advance(); this.tokens.push(new Token(TokenType.GTE, '>=', line)); }
          else this.tokens.push(new Token(TokenType.GT, '>', line));
          break;
        case '&':
          if (this.peek() === '&') { this.advance(); this.tokens.push(new Token(TokenType.AND, '&&', line)); }
          else this.error(`Unexpected '&'. Use '&&' for logical AND.`);
          break;
        case '|':
          if (this.peek() === '|') { this.advance(); this.tokens.push(new Token(TokenType.OR, '||', line)); }
          else this.error(`Unexpected '|'. Use '||' for logical OR.`);
          break;
        default:
          this.error(`Unexpected character: '${ch}'`);
      }
    }

    this.tokens.push(new Token(TokenType.EOF, null, this.line));
    return this.tokens;
  }
}
