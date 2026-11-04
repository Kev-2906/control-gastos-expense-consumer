export class ExpenseRejectedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class RetryLaterError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly pausesConnection = false,
  ) {
    super(message);
  }
}
