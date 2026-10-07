/** Expected business-rule failures; the API maps them to HTTP status + stable code. */
export class WorkflowError extends Error {
  constructor(public code: string, message: string, public status = 409, public details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'WorkflowError';
  }
}
