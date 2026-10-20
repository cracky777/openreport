// What reaches the client and the logs. Built from the status and a short
// reason only: the upstream body can echo the request, key included.
class AiProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AiProviderError';
    this.status = status;
  }
}

module.exports = { AiProviderError };
