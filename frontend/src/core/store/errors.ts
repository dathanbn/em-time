export type ValidationReason = 'required' | 'too-long' | 'limit' | 'last-category';

/** Thrown by store actions before anything is mutated or persisted (contract.md section 6). */
export class ValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly reason: ValidationReason,
  ) {
    super(`Invalid ${field}: ${reason}`);
    this.name = 'ValidationError';
  }
}
