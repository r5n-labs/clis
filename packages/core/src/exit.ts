export class Exit extends Error {
  constructor(
    message: string,
    public hint?: string,
  ) {
    super(message);
  }
}
