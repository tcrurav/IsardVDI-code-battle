export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class AuthorizationDenied extends HttpError {
  constructor() {
    super(403, 'Challenge access denied');
  }
}
export class InvalidFiles extends HttpError {
  constructor(message: string) {
    super(422, message);
  }
}
export class StateConflict extends HttpError {
  constructor(message: string) {
    super(409, message);
  }
}
