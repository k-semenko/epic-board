export class BoardError extends Error {
  constructor(status, code, detail) {
    super(detail);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}
