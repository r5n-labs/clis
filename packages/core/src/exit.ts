export class Exit extends Error {
  constructor(
    message: string,
    public hint?: string,
    public exitCode = 1,
  ) {
    super(message);
  }
}
