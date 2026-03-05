export class Cancel extends Error {
  constructor(message = "Operation cancelled") {
    super(message);
  }
}
